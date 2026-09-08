//! Bounded left-deep subset search. Estimates affect ordering, never query truth.
use super::*;

/// Explicit opt-in profile; no default-planner or measured-speed promotion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundedJoinPlanning {
    max_dp_leaves: u8,
    cost_model: BoundedJoinCostModel,
}
/// Versioned opt-in cost rules. Neither profile promotes the ordinary planner.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum BoundedJoinCostModel {
    /// Original independent-cardinality recurrence and bound-probe heuristic.
    IndependentV1,
    /// Conditional, plan-independent subset hints and single-graph membership probes.
    ConditionalV2,
    /// Consistent correlated costs; unhinted leaves prefer legal indexed probes.
    CorrelatedV3,
}
impl BoundedJoinCostModel {
    pub const fn id(self) -> &'static str {
        match self {
            Self::IndependentV1 => "oxigraph.join-work.v1",
            Self::ConditionalV2 => "oxigraph.join-work.conditional.v2",
            Self::CorrelatedV3 => "oxigraph.join-work.correlated.v3",
        }
    }
}
impl BoundedJoinPlanning {
    /// Legacy/default profile identifier. Use `cost_model().id()` for a
    /// configured instance, which may explicitly select a newer profile.
    pub const COST_MODEL: &str = "oxigraph.join-work.v1";
    pub const MAX_DP_LEAVES: u8 = 8;

    /// Rejects zero or a bound above the reviewed eight-leaf ceiling.
    pub const fn new(max_dp_leaves: u8) -> Option<Self> {
        if max_dp_leaves > 0 && max_dp_leaves <= Self::MAX_DP_LEAVES {
            Some(Self {
                max_dp_leaves,
                cost_model: BoundedJoinCostModel::IndependentV1,
            })
        } else {
            None
        }
    }
    pub const fn max_dp_leaves(self) -> u8 {
        self.max_dp_leaves
    }
    pub const fn cost_model(self) -> BoundedJoinCostModel {
        self.cost_model
    }
    #[must_use]
    pub const fn with_cost_model(mut self, model: BoundedJoinCostModel) -> Self {
        self.cost_model = model;
        self
    }
}
impl Default for BoundedJoinPlanning {
    fn default() -> Self {
        Self {
            max_dp_leaves: Self::MAX_DP_LEAVES,
            cost_model: BoundedJoinCostModel::IndependentV1,
        }
    }
}

/// Term-free query-local planning work, not elapsed time or a speedup claim.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct JoinPlanningReport {
    /// Effective profile; None for default greedy or bypassed optimization.
    pub bounded: Option<BoundedJoinPlanning>,
    pub dp_components: usize,
    pub greedy_components: usize,
    pub dp_states: usize,
    pub dp_candidates: usize,
}

pub(super) fn component_ids(
    first: usize,
    types: &[VariableTypes],
    remaining: &[bool],
    input: &VariableTypes,
    max_leaves: usize,
) -> Vec<usize> {
    let mut ids = vec![first];
    let mut cursor = 0;
    while cursor < ids.len() {
        for (id, available) in remaining.iter().enumerate() {
            if *available
                && !ids.contains(&id)
                && has_common_variables(&types[ids[cursor]], &types[id], input)
            {
                ids.push(id);
                // We only need to know that this component exceeds the bound.
                // Do not fully traverse a large BGP before its greedy fallback.
                if ids.len() > max_leaves {
                    return ids;
                }
            }
        }
        cursor += 1;
    }
    ids.sort_unstable();
    ids
}

#[derive(Clone)]
struct State {
    expression: QueryExpression,
    work: u128,
    order: Vec<usize>,
}

