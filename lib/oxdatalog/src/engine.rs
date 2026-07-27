#[cfg(test)]
use self::control::timed_out;
use self::{
    control::{ExecutionGuard, RuntimeMemory, estimate_fact},
    storage::{Interner, RelationStore, fact_key_estimated_bytes},
    strata::evaluate_strata,
};
use crate::{
    Fact, Program, Provenance, RelationId, ValidatedProgram, ValidationError, ValidationLimits,
    validate::{ControlledValidationError, validate_with_control},
};
use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

mod control;
mod rules;
mod storage;
mod strata;
#[cfg(test)]
mod tests;

#[derive(Clone, Debug, Default)]
/// A clonable, one-way cancellation signal shared by an evaluation and its caller.
///
/// Clones observe the same atomic flag. Cancellation is cooperative: the engine
/// checks the token at bounded validation, join, materialization, and output
/// checkpoints and then returns [`EvaluationError::Cancelled`].
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    /// Creates a token in the non-cancelled state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Permanently marks this token and all of its clones as cancelled.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    /// Returns whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
/// Identifies the bounded resource whose evaluation limit was exceeded.
pub enum LimitKind {
    /// Input, candidate, or materialized fact count.
    Facts,
    /// Rows retained while joining a rule body.
    IntermediateRows,
    /// Semi-naive recursive fixpoint iterations across all strata.
    Iterations,
    /// Deterministically estimated active engine working-set bytes.
    Memory,
    /// Interned ground-term identifier space.
    Terms,
    /// Wall-clock evaluation time.
    Time,
}

#[derive(Clone, Debug, Eq, PartialEq)]
/// Resource ceilings applied to one evaluation.
///
/// Limits are checked at deterministic engine checkpoints. Memory accounting
/// is deliberately conservative and reproducible, but is not an
/// allocator-precise measurement.
pub struct EvaluationLimits {
    /// Maximum number of accepted input, candidate, or materialized facts.
    pub max_facts: usize,
    /// Maximum number of intermediate bindings retained by a join step.
    pub max_intermediate_rows: usize,
    /// Maximum number of recursive semi-naive delta iterations.
    pub max_iterations: usize,
    /// Ceiling for the estimated active engine workset.
    ///
    /// The estimate includes the owned input, interner, base keys, `all` and
    /// delta stores, candidates, join states, provenance, and materialized
    /// output. It is deterministic but is not an allocator-precise heap
    /// measurement.
    pub max_memory_bytes: usize,
    /// Maximum estimated byte length of any input, constant, or generated value.
    pub max_term_bytes: usize,
    /// Optional wall-clock deadline measured from the start of validation.
    ///
    /// A value of `None` disables the time limit.
    pub timeout: Option<Duration>,
}

impl Default for EvaluationLimits {
    fn default() -> Self {
        Self {
            max_facts: 1_000_000,
            max_intermediate_rows: 1_000_000,
            max_iterations: 1_000,
            max_memory_bytes: 256 * 1024 * 1024,
            max_term_bytes: 1024 * 1024,
            timeout: Some(Duration::from_secs(30)),
        }
    }
}

#[derive(Clone, Debug, Default)]
/// Runtime controls for a single evaluation.
pub struct EvaluationOptions {
    /// Resource ceilings enforced during validation and execution.
    pub limits: EvaluationLimits,
    /// Whether to retain one deterministic derivation for each derived fact.
    pub track_provenance: bool,
    /// Cooperative cancellation token checked throughout evaluation.
    pub cancellation_token: CancellationToken,
}

