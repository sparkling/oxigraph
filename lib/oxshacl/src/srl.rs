//! Shape Rules Language (SRL) parsing, checking, and bounded evaluation.

mod check;
mod evaluate;
mod imports;
mod lexer;
mod parser;
#[cfg(test)]
mod tests;

use crate::profile::{ProfileId, ProfileSet};
use oxrdf::Term;
use std::collections::BTreeSet;

pub use self::evaluate::{
    SrlExecution, execute_srl_rules, execute_srl_rules_with_imports, query_srl_rules,
    query_srl_rules_with_imports,
};
pub use self::imports::SrlImportResolver;

/// A ground constant in a parsed Shape Rules Language document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlConstant {
    /// An absolute IRI.
    Iri(String),
    /// An RDF literal.
    Literal {
        /// Literal lexical form.
        lexical: String,
        /// Optional BCP 47 language tag.
        language: Option<String>,
        /// Optional base-direction token (`ltr` or `rtl`).
        direction: Option<String>,
        /// Optional datatype IRI.
        datatype: Option<String>,
    },
    /// A source-labeled blank node.
    BlankNode(String),
    /// A boolean literal.
    Boolean(bool),
    /// A numeric literal preserved in lexical form.
    Numeric {
        /// Numeric lexical form.
        lexical: String,
        /// Numeric datatype IRI.
        datatype: &'static str,
    },
    /// The `rdf:nil` constant.
    Nil,
}

/// A node term or structured node constructor in SRL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlNode {
    /// A rule variable.
    Variable(String),
    /// A ground RDF constant.
    Constant(SrlConstant),
    /// A parser-scoped generated blank node.
    GeneratedBlankNode(u64),
    /// An RDF collection constructor.
    Collection {
        /// Parser-scoped constructor identifier.
        id: u64,
        /// Collection members in source order.
        values: Vec<SrlNode>,
    },
    /// A blank-node property-list constructor.
    PropertyList {
        /// Parser-scoped constructor identifier.
        id: u64,
        /// Properties attached to the generated node.
        properties: Vec<SrlProperty>,
    },
    /// An RDF 1.2 reification constructor.
    Reified {
        /// Parser-scoped constructor identifier.
        id: u64,
        /// Triple being reified.
        triple: Box<SrlTriple>,
        /// Explicit reifier, or `None` for a generated reifier.
        reifier: Option<Box<SrlNode>>,
    },
    /// An RDF 1.2 triple term.
    TripleTerm(Box<SrlTriple>),
    /// A node carrying annotation blocks.
    Annotated {
        /// Parser-scoped annotation identifier.
        id: u64,
        /// Annotated node value.
        value: Box<SrlNode>,
        /// Annotation blocks applied to the value.
        annotations: Vec<SrlAnnotation>,
    },
}

/// One SRL annotation block.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlAnnotation {
    /// Explicit reifier, or `None` for an automatically generated reifier.
    pub reifier: Option<SrlNode>,
    /// Properties asserted about the reifier.
    pub properties: Vec<SrlProperty>,
}

/// Predicate and object list in an SRL property list.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlProperty {
    /// Predicate or property path.
    pub predicate: SrlPredicate,
    /// Objects associated with the predicate.
    pub objects: Vec<SrlNode>,
}

/// A direct predicate node or an SRL path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlPredicate {
    /// Direct predicate node.
    Node(SrlNode),
    /// Ordered property-path elements.
    Path(Vec<SrlPathElement>),
}

/// One forward or inverse IRI step in an SRL property path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlPathElement {
    /// Whether the step is traversed in the inverse direction.
    pub inverse: bool,
    /// Predicate IRI for the step.
    pub iri: String,
}

/// Subject-predicate-object pattern or template in SRL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlTriple {
    /// Triple subject.
    pub subject: SrlNode,
    /// Triple predicate or property path.
    pub predicate: SrlPredicate,
    /// Triple object.
    pub object: SrlNode,
}

