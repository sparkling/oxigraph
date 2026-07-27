use crate::evaluator::TestEvaluator;
use crate::files::{guess_rdf_format, load_graph};
use crate::manifest::Test;
#[cfg(feature = "rdf-12")]
use crate::semantic_json::{json_equal, json_is_valid};
use anyhow::{Context, Result, ensure};
use oxigraph::model::vocab::{rdf, xsd};
use oxigraph::model::{
    BlankNode, Dataset, Graph, GraphName, Literal, NamedNode, NamedOrBlankNode, Term, Triple,
};
use oxrdfs::{Rdfs12Finite, Rdfs12Options};
use std::collections::{HashMap, HashSet};

const POSITIVE_ENTAILMENT: &str =
    "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#PositiveEntailmentTest";
const NEGATIVE_ENTAILMENT: &str =
    "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#NegativeEntailmentTest";

pub fn register_semantic_tests(evaluator: &mut TestEvaluator) {
    evaluator.register(POSITIVE_ENTAILMENT, |test| evaluate_entailment(test, true));
    evaluator.register(NEGATIVE_ENTAILMENT, |test| evaluate_entailment(test, false));
}

fn evaluate_entailment(test: &Test, expected: bool) -> Result<()> {
    let regime = test
        .entailment_regime
        .as_deref()
        .context("Entailment test has no mf:entailmentRegime")?;
    ensure!(
        regime == "simple" || regime == "RDF" || regime == "RDFS",
        "Entailment regime {regime} is not implemented by this evaluator"
    );
    let action = test.action.as_deref().context("No action graph")?;
    let premise = load_graph(action, guess_rdf_format(action)?, false)?;
    let recognized: HashSet<_> = test.recognized_datatypes.iter().cloned().collect();
    let (premise, inconsistent) = match regime {
        "simple" => (premise, false),
        "RDF" => {
            let inconsistent = graph_is_inconsistent(&premise, &recognized);
            (premise, inconsistent)
        }
        "RDFS" => rdfs_closure(&premise, &recognized)?,
        _ => unreachable!(),
    };
    let actual = if test.result.as_deref() == Some("false") {
        inconsistent
    } else {
        let result = test.result.as_deref().context("No result graph")?;
        let conclusion = load_graph(result, guess_rdf_format(result)?, false)?;
        entails(&premise, &conclusion, &recognized, regime != "simple")
    };
    ensure!(
        actual == expected,
        "Expected entailment={expected}, evaluated entailment={actual}"
    );
    Ok(())
}

fn rdfs_closure(premise: &Graph, recognized: &HashSet<NamedNode>) -> Result<(Graph, bool)> {
    let mut dataset = Dataset::new();
    for triple in premise {
        dataset.insert(triple.in_graph(GraphName::DefaultGraph));
    }
    let options = Rdfs12Options::default().with_recognized_datatypes(recognized.iter().cloned());
    let closure = Rdfs12Finite.evaluate(&dataset, &options)?;
    let mut graph = Graph::new();
    for quad in closure.entailed() {
        if quad.graph_name == GraphName::DefaultGraph {
            graph.insert(Triple::new(quad.subject, quad.predicate, quad.object));
        }
    }
    Ok((graph, !closure.is_consistent()))
}

fn entails(
    premise: &Graph,
    conclusion: &Graph,
    recognized: &HashSet<NamedNode>,
    rdf_semantics: bool,
) -> bool {
    if rdf_semantics && graph_is_inconsistent(premise, recognized) {
        return true;
    }
    let mut patterns: Vec<_> = conclusion.iter().collect();
    patterns.sort_by_key(pattern_blank_count);
    match_patterns(
        &patterns,
        &premise.iter().collect::<Vec<_>>(),
        0,
        &mut HashMap::new(),
        recognized,
        rdf_semantics,
    )
}

fn match_patterns(
    patterns: &[Triple],
    premise: &[Triple],
    index: usize,
    mapping: &mut HashMap<BlankNode, Term>,
    recognized: &HashSet<NamedNode>,
    rdf_semantics: bool,
) -> bool {
    if index == patterns.len() {
        return true;
    }
    let pattern = &patterns[index];
    if rdf_semantics {
        for binding in rdf_axiom_bindings(pattern, premise, mapping, recognized) {
            let added = if let Some((variable, value)) = binding {
                mapping.insert(variable.clone(), value);
                vec![variable]
            } else {
                Vec::new()
            };
            let matched = match_patterns(
                patterns,
                premise,
                index + 1,
                mapping,
                recognized,
                rdf_semantics,
            );
            rollback(mapping, added);
            if matched {
                return true;
            }
        }
    }
    premise.iter().any(|candidate| {
        let mut added = Vec::new();
        let matched = pattern.predicate == candidate.predicate
            && match_subject(&pattern.subject, &candidate.subject, mapping, &mut added)
            && match_term(
                &pattern.object,
                &candidate.object,
                mapping,
                &mut added,
                recognized,
            )
            && match_patterns(
                patterns,
                premise,
                index + 1,
                mapping,
                recognized,
                rdf_semantics,
            );
        rollback(mapping, added);
        matched
    })
}