#[derive(Debug, thiserror::Error)]
/// A validation, input-contract, cancellation, or resource-limit failure.
pub enum EvaluationError {
    /// The program failed structural or stratification validation.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// An input fact disagreed with the arity established for its relation.
    #[error(
        "input relation {relation} has arity {actual}, but its established arity is {expected}"
    )]
    InputArity {
        /// Relation whose input arity was inconsistent.
        relation: RelationId,
        /// Arity established by the program or an earlier input fact.
        expected: usize,
        /// Arity of the rejected input fact.
        actual: usize,
    },
    /// An input value exceeded [`EvaluationLimits::max_term_bytes`].
    #[error("input term is {actual} bytes, exceeding the limit of {limit}")]
    InputTermLimit {
        /// Estimated byte length of the rejected value.
        actual: usize,
        /// Configured maximum value length.
        limit: usize,
    },
    /// A deterministic generated blank node exceeded the term-size limit.
    #[error("generated term is {actual} bytes, exceeding the limit of {limit}")]
    GeneratedTermLimit {
        /// Estimated byte length of the generated value.
        actual: usize,
        /// Configured maximum value length.
        limit: usize,
    },
    /// No collision-free deterministic blank-node label remained available.
    #[error("deterministic blank-node label space is exhausted")]
    GeneratedBlankNodeSpaceExhausted,
    /// Cooperative cancellation was observed at an execution checkpoint.
    #[error("evaluation was cancelled")]
    Cancelled,
    /// A bounded runtime resource exceeded its configured ceiling.
    #[error("{kind:?} limit of {limit} exceeded")]
    LimitExceeded {
        /// Resource category that exceeded its bound.
        kind: LimitKind,
        /// Configured ceiling for the resource.
        limit: usize,
    },
}

#[derive(Clone, Debug)]
/// Deterministically ordered facts and execution metadata from an evaluation.
///
/// [`Self::facts`] contains the set union of input and derived facts.
/// [`Self::derived_facts`] excludes facts already present in the input.
pub struct EvaluationResult {
    facts: Box<[Fact]>,
    derived_facts: Box<[Fact]>,
    provenance: Option<Provenance>,
    iterations: usize,
    elapsed: Duration,
    peak_estimated_working_set_bytes: usize,
}

impl EvaluationResult {
    /// Returns all input and derived facts in canonical-key order.
    pub fn facts(&self) -> &[Fact] {
        &self.facts
    }

    /// Returns only newly derived facts in canonical-key order.
    pub fn derived_facts(&self) -> &[Fact] {
        &self.derived_facts
    }

    /// Returns retained derivations when provenance tracking was enabled.
    pub fn provenance(&self) -> Option<&Provenance> {
        self.provenance.as_ref()
    }

    /// Returns the number of recursive semi-naive delta iterations performed.
    pub fn iterations(&self) -> usize {
        self.iterations
    }

    /// Returns wall-clock time spent validating and evaluating the program.
    pub fn elapsed(&self) -> Duration {
        self.elapsed
    }

    /// Peak estimated active engine workset observed during evaluation.
    pub fn peak_estimated_working_set_bytes(&self) -> usize {
        self.peak_estimated_working_set_bytes
    }

    /// Backwards-compatible alias for [`Self::peak_estimated_working_set_bytes`].
    pub fn estimated_memory_bytes(&self) -> usize {
        self.peak_estimated_working_set_bytes()
    }
}

#[derive(Clone, Debug, Default)]
/// A reusable evaluator configured with structural validation limits.
///
/// Evaluation is set-oriented, stratified, bounded, and deterministic for a
/// fixed program, input fact set, and options.
pub struct Engine {
    validation_limits: ValidationLimits,
}

impl Engine {
    /// Creates an engine that validates programs against `validation_limits`.
    pub fn new(validation_limits: ValidationLimits) -> Self {
        Self { validation_limits }
    }

    /// Validates and evaluates `program` over `facts`.
    ///
    /// Input facts are deduplicated. The method enforces both the engine's
    /// validation limits and the supplied runtime `options`.
    pub fn evaluate(
        &self,
        program: &Program,
        facts: impl IntoIterator<Item = Fact>,
        options: &EvaluationOptions,
    ) -> Result<EvaluationResult, EvaluationError> {
        let started = Instant::now();
        let mut guard = ExecutionGuard::new(options, started);
        guard.check()?;
        let validated =
            match validate_with_control(program, &self.validation_limits, || guard.check()) {
                Ok(program) => program,
                Err(ControlledValidationError::Validation(error)) => {
                    return Err(EvaluationError::Validation(error));
                }
                Err(ControlledValidationError::Control(error)) => return Err(error),
            };
        guard.check()?;
        Self::evaluate_validated_with_guard(&validated, facts, &mut guard)
    }

    /// Evaluates a previously validated program over `facts`.
    ///
    /// This skips structural program validation but still checks cancellation,
    /// runtime limits, input arities, and input value sizes.
    pub fn evaluate_validated(
        program: &ValidatedProgram,
        facts: impl IntoIterator<Item = Fact>,
        options: &EvaluationOptions,
    ) -> Result<EvaluationResult, EvaluationError> {
        let started = Instant::now();
        let mut guard = ExecutionGuard::new(options, started);
        guard.check()?;
        Self::evaluate_validated_with_guard(program, facts, &mut guard)
    }