pub(super) fn plan(
    ids: &[usize],
    leaves: &[QueryExpression],
    leaf_types: &[VariableTypes],
    input: &VariableTypes,
    estimator: Option<&dyn CardinalityEstimator>,
    cost_model: BoundedJoinCostModel,
    report: &mut JoinPlanningReport,
) -> Option<QueryExpression> {
    // Defensive bound before any exponential allocation/shift.
    if ids.len() < 2 || ids.len() > usize::from(BoundedJoinPlanning::MAX_DP_LEAVES) {
        return None;
    }
    let count = 1_usize << ids.len();
    let sizes: Vec<_> = ids
        .iter()
        .map(|&id| estimate_query_expression_size(&leaves[id], input, estimator))
        .collect();
    let allow_hash: Vec<_> = ids
        .iter()
        .map(|&id| {
            // Only V3 requires an actual RHS hint before choosing an unbound
            // scan over a legal indexed probe. Some estimators decline individual
            // leaves; registration of an estimator alone is not evidence.
            cost_model != BoundedJoinCostModel::CorrelatedV3
                || match &leaves[id] {
                    QueryExpression::QuadPattern {
                        subject,
                        predicate,
                        object,
                        graph_name,
                    } => {
                        !has_bound_pattern_variable(
                            subject,
                            predicate,
                            object,
                            graph_name.as_ref(),
                            input,
                        ) && estimator
                            .and_then(|e| {
                                e.estimate_quad_pattern(
                                    subject,
                                    predicate,
                                    object,
                                    graph_name.as_ref(),
                                )
                            })
                            .is_some()
                    }
                    _ => false,
                }
        })
        .collect();
    let mut types = vec![input.clone(); count];
    let mut rows = vec![0_u64; count];
    let mut connected = vec![false; count];
    // A subset's size is independent of its selected execution order. Use a
    // canonical ascending-ordinal fold of the legacy shared-key selectivity.
    for mask in 1..count {
        let last = usize::try_from(usize::BITS - mask.leading_zeros() - 1).ok()?;
        let previous = mask ^ (1 << last);
        types[mask] = types[previous].clone();
        let keys = join_key_variables(&types[previous], &leaf_types[ids[last]], input);
        types[mask].intersect_with(leaf_types[ids[last]].clone());
        connected[mask] = mask.is_power_of_two()
            || ids.iter().enumerate().any(|(last, &id)| {
                let prefix = mask ^ (1 << last);
                mask & (1 << last) != 0
                    && connected[prefix]
                    && has_common_variables(&types[prefix], &leaf_types[id], input)
            });
        rows[mask] = if previous == 0 {
            sizes[last]
        } else {
            let numerator = u128::from(rows[previous]) * u128::from(sizes[last]);
            let denominator = 1_000_u128.saturating_pow(keys.len().try_into().ok()?);
            // Nonzero hints do not round an entire connected subset to zero.
            u64::try_from((numerator / denominator).min(u128::from(u64::MAX)))
                .ok()?
                .max(u64::from(numerator != 0))
        };
        if cost_model != BoundedJoinCostModel::IndependentV1 && previous != 0 {
            // Plan-independent conditional estimates: a join cannot produce
            // more estimated rows than a preceding subset times its bound
            // leaf probe estimate. Consider every connected last-leaf choice,
            // not only the eventually selected physical plan. These remain
            // advisory hints, not semantic upper bounds or elimination rules.
            for (last, &id) in ids.iter().enumerate() {
                if mask & (1 << last) == 0 {
                    continue;
                }
                let prefix = mask ^ (1 << last);
                if !connected[prefix]
                    || !has_common_variables(&types[prefix], &leaf_types[id], input)
                {
                    continue;
                }
                let probe = conditional_probe_rows(&leaves[id], &types[prefix], estimator);
                rows[mask] = rows[mask].min(rows[prefix].saturating_mul(probe));
            }
        }
    }
    let mut states: Vec<Option<State>> = vec![None; count];
    for (i, &id) in ids.iter().enumerate() {
        states[1 << i] = Some(State {
            expression: leaves[id].clone(),
            work: u128::from(sizes[i]),
            order: vec![id],
        });
        report.dp_states += 1;
    }
    for mask in 1_usize..count {
        if mask.count_ones() < 2 {
            continue;
        }
        let mut best: Option<(State, u8)> = None;
        for (last, &id) in ids.iter().enumerate() {
            if mask & (1 << last) == 0 {
                continue;
            }
            let previous = mask ^ (1 << last);
            let Some(parent) = &states[previous] else {
                continue;
            };
            let keys = join_key_variables(&types[previous], &leaf_types[id], input);
            if keys.is_empty() {
                continue;
            }
            let mut order = parent.order.clone();
            order.push(id);
            let mut consider = |expression, work, operator| {
                report.dp_candidates += 1;
                let candidate = State {
                    expression,
                    work,
                    order: order.clone(),
                };
                if best.as_ref().is_none_or(|(old, old_operator)| {
                    (candidate.work, &candidate.order, operator)
                        < (old.work, &old.order, *old_operator)
                }) {
                    best = Some((candidate, operator));
                }
            };
            // Charge both leaf scans consistently, hash build/probe, and output.
            let hash_work = parent
                .work
                .saturating_add(u128::from(rows[previous]))
                .saturating_add(2 * u128::from(sizes[last]))
                .saturating_add(u128::from(rows[mask]));
            #[cfg(feature = "sep-0006")]
            let can_probe = is_fit_for_for_loop_join(&leaves[id], input, &types[previous]);
            #[cfg(not(feature = "sep-0006"))]
            let can_probe = false;
            if allow_hash[last] || !can_probe {
                consider(
                    QueryExpression::join(
                        parent.expression.clone(),
                        leaves[id].clone(),
                        JoinAlgorithm::HashBuildLeftProbeRight { keys },
                    ),
                    hash_work,
                    0,
                );
            }
            #[cfg(feature = "sep-0006")]
            {
                // The right input is one eligible quad, never a path, SERVICE
                // or scoped expression. Reuse the existing admission proof.
                if can_probe {
                    let work = if cost_model == BoundedJoinCostModel::CorrelatedV3 {
                        // The RHS is one admitted quad, so its matching rows
                        // and the join's output are the same occurrences. Use
                        // the same subset hint for both charges, plus one
                        // range lookup per parent. Scan and emission remain
                        // separate work; this is not an output deduplication.
                        parent
                            .work
                            .saturating_add(u128::from(rows[previous]))
                            .saturating_add(2 * u128::from(rows[mask]))
                    } else {
                        let probe_rows = if cost_model == BoundedJoinCostModel::IndependentV1 {
                            estimate_query_expression_size(&leaves[id], &types[previous], estimator)
                        } else {
                            conditional_probe_rows(&leaves[id], &types[previous], estimator)
                        };
                        parent
                            .work
                            .saturating_add(
                                u128::from(rows[previous])
                                    .saturating_mul(1 + u128::from(probe_rows)),
                            )
                            .saturating_add(u128::from(rows[mask]))
                    };
                    consider(
                        QueryExpression::lateral(parent.expression.clone(), leaves[id].clone()),
                        work,
                        1,
                    );
                }
            }
        }
        if let Some((state, _)) = best {
            states[mask] = Some(state);
            report.dp_states += 1;
        }
    }
    states.pop()?.map(|s| s.expression)
}

