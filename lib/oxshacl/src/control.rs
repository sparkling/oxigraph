use crate::profile::ProfileError;
use oxrdf::NamedNode;
use std::time::Duration;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Cancellation token shared with the Datalog evaluator.
///
/// Sharing the token directly lets Datalog-backed SHACL Rules observe
/// cancellation without a polling bridge, including on WebAssembly. On
/// synchronous WebAssembly, callers cannot interrupt execution from the same
/// event loop; cancellation is still checked before and between bounded
/// operations.
pub type CancellationToken = oxdatalog::CancellationToken;

/// Resource category reported when validation exceeds a configured limit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LimitKind {
    /// Number of quads in the data graph snapshot.
    DataQuads,
    /// Number of quads in the shapes graph snapshot.
    ShapeQuads,
    /// Number of compiled shapes.
    Shapes,
    /// Number of compiled constraint instances.
    Constraints,
    /// Number of focus-node evaluations.
    FocusNodes,
    /// Number of validation results.
    Results,
    /// Number of property-path traversal visits.
    PathVisits,
    /// Number of RDF-list items consumed.
    ListItems,
    /// Recursive shape or expression evaluation depth.
    RecursionDepth,
    /// Size of one SPARQL query in bytes.
    QueryBytes,
    /// Number of SPARQL solutions consumed.
    QuerySolutions,
    /// Number of rule-fixpoint iterations.
    RuleIterations,
    /// Number of triples derived by rules.
    DerivedTriples,
    /// Deterministic estimate of processor-owned memory.
    EstimatedMemory,
    /// Wall-clock elapsed time.
    Time,
}

/// Explicit resource ceilings for compilation, validation, and rule execution.
///
/// Limits are checked before and during bounded operations. Memory accounting is
/// deterministic and implementation-defined; it is not an allocator-precise
/// heap measurement.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationLimits {
    /// Maximum quads accepted in a data snapshot.
    pub max_data_quads: usize,
    /// Maximum quads accepted in a shapes snapshot, including resolved imports.
    pub max_shape_quads: usize,
    /// Maximum compiled shapes.
    pub max_shapes: usize,
    /// Maximum compiled constraint instances.
    pub max_constraints: usize,
    /// Maximum focus-node evaluations.
    pub max_focus_nodes: usize,
    /// Maximum validation results.
    pub max_results: usize,
    /// Maximum property-path traversal visits.
    pub max_path_visits: usize,
    /// Maximum RDF-list items consumed during compilation or evaluation.
    pub max_list_items: usize,
    /// Maximum recursive shape or node-expression depth.
    pub max_recursion_depth: usize,
    /// Maximum bytes in one SPARQL query.
    pub max_query_bytes: usize,
    /// Maximum SPARQL solutions consumed by one operation.
    pub max_query_solutions: usize,
    /// Maximum rule-fixpoint iterations.
    pub max_rule_iterations: usize,
    /// Maximum triples produced by rule execution.
    pub max_derived_triples: usize,
    /// Maximum deterministic estimate of processor-owned memory in bytes.
    pub max_estimated_memory_bytes: usize,
    /// Optional wall-clock deadline measured from the start of an operation.
    pub timeout: Option<Duration>,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            max_data_quads: 1_000_000,
            max_shape_quads: 100_000,
            max_shapes: 10_000,
            max_constraints: 100_000,
            max_focus_nodes: 1_000_000,
            max_results: 100_000,
            max_path_visits: 2_000_000,
            max_list_items: 100_000,
            max_recursion_depth: 64,
            max_query_bytes: 1_000_000,
            max_query_solutions: 100_000,
            max_rule_iterations: 1_000,
            max_derived_triples: 1_000_000,
            max_estimated_memory_bytes: 256 * 1024 * 1024,
            timeout: Some(Duration::from_secs(30)),
        }
    }
}

/// Runtime policy supplied to compilation, validation, and rule execution.
#[derive(Clone, Debug)]
pub struct ValidationOptions {
    /// Resource ceilings enforced by the processor.
    pub limits: ValidationLimits,
    /// Cooperative cancellation token for the operation.
    pub cancellation_token: CancellationToken,
    /// Result severities that make a report non-conformant.
    pub conformance_disallows: Vec<NamedNode>,
    /// Includes shapes-graph `rdfs:subClassOf` triples in SHACL type checks.
    pub sub_class_of_in_shapes_graph: bool,
    /// Emits `sh:shapesGraphWellFormed true` only for a certifying checked compile.
    pub report_shapes_graph_well_formed: bool,
}

impl Default for ValidationOptions {
    fn default() -> Self {
        Self {
            limits: ValidationLimits::default(),
            cancellation_token: CancellationToken::default(),
            conformance_disallows: ["Violation", "Warning", "Info"]
                .into_iter()
                .map(|local| {
                    NamedNode::new_unchecked(format!("http://www.w3.org/ns/shacl#{local}"))
                })
                .collect(),
            sub_class_of_in_shapes_graph: false,
            report_shapes_graph_well_formed: false,
        }
    }
}

