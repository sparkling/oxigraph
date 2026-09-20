#[cfg(not(feature = "rdf-12"))]
use crate::srl::{SrlBodyElement, SrlExpression, rules};
use crate::srl::{SrlConstant, SrlError, SrlNode, SrlPredicate, SrlRuleSet};

#[cfg_attr(
    feature = "rdf-12",
    expect(
        clippy::unnecessary_wraps,
        reason = "the shared preflight signature remains fallible when rdf-12 is disabled"
    )
)]
pub(super) fn reject_unimplemented_constructs(rule_set: &SrlRuleSet) -> Result<(), SrlError> {
    #[cfg(not(feature = "rdf-12"))]
    if rules(rule_set).any(|rule| body_requires_rdf12(&rule.body)) {
        return Err(SrlError::Unsupported(
            "SRL triple terms, reification, and annotations require the `rdf-12` crate feature"
                .to_owned(),
        ));
    }
    #[cfg(feature = "rdf-12")]
    let _: &SrlRuleSet = rule_set;
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
fn body_requires_rdf12(body: &[SrlBodyElement]) -> bool {
    body.iter().any(|element| match element {
        SrlBodyElement::Triple(triple) => {
            node_requires_rdf12(&triple.subject)
                || predicate_requires_rdf12(&triple.predicate)
                || node_requires_rdf12(&triple.object)
        }
        SrlBodyElement::Filter(expression) | SrlBodyElement::Assignment { expression, .. } => {
            expression_requires_rdf12(expression)
        }
        SrlBodyElement::Negation { body, .. } => body_requires_rdf12(body),
    })
}

#[cfg(not(feature = "rdf-12"))]
fn expression_requires_rdf12(expression: &SrlExpression) -> bool {
    match expression {
        SrlExpression::Node(node) => node_requires_rdf12(node),
        SrlExpression::Unary { operand, .. } => expression_requires_rdf12(operand),
        SrlExpression::Binary { left, right, .. } => {
            expression_requires_rdf12(left) || expression_requires_rdf12(right)
        }
        SrlExpression::In { value, values, .. } => {
            expression_requires_rdf12(value) || values.iter().any(expression_requires_rdf12)
        }
        SrlExpression::Call { arguments, .. } => arguments.iter().any(expression_requires_rdf12),
    }
}

#[cfg(not(feature = "rdf-12"))]
fn predicate_requires_rdf12(predicate: &SrlPredicate) -> bool {
    match predicate {
        SrlPredicate::Node(node) => node_requires_rdf12(node),
        SrlPredicate::Path(_) => false,
    }
}

#[cfg(not(feature = "rdf-12"))]
fn node_requires_rdf12(node: &SrlNode) -> bool {
    match node {
        SrlNode::Collection { values, .. } => values.iter().any(node_requires_rdf12),
        SrlNode::PropertyList { properties, .. } => properties.iter().any(|property| {
            predicate_requires_rdf12(&property.predicate)
                || property.objects.iter().any(node_requires_rdf12)
        }),
        SrlNode::Reified { .. } | SrlNode::TripleTerm(_) | SrlNode::Annotated { .. } => true,
        SrlNode::Variable(_) | SrlNode::Constant(_) | SrlNode::GeneratedBlankNode(_) => false,
    }
}

pub(super) fn reject_query_goal(goal: &crate::srl::SrlTriple) -> Result<(), SrlError> {
    reject_goal_node(&goal.subject, GoalPosition::Subject)?;
    let SrlPredicate::Node(predicate) = &goal.predicate else {
        return Err(query_goal_error("property paths"));
    };
    reject_goal_node(predicate, GoalPosition::Predicate)?;
    reject_goal_node(&goal.object, GoalPosition::Object)
}

#[derive(Clone, Copy)]
enum GoalPosition {
    Subject,
    Predicate,
    Object,
}

fn reject_goal_node(node: &SrlNode, position: GoalPosition) -> Result<(), SrlError> {
    match node {
        SrlNode::Variable(_) | SrlNode::Constant(SrlConstant::Iri(_)) => Ok(()),
        SrlNode::Constant(SrlConstant::BlankNode(_) | SrlConstant::Nil)
            if !matches!(position, GoalPosition::Predicate) =>
        {
            Ok(())
        }
        SrlNode::Constant(
            SrlConstant::Literal { .. } | SrlConstant::Boolean(_) | SrlConstant::Numeric { .. },
        ) if matches!(position, GoalPosition::Object) => Ok(()),
        SrlNode::TripleTerm(triple) if !matches!(position, GoalPosition::Predicate) => {
            reject_query_goal(triple)
        }
        SrlNode::Constant(_)
        | SrlNode::GeneratedBlankNode(_)
        | SrlNode::Collection { .. }
        | SrlNode::PropertyList { .. }
        | SrlNode::Reified { .. }
        | SrlNode::TripleTerm(_)
        | SrlNode::Annotated { .. } => Err(query_goal_error(
            "non-RDF terms, abbreviation nodes, or an invalid RDF triple position",
        )),
    }
}

fn query_goal_error(detail: &str) -> SrlError {
    SrlError::Unsupported(format!(
        "Rules QUERY goal must be one abstract triple pattern without {detail}"
    ))
}
