use super::{EvaluationError, EvaluationOptions, LimitKind};
use crate::{Fact, Value};
use std::mem::size_of;
use std::time::Duration;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

pub(super) struct ExecutionGuard<'a> {
    options: &'a EvaluationOptions,
    started: Instant,
    peak_estimated_bytes: usize,
}

impl<'a> ExecutionGuard<'a> {
    pub(super) fn new(options: &'a EvaluationOptions, started: Instant) -> Self {
        Self {
            options,
            started,
            peak_estimated_bytes: 0,
        }
    }

    pub(super) fn options(&self) -> &'a EvaluationOptions {
        self.options
    }

    pub(super) fn check(&self) -> Result<(), EvaluationError> {
        if self.options.cancellation_token.is_cancelled() {
            return Err(EvaluationError::Cancelled);
        }
        if let Some(timeout) = self.options.limits.timeout
            && timed_out(self.started.elapsed(), timeout)
        {
            return Err(EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: timeout.as_millis().try_into().unwrap_or(usize::MAX),
            });
        }
        Ok(())
    }

    pub(super) fn observe(&mut self, memory: &RuntimeMemory) -> Result<(), EvaluationError> {
        self.check()?;
        let estimated_bytes = memory.total();
        self.peak_estimated_bytes = self.peak_estimated_bytes.max(estimated_bytes);
        if estimated_bytes > self.options.limits.max_memory_bytes {
            return Err(EvaluationError::LimitExceeded {
                kind: LimitKind::Memory,
                limit: self.options.limits.max_memory_bytes,
            });
        }
        Ok(())
    }

    pub(super) fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }

    pub(super) fn peak_estimated_bytes(&self) -> usize {
        self.peak_estimated_bytes
    }
}

#[derive(Default)]
pub(super) struct RuntimeMemory {
    pub input: usize,
    pub interner: usize,
    pub base_keys: usize,
    pub all: usize,
    pub delta: usize,
    pub next_delta: usize,
    pub candidates: usize,
    pub provenance: usize,
    pub join_states: usize,
    pub output: usize,
}

impl RuntimeMemory {
    fn total(&self) -> usize {
        [
            self.input,
            self.interner,
            self.base_keys,
            self.all,
            self.delta,
            self.next_delta,
            self.candidates,
            self.provenance,
            self.join_states,
            self.output,
        ]
        .into_iter()
        .fold(0, usize::saturating_add)
    }
}

pub(super) fn estimate_fact(fact: &Fact) -> usize {
    64_usize
        .saturating_add(fact.relation().as_str().len())
        .saturating_add(fact.values().len().saturating_mul(size_of::<Value>()))
        .saturating_add(
            fact.values()
                .iter()
                .map(Value::estimated_bytes)
                .fold(0, usize::saturating_add),
        )
}

pub(super) fn timed_out(elapsed: Duration, timeout: Duration) -> bool {
    elapsed >= timeout
}
