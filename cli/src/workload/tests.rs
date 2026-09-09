use super::*;
use anyhow::{Result, ensure};
use serde_json::json;
use std::thread;

fn controller(
    active: usize,
    queued: usize,
    class_active: usize,
    class_queued: usize,
) -> Result<AdmissionController> {
    Ok(AdmissionController::new(WorkloadPolicy::from_json(
        &serde_json::to_vec(&json!({
            "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
            "max_active":active, "max_queued":queued, "operator_max_active":1,
            "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
            "classes":{"default":{"max_active":class_active,"max_queued":class_queued},
                "second":{"max_active":class_active,"max_queued":class_queued}}
        }))?,
    )?)?)
}

fn acquire(controller: &AdmissionController, class: &str) -> Result<WorkloadLease> {
    Ok(controller.acquire(class, ListenerKind::Data, CancellationToken::new())?)
}

fn wait_queued(controller: &AdmissionController, count: usize) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while controller.snapshot()?.queued != count {
        ensure!(Instant::now() < deadline, "queue did not reach {count}");
        thread::yield_now();
    }
    Ok(())
}

#[test]
fn lease_clones_cancel_drop_and_unwind_hold_exact_capacity() -> Result<()> {
    let controller = controller(1, 0, 1, 0)?;
    let lease = acquire(&controller, "default")?;
    ensure!(lease.policy_id() == "test" && lease.policy_version() == 1);
    let clone = lease.clone();
    lease.cancellation_token().cancel();
    drop(lease);
    ensure!(controller.snapshot()?.active == 1);
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, CancellationToken::new()),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    drop(clone);
    ensure!(controller.snapshot()?.active == 0);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _lease = acquire(&controller, "default").unwrap();
        panic!("injected handler unwind");
    }));
    ensure!(result.is_err() && controller.snapshot()?.active == 0);
    drop(acquire(&controller, "default")?);
    Ok(())
}

#[test]
fn class_global_operator_rejections_and_reserved_capacity() -> Result<()> {
    let controller = controller(2, 1, 1, 0)?;
    let first = acquire(&controller, "default")?;
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, CancellationToken::new()),
        Err(WorkloadError::Overloaded(AdmissionScope::Class))
    ));
    let response = controller.denial(WorkloadError::Overloaded(AdmissionScope::Class));
    ensure!(response.status() == 429 && response.headers()[RETRY_AFTER] == "2");
    let second = acquire(&controller, "second")?;
    let operator =
        controller.acquire("default", ListenerKind::Operator, CancellationToken::new())?;
    ensure!(controller.snapshot()?.operator_active == 1 && controller.snapshot()?.active == 2);
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Operator, CancellationToken::new()),
        Err(WorkloadError::Overloaded(AdmissionScope::Operator))
    ));
    ensure!(
        controller
            .denial(WorkloadError::Overloaded(AdmissionScope::Global))
            .status()
            == 503
    );
    ensure!(matches!(
        controller.acquire("missing", ListenerKind::Operator, CancellationToken::new()),
        Err(WorkloadError::UnknownClass)
    ));
    drop((first, second, operator));
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn deterministic_fifo_eligible_class_and_expiry_boundary() -> Result<()> {
    let controller = controller(2, 3, 1, 3)?;
    let now = Instant::now();
    // Drive the real selection/expiry functions with an explicit clock and one
    // occupied class. No live lease is attached to this local state fixture.
    let mut state = State {
        active: 1,
        ..State::default()
    };
    state.classes.insert("default".into(), 1);
    let waiting = controller.entry(
        &mut state,
        "default",
        ListenerKind::Data,
        CancellationToken::new(),
        now,
    )?;
    let following = controller.entry(
        &mut state,
        "second",
        ListenerKind::Data,
        CancellationToken::new(),
        now,
    )?;
    let (first, second, deadline) = (waiting.id, following.id, waiting.deadline);
    state.queue.extend([waiting, following]);
    ensure!(controller.first_eligible(&state, false) == Some(second));
    state.active = 0;
    state.classes.insert("default".into(), 0);
    ensure!(controller.first_eligible(&state, false) == Some(first));
    AdmissionController::purge(&mut state, deadline - Duration::from_nanos(1));
    ensure!(state.queue.len() == 2);
    AdmissionController::purge(&mut state, deadline);
    ensure!(state.queue.is_empty());
    Ok(())
}

