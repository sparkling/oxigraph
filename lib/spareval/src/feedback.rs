/// Origin of a leaf estimate, not a confidence or accuracy claim.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EstimateBasis {
    Statistics,
    Heuristic,
}

/// Query-local, opt-in feedback without query text, variable names or RDF terms.
#[derive(Clone, Debug)]
pub struct CardinalityFeedback {
    pub planning_seconds: Option<f64>,
    pub root: CardinalityFeedbackNode,
}

#[derive(Clone, Debug)]
pub struct CardinalityFeedbackNode {
    /// Fixed operator class, never the legacy term-bearing explanation label.
    pub operator: &'static str,
    /// Hypothetical unbound per-invocation estimate; only quad leaves have one
    /// in this profile. It is recomputed when the evaluator is constructed,
    /// not a record of a correlated probe's planning-time cost. The estimator
    /// contract requires deterministic values for the retained dataset.
    pub estimated_rows: Option<u64>,
    pub estimate_basis: Option<EstimateBasis>,
    /// None when compute_statistics was not enabled. Includes intermediate rows.
    pub observed_rows: Option<u64>,
    pub invocations: u64,
    pub completed_invocations: u64,
    pub failed_invocations: u64,
    pub abandoned_invocations: u64,
    pub bound_invocations: u64,
    /// True only for one unbound invocation exhausted without failure.
    pub cardinality_complete: bool,
    /// max(max(estimate,1),max(actual,1))/min(...). Zero is floored to one;
    /// absent for partial, failed, bound, uninvoked or multiply invoked leaves.
    pub q_error: Option<f64>,
    pub children: Vec<Self>,
}