fn rdf_axiom_bindings(
    pattern: &Triple,
    premise: &[Triple],
    mapping: &HashMap<BlankNode, Term>,
    recognized: &HashSet<NamedNode>,
) -> Vec<Option<(BlankNode, Term)>> {
    if pattern.predicate != rdf::TYPE {
        return Vec::new();
    }
    let Term::NamedNode(expected_type) = &pattern.object else {
        return Vec::new();
    };
    let NamedOrBlankNode::BlankNode(subject) = &pattern.subject else {
        return Vec::new();
    };
    if let Some(value) = mapping.get(subject) {
        return if value_is_instance_of(value, expected_type, recognized) {
            vec![None]
        } else {
            Vec::new()
        };
    }
    let mut candidates = Vec::new();
    for term in premise_terms(premise) {
        if value_is_instance_of(&term, expected_type, recognized) {
            candidates.push(Some((subject.clone(), term)));
        }
    }
    candidates
}

fn premise_terms(premise: &[Triple]) -> Vec<Term> {
    let mut terms = HashSet::new();
    for triple in premise {
        terms.insert(subject_term(&triple.subject));
        collect_term(&triple.object, &mut terms);
    }
    terms.into_iter().collect()
}

fn collect_term(term: &Term, terms: &mut HashSet<Term>) {
    terms.insert(term.clone());
    #[cfg(feature = "rdf-12")]
    if let Term::Triple(triple) = term {
        terms.insert(subject_term(&triple.subject));
        collect_term(&triple.object, terms);
    }
}

fn value_is_instance_of(
    value: &Term,
    expected_type: &NamedNode,
    recognized: &HashSet<NamedNode>,
) -> bool {
    let Term::Literal(literal) = value else {
        return false;
    };
    recognized.contains(expected_type)
        && literal.datatype() == expected_type
        && literal_is_well_typed(literal, recognized)
}

fn match_subject(
    pattern: &NamedOrBlankNode,
    actual: &NamedOrBlankNode,
    mapping: &mut HashMap<BlankNode, Term>,
    added: &mut Vec<BlankNode>,
) -> bool {
    match pattern {
        NamedOrBlankNode::NamedNode(pattern) => {
            matches!(actual, NamedOrBlankNode::NamedNode(actual) if pattern == actual)
        }
        NamedOrBlankNode::BlankNode(pattern) => bind(
            pattern,
            subject_term(actual),
            mapping,
            added,
            &HashSet::new(),
        ),
    }
}

