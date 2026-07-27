use crate::{
    IMPLEMENTED_RULES, OMITTED_PATTERNS, RDFS_12_ENTAILMENT_PROFILE, RDFS_D0_PROFILE,
    rules::rdfs_d0_program,
};
use oxdatalog::{
    EvaluationError, EvaluationOptions, EvaluationResult, LimitKind, Program,
    rdf::{self as datalog_rdf, EntailedDataset, RdfClosure, RdfEvaluationError},
};
use oxrdf::{
    Dataset, GraphName, NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};
use std::collections::{HashMap, HashSet};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Typed rejection of a full RDFS 1.2 entailment claim.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error(
    "{requested} conformance is unavailable: {available} implements \
     {implemented_rule_count} patterns, omits {omitted_pattern_count}, and \
     does not materialize axiomatic triples"
)]
pub struct RdfsD0ConformanceError {
    requested: &'static str,
    available: &'static str,
    implemented_rule_count: usize,
    omitted_pattern_count: usize,
}

impl RdfsD0ConformanceError {
    /// Returns the profile identifier whose conformance was requested.
    pub fn requested(&self) -> &'static str {
        self.requested
    }
    /// Returns the bounded profile identifier that is actually available.
    pub fn available(&self) -> &'static str {
        self.available
    }
    /// Returns the number of RDFS patterns implemented by the available profile.
    pub fn implemented_rule_count(&self) -> usize {
        self.implemented_rule_count
    }
    /// Returns the number of published patterns omitted by the available profile.
    pub fn omitted_pattern_count(&self) -> usize {
        self.omitted_pattern_count
    }
}

/// Input outside the legal-RDF, named-property boundary of `rdfs-d0`.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum RdfsD0InputError {
    /// A schema statement uses a generalized predicate.
    #[error(
        "property expression must be a named node in input quad {quad}; \
         {RDFS_D0_PROFILE} does not use generalized RDF predicates"
    )]
    PropertyExpressionMustBeNamed {
        /// The rejected input quad.
        quad: Box<Quad>,
    },
    /// A schema statement uses a literal or triple term where a resource is required.
    #[error(
        "class expression must be a named or blank node in input quad {quad}; \
         {RDFS_D0_PROFILE} supports resource-valued schema declarations"
    )]
    ClassExpressionMustBeResource {
        /// The rejected input quad.
        quad: Box<Quad>,
    },
    /// An inferred `rdfs:subPropertyOf` target could alter the active rule schema.
    #[error(
        "subproperty target {target} controls schema inference in input quad \
         {quad}; {RDFS_D0_PROFILE} rejects dynamically generated schema \
         declarations"
    )]
    SchemaControlSuperproperty {
        /// The control-sensitive superproperty.
        target: NamedNode,
        /// The input quad that could derive the superproperty declaration.
        quad: Box<Quad>,
    },
    /// An inferred type could dynamically activate a property role.
    #[error(
        "class {target} activates property-role inference in input quad \
         {quad}; {RDFS_D0_PROFILE} requires these roles to be declared \
         directly with rdf:type"
    )]
    SchemaControlClass {
        /// The control-sensitive class.
        target: NamedNode,
        /// The input quad that could derive the role declaration.
        quad: Box<Quad>,
    },
    /// Range inference would place a non-resource term in RDF subject position.
    #[error(
        "range semantics for property {range_property} would require the \
         non-resource object of input quad {quad} in RDF subject position; \
         {RDFS_D0_PROFILE} fails closed"
    )]
    RangeOnNonResource {
        /// The property whose range declaration triggers the invalid consequence.
        range_property: NamedNode,
        /// The input quad with the non-resource object.
        quad: Box<Quad>,
    },
}

/// Failure while validating or evaluating `rdfs-d0`.
#[derive(Debug, thiserror::Error)]
pub enum RdfsD0Error {
    /// The input falls outside the bounded profile.
    #[error(transparent)]
    Input(#[from] RdfsD0InputError),
    /// The underlying bounded RDF Datalog evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
}

/// A bounded RDFS closure with an exact profile receipt.
#[derive(Clone, Debug)]
pub struct RdfsD0Closure {
    inner: RdfClosure,
}

impl RdfsD0Closure {
    /// Returns the unchanged input dataset.
    pub fn base(&self) -> &Dataset {
        self.inner.base()
    }
    /// Returns only quads derived by the profile.
    pub fn inference(&self) -> &Dataset {
        self.inner.inference()
    }
    /// Returns a queryable base-plus-inference dataset view.
    pub fn entailed(&self) -> &EntailedDataset {
        self.inner.entailed()
    }
    /// Returns resource and iteration accounting from the Datalog evaluator.
    pub fn evaluation(&self) -> &EvaluationResult {
        self.inner.evaluation()
    }
    /// Serializes the sorted inference-only dataset as canonical N-Quads text.
    pub fn canonical_inference_nquads(&self) -> String {
        self.inner.canonical_inference_nquads()
    }