/// An SRL filter or assignment expression.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlExpression {
    /// A node-valued expression.
    Node(SrlNode),
    /// A unary operation.
    Unary {
        /// Unary operator.
        operator: SrlUnaryOperator,
        /// Operand expression.
        operand: Box<SrlExpression>,
    },
    /// A binary operation.
    Binary {
        /// Binary operator.
        operator: SrlBinaryOperator,
        /// Left operand.
        left: Box<SrlExpression>,
        /// Right operand.
        right: Box<SrlExpression>,
    },
    /// An `IN` or `NOT IN` membership test.
    In {
        /// Value being tested.
        value: Box<SrlExpression>,
        /// Candidate values.
        values: Vec<SrlExpression>,
        /// Whether this represents `NOT IN`.
        negated: bool,
    },
    /// A function call.
    Call {
        /// Function IRI or supported built-in name.
        function: String,
        /// Argument expressions in source order.
        arguments: Vec<SrlExpression>,
    },
}

/// Unary operators supported by SRL expressions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SrlUnaryOperator {
    /// Logical negation.
    Not,
    /// Unary numeric plus.
    Plus,
    /// Unary numeric minus.
    Minus,
}

/// Binary operators supported by SRL expressions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SrlBinaryOperator {
    /// Logical disjunction.
    Or,
    /// Logical conjunction.
    And,
    /// RDF-term or value equality.
    Equal,
    /// RDF-term or value inequality.
    NotEqual,
    /// Less-than comparison.
    Less,
    /// Greater-than comparison.
    Greater,
    /// Less-than-or-equal comparison.
    LessOrEqual,
    /// Greater-than-or-equal comparison.
    GreaterOrEqual,
    /// Numeric addition.
    Add,
    /// Numeric subtraction.
    Subtract,
    /// Numeric multiplication.
    Multiply,
    /// Numeric division.
    Divide,
}

/// One clause in an SRL rule body.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlBodyElement {
    /// Positive triple pattern.
    Triple(SrlTriple),
    /// Filter expression that must evaluate to true.
    Filter(SrlExpression),
    /// Negated nested body.
    Negation {
        /// Whether matching is restricted to the input data graph.
        data_only: bool,
        /// Conjunctive body whose existence is negated.
        body: Vec<SrlBodyElement>,
    },
    /// Variable assignment.
    Assignment {
        /// Variable receiving the expression result.
        variable: String,
        /// Expression to evaluate.
        expression: SrlExpression,
    },
}

/// A parsed SRL inference rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlRule {
    /// Optional source rule identifier.
    pub id: Option<String>,
    /// Triple templates produced by successful bindings.
    pub head: Vec<SrlTriple>,
    /// Rule body evaluated as a conjunction.
    pub body: Vec<SrlBodyElement>,
    /// Optional `FOR` variable and class IRI.
    pub for_clause: Option<(String, String)>,
    /// Whether the whole rule reads only from the input data graph.
    pub data_only: bool,
}

/// A top-level rule or inline data block in an SRL document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SrlItem {
    /// Executable rule.
    Rule(SrlRule),
    /// Ground triples supplied as document-local data.
    Data(Vec<SrlTriple>),
}

/// Parsed SRL document with profile and import metadata.
#[derive(Clone, Debug)]
pub struct SrlRuleSet {
    profiles: ProfileSet,
    items: Vec<SrlItem>,
    item_scopes: Vec<usize>,
    imports: Vec<String>,
    versions: Vec<String>,
    semantic_extensions: BTreeSet<String>,
}

impl SrlRuleSet {
    /// Parses an SRL document.
    ///
    /// `base_iri` resolves relative IRIs. The dated SHACL Rules profile must be
    /// present in `profiles`.
    pub fn parse(
        source: &str,
        base_iri: Option<&str>,
        profiles: ProfileSet,
    ) -> Result<Self, SrlError> {
        if !profiles.contains(ProfileId::Rules12Subset20260727) {
            return Err(SrlError::Profile(
                "SRL parsing requires the dated SHACL 1.2 Rules profile".to_owned(),
            ));
        }
        parser::parse(source, base_iri, profiles)
    }

    /// Returns top-level rules and data blocks in source order.
    pub fn items(&self) -> &[SrlItem] {
        &self.items
    }

    /// Returns declared import IRIs.
    pub fn imports(&self) -> &[String] {
        &self.imports
    }

    /// Returns declared SRL version identifiers.
    pub fn versions(&self) -> &[String] {
        &self.versions
    }

    /// Returns the implementation profiles selected for this document.
    pub fn profiles(&self) -> &ProfileSet {
        &self.profiles
    }

    /// Returns declared semantic-extension IRIs.
    pub fn semantic_extensions(&self) -> &BTreeSet<String> {
        &self.semantic_extensions
    }

