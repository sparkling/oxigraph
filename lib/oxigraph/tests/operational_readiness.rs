#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public operational contract assertions"
)]
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    CircuitState, ContributorCheckpoint, ContributorConsistency, ContributorDeclaration,
    ContributorError, ContributorHealth, ContributorIdentity, ContributorObservation,
    ContributorRegistry, GovernanceTime, OperationalSnapshot, OutboxRetentionPolicy, ProbeCoverage,
    ReadinessDisposition, ReadinessPolicy, ReadinessReason, Store, TransactionKey,
    TransactionRequest, TransactionStartControl, WritableDataset,
};
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::time::Duration;
type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn time(n: u64) -> GovernanceTime {
    GovernanceTime::from_unix_millis(n)
}
fn id(n: u8) -> ContributorIdentity {
    ContributorIdentity::new([n; 16], NonZeroU32::MIN)
}
fn declaration(n: u8, required: bool, lag: u64) -> ContributorDeclaration {
    ContributorDeclaration::new(
        id(n),
        required,
        if lag == 0 {
            ContributorConsistency::Strict
        } else {
            ContributorConsistency::Eventual {
                max_lag_records: lag,
            }
        },
        !required,
    )
}
fn quad(value: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        Literal::new_simple_literal(value.to_owned()),
        GraphName::DefaultGraph,
    )
}
fn commit(store: &Store, n: u8) -> TestResult<ContributorCheckpoint> {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([n; 16]))?
        .into_transaction();
    tx.insert(quad(&n.to_string()))?;
    Ok(ContributorCheckpoint::new(tx.commit()?)?)
}
fn each_backend(exercise: impl Fn(&Store) -> TestResult) -> TestResult {
    exercise(&Store::new()?)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let directory = tempfile::tempdir()?;
        exercise(&Store::open(directory.path())?)?;
    }
    Ok(())
}
fn snapshot(
    store: &Store,
    declarations: Vec<ContributorDeclaration>,
    observations: &[ContributorObservation],
) -> TestResult<OperationalSnapshot> {
    Ok(store.operational_snapshot(
        &ReadinessPolicy::default(),
        &ContributorRegistry::new(declarations)?,
        observations,
        time(10),
        &TransactionStartControl::new(),
        CircuitState::Closed,
    ))
}
#[test]
fn empty_inventory_and_zero_graph_data_are_ready_not_degraded() -> TestResult {
    each_backend(|store| {
        let report = snapshot(store, vec![], &[])?;
        assert!(report.live());
        assert_eq!(report.disposition(), ReadinessDisposition::Ready);
        assert_eq!(report.primary_coverage(), ProbeCoverage::Complete);
        assert_eq!(report.outbox_coverage(), ProbeCoverage::Complete);
        assert!(
            report
                .contributors()
                .ok_or("inventory absent")?
                .entries()
                .is_empty()
        );
        assert!(report.reasons().next().is_none());
        Ok(())
    })
}
#[test]
fn exact_committed_inventory_is_canonical_and_metrics_are_payload_free() -> TestResult {
    each_backend(|store| {
        let checkpoint = commit(store, 1)?;
        let observed = |n| {
            ContributorObservation::new(
                id(n),
                Some(checkpoint.clone()),
                Some(checkpoint.clone()),
                ContributorHealth::Healthy,
            )
        };
        let a = snapshot(
            store,
            vec![declaration(2, true, 0), declaration(1, true, 0)],
            &[observed(1), observed(2)],
        )?;
        let b = snapshot(
            store,
            vec![declaration(1, true, 0), declaration(2, true, 0)],
            &[observed(2), observed(1)],
        )?;
        assert_eq!(a.disposition(), ReadinessDisposition::Ready);
        assert_eq!(a.contributors(), b.contributors());
        let inventory = a.contributors().ok_or("missing inventory")?;
        assert_eq!(inventory.entries()[0].declaration().identity(), id(1));
        assert_eq!(
            inventory.to_bytes(),
            b.contributors().ok_or("missing")?.to_bytes()
        );
        assert_eq!(
            inventory.fingerprint(),
            b.contributors().ok_or("missing")?.fingerprint()
        );
        let metrics = a.metrics();
        assert!(metrics.len() <= 21);
        let names: std::collections::BTreeSet<_> = metrics
            .iter()
            .map(oxigraph::store::OperationalMetric::name)
            .collect();
        assert_eq!(names.len(), metrics.len());
        for metric in &metrics {
            assert!(metric.name().starts_with("oxigraph_"));
            assert!(
                metric
                    .name()
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            );
            assert!(matches!(
                metric.unit(),
                "boolean" | "records" | "bytes" | "leases" | "contributors"
            ));
        }
        assert_eq!(
            a.governance().and_then(|health| health.latest_receipt()),
            Some(checkpoint.receipt())
        );
        Ok(())
    })
}
#[test]
fn registry_rejects_duplicate_unknown_and_missing_requirements() -> TestResult {
    assert!(matches!(
        ContributorRegistry::new(vec![declaration(1, true, 0), declaration(1, false, 1)]),
        Err(ContributorError::Duplicate)
    ));
    let excess = vec![declaration(1, true, 0); 129];
    assert!(matches!(
        ContributorRegistry::new(excess),
        Err(ContributorError::Capacity)
    ));
    each_backend(|store| {
        let observation =
            ContributorObservation::new(id(1), None, None, ContributorHealth::Healthy);
        for (declarations, observations, expected) in [
            (vec![], vec![observation.clone()], ContributorError::Unknown),
            (
                vec![declaration(1, true, 0)],
                vec![],
                ContributorError::MissingRequired,
            ),
            (
                vec![declaration(1, true, 0)],
                vec![observation.clone(), observation],
                ContributorError::Duplicate,
            ),
            (
                vec![declaration(1, true, 0)],
                vec![ContributorObservation::new(
                    ContributorIdentity::new([1; 16], NonZeroU32::new(2).ok_or("zero")?),
                    None,
                    None,
                    ContributorHealth::Healthy,
                )],
                ContributorError::Unknown,
            ),
        ] {
            let report = snapshot(store, declarations, &observations)?;
            assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
            assert_eq!(report.contributor_error(), Some(expected));
        }
        assert_eq!(
            snapshot(store, vec![declaration(1, false, 0)], &[])?.disposition(),
            ReadinessDisposition::Degraded
        );
        let no_fallback =
            ContributorDeclaration::new(id(1), false, ContributorConsistency::Strict, false);
        assert_eq!(
            snapshot(store, vec![no_fallback], &[])?.contributor_error(),
            Some(ContributorError::Unhealthy)
        );
        Ok(())
    })
}
#[test]
fn checkpoint_identity_order_lag_and_health_are_not_provider_claims() -> TestResult {
    each_backend(|store| {
        let first = commit(store, 1)?;
        let second = commit(store, 2)?;
        let foreign = commit(&Store::new()?, 1)?;
        let observe =
            |source, applied, health| ContributorObservation::new(id(1), source, applied, health);
        for (declaration, observation, error) in [
            (
                declaration(1, true, 0),
                observe(
                    Some(first.clone()),
                    Some(first.clone()),
                    ContributorHealth::Healthy,
                ),
                ContributorError::SourceMismatch,
            ),
            (
                declaration(1, true, 0),
                observe(
                    Some(second.clone()),
                    Some(foreign),
                    ContributorHealth::Healthy,
                ),
                ContributorError::CursorMismatch,
            ),
            (
                declaration(1, true, 0),
                observe(
                    Some(second.clone()),
                    Some(first.clone()),
                    ContributorHealth::Healthy,
                ),
                ContributorError::LagExceeded,
            ),
            (
                declaration(1, true, 2),
                observe(
                    Some(second.clone()),
                    Some(first.clone()),
                    ContributorHealth::Healthy,
                ),
                ContributorError::LagExceeded,
            ),
            (
                declaration(1, true, 0),
                observe(
                    Some(second.clone()),
                    Some(second.clone()),
                    ContributorHealth::Failed,
                ),
                ContributorError::Unhealthy,
            ),
        ] {
            let report = snapshot(store, vec![declaration], &[observation])?;
            assert_eq!(report.contributor_error(), Some(error));
            assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
        }
        let report = snapshot(
            store,
            vec![declaration(1, false, 2)],
            &[observe(
                Some(second.clone()),
                Some(first),
                ContributorHealth::Healthy,
            )],
        )?;
        assert_eq!(report.disposition(), ReadinessDisposition::Degraded);
        assert_eq!(
            report.contributors().ok_or("missing")?.entries()[0].lag_records(),
            Some(2)
        );
        assert_eq!(
            snapshot(
                store,
                vec![declaration(1, false, 0)],
                &[observe(
                    Some(second.clone()),
                    Some(second),
                    ContributorHealth::Unavailable
                )]
            )?
            .disposition(),
            ReadinessDisposition::Degraded
        );
        Ok(())
    })
}
#[test]
fn bounded_probes_report_partial_coverage_without_full_integrity_claims() -> TestResult {
    each_backend(|store| {
        commit(store, 1)?;
        commit(store, 2)?;
        let policy = ReadinessPolicy::default().with_probe_limits(
            NonZeroUsize::MIN,
            NonZeroUsize::new(1024).ok_or("zero")?,
            NonZeroUsize::MIN,
        );
        let report = store.operational_snapshot(
            &policy,
            &ContributorRegistry::default(),
            &[],
            time(10),
            &TransactionStartControl::new(),
            CircuitState::Closed,
        );
        assert_eq!(report.primary_coverage(), ProbeCoverage::Partial);
        assert_eq!(report.inspected_primary_records(), 1);
        assert_eq!(report.outbox_coverage(), ProbeCoverage::Partial);
        assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
        assert!(
            report
                .reasons()
                .any(|reason| reason == ReadinessReason::PartialOutbox)
        );
        let report = store.operational_snapshot(
            &policy.allowing_partial_outbox(true),
            &ContributorRegistry::default(),
            &[],
            time(10),
            &TransactionStartControl::new(),
            CircuitState::Closed,
        );
        assert_eq!(report.disposition(), ReadinessDisposition::Degraded);
        let policy = ReadinessPolicy::default().with_probe_limits(
            NonZeroUsize::MIN,
            NonZeroUsize::MIN,
            NonZeroUsize::new(10).ok_or("zero")?,
        );
        let report = store.operational_snapshot(
            &policy,
            &ContributorRegistry::default(),
            &[],
            time(10),
            &TransactionStartControl::new(),
            CircuitState::Closed,
        );
        assert_eq!(report.primary_coverage(), ProbeCoverage::Partial);
        assert!(report.inspected_primary_logical_bytes() > 1); // One decoded term may cross the stopping threshold.
        Ok(())
    })
}
#[test]
fn cancellation_deadline_circuit_and_expired_recovery_fail_closed() -> TestResult {
    each_backend(|store| {
        let control = TransactionStartControl::new();
        control.cancel();
        let report = store.operational_snapshot(
            &ReadinessPolicy::default(),
            &ContributorRegistry::default(),
            &[],
            time(10),
            &control,
            CircuitState::Closed,
        );
        assert_eq!(report.primary_coverage(), ProbeCoverage::Unobserved);
        assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
        assert!(
            report
                .reasons()
                .any(|reason| reason == ReadinessReason::Cancelled)
        );
        for circuit in [
            CircuitState::HalfOpen,
            CircuitState::Open,
            CircuitState::Unknown,
        ] {
            let report = store.operational_snapshot(
                &ReadinessPolicy::default(),
                &ContributorRegistry::default(),
                &[],
                time(10),
                &TransactionStartControl::new(),
                circuit,
            );
            assert!(report.live());
            assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
        }
        for (policy, reason) in [
            (
                ReadinessPolicy::default().with_timeout(Duration::ZERO),
                ReadinessReason::TimedOut,
            ),
            (
                ReadinessPolicy::default().requiring_recovery_freshness(time(10)),
                ReadinessReason::RecoveryExpired,
            ),
        ] {
            let report = store.operational_snapshot(
                &policy,
                &ContributorRegistry::default(),
                &[],
                time(10),
                &TransactionStartControl::new(),
                CircuitState::Closed,
            );
            assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
            assert!(report.reasons().any(|actual| actual == reason));
        }
        assert!(store.is_empty()?);
        Ok(())
    })
}
#[test]
fn retention_anchor_is_valid_but_earlier_applied_checkpoint_is_expired() -> TestResult {
    each_backend(|store| {
        store.configure_outbox_retention(
            OutboxRetentionPolicy::new(NonZeroU64::new(30).ok_or("zero")?, NonZeroU16::MIN)?,
            time(1),
        )?;
        let first = commit(store, 1)?;
        let second = commit(store, 2)?;
        let third = commit(store, 3)?;
        store.maintain_outbox(
            &second.cursor(),
            NonZeroUsize::new(30).ok_or("zero")?,
            time(2),
        )?;
        // Maintenance expires one complete receipt per invocation.
        store.maintain_outbox(
            &second.cursor(),
            NonZeroUsize::new(30).ok_or("zero")?,
            time(2),
        )?;
        assert_eq!(
            store
                .governance_health(time(10), NonZeroUsize::MIN)?
                .retained_after(),
            Some(&second.cursor())
        );
        for (applied, expected) in [
            (first, Some(ContributorError::CursorExpired)),
            (second, None),
        ] {
            let report = snapshot(
                store,
                vec![declaration(1, false, 10)],
                &[ContributorObservation::new(
                    id(1),
                    Some(third.clone()),
                    Some(applied),
                    ContributorHealth::Healthy,
                )],
            )?;
            assert_eq!(report.contributor_error(), expected);
        }
        Ok(())
    })
}
#[test]
fn lease_lag_backpressure_and_clock_regression_are_observed_without_mutation() -> TestResult {
    each_backend(|store| {
        store.configure_outbox_retention(
            OutboxRetentionPolicy::new(NonZeroU64::new(2).ok_or("zero")?, NonZeroU16::MIN)?,
            time(5),
        )?;
        commit(store, 1)?;
        store.acquire_outbox_lease([1; 16], None, time(30), time(5))?;
        let policy = ReadinessPolicy::default().with_max_live_consumer_lag(1);
        let report = store.operational_snapshot(
            &policy,
            &ContributorRegistry::default(),
            &[],
            time(10),
            &TransactionStartControl::new(),
            CircuitState::Closed,
        );
        assert!(
            report
                .reasons()
                .any(|reason| reason == ReadinessReason::Backpressure)
        );
        assert!(
            report
                .reasons()
                .any(|reason| reason == ReadinessReason::ConsumerLag)
        );
        assert_eq!(report.governance().ok_or("missing")?.live_leases(), 1);
        let regressed = store.operational_snapshot(
            &policy,
            &ContributorRegistry::default(),
            &[],
            time(4),
            &TransactionStartControl::new(),
            CircuitState::Closed,
        );
        assert_eq!(regressed.disposition(), ReadinessDisposition::NotReady);
        assert!(
            regressed
                .reasons()
                .any(|reason| reason == ReadinessReason::Outbox)
        );
        assert_eq!(
            store
                .governance_health(time(10), NonZeroUsize::MIN)?
                .physical_records(),
            2
        );
        Ok(())
    })
}

