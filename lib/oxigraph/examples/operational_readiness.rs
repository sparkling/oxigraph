//! cargo run --locked -p oxigraph --example operational_readiness
#![expect(clippy::print_stdout, reason = "runnable readiness journey")]
use oxigraph::store::{
    CircuitState, ContributorRegistry, GovernanceTime, ProbeCoverage, ReadinessDisposition,
    ReadinessPolicy, Store, TransactionStartControl,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let policy = ReadinessPolicy::default();
    let registry = ContributorRegistry::default();
    let control = TransactionStartControl::new();
    let ready = store.operational_snapshot(
        &policy,
        &registry,
        &[],
        GovernanceTime::now()?,
        &control,
        CircuitState::Closed,
    );
    if ready.disposition() != ReadinessDisposition::Ready
        || ready.primary_coverage() != ProbeCoverage::Complete
    {
        return Err("empty native store did not become ready".into());
    }
    control.cancel();
    let cancelled = store.operational_snapshot(
        &policy,
        &registry,
        &[],
        GovernanceTime::now()?,
        &control,
        CircuitState::Closed,
    );
    if cancelled.disposition() != ReadinessDisposition::NotReady || !cancelled.live() {
        return Err("cancellation did not distinguish liveness and readiness".into());
    }
    println!(
        "empty_store_ready=true cancelled_probe_not_ready=true live=true metric_series={}",
        ready.metrics().len()
    );
    Ok(())
}
