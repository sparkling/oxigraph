mod data;
mod expression;
mod head;
mod matching;
mod native;
mod policy;

use super::{
    SrlBodyElement, SrlConstant, SrlError, SrlImportResolver, SrlNode, SrlPredicate, SrlRuleSet,
    SrlTriple, rules,
};
use crate::control::{LimitKind, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
use crate::srl::imports::resolve_imports;
use oxdatalog::rdf::quad_atom;
use oxdatalog::{
    Atom, EvaluationLimits, EvaluationOptions, PatternTerm, Program, RelationId, Rule, RuleId,
    Value, Variable,
};
use oxrdf::{NamedNode, Term};
use std::collections::BTreeSet;

use self::data::inline_data;
use self::policy::{reject_draft_open_constructs, reject_query_goal};

/// Materialized base, inferred, and entailed graphs from one SRL execution.
#[derive(Clone, Debug)]
pub struct SrlExecution {
    base: GraphSnapshot,
    inference: GraphSnapshot,
    entailed: GraphSnapshot,
    iterations: usize,
    estimated_memory_bytes: usize,
}

impl SrlExecution {
    /// Returns the isolated default graph supplied as rule input.
    pub fn base(&self) -> &GraphSnapshot {
        &self.base
    }

    /// Returns triples supplied by inline data or derived by SRL rules.
    pub fn inference(&self) -> &GraphSnapshot {
        &self.inference
    }

    /// Returns the union of the base and inference graphs.
    pub fn entailed(&self) -> &GraphSnapshot {
        &self.entailed
    }

    /// Returns the number of rule-evaluation iterations performed.
    pub fn iterations(&self) -> usize {
        self.iterations
    }

    /// Returns the deterministic memory estimate charged during evaluation.
    pub fn estimated_memory_bytes(&self) -> usize {
        self.estimated_memory_bytes
    }
}

/// Executes an import-free SRL rule set to a bounded fixpoint.
///
/// Documents declaring imports must instead use
/// [`execute_srl_rules_with_imports`].
pub fn execute_srl_rules(
    rule_set: &SrlRuleSet,
    base: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<SrlExecution, SrlError> {
    if !rule_set.imports.is_empty() {
        return Err(SrlError::Unsupported(
            "IMPORTS without an application-supplied SrlImportResolver".to_owned(),
        ));
    }
    execute_resolved(rule_set, base, options)
}

/// Executes SRL after recursively resolving imports through an application callback.
///
/// The resolver is the only import I/O seam. This function never dereferences an
/// import IRI itself, and each import IRI is resolved at most once.
pub fn execute_srl_rules_with_imports(
    rule_set: &SrlRuleSet,
    base: &GraphSnapshot,
    options: &ValidationOptions,
    resolver: &dyn SrlImportResolver,
) -> Result<SrlExecution, SrlError> {
    let resolved = resolve_imports(rule_set, resolver, options)?;
    execute_resolved(&resolved, base, options)
}

/// Determines whether an abstract triple-pattern goal is entailed after rule execution.
///
/// The Rules draft does not currently define a separate concrete goal syntax, so
/// callers supply the abstract [`SrlTriple`] directly. Property paths and SRL
/// abbreviation nodes are not abstract triple-pattern terms and fail closed.
pub fn query_srl_rules(
    rule_set: &SrlRuleSet,
    base: &GraphSnapshot,
    goal: &SrlTriple,
    options: &ValidationOptions,
) -> Result<bool, SrlError> {
    reject_query_goal(goal)?;
    let execution = execute_srl_rules(rule_set, base, options)?;
    native::query(goal, execution.entailed().dataset(), options)
}

/// Resolves imports through the application callback and performs Rules QUERY.
pub fn query_srl_rules_with_imports(
    rule_set: &SrlRuleSet,
    base: &GraphSnapshot,
    goal: &SrlTriple,
    options: &ValidationOptions,
    resolver: &dyn SrlImportResolver,
) -> Result<bool, SrlError> {
    reject_query_goal(goal)?;
    let execution = execute_srl_rules_with_imports(rule_set, base, options, resolver)?;
    native::query(goal, execution.entailed().dataset(), options)
}

fn execute_resolved(
    rule_set: &SrlRuleSet,
    base: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<SrlExecution, SrlError> {
    rule_set.check_well_formed()?;
    let stratification = rule_set.stratification()?;
    if !rule_set.semantic_extensions.is_empty() {
        return Err(SrlError::Unsupported(
            rule_set
                .semantic_extensions
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }
    reject_draft_open_constructs(rule_set)?;
    let isolated_base = base.isolated_default_dataset();
    let inline = inline_data(rule_set, &isolated_base)?;
    let mut working = isolated_base.clone();
    working.extend(inline.iter());
    if working.len() > options.limits.max_data_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: options.limits.max_data_quads,
        }
        .into());
    }
    if options.cancellation_token.is_cancelled() {
        return Err(ValidationError::Cancelled.into());
    }
    if native::required(rule_set) {
        let result = native::evaluate(rule_set, &isolated_base, &inline, &stratification, options)?;
        let (inference, iterations, estimated_memory_bytes) = result.into_parts();
        let mut entailed = isolated_base.clone();
        entailed.extend(inference.iter());
        return Ok(SrlExecution {
            base: GraphSnapshot::default_graph(isolated_base),
            inference: GraphSnapshot::default_graph(inference),
            entailed: GraphSnapshot::default_graph(entailed),
            iterations,
            estimated_memory_bytes,
        });
    }
    let program = compile_program(rule_set)?;
    let closure = oxdatalog::rdf::evaluate(
        &program,
        &working,
        &EvaluationOptions {
            limits: EvaluationLimits {
                max_facts: working
                    .len()
                    .saturating_add(options.limits.max_derived_triples),
                max_intermediate_rows: options.limits.max_derived_triples.saturating_mul(8),
                max_iterations: options.limits.max_rule_iterations,
                max_memory_bytes: options.limits.max_estimated_memory_bytes,
                max_term_bytes: 1024 * 1024,
                timeout: options.limits.timeout,
            },
            track_provenance: true,
            cancellation_token: options.cancellation_token.clone(),
        },
    )?;
    let mut inference = closure.inference().clone();
    inference.extend(inline.iter().filter(|quad| !isolated_base.contains(quad)));
    if inference.len() > options.limits.max_derived_triples {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: options.limits.max_derived_triples,
        }
        .into());
    }
    let mut entailed = isolated_base.clone();
    entailed.extend(inference.iter());
    Ok(SrlExecution {
        base: GraphSnapshot::default_graph(isolated_base),
        inference: GraphSnapshot::default_graph(inference),
        entailed: GraphSnapshot::default_graph(entailed),
        iterations: closure.evaluation().iterations(),
        estimated_memory_bytes: closure.evaluation().estimated_memory_bytes(),
    })
}

