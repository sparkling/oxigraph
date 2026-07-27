use crate::{
    IMPLEMENTED_RULES, OWL2_RL_RDF_POSITIVE_SEED_PROFILE, OWL2_RL_RDF_PROFILE, Owl2RlSeedReceipt,
    rules::positive_seed_program,
    vocabulary::{
        EQUIVALENT_CLASS, EQUIVALENT_PROPERTY, INVERSE_OF, OWL_NAMESPACE, SAME_AS,
        SYMMETRIC_PROPERTY, TRANSITIVE_PROPERTY,
    },
};
use oxdatalog::{
    EvaluationError, EvaluationOptions, EvaluationResult, LimitKind, Program,
    rdf::{self, EntailedDataset, RdfClosure, RdfEvaluationError},
};
use oxrdf::{
    Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term,
    vocab::{rdf as rdf_vocab, rdfs},
};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Typed rejection of a full OWL 2 RL/RDF conformance claim.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error(
    "{requested} conformance is unavailable: {available} implements only \
     {implemented_rule_count} positive rules"
)]
pub struct Owl2RlConformanceError {
    requested: &'static str,
    available: &'static str,
    implemented_rule_count: usize,
}

impl Owl2RlConformanceError {
    /// Returns the full profile identifier whose conformance was requested.
    pub fn requested(&self) -> &'static str {
        self.requested
    }

    /// Returns the deliberately partial seed profile that is available.
    pub fn available(&self) -> &'static str {
        self.available
    }

    /// Returns the number of positive rules implemented by the seed.
    pub fn implemented_rule_count(&self) -> usize {
        self.implemented_rule_count
    }
}

/// Input rejected by the deliberately narrow positive seed.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum Owl2RlSeedInputError {
    /// Input contains OWL vocabulary outside the positive seed.
    #[error(
        "unsupported OWL construct {construct} in input quad {quad}; \
         {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} fails closed"
    )]
    UnsupportedOwlConstruct {
        /// Unsupported OWL vocabulary IRI.
        construct: NamedNode,
        /// Input quad containing the unsupported construct.
        quad: Box<Quad>,
    },
    /// A seed rule would need to consume a literal or triple term as a resource.
    #[error(
        "non-resource object in input quad {quad}; \
         {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} supports only resource-valued \
         positive facts"
    )]
    NonResourceObject {
        /// The rejected input quad.
        quad: Box<Quad>,
    },
    /// A supported seed rule uses a generalized property expression.
    #[error(
        "property expression must be a named node in input quad {quad}; \
         {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} does not compile blank-node \
         property expressions"
    )]
    PropertyExpressionMustBeNamed {
        /// The rejected input quad.
        quad: Box<Quad>,
    },
    /// A supported seed rule uses a non-IRI class expression.
    #[error(
        "class expression must be a named node in input quad {quad}; \
         {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} does not compile blank-node \
         class expressions"
    )]
    ClassExpressionMustBeNamed {
        /// The rejected input quad.
        quad: Box<Quad>,
    },
    /// The positive seed encounters equality involving a non-IRI term.
    #[error(
        "equality terms must be named nodes in input quad {quad}; \
         {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} supports only named-resource \
         equality in this seed"
    )]
    EqualityTermMustBeNamed {
        /// The rejected equality assertion.
        quad: Box<Quad>,
    },
    /// Equality replacement could move unsupported OWL vocabulary into a semantic position.
    #[error(
        "unsupported OWL IRI {construct} occurs in input quad {quad} while \
         owl:sameAs is enabled; {OWL2_RL_RDF_POSITIVE_SEED_PROFILE} accepts \
         equality only when the input contains no unsupported OWL vocabulary"
    )]
    EqualityCanReachUnsupportedOwlVocabulary {
        /// Unsupported OWL vocabulary IRI reachable through equality.
        construct: NamedNode,
        /// Input quad containing the IRI.
        quad: Box<Quad>,
    },
}

