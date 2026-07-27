use crate::{PatternTerm, Program, RelationId, Rule, RuleId, Variable};
use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;

mod strata;

use self::strata::compute_strata;

/// Structural and payload-size limits applied during program validation.
///
/// Limits are deterministic safety ceilings checked before evaluation.
#[derive(Clone, Debug, Eq, PartialEq)]
#[expect(
    clippy::struct_field_names,
    reason = "the max prefix makes every independently configurable safety ceiling explicit"
)]
pub struct ValidationLimits {
    /// Maximum number of rules in a program.
    pub max_rules: usize,
    /// Maximum total atoms in one rule, including its head.
    pub max_atoms_per_rule: usize,
    /// Maximum number of term positions in a relation.
    pub max_arity: usize,
    /// Maximum UTF-8 byte length of a relation, rule, variable, or generator
    /// identifier.
    pub max_identifier_bytes: usize,
    /// Maximum UTF-8 byte length of one rule's source annotation.
    pub max_source_bytes: usize,
    /// Maximum serialized byte estimate of a constant RDF term.
    pub max_term_bytes: usize,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            max_rules: 10_000,
            max_atoms_per_rule: 256,
            max_arity: 64,
            max_identifier_bytes: 1_024,
            max_source_bytes: 8_192,
            max_term_bytes: 1024 * 1024,
        }
    }
}

/// A deterministic program-validation failure.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ValidationError {
    /// The program contains more rules than the configured limit.
    #[error("program has {actual} rules, exceeding the limit of {limit}")]
    RuleLimit {
        /// The number of rules found.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
    /// A rule contains more atoms than the configured per-rule limit.
    #[error("rule {rule} has {actual} atoms, exceeding the limit of {limit}")]
    AtomLimit {
        /// The offending rule.
        rule: RuleId,
        /// The number of atoms found, including the head.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
    /// Two rules use the same stable identifier.
    #[error("duplicate rule identifier {0}")]
    DuplicateRuleId(RuleId),
    /// A relation is used with inconsistent arities.
    #[error(
        "relation {relation} has arity {actual} in rule {rule}, but its established arity is {expected}"
    )]
    ArityMismatch {
        /// The inconsistently used relation.
        relation: RelationId,
        /// The arity established by its first canonical occurrence.
        expected: usize,
        /// The conflicting arity.
        actual: usize,
        /// The rule containing the conflicting occurrence.
        rule: RuleId,
    },
    /// A relation's arity exceeds the configured limit.
    #[error("relation {relation} has arity {actual}, exceeding the limit of {limit}")]
    ArityLimit {
        /// The offending relation.
        relation: RelationId,
        /// The arity found.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
    /// A head variable is not bound by the positive body.
    #[error("head variable {variable} in rule {rule} does not occur in its positive body")]
    UnsafeHeadVariable {
        /// The offending rule.
        rule: RuleId,
        /// The unbound variable.
        variable: Variable,
    },
    /// A variable in a negated atom is not bound by the positive body.
    #[error("negated variable {variable} in rule {rule} does not occur in its positive body")]
    UnsafeNegativeVariable {
        /// The offending rule.
        rule: RuleId,
        /// The unbound variable.
        variable: Variable,
    },
    /// A negative dependency participates in a dependency cycle.
    #[error(
        "program is not stratifiable because relation {relation} depends negatively on a cycle"
    )]
    UnstratifiableNegation {
        /// A relation in the unstratifiable component.
        relation: RelationId,
    },
    /// A run-once closed dependency participates in a dependency cycle.
    #[error("program is not stratifiable because run-once relation {relation} closes a cycle")]
    UnstratifiableClosedDependency {
        /// A relation in the unstratifiable component.
        relation: RelationId,
    },
    /// A generated blank-node term occurs outside a rule head.
    #[error("generated blank-node term {generator} in rule {rule} is only legal in a rule head")]
    GeneratedTermOutsideHead {
        /// The offending rule.
        rule: RuleId,
        /// The offending generator.
        generator: crate::BlankNodeGenerator,
    },
    /// A generated blank-node term occurs in a rule that is not run once.
    #[error("generated blank-node term {generator} in rule {rule} requires a run-once rule")]
    GeneratedTermRequiresRunOnce {
        /// The offending rule.
        rule: RuleId,
        /// The offending generator.
        generator: crate::BlankNodeGenerator,
    },
    /// An identifier exceeds the configured UTF-8 byte limit.
    #[error("{kind} identifier in rule {rule} is {actual} bytes, exceeding the limit of {limit}")]
    IdentifierLimit {
        /// The identifier kind, such as `rule`, `relation`, or `variable`.
        kind: &'static str,
        /// The rule containing the identifier.
        rule: RuleId,
        /// The UTF-8 byte length found.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
    /// A source annotation exceeds the configured UTF-8 byte limit.
    #[error("source metadata in rule {rule} is {actual} bytes, exceeding the limit of {limit}")]
    SourceLimit {
        /// The offending rule.
        rule: RuleId,
        /// The UTF-8 byte length found.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
    /// A constant term exceeds the configured serialized-byte limit.
    #[error("constant in rule {rule} is {actual} bytes, exceeding the limit of {limit}")]
    TermLimit {
        /// The rule containing the constant.
        rule: RuleId,
        /// The serialized byte estimate found.
        actual: usize,
        /// The configured maximum.
        limit: usize,
    },
}

/// Relation dependencies used for validation and stratified evaluation.
///
/// Every edge is directed from a rule-head relation to a body relation.
/// Positive, negative, and run-once closed dependencies are recorded
/// separately.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
#[expect(
    clippy::struct_field_names,
    reason = "edge polarity names make the dependency semantics explicit"
)]
pub struct DependencyGraph {
    positive_edges: BTreeMap<RelationId, BTreeSet<RelationId>>,
    negative_edges: BTreeMap<RelationId, BTreeSet<RelationId>>,
    closed_edges: BTreeMap<RelationId, BTreeSet<RelationId>>,
}