    /// Checks the parsed document's static well-formedness constraints.
    pub fn check_well_formed(&self) -> Result<(), SrlError> {
        check::well_formed(self)
    }

    /// Checks well-formedness and computes a safe evaluation stratification.
    pub fn stratification(&self) -> Result<SrlStratification, SrlError> {
        self.check_well_formed()?;
        check::stratify(self)
    }
}

/// Rule indexes assigned to one evaluation stratum.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlStratum {
    /// Rules evaluated exactly once in this stratum.
    pub once: Vec<usize>,
    /// Rules iterated to a fixpoint in this stratum.
    pub general: Vec<usize>,
}

/// Dependency-safe evaluation order for a well-formed SRL document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SrlStratification {
    /// Strata in evaluation order.
    pub strata: Vec<SrlStratum>,
}

/// Failure while parsing, checking, or executing SRL.
#[derive(Debug, thiserror::Error)]
pub enum SrlError {
    /// The selected profiles do not permit SRL processing.
    #[error("SHACL Rules profile error: {0}")]
    Profile(String),
    /// A source-level syntax error.
    #[error("SRL syntax error at line {line}, column {column}: {message}")]
    Syntax {
        /// One-based source line.
        line: usize,
        /// One-based source column.
        column: usize,
        /// Human-readable parser diagnostic.
        message: String,
    },
    /// A parsed rule violates a static well-formedness constraint.
    #[error("ill-formed SRL rule: {0}")]
    WellFormed(String),
    /// Rule dependencies cannot be safely stratified.
    #[error("SRL rule set is not stratifiable: {0}")]
    Stratification(String),
    /// The document uses syntax or semantics outside the supported subset.
    #[error("SRL execution does not define support for {0}")]
    Unsupported(String),
    /// A query or execution requested an invalid result-graph mode.
    #[error("SRL result graph mismatch: {0}")]
    ResultGraph(String),
    /// A validation budget or processor control failed.
    #[error(transparent)]
    Validation(#[from] crate::ValidationError),
    /// Datalog evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] oxdatalog::rdf::RdfEvaluationError),
}

impl SrlNode {
    fn variables(&self, output: &mut BTreeSet<String>) {
        match self {
            Self::Variable(variable) => {
                output.insert(variable.clone());
            }
            Self::Collection { values, .. } => {
                for value in values {
                    value.variables(output);
                }
            }
            Self::PropertyList { properties, .. } => {
                properties_variables(properties, output);
            }
            Self::Reified {
                triple, reifier, ..
            } => {
                triple.variables(output);
                if let Some(reifier) = reifier {
                    reifier.variables(output);
                }
            }
            Self::TripleTerm(triple) => triple.variables(output),
            Self::Annotated {
                value, annotations, ..
            } => {
                value.variables(output);
                for annotation in annotations {
                    if let Some(reifier) = &annotation.reifier {
                        reifier.variables(output);
                    }
                    properties_variables(&annotation.properties, output);
                }
            }
            Self::Constant(_) | Self::GeneratedBlankNode(_) => {}
        }
    }

    fn contains_generated_blank(&self) -> bool {
        match self {
            Self::GeneratedBlankNode(_)
            | Self::PropertyList { .. }
            | Self::Collection { .. }
            | Self::Constant(SrlConstant::BlankNode(_)) => true,
            Self::Reified {
                triple, reifier, ..
            } => {
                reifier.is_none()
                    || triple.contains_generated_blank()
                    || reifier
                        .as_deref()
                        .is_some_and(Self::contains_generated_blank)
            }
            Self::TripleTerm(triple) => triple.contains_generated_blank(),
            Self::Annotated {
                value, annotations, ..
            } => {
                value.contains_generated_blank()
                    || annotations.iter().any(|annotation| {
                        annotation.reifier.is_none()
                            || annotation
                                .reifier
                                .as_ref()
                                .is_some_and(Self::contains_generated_blank)
                            || annotation
                                .properties
                                .iter()
                                .flat_map(|property| &property.objects)
                                .any(Self::contains_generated_blank)
                    })
            }
            Self::Variable(_) | Self::Constant(_) => false,
        }
    }

