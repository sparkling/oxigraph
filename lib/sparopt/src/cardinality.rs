use spargebra::term::{GroundTermPattern, NamedNodePattern, Variable};

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

    /// Optional advisory domain size for one variable in this leaf, not an
    /// exact filtered distinct count or a semantic bound. `None` means unknown.
    /// Only the explicit DomainAwareV4 planner consults this method. Existing
    /// estimators and older planner profiles retain their behavior.
    /// Implementations must follow the same source/dataset and memory-only
    /// determinism contract as row hints. The planner restricts requests to a
    /// direct, non-repeated subject/object variable of an unbound quad pattern
    /// with a constant predicate and no variable graph or nested triple terms.
    fn estimate_distinct_values(
        &self,
        _subject: &GroundTermPattern,
        _predicate: &NamedNodePattern,
        _object: &GroundTermPattern,
        _graph_name: Option<&NamedNodePattern>,
        _variable: &Variable,
    ) -> Option<u64> {
        None
    }
}
