use super::*;
use anyhow::{Result, ensure};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Barrier;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

fn raw(controller: &AdmissionController, class: &str) -> Result<WorkloadLease, WorkloadError> {
    controller.acquire(class, ListenerKind::Data, CancellationToken::new())
}

fn wait_queued(controller: &AdmissionController, count: usize) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while controller.snapshot()?.queued != count {
        ensure!(Instant::now() < deadline, "queue did not reach {count}");
        thread::yield_now();
    }
    Ok(())
}

fn reload_policy(
    version: u64,
    max_active: usize,
    max_queued: usize,
    operator_max_active: usize,
    operator_max_queued: usize,
    classes: &[(&str, usize, usize)],
) -> serde_json::Value {
    let classes = classes
        .iter()
        .map(|(name, active, queued)| {
            (
                (*name).to_owned(),
                json!({"max_active":active,"max_queued":queued}),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    json!({
        "format":"oxigraph-admission-v1", "policy_id":"reload-test", "version":version,
        "max_active":max_active, "max_queued":max_queued,
        "operator_max_active":operator_max_active,
        "operator_max_queued":operator_max_queued,
        "queue_timeout_ms":4000, "request_timeout_ms":5000,
        "request_body_limits":{"max_encoded_bytes":1000,"max_decoded_bytes":1001},
        "max_result_bytes":1002, "max_inner_join_build_rows":1003,
        "max_sort_buffer_rows":1004, "max_distinct_buffer_rows":1005,
        "max_group_buffer_rows":1006, "retry_after_seconds":7,
        "classes":classes
    })
}

fn write_workload(path: &Path, policy: &serde_json::Value) -> Result<()> {
    let temporary = path.with_extension("next");
    std::fs::write(&temporary, serde_json::to_vec(policy)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn file_controller(
    policy: &serde_json::Value,
) -> Result<(assert_fs::TempDir, PathBuf, AdmissionController)> {
    let directory = assert_fs::TempDir::new()?;
    let path = directory.path().join("workload.json");
    write_workload(&path, policy)?;
    let controller = AdmissionController::from_file(&path)?;
    Ok((directory, path, controller))
}

struct UnusedIdentity;
impl crate::access::RequestIdentityProvider for UnusedIdentity {
    fn authenticate(
        &self,
        _: crate::access::RequestMetadata<'_>,
        _: u64,
        _: Instant,
    ) -> std::result::Result<crate::access::RequestPrincipal, crate::access::AccessError> {
        Err(crate::access::AccessError::Provider)
    }
}
struct UnusedAuthorizer;
impl crate::access::RequestAuthorizer for UnusedAuthorizer {
    fn authorize(
        &self,
        _: &crate::access::RequestPrincipal,
        _: &crate::access::RequestOperation,
        _: Instant,
    ) -> std::result::Result<crate::access::AccessGrant, crate::access::AccessError> {
        Err(crate::access::AccessError::Denied)
    }
}
fn access_with_classes(classes: &[&str]) -> Result<crate::access::AccessController> {
    Ok(crate::access::AccessController::new(
        crate::access::AccessPolicy::new(
            "workload-test-access".into(),
            1,
            Arc::new(UnusedIdentity),
            Arc::new(UnusedAuthorizer),
            classes.iter().map(|class| (*class).to_owned()).collect(),
            Duration::from_secs(1),
        )?,
        false,
    ))
}

#[test]
fn reload_rejects_bad_identity_versions_classes_sources_and_transport_growth() -> Result<()> {
    let initial = reload_policy(2, 2, 2, 2, 1, &[("default", 2, 2), ("second", 2, 2)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = access_with_classes(&["default", "second"])?;
    ensure!(controller.connection_limit(ListenerKind::Data) == 5);
    ensure!(controller.connection_limit(ListenerKind::Operator) == 4);

    let mut invalid = reload_policy(3, 2, 2, 2, 1, &[("default", 2, 2), ("second", 2, 2)]);
    invalid["unknown"] = json!(true);
    write_workload(&path, &invalid)?;
    ensure!(controller.reload(&access).is_err());
    std::fs::write(&path, vec![b' '; MAX_PROFILE_BYTES as usize + 1])?;
    ensure!(controller.reload(&access).is_err());

    for candidate in [
        reload_policy(2, 2, 2, 2, 1, &[("default", 2, 2), ("second", 2, 2)]),
        reload_policy(1, 2, 2, 2, 1, &[("default", 2, 2), ("second", 2, 2)]),
    ] {
        write_workload(&path, &candidate)?;
        ensure!(controller.reload(&access).is_err());
    }
    let mut wrong_id = reload_policy(3, 2, 2, 2, 1, &[("default", 2, 2), ("second", 2, 2)]);
    wrong_id["policy_id"] = json!("other");
    write_workload(&path, &wrong_id)?;
    ensure!(controller.reload(&access).is_err());
    for candidate in [
        reload_policy(3, 3, 2, 2, 1, &[("default", 3, 2), ("second", 3, 2)]),
        reload_policy(3, 2, 2, 3, 1, &[("default", 2, 2), ("second", 2, 2)]),
    ] {
        write_workload(&path, &candidate)?;
        ensure!(controller.reload(&access).is_err());
    }
    // The current access snapshot also declares `second`; removing it is
    // rejected at the workload swap even though the workload schema is valid.
    write_workload(&path, &reload_policy(3, 2, 2, 2, 1, &[("default", 2, 2)]))?;
    ensure!(matches!(
        controller.reload(&access),
        Err(WorkloadError::UnknownClass)
    ));
    ensure!(acquire(&controller, "default")?.policy_version() == 2);

    let good = reload_policy(3, 1, 2, 1, 1, &[("default", 1, 2)]);
    write_workload(&path, &good)?;
    let default_access = crate::access::AccessController::anonymous(false);
    ensure!(controller.reload(&default_access)? == 3);
    ensure!(controller.connection_limit(ListenerKind::Data) == 5);
    ensure!(controller.connection_limit(ListenerKind::Operator) == 4);
    ensure!(acquire(&controller, "default")?.policy_version() == 3);
    std::fs::remove_file(&path)?;
    ensure!(controller.reload(&default_access).is_err());
    ensure!(acquire(&controller, "default")?.policy_version() == 3);

    let memory = self::controller(1, 0, 1, 0)?;
    ensure!(memory.reload(&default_access).is_err());
    Ok(())
}

#[test]
fn workload_sources_must_be_regular_files() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    ensure!(matches!(
        WorkloadPolicy::load(directory.path()),
        Err(WorkloadError::InvalidPolicy)
    ));

    #[cfg(unix)]
    {
        use std::os::unix::net::UnixListener;

        let socket_path = directory.path().join("workload.sock");
        let _socket = UnixListener::bind(&socket_path)?;
        ensure!(matches!(
            WorkloadPolicy::load(&socket_path),
            Err(WorkloadError::InvalidPolicy)
        ));
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn regular_file_symlink_remains_a_valid_startup_and_reload_source() -> Result<()> {
    use std::os::unix::fs::symlink;

    let directory = assert_fs::TempDir::new()?;
    let target = directory.path().join("policy.json");
    let link = directory.path().join("configured-policy.json");
    write_workload(&target, &reload_policy(1, 2, 2, 1, 0, &[("default", 2, 2)]))?;
    symlink(&target, &link)?;
    let controller = AdmissionController::from_file(&link)?;
    ensure!(acquire(&controller, "default")?.policy_version() == 1);
    write_workload(&target, &reload_policy(2, 2, 2, 1, 0, &[("default", 2, 2)]))?;
    ensure!(controller.reload(&crate::access::AccessController::anonymous(false))? == 2);
    ensure!(acquire(&controller, "default")?.policy_version() == 2);

    let directory_link = directory.path().join("not-a-policy.json");
    symlink(directory.path(), &directory_link)?;
    ensure!(matches!(
        WorkloadPolicy::load(&directory_link),
        Err(WorkloadError::InvalidPolicy)
    ));
    Ok(())
}

#[test]
fn cancelled_or_expired_prepared_candidate_cannot_cross_the_swap_boundary() -> Result<()> {
    let initial = reload_policy(1, 2, 2, 1, 0, &[("default", 2, 2)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = crate::access::AccessController::anonymous(false);
    let candidate = Arc::new(WorkloadPolicy::from_json(&serde_json::to_vec(
        &reload_policy(2, 2, 2, 1, 0, &[("default", 2, 2)]),
    )?)?);

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    ensure!(matches!(
        controller.apply_candidate(&access, Arc::clone(&candidate), Some(&cancelled)),
        Err(WorkloadError::Cancelled)
    ));
    ensure!(controller.0.state.lock().unwrap().policy.version == 1);

    let expired = CancellationToken::new().with_deadline(Instant::now());
    ensure!(matches!(
        controller.apply_candidate(&access, candidate, Some(&expired)),
        Err(WorkloadError::RequestTimedOut)
    ));
    ensure!(controller.0.state.lock().unwrap().policy.version == 1);

    std::fs::remove_file(path)?;
    ensure!(matches!(
        controller.reload_with_cancellation(&access, &cancelled),
        Err(WorkloadError::Cancelled)
    ));
    Ok(())
}

#[test]
fn active_and_queued_attempts_keep_v1_snapshot_across_lower_v2() -> Result<()> {
    let initial = reload_policy(1, 1, 2, 1, 1, &[("default", 1, 2)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = crate::access::AccessController::anonymous(false);
    let active = acquire(&controller, "default")?;
    let active_clone = active.clone();
    let active_deadline = active.deadline();
    ensure!(
        active
            .inner_join_build_budget()
            .map(InnerJoinBuildBudget::limit)
            == Some(1003)
    );
    ensure!(active.sort_buffer_budget().map(SortBufferBudget::limit) == Some(1004));
    ensure!(
        active
            .distinct_buffer_budget()
            .map(DistinctBufferBudget::limit)
            == Some(1005)
    );
    ensure!(active.group_buffer_budget().map(GroupBufferBudget::limit) == Some(1006));
    let queued_controller = controller.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let waiter = thread::spawn(move || {
        sender
            .send(queued_controller.acquire(
                "default",
                ListenerKind::Data,
                CancellationToken::new(),
            ))
            .unwrap();
    });
    wait_queued(&controller, 1)?;
    let (queued_admission_deadline, queued_request_deadline) = {
        let state = controller.0.state.lock().unwrap();
        let queued = state.queue.front().expect("queued attempt");
        (queued.deadline, queued.cancellation.deadline())
    };
    let before = controller.metrics()?;

    let mut lower = reload_policy(2, 1, 0, 1, 0, &[("default", 1, 0)]);
    lower["request_timeout_ms"] = json!(100);
    lower["queue_timeout_ms"] = json!(50);
    lower["request_body_limits"] = json!({"max_encoded_bytes":0,"max_decoded_bytes":0});
    lower["max_result_bytes"] = json!(0);
    lower["max_inner_join_build_rows"] = json!(0);
    lower["max_sort_buffer_rows"] = json!(0);
    lower["max_distinct_buffer_rows"] = json!(0);
    lower["max_group_buffer_rows"] = json!(0);
    lower["retry_after_seconds"] = json!(9);
    write_workload(&path, &lower)?;
    ensure!(controller.reload(&access)? == 2);
    ensure!(active.deadline() == active_deadline);
    {
        let state = controller.0.state.lock().unwrap();
        let queued = state.queue.front().expect("queued attempt after reload");
        ensure!(queued.deadline == queued_admission_deadline);
        ensure!(queued.cancellation.deadline() == queued_request_deadline);
    }
    ensure!(
        controller.metrics()? == before,
        "reload reset admission metrics"
    );
    ensure!(
        AdmissionController::denial_with_policy(
            WorkloadError::Overloaded(AdmissionScope::Class),
            &active.0.policy,
        )
        .headers()[RETRY_AFTER]
            == "7"
    );
    ensure!(
        controller
            .denial(WorkloadError::Overloaded(AdmissionScope::Class))
            .headers()[RETRY_AFTER]
            == "9"
    );
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    drop(active);
    ensure!(controller.snapshot()?.active == 1 && controller.snapshot()?.queued == 1);
    drop(active_clone);
    let queued = receiver.recv_timeout(Duration::from_secs(3))??;
    waiter.join().unwrap();
    ensure!(queued.policy_version() == 1 && queued.policy_id() == "reload-test");
    ensure!(queued.deadline() == queued_request_deadline);
    ensure!(queued.result_byte_limit() == Some(oxhttp::ResponseBodyLimit(1002)));
    ensure!(
        queued.request_body_limits()
            == Some(oxhttp::RequestBodyLimits {
                max_encoded_bytes: 1000,
                max_decoded_bytes: 1001,
            })
    );
    ensure!(
        queued
            .inner_join_build_budget()
            .map(InnerJoinBuildBudget::limit)
            == Some(1003)
    );
    ensure!(queued.sort_buffer_budget().map(SortBufferBudget::limit) == Some(1004));
    ensure!(
        queued
            .distinct_buffer_budget()
            .map(DistinctBufferBudget::limit)
            == Some(1005)
    );
    ensure!(queued.group_buffer_budget().map(GroupBufferBudget::limit) == Some(1006));
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    drop(queued);
    let v2 = acquire(&controller, "default")?;
    ensure!(v2.policy_version() == 2);
    ensure!(v2.result_byte_limit() == Some(oxhttp::ResponseBodyLimit(0)));
    ensure!(
        v2.inner_join_build_budget()
            .map(InnerJoinBuildBudget::limit)
            == Some(0)
    );
    ensure!(v2.sort_buffer_budget().map(SortBufferBudget::limit) == Some(0));
    ensure!(v2.distinct_buffer_budget().map(DistinctBufferBudget::limit) == Some(0));
    ensure!(v2.group_buffer_budget().map(GroupBufferBudget::limit) == Some(0));
    ensure!(v2.deadline().is_some_and(|deadline| {
        deadline.saturating_duration_since(Instant::now()) <= Duration::from_millis(100)
    }));
    Ok(())
}

#[test]
fn lower_active_cap_counts_old_occupancy_without_retroactive_release() -> Result<()> {
    let initial = reload_policy(1, 2, 1, 1, 0, &[("default", 2, 1)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = crate::access::AccessController::anonymous(false);
    let first = acquire(&controller, "default")?;
    let second = acquire(&controller, "default")?;
    write_workload(&path, &reload_policy(2, 1, 0, 1, 0, &[("default", 1, 0)]))?;
    controller.reload(&access)?;
    ensure!(controller.snapshot()?.active == 2);
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    drop(first);
    ensure!(controller.snapshot()?.active == 1);
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    drop(second);
    let v2 = acquire(&controller, "default")?;
    ensure!(v2.policy_version() == 2 && controller.snapshot()?.active == 1);
    Ok(())
}

#[test]
fn removed_class_queues_drain_and_obsolete_counts_stay_bounded() -> Result<()> {
    let initial = reload_policy(1, 2, 2, 1, 0, &[("default", 1, 1), ("old", 1, 1)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = crate::access::AccessController::anonymous(false);
    let held = acquire(&controller, "old")?;
    let queued_controller = controller.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let waiter = thread::spawn(move || sender.send(raw(&queued_controller, "old")).unwrap());
    wait_queued(&controller, 1)?;
    write_workload(&path, &reload_policy(2, 2, 2, 1, 0, &[("default", 1, 1)]))?;
    ensure!(controller.reload(&access)? == 2);
    ensure!(matches!(
        raw(&controller, "old"),
        Err(WorkloadError::UnknownClass)
    ));
    drop(held);
    let old = receiver.recv_timeout(Duration::from_secs(3))??;
    waiter.join().unwrap();
    ensure!(old.policy_version() == 1);
    drop(old);
    ensure!(controller.0.state.lock().unwrap().classes.is_empty());

    for version in 3..=40 {
        let name = format!("class-{version}");
        write_workload(
            &path,
            &reload_policy(version, 2, 2, 1, 0, &[("default", 1, 1), (&name, 1, 1)]),
        )?;
        controller.reload(&access)?;
        drop(acquire(&controller, &name)?);
        ensure!(controller.0.state.lock().unwrap().classes.is_empty());
    }
    Ok(())
}

#[test]
fn concurrent_admissions_observe_only_coherent_policy_snapshots() -> Result<()> {
    let initial = reload_policy(1, 8, 0, 1, 0, &[("default", 8, 0)]);
    let (_directory, path, controller) = file_controller(&initial)?;
    let access = Arc::new(crate::access::AccessController::anonymous(false));
    let running = Arc::new(AtomicBool::new(true));
    let start = Arc::new(Barrier::new(5));
    let old_observed = Arc::new(Barrier::new(5));
    let old_count = Arc::new(AtomicUsize::new(0));
    let new_count = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();
    for _ in 0..4 {
        let controller = controller.clone();
        let running = Arc::clone(&running);
        let start = Arc::clone(&start);
        let old_observed = Arc::clone(&old_observed);
        let old_count = Arc::clone(&old_count);
        let new_count = Arc::clone(&new_count);
        workers.push(thread::spawn(move || {
            start.wait();
            let mut saw_old = false;
            let mut saw_new = false;
            while running.load(Ordering::Acquire) {
                if let Ok(lease) = raw(&controller, "default") {
                    let policy = &lease.0.policy;
                    let base = if policy.version % 2 == 0 { 2000 } else { 1000 };
                    assert_eq!(policy.request_body_limits.unwrap().max_encoded_bytes, base);
                    assert_eq!(
                        policy.request_body_limits.unwrap().max_decoded_bytes,
                        base + 1
                    );
                    assert_eq!(policy.max_result_bytes, Some(base + 2));
                    assert_eq!(policy.max_inner_join_build_rows, Some(base + 3));
                    assert_eq!(policy.max_sort_buffer_rows, Some(base + 4));
                    assert_eq!(policy.max_distinct_buffer_rows, Some(base + 5));
                    assert_eq!(policy.max_group_buffer_rows, Some(base + 6));
                    assert_eq!(policy.retry_after_seconds, if base == 1000 { 7 } else { 9 });
                    if policy.version == 1 && !saw_old {
                        saw_old = true;
                        old_count.fetch_add(1, Ordering::AcqRel);
                        old_observed.wait();
                    } else if policy.version >= 2 && !saw_new {
                        saw_new = true;
                        new_count.fetch_add(1, Ordering::AcqRel);
                    }
                }
            }
            assert!(saw_old && saw_new);
        }));
    }
    start.wait();
    old_observed.wait();
    ensure!(old_count.load(Ordering::Acquire) == 4);
    for version in 2..=80 {
        let base = if version % 2 == 0 { 2000 } else { 1000 };
        let mut candidate = reload_policy(version, 8, 0, 1, 0, &[("default", 8, 0)]);
        candidate["request_body_limits"] =
            json!({"max_encoded_bytes":base,"max_decoded_bytes":base+1});
        candidate["max_result_bytes"] = json!(base + 2);
        candidate["max_inner_join_build_rows"] = json!(base + 3);
        candidate["max_sort_buffer_rows"] = json!(base + 4);
        candidate["max_distinct_buffer_rows"] = json!(base + 5);
        candidate["max_group_buffer_rows"] = json!(base + 6);
        candidate["retry_after_seconds"] = json!(if base == 1000 { 7 } else { 9 });
        write_workload(&path, &candidate)?;
        ensure!(controller.reload(&access)? == version);
        if version == 2 {
            let deadline = Instant::now() + Duration::from_secs(3);
            while new_count.load(Ordering::Acquire) != 4 {
                ensure!(
                    Instant::now() < deadline,
                    "workers did not all observe the replacement snapshot"
                );
                thread::yield_now();
            }
        }
    }
    running.store(false, Ordering::Release);
    for worker in workers {
        worker.join().unwrap();
    }
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn socket_reset_releases_only_queued_capacity_before_timeout() -> Result<()> {
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener, TcpStream};
    use std::sync::atomic::{AtomicUsize, Ordering};

    for listener_kind in [ListenerKind::Data, ListenerKind::Operator] {
        let mut policy = controller(1, 1, 1, 1)?.0.policy.clone();
        policy.operator_max_queued = 1;
        policy.queue_timeout_ms = 30_000;
        let controller = AdmissionController::new(policy)?;
        let active = controller.acquire("default", listener_kind, CancellationToken::new())?;
        let calls = Arc::new(AtomicUsize::new(0));
        let handler_calls = Arc::clone(&calls);
        let admission = controller.clone();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        drop(listener);
        // OxHTTP's public server is process-lifetime; request workers and leases
        // are bounded and finish below. No store or external service is involved.
        let _server = oxhttp::Server::new(move |request| {
            if request.uri().path() != "/first" {
                handler_calls.fetch_add(1, Ordering::SeqCst);
            }
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |head, _| {
            let mut context = Extensions::new();
            if head.uri_ref().unwrap().path() != "/first" {
                let lease = admission
                    .acquire_with_abort(
                        "default",
                        listener_kind,
                        CancellationToken::new(),
                        head.extensions_ref()
                            .unwrap()
                            .get::<oxhttp::AdmissionAbort>(),
                    )
                    .map_err(|error| Box::new(admission.denial(error)))?;
                context.insert(oxhttp::RequestLifetime::new(lease));
            }
            Ok(context)
        })
        .bind(address)
        .with_global_timeout(Duration::from_secs(3))
        .with_max_concurrent_connections(2)
        .spawn()?;
        let wait_count = |count| -> Result<()> {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let snapshot = controller.snapshot()?;
                let queued = if listener_kind == ListenerKind::Data {
                    snapshot.queued
                } else {
                    snapshot.operator_queued
                };
                if queued == count {
                    return Ok(());
                }
                ensure!(
                    Instant::now() < deadline,
                    "queue did not reach {count}: {snapshot:?}"
                );
                thread::yield_now();
            }
        };
        let mut client = TcpStream::connect(address)?;
        client.set_read_timeout(Some(Duration::from_secs(3)))?;
        client.write_all(b"GET /first HTTP/1.1\r\nhost: localhost\r\n\r\n")?;
        ensure!(client.peek(&mut [0; 1])? > 0);
        client.write_all(b"POST /cancelled HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: invalid\r\n\r\n")?;
        wait_count(1)?; // Actual controller state, not a sleep or admission event.
        drop(client); // Unread response produces TCP reset on Linux.
        wait_count(0)?; // 3s check is strictly shorter than the 30s queue timeout.
        let snapshot = controller.snapshot()?;
        ensure!(snapshot.active + snapshot.operator_active == 1);
        ensure!(calls.load(Ordering::SeqCst) == 0);

        let mut next = TcpStream::connect(address)?;
        next.set_read_timeout(Some(Duration::from_secs(3)))?;
        next.write_all(b"GET /next HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
        next.shutdown(std::net::Shutdown::Write)?;
        wait_count(1)?;
        ensure!(
            calls.load(Ordering::SeqCst) == 0,
            "half-close bypassed active lease"
        );
        drop(active);
        let mut response = String::new();
        next.read_to_string(&mut response)?;
        ensure!(response.starts_with("HTTP/1.1 200 OK") && response.ends_with("\r\n\r\nok"));
        wait_count(0)?;
        ensure!(calls.load(Ordering::SeqCst) == 1);
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
    let mut state = State::new(Arc::new(controller.0.policy.clone()));
    state.active = 1;
    state.classes.insert("default".into(), 1);
    let policy = Arc::clone(&state.policy);
    let waiting = AdmissionController::entry(
        &mut state,
        "default",
        ListenerKind::Data,
        CancellationToken::new(),
        now,
        policy,
    )?;
    let policy = Arc::clone(&state.policy);
    let following = AdmissionController::entry(
        &mut state,
        "second",
        ListenerKind::Data,
        CancellationToken::new(),
        now,
        policy,
    )?;
    let (first, second, deadline) = (waiting.id, following.id, waiting.deadline);
    state.queue.extend([waiting, following]);
    ensure!(AdmissionController::first_eligible(&state, false) == Some(second));
    state.active = 0;
    state.classes.insert("default".into(), 0);
    ensure!(AdmissionController::first_eligible(&state, false) == Some(first));
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
fn body_budgets_are_explicit_and_bound_to_each_lease() -> Result<()> {
    let mut policy = controller(1, 0, 1, 0)?.0.policy.clone();
    policy.request_body_limits = Some(RequestBodyBudget {
        max_encoded_bytes: 0,
        max_decoded_bytes: 17,
    });
    let controller = AdmissionController::new(policy)?;
    let lease = acquire(&controller, "default")?;
    ensure!(
        lease.request_body_limits()
            == Some(oxhttp::RequestBodyLimits {
                max_encoded_bytes: 0,
                max_decoded_bytes: 17
            })
    );
    for invalid in [
        r#"{"max_encoded_bytes":1}"#,
        r#"{"max_decoded_bytes":1}"#,
        r#"{"max_encoded_bytes":1,"max_decoded_bytes":2,"unknown":3}"#,
        r#"{"max_encoded_bytes":-1,"max_decoded_bytes":2}"#,
    ] {
        ensure!(serde_json::from_str::<RequestBodyBudget>(invalid).is_err());
    }
    Ok(())
}

#[test]
fn result_budget_is_optional_unsigned_and_bound_to_each_lease() -> Result<()> {
    let controller = controller(1, 0, 1, 0)?;
    ensure!(
        acquire(&controller, "default")?
            .result_byte_limit()
            .is_none()
    );
    for limit in [0, 17, u64::MAX] {
        let mut policy = controller.0.policy.clone();
        policy.max_result_bytes = Some(limit);
        let controller = AdmissionController::new(policy)?;
        ensure!(
            acquire(&controller, "default")?.result_byte_limit()
                == Some(oxhttp::ResponseBodyLimit(limit))
        );
    }
    for value in [json!(-1), json!(1.5), json!("1"), json!(true)] {
        let bytes = serde_json::to_vec(
            &json!({"format":"oxigraph-admission-v1","policy_id":"test","version":1,
            "max_active":1,"max_queued":0,"operator_max_active":1,"operator_max_queued":0,
            "queue_timeout_ms":1000,"retry_after_seconds":1,"classes":{"default":{"max_active":1,"max_queued":0}},
            "max_result_bytes":value}),
        )?;
        ensure!(WorkloadPolicy::from_json(&bytes).is_err());
    }
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
fn join_budget_getters_share_state_but_new_admissions_do_not() -> Result<()> {
    let mut policy = controller(1, 0, 1, 0)?.0.policy.clone();
    ensure!(
        acquire(&AdmissionController::new(policy.clone())?, "default")?
            .inner_join_build_budget()
            .is_none()
    );
    policy.max_inner_join_build_rows = Some(2);
    let controller = AdmissionController::new(policy)?;
    let first = acquire(&controller, "default")?;
    let retained = first.inner_join_build_budget().unwrap().clone();
    let evaluator = oxigraph::sparql::SparqlEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(first.inner_join_build_budget().unwrap().clone());
    evaluator
        .parse_query("ASK { VALUES ?x { 1 2 } VALUES ?y { 3 } }")?
        .on_store(&oxigraph::store::Store::new()?)
        .execute()?;
    ensure!(
        retained.charged_rows() == 2
            && first.inner_join_build_budget().unwrap().charged_rows() == 2
    );
    drop(first);
    let second = acquire(&controller, "default")?;
    ensure!(second.inner_join_build_budget().unwrap().charged_rows() == 0);
    ensure!(retained.charged_rows() == 2);
    Ok(())
}

#[test]
fn sort_budget_getters_share_state_but_new_admissions_do_not() -> Result<()> {
    let mut policy = controller(1, 0, 1, 0)?.0.policy.clone();
    let unconfigured = acquire(&AdmissionController::new(policy.clone())?, "default")?;
    ensure!(unconfigured.sort_buffer_budget().is_none());
    drop(unconfigured);
    policy.max_sort_buffer_rows = Some(2);
    let controller = AdmissionController::new(policy)?;
    let first = acquire(&controller, "default")?;
    // The sort option alone never creates a join handle.
    ensure!(first.inner_join_build_budget().is_none());
    let retained = first.sort_buffer_budget().unwrap().clone();
    ensure!(retained.limit() == 2);
    let evaluator = oxigraph::sparql::SparqlEvaluator::new()
        .without_optimizations()
        .with_sort_buffer_budget(first.sort_buffer_budget().unwrap().clone());
    evaluator
        .parse_query("ASK { { SELECT ?x WHERE { VALUES ?x { 2 1 } } ORDER BY ?x } }")?
        .on_store(&oxigraph::store::Store::new()?)
        .execute()?;
    ensure!(
        retained.charged_rows() == 2 && first.sort_buffer_budget().unwrap().charged_rows() == 2
    );
    drop(first);
    let second = acquire(&controller, "default")?;
    ensure!(second.sort_buffer_budget().unwrap().charged_rows() == 0);
    ensure!(retained.charged_rows() == 2);
    Ok(())
}

#[test]
fn sort_budget_policy_parses_zero_and_coexists_with_the_join_cap() -> Result<()> {
    let policy = WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
        "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
        "max_active":1, "max_queued":0, "operator_max_active":1,
        "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
        "max_inner_join_build_rows":7, "max_sort_buffer_rows":0,
        "classes":{"default":{"max_active":1,"max_queued":0}}
    }))?)?;
    ensure!(policy.max_sort_buffer_rows == Some(0) && policy.max_inner_join_build_rows == Some(7));
    let lease = acquire(&AdmissionController::new(policy)?, "default")?;
    ensure!(lease.sort_buffer_budget().unwrap().limit() == 0);
    ensure!(lease.inner_join_build_budget().unwrap().limit() == 7);
    ensure!(
        WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
            "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
            "max_active":1, "max_queued":0, "operator_max_active":1,
            "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
            "max_sort_buffer_rows":-1,
            "classes":{"default":{"max_active":1,"max_queued":0}}
        }))?)
        .is_err()
    );
    Ok(())
}

#[test]
fn distinct_budget_getters_share_state_but_new_admissions_do_not() -> Result<()> {
    let mut policy = controller(1, 0, 1, 0)?.0.policy.clone();
    let unconfigured = acquire(&AdmissionController::new(policy.clone())?, "default")?;
    ensure!(unconfigured.distinct_buffer_budget().is_none());
    drop(unconfigured);
    policy.max_distinct_buffer_rows = Some(2);
    let controller = AdmissionController::new(policy)?;
    let first = acquire(&controller, "default")?;
    // The distinct option alone never creates a join or sort handle.
    ensure!(first.inner_join_build_budget().is_none());
    ensure!(first.sort_buffer_budget().is_none());
    let retained = first.distinct_buffer_budget().unwrap().clone();
    ensure!(retained.limit() == 2);
    let evaluator = oxigraph::sparql::SparqlEvaluator::new()
        .without_optimizations()
        .with_distinct_buffer_budget(first.distinct_buffer_budget().unwrap().clone());
    let oxigraph::sparql::QueryResults::Solutions(rows) = evaluator
        .parse_query("SELECT DISTINCT ?x WHERE { VALUES ?x { 2 1 2 } }")?
        .on_store(&oxigraph::store::Store::new()?)
        .execute()?
    else {
        anyhow::bail!("solutions expected");
    };
    ensure!(rows.collect::<Result<Vec<_>, _>>()?.len() == 2);
    ensure!(
        retained.charged_rows() == 2 && first.distinct_buffer_budget().unwrap().charged_rows() == 2
    );
    drop(first);
    let second = acquire(&controller, "default")?;
    ensure!(second.distinct_buffer_budget().unwrap().charged_rows() == 0);
    ensure!(retained.charged_rows() == 2);
    Ok(())
}

#[test]
fn distinct_budget_policy_parses_zero_and_coexists_with_the_other_caps() -> Result<()> {
    let policy = WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
        "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
        "max_active":1, "max_queued":0, "operator_max_active":1,
        "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
        "max_inner_join_build_rows":7, "max_sort_buffer_rows":5, "max_distinct_buffer_rows":0,
        "classes":{"default":{"max_active":1,"max_queued":0}}
    }))?)?;
    ensure!(policy.max_distinct_buffer_rows == Some(0));
    let lease = acquire(&AdmissionController::new(policy)?, "default")?;
    ensure!(lease.distinct_buffer_budget().unwrap().limit() == 0);
    ensure!(lease.sort_buffer_budget().unwrap().limit() == 5);
    ensure!(lease.inner_join_build_budget().unwrap().limit() == 7);
    ensure!(
        WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
            "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
            "max_active":1, "max_queued":0, "operator_max_active":1,
            "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
            "max_distinct_buffer_rows":-1,
            "classes":{"default":{"max_active":1,"max_queued":0}}
        }))?)
        .is_err()
    );
    Ok(())
}

#[test]
fn group_budget_getters_share_state_but_new_admissions_do_not() -> Result<()> {
    let mut policy = controller(1, 0, 1, 0)?.0.policy.clone();
    let unconfigured = acquire(&AdmissionController::new(policy.clone())?, "default")?;
    ensure!(unconfigured.group_buffer_budget().is_none());
    drop(unconfigured);
    policy.max_group_buffer_rows = Some(2);
    let controller = AdmissionController::new(policy)?;
    let first = acquire(&controller, "default")?;
    // The group option alone never creates other resource handles.
    ensure!(first.inner_join_build_budget().is_none());
    ensure!(first.sort_buffer_budget().is_none());
    ensure!(first.distinct_buffer_budget().is_none());
    let retained = first.group_buffer_budget().unwrap().clone();
    ensure!(retained.limit() == 2);
    let evaluator = oxigraph::sparql::SparqlEvaluator::new()
        .without_optimizations()
        .with_group_buffer_budget(first.group_buffer_budget().unwrap().clone());
    let oxigraph::sparql::QueryResults::Solutions(rows) = evaluator
        .parse_query("SELECT ?x (COUNT(*) AS ?n) WHERE { VALUES ?x { 2 1 2 } } GROUP BY ?x")?
        .on_store(&oxigraph::store::Store::new()?)
        .execute()?
    else {
        anyhow::bail!("solutions expected");
    };
    ensure!(rows.collect::<Result<Vec<_>, _>>()?.len() == 2);
    ensure!(
        retained.charged_rows() == 2 && first.group_buffer_budget().unwrap().charged_rows() == 2
    );
    drop(first);
    let second = acquire(&controller, "default")?;
    ensure!(second.group_buffer_budget().unwrap().charged_rows() == 0);
    ensure!(retained.charged_rows() == 2);
    Ok(())
}

#[test]
fn group_budget_policy_parses_zero_and_coexists_with_the_other_caps() -> Result<()> {
    let policy = WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
        "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
        "max_active":1, "max_queued":0, "operator_max_active":1,
        "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
        "max_inner_join_build_rows":7, "max_sort_buffer_rows":5, "max_distinct_buffer_rows":3, "max_group_buffer_rows":0,
        "classes":{"default":{"max_active":1,"max_queued":0}}
    }))?)?;
    ensure!(policy.max_group_buffer_rows == Some(0));
    let lease = acquire(&AdmissionController::new(policy)?, "default")?;
    ensure!(lease.group_buffer_budget().unwrap().limit() == 0);
    ensure!(lease.sort_buffer_budget().unwrap().limit() == 5);
    ensure!(lease.distinct_buffer_budget().unwrap().limit() == 3);
    ensure!(lease.inner_join_build_budget().unwrap().limit() == 7);
    ensure!(
        WorkloadPolicy::from_json(&serde_json::to_vec(&json!({
            "format":"oxigraph-admission-v1", "policy_id":"test", "version":1,
            "max_active":1, "max_queued":0, "operator_max_active":1,
            "operator_max_queued":0, "queue_timeout_ms":2000, "retry_after_seconds":2,
            "max_group_buffer_rows":-1,
            "classes":{"default":{"max_active":1,"max_queued":0}}
        }))?)
        .is_err()
    );
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
    let mut state = State::new(Arc::new(controller.0.policy.clone()));
    let policy = Arc::clone(&state.policy);
    let mut entry = AdmissionController::entry(
        &mut state,
        "default",
        ListenerKind::Data,
        CancellationToken::new(),
        Instant::now(),
        policy,
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

fn dispositions(
    metrics: &AdmissionMetrics,
    pool: AdmissionPool,
) -> Vec<(AdmissionDisposition, u64, u64)> {
    AdmissionDisposition::ALL
        .into_iter()
        .map(|disposition| {
            (
                disposition,
                metrics.count(pool, disposition),
                metrics.queued_count(pool, disposition),
            )
        })
        .filter(|(_, total, queued)| *total != 0 || *queued != 0)
        .collect()
}

fn queue_totals(metrics: &AdmissionMetrics, pool: AdmissionPool) -> (u64, u64) {
    let queued = AdmissionDisposition::ALL
        .into_iter()
        .map(|disposition| metrics.queued_count(pool, disposition))
        .sum::<u64>();
    (queued, metrics.queue_wait(pool).count())
}

#[test]
fn immediate_dispositions_count_once_and_exclusions_record_nothing() -> Result<()> {
    use AdmissionDisposition::{
        Admitted, Cancelled, RefusedClass, RefusedGlobal, RefusedOperator, RequestTimedOut,
        UnknownClass,
    };
    let admission = controller(1, 0, 1, 0)?;
    ensure!(admission.metrics()? == AdmissionMetrics::default());
    let held = acquire(&admission, "default")?;
    ensure!(matches!(
        raw(&admission, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Global))
    ));
    let operator =
        admission.acquire("default", ListenerKind::Operator, CancellationToken::new())?;
    ensure!(matches!(
        admission.acquire("default", ListenerKind::Operator, CancellationToken::new()),
        Err(WorkloadError::Overloaded(AdmissionScope::Operator))
    ));
    ensure!(matches!(
        raw(&admission, "missing"),
        Err(WorkloadError::UnknownClass)
    ));
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    ensure!(matches!(
        admission.acquire("default", ListenerKind::Data, cancelled),
        Err(WorkloadError::Cancelled)
    ));
    ensure!(matches!(
        admission.acquire(
            "default",
            ListenerKind::Data,
            CancellationToken::new().with_deadline(Instant::now())
        ),
        Err(WorkloadError::RequestTimedOut)
    ));
    let metrics = admission.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data)
            == [
                (Admitted, 1, 0),
                (RefusedGlobal, 1, 0),
                (UnknownClass, 1, 0),
                (Cancelled, 1, 0),
                (RequestTimedOut, 1, 0)
            ],
        "{metrics:?}"
    );
    ensure!(
        dispositions(&metrics, AdmissionPool::Operator)
            == [(Admitted, 1, 0), (RefusedOperator, 1, 0)],
        "{metrics:?}"
    );
    for pool in AdmissionPool::ALL {
        ensure!(
            queue_totals(&metrics, pool) == (0, 0),
            "immediate results observed a queue wait"
        );
        ensure!(metrics.active(pool) == 1 && metrics.queued(pool) == 0);
    }
    // Exclusions: denial rendering, a missing trusted access context and
    // capacity release are not admission outcomes.
    drop(admission.denial(WorkloadError::Overloaded(AdmissionScope::Class)));
    ensure!(
        admission
            .admit(&mut Extensions::new(), ListenerKind::Data)
            .is_err()
    );
    drop((held, operator));
    let released = admission.metrics()?;
    ensure!(
        released.active(AdmissionPool::Data) == 0 && released.active(AdmissionPool::Operator) == 0
    );
    for pool in AdmissionPool::ALL {
        ensure!(dispositions(&released, pool) == dispositions(&metrics, pool));
    }
    ensure!(admission.snapshot()? == AdmissionSnapshot::default());

    let classes = controller(2, 1, 1, 0)?;
    let held = acquire(&classes, "default")?;
    ensure!(matches!(
        raw(&classes, "default"),
        Err(WorkloadError::Overloaded(AdmissionScope::Class))
    ));
    let metrics = classes.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data) == [(Admitted, 1, 0), (RefusedClass, 1, 0)]
    );
    ensure!(dispositions(&metrics, AdmissionPool::Operator).is_empty());
    drop(held);
    let mut text = String::new();
    classes.metrics()?.write_prometheus(&mut text)?;
    ensure!(
        !text.contains("class=")
            && !text.contains("\"default\"")
            && !text.contains("\"second\"")
            && !text.contains("\"test\""),
        "class or policy names exported"
    );
    Ok(())
}