    fn as_term(&self) -> Result<Term, SrlError> {
        match self {
            Self::Constant(SrlConstant::Iri(iri)) => oxrdf::NamedNode::new(iri.clone())
                .map(Term::from)
                .map_err(|error| SrlError::Unsupported(error.to_string())),
            Self::Constant(SrlConstant::BlankNode(label)) => oxrdf::BlankNode::new(label.clone())
                .map(Term::from)
                .map_err(|error| SrlError::Unsupported(error.to_string())),
            Self::Constant(SrlConstant::Literal {
                lexical,
                language: None,
                direction: None,
                datatype: None,
            }) => Ok(oxrdf::Literal::new_simple_literal(lexical.clone()).into()),
            Self::Constant(SrlConstant::Literal {
                lexical,
                language: None,
                direction: None,
                datatype: Some(datatype),
            }) => oxrdf::Literal::try_new_typed_literal(
                lexical.clone(),
                oxrdf::NamedNode::new_unchecked(datatype.clone()),
            )
            .map(Term::from)
            .map_err(|error| SrlError::Unsupported(error.to_string())),
            Self::Constant(SrlConstant::Literal {
                lexical,
                language: Some(language),
                direction: None,
                datatype: None,
            }) => oxrdf::Literal::new_language_tagged_literal(lexical.clone(), language.clone())
                .map(Term::from)
                .map_err(|error| SrlError::Unsupported(error.to_string())),
            #[cfg(feature = "rdf-12")]
            Self::Constant(SrlConstant::Literal {
                lexical,
                language: Some(language),
                direction: Some(direction),
                datatype: None,
            }) => {
                let direction = match direction.as_str() {
                    "ltr" => oxrdf::BaseDirection::Ltr,
                    "rtl" => oxrdf::BaseDirection::Rtl,
                    _ => {
                        return Err(SrlError::Unsupported(
                            "invalid directional literal direction".to_owned(),
                        ));
                    }
                };
                oxrdf::Literal::new_directional_language_tagged_literal(
                    lexical.clone(),
                    language.clone(),
                    direction,
                )
                .map(Term::from)
                .map_err(|error| SrlError::Unsupported(error.to_string()))
            }
            Self::Constant(SrlConstant::Boolean(value)) => Ok(oxrdf::Literal::from(*value).into()),
            Self::Constant(SrlConstant::Numeric { lexical, datatype }) => {
                Ok(oxrdf::Literal::new_typed_literal(
                    lexical.clone(),
                    oxrdf::NamedNode::new_unchecked(*datatype),
                )
                .into())
            }
            Self::Constant(SrlConstant::Nil) => Ok(oxrdf::NamedNode::new_unchecked(
                "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
            )
            .into()),
            _ => Err(SrlError::Unsupported(
                "this SRL node cannot be lowered to a ground RDF term".to_owned(),
            )),
        }
    }
}

impl SrlTriple {
    fn variables(&self, output: &mut BTreeSet<String>) {
        self.subject.variables(output);
        if let SrlPredicate::Node(predicate) = &self.predicate {
            predicate.variables(output);
        }
        self.object.variables(output);
    }

    fn contains_generated_blank(&self) -> bool {
        self.subject.contains_generated_blank()
            || self.object.contains_generated_blank()
            || matches!(&self.predicate, SrlPredicate::Node(node) if node.contains_generated_blank())
    }
}

impl SrlExpression {
    fn variables(&self, output: &mut BTreeSet<String>) {
        match self {
            Self::Node(node) => node.variables(output),
            Self::Unary { operand, .. } => operand.variables(output),
            Self::Binary { left, right, .. } => {
                left.variables(output);
                right.variables(output);
            }
            Self::In { value, values, .. } => {
                value.variables(output);
                for item in values {
                    item.variables(output);
                }
            }
            Self::Call { arguments, .. } => {
                for argument in arguments {
                    argument.variables(output);
                }
            }
        }
    }
}

fn properties_variables(properties: &[SrlProperty], output: &mut BTreeSet<String>) {
    for property in properties {
        if let SrlPredicate::Node(predicate) = &property.predicate {
            predicate.variables(output);
        }
        for object in &property.objects {
            object.variables(output);
        }
    }
}

fn rules(rule_set: &SrlRuleSet) -> impl Iterator<Item = &SrlRule> {
    rule_set.items.iter().filter_map(|item| match item {
        SrlItem::Rule(rule) => Some(rule),
        SrlItem::Data(_) => None,
    })
}
