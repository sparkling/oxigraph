#[cfg(test)]
mod tests {
    use datafrog::{Iteration, Relation};
    use oxdatalog::{
        Atom, Engine, EvaluationOptions, Fact, PatternTerm, Program, RelationId, Rule, RuleId,
        Value,
    };
    use oxrdf::{NamedNode, Term};

    const NODE_PREFIX: &str = "urn:test:node:";
    const ANCESTOR_EDGES: &[(&str, &str)] = &[("a", "b"), ("b", "c"), ("b", "e"), ("c", "d")];
    const ANCESTOR_CLOSURE: &[(&str, &str)] = &[
        ("a", "b"),
        ("a", "c"),
        ("a", "d"),
        ("a", "e"),
        ("b", "c"),
        ("b", "d"),
        ("b", "e"),
        ("c", "d"),
    ];
    const CYCLE_EDGES: &[(&str, &str)] = &[("a", "b"), ("b", "c"), ("c", "a")];
    const CYCLE_CLOSURE: &[(&str, &str)] = &[
        ("a", "a"),
        ("a", "b"),
        ("a", "c"),
        ("b", "a"),
        ("b", "b"),
        ("b", "c"),
        ("c", "a"),
        ("c", "b"),
        ("c", "c"),
    ];

    fn relation(name: &str) -> RelationId {
        RelationId::new(format!("urn:test:relation:{name}")).unwrap()
    }

    fn variable(name: &str) -> PatternTerm {
        PatternTerm::variable(name).unwrap()
    }

    fn atom(relation: &RelationId, variables: &[&str]) -> Atom {
        Atom::new(
            relation.clone(),
            variables
                .iter()
                .map(|name| variable(name))
                .collect::<Vec<_>>(),
        )
    }

    fn value(name: &str) -> Value {
        Value::Term(
            NamedNode::new(format!("{NODE_PREFIX}{name}"))
                .unwrap()
                .into(),
        )
    }

    fn fact(relation: &RelationId, subject: &str, object: &str) -> Fact {
        Fact::new(relation.clone(), vec![value(subject), value(object)])
    }

    fn ancestor_program() -> Program {
        let edge = relation("edge");
        let ancestor = relation("ancestor");
        Program::new(vec![
            Rule::new(
                RuleId::new("ancestor-direct").unwrap(),
                atom(&ancestor, &["subject", "object"]),
                vec![atom(&edge, &["subject", "object"])],
            ),
            Rule::new(
                RuleId::new("ancestor-transitive").unwrap(),
                atom(&ancestor, &["subject", "descendant"]),
                vec![
                    atom(&ancestor, &["subject", "middle"]),
                    atom(&edge, &["middle", "descendant"]),
                ],
            ),
        ])
    }

    fn local_name(value: &Value) -> Option<String> {
        let Value::Term(Term::NamedNode(node)) = value else {
            return None;
        };
        node.as_str().strip_prefix(NODE_PREFIX).map(str::to_owned)
    }

    fn oxdatalog_closure(edges: &[(&str, &str)]) -> Vec<(String, String)> {
        let edge = relation("edge");
        let result = Engine::default()
            .evaluate(
                &ancestor_program(),
                edges
                    .iter()
                    .map(|&(subject, object)| fact(&edge, subject, object)),
                &EvaluationOptions::default(),
            )
            .unwrap();

        result
            .derived_facts()
            .iter()
            .map(|fact| {
                let [subject, object] = fact.values() else {
                    return None;
                };
                Some((local_name(subject)?, local_name(object)?))
            })
            .collect::<Option<Vec<_>>>()
            .unwrap()
    }

    fn datafrog_closure(edges: &[(&'static str, &'static str)]) -> Vec<(String, String)> {
        let edges: Relation<_> = edges.iter().copied().collect();
        let edges_by_successor: Relation<_> = edges
            .iter()
            .map(|&(subject, object)| (object, subject))
            .collect();
        let mut iteration = Iteration::new();
        let reachable = iteration.variable::<(&'static str, &'static str)>("reachable");
        reachable.insert(edges);

        while iteration.changed() {
            reachable.from_join(
                &reachable,
                &edges_by_successor,
                |&_middle, &descendant, &subject| (subject, descendant),
            );
        }

        reachable
            .complete()
            .iter()
            .map(|&(subject, object)| (subject.to_owned(), object.to_owned()))
            .collect()
    }

    fn owned_pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|&(subject, object)| (subject.to_owned(), object.to_owned()))
            .collect()
    }

    fn assert_sorted(rows: &[(String, String)]) {
        assert!(
            rows.windows(2)
                .all(|window| matches!(window, [left, right] if left < right)),
            "closure must be sorted and duplicate-free: {rows:?}"
        );
    }

    fn assert_backend_parity(
        corpus_name: &str,
        edges: &[(&'static str, &'static str)],
        expected: &[(&str, &str)],
    ) {
        let native = oxdatalog_closure(edges);
        let oracle = datafrog_closure(edges);
        let expected = owned_pairs(expected);

        assert_sorted(&native);
        assert_sorted(&oracle);
        assert_eq!(
            native, expected,
            "unexpected oxdatalog {corpus_name} closure"
        );
        assert_eq!(
            oracle, expected,
            "unexpected Datafrog {corpus_name} closure"
        );
        assert_eq!(native, oracle, "{corpus_name} backends diverged");

        let mut reversed = edges.to_vec();
        reversed.reverse();
        assert_eq!(
            oxdatalog_closure(&reversed),
            native,
            "oxdatalog {corpus_name} order changed with input order"
        );
        assert_eq!(
            datafrog_closure(&reversed),
            oracle,
            "Datafrog {corpus_name} order changed with input order"
        );
    }

    #[test]
    fn purpose_built_d0_matches_datafrog_on_frozen_corpora() {
        assert_backend_parity("ancestor", ANCESTOR_EDGES, ANCESTOR_CLOSURE);
        assert_backend_parity("cycle", CYCLE_EDGES, CYCLE_CLOSURE);
    }
}
