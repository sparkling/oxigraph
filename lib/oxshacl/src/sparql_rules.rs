use crate::ShapesGraph;
use crate::compile::apply_sparql_prefixes;
use crate::constraint::literal_bool;
use crate::control::{LimitKind, ValidationError, ValidationOptions};
use crate::model::{GraphSnapshot, ShapeId};
use crate::profile::{ProfileId, ProfileSet};
use crate::rules::RuleError;
use oxrdf::Term;
use oxsdatatypes::Decimal;
use spargebra::Query;
use std::collections::{BTreeMap, BTreeSet};

mod execution;
pub use self::execution::execute_sparql_rules;
#[cfg(test)]
mod tests;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RULE: &str = "http://www.w3.org/ns/shacl#Rule";
const SPARQL_RULE: &str = "http://www.w3.org/ns/shacl#SPARQLRule";
const RULES_GRAPH: &str = "http://www.w3.org/ns/shacl#RulesGraph";
const SH_RULE: &str = "http://www.w3.org/ns/shacl#rule";
const SH_CONSTRUCT: &str = "http://www.w3.org/ns/shacl#construct";
const SH_CONDITION: &str = "http://www.w3.org/ns/shacl#condition";
const SH_DEACTIVATED: &str = "http://www.w3.org/ns/shacl#deactivated";
const SH_ORDER: &str = "http://www.w3.org/ns/shacl#order";
const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";
const XSD_DECIMAL: &str = "http://www.w3.org/2001/XMLSchema#decimal";
const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";

/// A compiled, isolated set of SHACL-SPARQL CONSTRUCT rules.
#[derive(Clone, Debug)]
pub struct SparqlRuleSet {
    profiles: ProfileSet,
    shapes: ShapesGraph,
    rules: Vec<CompiledRule>,
}

#[derive(Clone, Debug)]
struct CompiledRule {
    id: String,
    query: Query,
    scope: Option<ShapeId>,
    scope_order: Decimal,
    conditions: Vec<ShapeId>,
    order: Decimal,
    deactivated: bool,
}