#[test]
fn queued_cancellation_purged_before_the_waiter_observes_counts_once() -> Result<()> {
    let controller = controller(1, 2, 1, 2)?;
    let held = acquire(&controller, "default")?;
    let token = CancellationToken::new();
    let child = controller.clone();
    let waiter = {
        let token = token.clone();
        thread::spawn(move || child.acquire("default", ListenerKind::Data, token))
    };
    wait_queued(&controller, 1)?;
    {
        // Cancel and purge under the same lock: the waiter can only observe
        // its cancellation on a later locked pass, after its entry is gone.
        let mut state = controller.lock()?;
        token.cancel();
        AdmissionController::purge(&mut state, Instant::now());
        ensure!(state.queue.is_empty(), "cancelled entry survived purge");
    }
    ensure!(matches!(
        waiter.join().unwrap(),
        Err(WorkloadError::Cancelled)
    ));
    let metrics = controller.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data)
            == [
                (AdmissionDisposition::Admitted, 1, 0),
                (AdmissionDisposition::Cancelled, 1, 1)
            ],
        "{metrics:?}"
    );
    ensure!(queue_totals(&metrics, AdmissionPool::Data) == (1, 1));
    ensure!(metrics.queued(AdmissionPool::Data) == 0 && metrics.active(AdmissionPool::Data) == 1);
    drop(held);
    Ok(())
}

