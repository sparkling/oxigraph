use crate::control::{LimitKind, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
use crate::profile::{ProfileId, ProfileSet};
use oxdatalog::rdf::{RdfEvaluationError, quad_atom};
use oxdatalog::{
    Atom, EvaluationLimits, EvaluationOptions, PatternTerm, Program, Rule, RuleId, Value, Variable,
};
use oxrdf::Term;
use std::collections::BTreeSet;

/// A variable or RDF constant used in a rule triple pattern.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuleTerm {
    /// A named rule variable.
    Variable(String),
    /// A fixed RDF term.
    Constant(Term),
}

/// Subject, predicate, and object pattern used by a shape rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TriplePattern {
    /// Subject term or variable.
    pub subject: RuleTerm,
    /// Predicate term or variable.
    pub predicate: RuleTerm,
    /// Object term or variable.
    pub object: RuleTerm,
}

impl TriplePattern {
    /// Creates a triple pattern.
    pub fn new(subject: RuleTerm, predicate: RuleTerm, object: RuleTerm) -> Self {
        Self {
            subject,
            predicate,
            object,
        }
    }
}

/// A Datalog-backed SHACL triple rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShapeRule {
    /// Stable rule identifier used in diagnostics and provenance.
    pub id: String,
    /// Triples derived for each successful body binding.
    pub head: Vec<TriplePattern>,
    /// Triple patterns that must match.
    pub positive_body: Vec<TriplePattern>,
    /// Triple patterns that must not match under stratified negation.
    pub negative_body: Vec<TriplePattern>,
}

/// Validated collection of SHACL rules and its implementation profiles.
#[derive(Clone, Debug)]
pub struct RuleSet {
    profiles: ProfileSet,
    rules: Vec<ShapeRule>,
}

impl RuleSet {
    /// Builds and validates a rule set.
    ///
    /// The dated Rules profile must be selected, rule identifiers must be
    /// unique, and every rule must have a non-empty head and positive body.
    pub fn new(profiles: ProfileSet, rules: Vec<ShapeRule>) -> Result<Self, RuleError> {
        if !profiles.contains(ProfileId::Rules12Subset20260727) {
            return Err(RuleError::Profile(
                "rule execution requires the dated SHACL 1.2 Rules subset".to_owned(),
            ));
        }
        if rules.is_empty() {
            return Err(RuleError::IllFormed(
                "a rule set must contain at least one rule".to_owned(),
            ));
        }
        let mut ids = BTreeSet::new();
        for rule in &rules {
            if rule.id.is_empty() || rule.head.is_empty() || rule.positive_body.is_empty() {
                return Err(RuleError::IllFormed(format!(
                    "rule `{}` needs an id, head, and positive body",
                    rule.id
                )));
            }
            if !ids.insert(&rule.id) {
                return Err(RuleError::IllFormed(format!(
                    "duplicate rule id `{}`",
                    rule.id
                )));
            }
            for pattern in rule
                .head
                .iter()
                .chain(&rule.positive_body)
                .chain(&rule.negative_body)
            {
                validate_pattern(pattern)?;
            }
        }
        Ok(Self { profiles, rules })
    }

    /// Returns the profiles under which these rules were compiled.
    pub fn profiles(&self) -> &ProfileSet {
        &self.profiles
    }

    /// Returns the validated source rules.
    pub fn rules(&self) -> &[ShapeRule] {
        &self.rules
    }
}

/// Failure while validating, compiling, or executing SHACL rules.
#[derive(Debug, thiserror::Error)]
pub enum RuleError {
    /// The selected implementation profiles do not permit rule execution.
    #[error("SHACL Rules profile error: {0}")]
    Profile(String),
    /// The source rule set is structurally invalid.
    #[error("ill-formed SHACL rule: {0}")]
    IllFormed(String),
    /// Datalog evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
    /// A validation budget or processor control failed.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// A referenced shapes graph could not be compiled.
    #[error(transparent)]
    Compile(#[from] crate::CompileError),
}

/// Materialized base, inferred, and entailed graphs from one rule execution.
#[derive(Clone, Debug)]
pub struct RuleExecution {
    base: GraphSnapshot,
    inference: GraphSnapshot,
    entailed: GraphSnapshot,
    profiles: ProfileSet,
    iterations: usize,
    estimated_memory_bytes: usize,
}

impl RuleExecution {
    #[cfg(feature = "sparql")]
    pub(crate) fn new(
        base: GraphSnapshot,
        inference: GraphSnapshot,
        entailed: GraphSnapshot,
        profiles: ProfileSet,
        iterations: usize,
        estimated_memory_bytes: usize,
    ) -> Self {
        Self {
            base,
            inference,
            entailed,
            profiles,
            iterations,
            estimated_memory_bytes,
        }
    }