    /// Builds deterministic evidence for this closure.
    pub fn receipt(&self) -> RdfsD0Receipt {
        RdfsD0Receipt {
            profile: RDFS_D0_PROFILE,
            implemented_rule_count: IMPLEMENTED_RULES.len(),
            base_quads: self.base().len(),
            derived_quads: self.inference().len(),
            iterations: self.evaluation().iterations(),
            estimated_memory_bytes: self.evaluation().estimated_memory_bytes(),
            canonical_inference_nquads: self.canonical_inference_nquads(),
        }
    }
}

/// Deterministic evidence for one `rdfs-d0` evaluation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RdfsD0Receipt {
    /// Exact bounded profile identifier.
    pub profile: &'static str,
    /// Number of named RDFS patterns compiled into the profile.
    pub implemented_rule_count: usize,
    /// Number of quads in the unchanged input dataset.
    pub base_quads: usize,
    /// Number of inference-only quads.
    pub derived_quads: usize,
    /// Number of evaluator fixpoint iterations.
    pub iterations: usize,
    /// Evaluator-reported memory estimate in bytes.
    pub estimated_memory_bytes: usize,
    /// Sorted inference-only N-Quads, including a final newline when non-empty.
    pub canonical_inference_nquads: String,
}

impl RdfsD0Receipt {
    /// Renders a stable line-oriented representation suitable for hashing.
    pub fn canonical_text(&self) -> String {
        format!(
            "profile={}\nimplemented-rules={}\nbase-quads={}\n\
             derived-quads={}\niterations={}\nestimated-memory-bytes={}\n---\n{}",
            self.profile,
            self.implemented_rule_count,
            self.base_quads,
            self.derived_quads,
            self.iterations,
            self.estimated_memory_bytes,
            self.canonical_inference_nquads
        )
    }
}

/// The `rdfs-d0` compiler and validation boundary.
#[derive(Clone, Debug)]
pub struct RdfsD0 {
    program: Program,
}

impl RdfsD0 {
    /// Compiles the fixed `rdfs-d0` rule program.
    pub fn new() -> Self {
        Self {
            program: rdfs_d0_program(),
        }
    }
    /// Returns the exact profile identifier.
    pub const fn profile_id() -> &'static str {
        RDFS_D0_PROFILE
    }
    /// Returns metadata for every implemented RDFS pattern.
    pub const fn implemented_rules() -> &'static [crate::RdfsRule] {
        IMPLEMENTED_RULES
    }
    /// Returns metadata for the published patterns outside this profile.
    pub const fn omitted_patterns() -> &'static [crate::RdfsRule] {
        OMITTED_PATTERNS
    }
    /// Always rejects a full RDFS 1.2 entailment claim for this partial pack.
    pub fn require_full_conformance() -> Result<(), RdfsD0ConformanceError> {
        Err(RdfsD0ConformanceError {
            requested: RDFS_12_ENTAILMENT_PROFILE,
            available: RDFS_D0_PROFILE,
            implemented_rule_count: IMPLEMENTED_RULES.len(),
            omitted_pattern_count: OMITTED_PATTERNS.len(),
        })
    }
    /// Validates the profile boundary and computes a same-graph RDF closure.
    pub fn evaluate(
        &self,
        base: &Dataset,
        options: &EvaluationOptions,
    ) -> Result<RdfsD0Closure, RdfsD0Error> {
        let started = Instant::now();
        validate_input(base, options, started)?;
        check_control(options, started)?;
        let mut remaining_options = options.clone();
        if let Some(timeout) = options.limits.timeout {
            remaining_options.limits.timeout = Some(timeout.saturating_sub(started.elapsed()));
        }
        Ok(RdfsD0Closure {
            inner: datalog_rdf::evaluate(&self.program, base, &remaining_options)?,
        })
    }
}