#[test]
fn queued_expiry_purged_early_and_later_admission_count_wait_once() -> Result<()> {
    let mut policy = controller(1, 2, 1, 2)?.0.policy.clone();
    policy.queue_timeout_ms = 200;
    let controller = AdmissionController::new(policy)?;
    let held = acquire(&controller, "default")?;
    let child = controller.clone();
    let expiring = thread::spawn(move || {
        child.acquire("default", ListenerKind::Data, CancellationToken::new())
    });
    wait_queued(&controller, 1)?;
    let deadline = {
        // Virtual-clock purge removes the entry before its real deadline; the
        // waiter still returns exactly one queue-timeout at that deadline.
        let mut state = controller.lock()?;
        let deadline = state.queue.front().map(|entry| entry.deadline);
        AdmissionController::purge(&mut state, deadline.unwrap());
        ensure!(state.queue.is_empty(), "expired entry survived purge");
        deadline.unwrap()
    };
    ensure!(matches!(
        expiring.join().unwrap(),
        Err(WorkloadError::AdmissionTimedOut)
    ));
    ensure!(Instant::now() >= deadline);
    let child = controller.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let admitted = thread::spawn(move || {
        let lease = child.acquire("default", ListenerKind::Data, CancellationToken::new());
        sender.send(()).unwrap();
        lease
    });
    wait_queued(&controller, 1)?;
    ensure!(receiver.try_recv().is_err());
    drop(held);
    let lease = admitted.join().unwrap()?;
    let metrics = controller.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data)
            == [
                (AdmissionDisposition::Admitted, 2, 1),
                (AdmissionDisposition::QueueTimedOut, 1, 1)
            ],
        "{metrics:?}"
    );
    let histogram = metrics.queue_wait(AdmissionPool::Data);
    ensure!(queue_totals(&metrics, AdmissionPool::Data) == (2, 2));
    // The expired wait is at least ~200ms: absent from the 10ms bucket, present in +Inf.
    let buckets: Vec<_> = histogram.buckets().collect();
    ensure!(buckets[2].1 <= 1 && buckets[7].1 == 2, "{buckets:?}");
    ensure!(
        histogram.sum() >= Duration::from_millis(150),
        "{:?}",
        histogram.sum()
    );
    ensure!(metrics.active(AdmissionPool::Data) == 1);
    drop(lease);
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn queued_request_deadline_is_a_distinct_queued_disposition() -> Result<()> {
    let mut policy = controller(1, 1, 1, 1)?.0.policy.clone();
    policy.request_timeout_ms = Some(40);
    let controller = AdmissionController::new(policy)?;
    let held = acquire(&controller, "default")?;
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::RequestTimedOut)
    ));
    let metrics = controller.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data)
            == [
                (AdmissionDisposition::Admitted, 1, 0),
                (AdmissionDisposition::RequestTimedOut, 1, 1)
            ],
        "{metrics:?}"
    );
    ensure!(queue_totals(&metrics, AdmissionPool::Data) == (1, 1));
    ensure!(metrics.queue_wait(AdmissionPool::Data).sum() >= Duration::from_millis(30));
    drop(held);
    Ok(())
}