/// Failure while checking or evaluating the positive seed.
#[derive(Debug, thiserror::Error)]
pub enum Owl2RlSeedError {
    /// The input falls outside the deliberately narrow seed profile.
    #[error(transparent)]
    Input(#[from] Owl2RlSeedInputError),
    /// A resource limit or RDF Datalog adaptation step failed.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
}

/// An opaque closure produced by the OWL 2 RL/RDF positive seed.
///
/// The wrapper keeps OWL evidence distinct from a generic Datalog RDF closure:
/// it can be obtained only from [`Owl2RlPositiveSeed::evaluate`].
#[derive(Clone, Debug)]
pub struct Owl2RlSeedClosure {
    closure: RdfClosure,
}

impl Owl2RlSeedClosure {
    /// Returns the unchanged input dataset.
    pub fn base(&self) -> &Dataset {
        self.closure.base()
    }

    /// Returns only quads derived by the positive seed.
    pub fn inference(&self) -> &Dataset {
        self.closure.inference()
    }

    /// Returns a queryable base-plus-inference dataset view.
    pub fn entailed(&self) -> &EntailedDataset {
        self.closure.entailed()
    }

    /// Returns resource and iteration accounting from the Datalog evaluator.
    pub fn evaluation(&self) -> &EvaluationResult {
        self.closure.evaluation()
    }

    /// Serializes the sorted inference-only dataset as canonical N-Quads text.
    pub fn canonical_inference_nquads(&self) -> String {
        self.closure.canonical_inference_nquads()
    }
}

/// The initial OWL 2 RL/RDF positive-rule seed.
///
/// Rules are evaluated independently within each RDF dataset graph. Callers
/// must use [`Self::evaluate`] so that unsupported constructs fail closed.
#[derive(Clone, Debug)]
pub struct Owl2RlPositiveSeed {
    program: Program,
}

impl Owl2RlPositiveSeed {
    /// Compiles the fixed positive-seed Datalog program.
    pub fn new() -> Self {
        Self {
            program: positive_seed_program(),
        }
    }

    /// Returns the exact deliberately partial profile identifier.
    pub const fn profile_id() -> &'static str {
        OWL2_RL_RDF_POSITIVE_SEED_PROFILE
    }

    /// Returns metadata for every positive rule implemented by the seed.
    pub const fn implemented_rules() -> &'static [crate::Owl2RlRule] {
        IMPLEMENTED_RULES
    }

    /// Always rejects a full OWL 2 RL/RDF claim for this partial seed.
    pub fn require_full_conformance(&self) -> Result<(), Owl2RlConformanceError> {
        Err(Owl2RlConformanceError {
            requested: OWL2_RL_RDF_PROFILE,
            available: OWL2_RL_RDF_POSITIVE_SEED_PROFILE,
            implemented_rule_count: self.program.rules().len(),
        })
    }

    /// Validates the seed boundary and computes its bounded RDF closure.
    ///
    /// Equality is limited to named nodes. If any `owl:sameAs` assertion is
    /// present, every OWL-namespace IRI anywhere in the input dataset must be
    /// one of the six vocabulary terms used by this seed; this dataset-wide
    /// guard prevents equality replacement from introducing unsupported OWL
    /// constructs into semantic positions.
    pub fn evaluate(
        &self,
        base: &Dataset,
        options: &EvaluationOptions,
    ) -> Result<Owl2RlSeedClosure, Owl2RlSeedError> {
        let started = Instant::now();
        validate_seed_input(base, options, started)?;
        let mut evaluation_options = options.clone();
        if let Some(timeout) = options.limits.timeout {
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                return Err(limit_error(LimitKind::Time, timeout.as_millis()));
            }
            evaluation_options.limits.timeout = Some(timeout.saturating_sub(elapsed));
        }
        Ok(Owl2RlSeedClosure {
            closure: rdf::evaluate(&self.program, base, &evaluation_options)?,
        })
    }

    /// Builds a profile-correct receipt for a closure returned by
    /// [`Self::evaluate`].
    ///
    /// A generic [`RdfClosure`] cannot be used to mint OWL seed evidence:
    ///
    /// ```compile_fail
    /// use oxdatalog::rdf::RdfClosure;
    /// use oxowl::Owl2RlPositiveSeed;
    ///
    /// fn invalid_evidence(seed: &Owl2RlPositiveSeed, closure: &RdfClosure) {
    ///     let _ = seed.receipt(closure);
    /// }
    /// ```
    pub fn receipt(&self, closure: &Owl2RlSeedClosure) -> Owl2RlSeedReceipt {
        debug_assert_eq!(
            self.program.rules().len(),
            IMPLEMENTED_RULES.len(),
            "positive-seed program and public rule inventory must stay aligned"
        );
        Owl2RlSeedReceipt::from_closure(closure)
    }
}