impl DependencyGraph {
    /// Iterates over direct positive dependencies of `relation`.
    pub fn dependencies(&self, relation: &RelationId) -> impl Iterator<Item = &RelationId> {
        self.positive_edges.get(relation).into_iter().flatten()
    }

    /// Iterates over direct negative dependencies of `relation`.
    pub fn negative_dependencies(
        &self,
        relation: &RelationId,
    ) -> impl Iterator<Item = &RelationId> {
        self.negative_edges.get(relation).into_iter().flatten()
    }

    /// Iterates over dependencies that a run-once rule closes before running.
    pub fn closed_dependencies(&self, relation: &RelationId) -> impl Iterator<Item = &RelationId> {
        self.closed_edges.get(relation).into_iter().flatten()
    }

    /// Iterates over all relations in canonical identifier order.
    pub fn relations(&self) -> impl Iterator<Item = &RelationId> {
        self.positive_edges.keys()
    }

    fn add_positive(&mut self, head: RelationId, body: RelationId) {
        self.ensure_relation(body.clone());
        self.positive_edges.entry(head).or_default().insert(body);
    }

    fn add_negative(&mut self, head: RelationId, body: RelationId) {
        self.ensure_relation(body.clone());
        self.negative_edges.entry(head).or_default().insert(body);
    }

    fn add_closed(&mut self, head: RelationId, body: RelationId) {
        self.ensure_relation(body.clone());
        self.closed_edges.entry(head).or_default().insert(body);
    }

    fn ensure_relation(&mut self, relation: RelationId) {
        self.positive_edges.entry(relation.clone()).or_default();
        self.negative_edges.entry(relation.clone()).or_default();
        self.closed_edges.entry(relation).or_default();
    }
}

/// A canonical, structurally safe program ready for evaluation.
///
/// Rules are sorted by [`RuleId`]. The artifact also records consistent
/// relation arities, dependency polarity, and the computed stratum of every
/// relation.
#[derive(Clone, Debug)]
pub struct ValidatedProgram {
    rules: Box<[Rule]>,
    arities: BTreeMap<RelationId, usize>,
    dependencies: DependencyGraph,
    strata: BTreeMap<RelationId, usize>,
}