/// Failure produced while compiling or evaluating bounded SHACL input.
#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    /// The caller cancelled the operation.
    #[error("validation was cancelled")]
    Cancelled,
    /// A configured resource ceiling was exceeded.
    #[error("{kind:?} limit of {limit} exceeded")]
    LimitExceeded {
        /// Category of the exhausted resource.
        kind: LimitKind,
        /// Configured ceiling.
        limit: usize,
    },
    /// Profile selection or conformance verification failed.
    #[error(transparent)]
    Profile(#[from] ProfileError),
    /// A referenced shape is absent from the compiled shapes graph.
    #[error("shape `{0}` is not defined")]
    UnknownShape(String),
    /// A recursive shape dependency was encountered.
    #[error("recursive shape dependency involving `{0}` is unsupported")]
    RecursiveShape(String),
    /// The supplied SHACL graph is syntactically or structurally ill-formed.
    #[error("ill-formed SHACL input: {0}")]
    IllFormed(String),
    /// The request uses a feature outside the selected bounded profile.
    #[error("unsupported SHACL feature: {0}")]
    UnsupportedFeature(String),
    /// Sandboxed SPARQL parsing or evaluation failed.
    #[error("SPARQL failure: {0}")]
    Sparql(String),
    /// SHACL rule compilation or evaluation failed.
    #[error("rule failure: {0}")]
    Rule(String),
}

pub(crate) struct Budget<'a> {
    options: &'a ValidationOptions,
    started: Instant,
    estimated_memory: usize,
    path_visits: usize,
    focus_nodes: usize,
    results: usize,
    #[cfg(feature = "sparql")]
    query_solutions: usize,
}

impl<'a> Budget<'a> {
    pub(crate) fn new(options: &'a ValidationOptions) -> Result<Self, ValidationError> {
        let budget = Self {
            options,
            started: Instant::now(),
            estimated_memory: 0,
            path_visits: 0,
            focus_nodes: 0,
            results: 0,
            #[cfg(feature = "sparql")]
            query_solutions: 0,
        };
        budget.check()?;
        Ok(budget)
    }

    pub(crate) fn check(&self) -> Result<(), ValidationError> {
        if self.options.cancellation_token.is_cancelled() {
            return Err(ValidationError::Cancelled);
        }
        if let Some(timeout) = self.options.limits.timeout
            && self.started.elapsed() >= timeout
        {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: timeout.as_millis().try_into().unwrap_or(usize::MAX),
            });
        }
        Ok(())
    }

    pub(crate) fn charge_memory(&mut self, bytes: usize) -> Result<(), ValidationError> {
        self.estimated_memory = self.estimated_memory.saturating_add(bytes);
        self.limit(
            self.estimated_memory,
            self.options.limits.max_estimated_memory_bytes,
            LimitKind::EstimatedMemory,
        )
    }

    pub(crate) fn path_visit(&mut self) -> Result<(), ValidationError> {
        self.path_visits = self.path_visits.saturating_add(1);
        self.limit(
            self.path_visits,
            self.options.limits.max_path_visits,
            LimitKind::PathVisits,
        )
    }

    pub(crate) fn focus(&mut self) -> Result<(), ValidationError> {
        self.focus_nodes = self.focus_nodes.saturating_add(1);
        self.limit(
            self.focus_nodes,
            self.options.limits.max_focus_nodes,
            LimitKind::FocusNodes,
        )
    }

    pub(crate) fn result(&mut self) -> Result<(), ValidationError> {
        self.results = self.results.saturating_add(1);
        self.limit(
            self.results,
            self.options.limits.max_results,
            LimitKind::Results,
        )
    }

    #[cfg(feature = "sparql")]
    pub(crate) fn query_solution(&mut self) -> Result<(), ValidationError> {
        self.query_solutions = self.query_solutions.saturating_add(1);
        self.limit(
            self.query_solutions,
            self.options.limits.max_query_solutions,
            LimitKind::QuerySolutions,
        )
    }

    pub(crate) fn estimated_memory(&self) -> usize {
        self.estimated_memory
    }

    pub(crate) fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }

    pub(crate) fn limits(&self) -> &ValidationLimits {
        &self.options.limits
    }

    #[cfg(all(feature = "sparql", not(target_family = "wasm")))]
    pub(crate) fn cancellation_token(&self) -> CancellationToken {
        self.options.cancellation_token.clone()
    }

    pub(crate) fn remaining_timeout(&self) -> Option<Duration> {
        self.options
            .limits
            .timeout
            .map(|timeout| timeout.saturating_sub(self.started.elapsed()))
    }

    fn limit(&self, value: usize, limit: usize, kind: LimitKind) -> Result<(), ValidationError> {
        self.check()?;
        if value > limit {
            Err(ValidationError::LimitExceeded { kind, limit })
        } else {
            Ok(())
        }
    }
}