#[test]
fn maximum_inventory_keeps_metric_cardinality_fixed() -> TestResult {
    let store = Store::new()?;
    let declarations: Vec<_> = (0..128).map(|n| declaration(n, true, 0)).collect();
    let observations: Vec<_> = (0..128)
        .map(|n| ContributorObservation::new(id(n), None, None, ContributorHealth::Healthy))
        .collect();
    let report = snapshot(&store, declarations.clone(), &observations)?;
    assert_eq!(report.disposition(), ReadinessDisposition::Ready);
    assert_eq!(report.contributors().ok_or("missing")?.entries().len(), 128);
    assert!(report.metrics().len() <= 21);
    let mut oversized = declarations;
    oversized.push(declaration(128, true, 0));
    assert!(matches!(
        ContributorRegistry::new(oversized),
        Err(ContributorError::Capacity)
    ));
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn checkpoint_inventory_survives_reopen_and_read_only_observation() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    let checkpoint = commit(&store, 1)?;
    let observations = [ContributorObservation::new(
        id(1),
        Some(checkpoint.clone()),
        Some(checkpoint),
        ContributorHealth::Healthy,
    )];
    let before = snapshot(&store, vec![declaration(1, true, 0)], &observations)?;
    let expected = before.contributors().ok_or("missing")?.fingerprint();
    drop(store);
    let store = Store::open(directory.path())?;
    let after = snapshot(&store, vec![declaration(1, true, 0)], &observations)?;
    assert_eq!(after.disposition(), ReadinessDisposition::Ready);
    assert_eq!(
        after.contributors().ok_or("missing")?.fingerprint(),
        expected
    );
    drop(store);
    let read_only = Store::open_read_only(directory.path())?;
    let after = snapshot(&read_only, vec![declaration(1, true, 0)], &observations)?;
    assert_eq!(after.disposition(), ReadinessDisposition::Ready);
    assert_eq!(
        after.contributors().ok_or("missing")?.fingerprint(),
        expected
    );
    assert_eq!(read_only.len()?, 1);
    Ok(())
}
