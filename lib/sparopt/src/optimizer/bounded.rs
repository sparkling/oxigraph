//! Bounded left-deep subset search. Estimates affect ordering, never query truth.
use super::*;

/// Explicit opt-in profile; no default-planner or measured-speed promotion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundedJoinPlanning {
    max_dp_leaves: u8,
}
impl BoundedJoinPlanning {
    pub const COST_MODEL: &str = "oxigraph.join-work.v1";
    pub const MAX_DP_LEAVES: u8 = 8;

    /// Rejects zero or a bound above the reviewed eight-leaf ceiling.
    pub const fn new(max_dp_leaves: u8) -> Option<Self> {
        if max_dp_leaves > 0 && max_dp_leaves <= Self::MAX_DP_LEAVES {
            Some(Self { max_dp_leaves })
        } else {
            None
        }
    }
    pub const fn max_dp_leaves(self) -> u8 {
        self.max_dp_leaves
    }
}
impl Default for BoundedJoinPlanning {
    fn default() -> Self {
        Self {
            max_dp_leaves: Self::MAX_DP_LEAVES,
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
    let mut types = vec![input.clone(); count];
    let mut rows = vec![0_u64; count];
    // A subset's size is independent of its selected execution order. Use a
    // canonical ascending-ordinal fold of the legacy shared-key selectivity.
    for mask in 1..count {
        let last = usize::try_from(usize::BITS - mask.leading_zeros() - 1).ok()?;
        let previous = mask ^ (1 << last);
        types[mask] = types[previous].clone();
        let keys = join_key_variables(&types[previous], &leaf_types[ids[last]], input);
        types[mask].intersect_with(leaf_types[ids[last]].clone());
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
            consider(
                QueryExpression::join(
                    parent.expression.clone(),
                    leaves[id].clone(),
                    JoinAlgorithm::HashBuildLeftProbeRight { keys },
                ),
                hash_work,
                0,
            );
            #[cfg(feature = "sep-0006")]
            {
                // The right input is one eligible quad, never a path, SERVICE
                // or scoped expression. Reuse the existing admission proof.
                if is_fit_for_for_loop_join(&leaves[id], input, &types[previous]) {
                    let probe_rows =
                        estimate_query_expression_size(&leaves[id], &types[previous], estimator);
                    let work = parent
                        .work
                        .saturating_add(
                            u128::from(rows[previous]).saturating_mul(1 + u128::from(probe_rows)),
                        )
                        .saturating_add(u128::from(rows[mask]));
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

#[cfg(test)]
mod tests {
    use super::*;
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
            QueryExpression::Project { inner, .. } => leaf_order(inner),
            other => panic!("unexpected {other:?}"),
        }
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
        for n in [8, 9] {
            let body = (0..n)
                .map(|i| format!("?s <urn:p{i}> ?o{i} ."))
                .collect::<String>();
            let input = parse(&format!("SELECT * WHERE {{ {body} }}"));
            let (first, report) = Optimizer::optimize_query_expression_with_join_planning(
                input.clone(),
                Some(&Counts),
                Some(BoundedJoinPlanning::default()),
            );
            assert_eq!(report.dp_components, usize::from(n == 8));
            assert_eq!(report.greedy_components, usize::from(n == 9));
            assert!(report.dp_states <= 255);
            assert!(report.dp_candidates <= 4096);
            assert_eq!(leaf_order(&first).len(), n);
            for _ in 0..10 {
                let (again, again_report) = Optimizer::optimize_query_expression_with_join_planning(
                    input.clone(),
                    Some(&Counts),
                    Some(BoundedJoinPlanning::default()),
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
        for hint in [0, 1, u64::MAX] {
            let (plan, report) = Optimizer::optimize_query_expression_with_join_planning(
                input.clone(),
                Some(&Fixed(hint)),
                Some(BoundedJoinPlanning::default()),
            );
            assert_eq!(leaf_order(&plan).len(), 3);
            assert_eq!(report.dp_components, 1);
            let (again, again_report) = Optimizer::optimize_query_expression_with_join_planning(
                input.clone(),
                Some(&Fixed(hint)),
                Some(BoundedJoinPlanning::default()),
            );
            assert_eq!(plan, again);
            assert_eq!(report, again_report);
        }
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