impl SparqlRuleSet {
    /// Compiles SHACL-SPARQL `CONSTRUCT` rules from a shapes graph.
    ///
    /// Rule discovery, ordering, conditions, query size, and selected profiles
    /// are validated before the executable rule set is returned.
    pub fn compile(
        source: &GraphSnapshot,
        profiles: ProfileSet,
        options: &ValidationOptions,
    ) -> Result<Self, RuleError> {
        require_profiles(&profiles)?;
        check_rules_graph_subjects(source)?;
        if source.triple_count() > options.limits.max_shape_quads {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ShapeQuads,
                limit: options.limits.max_shape_quads,
            }
            .into());
        }
        let shapes = ShapesGraph::compile(source, profiles.clone(), options)?;
        let attachments = attachments(source)?;
        let mut nodes = typed_rule_nodes(source);
        nodes.extend(attachments.keys().cloned());
        if nodes.is_empty() {
            return Err(RuleError::IllFormed(
                "a SHACL-SPARQL rule set must contain at least one rule".to_owned(),
            ));
        }
        let mut rules = Vec::new();
        for node_key in nodes {
            let node = find_node(source, &node_key).ok_or_else(|| {
                RuleError::IllFormed(format!("rule node `{node_key}` is unavailable"))
            })?;
            let scopes = attachments.get(&node_key).cloned().unwrap_or_default();
            let template = compile_rule(source, &node, options)?;
            if scopes.is_empty() {
                if !template.conditions.is_empty() {
                    return Err(ValidationError::UnsupportedFeature(
                        "sh:condition on a global rule has no focus node".to_owned(),
                    )
                    .into());
                }
                rules.push(template);
            } else {
                for scope in scopes {
                    let mut attached = template.clone();
                    attached.id = format!("{}@{scope}", attached.id);
                    attached.scope_order = parse_order(source, &scope)?;
                    attached.scope = Some(scope);
                    rules.push(attached);
                }
            }
        }
        for rule in &rules {
            for condition in &rule.conditions {
                if shapes.shape(condition).is_none() {
                    return Err(RuleError::IllFormed(format!(
                        "sh:condition `{condition}` is not a well-formed compiled shape"
                    )));
                }
            }
        }
        rules.sort_by(|left, right| {
            left.scope
                .is_some()
                .cmp(&right.scope.is_some())
                .then_with(|| left.scope_order.cmp(&right.scope_order))
                .then_with(|| {
                    left.scope
                        .as_ref()
                        .map(ToString::to_string)
                        .cmp(&right.scope.as_ref().map(ToString::to_string))
                })
                .then_with(|| left.order.cmp(&right.order))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(Self {
            profiles,
            shapes,
            rules,
        })
    }

    /// Returns the implementation profiles used to compile the rules.
    pub fn profiles(&self) -> &ProfileSet {
        &self.profiles
    }

    /// Returns the number of compiled rule attachments.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Returns whether no rules were compiled.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

fn check_rules_graph_subjects(source: &GraphSnapshot) -> Result<(), RuleError> {
    if source.triples().any(|triple| {
        triple.predicate.as_str() == RDF_TYPE
            && matches!(
                &triple.object,
                Term::NamedNode(class) if class.as_str() == RULES_GRAPH
            )
            && !matches!(triple.subject, ShapeId::NamedNode(_))
    }) {
        return Err(RuleError::IllFormed(
            "rdf:type sh:RulesGraph subjects must be IRIs".to_owned(),
        ));
    }
    Ok(())
}

fn compile_rule(
    source: &GraphSnapshot,
    node: &ShapeId,
    options: &ValidationOptions,
) -> Result<CompiledRule, RuleError> {
    let types = objects(source, node, RDF_TYPE)
        .into_iter()
        .filter_map(|term| match term {
            Term::NamedNode(node) => Some(node),
            _ => None,
        })
        .collect::<Vec<_>>();
    if types.is_empty() {
        return Err(RuleError::IllFormed(
            "each SHACL rule must have at least one IRI rdf:type".to_owned(),
        ));
    }
    if !types
        .iter()
        .any(|class| class_reaches(source, class, SPARQL_RULE))
    {
        return Err(ValidationError::UnsupportedFeature(format!(
            "rule `{node}` has no supported sh:SPARQLRule type"
        ))
        .into());
    }
    let construct = exactly_one(source, node, SH_CONSTRUCT)?;
    let Term::Literal(construct) = construct else {
        return Err(RuleError::IllFormed(
            "sh:construct must be a literal".to_owned(),
        ));
    };
    if construct.datatype().as_str() != XSD_STRING {
        return Err(RuleError::IllFormed(
            "sh:construct must be an xsd:string literal".to_owned(),
        ));
    }
    let query_text = apply_sparql_prefixes(source, node, construct.value())?;
    if query_text.len() > options.limits.max_query_bytes {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::QueryBytes,
            limit: options.limits.max_query_bytes,
        }
        .into());
    }
    let query = crate::sparql::parse_construct_policy(&query_text)?;
    let conditions = objects(source, node, SH_CONDITION)
        .into_iter()
        .map(|term| {
            as_node(term).ok_or_else(|| {
                RuleError::IllFormed("sh:condition must reference a shape node".to_owned())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let order = parse_order(source, node)?;
    let deactivated = optional_one(source, node, SH_DEACTIVATED)?
        .map(|term| match term {
            Term::Literal(literal) if literal.datatype().as_str() == XSD_BOOLEAN => {
                literal_bool(&literal).ok_or_else(|| {
                    RuleError::IllFormed("sh:deactivated must be xsd:boolean".to_owned())
                })
            }
            _ => Err(RuleError::IllFormed(
                "sh:deactivated must be an xsd:boolean literal".to_owned(),
            )),
        })
        .transpose()?
        .unwrap_or(false);
    Ok(CompiledRule {
        id: node.to_string(),
        query,
        scope: None,
        scope_order: Decimal::default(),
        conditions,
        order,
        deactivated,
    })
}

fn attachments(source: &GraphSnapshot) -> Result<BTreeMap<String, Vec<ShapeId>>, RuleError> {
    let mut output = BTreeMap::<String, Vec<ShapeId>>::new();
    for triple in source
        .triples()
        .filter(|triple| triple.predicate.as_str() == SH_RULE)
    {
        if !matches!(triple.subject, ShapeId::NamedNode(_)) {
            return Err(RuleError::IllFormed(
                "subjects of sh:rule triples must be IRIs".to_owned(),
            ));
        }
        let rule = as_node(triple.object).ok_or_else(|| {
            RuleError::IllFormed("sh:rule must reference an IRI or blank node".to_owned())
        })?;
        output
            .entry(rule.to_string())
            .or_default()
            .push(triple.subject);
    }
    Ok(output)
}

fn typed_rule_nodes(source: &GraphSnapshot) -> BTreeSet<String> {
    source
        .triples()
        .filter(|triple| {
            triple.predicate.as_str() == RDF_TYPE
                && matches!(
                    &triple.object,
                    Term::NamedNode(node)
                        if class_reaches(source, node, RULE)
                            || class_reaches(source, node, SPARQL_RULE)
                )
        })
        .map(|triple| triple.subject.to_string())
        .collect()
}

fn class_reaches(source: &GraphSnapshot, class: &oxrdf::NamedNode, target: &str) -> bool {
    let mut active = vec![class.clone()];
    let mut seen = BTreeSet::new();
    while let Some(class) = active.pop() {
        if class.as_str() == target || (target == RULE && class.as_str() == SPARQL_RULE) {
            return true;
        }
        if !seen.insert(class.as_str().to_owned()) {
            continue;
        }
        for triple in source.triples() {
            if triple.predicate.as_str() == RDFS_SUBCLASS
                && triple.subject.to_string() == class.to_string()
                && let Term::NamedNode(parent) = triple.object
            {
                active.push(parent);
            }
        }
    }
    false
}

fn find_node(source: &GraphSnapshot, key: &str) -> Option<ShapeId> {
    source
        .triples()
        .find_map(|triple| (triple.subject.to_string() == key).then_some(triple.subject))
}

fn objects(source: &GraphSnapshot, subject: &ShapeId, predicate: &str) -> Vec<Term> {
    let key = subject.to_string();
    source
        .triples()
        .filter(|triple| {
            triple.subject.to_string() == key && triple.predicate.as_str() == predicate
        })
        .map(|triple| triple.object)
        .collect()
}

fn exactly_one(
    source: &GraphSnapshot,
    subject: &ShapeId,
    predicate: &str,
) -> Result<Term, RuleError> {
    let values = objects(source, subject, predicate);
    match values.as_slice() {
        [value] => Ok(value.clone()),
        _ => Err(RuleError::IllFormed(format!(
            "`{subject}` must have exactly one <{predicate}> value"
        ))),
    }
}

fn optional_one(
    source: &GraphSnapshot,
    subject: &ShapeId,
    predicate: &str,
) -> Result<Option<Term>, RuleError> {
    let values = objects(source, subject, predicate);
    match values.as_slice() {
        [] => Ok(None),
        [value] => Ok(Some(value.clone())),
        _ => Err(RuleError::IllFormed(format!(
            "`{subject}` must have at most one <{predicate}> value"
        ))),
    }
}

fn parse_order(source: &GraphSnapshot, subject: &ShapeId) -> Result<Decimal, RuleError> {
    optional_one(source, subject, SH_ORDER)?
        .map(|term| match term {
            Term::Literal(literal)
                if matches!(literal.datatype().as_str(), XSD_DECIMAL | XSD_INTEGER) =>
            {
                literal.value().parse::<Decimal>().map_err(|_| {
                    RuleError::IllFormed(
                        "sh:order must be a valid xsd:decimal or xsd:integer".to_owned(),
                    )
                })
            }
            _ => Err(RuleError::IllFormed(
                "sh:order must be an xsd:decimal or xsd:integer literal".to_owned(),
            )),
        })
        .transpose()
        .map(Option::unwrap_or_default)
}

fn as_node(term: Term) -> Option<ShapeId> {
    #[allow(
        unreachable_patterns,
        reason = "dependency feature unification may expose RDF 1.2 triple terms"
    )]
    match term {
        Term::NamedNode(node) => Some(node.into()),
        Term::BlankNode(node) => Some(node.into()),
        Term::Literal(_) => None,
        _ => None,
    }
}

fn require_profiles(profiles: &ProfileSet) -> Result<(), RuleError> {
    if !profiles.contains(ProfileId::Rules12Subset20260727)
        || !profiles.contains(ProfileId::SparqlExtensions12Subset20260130)
    {
        return Err(RuleError::Profile(
            "SHACL-SPARQL rules require both Rules and SPARQL profiles".to_owned(),
        ));
    }
    Ok(())
}