    fn evaluate_validated_with_guard(
        program: &ValidatedProgram,
        facts: impl IntoIterator<Item = Fact>,
        guard: &mut ExecutionGuard<'_>,
    ) -> Result<EvaluationResult, EvaluationError> {
        let mut memory = RuntimeMemory::default();
        guard.observe(&memory)?;
        let mut input = Vec::new();
        for fact in facts {
            guard.check()?;
            if input.len() >= guard.options().limits.max_facts {
                return Err(EvaluationError::LimitExceeded {
                    kind: LimitKind::Facts,
                    limit: guard.options().limits.max_facts,
                });
            }
            memory.input = memory.input.saturating_add(estimate_fact(&fact));
            guard.observe(&memory)?;
            input.push(fact);
        }
        guard.check()?;
        validate_input(program, &input, guard)?;

        let mut interner = Interner::new(program, &input, guard, &mut memory)?;
        memory.interner = interner.estimated_bytes();
        let mut all = RelationStore::new(program.arities());
        let mut base = BTreeSet::new();
        memory.all = all.estimated_bytes();
        guard.observe(&memory)?;

        for fact in &input {
            guard.check()?;
            let key = interner.encode_fact(fact);
            if !base.contains(&key) {
                memory.base_keys = memory
                    .base_keys
                    .saturating_add(fact_key_estimated_bytes(&key));
                memory.all = all.projected_insert_bytes(&key);
                guard.observe(&memory)?;
            }
            base.insert(key.clone());
            all.insert_key(key.clone());
        }
        memory.all = all.estimated_bytes();
        guard.observe(&memory)?;

        let mut provenance = guard.options().track_provenance.then(Provenance::default);
        let iterations = evaluate_strata(
            program,
            &mut interner,
            &mut all,
            &mut provenance,
            guard,
            &mut memory,
        )?;

        memory.delta = 0;
        guard.observe(&memory)?;
        let mut facts = Vec::with_capacity(all.len());
        for key in all.keys() {
            guard.check()?;
            let fact = interner.decode_fact(&key);
            memory.output = memory.output.saturating_add(estimate_fact(&fact));
            guard.observe(&memory)?;
            facts.push(fact);
        }
        // The standard in-place sort is bounded by max_facts but cannot be
        // preempted mid-comparison, so check the deadline immediately around it.
        guard.check()?;
        facts.sort_by_key(Fact::canonical_key);
        guard.check()?;
        let mut derived_facts = Vec::with_capacity(all.len().saturating_sub(base.len()));
        for key in all.keys().filter(|key| !base.contains(key)) {
            guard.check()?;
            let fact = interner.decode_fact(&key);
            memory.output = memory.output.saturating_add(estimate_fact(&fact));
            guard.observe(&memory)?;
            derived_facts.push(fact);
        }
        guard.check()?;
        derived_facts.sort_by_key(Fact::canonical_key);
        guard.check()?;
        let elapsed = guard.elapsed();
        let peak_estimated_working_set_bytes = guard.peak_estimated_bytes();
        Ok(EvaluationResult {
            facts: facts.into_boxed_slice(),
            derived_facts: derived_facts.into_boxed_slice(),
            provenance,
            iterations,
            elapsed,
            peak_estimated_working_set_bytes,
        })
    }
}

fn validate_input(
    program: &ValidatedProgram,
    input: &[Fact],
    guard: &ExecutionGuard<'_>,
) -> Result<(), EvaluationError> {
    let mut arities = program.arities().clone();
    for fact in input {
        guard.check()?;
        if let Some(expected) = arities.insert(fact.relation().clone(), fact.arity())
            && expected != fact.arity()
        {
            return Err(EvaluationError::InputArity {
                relation: fact.relation().clone(),
                expected,
                actual: fact.arity(),
            });
        }
        for value in fact.values() {
            guard.check()?;
            let actual = value.estimated_bytes();
            if actual > guard.options().limits.max_term_bytes {
                return Err(EvaluationError::InputTermLimit {
                    actual,
                    limit: guard.options().limits.max_term_bytes,
                });
            }
        }
    }
    Ok(())
}