    /// Returns the isolated default graph supplied as rule input.
    pub fn base(&self) -> &GraphSnapshot {
        &self.base
    }

    /// Returns only triples derived by the rules.
    pub fn inference(&self) -> &GraphSnapshot {
        &self.inference
    }

    /// Returns the union of base and inferred triples.
    pub fn entailed(&self) -> &GraphSnapshot {
        &self.entailed
    }

    /// Returns the number of fixpoint iterations performed.
    pub fn iterations(&self) -> usize {
        self.iterations
    }

    /// Serializes inferred triples as lexically sorted N-Quads.
    pub fn canonical_inference_nquads(&self) -> String {
        let mut lines = self
            .inference
            .dataset()
            .iter()
            .map(|quad| quad.to_string())
            .collect::<Vec<_>>();
        lines.sort();
        if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        }
    }

    /// Serializes deterministic execution metadata and inferred triples.
    pub fn receipt(&self) -> String {
        format!(
            "profiles={}\nbase-triples={}\nderived-triples={}\niterations={}\nestimated-memory-bytes={}\n---\n{}",
            self.profiles.canonical_text(),
            self.base.triple_count(),
            self.inference.triple_count(),
            self.iterations,
            self.estimated_memory_bytes,
            self.canonical_inference_nquads()
        )
    }
}

/// Executes a validated rule set to a bounded fixpoint.
///
/// The Datalog evaluator receives the same cancellation token as the outer
/// SHACL operation, and derives at most the configured number of triples.
pub fn execute_rules(
    rules: &RuleSet,
    base: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<RuleExecution, RuleError> {
    let base_count = base.triple_count();
    if base_count > options.limits.max_data_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: options.limits.max_data_quads,
        }
        .into());
    }
    if options.cancellation_token.is_cancelled() {
        return Err(ValidationError::Cancelled.into());
    }
    let program = compile_program(rules)?;
    let evaluation_options = EvaluationOptions {
        limits: EvaluationLimits {
            max_facts: base_count.saturating_add(options.limits.max_derived_triples),
            max_intermediate_rows: options.limits.max_derived_triples.saturating_mul(8),
            max_iterations: options.limits.max_rule_iterations,
            max_memory_bytes: options.limits.max_estimated_memory_bytes,
            max_term_bytes: 1024 * 1024,
            timeout: options.limits.timeout,
        },
        track_provenance: true,
        cancellation_token: options.cancellation_token.clone(),
    };
    let isolated = base.isolated_default_dataset();
    let closure = oxdatalog::rdf::evaluate(&program, &isolated, &evaluation_options)?;
    let derived_count = closure.inference().iter().count();
    if derived_count > options.limits.max_derived_triples {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: options.limits.max_derived_triples,
        }
        .into());
    }
    let inference = GraphSnapshot::default_graph(closure.inference().clone());
    let entailed = GraphSnapshot::default_graph(closure.entailed().dataset().clone());
    Ok(RuleExecution {
        base: GraphSnapshot::default_graph(isolated),
        inference,
        entailed,
        profiles: rules.profiles.clone(),
        iterations: closure.evaluation().iterations(),
        estimated_memory_bytes: closure.evaluation().estimated_memory_bytes(),
    })
}

fn compile_program(rule_set: &RuleSet) -> Result<Program, RuleError> {
    let mut rules = Vec::new();
    for source in &rule_set.rules {
        let positive = source
            .positive_body
            .iter()
            .map(pattern_atom)
            .collect::<Result<Vec<_>, _>>()?;
        let negative = source
            .negative_body
            .iter()
            .map(pattern_atom)
            .collect::<Result<Vec<_>, _>>()?;
        for (index, head) in source.head.iter().enumerate() {
            let id = RuleId::new(format!("{}#head-{index}", source.id))
                .map_err(|error| RuleError::IllFormed(error.to_string()))?;
            rules.push(
                Rule::new_stratified(id, pattern_atom(head)?, positive.clone(), negative.clone())
                    .with_source(source.id.clone()),
            );
        }
    }
    Ok(Program::new(rules))
}