impl ValidatedProgram {
    /// Returns rules in canonical rule-identifier order.
    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }

    /// Returns the established arity of `relation`.
    pub fn arity(&self, relation: &RelationId) -> Option<usize> {
        self.arities.get(relation).copied()
    }

    /// Returns the program's relation dependency graph.
    pub fn dependencies(&self) -> &DependencyGraph {
        &self.dependencies
    }

    /// Returns the evaluation stratum assigned to `relation`.
    pub fn stratum(&self, relation: &RelationId) -> Option<usize> {
        self.strata.get(relation).copied()
    }

    /// Returns the highest assigned evaluation stratum.
    ///
    /// Empty programs return zero.
    pub fn max_stratum(&self) -> usize {
        self.strata.values().copied().max().unwrap_or(0)
    }

    pub(crate) fn arities(&self) -> &BTreeMap<RelationId, usize> {
        &self.arities
    }
}

/// Validates and canonicalizes a Datalog program.
///
/// Validation enforces the supplied resource limits, unique rule identifiers,
/// consistent relation arities, safe head and negated variables, stratifiable
/// negation and closed dependencies, and the run-once restriction for
/// generated terms.
pub fn validate(
    program: &Program,
    limits: &ValidationLimits,
) -> Result<ValidatedProgram, ValidationError> {
    match validate_with_control(program, limits, || Ok::<_, Infallible>(())) {
        Ok(program) => Ok(program),
        Err(ControlledValidationError::Validation(error)) => Err(error),
        Err(ControlledValidationError::Control(never)) => match never {},
    }
}

pub(crate) enum ControlledValidationError<E> {
    Validation(ValidationError),
    Control(E),
}

pub(crate) fn validate_with_control<E>(
    program: &Program,
    limits: &ValidationLimits,
    mut check_control: impl FnMut() -> Result<(), E>,
) -> Result<ValidatedProgram, ControlledValidationError<E>> {
    check_control().map_err(ControlledValidationError::Control)?;
    if program.rules().len() > limits.max_rules {
        return Err(ControlledValidationError::Validation(
            ValidationError::RuleLimit {
                actual: program.rules().len(),
                limit: limits.max_rules,
            },
        ));
    }

    let mut rules = program.rules().to_vec();
    rules.sort_by(|left, right| left.id().cmp(right.id()));
    check_control().map_err(ControlledValidationError::Control)?;
    let mut ids = BTreeSet::new();
    let mut arities = BTreeMap::new();
    let mut dependencies = DependencyGraph::default();

    for rule in &rules {
        check_control().map_err(ControlledValidationError::Control)?;
        let atom_count = rule
            .body()
            .len()
            .saturating_add(rule.negative_body().len())
            .saturating_add(1);
        if atom_count > limits.max_atoms_per_rule {
            return Err(ControlledValidationError::Validation(
                ValidationError::AtomLimit {
                    rule: rule.id().clone(),
                    actual: atom_count,
                    limit: limits.max_atoms_per_rule,
                },
            ));
        }
        if !ids.insert(rule.id().clone()) {
            return Err(ControlledValidationError::Validation(
                ValidationError::DuplicateRuleId(rule.id().clone()),
            ));
        }
        check_identifier(
            "rule",
            rule.id().as_str().len(),
            rule.id(),
            limits.max_identifier_bytes,
        )
        .map_err(ControlledValidationError::Validation)?;
        if let Some(source) = rule.source()
            && source.len() > limits.max_source_bytes
        {
            return Err(ControlledValidationError::Validation(
                ValidationError::SourceLimit {
                    rule: rule.id().clone(),
                    actual: source.len(),
                    limit: limits.max_source_bytes,
                },
            ));
        }

        let mut body_variables = BTreeSet::new();
        for atom in rule.body() {
            check_atom(
                atom,
                rule.id(),
                limits,
                &mut arities,
                &mut body_variables,
                false,
                &mut check_control,
            )?;
            dependencies.add_positive(rule.head().relation().clone(), atom.relation().clone());
            if rule.is_run_once() {
                dependencies.add_closed(rule.head().relation().clone(), atom.relation().clone());
            }
        }
        for atom in rule.negative_body() {
            let mut negative_variables = BTreeSet::new();
            check_atom(
                atom,
                rule.id(),
                limits,
                &mut arities,
                &mut negative_variables,
                false,
                &mut check_control,
            )?;
            for variable in negative_variables {
                if !body_variables.contains(&variable) {
                    return Err(ControlledValidationError::Validation(
                        ValidationError::UnsafeNegativeVariable {
                            rule: rule.id().clone(),
                            variable,
                        },
                    ));
                }
            }
            dependencies.add_negative(rule.head().relation().clone(), atom.relation().clone());
        }
        dependencies.ensure_relation(rule.head().relation().clone());

        let mut head_variables = BTreeSet::new();
        check_atom(
            rule.head(),
            rule.id(),
            limits,
            &mut arities,
            &mut head_variables,
            true,
            &mut check_control,
        )?;
        for term in rule.head().terms() {
            if let PatternTerm::GeneratedBlankNode(generator) = term
                && !rule.is_run_once()
            {
                return Err(ControlledValidationError::Validation(
                    ValidationError::GeneratedTermRequiresRunOnce {
                        rule: rule.id().clone(),
                        generator: generator.clone(),
                    },
                ));
            }
        }
        for variable in head_variables {
            if !body_variables.contains(&variable) {
                return Err(ControlledValidationError::Validation(
                    ValidationError::UnsafeHeadVariable {
                        rule: rule.id().clone(),
                        variable,
                    },
                ));
            }
        }
    }

    let strata = compute_strata(&dependencies).map_err(ControlledValidationError::Validation)?;
    check_control().map_err(ControlledValidationError::Control)?;
    Ok(ValidatedProgram {
        rules: rules.into_boxed_slice(),
        arities,
        dependencies,
        strata,
    })
}

