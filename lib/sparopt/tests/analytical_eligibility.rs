//! Integration oracle for the explicit analytical eligibility report.

#[cfg(test)]
mod tests {
    #[cfg(feature = "sparql-12")]
    use spargebra::term::GroundTriplePattern;
    use spargebra::{Query, SparqlParser};
    use sparopt::algebra::{
        GroundTermPattern, JoinAlgorithm, LeftJoinAlgorithm, Literal, MinusAlgorithm, NamedNode,
        NamedNodePattern, OrderExpression, PropertyPathExpression, QueryExpression, Variable,
    };
    use sparopt::{
        AnalyticalBudgetKind, AnalyticalEligibility, AnalyticalEligibilityLimits,
        AnalyticalEligibilityLimitsError, AnalyticalEligibilityOutcome,
        AnalyticalEligibilityReport, AnalyticalGraphScope, AnalyticalUnsupportedReason, Optimizer,
    };

    type Outcome = AnalyticalEligibilityOutcome;
    type Reason = AnalyticalUnsupportedReason;

    fn var(name: &'static str) -> Variable {
        Variable::new(name).unwrap()
    }

    fn iri(value: &'static str) -> NamedNode {
        NamedNode::new(value).unwrap()
    }

    fn limits(
        patterns: usize,
        variables: usize,
        nodes: usize,
        depth: usize,
    ) -> AnalyticalEligibilityLimits {
        AnalyticalEligibilityLimits::new(patterns, variables, nodes, depth).unwrap()
    }

    fn roomy() -> AnalyticalEligibilityLimits {
        limits(64, 64, 256, 64)
    }

    fn quad_with(
        subject: GroundTermPattern,
        predicate: NamedNodePattern,
        object: GroundTermPattern,
        graph_name: Option<NamedNodePattern>,
    ) -> QueryExpression {
        QueryExpression::QuadPattern {
            subject,
            predicate,
            object,
            graph_name,
        }
    }

    fn edge(
        subject: &'static str,
        predicate: &'static str,
        object: &'static str,
    ) -> QueryExpression {
        quad_with(
            var(subject).into(),
            iri(predicate).into(),
            var(object).into(),
            None,
        )
    }

    fn in_graph(mut quad: QueryExpression, graph: NamedNodePattern) -> QueryExpression {
        if let QueryExpression::QuadPattern { graph_name, .. } = &mut quad {
            *graph_name = Some(graph);
        }
        quad
    }

    fn join(left: QueryExpression, right: QueryExpression) -> QueryExpression {
        QueryExpression::Join {
            left: Box::new(left),
            right: Box::new(right),
            algorithm: JoinAlgorithm::default(),
        }
    }

    fn join_all(items: Vec<QueryExpression>) -> QueryExpression {
        items.into_iter().reduce(join).unwrap()
    }

    fn triangle() -> QueryExpression {
        join_all(vec![
            edge("a", "urn:p", "b"),
            edge("b", "urn:p", "c"),
            edge("c", "urn:p", "a"),
        ])
    }

    fn parse(query: &str) -> QueryExpression {
        let Query::Select(select) = SparqlParser::new().parse_query(query).unwrap() else {
            panic!("expected a SELECT query");
        };
        QueryExpression::from(&select.expression)
    }

    fn strip_project(expression: QueryExpression) -> QueryExpression {
        match expression {
            QueryExpression::Project { inner, .. } => *inner,
            other => other,
        }
    }

    fn parse_pattern(body: &str) -> QueryExpression {
        strip_project(parse(&format!("SELECT * WHERE {{ {body} }}")))
    }

    fn examine(
        limits: AnalyticalEligibilityLimits,
        expression: &QueryExpression,
    ) -> AnalyticalEligibilityReport {
        let before = expression.clone();
        let report = AnalyticalEligibility::new(limits).examine(expression);
        assert_eq!(&before, expression, "examination changed the expression");
        report
    }

    // patterns, variables, variable occurrences, constant positions, nodes, depth, components
    fn counts(report: &AnalyticalEligibilityReport) -> [usize; 7] {
        [
            report.patterns,
            report.variables,
            report.variable_occurrences,
            report.constant_positions,
            report.nodes,
            report.max_depth,
            report.components,
        ]
    }