fn conditional_probe_rows(
    leaf: &QueryExpression,
    input: &VariableTypes,
    estimator: Option<&dyn CardinalityEstimator>,
) -> u64 {
    let estimate = estimate_query_expression_size(leaf, input, estimator);
    // A fully specified quad is a membership lookup in one RDF graph. The
    // heuristic's rdf:type +1 is a tie bias, not a second matching row. Do not
    // apply this correction to a variable graph that is not already bound.
    if let QueryExpression::QuadPattern {
        subject,
        predicate,
        object,
        graph_name,
    } = leaf
    {
        if is_term_pattern_bound(subject, input)
            && is_named_node_pattern_bound(predicate, input)
            && is_term_pattern_bound(object, input)
            && graph_name
                .as_ref()
                .is_none_or(|g| is_named_node_pattern_bound(g, input))
        {
            return estimate.min(1);
        }
    }
    estimate
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxrdf::NamedNode;
    use spargebra::{Query, SparqlParser};

    struct Counts;
    impl CardinalityEstimator for Counts {
        fn estimate_quad_pattern(
            &self,
            _: &GroundTermPattern,
            predicate: &NamedNodePattern,
            _: &GroundTermPattern,
            _: Option<&NamedNodePattern>,
        ) -> Option<u64> {
            Some(
                if matches!(predicate, NamedNodePattern::NamedNode(n) if n.as_str() == "urn:pa") {
                    500
                } else {
                    1000
                },
            )
        }
    }
    fn parse(query: &str) -> QueryExpression {
        let Query::Select(query) = SparqlParser::new().parse_query(query).unwrap() else {
            panic!("SELECT")
        };
        QueryExpression::from(&query.expression)
    }
    fn leaf_order(plan: &QueryExpression) -> Vec<String> {
        match plan {
            QueryExpression::QuadPattern { predicate, .. } => vec![predicate.to_string()],
            QueryExpression::Join { left, right, .. } => {
                [leaf_order(left), leaf_order(right)].concat()
            }
            #[cfg(feature = "sep-0006")]
            QueryExpression::Lateral { left, right } => {
                [leaf_order(left), leaf_order(right)].concat()
            }
            QueryExpression::Project { inner, .. } | QueryExpression::Filter { inner, .. } => {
                leaf_order(inner)
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    #[test]
    #[cfg(feature = "sep-0006")]
    fn conditional_costs_start_selective_features_before_type_membership() {
        let input = parse(
            "SELECT * { ?s <urn:label> ?label . ?s a <urn:Class> . ?s <urn:feature> <urn:a> . ?s <urn:feature> <urn:b> . ?s <urn:numeric> ?n FILTER(?n > 0) }",
        );
        let (v1, _) = Optimizer::optimize_query_expression_with_join_planning(
            input.clone(),
            None,
            Some(BoundedJoinPlanning::default()),
        );
        assert_eq!(leaf_order(&v1)[0], rdf::TYPE.to_string());
        let options =
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2);
        let (v2, report) =
            Optimizer::optimize_query_expression_with_join_planning(input, None, Some(options));
        assert_eq!(leaf_order(&v2)[0], "<urn:feature>");
        assert_eq!(report.bounded, Some(options));
        assert_eq!(report.dp_components, 1);
    }
    #[test]
    fn bounded_search_selects_a_pair_greedy_cannot_start_with() {
        let input = parse("SELECT * WHERE { ?a <urn:pa> ?z . ?x <urn:pb> ?z . ?x <urn:pc> ?z }");
        let greedy = Optimizer::optimize_query_expression_with_cardinality_estimator(
            input.clone(),
            Some(&Counts),
        );
        let (bounded, report) = Optimizer::optimize_query_expression_with_join_planning(
            input,
            Some(&Counts),
            Some(BoundedJoinPlanning::default()),
        );
        assert_eq!(leaf_order(&greedy)[0], "<urn:pa>");
        assert_eq!(leaf_order(&bounded), ["<urn:pb>", "<urn:pc>", "<urn:pa>"]);
        assert_eq!(report.dp_components, 1);
        assert_eq!(report.greedy_components, 0);
        assert_eq!(report.dp_states, 7);
        assert!(report.dp_candidates >= 9);
    }
    #[test]
    fn eight_leaf_bound_and_nine_leaf_fallback_are_deterministic() {
        for model in [
            BoundedJoinCostModel::IndependentV1,
            BoundedJoinCostModel::ConditionalV2,
            BoundedJoinCostModel::CorrelatedV3,
        ] {
            let options = BoundedJoinPlanning::default().with_cost_model(model);
            for n in [8, 9] {
                let body = (0..n)
                    .map(|i| format!("?s <urn:p{i}> ?o{i} ."))
                    .collect::<String>();
                let input = parse(&format!("SELECT * WHERE {{ {body} }}"));
                let (first, report) = Optimizer::optimize_query_expression_with_join_planning(
                    input.clone(),
                    Some(&Counts),
                    Some(options),
                );
                assert_eq!(report.dp_components, usize::from(n == 8));
                assert_eq!(report.greedy_components, usize::from(n == 9));
                assert!(report.dp_states <= 255);
                assert!(report.dp_candidates <= 4096);
                assert_eq!(leaf_order(&first).len(), n);
                for _ in 0..10 {
                    let (again, again_report) =
                        Optimizer::optimize_query_expression_with_join_planning(
                            input.clone(),
                            Some(&Counts),
                            Some(options),
                        );
                    assert_eq!(format!("{first:?}"), format!("{again:?}"));
                    assert_eq!(report, again_report);
                }
                if n == 9 {
                    assert_eq!(
                        first,
                        Optimizer::optimize_query_expression_with_cardinality_estimator(
                            input,
                            Some(&Counts)
                        )
                    );
                }
            }
        }
    }
    #[test]
    fn bound_is_per_connected_component_and_keeps_duplicate_leaves() {
        let input =
            parse("SELECT * { ?s <urn:p> ?o . ?s <urn:p> ?o . ?a <urn:q> ?b . ?a <urn:r> ?c }");
        let (plan, report) = Optimizer::optimize_query_expression_with_join_planning(
            input,
            Some(&Counts),
            Some(BoundedJoinPlanning::new(2).unwrap()),
        );
        assert_eq!(report.dp_components, 2);
        assert_eq!(
            leaf_order(&plan)
                .iter()
                .filter(|p| p.as_str() == "<urn:p>")
                .count(),
            2
        );
        assert!(BoundedJoinPlanning::new(0).is_none());
        assert!(BoundedJoinPlanning::new(9).is_none());
        assert!(BoundedJoinPlanning::new(255).is_none());
    }
    #[test]
    fn unsupported_join_group_keeps_the_exact_greedy_plan() {
        for query in [
            "SELECT * { ?s <urn:p> ?o . ?o <urn:q>* ?x }",
            "SELECT * { ?s <urn:p> ?o . SERVICE SILENT <urn:remote> { ?s <urn:q> ?v } }",
            "SELECT * { GRAPH <urn:a> { ?s <urn:p> ?o } GRAPH <urn:b> { ?s <urn:q> ?v } }",
        ] {
            let input = parse(query);
            let (bounded, report) = Optimizer::optimize_query_expression_with_join_planning(
                input.clone(),
                Some(&Counts),
                Some(BoundedJoinPlanning::default()),
            );
            assert_eq!(report.dp_components, 0);
            assert_eq!(
                bounded,
                Optimizer::optimize_query_expression_with_cardinality_estimator(
                    input,
                    Some(&Counts)
                )
            );
        }
    }

    #[test]
    fn extreme_hints_do_not_overflow_or_eliminate_leaves() {
        struct Fixed(u64);
        impl CardinalityEstimator for Fixed {
            fn estimate_quad_pattern(
                &self,
                _: &GroundTermPattern,
                _: &NamedNodePattern,
                _: &GroundTermPattern,
                _: Option<&NamedNodePattern>,
            ) -> Option<u64> {
                Some(self.0)
            }
        }
        let input = parse("SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?o . ?s <urn:r> ?x }");
        for model in [
            BoundedJoinCostModel::IndependentV1,
            BoundedJoinCostModel::ConditionalV2,
            BoundedJoinCostModel::CorrelatedV3,
        ] {
            let options = BoundedJoinPlanning::default().with_cost_model(model);
            for hint in [0, 1, u64::MAX] {
                let (plan, report) = Optimizer::optimize_query_expression_with_join_planning(
                    input.clone(),
                    Some(&Fixed(hint)),
                    Some(options),
                );
                assert_eq!(leaf_order(&plan).len(), 3);
                assert_eq!(report.dp_components, 1);
                let (again, again_report) = Optimizer::optimize_query_expression_with_join_planning(
                    input.clone(),
                    Some(&Fixed(hint)),
                    Some(options),
                );
                assert_eq!(plan, again);
                assert_eq!(report, again_report);
            }
        }
    }

    #[test]
    fn conditional_membership_requires_a_single_bound_graph() {
        let leaf = QueryExpression::QuadPattern {
            subject: NamedNode::new_unchecked("urn:s").into(),
            predicate: rdf::TYPE.into(),
            object: NamedNode::new_unchecked("urn:Class").into(),
            graph_name: None,
        };
        let input = VariableTypes::default();
        assert_eq!(estimate_query_expression_size(&leaf, &input, None), 2);
        assert_eq!(conditional_probe_rows(&leaf, &input, None), 1);
        let QueryExpression::QuadPattern {
            subject,
            predicate,
            object,
            ..
        } = leaf
        else {
            unreachable!()
        };
        let named = QueryExpression::QuadPattern {
            subject: subject.clone(),
            predicate: predicate.clone(),
            object: object.clone(),
            graph_name: Some(NamedNode::new_unchecked("urn:g").into()),
        };
        assert_eq!(conditional_probe_rows(&named, &input, None), 1);
        let variable = QueryExpression::QuadPattern {
            subject,
            predicate,
            object,
            graph_name: Some(Variable::new_unchecked("g").into()),
        };
        assert_eq!(
            conditional_probe_rows(&variable, &input, None),
            estimate_query_expression_size(&variable, &input, None)
        );
        let bound = infer_query_expression_types(&variable, input);
        assert_eq!(conditional_probe_rows(&variable, &bound, None), 1);
        assert_eq!(
            BoundedJoinPlanning::default().cost_model(),
            BoundedJoinCostModel::IndependentV1
        );
        assert_eq!(
            BoundedJoinPlanning::COST_MODEL,
            BoundedJoinCostModel::IndependentV1.id()
        );
    }

    #[test]
    #[cfg(feature = "sep-0006")]
    fn correlated_hash_requires_a_leaf_hint_but_keeps_expanding_hash_joins() {
        struct Hint(Option<u64>, bool);
        impl CardinalityEstimator for Hint {
            fn estimate_quad_pattern(
                &self,
                _: &GroundTermPattern,
                predicate: &NamedNodePattern,
                _: &GroundTermPattern,
                _: Option<&NamedNodePattern>,
            ) -> Option<u64> {
                if self.1
                    && matches!(predicate, NamedNodePattern::NamedNode(n) if n.as_str() == "urn:q")
                {
                    None
                } else {
                    self.0
                }
            }
        }
        fn has_hash(plan: &QueryExpression) -> bool {
            match plan {
                QueryExpression::Join { .. } => true,
                QueryExpression::Lateral { left, right } => has_hash(left) || has_hash(right),
                QueryExpression::Project { inner, .. } | QueryExpression::Filter { inner, .. } => {
                    has_hash(inner)
                }
                QueryExpression::QuadPattern { .. } => false,
                other => panic!("unexpected {other:?}"),
            }
        }
        let input = parse("SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v }");
        let options =
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::CorrelatedV3);
        for hint in [None, Some(100_000)] {
            let (plan, report) = Optimizer::optimize_query_expression_with_join_planning(
                input.clone(),
                Some(&Hint(hint, false)),
                Some(options),
            );
            assert_eq!(report.dp_components, 1);
            // An installed-but-declining estimator is still unhinted. With
            // large actual hints the estimated expanding join favors a scan.
            assert_eq!(has_hash(&plan), hint.is_some());
        }
        let (mixed, _) = Optimizer::optimize_query_expression_with_join_planning(
            input.clone(),
            Some(&Hint(Some(1_000_000), true)),
            Some(options),
        );
        assert!(has_hash(&mixed));
        assert_eq!(
            leaf_order(&mixed),
            ["<urn:q>", "<urn:p>"],
            "only the hinted p leaf may be the hash RHS"
        );
        let (plan, _) =
            Optimizer::optimize_query_expression_with_join_planning(input, None, Some(options));
        assert!(!has_hash(&plan));
    }

    #[test]
    #[cfg(feature = "sep-0006")]
    fn conditional_estimates_require_an_executable_connected_prefix() {
        struct Counts;
        impl CardinalityEstimator for Counts {
            fn estimate_quad_pattern(
                &self,
                _: &GroundTermPattern,
                predicate: &NamedNodePattern,
                _: &GroundTermPattern,
                _: Option<&NamedNodePattern>,
            ) -> Option<u64> {
                Some(match predicate {
                    NamedNodePattern::NamedNode(n) if n.as_str() == "urn:p0" => 2,
                    NamedNodePattern::NamedNode(n) if n.as_str() == "urn:bridge" => 1_000_000_000,
                    _ => 1,
                })
            }
        }
        let input = parse(
            "SELECT * { <urn:a> <urn:p0> ?x . <urn:b> <urn:p1> ?x . <urn:c> <urn:p2> ?y . ?y <urn:bridge> ?x }",
        );
        let (plan, report) = Optimizer::optimize_query_expression_with_join_planning(
            input,
            Some(&Counts),
            Some(
                BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2),
            ),
        );
        // A disconnected {p0,p2} prefix cannot bind both bridge endpoints
        // before probing it in this connected left-deep search.
        assert_eq!(
            leaf_order(&plan),
            ["<urn:p2>", "<urn:bridge>", "<urn:p0>", "<urn:p1>"]
        );
        assert_eq!(report.dp_components, 1);
    }

    #[test]
    fn join_key_order_is_canonical() {
        let leaf = parse("SELECT * { ?z ?b ?a }");
        let types = infer_query_expression_types(&leaf, VariableTypes::default());
        assert_eq!(
            join_key_variables(&types, &types, &VariableTypes::default())
                .iter()
                .map(Variable::as_str)
                .collect::<Vec<_>>(),
            ["a", "b", "z"]
        );
    }

    #[test]
    fn component_discovery_stops_at_the_fallback_boundary() {
        let input = VariableTypes::default();
        let leaf = parse("SELECT * { ?s <urn:p> ?o }");
        let types = vec![infer_query_expression_types(&leaf, input.clone()); 100];
        let remaining = vec![true; types.len()];
        for bound in [1, 2, 8] {
            let ids = component_ids(0, &types, &remaining, &input, bound);
            assert_eq!(ids.len(), bound + 1);
        }
    }
}
