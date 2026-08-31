use anyhow::Context;
use oxrdf::{BlankNode, NamedOrBlankNode, Term, Triple};
use sparesults::{
    QueryResultsFormat, QueryResultsParser, QueryResultsSerializer, QuerySolution,
    SliceQueryResultsParserOutput,
};
use std::collections::HashMap;

#[derive(Default)]
struct BlankNodeBijection {
    left_to_right: HashMap<BlankNode, BlankNode>,
    right_to_left: HashMap<BlankNode, BlankNode>,
}

impl BlankNodeBijection {
    fn matches(&mut self, left: &BlankNode, right: &BlankNode) -> bool {
        if let Some(mapped) = self.left_to_right.get(left) {
            return mapped == right;
        }
        if self.right_to_left.contains_key(right) {
            return false;
        }
        self.left_to_right.insert(left.clone(), right.clone());
        self.right_to_left.insert(right.clone(), left.clone());
        true
    }
}

fn named_or_blank_nodes_match(
    left: &NamedOrBlankNode,
    right: &NamedOrBlankNode,
    blank_nodes: &mut BlankNodeBijection,
) -> bool {
    match (left, right) {
        (NamedOrBlankNode::NamedNode(left), NamedOrBlankNode::NamedNode(right)) => left == right,
        (NamedOrBlankNode::BlankNode(left), NamedOrBlankNode::BlankNode(right)) => {
            blank_nodes.matches(left, right)
        }
        _ => false,
    }
}

fn triples_match(left: &Triple, right: &Triple, blank_nodes: &mut BlankNodeBijection) -> bool {
    named_or_blank_nodes_match(&left.subject, &right.subject, blank_nodes)
        && left.predicate == right.predicate
        && terms_match(&left.object, &right.object, blank_nodes)
}

fn terms_match(left: &Term, right: &Term, blank_nodes: &mut BlankNodeBijection) -> bool {
    match (left, right) {
        (Term::NamedNode(left), Term::NamedNode(right)) => left == right,
        (Term::BlankNode(left), Term::BlankNode(right)) => blank_nodes.matches(left, right),
        (Term::Literal(left), Term::Literal(right)) => left == right,
        (Term::Triple(left), Term::Triple(right)) => triples_match(left, right, blank_nodes),
        _ => false,
    }
}

fn solution_sequences_match(left: &[QuerySolution], right: &[QuerySolution]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut blank_nodes = BlankNodeBijection::default();
    left.iter().zip(right).all(|(left, right)| {
        left.variables() == right.variables()
            && left.values().len() == right.values().len()
            && left
                .values()
                .iter()
                .zip(right.values())
                .all(|(left, right)| match (left, right) {
                    (Some(left), Some(right)) => terms_match(left, right, &mut blank_nodes),
                    (None, None) => true,
                    _ => false,
                })
    })
}

pub fn fuzz_result_format(format: QueryResultsFormat, data: &[u8]) {
    let Ok(reader) = QueryResultsParser::from_format(format).for_slice(data) else {
        return;
    };
    match reader {
        SliceQueryResultsParserOutput::Solutions(solutions) => {
            let Ok(solutions) = solutions.collect::<Result<Vec<_>, _>>() else {
                return;
            };

            // We try to write again
            let mut serializer = QueryResultsSerializer::from_format(format)
                .serialize_solutions_to_writer(
                    Vec::new(),
                    solutions
                        .first()
                        .map_or_else(Vec::new, |s| s.variables().to_vec()),
                )
                .unwrap();
            for solution in &solutions {
                serializer.serialize(solution).unwrap();
            }
            let serialized = serializer.finish().unwrap();

            // And to parse again
            if let SliceQueryResultsParserOutput::Solutions(roundtrip_solutions) =
                QueryResultsParser::from_format(format)
                    .for_slice(&serialized)
                    .with_context(|| format!("Parsing {:?}", String::from_utf8_lossy(&serialized)))
                    .unwrap()
            {
                let roundtrip_solutions = roundtrip_solutions
                    .collect::<Result<Vec<_>, _>>()
                    .with_context(|| format!("Parsing {serialized:?}"))
                    .unwrap();
                assert!(
                    solution_sequences_match(&roundtrip_solutions, &solutions),
                    "round-trip solutions differ modulo a global blank-node bijection:\nround-trip: {roundtrip_solutions:?}\noriginal: {solutions:?}"
                );
            }
        }
        SliceQueryResultsParserOutput::Boolean(value) => {
            // We try to write again
            let mut serialized = Vec::new();
            QueryResultsSerializer::from_format(format)
                .serialize_boolean_to_writer(&mut serialized, value)
                .unwrap();

            // And to parse again
            if let SliceQueryResultsParserOutput::Boolean(roundtrip_value) =
                QueryResultsParser::from_format(format)
                    .for_slice(&serialized)
                    .unwrap()
            {
                assert_eq!(roundtrip_value, value)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxrdf::Variable;

    fn solution(variable: &Variable, blank_node: &str) -> QuerySolution {
        QuerySolution::from((
            vec![variable.clone()],
            vec![Some(BlankNode::new_unchecked(blank_node.to_owned()).into())],
        ))
    }

    #[test]
    fn solution_equivalence_uses_one_bijection_for_the_complete_sequence() {
        let variable = Variable::new_unchecked("x");
        let left = vec![solution(&variable, "left"), solution(&variable, "left")];
        let renamed = vec![
            solution(&variable, "renamed"),
            solution(&variable, "renamed"),
        ];
        let split = vec![solution(&variable, "first"), solution(&variable, "second")];

        assert!(solution_sequences_match(&left, &renamed));
        assert!(!solution_sequences_match(&left, &split));
    }

    #[test]
    fn solution_equivalence_rejects_blank_node_alias_collapse() {
        let variable = Variable::new_unchecked("x");
        let left = vec![solution(&variable, "first"), solution(&variable, "second")];
        let collapsed = vec![solution(&variable, "same"), solution(&variable, "same")];

        assert!(!solution_sequences_match(&left, &collapsed));
    }

    #[test]
    fn tsv_blank_node_regression_roundtrips() {
        fuzz_result_format(
            QueryResultsFormat::Tsv,
            include_bytes!("../regressions/sparql_results_tsv/blank-node.tsv"),
        );
    }
}