fn check_atom<E>(
    atom: &crate::Atom,
    rule: &RuleId,
    limits: &ValidationLimits,
    arities: &mut BTreeMap<RelationId, usize>,
    variables: &mut BTreeSet<Variable>,
    allow_generated: bool,
    check_control: &mut impl FnMut() -> Result<(), E>,
) -> Result<(), ControlledValidationError<E>> {
    check_control().map_err(ControlledValidationError::Control)?;
    check_identifier(
        "relation",
        atom.relation().as_str().len(),
        rule,
        limits.max_identifier_bytes,
    )
    .map_err(ControlledValidationError::Validation)?;
    if atom.arity() > limits.max_arity {
        return Err(ControlledValidationError::Validation(
            ValidationError::ArityLimit {
                relation: atom.relation().clone(),
                actual: atom.arity(),
                limit: limits.max_arity,
            },
        ));
    }
    if let Some(expected) = arities.insert(atom.relation().clone(), atom.arity())
        && expected != atom.arity()
    {
        return Err(ControlledValidationError::Validation(
            ValidationError::ArityMismatch {
                relation: atom.relation().clone(),
                expected,
                actual: atom.arity(),
                rule: rule.clone(),
            },
        ));
    }
    for term in atom.terms() {
        check_control().map_err(ControlledValidationError::Control)?;
        match term {
            PatternTerm::Variable(variable) => {
                check_identifier(
                    "variable",
                    variable.as_str().len(),
                    rule,
                    limits.max_identifier_bytes,
                )
                .map_err(ControlledValidationError::Validation)?;
                variables.insert(variable.clone());
            }
            PatternTerm::Constant(value) => {
                let actual = value.estimated_bytes();
                if actual > limits.max_term_bytes {
                    return Err(ControlledValidationError::Validation(
                        ValidationError::TermLimit {
                            rule: rule.clone(),
                            actual,
                            limit: limits.max_term_bytes,
                        },
                    ));
                }
            }
            PatternTerm::GeneratedBlankNode(generator) => {
                check_identifier(
                    "blank-node generator",
                    generator.as_str().len(),
                    rule,
                    limits.max_identifier_bytes,
                )
                .map_err(ControlledValidationError::Validation)?;
                if !allow_generated {
                    return Err(ControlledValidationError::Validation(
                        ValidationError::GeneratedTermOutsideHead {
                            rule: rule.clone(),
                            generator: generator.clone(),
                        },
                    ));
                }
            }
        }
    }
    Ok(())
}

fn check_identifier(
    kind: &'static str,
    actual: usize,
    rule: &RuleId,
    limit: usize,
) -> Result<(), ValidationError> {
    if actual > limit {
        Err(ValidationError::IdentifierLimit {
            kind,
            rule: rule.clone(),
            actual,
            limit,
        })
    } else {
        Ok(())
    }
}