impl Default for RdfsD0 {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Default)]
struct GraphSchema {
    reverse_subproperties: HashMap<NamedNode, Vec<NamedNode>>,
    ranged_properties: HashSet<NamedNode>,
}

fn validate_input(
    dataset: &Dataset,
    options: &EvaluationOptions,
    started: Instant,
) -> Result<(), RdfsD0Error> {
    check_control(options, started)?;
    if dataset.len() > options.limits.max_facts {
        return Err(control_error(EvaluationError::LimitExceeded {
            kind: LimitKind::Facts,
            limit: options.limits.max_facts,
        }));
    }
    let mut schemas = HashMap::<GraphName, GraphSchema>::new();
    let mut schema_bytes = 0_usize;
    for quad in dataset {
        check_control(options, started)?;
        validate_schema_quad(&quad)?;
        let graph_schema = schemas.entry(quad.graph_name.clone()).or_default();
        if quad.predicate == rdfs::SUB_PROPERTY_OF {
            let property = subject_named(&quad)?;
            let superproperty = object_named(&quad)?;
            let added_bytes = 96_usize
                .saturating_add(property.as_str().len())
                .saturating_add(superproperty.as_str().len());
            check_schema_memory(schema_bytes.saturating_add(added_bytes), options)?;
            graph_schema
                .reverse_subproperties
                .entry(superproperty.clone())
                .or_default()
                .push(property.clone());
            schema_bytes = schema_bytes.saturating_add(added_bytes);
        } else if quad.predicate == rdfs::RANGE {
            let property = subject_named(&quad)?;
            let added_bytes = 64_usize.saturating_add(property.as_str().len());
            check_schema_memory(schema_bytes.saturating_add(added_bytes), options)?;
            graph_schema.ranged_properties.insert(property.clone());
            schema_bytes = schema_bytes.saturating_add(added_bytes);
        } else if quad.predicate == rdf::TYPE && quad.object == rdfs::CONTAINER_MEMBERSHIP_PROPERTY
        {
            let property = subject_named(&quad)?;
            let added_bytes = 96_usize.saturating_add(property.as_str().len());
            check_schema_memory(schema_bytes.saturating_add(added_bytes), options)?;
            graph_schema
                .reverse_subproperties
                .entry(rdfs::MEMBER)
                .or_default()
                .push(property.clone());
            schema_bytes = schema_bytes.saturating_add(added_bytes);
        }
    }
    for schema in schemas.values_mut() {
        close_ranged_properties(schema, &mut schema_bytes, options, started)?;
    }
    for quad in dataset {
        check_control(options, started)?;
        if !is_resource(&quad.object)
            && let Some(schema) = schemas.get(&quad.graph_name)
            && schema.ranged_properties.contains(&quad.predicate)
        {
            return Err(RdfsD0InputError::RangeOnNonResource {
                range_property: quad.predicate.clone(),
                quad: Box::new(quad.clone()),
            }
            .into());
        }
    }
    Ok(())
}

fn validate_schema_quad(quad: &Quad) -> Result<(), RdfsD0InputError> {
    if quad.predicate == rdfs::SUB_PROPERTY_OF {
        subject_named(quad)?;
        let target = object_named(quad)?;
        if is_schema_control(target) {
            return Err(RdfsD0InputError::SchemaControlSuperproperty {
                target: target.clone(),
                quad: Box::new(quad.clone()),
            });
        }
    }
    if quad.predicate == rdfs::DOMAIN || quad.predicate == rdfs::RANGE {
        subject_named(quad)?;
        require_resource_class(quad)?;
        reject_control_class(quad)?;
    }
    if quad.predicate == rdfs::SUB_CLASS_OF {
        require_resource_class(quad)?;
        reject_control_class(quad)?;
    }
    if quad.predicate == rdf::TYPE
        && matches!(
            &quad.object,
            Term::NamedNode(class)
                if class == &rdf::PROPERTY
                    || class == &rdfs::CONTAINER_MEMBERSHIP_PROPERTY
        )
    {
        subject_named(quad)?;
    }
    Ok(())
}

