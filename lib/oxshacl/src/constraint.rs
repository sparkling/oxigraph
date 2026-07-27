use crate::{NodeExpression, PropertyPath, ShapeId};
use oxrdf::{Literal, NamedNode, Term};

/// RDF term category accepted by a `sh:nodeKind` constraint.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NodeKind {
    /// IRI nodes.
    Iri,
    /// Blank nodes.
    BlankNode,
    /// Literal nodes.
    Literal,
    /// Blank nodes or IRIs.
    BlankNodeOrIri,
    /// Blank nodes or literals.
    BlankNodeOrLiteral,
    /// IRIs or literals.
    IriOrLiteral,
    /// RDF 1.2 triple terms.
    TripleTerm,
}

/// Parameters of a qualified-value-shape constraint.
#[derive(Clone, Debug)]
pub struct QualifiedValueShape {
    /// Shape used to qualify value nodes.
    pub shape: ShapeId,
    /// Optional minimum number of qualified values.
    pub min_count: Option<usize>,
    /// Optional maximum number of qualified values.
    pub max_count: Option<usize>,
    /// Whether values matching sibling qualified shapes are excluded.
    pub disjoint: bool,
}

/// Compiled constraint supported by the selected dated SHACL profiles.
#[derive(Clone, Debug)]
pub enum Constraint {
    /// Requires every value node to be an instance of one class.
    Class(NamedNode),
    /// Requires every value node to be an instance of at least one class.
    Classes(Vec<NamedNode>),
    /// Requires every value node to be a literal with one datatype.
    Datatype(NamedNode),
    /// Requires every value node to use one of several datatypes.
    Datatypes(Vec<NamedNode>),
    /// Requires every value node to have one RDF node kind.
    NodeKind(NodeKind),
    /// Requires every value node to have one of several RDF node kinds.
    NodeKinds(Vec<NodeKind>),
    /// Requires at least the given number of value nodes.
    MinCount(usize),
    /// Allows at most the given number of value nodes.
    MaxCount(usize),
    /// Requires comparable values to be greater than the bound.
    MinExclusive(Term),
    /// Requires comparable values to be greater than or equal to the bound.
    MinInclusive(Term),
    /// Requires comparable values to be less than the bound.
    MaxExclusive(Term),
    /// Requires comparable values to be less than or equal to the bound.
    MaxInclusive(Term),
    /// Requires string representations to have at least this many characters.
    MinLength(usize),
    /// Requires string representations to have at most this many characters.
    MaxLength(usize),
    /// Requires string representations to match a regular expression.
    Pattern {
        /// Regular-expression source.
        pattern: String,
        /// SHACL regular-expression flags.
        flags: String,
    },
    /// Requires or forbids line-break characters.
    SingleLine(bool),
    /// Restricts language-tagged strings to the supplied language ranges.
    LanguageIn(Vec<String>),
    /// Requires unique language tags among value nodes when true.
    UniqueLang(bool),
    /// Requires RDF-list members to conform to the referenced shape.
    MemberShape(ShapeId),
    /// Requires an RDF list to contain at least this many members.
    MinListLength(usize),
    /// Requires an RDF list to contain at most this many members.
    MaxListLength(usize),
    /// Requires RDF-list members to be pairwise distinct when true.
    UniqueMembers(bool),
    /// Compares the value-node set for equality with another property path.
    Equals(PropertyPath),
    /// Requires disjointness from values reached through another property path.
    Disjoint(PropertyPath),
    /// Requires values to be a subset of those reached through another path.
    SubsetOf(PropertyPath),
    /// Requires each value to compare less than values reached through a path.
    LessThan(PropertyPath),
    /// Requires each value to compare at most values reached through a path.
    LessThanOrEquals(PropertyPath),
    /// Requires the focus node not to conform to a referenced shape.
    Not(ShapeId),
    /// Requires conformance to every referenced shape.
    And(Vec<ShapeId>),
    /// Requires conformance to at least one referenced shape.
    Or(Vec<ShapeId>),
    /// Requires conformance to exactly one referenced shape.
    Xone(Vec<ShapeId>),
    /// Requires each value node to conform to a referenced node shape.
    Node(ShapeId),
    /// Evaluates a referenced property shape for the focus node.
    Property(ShapeId),
    /// Requires at least one value node to conform to a referenced shape.
    SomeValue(ShapeId),
    /// Applies qualified-value counting.
    Qualified(QualifiedValueShape),
    /// Restricts predicates allowed on a focus node.
    Closed {
        /// Predicates exempt from the closed-shape check.
        ignored_properties: Vec<NamedNode>,
        /// Whether predicates implied by type declarations are also allowed.
        by_types: bool,
    },
    /// Applies a shape to RDF reifiers of the value triple.
    ReifierShape {
        /// Shape that each reifier must satisfy.
        shape: ShapeId,
        /// Whether at least one reifier is required.
        required: bool,
    },
    /// Requires the value set to contain a specific RDF term.
    HasValue(Term),
    /// Restricts values to an explicit term set.
    In(Vec<Term>),
    /// Requires values to lie under one root class.
    RootClass(NamedNode),
    /// Requires values to lie under at least one root class.
    RootClasses(Vec<NamedNode>),
    /// Requires tuples of the named properties to be unique.
    UniqueValuesFor(Vec<NamedNode>),
    /// Requires a node expression to evaluate to effective boolean true.
    Expression(NodeExpression),
    /// Obtains the node to validate from a node expression.
    NodeByExpression(NodeExpression),
    #[cfg(feature = "sparql")]
    /// Executes a sandboxed SPARQL constraint.
    Sparql(crate::SparqlConstraint),
}