    #[test]
    fn connected_shapes_report_exact_counts() {
        for (body, expected) in [
            (
                "?a <urn:p> ?b . ?b <urn:p> ?c . ?c <urn:p> ?a",
                [3, 3, 6, 3, 5, 3, 1],
            ),
            (
                "?a <urn:p> ?b . ?b <urn:p> ?c . ?c <urn:p> ?d . ?d <urn:p> ?a",
                [4, 4, 8, 4, 7, 4, 1],
            ),
            (
                "?s <urn:p1> ?a . ?s <urn:p2> ?b . ?s <urn:p3> ?c",
                [3, 4, 6, 3, 5, 3, 1],
            ),
            ("?a <urn:p> ?b . ?b <urn:q> ?c", [2, 3, 4, 2, 3, 2, 1]),
            (
                "?x <urn:p> ?x . ?x <urn:q> <urn:o> . <urn:s> <urn:r> ?x",
                [3, 1, 4, 5, 5, 3, 1],
            ),
            ("?s <urn:p> ?o . ?s <urn:p> ?o", [2, 2, 4, 2, 3, 2, 1]),
            ("?s ?p ?o . ?o ?p ?z", [2, 4, 6, 0, 3, 2, 1]),
            (r#"?s <urn:p> "x" . ?s <urn:q> ?o"#, [2, 2, 3, 3, 3, 2, 1]),
            (
                "?a <urn:p> ?b . ?c <urn:p> ?d . ?b <urn:p> ?c",
                [3, 4, 6, 3, 5, 3, 1],
            ),
        ] {
            let report = examine(roomy(), &parse_pattern(body));
            assert_eq!(report.outcome, Outcome::Eligible, "{body}");
            assert_eq!(counts(&report), expected, "{body}");
            assert_eq!(report.graph_scope, Some(AnalyticalGraphScope::Default));
        }
    }

    #[test]
    fn disconnected_and_cartesian_components_are_rejected() {
        for (body, components) in [
            ("?a <urn:p> ?b . ?c <urn:q> ?d", 2),
            ("<urn:s> <urn:p> ?a . <urn:s> <urn:p> ?b", 2),
            ("?a <urn:p> ?b . ?b <urn:p> ?c . ?x <urn:q> ?y", 2),
            ("<urn:s> <urn:p> <urn:o> . ?a <urn:p> ?b", 2),
            ("?a <urn:p> ?b . ?c <urn:p> ?d . ?e <urn:p> ?f", 3),
        ] {
            let report = examine(roomy(), &parse_pattern(body));
            assert_eq!(
                report.outcome,
                Outcome::Unsupported(Reason::Disconnected),
                "{body}"
            );
            assert_eq!(report.components, components, "{body}");
        }
    }

    #[test]
    fn fewer_than_two_patterns_are_rejected() {
        let report = examine(roomy(), &parse_pattern("?a <urn:p> ?b"));
        assert_eq!(report.outcome, Outcome::Unsupported(Reason::TooFewPatterns));
        assert_eq!((report.patterns, report.nodes), (1, 1));
    }

    #[test]
    fn graph_scope_must_be_one_fixed_graph() {
        let g1 = || NamedNodePattern::from(iri("urn:g1"));
        let g2 = || NamedNodePattern::from(iri("urn:g2"));
        let variable_graph = || NamedNodePattern::from(var("g"));
        let first = || edge("a", "urn:p", "b");
        let second = || edge("b", "urn:p", "c");

        let report = examine(roomy(), &join(first(), second()));
        assert_eq!(report.outcome, Outcome::Eligible);
        assert_eq!(report.graph_scope, Some(AnalyticalGraphScope::Default));

        let named = join(in_graph(first(), g1()), in_graph(second(), g1()));
        let report = examine(roomy(), &named);
        assert_eq!(report.outcome, Outcome::Eligible);
        assert_eq!(
            report.graph_scope,
            Some(AnalyticalGraphScope::ConstantNamed)
        );

        for mixed in [
            join(first(), in_graph(second(), g1())),
            join(in_graph(first(), g1()), second()),
            join(in_graph(first(), g1()), in_graph(second(), g2())),
        ] {
            let report = examine(roomy(), &mixed);
            assert_eq!(report.outcome, Outcome::Unsupported(Reason::MixedGraph));
        }

        for variable in [
            join(in_graph(first(), variable_graph()), second()),
            join(first(), in_graph(second(), variable_graph())),
            join(
                in_graph(first(), variable_graph()),
                in_graph(second(), variable_graph()),
            ),
        ] {
            let report = examine(roomy(), &variable);
            assert_eq!(report.outcome, Outcome::Unsupported(Reason::VariableGraph));
        }
    }

    #[test]
    fn zero_limits_are_typed_errors_in_fixed_order() {
        for (values, expected) in [
            ([0, 0, 0, 0], AnalyticalEligibilityLimitsError::Patterns),
            ([0, 1, 1, 1], AnalyticalEligibilityLimitsError::Patterns),
            ([1, 0, 0, 0], AnalyticalEligibilityLimitsError::Variables),
            ([1, 1, 0, 0], AnalyticalEligibilityLimitsError::Nodes),
            ([1, 1, 1, 0], AnalyticalEligibilityLimitsError::Depth),
        ] {
            let [patterns, variables, nodes, depth] = values;
            let error =
                AnalyticalEligibilityLimits::new(patterns, variables, nodes, depth).unwrap_err();
            assert_eq!(error, expected);
            assert!(error.to_string().contains("must be positive"));
            let _: &dyn std::error::Error = &error;
        }
        let valid = AnalyticalEligibilityLimits::new(1, 2, 3, 4).unwrap();
        assert_eq!(
            (
                valid.max_patterns(),
                valid.max_variables(),
                valid.max_nodes(),
                valid.max_depth()
            ),
            (1, 2, 3, 4)
        );
        assert_eq!(AnalyticalEligibility::new(valid).limits(), valid);
    }

    #[test]
    fn each_budget_cuts_off_exactly_at_its_boundary() {
        let expression = parse_pattern("?a <urn:p> ?b . ?b <urn:p> ?c . ?c <urn:p> ?a");

        assert_eq!(
            examine(limits(64, 64, 5, 64), &expression).outcome,
            Outcome::Eligible
        );
        let report = examine(limits(64, 64, 4, 64), &expression);
        assert_eq!(
            report.outcome,
            Outcome::BudgetExceeded(AnalyticalBudgetKind::Nodes)
        );
        assert_eq!(report.nodes, 4);

        assert_eq!(
            examine(limits(64, 64, 256, 3), &expression).outcome,
            Outcome::Eligible
        );
        let report = examine(limits(64, 64, 256, 2), &expression);
        assert_eq!(
            report.outcome,
            Outcome::BudgetExceeded(AnalyticalBudgetKind::Depth)
        );
        assert_eq!(report.max_depth, 2);

        assert_eq!(
            examine(limits(3, 64, 256, 64), &expression).outcome,
            Outcome::Eligible
        );
        let report = examine(limits(2, 64, 256, 64), &expression);
        assert_eq!(
            report.outcome,
            Outcome::BudgetExceeded(AnalyticalBudgetKind::Patterns)
        );
        assert_eq!(report.patterns, 2);

        assert_eq!(
            examine(limits(64, 3, 256, 64), &expression).outcome,
            Outcome::Eligible
        );
        let report = examine(limits(64, 2, 256, 64), &expression);
        assert_eq!(
            report.outcome,
            Outcome::BudgetExceeded(AnalyticalBudgetKind::Variables)
        );
        assert_eq!(report.variables, 2);

        let report = examine(limits(64, 64, 1, 64), &expression);
        assert_eq!(
            report.outcome,
            Outcome::BudgetExceeded(AnalyticalBudgetKind::Nodes)
        );
        assert_eq!(report.nodes, 1);
    }

    fn boundaries(inner: &QueryExpression) -> Vec<(QueryExpression, Reason)> {
        let boxed = || Box::new(inner.clone());
        let other = || Box::new(edge("b", "urn:q", "c"));
        #[cfg_attr(not(feature = "sep-0006"), expect(unused_mut))]
        let mut cases = vec![
            (
                QueryExpression::Path {
                    subject: var("a").into(),
                    path: PropertyPathExpression::Link(iri("urn:p")),
                    object: var("b").into(),
                },
                Reason::Path,
            ),
            (
                QueryExpression::Graph {
                    graph_name: iri("urn:g").into(),
                    inner: boxed(),
                },
                Reason::GraphWrapper,
            ),
            (
                QueryExpression::LeftJoin {
                    left: boxed(),
                    right: other(),
                    expression: true.into(),
                    algorithm: LeftJoinAlgorithm::default(),
                },
                Reason::LeftJoin,
            ),
            (
                QueryExpression::Minus {
                    left: boxed(),
                    right: other(),
                    algorithm: MinusAlgorithm::default(),
                },
                Reason::Minus,
            ),
            (
                QueryExpression::Union {
                    inner: vec![inner.clone()],
                },
                Reason::Union,
            ),
            (
                QueryExpression::Filter {
                    expression: true.into(),
                    inner: boxed(),
                },
                Reason::Filter,
            ),
            (
                QueryExpression::Extend {
                    inner: boxed(),
                    variable: var("x"),
                    expression: true.into(),
                },
                Reason::Extend,
            ),
            (QueryExpression::empty_singleton(), Reason::Values),
            (
                QueryExpression::OrderBy {
                    inner: boxed(),
                    expression: vec![OrderExpression::Asc(var("a"))],
                },
                Reason::OrderBy,
            ),
            (
                QueryExpression::Project {
                    inner: boxed(),
                    variables: vec![var("a")],
                },
                Reason::Project,
            ),
            (
                QueryExpression::Distinct { inner: boxed() },
                Reason::Distinct,
            ),
            (QueryExpression::Reduced { inner: boxed() }, Reason::Reduced),
            (
                QueryExpression::Slice {
                    inner: boxed(),
                    offset: 0,
                    limit: Some(1),
                },
                Reason::Slice,
            ),
            (
                QueryExpression::Group {
                    inner: boxed(),
                    variables: Vec::new(),
                    aggregates: Vec::new(),
                },
                Reason::Group,
            ),
            (
                QueryExpression::Service {
                    name: iri("urn:service").into(),
                    inner: boxed(),
                    silent: false,
                },
                Reason::Service,
            ),
        ];
        #[cfg(feature = "sep-0006")]
        cases.push((
            QueryExpression::Lateral {
                left: boxed(),
                right: other(),
            },
            Reason::Lateral,
        ));
        cases
    }

    #[test]
    fn every_boundary_is_rejected_without_descending_into_it() {
        let inner = triangle();
        assert_eq!(examine(roomy(), &inner).outcome, Outcome::Eligible);
        let cases = boundaries(&inner);
        assert_eq!(
            cases.len(),
            if cfg!(feature = "sep-0006") { 16 } else { 15 }
        );
        for (boundary, reason) in cases {
            let report = examine(roomy(), &boundary);
            assert_eq!(report.outcome, Outcome::Unsupported(reason), "{reason:?}");
            assert_eq!((report.nodes, report.patterns), (1, 0), "{reason:?}");

            let as_right = join(edge("a", "urn:p", "b"), boundary.clone());
            let report = examine(roomy(), &as_right);
            assert_eq!(report.outcome, Outcome::Unsupported(reason), "{reason:?}");
            assert_eq!((report.nodes, report.patterns), (3, 1), "{reason:?}");

            let as_left = join(boundary, edge("a", "urn:p", "b"));
            let report = examine(roomy(), &as_left);
            assert_eq!(report.outcome, Outcome::Unsupported(reason), "{reason:?}");
            assert_eq!((report.nodes, report.patterns), (2, 0), "{reason:?}");
        }
    }

    #[test]
    fn parsed_boundaries_map_to_their_own_reasons() {
        for (query, strip, reason) in [
            (
                "SELECT * WHERE { ?a <urn:p> ?b OPTIONAL { ?b <urn:q> ?c } }",
                true,
                Reason::LeftJoin,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b MINUS { ?b <urn:q> ?c } }",
                true,
                Reason::Minus,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b { ?b <urn:q> ?c } UNION { ?b <urn:r> ?c } }",
                true,
                Reason::Union,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b . ?b <urn:p> ?c FILTER(?c != ?a) }",
                true,
                Reason::Filter,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b . ?b <urn:p> ?c BIND(?a AS ?x) }",
                true,
                Reason::Extend,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b . ?b <urn:q>+ ?c }",
                true,
                Reason::Path,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b GRAPH <urn:g> { ?b <urn:q> ?c } }",
                true,
                Reason::GraphWrapper,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b { SELECT ?b WHERE { ?b <urn:q> ?c } } }",
                true,
                Reason::Project,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b VALUES ?b { <urn:x> } }",
                true,
                Reason::Values,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b SERVICE <urn:s> { ?b <urn:q> ?c } }",
                true,
                Reason::Service,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b . ?b <urn:p> ?c } ORDER BY ?a",
                true,
                Reason::OrderBy,
            ),
            (
                "SELECT * WHERE { ?a <urn:p> ?b . ?b <urn:p> ?c }",
                false,
                Reason::Project,
            ),
        ] {
            let expression = parse(query);
            let expression = if strip {
                strip_project(expression)
            } else {
                expression
            };
            let report = examine(roomy(), &expression);
            assert_eq!(report.outcome, Outcome::Unsupported(reason), "{query}");
        }
    }

    #[cfg(feature = "sep-0006")]
    #[test]
    fn lateral_is_a_boundary_not_a_join() {
        let lateral = QueryExpression::Lateral {
            left: Box::new(edge("a", "urn:p", "b")),
            right: Box::new(edge("b", "urn:p", "c")),
        };
        let report = examine(roomy(), &lateral);
        assert_eq!(report.outcome, Outcome::Unsupported(Reason::Lateral));
        assert_eq!(report.patterns, 0);
    }

    #[cfg(feature = "sparql-12")]
    fn triple_term(subject: &'static str, object: &'static str) -> GroundTermPattern {
        GroundTermPattern::Triple(Box::new(GroundTriplePattern {
            subject: var(subject).into(),
            predicate: iri("urn:q").into(),
            object: var(object).into(),
        }))
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn nested_triple_terms_are_unsupported_not_ignored() {
        let as_subject = quad_with(
            triple_term("x", "y"),
            iri("urn:p").into(),
            var("z").into(),
            None,
        );
        let as_object = quad_with(
            var("z").into(),
            iri("urn:p").into(),
            triple_term("x", "y"),
            None,
        );
        let nested = quad_with(
            var("z").into(),
            iri("urn:p").into(),
            GroundTermPattern::Triple(Box::new(GroundTriplePattern {
                subject: var("x").into(),
                predicate: iri("urn:q").into(),
                object: triple_term("y", "w"),
            })),
            None,
        );
        for pattern in [as_subject, as_object, nested] {
            let report = examine(roomy(), &pattern);
            assert_eq!(report.outcome, Outcome::Unsupported(Reason::TripleTerm));

            let shared = join(edge("x", "urn:p", "w"), pattern.clone());
            let report = examine(roomy(), &shared);
            assert_eq!(report.outcome, Outcome::Unsupported(Reason::TripleTerm));

            let first = join(pattern, edge("x", "urn:p", "w"));
            let report = examine(roomy(), &first);
            assert_eq!(report.outcome, Outcome::Unsupported(Reason::TripleTerm));
        }
    }

    #[cfg(not(feature = "sep-0006"))]
    fn optimized_outcome() -> Outcome {
        Outcome::Eligible
    }

    #[cfg(feature = "sep-0006")]
    fn optimized_outcome() -> Outcome {
        Outcome::Unsupported(Reason::Lateral)
    }

    #[test]
    fn optimizer_output_is_examined_as_ordinary_public_algebra() {
        for (body, scope) in [
            (
                "?a <urn:p> ?b . ?b <urn:p> ?c . ?c <urn:p> ?a",
                AnalyticalGraphScope::Default,
            ),
            (
                "GRAPH <urn:g> { ?a <urn:p> ?b . ?b <urn:p> ?c . ?c <urn:p> ?a }",
                AnalyticalGraphScope::ConstantNamed,
            ),
        ] {
            let parsed = parse(&format!("SELECT * WHERE {{ {body} }}"));
            let optimized = strip_project(Optimizer::optimize_query_expression(parsed));
            let report = examine(roomy(), &optimized);
            assert_eq!(report.outcome, optimized_outcome(), "{body}");
            if report.outcome == Outcome::Eligible {
                assert_eq!(report.graph_scope, Some(scope), "{body}");
                assert_eq!((report.patterns, report.components), (3, 1), "{body}");
            }
        }
    }

    #[test]
    fn reports_are_deterministic_and_term_free() {
        let secret_graph = || NamedNodePattern::from(iri("urn:secret-graph"));
        let expression = join(
            quad_with(
                var("secretvar").into(),
                iri("urn:secret-predicate").into(),
                Literal::from(true).into(),
                Some(secret_graph()),
            ),
            quad_with(
                var("secretvar").into(),
                iri("urn:secret-predicate").into(),
                var("other").into(),
                Some(secret_graph()),
            ),
        );
        let first = examine(roomy(), &expression);
        assert_eq!(first, examine(roomy(), &expression));
        assert_eq!(first.outcome, Outcome::Eligible);
        assert_eq!(first.graph_scope, Some(AnalyticalGraphScope::ConstantNamed));

        let unsupported = QueryExpression::Filter {
            expression: true.into(),
            inner: Box::new(expression),
        };
        for text in [
            format!("{first:?}"),
            format!("{:?}", examine(roomy(), &unsupported)),
            format!("{:?}", roomy()),
        ] {
            assert!(!text.contains("secret"), "{text}");
            assert!(!text.contains("urn:"), "{text}");
            assert!(!text.contains("other"), "{text}");
        }
    }

    #[test]
    fn deep_trees_are_walked_iteratively_within_bounds() {
        // The large stack only serves building, cloning, comparing and dropping the trees.
        std::thread::Builder::new()
            .stack_size(256 * 1024 * 1024)
            .spawn(|| {
                const DEPTH: usize = 20_000;
                let mut left_deep = edge("s", "urn:p", "o");
                let mut right_deep = edge("s", "urn:p", "o");
                for _ in 0..DEPTH {
                    left_deep = join(left_deep, edge("s", "urn:p", "o"));
                    right_deep = join(edge("s", "urn:p", "o"), right_deep);
                }
                for tree in [&left_deep, &right_deep] {
                    let report = examine(limits(64, 64, 256, 64), tree);
                    assert_eq!(
                        report.outcome,
                        Outcome::BudgetExceeded(AnalyticalBudgetKind::Depth)
                    );
                    assert_eq!(report.max_depth, 64);

                    let report = examine(limits(usize::MAX, usize::MAX, 10, usize::MAX), tree);
                    assert_eq!(
                        report.outcome,
                        Outcome::BudgetExceeded(AnalyticalBudgetKind::Nodes)
                    );
                    assert_eq!(report.nodes, 10);

                    let report = examine(limits(5, usize::MAX, usize::MAX, usize::MAX), tree);
                    assert_eq!(
                        report.outcome,
                        Outcome::BudgetExceeded(AnalyticalBudgetKind::Patterns)
                    );
                    assert_eq!(report.patterns, 5);

                    let report =
                        examine(limits(usize::MAX, usize::MAX, usize::MAX, usize::MAX), tree);
                    assert_eq!(report.outcome, Outcome::Eligible);
                    assert_eq!(
                        counts(&report),
                        [
                            DEPTH + 1,
                            2,
                            2 * (DEPTH + 1),
                            DEPTH + 1,
                            2 * DEPTH + 1,
                            DEPTH + 1,
                            1
                        ]
                    );
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
