use super::derived::{admit, cleanup_layer, prepare_layer};
use super::{CompiledRule, SparqlRuleSet};
use crate::Validator;
use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
use crate::rules::{RuleError, RuleExecution};
use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term, Variable};
use oxsdatatypes::Decimal;
use spareval::{QueryEvaluator, QueryResults};
use spargebra::Query;
use std::collections::{BTreeMap, BTreeSet};

/// Executes compiled SHACL-SPARQL rules one layer at a time to bounded fixpoints.
///
/// On synchronous WebAssembly this operation fails closed because cooperative
/// SPARQL timeout and cancellation cannot be guaranteed.
pub fn execute_sparql_rules(
    rules: &SparqlRuleSet,
    base: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<RuleExecution, RuleError> {
    let mut budget = Budget::new(options)?;
    if base.triple_count() > options.limits.max_data_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: options.limits.max_data_quads,
        }
        .into());
    }
    let isolated = base.isolated_default_dataset();
    budget.charge_memory(isolated.len().saturating_mul(128))?;
    let mut entailed = isolated.clone();
    let mut inference = Dataset::new();
    let mut admissions = 0_usize;
    let cancellation = spareval::CancellationToken::new();
    let watchdog = crate::sparql::Watchdog::start(cancellation.clone(), &budget)?;
    let layers = rules
        .rules
        .iter()
        .filter(|rule| !rule.deactivated)
        .fold(
            BTreeMap::<Decimal, Vec<&CompiledRule>>::new(),
            |mut layers, rule| {
                layers.entry(rule.layer).or_default().push(rule);
                layers
            },
        );
    let mut iterations = 0;
    for layer_rules in layers.values() {
        budget.check()?;
        let mut expected_predicates = BTreeSet::<NamedNode>::new();
        for rule in layer_rules {
            budget.check()?;
            for predicate in &rule.expected_predicates {
                if !expected_predicates.contains(predicate) {
                    budget.charge_memory(128)?;
                    expected_predicates.insert(predicate.clone());
                }
            }
        }
        let layer_start_inference = if expected_predicates.is_empty() {
            None
        } else {
            budget.charge_memory(inference.len().saturating_mul(128))?;
            Some(inference.clone())
        };
        let derived = if expected_predicates.is_empty() {
            Dataset::new()
        } else {
            budget.charge_memory(entailed.len().saturating_mul(128))?;
            let layer_start = GraphSnapshot::default_graph(entailed.clone());
            prepare_layer(
                &rules.shapes,
                &expected_predicates,
                &layer_start,
                options,
                &mut budget,
                &mut admissions,
            )?
        };
        for quad in &derived {
            if !entailed.contains(&quad) {
                budget.charge_memory(128)?;
                entailed.insert(quad);
            }
        }
        loop {
            if iterations >= options.limits.max_rule_iterations {
                return Err(ValidationError::LimitExceeded {
                    kind: LimitKind::RuleIterations,
                    limit: options.limits.max_rule_iterations,
                }
                .into());
            }
            iterations += 1;
            budget.check()?;
            let changed = execute_iteration(
                layer_rules,
                rules,
                &isolated,
                &mut entailed,
                &mut inference,
                options,
                &cancellation,
                &mut budget,
                &mut admissions,
                derived.len(),
            )?;
            if !changed {
                break;
            }
        }
        if let Some(layer_start_inference) = &layer_start_inference {
            cleanup_layer(
                &isolated,
                &mut entailed,
                &mut inference,
                layer_start_inference,
                &derived,
                &mut budget,
            )?;
        }
    }
    watchdog.finish();
    budget.check()?;
    Ok(RuleExecution::new(
        GraphSnapshot::default_graph(isolated),
        GraphSnapshot::default_graph(inference),
        GraphSnapshot::default_graph(entailed),
        rules.profiles.clone(),
        iterations,
        budget.estimated_memory(),
    ))
}

fn execute_iteration(
    layer_rules: &[&CompiledRule],
    rules: &SparqlRuleSet,
    base: &Dataset,
    entailed: &mut Dataset,
    inference: &mut Dataset,
    options: &ValidationOptions,
    cancellation: &spareval::CancellationToken,
    budget: &mut Budget<'_>,
    admissions: &mut usize,
    overlay_len: usize,
) -> Result<bool, RuleError> {
    let groups = layer_rules.iter().copied().fold(
        BTreeMap::<Decimal, Vec<&CompiledRule>>::new(),
        |mut groups, rule| {
            groups.entry(rule.order).or_default().push(rule);
            groups
        },
    );
    let mut changed = false;
    for group in groups.values() {
        budget.check()?;
        budget.charge_memory(overlay_len.saturating_mul(256))?;
        let visible = entailed.clone();
        let pending = infer_group(group, rules, &visible, options, cancellation, budget)?;
        changed |= merge_inferences(
            base,
            entailed,
            inference,
            &pending,
            options,
            budget,
            admissions,
        )?;
    }
    Ok(changed)
}

