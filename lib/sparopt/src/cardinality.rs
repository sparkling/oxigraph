use spargebra::term::{GroundTermPattern, NamedNodePattern};

/// Optional, dataset-scoped cardinality hints. Implementations must be
/// deterministic, memory-only and infallible for one retained source snapshot.
/// `None` selects the existing heuristic. Hints affect costs, never truth or
/// algebra elimination (including a zero hint).
pub trait CardinalityEstimator: Send + Sync {
    fn estimate_quad_pattern(
        &self,
        subject: &GroundTermPattern,
        predicate: &NamedNodePattern,
        object: &GroundTermPattern,
        graph_name: Option<&NamedNodePattern>,
    ) -> Option<u64>;
}