fn subject_named(quad: &Quad) -> Result<&NamedNode, RdfsD0InputError> {
    if let oxrdf::NamedOrBlankNode::NamedNode(node) = &quad.subject {
        Ok(node)
    } else {
        Err(RdfsD0InputError::PropertyExpressionMustBeNamed {
            quad: Box::new(quad.clone()),
        })
    }
}

fn object_named(quad: &Quad) -> Result<&NamedNode, RdfsD0InputError> {
    if let Term::NamedNode(node) = &quad.object {
        Ok(node)
    } else {
        Err(RdfsD0InputError::PropertyExpressionMustBeNamed {
            quad: Box::new(quad.clone()),
        })
    }
}

fn require_resource_class(quad: &Quad) -> Result<(), RdfsD0InputError> {
    if is_resource(&quad.object) {
        Ok(())
    } else {
        Err(RdfsD0InputError::ClassExpressionMustBeResource {
            quad: Box::new(quad.clone()),
        })
    }
}

fn is_resource(term: &Term) -> bool {
    matches!(term, Term::NamedNode(_) | Term::BlankNode(_))
}

fn is_schema_control(node: &NamedNode) -> bool {
    node == &rdf::TYPE
        || node == &rdfs::DOMAIN
        || node == &rdfs::RANGE
        || node == &rdfs::SUB_PROPERTY_OF
        || node == &rdfs::SUB_CLASS_OF
}

fn reject_control_class(quad: &Quad) -> Result<(), RdfsD0InputError> {
    if quad.object == rdfs::CONTAINER_MEMBERSHIP_PROPERTY {
        Err(RdfsD0InputError::SchemaControlClass {
            target: rdfs::CONTAINER_MEMBERSHIP_PROPERTY,
            quad: Box::new(quad.clone()),
        })
    } else {
        Ok(())
    }
}

fn close_ranged_properties(
    schema: &mut GraphSchema,
    schema_bytes: &mut usize,
    options: &EvaluationOptions,
    started: Instant,
) -> Result<(), RdfsD0Error> {
    check_control(options, started)?;
    let mut pending_bytes = schema
        .ranged_properties
        .iter()
        .map(estimated_node_bytes)
        .fold(0, usize::saturating_add);
    check_schema_memory(schema_bytes.saturating_add(pending_bytes), options)?;
    let mut pending = schema.ranged_properties.iter().cloned().collect::<Vec<_>>();
    while let Some(property) = pending.pop() {
        check_control(options, started)?;
        pending_bytes = pending_bytes.saturating_sub(estimated_node_bytes(&property));
        if let Some(subproperties) = schema.reverse_subproperties.get(&property) {
            for subproperty in subproperties {
                check_control(options, started)?;
                if !schema.ranged_properties.contains(subproperty) {
                    let added_bytes = estimated_node_bytes(subproperty);
                    let projected_schema = schema_bytes.saturating_add(added_bytes);
                    let projected_pending = pending_bytes.saturating_add(added_bytes);
                    check_schema_memory(
                        projected_schema.saturating_add(projected_pending),
                        options,
                    )?;
                    schema.ranged_properties.insert(subproperty.clone());
                    pending.push(subproperty.clone());
                    *schema_bytes = projected_schema;
                    pending_bytes = projected_pending;
                }
            }
        }
    }
    Ok(())
}

fn estimated_node_bytes(node: &NamedNode) -> usize {
    64_usize.saturating_add(node.as_str().len())
}

fn check_schema_memory(
    estimated_bytes: usize,
    options: &EvaluationOptions,
) -> Result<(), RdfsD0Error> {
    if estimated_bytes > options.limits.max_memory_bytes {
        Err(control_error(EvaluationError::LimitExceeded {
            kind: LimitKind::Memory,
            limit: options.limits.max_memory_bytes,
        }))
    } else {
        Ok(())
    }
}

fn check_control(options: &EvaluationOptions, started: Instant) -> Result<(), RdfsD0Error> {
    if options.cancellation_token.is_cancelled() {
        return Err(control_error(EvaluationError::Cancelled));
    }
    if let Some(timeout) = options.limits.timeout
        && started.elapsed() >= timeout
    {
        return Err(control_error(EvaluationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: timeout.as_millis().try_into().unwrap_or(usize::MAX),
        }));
    }
    Ok(())
}

fn control_error(error: EvaluationError) -> RdfsD0Error {
    RdfsD0Error::Evaluation(RdfEvaluationError::Evaluation(error))
}