fn infer_group(
    group: &[&CompiledRule],
    rules: &SparqlRuleSet,
    visible: &Dataset,
    options: &ValidationOptions,
    cancellation: &spareval::CancellationToken,
    budget: &mut Budget<'_>,
) -> Result<Dataset, RuleError> {
    let snapshot = GraphSnapshot::default_graph(visible.clone());
    let mut pending = Dataset::new();
    for rule in group {
        if rule.deactivated {
            continue;
        }
        for focus in rule_focuses(rule, rules, &snapshot, options, budget)? {
            budget.focus()?;
            if !conditions_hold(rule, rules, &snapshot, focus.as_ref(), options, budget)? {
                continue;
            }
            for triple in execute_construct(
                &rule.query,
                visible,
                focus.as_ref(),
                cancellation.clone(),
                budget,
            )? {
                pending.insert(Quad::new(
                    triple.subject,
                    triple.predicate,
                    triple.object,
                    GraphName::DefaultGraph,
                ));
            }
        }
    }
    Ok(pending)
}

fn merge_inferences(
    base: &Dataset,
    entailed: &mut Dataset,
    inference: &mut Dataset,
    pending: &Dataset,
    options: &ValidationOptions,
    budget: &mut Budget<'_>,
    admissions: &mut usize,
) -> Result<bool, RuleError> {
    let mut changed = false;
    for quad in pending {
        if !base.contains(&quad) && !inference.contains(&quad) {
            budget.charge_memory(128)?;
            inference.insert(quad.clone());
        }
        if !entailed.contains(&quad) {
            admit(admissions, options)?;
            budget.charge_memory(128)?;
            entailed.insert(quad);
            changed = true;
        }
    }
    Ok(changed)
}

fn rule_focuses(
    rule: &CompiledRule,
    rules: &SparqlRuleSet,
    data: &GraphSnapshot,
    options: &ValidationOptions,
    budget: &mut Budget<'_>,
) -> Result<Vec<Option<Term>>, RuleError> {
    let Some(shape) = &rule.scope else {
        return Ok(vec![None]);
    };
    Ok(Validator::new(&rules.shapes, options)
        .focus_nodes_with_budget(data, shape, budget)?
        .into_iter()
        .map(Some)
        .collect())
}

fn conditions_hold(
    rule: &CompiledRule,
    rules: &SparqlRuleSet,
    data: &GraphSnapshot,
    focus: Option<&Term>,
    options: &ValidationOptions,
    budget: &mut Budget<'_>,
) -> Result<bool, RuleError> {
    let Some(focus) = focus else {
        return Ok(rule.conditions.is_empty());
    };
    let validator = Validator::new(&rules.shapes, options);
    for condition in &rule.conditions {
        budget.focus()?;
        if !validator.conforms_node_with_budget(data, condition, focus, budget)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn execute_construct(
    query: &Query,
    dataset: &Dataset,
    focus: Option<&Term>,
    cancellation: spareval::CancellationToken,
    budget: &mut Budget<'_>,
) -> Result<Vec<oxrdf::Triple>, RuleError> {
    let evaluator = QueryEvaluator::new().with_cancellation_token(cancellation);
    let mut query = query.clone();
    if focus.is_some() {
        crate::sparql::expose_prebound_variables(&mut query, &[Variable::new_unchecked("this")]);
    }
    let prepared = evaluator.prepare(&query);
    let prepared = if let Some(focus) = focus {
        prepared.substitute_variable(Variable::new_unchecked("this"), focus.clone())
    } else {
        prepared
    };
    let QueryResults::Graph(triples) = prepared
        .execute(dataset)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?
    else {
        return Err(RuleError::IllFormed(
            "SHACL-SPARQL rule did not produce a graph".to_owned(),
        ));
    };
    let mut output = Vec::new();
    for triple in triples {
        budget.query_solution()?;
        output.push(triple.map_err(|error| ValidationError::Sparql(error.to_string()))?);
    }
    Ok(output)
}