#[test]
fn lease_clone_drop_cancel_and_unwind_release_without_observations() -> Result<()> {
    let controller = controller(1, 0, 1, 0)?;
    let lease = acquire(&controller, "default")?;
    let clone = lease.clone();
    lease.cancellation_token().cancel();
    drop(lease);
    ensure!(controller.metrics()?.active(AdmissionPool::Data) == 1);
    drop(clone);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _lease = acquire(&controller, "default").unwrap();
        panic!("injected handler unwind");
    }));
    ensure!(result.is_err());
    let metrics = controller.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Data) == [(AdmissionDisposition::Admitted, 2, 0)],
        "release or unwind produced observations: {metrics:?}"
    );
    ensure!(metrics.active(AdmissionPool::Data) == 0);
    Ok(())
}

#[test]
fn concurrent_snapshots_are_internally_consistent() -> Result<()> {
    let controller = controller(2, 4, 2, 4)?;
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let child = controller.clone();
            thread::spawn(move || -> Result<(), WorkloadError> {
                for _ in 0..20 {
                    drop(child.acquire("default", ListenerKind::Data, CancellationToken::new())?);
                }
                Ok(())
            })
        })
        .collect();
    for _ in 0..200 {
        let metrics = controller.metrics()?;
        for pool in AdmissionPool::ALL {
            let (queued, observed) = queue_totals(&metrics, pool);
            ensure!(
                queued == observed,
                "queued counts and waits diverged: {metrics:?}"
            );
            let total: u64 = AdmissionDisposition::ALL
                .into_iter()
                .map(|disposition| metrics.count(pool, disposition))
                .sum();
            ensure!(queued <= total);
            ensure!(metrics.active(pool) <= 2 && metrics.queued(pool) <= 4);
        }
        thread::yield_now();
    }
    for worker in workers {
        worker.join().unwrap()?;
    }
    let metrics = controller.metrics()?;
    ensure!(metrics.count(AdmissionPool::Data, AdmissionDisposition::Admitted) == 80);
    ensure!(
        dispositions(&metrics, AdmissionPool::Data)
            .iter()
            .all(|(disposition, _, _)| *disposition == AdmissionDisposition::Admitted),
        "{metrics:?}"
    );
    ensure!(dispositions(&metrics, AdmissionPool::Operator).is_empty());
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn poisoned_state_fails_telemetry_closed_and_counts_unavailable() -> Result<()> {
    let controller = controller(1, 1, 1, 1)?;
    drop(acquire(&controller, "default")?);
    let poison = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = controller.0.state.lock().unwrap();
        panic!("isolated poison");
    }));
    ensure!(poison.is_err());
    ensure!(controller.metrics() == Err(WorkloadError::Unavailable));
    ensure!(controller.snapshot() == Err(WorkloadError::Unavailable));
    ensure!(matches!(
        raw(&controller, "default"),
        Err(WorkloadError::Unavailable)
    ));
    // The export fails closed, but the terminal result was still recorded once.
    let recorded = controller.0.metrics.lock().unwrap().clone();
    ensure!(
        dispositions(&recorded, AdmissionPool::Data)
            == [
                (AdmissionDisposition::Admitted, 1, 0),
                (AdmissionDisposition::Unavailable, 1, 0)
            ],
        "{recorded:?}"
    );
    Ok(())
}

