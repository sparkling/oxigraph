use oxrdf::Term;
use std::fmt;

/// An error returned when constructing a Datalog identifier.
#[derive(Debug, Clone, Eq, PartialEq, thiserror::Error)]
pub enum IdentifierError {
    /// The identifier is empty.
    #[error("{kind} identifier must not be empty")]
    Empty {
        /// The kind of identifier being constructed.
        kind: &'static str,
    },
    /// The identifier contains a NUL character.
    #[error("{kind} identifier must not contain a NUL character")]
    ContainsNul {
        /// The kind of identifier being constructed.
        kind: &'static str,
    },
}

fn identifier(value: impl Into<String>, kind: &'static str) -> Result<Box<str>, IdentifierError> {
    let value = value.into();
    if value.is_empty() {
        return Err(IdentifierError::Empty { kind });
    }
    if value.contains('\0') {
        return Err(IdentifierError::ContainsNul { kind });
    }
    Ok(value.into_boxed_str())
}

/// The stable identifier of a Datalog relation.
///
/// Relation identifiers are non-empty UTF-8 strings that do not contain NUL.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RelationId(Box<str>);

impl RelationId {
    /// Constructs a relation identifier.
    ///
    /// Returns an error when `value` is empty or contains NUL.
    pub fn new(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self(identifier(value, "relation")?))
    }

    /// Returns the identifier text exactly as supplied at construction.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_static(value: &'static str) -> Self {
        Self(value.into())
    }

    pub(crate) fn from_validated(value: String) -> Self {
        Self(value.into_boxed_str())
    }
}

impl fmt::Display for RelationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The stable identifier of a Datalog rule.
///
/// Rule identifiers are non-empty UTF-8 strings that do not contain NUL and
/// must be unique within a validated program.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RuleId(Box<str>);

impl RuleId {
    /// Constructs a rule identifier.
    ///
    /// Returns an error when `value` is empty or contains NUL.
    pub fn new(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self(identifier(value, "rule")?))
    }

    /// Returns the identifier text exactly as supplied at construction.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RuleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A variable used by rule atoms.
///
/// Variable identifiers are non-empty UTF-8 strings that do not contain NUL.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Variable(Box<str>);

impl Variable {
    /// Constructs a variable.
    ///
    /// Returns an error when `value` is empty or contains NUL.
    pub fn new(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self(identifier(value, "variable")?))
    }

    /// Returns the variable name exactly as supplied at construction.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Variable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The identifier of a deterministic blank-node generator in a rule head.
///
/// Generator identifiers are non-empty UTF-8 strings that do not contain NUL.
/// Validation permits a generated term only in the head of a run-once rule.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BlankNodeGenerator(Box<str>);

impl BlankNodeGenerator {
    /// Constructs a blank-node generator identifier.
    ///
    /// Returns an error when `value` is empty or contains NUL.
    pub fn new(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self(identifier(value, "blank-node generator")?))
    }

    /// Returns the generator name exactly as supplied at construction.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for BlankNodeGenerator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A ground value in a Datalog tuple.
///
/// RDF terms remain opaque to the generic engine. The distinct default-graph
/// marker is used only by the RDF quad adapter and cannot collide with an RDF
/// term.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum Value {
    /// An opaque RDF term.
    Term(Term),
    /// The RDF default-graph sentinel.
    ///
    /// This variant is distinct from every RDF term.
    DefaultGraph,
}

impl Value {
    /// Returns the RDF term, or `None` for the default-graph sentinel.
    pub fn as_term(&self) -> Option<&Term> {
        match self {
            Self::Term(term) => Some(term),
            Self::DefaultGraph => None,
        }
    }

    /// Returns the deterministic payload-byte estimate used by evaluation
    /// memory limits.
    ///
    /// This is an accounting estimate, not an allocator measurement.
    pub fn estimated_bytes(&self) -> usize {
        match self {
            Self::Term(term) => term.to_string().len(),
            Self::DefaultGraph => 1,
        }
    }

    pub(crate) fn sort_key(&self) -> String {
        match self {
            Self::Term(term) => format!("T{}:{}", term.to_string().len(), term),
            Self::DefaultGraph => "G".to_owned(),
        }
    }
}

impl From<Term> for Value {
    fn from(term: Term) -> Self {
        Self::Term(term)
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Term(term) => term.fmt(f),
            Self::DefaultGraph => f.write_str("DEFAULT"),
        }
    }
}