fn match_term(
    pattern: &Term,
    actual: &Term,
    mapping: &mut HashMap<BlankNode, Term>,
    added: &mut Vec<BlankNode>,
    recognized: &HashSet<NamedNode>,
) -> bool {
    match pattern {
        Term::NamedNode(pattern) => {
            matches!(actual, Term::NamedNode(actual) if pattern == actual)
        }
        Term::BlankNode(pattern) => bind(pattern, actual.clone(), mapping, added, recognized),
        Term::Literal(pattern) => {
            matches!(actual, Term::Literal(actual) if literals_equal(pattern, actual, recognized))
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(pattern) => {
            let Term::Triple(actual) = actual else {
                return false;
            };
            pattern.predicate == actual.predicate
                && match_subject(&pattern.subject, &actual.subject, mapping, added)
                && match_term(&pattern.object, &actual.object, mapping, added, recognized)
        }
    }
}

fn bind(
    variable: &BlankNode,
    value: Term,
    mapping: &mut HashMap<BlankNode, Term>,
    added: &mut Vec<BlankNode>,
    recognized: &HashSet<NamedNode>,
) -> bool {
    if let Some(bound) = mapping.get(variable) {
        terms_equal(bound, &value, recognized)
    } else {
        mapping.insert(variable.clone(), value);
        added.push(variable.clone());
        true
    }
}

fn rollback(mapping: &mut HashMap<BlankNode, Term>, added: Vec<BlankNode>) {
    for variable in added {
        mapping.remove(&variable);
    }
}

fn terms_equal(left: &Term, right: &Term, recognized: &HashSet<NamedNode>) -> bool {
    match (left, right) {
        (Term::Literal(left), Term::Literal(right)) => literals_equal(left, right, recognized),
        _ => left == right,
    }
}

fn literals_equal(left: &Literal, right: &Literal, recognized: &HashSet<NamedNode>) -> bool {
    if left == right {
        return true;
    }
    let left_type = left.datatype();
    let right_type = right.datatype();
    if !recognized.contains(left_type) || !recognized.contains(right_type) {
        return false;
    }
    #[cfg(feature = "rdf-12")]
    if *left_type == rdf::JSON && *right_type == rdf::JSON {
        return json_equal(left.value(), right.value());
    }
    if is_integer(left_type) && is_integer(right_type)
        || (is_integer(left_type) && *right_type == xsd::DECIMAL)
        || (*left_type == xsd::DECIMAL && is_integer(right_type))
        || (*left_type == xsd::DECIMAL && *right_type == xsd::DECIMAL)
    {
        return normalized_decimal(left.value()) == normalized_decimal(right.value());
    }
    if left_type == right_type && *left_type == xsd::FLOAT {
        return float_bits(left.value()) == float_bits(right.value());
    }
    if left_type == right_type && *left_type == xsd::DOUBLE {
        return double_bits(left.value()) == double_bits(right.value());
    }
    if left_type == right_type && *left_type == xsd::BOOLEAN {
        return boolean_value(left.value()) == boolean_value(right.value());
    }
    false
}

fn graph_is_inconsistent(graph: &Graph, recognized: &HashSet<NamedNode>) -> bool {
    graph
        .iter()
        .any(|triple| term_is_ill_typed(&triple.object, recognized))
}

fn term_is_ill_typed(term: &Term, recognized: &HashSet<NamedNode>) -> bool {
    match term {
        Term::Literal(literal) => !literal_is_well_typed(literal, recognized),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => term_is_ill_typed(&triple.object, recognized),
        _ => false,
    }
}

fn literal_is_well_typed(literal: &Literal, recognized: &HashSet<NamedNode>) -> bool {
    let datatype = literal.datatype();
    if !recognized.contains(datatype) {
        return true;
    }
    #[cfg(feature = "rdf-12")]
    if *datatype == rdf::JSON {
        return json_is_valid(literal.value());
    }
    if is_integer(datatype) {
        return normalized_decimal(literal.value()).is_some();
    }
    if *datatype == xsd::DECIMAL {
        return normalized_decimal(literal.value()).is_some()
            && !literal.value().contains(['e', 'E']);
    }
    if *datatype == xsd::FLOAT {
        return float_bits(literal.value()).is_some();
    }
    if *datatype == xsd::DOUBLE {
        return double_bits(literal.value()).is_some();
    }
    if *datatype == xsd::BOOLEAN {
        return boolean_value(literal.value()).is_some();
    }
    true
}

fn normalized_decimal(value: &str) -> Option<(bool, String)> {
    if value.is_empty() || value.trim() != value || value.contains(['e', 'E']) {
        return None;
    }
    let (negative, value) = value
        .strip_prefix('-')
        .map_or((false, value), |value| (true, value));
    let value = value.strip_prefix('+').unwrap_or(value);
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty() && fraction.is_empty()
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    let fraction = fraction.trim_end_matches('0');
    let digits = format!("{whole}{fraction}")
        .trim_start_matches('0')
        .to_owned();
    let scale = fraction.len();
    let normalized = if digits.is_empty() {
        "0".to_owned()
    } else if scale == 0 {
        digits
    } else {
        format!("{digits}@{scale}")
    };
    Some((negative && normalized != "0", normalized))
}

fn float_bits(value: &str) -> Option<u32> {
    parse_float(value)?.parse::<f32>().ok().map(f32::to_bits)
}

fn double_bits(value: &str) -> Option<u64> {
    parse_float(value)?.parse::<f64>().ok().map(f64::to_bits)
}

fn parse_float(value: &str) -> Option<&str> {
    match value {
        "INF" => Some("inf"),
        "-INF" => Some("-inf"),
        "NaN" => Some("NaN"),
        lexical if lexical.trim() == lexical => Some(lexical),
        _ => None,
    }
}

fn boolean_value(value: &str) -> Option<bool> {
    match value {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

fn is_integer(datatype: &NamedNode) -> bool {
    datatype
        .as_str()
        .starts_with("http://www.w3.org/2001/XMLSchema#")
        && matches!(
            datatype.as_str().rsplit('#').next(),
            Some(
                "integer"
                    | "long"
                    | "int"
                    | "short"
                    | "byte"
                    | "nonNegativeInteger"
                    | "positiveInteger"
                    | "unsignedLong"
                    | "unsignedInt"
                    | "unsignedShort"
                    | "unsignedByte"
                    | "nonPositiveInteger"
                    | "negativeInteger"
            )
        )
}

fn subject_term(subject: &NamedOrBlankNode) -> Term {
    match subject {
        NamedOrBlankNode::NamedNode(node) => node.clone().into(),
        NamedOrBlankNode::BlankNode(node) => node.clone().into(),
    }
}

fn pattern_blank_count(triple: &Triple) -> usize {
    usize::from(matches!(triple.subject, NamedOrBlankNode::BlankNode(_)))
        + term_blank_count(&triple.object)
}

fn term_blank_count(term: &Term) -> usize {
    match term {
        Term::BlankNode(_) => 1,
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => pattern_blank_count(triple),
        _ => 0,
    }
}