#[test]
fn operator_queue_observations_are_independent_and_count_each_return_once() -> Result<()> {
    let mut policy = controller(1, 1, 1, 1)?.0.policy.clone();
    policy.operator_max_queued = 1;
    let controller = AdmissionController::new(policy)?;
    let data = acquire(&controller, "default")?;
    let operator =
        controller.acquire("default", ListenerKind::Operator, CancellationToken::new())?;
    let wait_operator = || -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(3);
        while controller.snapshot()?.operator_queued != 1 {
            ensure!(Instant::now() < deadline, "operator did not queue");
            thread::yield_now();
        }
        Ok(())
    };
    let token = CancellationToken::new();
    let child = controller.clone();
    let cancelled = {
        let token = token.clone();
        thread::spawn(move || child.acquire("default", ListenerKind::Operator, token))
    };
    wait_operator()?;
    token.cancel();
    ensure!(matches!(
        cancelled.join().unwrap(),
        Err(WorkloadError::Cancelled)
    ));
    let child = controller.clone();
    let admitted = thread::spawn(move || {
        child.acquire("default", ListenerKind::Operator, CancellationToken::new())
    });
    wait_operator()?;
    drop(operator);
    let lease = admitted.join().unwrap()?;
    let metrics = controller.metrics()?;
    ensure!(
        dispositions(&metrics, AdmissionPool::Operator)
            == [
                (AdmissionDisposition::Admitted, 2, 1),
                (AdmissionDisposition::Cancelled, 1, 1),
            ],
        "{metrics:?}"
    );
    ensure!(queue_totals(&metrics, AdmissionPool::Operator) == (2, 2));
    ensure!(
        dispositions(&metrics, AdmissionPool::Data) == [(AdmissionDisposition::Admitted, 1, 0),]
    );
    ensure!(queue_totals(&metrics, AdmissionPool::Data) == (0, 0));
    ensure!(
        metrics.active(AdmissionPool::Data) == 1 && metrics.active(AdmissionPool::Operator) == 1
    );
    drop((data, lease));
    ensure!(controller.snapshot()? == AdmissionSnapshot::default());
    Ok(())
}