/// A term position in a rule atom.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum PatternTerm {
    /// A variable that is bound while matching an atom.
    Variable(Variable),
    /// A ground value that must match exactly.
    Constant(Value),
    /// A deterministic evaluation-scoped RDF blank node.
    ///
    /// Generated terms are legal only in the head of a run-once rule.
    GeneratedBlankNode(BlankNodeGenerator),
}

impl PatternTerm {
    /// Constructs a variable pattern.
    ///
    /// Returns an error when `value` is empty or contains NUL.
    pub fn variable(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self::Variable(Variable::new(value)?))
    }

    /// Constructs a constant pattern.
    pub fn constant(value: impl Into<Value>) -> Self {
        Self::Constant(value.into())
    }

    /// Constructs a deterministic blank-node generator pattern.
    ///
    /// Validation accepts the result only in the head of a run-once rule.
    pub fn generated_blank_node(value: impl Into<String>) -> Result<Self, IdentifierError> {
        Ok(Self::GeneratedBlankNode(BlankNodeGenerator::new(value)?))
    }
}

impl From<Variable> for PatternTerm {
    fn from(variable: Variable) -> Self {
        Self::Variable(variable)
    }
}

impl From<Value> for PatternTerm {
    fn from(value: Value) -> Self {
        Self::Constant(value)
    }
}

impl From<Term> for PatternTerm {
    fn from(term: Term) -> Self {
        Self::Constant(term.into())
    }
}

/// A relation application containing rule patterns.
///
/// Construction is deliberately unchecked. Program validation enforces
/// relation arities and the safety rules for variables and generated terms.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Atom {
    relation: RelationId,
    terms: Box<[PatternTerm]>,
}

impl Atom {
    /// Constructs an atom from a relation and its ordered term patterns.
    pub fn new(relation: RelationId, terms: impl Into<Vec<PatternTerm>>) -> Self {
        Self {
            relation,
            terms: terms.into().into_boxed_slice(),
        }
    }

    /// Returns the atom's relation.
    pub fn relation(&self) -> &RelationId {
        &self.relation
    }

    /// Returns the ordered term patterns.
    pub fn terms(&self) -> &[PatternTerm] {
        &self.terms
    }

    /// Returns the number of term positions.
    pub fn arity(&self) -> usize {
        self.terms.len()
    }
}

/// A ground relation tuple.
///
/// Facts are set-valued during evaluation: equal facts are deduplicated.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Fact {
    relation: RelationId,
    values: Box<[Value]>,
}

impl Fact {
    /// Constructs a fact from a relation and its ordered ground values.
    pub fn new(relation: RelationId, values: impl Into<Vec<Value>>) -> Self {
        Self {
            relation,
            values: values.into().into_boxed_slice(),
        }
    }

    /// Returns the fact's relation.
    pub fn relation(&self) -> &RelationId {
        &self.relation
    }

    /// Returns the ordered ground values.
    pub fn values(&self) -> &[Value] {
        &self.values
    }

    /// Returns the number of value positions.
    pub fn arity(&self) -> usize {
        self.values.len()
    }

    /// Returns a stable, length-delimited key for deterministic ordering.
    ///
    /// The representation distinguishes the default-graph sentinel from RDF
    /// terms and is intended for canonical engine ordering, not interchange.
    pub fn canonical_key(&self) -> String {
        let mut result = format!("{}:{}|", self.relation.as_str().len(), self.relation);
        for value in &self.values {
            let key = value.sort_key();
            result.push_str(&key.len().to_string());
            result.push(':');
            result.push_str(&key);
            result.push('|');
        }
        result
    }
}

/// An immutable declarative Datalog rule.
///
/// Rules are constructed independently of a program. Call [`validate`](crate::validate)
/// before evaluation to enforce unique identifiers, consistent arities,
/// variable safety, stratifiable negation, and generated-term restrictions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rule {
    id: RuleId,
    source: Option<Box<str>>,
    head: Atom,
    positive_body: Box<[Atom]>,
    negative_body: Box<[Atom]>,
    run_once: bool,
}

impl Rule {
    /// Constructs a positive rule.
    ///
    /// Every atom in `body` is a positive dependency.
    pub fn new(id: RuleId, head: Atom, body: impl Into<Vec<Atom>>) -> Self {
        Self {
            id,
            source: None,
            head,
            positive_body: body.into().into_boxed_slice(),
            negative_body: Box::default(),
            run_once: false,
        }
    }