impl Default for Owl2RlPositiveSeed {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_seed_input(
    dataset: &Dataset,
    options: &EvaluationOptions,
    started: Instant,
) -> Result<(), Owl2RlSeedError> {
    let mut has_equality = false;
    for (index, quad) in dataset.into_iter().enumerate() {
        check_validation_control(options, started)?;
        check_validation_fact_limit(index, options)?;
        validate_resource_object(&quad)?;
        validate_owl_vocabulary(&quad)?;
        validate_property_expression(&quad)?;
        validate_class_expression(&quad)?;
        validate_equality_terms(&quad)?;
        has_equality |= quad.predicate == SAME_AS;
    }
    check_validation_control(options, started)?;
    if has_equality {
        for (index, quad) in dataset.into_iter().enumerate() {
            check_validation_control(options, started)?;
            check_validation_fact_limit(index, options)?;
            if let Some(construct) = unsupported_owl_iri(&quad) {
                return Err(
                    Owl2RlSeedInputError::EqualityCanReachUnsupportedOwlVocabulary {
                        construct: construct.clone(),
                        quad: Box::new(quad),
                    }
                    .into(),
                );
            }
        }
    }
    check_validation_control(options, started)?;
    Ok(())
}

fn check_validation_control(
    options: &EvaluationOptions,
    started: Instant,
) -> Result<(), Owl2RlSeedError> {
    if options.cancellation_token.is_cancelled() {
        return Err(evaluation_error(EvaluationError::Cancelled));
    }
    if let Some(timeout) = options.limits.timeout
        && started.elapsed() >= timeout
    {
        return Err(limit_error(LimitKind::Time, timeout.as_millis()));
    }
    Ok(())
}

fn check_validation_fact_limit(
    index: usize,
    options: &EvaluationOptions,
) -> Result<(), Owl2RlSeedError> {
    if index >= options.limits.max_facts {
        Err(limit_error(LimitKind::Facts, options.limits.max_facts))
    } else {
        Ok(())
    }
}

fn limit_error(kind: LimitKind, limit: impl TryInto<usize>) -> Owl2RlSeedError {
    evaluation_error(EvaluationError::LimitExceeded {
        kind,
        limit: limit.try_into().unwrap_or(usize::MAX),
    })
}

fn evaluation_error(error: EvaluationError) -> Owl2RlSeedError {
    RdfEvaluationError::Evaluation(error).into()
}

fn unsupported_owl_iri(quad: &Quad) -> Option<&NamedNode> {
    let mut nodes = Vec::with_capacity(4);
    if let NamedOrBlankNode::NamedNode(subject) = &quad.subject {
        nodes.push(subject);
    }
    nodes.push(&quad.predicate);
    if let Term::NamedNode(object) = &quad.object {
        nodes.push(object);
    }
    if let GraphName::NamedNode(graph_name) = &quad.graph_name {
        nodes.push(graph_name);
    }
    nodes.into_iter().find(|node| {
        node.as_str().starts_with(OWL_NAMESPACE)
            && *node != &INVERSE_OF
            && *node != &EQUIVALENT_CLASS
            && *node != &EQUIVALENT_PROPERTY
            && *node != &SAME_AS
            && *node != &TRANSITIVE_PROPERTY
            && *node != &SYMMETRIC_PROPERTY
    })
}

fn validate_resource_object(quad: &Quad) -> Result<(), Owl2RlSeedInputError> {
    if matches!(quad.object, Term::NamedNode(_) | Term::BlankNode(_)) {
        Ok(())
    } else {
        Err(Owl2RlSeedInputError::NonResourceObject {
            quad: Box::new(quad.clone()),
        })
    }
}

fn validate_owl_vocabulary(quad: &Quad) -> Result<(), Owl2RlSeedInputError> {
    if quad.predicate.as_str().starts_with(OWL_NAMESPACE)
        && quad.predicate != INVERSE_OF
        && quad.predicate != EQUIVALENT_CLASS
        && quad.predicate != EQUIVALENT_PROPERTY
        && quad.predicate != SAME_AS
    {
        return Err(Owl2RlSeedInputError::UnsupportedOwlConstruct {
            construct: quad.predicate.clone(),
            quad: Box::new(quad.clone()),
        });
    }
    if quad.predicate == rdf_vocab::TYPE
        && let Term::NamedNode(object) = &quad.object
        && object.as_str().starts_with(OWL_NAMESPACE)
        && object != &TRANSITIVE_PROPERTY
        && object != &SYMMETRIC_PROPERTY
    {
        return Err(Owl2RlSeedInputError::UnsupportedOwlConstruct {
            construct: object.clone(),
            quad: Box::new(quad.clone()),
        });
    }
    Ok(())
}

fn validate_property_expression(quad: &Quad) -> Result<(), Owl2RlSeedInputError> {
    let property_subject = quad.predicate == rdfs::SUB_PROPERTY_OF
        || quad.predicate == rdfs::DOMAIN
        || quad.predicate == rdfs::RANGE
        || quad.predicate == INVERSE_OF
        || quad.predicate == EQUIVALENT_PROPERTY
        || (quad.predicate == rdf_vocab::TYPE
            && matches!(
                &quad.object,
                Term::NamedNode(object)
                    if object == &TRANSITIVE_PROPERTY
                        || object == &SYMMETRIC_PROPERTY
            ));
    let property_object = quad.predicate == rdfs::SUB_PROPERTY_OF
        || quad.predicate == INVERSE_OF
        || quad.predicate == EQUIVALENT_PROPERTY;
    let subject_is_named = matches!(quad.subject, NamedOrBlankNode::NamedNode(_));
    let object_is_named = matches!(quad.object, Term::NamedNode(_));
    if (property_subject && !subject_is_named) || (property_object && !object_is_named) {
        Err(Owl2RlSeedInputError::PropertyExpressionMustBeNamed {
            quad: Box::new(quad.clone()),
        })
    } else {
        Ok(())
    }
}

fn validate_class_expression(quad: &Quad) -> Result<(), Owl2RlSeedInputError> {
    if quad.predicate != EQUIVALENT_CLASS {
        return Ok(());
    }
    let subject_is_named = matches!(quad.subject, NamedOrBlankNode::NamedNode(_));
    let object_is_named = matches!(quad.object, Term::NamedNode(_));
    if subject_is_named && object_is_named {
        Ok(())
    } else {
        Err(Owl2RlSeedInputError::ClassExpressionMustBeNamed {
            quad: Box::new(quad.clone()),
        })
    }
}

fn validate_equality_terms(quad: &Quad) -> Result<(), Owl2RlSeedInputError> {
    if quad.predicate != SAME_AS {
        return Ok(());
    }
    let subject_is_named = matches!(quad.subject, NamedOrBlankNode::NamedNode(_));
    let object_is_named = matches!(quad.object, Term::NamedNode(_));
    if subject_is_named && object_is_named {
        Ok(())
    } else {
        Err(Owl2RlSeedInputError::EqualityTermMustBeNamed {
            quad: Box::new(quad.clone()),
        })
    }
}