#[test]
fn poisoned_queued_waiter_releases_ticket_and_records_one_unavailable_wait() -> Result<()> {
    let controller = controller(1, 1, 1, 1)?;
    let held = acquire(&controller, "default")?;
    let child = controller.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let waiter = thread::spawn(move || {
        sender
            .send(child.acquire("default", ListenerKind::Data, CancellationToken::new()))
            .unwrap();
    });
    wait_queued(&controller, 1)?;
    let poison = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = controller.0.state.lock().unwrap();
        panic!("isolated queued state poison");
    }));
    ensure!(poison.is_err());
    controller.0.changed.notify_all();
    ensure!(matches!(
        receiver.recv_timeout(Duration::from_secs(3))?,
        Err(WorkloadError::Unavailable)
    ));
    waiter.join().unwrap();
    drop(held);
    let state = controller
        .0
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    ensure!(
        state.queue.is_empty() && state.active == 0,
        "poisoned cleanup retained capacity"
    );
    drop(state);
    let recorded = controller.0.metrics.lock().unwrap().clone();
    ensure!(
        dispositions(&recorded, AdmissionPool::Data)
            == [
                (AdmissionDisposition::Admitted, 1, 0),
                (AdmissionDisposition::Unavailable, 1, 1),
            ],
        "{recorded:?}"
    );
    ensure!(queue_totals(&recorded, AdmissionPool::Data) == (1, 1));
    ensure!(controller.metrics() == Err(WorkloadError::Unavailable));
    Ok(())
}