fn compile_program(rule_set: &SrlRuleSet) -> Result<Program, SrlError> {
    let mut output = Vec::new();
    for (rule_index, source) in rules(rule_set).enumerate() {
        if source.for_clause.is_some() {
            return Err(SrlError::Unsupported(
                "FOR/IN shape integration (draft issue #1074)".to_owned(),
            ));
        }
        if source.data_only {
            return Err(SrlError::Unsupported(
                "WHERE DATA matching (draft issue #960)".to_owned(),
            ));
        }
        for element in &source.body {
            match element {
                SrlBodyElement::Negation {
                    data_only: true, ..
                } => {
                    return Err(SrlError::Unsupported(
                        "NOT DATA matching (draft issue #960)".to_owned(),
                    ));
                }
                SrlBodyElement::Filter(_) => {
                    return Err(SrlError::Unsupported(
                        "FILTER expression evaluation in SRL lowering".to_owned(),
                    ));
                }
                SrlBodyElement::Assignment { .. } => {
                    return Err(SrlError::Unsupported(
                        "SET expression evaluation in SRL lowering".to_owned(),
                    ));
                }
                SrlBodyElement::Triple(_) | SrlBodyElement::Negation { .. } => {}
            }
        }
        if source.head.is_empty() {
            continue;
        }
        let mut positive = Vec::new();
        let mut negative = Vec::new();
        let mut bound = BTreeSet::new();
        for (element_index, element) in source.body.iter().enumerate() {
            match element {
                SrlBodyElement::Triple(triple) => {
                    positive.extend(pattern_atoms(
                        triple,
                        &format!("r{rule_index}_e{element_index}"),
                        false,
                    )?);
                    triple.variables(&mut bound);
                }
                SrlBodyElement::Negation { data_only, body } => {
                    if *data_only {
                        return Err(SrlError::Unsupported(
                            "NOT DATA matching (draft issue #960)".to_owned(),
                        ));
                    }
                    let helper =
                        compile_negation(rule_index, element_index, body, &bound, &mut output)?;
                    negative.push(helper);
                }
                SrlBodyElement::Filter(_) => {
                    return Err(SrlError::Unsupported(
                        "FILTER expression evaluation in SRL lowering".to_owned(),
                    ));
                }
                SrlBodyElement::Assignment { .. } => {
                    return Err(SrlError::Unsupported(
                        "SET expression evaluation in SRL lowering".to_owned(),
                    ));
                }
            }
        }
        for (head_index, head) in source.head.iter().enumerate() {
            let [head] = pattern_atoms(head, &format!("r{rule_index}"), true)?
                .try_into()
                .map_err(|_| {
                    SrlError::Unsupported("property path in an SRL rule head".to_owned())
                })?;
            let mut rule = Rule::new_stratified(
                rule_id(format!("srl-rule-{rule_index}-head-{head_index}"))?,
                head,
                positive.clone(),
                negative.clone(),
            )
            .with_source(
                source
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("anonymous-rule-{}", rule_index + 1)),
            );
            if source.head.iter().any(SrlTriple::contains_generated_blank) {
                rule = rule.run_once();
            }
            output.push(rule);
        }
    }
    Ok(Program::new(output))
}