fn pattern_atom(pattern: &TriplePattern) -> Result<Atom, RuleError> {
    Ok(quad_atom(
        pattern_term(&pattern.subject)?,
        pattern_term(&pattern.predicate)?,
        pattern_term(&pattern.object)?,
        PatternTerm::constant(Value::DefaultGraph),
    ))
}

fn pattern_term(term: &RuleTerm) -> Result<PatternTerm, RuleError> {
    match term {
        RuleTerm::Variable(name) => Variable::new(name.clone())
            .map(PatternTerm::from)
            .map_err(|error| RuleError::IllFormed(error.to_string())),
        RuleTerm::Constant(term) => Ok(PatternTerm::from(term.clone())),
    }
}

fn validate_pattern(pattern: &TriplePattern) -> Result<(), RuleError> {
    if let RuleTerm::Constant(term) = &pattern.subject
        && !matches!(term, Term::NamedNode(_) | Term::BlankNode(_))
    {
        return Err(RuleError::IllFormed(
            "constant rule subjects must be IRIs or blank nodes".to_owned(),
        ));
    }
    if let RuleTerm::Constant(term) = &pattern.predicate
        && !matches!(term, Term::NamedNode(_))
    {
        return Err(RuleError::IllFormed(
            "constant rule predicates must be IRIs".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxrdf::{Dataset, GraphName, NamedNode, Quad};

    fn n(value: &str) -> NamedNode {
        NamedNode::new_unchecked(value.to_owned())
    }

    fn variable(name: &str) -> RuleTerm {
        RuleTerm::Variable(name.to_owned())
    }

    #[test]
    fn datalog_rules_share_the_outer_cancellation_token() {
        let outer = crate::CancellationToken::new();
        let datalog: oxdatalog::CancellationToken = outer.clone();
        outer.cancel();
        assert!(datalog.is_cancelled());
    }

    #[test]
    fn recursive_rule_reaches_fixpoint() {
        let parent = n("http://example.com/parent");
        let ancestor = n("http://example.com/ancestor");
        let alice = n("http://example.com/alice");
        let bob = n("http://example.com/bob");
        let carol = n("http://example.com/carol");
        let profiles = ProfileSet::new([
            ProfileId::Core12Subset20260723,
            ProfileId::Rules12Subset20260727,
        ])
        .unwrap();
        let rules = RuleSet::new(
            profiles,
            vec![
                ShapeRule {
                    id: "parent-is-ancestor".to_owned(),
                    head: vec![TriplePattern::new(
                        variable("x"),
                        RuleTerm::Constant(ancestor.clone().into()),
                        variable("y"),
                    )],
                    positive_body: vec![TriplePattern::new(
                        variable("x"),
                        RuleTerm::Constant(parent.clone().into()),
                        variable("y"),
                    )],
                    negative_body: vec![],
                },
                ShapeRule {
                    id: "ancestor-transitive".to_owned(),
                    head: vec![TriplePattern::new(
                        variable("x"),
                        RuleTerm::Constant(ancestor.clone().into()),
                        variable("z"),
                    )],
                    positive_body: vec![
                        TriplePattern::new(
                            variable("x"),
                            RuleTerm::Constant(ancestor.clone().into()),
                            variable("y"),
                        ),
                        TriplePattern::new(
                            variable("y"),
                            RuleTerm::Constant(ancestor.clone().into()),
                            variable("z"),
                        ),
                    ],
                    negative_body: vec![],
                },
            ],
        )
        .unwrap();
        let data = Dataset::from_iter([
            Quad::new(
                alice.clone(),
                parent.clone(),
                bob.clone(),
                GraphName::DefaultGraph,
            ),
            Quad::new(bob, parent, carol.clone(), GraphName::DefaultGraph),
        ]);
        let result = execute_rules(
            &rules,
            &GraphSnapshot::default_graph(data),
            &ValidationOptions::default(),
        )
        .unwrap();
        assert!(result.entailed().dataset().contains(&Quad::new(
            alice,
            ancestor,
            carol,
            GraphName::DefaultGraph,
        )));
    }
}