#[test]
fn real_fifo_waiters_cannot_overtake_on_release() -> Result<()> {
    let controller = controller(1, 3, 1, 3)?;
    let held = acquire(&controller, "default")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut workers = Vec::new();
    for index in 0..3 {
        let child = controller.clone();
        let sender = sender.clone();
        workers.push(thread::spawn(move || {
            let lease = child.acquire("default", ListenerKind::Data, CancellationToken::new());
            sender.send((index, lease)).unwrap();
        }));
        wait_queued(&controller, index + 1)?;
    }
    drop(held);
    for expected in 0..3 {
        let (index, lease) = receiver.recv_timeout(Duration::from_secs(3))?;
        let lease = lease?;
        ensure!(index == expected && controller.snapshot()?.active == 1);
        ensure!(receiver.try_recv().is_err(), "more than one active permit");
        drop(lease);
    }
    for worker in workers {
        worker.join().unwrap();
    }
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn real_queue_cancel_fifo_and_full_bound() -> Result<()> {
    let controller = controller(1, 2, 1, 2)?;
    let held = acquire(&controller, "default")?;
    let cancelled = CancellationToken::new();
    let child = controller.clone();
    let token = cancelled.clone();
    let first = thread::spawn(move || child.acquire("default", ListenerKind::Data, token));
    wait_queued(&controller, 1)?;
    let child = controller.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let second = thread::spawn(move || {
        let lease = child.acquire("default", ListenerKind::Data, CancellationToken::new());
        sender.send(lease.is_ok()).unwrap();
        lease
    });
    wait_queued(&controller, 2)?;
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, CancellationToken::new()),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    cancelled.cancel();
    ensure!(matches!(
        first.join().unwrap(),
        Err(WorkloadError::Cancelled)
    ));
    wait_queued(&controller, 1)?;
    ensure!(receiver.try_recv().is_err());
    drop(held);
    ensure!(receiver.recv_timeout(Duration::from_secs(3))?);
    drop(second.join().unwrap()?);
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn real_queue_timeout_removes_slot() -> Result<()> {
    let mut policy = controller(1, 1, 1, 1)?.0.policy.clone();
    policy.queue_timeout_ms = 15;
    let controller = AdmissionController::new(policy)?;
    let held = acquire(&controller, "default")?;
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, CancellationToken::new()),
        Err(WorkloadError::AdmissionTimedOut)
    ));
    ensure!(controller.snapshot()?.queued == 0 && controller.snapshot()?.active == 1);
    drop(held);
    drop(acquire(&controller, "default")?);
    Ok(())
}

#[test]
fn invalid_profiles_and_missing_context_fail_closed() -> Result<()> {
    let controller = controller(1, 0, 1, 0)?;
    for bytes in [b"{}".as_slice(), b"[]", b"{\"format\":\"future\"}"] {
        ensure!(WorkloadPolicy::from_json(bytes).is_err());
    }
    ensure!(WorkloadPolicy::from_json(&vec![b' '; 65_537]).is_err());
    let mut policy = controller.0.policy.clone();
    policy.max_active = 0;
    ensure!(AdmissionController::new(policy).is_err());
    let mut policy = controller.0.policy.clone();
    policy.operator_max_active = usize::MAX;
    ensure!(AdmissionController::new(policy).is_err());
    let mut policy = controller.0.policy.clone();
    policy.retry_after_seconds = 301;
    ensure!(AdmissionController::new(policy).is_err());
    ensure!(
        controller
            .admit(&mut Extensions::new(), ListenerKind::Data)
            .is_err()
    );
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    controller.validate_access(&crate::access::AccessController::anonymous(false))?;
    Ok(())
}

#[test]
fn deadline_is_absolute_including_queue_wait_and_keeps_active_ownership() -> Result<()> {
    let mut policy = controller(1, 1, 1, 1)?.0.policy.clone();
    policy.request_timeout_ms = Some(40);
    let controller = AdmissionController::new(policy)?;
    let held = acquire(&controller, "default")?;
    let deadline = held.deadline().unwrap();
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, CancellationToken::new()),
        Err(WorkloadError::RequestTimedOut)
    ));
    ensure!(Instant::now() >= deadline);
    ensure!(held.check() == Err(WorkloadError::RequestTimedOut));
    ensure!(controller.snapshot()?.active == 1 && controller.snapshot()?.queued == 0);
    drop(held);
    let next = acquire(&controller, "default")?;
    ensure!(next.deadline().unwrap() > deadline);
    Ok(())
}

#[test]
fn expired_tokens_fail_before_fast_admission_and_final_activation() -> Result<()> {
    let controller = controller(1, 0, 1, 0)?;
    let expired = CancellationToken::new().with_deadline(Instant::now());
    ensure!(matches!(
        controller.acquire("default", ListenerKind::Data, expired),
        Err(WorkloadError::RequestTimedOut)
    ));
    let mut state = State::default();
    let mut entry = controller.entry(
        &mut state,
        "default",
        ListenerKind::Data,
        CancellationToken::new(),
        Instant::now(),
    )?;
    entry.cancellation = entry.cancellation.with_deadline(Instant::now());
    ensure!(matches!(
        controller.activate(&mut state, &entry),
        Err(WorkloadError::RequestTimedOut)
    ));
    ensure!(state.active == 0 && state.classes.is_empty());
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    let mut policy = controller.0.policy.clone();
    policy.request_timeout_ms = Some(0);
    ensure!(AdmissionController::new(policy).is_err());
    Ok(())
}

#[test]
fn queue_residence_does_not_restart_an_earlier_caller_deadline() -> Result<()> {
    let controller = controller(1, 1, 1, 1)?;
    let held = acquire(&controller, "default")?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let child = controller.clone();
    let worker = thread::spawn(move || {
        child.acquire(
            "default",
            ListenerKind::Data,
            CancellationToken::new().with_deadline(deadline),
        )
    });
    wait_queued(&controller, 1)?;
    drop(held);
    let lease = worker.join().unwrap()?;
    ensure!(lease.deadline() == Some(deadline));
    ensure!(lease.check().is_ok());
    Ok(())
}
