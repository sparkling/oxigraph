use crate::srl::{SrlBodyElement, SrlConstant, SrlError, SrlNode, SrlPredicate, SrlRuleSet, rules};

pub(super) fn reject_draft_open_constructs(rule_set: &SrlRuleSet) -> Result<(), SrlError> {
    for source in rules(rule_set) {
        if source.for_clause.is_some() {
            return Err(SrlError::Unsupported(
                "FOR/IN shape integration remains draft issue #1074".to_owned(),
            ));
        }
        if source.data_only {
            return Err(SrlError::Unsupported(
                "WHERE DATA matching remains draft issue #960".to_owned(),
            ));
        }
        if contains_data_negation(&source.body) {
            return Err(SrlError::Unsupported(
                "NOT DATA matching remains draft issue #960".to_owned(),
            ));
        }
        reject_body_abbreviations(&source.body)?;
    }
    Ok(())
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

fn contains_data_negation(body: &[SrlBodyElement]) -> bool {
    body.iter().any(|element| match element {
        SrlBodyElement::Negation {
            data_only: true, ..
        } => true,
        SrlBodyElement::Negation { body, .. } => contains_data_negation(body),
        SrlBodyElement::Triple(_)
        | SrlBodyElement::Filter(_)
        | SrlBodyElement::Assignment { .. } => false,
    })
}

fn reject_body_abbreviations(body: &[SrlBodyElement]) -> Result<(), SrlError> {
    for element in body {
        match element {
            SrlBodyElement::Triple(triple) => {
                reject_pattern_node(&triple.subject)?;
                if let SrlPredicate::Node(predicate) = &triple.predicate {
                    reject_pattern_node(predicate)?;
                }
                reject_pattern_node(&triple.object)?;
            }
            SrlBodyElement::Negation { body, .. } => reject_body_abbreviations(body)?,
            SrlBodyElement::Filter(_) | SrlBodyElement::Assignment { .. } => {}
        }
    }
    Ok(())
}

fn reject_pattern_node(node: &SrlNode) -> Result<(), SrlError> {
    match node {
        SrlNode::Variable(_)
        | SrlNode::Constant(
            SrlConstant::Iri(_)
            | SrlConstant::Literal { .. }
            | SrlConstant::Boolean(_)
            | SrlConstant::Numeric { .. }
            | SrlConstant::Nil,
        ) => Ok(()),
        SrlNode::TripleTerm(triple) => {
            reject_pattern_node(&triple.subject)?;
            if let SrlPredicate::Node(predicate) = &triple.predicate {
                reject_pattern_node(predicate)?;
            }
            reject_pattern_node(&triple.object)
        }
        SrlNode::Constant(SrlConstant::BlankNode(_))
        | SrlNode::GeneratedBlankNode(_)
        | SrlNode::Collection { .. }
        | SrlNode::PropertyList { .. }
        | SrlNode::Reified { .. }
        | SrlNode::Annotated { .. } => Err(SrlError::Unsupported(
            "blank nodes and abbreviation nodes in SRL body patterns".to_owned(),
        )),
    }
}