fn compile_negation(
    rule_index: usize,
    element_index: usize,
    body: &[SrlBodyElement],
    outer_bound: &BTreeSet<String>,
    output: &mut Vec<Rule>,
) -> Result<Atom, SrlError> {
    let relation = RelationId::new(format!(
        "urn:oxshacl:srl:negation:{rule_index}:{element_index}"
    ))
    .map_err(|error| SrlError::Unsupported(error.to_string()))?;
    let mut variables = BTreeSet::new();
    let mut positive = Vec::new();
    for (nested_index, element) in body.iter().enumerate() {
        match element {
            SrlBodyElement::Triple(triple) => {
                triple.variables(&mut variables);
                positive.extend(pattern_atoms(
                    triple,
                    &format!("r{rule_index}_n{element_index}_{nested_index}"),
                    false,
                )?);
            }
            SrlBodyElement::Filter(_) => {
                return Err(SrlError::Unsupported(
                    "FILTER inside NOT during SRL lowering".to_owned(),
                ));
            }
            SrlBodyElement::Negation { .. } | SrlBodyElement::Assignment { .. } => {
                return Err(SrlError::Unsupported(
                    "nested NOT or SET inside NOT".to_owned(),
                ));
            }
        }
    }
    let correlated = variables
        .intersection(outer_bound)
        .cloned()
        .collect::<Vec<_>>();
    let terms = correlated
        .iter()
        .map(|variable| variable_term(variable))
        .collect::<Result<Vec<_>, _>>()?;
    output.push(Rule::new(
        rule_id(format!("srl-negation-{rule_index}-{element_index}"))?,
        Atom::new(relation.clone(), terms.clone()),
        positive,
    ));
    Ok(Atom::new(relation, terms))
}

fn pattern_atoms(triple: &SrlTriple, scope: &str, head: bool) -> Result<Vec<Atom>, SrlError> {
    match &triple.predicate {
        SrlPredicate::Node(predicate) => Ok(vec![quad_atom(
            pattern_term(&triple.subject, scope, head)?,
            pattern_term(predicate, scope, head)?,
            pattern_term(&triple.object, scope, head)?,
            PatternTerm::constant(Value::DefaultGraph),
        )]),
        SrlPredicate::Path(path) => {
            let mut output = Vec::new();
            let mut current = pattern_term(&triple.subject, scope, false)?;
            for (index, element) in path.iter().enumerate() {
                let next = if index + 1 == path.len() {
                    pattern_term(&triple.object, scope, false)?
                } else {
                    variable_term(&format!("__{scope}_path_{index}"))?
                };
                let predicate =
                    PatternTerm::from(Term::from(NamedNode::new_unchecked(element.iri.clone())));
                let (subject, object) = if element.inverse {
                    (next.clone(), current.clone())
                } else {
                    (current.clone(), next.clone())
                };
                output.push(quad_atom(
                    subject,
                    predicate,
                    object,
                    PatternTerm::constant(Value::DefaultGraph),
                ));
                current = next;
            }
            Ok(output)
        }
    }
}

fn pattern_term(node: &SrlNode, scope: &str, head: bool) -> Result<PatternTerm, SrlError> {
    match node {
        SrlNode::Variable(variable) => variable_term(variable),
        SrlNode::GeneratedBlankNode(id) if head => {
            PatternTerm::generated_blank_node(format!("{scope}-blank-{id}"))
                .map_err(|error| SrlError::Unsupported(error.to_string()))
        }
        SrlNode::Constant(SrlConstant::BlankNode(label)) if head => {
            PatternTerm::generated_blank_node(format!("{scope}-blank-label-{label}"))
                .map_err(|error| SrlError::Unsupported(error.to_string()))
        }
        SrlNode::GeneratedBlankNode(_) | SrlNode::Constant(SrlConstant::BlankNode(_)) => Err(
            SrlError::Unsupported("blank node matching in an SRL rule body".to_owned()),
        ),
        SrlNode::Constant(_) => Ok(PatternTerm::from(node.as_term()?)),
        _ => Err(SrlError::Unsupported(
            "collection, property-list, annotation, or reified node lowering".to_owned(),
        )),
    }
}

fn variable_term(variable: &str) -> Result<PatternTerm, SrlError> {
    Variable::new(variable.to_owned())
        .map(PatternTerm::from)
        .map_err(|error| SrlError::Unsupported(error.to_string()))
}

fn rule_id(value: String) -> Result<RuleId, SrlError> {
    RuleId::new(value).map_err(|error| SrlError::Unsupported(error.to_string()))
}
