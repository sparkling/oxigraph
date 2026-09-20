use super::{CompiledRule, SparqlRuleSet};
use crate::Validator;
use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
use crate::rules::{RuleError, RuleExecution};
use oxrdf::{Dataset, GraphName, Quad, Term, Variable};
use oxsdatatypes::Decimal;
use spareval::{QueryEvaluator, QueryResults};
use spargebra::Query;
use std::collections::BTreeMap;

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
                &mut entailed,
                &mut inference,
                options,
                &cancellation,
                &mut budget,
            )?;
            if !changed {
                break;
            }
        }
    }
    watchdog.finish();
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
    entailed: &mut Dataset,
    inference: &mut Dataset,
    options: &ValidationOptions,
    cancellation: &spareval::CancellationToken,
    budget: &mut Budget<'_>,
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
        let visible = entailed.clone();
        let pending = infer_group(group, rules, &visible, options, cancellation, budget)?;
        changed |= merge_inferences(entailed, inference, &pending, options, budget)?;
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
        for focus in rule_focuses(rule, rules, &snapshot, options)? {
            budget.focus()?;
            if !conditions_hold(rule, rules, &snapshot, focus.as_ref(), options)? {
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
    entailed: &mut Dataset,
    inference: &mut Dataset,
    pending: &Dataset,
    options: &ValidationOptions,
    budget: &mut Budget<'_>,
) -> Result<bool, RuleError> {
    let mut changed = false;
    for quad in pending {
        if entailed.insert(quad.clone()) {
            inference.insert(quad);
            changed = true;
            budget.charge_memory(128)?;
            if inference.len() > options.limits.max_derived_triples {
                return Err(ValidationError::LimitExceeded {
                    kind: LimitKind::DerivedTriples,
                    limit: options.limits.max_derived_triples,
                }
                .into());
            }
        }
    }
    Ok(changed)
}

fn rule_focuses(
    rule: &CompiledRule,
    rules: &SparqlRuleSet,
    data: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<Vec<Option<Term>>, RuleError> {
    let Some(shape) = &rule.scope else {
        return Ok(vec![None]);
    };
    Ok(Validator::new(&rules.shapes, options)
        .focus_nodes(data, shape)?
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
) -> Result<bool, RuleError> {
    let Some(focus) = focus else {
        return Ok(rule.conditions.is_empty());
    };
    let validator = Validator::new(&rules.shapes, options);
    for condition in &rule.conditions {
        if !validator.conforms_node(data, condition, focus)? {
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