    /// Creates a safe stratified rule with positive and negated body atoms.
    ///
    /// Negation is absence-based and is evaluated only after the producing
    /// strata of every negated relation have reached a fixpoint. Validation
    /// rejects variables that occur only in a negated atom and dependency
    /// cycles containing negation.
    pub fn new_stratified(
        id: RuleId,
        head: Atom,
        positive_body: impl Into<Vec<Atom>>,
        negative_body: impl Into<Vec<Atom>>,
    ) -> Self {
        Self {
            id,
            source: None,
            head,
            positive_body: positive_body.into().into_boxed_slice(),
            negative_body: negative_body.into().into_boxed_slice(),
            run_once: false,
        }
    }

    /// Attaches optional source text or a source identifier for diagnostics and
    /// provenance.
    #[must_use]
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into().into_boxed_str());
        self
    }

    /// Closes all positive dependencies and evaluates this rule exactly once
    /// after their producing strata reach a fixpoint.
    #[must_use]
    pub fn run_once(mut self) -> Self {
        self.run_once = true;
        self
    }

    /// Returns the stable rule identifier.
    pub fn id(&self) -> &RuleId {
        &self.id
    }

    /// Returns the optional source annotation.
    pub fn source(&self) -> Option<&str> {
        self.source.as_deref()
    }

    /// Returns the rule head.
    pub fn head(&self) -> &Atom {
        &self.head
    }

    /// Returns the positive body atoms.
    pub fn body(&self) -> &[Atom] {
        &self.positive_body
    }

    /// Returns the negated body atoms.
    pub fn negative_body(&self) -> &[Atom] {
        &self.negative_body
    }

    /// Returns `true` when the rule has no negated body atoms.
    pub fn is_positive(&self) -> bool {
        self.negative_body.is_empty()
    }

    /// Returns `true` when the rule closes its dependencies and runs once.
    pub fn is_run_once(&self) -> bool {
        self.run_once
    }
}

/// An ordered collection of rules awaiting validation.
///
/// Validation returns a canonical representation whose rules are sorted by
/// [`RuleId`].
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Program {
    rules: Vec<Rule>,
}

impl Program {
    /// Constructs a program from rules in caller-provided order.
    pub fn new(rules: impl Into<Vec<Rule>>) -> Self {
        Self {
            rules: rules.into(),
        }
    }

    /// Returns the rules in caller-provided order.
    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxrdf::NamedNode;

    #[test]
    fn identifier_text_and_display_are_exact() {
        let relation = RelationId::new("relation").unwrap();
        let rule = RuleId::new("rule").unwrap();
        let variable = Variable::new("variable").unwrap();
        let generator = BlankNodeGenerator::new("generator").unwrap();

        assert_eq!(relation.as_str(), "relation");
        assert_eq!(relation.to_string(), "relation");
        assert_eq!(rule.as_str(), "rule");
        assert_eq!(rule.to_string(), "rule");
        assert_eq!(variable.as_str(), "variable");
        assert_eq!(variable.to_string(), "variable");
        assert_eq!(generator.as_str(), "generator");
        assert_eq!(generator.to_string(), "generator");
    }

    #[test]
    fn values_preserve_the_term_boundary_and_display() {
        let term = Term::from(NamedNode::new_unchecked("urn:x"));
        let value = Value::Term(term.clone());

        assert_eq!(value.as_term(), Some(&term));
        assert_eq!(value.to_string(), "<urn:x>");
        assert_eq!(Value::DefaultGraph.as_term(), None);
        assert_eq!(Value::DefaultGraph.to_string(), "DEFAULT");
    }

    #[test]
    fn fact_canonical_keys_are_length_delimited_and_stable() {
        let fact = Fact::new(
            RelationId::new("r").unwrap(),
            vec![
                Value::DefaultGraph,
                Value::Term(NamedNode::new_unchecked("urn:x").into()),
            ],
        );
        let different = Fact::new(
            RelationId::new("r").unwrap(),
            vec![Value::Term(NamedNode::new_unchecked("urn:x").into())],
        );

        assert_eq!(fact.canonical_key(), "1:r|1:G|10:T7:<urn:x>|");
        assert_ne!(fact.canonical_key(), different.canonical_key());
    }
}