impl Constraint {
    #[cfg_attr(
        not(feature = "sparql"),
        expect(
            clippy::unnecessary_wraps,
            reason = "the SPARQL build returns None for custom constraint parameters"
        )
    )]
    pub(crate) fn parameter_local_name(&self) -> Option<&'static str> {
        Some(match self {
            Self::Class(_) | Self::Classes(_) => "class",
            Self::Datatype(_) | Self::Datatypes(_) => "datatype",
            Self::NodeKind(_) | Self::NodeKinds(_) => "nodeKind",
            Self::MinCount(_) => "minCount",
            Self::MaxCount(_) => "maxCount",
            Self::MinExclusive(_) => "minExclusive",
            Self::MinInclusive(_) => "minInclusive",
            Self::MaxExclusive(_) => "maxExclusive",
            Self::MaxInclusive(_) => "maxInclusive",
            Self::MinLength(_) => "minLength",
            Self::MaxLength(_) => "maxLength",
            Self::Pattern { .. } => "pattern",
            Self::SingleLine(_) => "singleLine",
            Self::LanguageIn(_) => "languageIn",
            Self::UniqueLang(_) => "uniqueLang",
            Self::MemberShape(_) => "memberShape",
            Self::MinListLength(_) => "minListLength",
            Self::MaxListLength(_) => "maxListLength",
            Self::UniqueMembers(_) => "uniqueMembers",
            Self::Equals(_) => "equals",
            Self::Disjoint(_) => "disjoint",
            Self::SubsetOf(_) => "subsetOf",
            Self::LessThan(_) => "lessThan",
            Self::LessThanOrEquals(_) => "lessThanOrEquals",
            Self::Not(_) => "not",
            Self::And(_) => "and",
            Self::Or(_) => "or",
            Self::Xone(_) => "xone",
            Self::Node(_) => "node",
            Self::Property(_) => "property",
            Self::SomeValue(_) => "someValue",
            Self::Qualified(_) => "qualifiedValueShape",
            Self::Closed { .. } => "closed",
            Self::ReifierShape { .. } => "reifierShape",
            Self::HasValue(_) => "hasValue",
            Self::In(_) => "in",
            Self::RootClass(_) | Self::RootClasses(_) => "rootClass",
            Self::UniqueValuesFor(_) => "uniqueValuesFor",
            Self::Expression(_) => "expression",
            Self::NodeByExpression(_) => "nodeByExpression",
            #[cfg(feature = "sparql")]
            Self::Sparql(constraint) if constraint.component().is_some() => return None,
            #[cfg(feature = "sparql")]
            Self::Sparql(_) => "sparql",
        })
    }

    /// Returns the IRI of the SHACL constraint component represented here.
    pub fn component_iri(&self) -> &str {
        #[cfg(feature = "sparql")]
        if let Self::Sparql(constraint) = self
            && let Some(component) = constraint.component()
        {
            return component.as_str();
        }
        let local = match self {
            Self::Class(_) | Self::Classes(_) => "ClassConstraintComponent",
            Self::Datatype(_) | Self::Datatypes(_) => "DatatypeConstraintComponent",
            Self::NodeKind(_) | Self::NodeKinds(_) => "NodeKindConstraintComponent",
            Self::MinCount(_) => "MinCountConstraintComponent",
            Self::MaxCount(_) => "MaxCountConstraintComponent",
            Self::MinExclusive(_) => "MinExclusiveConstraintComponent",
            Self::MinInclusive(_) => "MinInclusiveConstraintComponent",
            Self::MaxExclusive(_) => "MaxExclusiveConstraintComponent",
            Self::MaxInclusive(_) => "MaxInclusiveConstraintComponent",
            Self::MinLength(_) => "MinLengthConstraintComponent",
            Self::MaxLength(_) => "MaxLengthConstraintComponent",
            Self::Pattern { .. } => "PatternConstraintComponent",
            Self::SingleLine(_) => "SingleLineConstraintComponent",
            Self::LanguageIn(_) => "LanguageInConstraintComponent",
            Self::UniqueLang(_) => "UniqueLangConstraintComponent",
            Self::MemberShape(_) => "MemberShapeConstraintComponent",
            Self::MinListLength(_) => "MinListLengthConstraintComponent",
            Self::MaxListLength(_) => "MaxListLengthConstraintComponent",
            Self::UniqueMembers(_) => "UniqueMembersConstraintComponent",
            Self::Equals(_) => "EqualsConstraintComponent",
            Self::Disjoint(_) => "DisjointConstraintComponent",
            Self::SubsetOf(_) => "SubsetOfConstraintComponent",
            Self::LessThan(_) => "LessThanConstraintComponent",
            Self::LessThanOrEquals(_) => "LessThanOrEqualsConstraintComponent",
            Self::Not(_) => "NotConstraintComponent",
            Self::And(_) => "AndConstraintComponent",
            Self::Or(_) => "OrConstraintComponent",
            Self::Xone(_) => "XoneConstraintComponent",
            Self::Node(_) => "NodeConstraintComponent",
            Self::Property(_) => "PropertyConstraintComponent",
            Self::SomeValue(_) => "SomeValueConstraintComponent",
            Self::Qualified(_) => "QualifiedValueShapeConstraintComponent",
            Self::Closed { .. } => "ClosedConstraintComponent",
            Self::ReifierShape { .. } => "ReifierShapeConstraintComponent",
            Self::HasValue(_) => "HasValueConstraintComponent",
            Self::In(_) => "InConstraintComponent",
            Self::RootClass(_) | Self::RootClasses(_) => "RootClassConstraintComponent",
            Self::UniqueValuesFor(_) => "UniqueValuesForConstraintComponent",
            Self::Expression(_) => "ExpressionConstraintComponent",
            Self::NodeByExpression(_) => "NodeByExpressionConstraintComponent",
            #[cfg(feature = "sparql")]
            Self::Sparql(_) => "SPARQLConstraintComponent",
        };
        match local {
            "ClassConstraintComponent" => "http://www.w3.org/ns/shacl#ClassConstraintComponent",
            "DatatypeConstraintComponent" => {
                "http://www.w3.org/ns/shacl#DatatypeConstraintComponent"
            }
            "NodeKindConstraintComponent" => {
                "http://www.w3.org/ns/shacl#NodeKindConstraintComponent"
            }
            "MinCountConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MinCountConstraintComponent"
            }
            "MaxCountConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MaxCountConstraintComponent"
            }
            "MinExclusiveConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MinExclusiveConstraintComponent"
            }
            "MinInclusiveConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MinInclusiveConstraintComponent"
            }
            "MaxExclusiveConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MaxExclusiveConstraintComponent"
            }
            "MaxInclusiveConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MaxInclusiveConstraintComponent"
            }
            "MinLengthConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MinLengthConstraintComponent"
            }
            "MaxLengthConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MaxLengthConstraintComponent"
            }
            "PatternConstraintComponent" => "http://www.w3.org/ns/shacl#PatternConstraintComponent",
            "SingleLineConstraintComponent" => {
                "http://www.w3.org/ns/shacl#SingleLineConstraintComponent"
            }
            "LanguageInConstraintComponent" => {
                "http://www.w3.org/ns/shacl#LanguageInConstraintComponent"
            }
            "UniqueLangConstraintComponent" => {
                "http://www.w3.org/ns/shacl#UniqueLangConstraintComponent"
            }
            "MemberShapeConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MemberShapeConstraintComponent"
            }
            "MinListLengthConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MinListLengthConstraintComponent"
            }
            "MaxListLengthConstraintComponent" => {
                "http://www.w3.org/ns/shacl#MaxListLengthConstraintComponent"
            }
            "UniqueMembersConstraintComponent" => {
                "http://www.w3.org/ns/shacl#UniqueMembersConstraintComponent"
            }
            "EqualsConstraintComponent" => "http://www.w3.org/ns/shacl#EqualsConstraintComponent",
            "DisjointConstraintComponent" => {
                "http://www.w3.org/ns/shacl#DisjointConstraintComponent"
            }
            "SubsetOfConstraintComponent" => {
                "http://www.w3.org/ns/shacl#SubsetOfConstraintComponent"
            }
            "LessThanConstraintComponent" => {
                "http://www.w3.org/ns/shacl#LessThanConstraintComponent"
            }
            "LessThanOrEqualsConstraintComponent" => {
                "http://www.w3.org/ns/shacl#LessThanOrEqualsConstraintComponent"
            }
            "NotConstraintComponent" => "http://www.w3.org/ns/shacl#NotConstraintComponent",
            "AndConstraintComponent" => "http://www.w3.org/ns/shacl#AndConstraintComponent",
            "OrConstraintComponent" => "http://www.w3.org/ns/shacl#OrConstraintComponent",
            "XoneConstraintComponent" => "http://www.w3.org/ns/shacl#XoneConstraintComponent",
            "NodeConstraintComponent" => "http://www.w3.org/ns/shacl#NodeConstraintComponent",
            "PropertyConstraintComponent" => {
                "http://www.w3.org/ns/shacl#PropertyConstraintComponent"
            }
            "SomeValueConstraintComponent" => {
                "http://www.w3.org/ns/shacl#SomeValueConstraintComponent"
            }
            "QualifiedValueShapeConstraintComponent" => {
                "http://www.w3.org/ns/shacl#QualifiedValueShapeConstraintComponent"
            }
            "ClosedConstraintComponent" => "http://www.w3.org/ns/shacl#ClosedConstraintComponent",
            "ReifierShapeConstraintComponent" => {
                "http://www.w3.org/ns/shacl#ReifierShapeConstraintComponent"
            }
            "HasValueConstraintComponent" => {
                "http://www.w3.org/ns/shacl#HasValueConstraintComponent"
            }
            "InConstraintComponent" => "http://www.w3.org/ns/shacl#InConstraintComponent",
            "RootClassConstraintComponent" => {
                "http://www.w3.org/ns/shacl#RootClassConstraintComponent"
            }
            "UniqueValuesForConstraintComponent" => {
                "http://www.w3.org/ns/shacl#UniqueValuesForConstraintComponent"
            }
            "ExpressionConstraintComponent" => {
                "http://www.w3.org/ns/shacl#ExpressionConstraintComponent"
            }
            "NodeByExpressionConstraintComponent" => {
                "http://www.w3.org/ns/shacl#NodeByExpressionConstraintComponent"
            }
            "SPARQLConstraintComponent" => "http://www.w3.org/ns/shacl#SPARQLConstraintComponent",
            _ => unreachable!(),
        }
    }

    pub(crate) fn dependencies(&self) -> Vec<&ShapeId> {
        match self {
            Self::MemberShape(shape)
            | Self::Not(shape)
            | Self::Node(shape)
            | Self::Property(shape)
            | Self::SomeValue(shape)
            | Self::ReifierShape { shape, .. } => vec![shape],
            Self::And(shapes) | Self::Or(shapes) | Self::Xone(shapes) => shapes.iter().collect(),
            Self::Qualified(qualified) => vec![&qualified.shape],
            _ => Vec::new(),
        }
    }
}

pub(crate) fn literal_bool(literal: &Literal) -> Option<bool> {
    if literal.datatype().as_str() != "http://www.w3.org/2001/XMLSchema#boolean" {
        return None;
    }
    match literal.value() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}
