//! Bounded policy observations, independent of durable receipts and evaluation outcomes.
use super::{ShaclDisposition, TransactionDurationHistogram};
use std::fmt::{self, Write};
use std::sync::Mutex;
#[cfg(any(feature = "http-client", feature = "shacl"))]
use std::time::Duration;

/// Fixed attribution for built-in remote policy denials.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyDenialPurpose {
    Service,
    Load,
    Document,
}
impl PolicyDenialPurpose {
    pub const ALL: [Self; 3] = [Self::Service, Self::Load, Self::Document];
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Load => "load",
            Self::Document => "document",
        }
    }
}

/// Process-local policy counters/durations, shared by Store clones and reset on reopen.
///
/// Denials count built-in Store-bound SERVICE, LOAD and nested document rejection
/// decisions, including errors swallowed by SILENT. Duration covers request/target
/// preflight entry through denial, not the whole SPARQL operation. Custom handlers,
/// generic/borrowed bindings and standalone loaders are not attributed.
///
/// SHACL counts returned commit-gate observations, not individual graph validations.
/// Duration covers gate entry through its final return, including cleanup/native commit.
/// Admission/preparation failures, explicit rollback, drop before commit, unwinding,
/// and standalone validation are excluded. Accepted validation can coexist with an
/// indeterminate commit; a rollback failure does not rewrite validation disposition.
/// No RDF, graph/profile IDs, destinations or error text are retained. Each snapshot is
/// internally consistent, not atomic with other metrics or durable state.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PolicyMetrics {
    denials: [TransactionDurationHistogram; 3],
    validations: [TransactionDurationHistogram; 10],
}
impl PolicyMetrics {
    pub const VALIDATION_DISPOSITIONS: [ShaclDisposition; 10] = [
        ShaclDisposition::Accepted,
        ShaclDisposition::Nonconforming,
        ShaclDisposition::Cancelled,
        ShaclDisposition::TimedOut,
        ShaclDisposition::LimitExceeded,
        ShaclDisposition::ProcessorError,
        ShaclDisposition::StorageError,
        ShaclDisposition::PolicyError,
        ShaclDisposition::ShapesChanged,
        ShaclDisposition::MissingGraph,
    ];
    pub fn denials(&self, purpose: PolicyDenialPurpose) -> u64 {
        self.denial_duration(purpose).count()
    }
    pub fn denial_duration(&self, purpose: PolicyDenialPurpose) -> &TransactionDurationHistogram {
        &self.denials[purpose as usize]
    }
    pub fn validations(&self, disposition: ShaclDisposition) -> u64 {
        self.validation_duration(disposition).count()
    }
    pub fn validation_duration(
        &self,
        disposition: ShaclDisposition,
    ) -> &TransactionDurationHistogram {
        &self.validations[validation_index(disposition)]
    }
    /// Four fixed Prometheus families, exactly 143 samples. Unavailable paths stay zero.
    pub fn write_prometheus(&self, output: &mut impl Write) -> fmt::Result {
        writeln!(output, "# TYPE oxigraph_egress_denials_total counter")?;
        for purpose in PolicyDenialPurpose::ALL {
            writeln!(
                output,
                "oxigraph_egress_denials_total{{purpose=\"{}\"}} {}",
                purpose.as_str(),
                self.denials(purpose)
            )?;
        }
        writeln!(
            output,
            "# TYPE oxigraph_egress_denial_duration_seconds histogram"
        )?;
        for purpose in PolicyDenialPurpose::ALL {
            self.denial_duration(purpose).write_series(
                output,
                "oxigraph_egress_denial_duration_seconds",
                "purpose",
                purpose.as_str(),
            )?;
        }
        writeln!(output, "# TYPE oxigraph_shacl_commit_gates_total counter")?;
        for disposition in Self::VALIDATION_DISPOSITIONS {
            writeln!(
                output,
                "oxigraph_shacl_commit_gates_total{{outcome=\"{}\"}} {}",
                validation_label(disposition),
                self.validations(disposition)
            )?;
        }
        writeln!(
            output,
            "# TYPE oxigraph_shacl_commit_gate_duration_seconds histogram"
        )?;
        for disposition in Self::VALIDATION_DISPOSITIONS {
            self.validation_duration(disposition).write_series(
                output,
                "oxigraph_shacl_commit_gate_duration_seconds",
                "outcome",
                validation_label(disposition),
            )?;
        }
        Ok(())
    }
}
const fn validation_index(disposition: ShaclDisposition) -> usize {
    match disposition {
        ShaclDisposition::Accepted => 0,
        ShaclDisposition::Nonconforming => 1,
        ShaclDisposition::Cancelled => 2,
        ShaclDisposition::TimedOut => 3,
        ShaclDisposition::LimitExceeded => 4,
        ShaclDisposition::ProcessorError => 5,
        ShaclDisposition::StorageError => 6,
        ShaclDisposition::PolicyError => 7,
        ShaclDisposition::ShapesChanged => 8,
        ShaclDisposition::MissingGraph => 9,
    }
}
const fn validation_label(disposition: ShaclDisposition) -> &'static str {
    match disposition {
        ShaclDisposition::Accepted => "accepted",
        ShaclDisposition::Nonconforming => "nonconforming",
        ShaclDisposition::Cancelled => "cancelled",
        ShaclDisposition::TimedOut => "timed_out",
        ShaclDisposition::LimitExceeded => "limit_exceeded",
        ShaclDisposition::ProcessorError => "processor_error",
        ShaclDisposition::StorageError => "storage_error",
        ShaclDisposition::PolicyError => "policy_error",
        ShaclDisposition::ShapesChanged => "shapes_changed",
        ShaclDisposition::MissingGraph => "missing_graph",
    }
}

#[derive(Default)]
pub(crate) struct PolicyMetricsState(Mutex<PolicyMetrics>);
impl PolicyMetricsState {
    pub(crate) fn snapshot(&self) -> PolicyMetrics {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
    #[cfg(feature = "http-client")]
    pub(crate) fn deny(&self, purpose: PolicyDenialPurpose, elapsed: Duration) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .denials[purpose as usize]
            .observe(elapsed);
    }
    #[cfg(feature = "shacl")]
    pub(crate) fn validation(&self, disposition: ShaclDisposition, elapsed: Duration) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .validations[validation_index(disposition)]
        .observe(elapsed);
    }
}
