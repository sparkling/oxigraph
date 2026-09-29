//! Public-API tests for the deterministic lease state model (ADR-0030 gate 2).
//! No sleeps, no clock, no I/O: every time value is injected.

use oxigraph_cli::lease::*;
use std::num::NonZeroU64;
use std::sync::OnceLock;

type Resolved = Result<Outcome, LeaseError>;
type Restarted = Result<RestartClass, LeaseError>;
type Ran = (Result<(), LeaseError>, Option<u64>);

fn binding_of(principal: &str) -> LeaseBinding {
    LeaseBinding::new(principal, "acme", "repo-1").unwrap()
}

fn owner() -> &'static LeaseBinding {
    static OWNER: OnceLock<LeaseBinding> = OnceLock::new();
    OWNER.get_or_init(|| binding_of("alice"))
}

fn stranger() -> &'static LeaseBinding {
    static STRANGER: OnceLock<LeaseBinding> = OnceLock::new();
    STRANGER.get_or_init(|| binding_of("mallory"))
}

fn call_as(binding: &LeaseBinding, time: u64) -> Call<'_> {
    Call {
        binding,
        at: LogicalTime(time),
    }
}

fn at(time: u64) -> Call<'static> {
    call_as(owner(), time)
}

fn spec() -> LimitsSpec {
    LimitsSpec {
        idle: 10,
        absolute: 100,
        max_extension: 20,
        cancel_grace: 5,
        commit_wait: 7,
        retention: 50,
    }
}

fn edit(change: impl FnOnce(&mut LimitsSpec)) -> LimitsSpec {
    let mut value = spec();
    change(&mut value);
    value
}

fn limits() -> LeaseLimits {
    LeaseLimits::new(spec()).unwrap()
}

fn begin_as(id: u64, time: u64, limits: LeaseLimits) -> Result<Lease, LeaseError> {
    Lease::begin(at(time), LeaseId::new(id), limits)
}

fn start() -> Lease {
    begin_as(1, 0, limits()).unwrap()
}

fn key() -> CommitKey {
    CommitKey::new([7; 16])
}

fn ext(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).unwrap()
}

fn terminal(outcome: Outcome, time: u64) -> LeasePhase {
    LeasePhase::Terminal {
        outcome,
        at: LogicalTime(time),
    }
}

fn rolled_back(reason: RollbackReason, time: u64) -> LeasePhase {
    terminal(Outcome::RolledBack(reason), time)
}

fn phase(lease: &mut Lease, time: u64) -> LeasePhase {
    lease.observe(at(time)).unwrap().phase
}

fn all_are(errors: &[Option<LeaseError>], error: LeaseError) -> bool {
    errors.iter().all(|found| *found == Some(error))
}

fn indeterminate() -> Lease {
    let mut lease = start();
    let _attempt = lease.begin_commit(at(3), key()).unwrap();
    lease.observe(at(10)).unwrap();
    lease
}

fn resolve_all(lease: &mut Lease, steps: &[(u64, ExternalOutcome, Resolved)]) {
    for &(time, external, expected) in steps {
        let result = lease.resolve_indeterminate(at(time), external);
        assert_eq!(result, expected, "at {time} with {external:?}");
    }
}

// ---------------------------------------------------------------- validation

#[test]
fn limits_reject_zero_and_inconsistent_values() {
    assert_eq!(limits().spec(), spec());
    let cases = [
        edit(|s| s.idle = 0),
        edit(|s| s.absolute = 0),
        edit(|s| s.max_extension = 0),
        edit(|s| s.cancel_grace = 0),
        edit(|s| s.commit_wait = 0),
        edit(|s| s.retention = 0),
        edit(|s| s.idle = 101),
        edit(|s| s.max_extension = 101),
    ];
    for case in cases {
        assert_eq!(LeaseLimits::new(case), Err(LeaseError::InvalidLimits));
    }
    assert!(LeaseLimits::new(edit(|s| s.idle = 100)).is_ok());
}

#[test]
fn binding_parts_are_validated() {
    let long = "x".repeat(129);
    let longest = "x".repeat(128);
    assert!(LeaseBinding::new(&longest, "b", "c").is_ok());
    assert!(LeaseBinding::new("u@h:1/a-b_c.d", "b", "c").is_ok());
    let bad = [
        ("", "b", "c"),
        ("a", "", "c"),
        ("a", "b", ""),
        (long.as_str(), "b", "c"),
        ("a", long.as_str(), "c"),
        ("a", "b", long.as_str()),
        ("a b", "b", "c"),
        ("a", "b\n", "c"),
    ];
    for (principal, tenant, repository) in bad {
        let result = LeaseBinding::new(principal, tenant, repository);
        assert_eq!(result, Err(LeaseError::InvalidBinding));
    }
}

// ---------------------------------------------------------------- deadlines

#[test]
fn idle_deadline_is_exclusive() {
    let mut live = start();
    assert_eq!(phase(&mut live, 9), LeasePhase::Idle);
    let mut dead = start();
    let expired = rolled_back(RollbackReason::Expired, 10);
    assert_eq!(phase(&mut dead, 10), expired);
    let error = dead.begin_operation(at(10)).unwrap_err();
    assert_eq!(error, LeaseError::AlreadyTerminal);
}

#[test]
fn absolute_deadline_caps_renewal_and_expires_exclusively() {
    let mut lease = start();
    let mut generation = lease.snapshot().generation;
    let steps = [(5, 25), (20, 40), (35, 55), (50, 70), (65, 85), (80, 100)];
    for (time, deadline) in steps {
        let renewal = lease.renew(at(time), generation, ext(20)).unwrap();
        assert_eq!(renewal.deadline, LogicalTime(deadline));
        assert_eq!(renewal.generation.get(), generation.get() + 1);
        generation = renewal.generation;
    }
    let snapshot = lease.snapshot();
    assert_eq!(snapshot.deadline, snapshot.absolute_deadline);
    let error = lease.renew(at(90), generation, ext(20)).unwrap_err();
    assert_eq!(error, LeaseError::NoExtension);
    assert_eq!(phase(&mut lease, 99), LeasePhase::Idle);
    let expired = rolled_back(RollbackReason::Expired, 100);
    assert_eq!(phase(&mut lease, 100), expired);
}

#[test]
fn renewal_is_exclusive_at_the_current_deadline() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    let renewal = lease.renew(at(9), generation, ext(20)).unwrap();
    assert_eq!(renewal.deadline, LogicalTime(29));
    let mut late = start();
    let error = late.renew(at(10), generation, ext(20)).unwrap_err();
    assert_eq!(error, LeaseError::AlreadyTerminal);
}

#[test]
fn begin_checks_the_whole_deadline_chain_for_overflow() {
    let fits = u64::MAX - 157;
    assert!(begin_as(1, fits, limits()).is_ok());
    let over = begin_as(1, fits + 1, limits()).unwrap_err();
    assert_eq!(over, LeaseError::TimeOverflow);
    let max = begin_as(1, u64::MAX, limits()).unwrap_err();
    assert_eq!(max, LeaseError::TimeOverflow);
    let wide = LeaseLimits::new(edit(|s| s.idle = 100)).unwrap();
    let mut lease = begin_as(1, fits, wide).unwrap();
    let _attempt = lease.begin_commit(at(fits + 99), key()).unwrap();
    let expired = LeasePhase::Expired { attempted: true };
    assert_eq!(phase(&mut lease, u64::MAX), expired);
}

#[test]
fn renewal_grant_is_clamped_to_the_maximum_extension() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    let renewal = lease.renew(at(1), generation, ext(u64::MAX)).unwrap();
    assert_eq!(renewal.granted, 20);
    assert_eq!(renewal.deadline, LogicalTime(21));
}

// ------------------------------------------------- time and binding rejection

#[test]
fn backward_time_is_rejected_atomically_by_every_method() {
    let mut idle = start();
    idle.observe(at(5)).unwrap();
    let before = idle.snapshot();
    let generation = before.generation;
    let external = ExternalOutcome::Committed;
    let errors = [
        idle.begin_operation(at(4)).err(),
        idle.renew(at(4), generation, ext(5)).err(),
        idle.request_cancel(at(4)).err(),
        idle.rollback(at(4)).err(),
        idle.dropped(at(4)).err(),
        idle.begin_commit(at(4), key()).err(),
        idle.response_lost(at(4)).err(),
        idle.resolve_indeterminate(at(4), external).err(),
        idle.observe(at(4)).err(),
    ];
    assert!(all_are(&errors, LeaseError::TimeRegression));
    assert_eq!(idle.snapshot(), before);

    let mut running = start();
    let handle = running.begin_operation(at(5)).unwrap();
    let before = running.snapshot();
    let result = running.finish_operation(at(4), &handle);
    assert_eq!(result, Err(LeaseError::TimeRegression));
    assert_eq!(running.snapshot(), before);

    let mut commit = start();
    let attempt = commit.begin_commit(at(5), key()).unwrap();
    let before = commit.snapshot();
    let outcome = CommitResult::Committed;
    let result = commit.finish_commit(at(4), &attempt, outcome);
    assert_eq!(result, Err(LeaseError::TimeRegression));
    assert_eq!(commit.snapshot(), before);
}

#[test]
fn equal_time_is_accepted() {
    let mut lease = start();
    lease.observe(at(5)).unwrap();
    assert!(lease.observe(at(5)).is_ok());
}

#[test]
fn binding_is_immutable_and_mismatches_change_nothing() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    lease.renew(at(1), generation, ext(20)).unwrap();
    assert_eq!(lease.binding(), owner());
    let others = [
        LeaseBinding::new("bob", "acme", "repo-1").unwrap(),
        LeaseBinding::new("alice", "other", "repo-1").unwrap(),
        LeaseBinding::new("alice", "acme", "repo-2").unwrap(),
    ];
    for other in &others {
        // A far-future time must not settle or expire anything either.
        let stranger = call_as(other, 500);
        let before = lease.snapshot();
        let generation = before.generation;
        let external = ExternalOutcome::Committed;
        let errors = [
            lease.begin_operation(stranger).err(),
            lease.renew(stranger, generation, ext(20)).err(),
            lease.request_cancel(stranger).err(),
            lease.rollback(stranger).err(),
            lease.dropped(stranger).err(),
            lease.begin_commit(stranger, key()).err(),
            lease.response_lost(stranger).err(),
            lease.resolve_indeterminate(stranger, external).err(),
            lease.observe(stranger).err(),
        ];
        assert!(all_are(&errors, LeaseError::BindingMismatch));
        assert_eq!(lease.snapshot(), before);
    }
    assert_eq!(lease.binding(), owner());
}

// ------------------------------------------------- operations and renewal

#[test]
fn one_operation_at_a_time() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    let handle = lease.begin_operation(at(1)).unwrap();
    assert_eq!(lease.snapshot().operation_count, 1);
    let errors = [
        lease.begin_operation(at(2)).err(),
        lease.renew(at(2), generation, ext(5)).err(),
        lease.begin_commit(at(2), key()).err(),
        lease.rollback(at(2)).err(),
        lease.dropped(at(2)).err(),
    ];
    assert!(all_are(&errors, LeaseError::Busy));
    assert_eq!(lease.snapshot().operation_count, 1);
    let end = lease.finish_operation(at(3), &handle).unwrap();
    assert_eq!(end, OperationEnd::Completed);
    let second = lease.begin_operation(at(4)).unwrap();
    assert_eq!(lease.snapshot().operation_count, 2);
    lease.finish_operation(at(5), &second).unwrap();
}

#[test]
fn renewal_is_compare_and_swap_and_never_implicit() {
    let mut lease = start();
    let first = lease.snapshot().generation;
    let stale = Generation::new(first.get() + 5);
    let result = lease.renew(at(1), stale, ext(20));
    assert_eq!(result, Err(LeaseError::StaleGeneration));
    let renewed = lease.renew(at(1), first, ext(20)).unwrap();
    assert_eq!(renewed.generation.get(), first.get() + 1);
    let result = lease.renew(at(2), first, ext(20));
    assert_eq!(result, Err(LeaseError::StaleGeneration));
    let result = lease.renew(at(2), renewed.generation, ext(1));
    assert_eq!(result, Err(LeaseError::NoExtension));
    assert_eq!(lease.snapshot().generation, renewed.generation);
    assert_eq!(lease.snapshot().deadline, LogicalTime(21));

    let mut idle = start();
    let before = idle.snapshot();
    let handle = idle.begin_operation(at(3)).unwrap();
    idle.finish_operation(at(6), &handle).unwrap();
    let after = idle.snapshot();
    assert_eq!(after.deadline, before.deadline);
    assert_eq!(after.generation, before.generation);
    let expired = rolled_back(RollbackReason::Expired, 10);
    assert_eq!(phase(&mut idle, 10), expired);
}

// ------------------------------------------------- cancellation

#[test]
fn busy_cancellation_acknowledged_before_deadline_is_proven_rollback() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    let handle = lease.begin_operation(at(1)).unwrap();
    let cancelling = LeasePhase::Cancelling {
        cleanup_deadline: LogicalTime(7),
        cause: CancelCause::Requested,
    };
    assert_eq!(lease.request_cancel(at(2)), Ok(cancelling));
    let errors = [
        lease.begin_operation(at(4)).err(),
        lease.renew(at(4), generation, ext(5)).err(),
        lease.begin_commit(at(4), key()).err(),
        lease.rollback(at(4)).err(),
        lease.dropped(at(4)).err(),
    ];
    assert!(all_are(&errors, LeaseError::Busy));
    assert_eq!(lease.request_cancel(at(4)), Ok(cancelling));
    let end = lease.finish_operation(at(6), &handle).unwrap();
    assert_eq!(end, OperationEnd::CancelledAcknowledged);
    let cancelled = rolled_back(RollbackReason::Cancelled, 6);
    assert_eq!(lease.snapshot().phase, cancelled);
}

#[test]
fn acknowledgement_at_the_cleanup_deadline_is_overdue_not_rollback() {
    let mut lease = start();
    let handle = lease.begin_operation(at(1)).unwrap();
    lease.request_cancel(at(2)).unwrap();
    let result = lease.finish_operation(at(7), &handle);
    assert_eq!(result, Err(LeaseError::AlreadyTerminal));
    let overdue = Outcome::CleanupOverdue(CancelCause::Requested);
    assert_eq!(lease.snapshot().phase, terminal(overdue, 7));
    let result = lease.rollback(at(8));
    assert_eq!(result, Err(LeaseError::AlreadyTerminal));
}

#[test]
fn expiry_during_an_operation_enters_bounded_cleanup() {
    let mut lease = start();
    let handle = lease.begin_operation(at(1)).unwrap();
    assert_eq!(phase(&mut lease, 9), LeasePhase::Operating);
    let cancelling = LeasePhase::Cancelling {
        cleanup_deadline: LogicalTime(15),
        cause: CancelCause::Expiry,
    };
    assert_eq!(phase(&mut lease, 10), cancelling);
    assert_eq!(lease.request_cancel(at(12)), Ok(cancelling));
    let end = lease.finish_operation(at(14), &handle).unwrap();
    assert_eq!(end, OperationEnd::CancelledAcknowledged);
    let expired = rolled_back(RollbackReason::Expired, 14);
    assert_eq!(lease.snapshot().phase, expired);

    let mut late = start();
    let handle = late.begin_operation(at(1)).unwrap();
    let result = late.finish_operation(at(15), &handle);
    assert_eq!(result, Err(LeaseError::AlreadyTerminal));
    let overdue = Outcome::CleanupOverdue(CancelCause::Expiry);
    assert_eq!(late.snapshot().phase, terminal(overdue, 15));
}

#[test]
fn cancel_from_idle_rolls_back_immediately() {
    let mut lease = start();
    let cancelled = rolled_back(RollbackReason::Cancelled, 3);
    assert_eq!(lease.request_cancel(at(3)), Ok(cancelled));
    assert_eq!(lease.request_cancel(at(4)), Ok(cancelled));
}

// ------------------------------------------------- rollback

#[test]
fn explicit_and_dropped_rollback_are_idempotent() {
    let mut lease = start();
    let explicit = Outcome::RolledBack(RollbackReason::Explicit);
    assert_eq!(lease.rollback(at(3)), Ok(explicit));
    assert_eq!(lease.rollback(at(4)), Ok(explicit));
    assert_eq!(lease.dropped(at(5)), Ok(explicit));
    assert_eq!(lease.snapshot().phase, terminal(explicit, 3));
    let generation = lease.snapshot().generation;
    let external = ExternalOutcome::Committed;
    let errors = [
        lease.begin_operation(at(6)).err(),
        lease.renew(at(6), generation, ext(5)).err(),
        lease.begin_commit(at(6), key()).err(),
    ];
    assert!(all_are(&errors, LeaseError::AlreadyTerminal));
    let result = lease.resolve_indeterminate(at(6), external);
    assert_eq!(result, Err(LeaseError::NotIndeterminate));

    let mut dropped = start();
    let outcome = Outcome::RolledBack(RollbackReason::Dropped);
    assert_eq!(dropped.dropped(at(3)), Ok(outcome));
    assert_eq!(dropped.rollback(at(4)), Ok(outcome));
}

// ------------------------------------------------- commit

#[test]
fn commit_attempt_blocks_every_other_transition() {
    let mut lease = start();
    let generation = lease.snapshot().generation;
    let _attempt = lease.begin_commit(at(3), key()).unwrap();
    let snapshot = lease.snapshot();
    let decide_by = LogicalTime(10);
    let waiting = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(snapshot.phase, waiting);
    assert!(snapshot.commit_attempted);
    assert_eq!(snapshot.commit_key, Some(key()));
    let errors = [
        lease.begin_operation(at(4)).err(),
        lease.renew(at(4), generation, ext(5)).err(),
        lease.request_cancel(at(4)).err(),
        lease.rollback(at(4)).err(),
        lease.dropped(at(4)).err(),
        lease.begin_commit(at(4), key()).err(),
    ];
    assert!(all_are(&errors, LeaseError::CommitAttempted));
}

#[test]
fn commit_results_map_to_terminal_outcomes() {
    let cases = [
        (CommitResult::Committed, Outcome::Committed),
        (CommitResult::NotCommitted, Outcome::CommitProvenAbsent),
        (CommitResult::Indeterminate, Outcome::CommitIndeterminate),
    ];
    for (result, outcome) in cases {
        let mut lease = start();
        let attempt = lease.begin_commit(at(3), key()).unwrap();
        let finished = lease.finish_commit(at(5), &attempt, result);
        assert_eq!(finished, Ok(outcome));
        assert_eq!(lease.snapshot().phase, terminal(outcome, 5));
        let again = lease.begin_commit(at(6), key()).err();
        assert_eq!(again, Some(LeaseError::AlreadyTerminal));
    }
}

#[test]
fn timeout_after_commit_attempt_is_indeterminate_never_rollback() {
    let mut lease = start();
    let attempt = lease.begin_commit(at(3), key()).unwrap();
    let decide_by = LogicalTime(10);
    let waiting = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(phase(&mut lease, 9), waiting);
    let unknown = terminal(Outcome::CommitIndeterminate, 10);
    assert_eq!(phase(&mut lease, 10), unknown);
    let errors = [
        lease.rollback(at(11)).err(),
        lease.dropped(at(11)).err(),
        lease.request_cancel(at(11)).err(),
    ];
    assert!(all_are(&errors, LeaseError::AlreadyTerminal));
    let result = CommitResult::Committed;
    let late = lease.finish_commit(at(12), &attempt, result);
    assert_eq!(late, Err(LeaseError::AlreadyTerminal));
    assert_eq!(phase(&mut lease, 59), unknown);
    let expired = LeasePhase::Expired { attempted: true };
    assert_eq!(phase(&mut lease, 60), expired);
}

#[test]
fn response_loss_sets_a_flag_and_never_replays() {
    let mut lease = start();
    let attempt = lease.begin_commit(at(3), key()).unwrap();
    lease.response_lost(at(4)).unwrap();
    let waiting = lease.snapshot();
    assert!(waiting.response_lost);
    let decide_by = LogicalTime(10);
    let pending = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(waiting.phase, pending);
    let retry = lease.begin_commit(at(5), key()).err();
    assert_eq!(retry, Some(LeaseError::CommitAttempted));
    let result = CommitResult::Committed;
    lease.finish_commit(at(5), &attempt, result).unwrap();
    let before = lease.snapshot();
    lease.response_lost(at(6)).unwrap();
    let after = lease.snapshot();
    assert_eq!(after.phase, before.phase);
    assert_eq!(after.operation_count, before.operation_count);
    let errors = [
        lease.begin_commit(at(7), key()).err(),
        lease.begin_operation(at(7)).err(),
    ];
    assert!(all_are(&errors, LeaseError::AlreadyTerminal));
    let committed = terminal(Outcome::Committed, 5);
    assert_eq!(lease.snapshot().phase, committed);
}

#[test]
fn tombstone_expires_after_retention() {
    let mut lease = start();
    lease.rollback(at(3)).unwrap();
    let explicit = rolled_back(RollbackReason::Explicit, 3);
    assert_eq!(phase(&mut lease, 52), explicit);
    let clean = LeasePhase::Expired { attempted: false };
    assert_eq!(phase(&mut lease, 53), clean);
    let errors = [
        lease.begin_operation(at(54)).err(),
        lease.rollback(at(54)).err(),
    ];
    assert!(all_are(&errors, LeaseError::Expired));

    let mut committed = start();
    let attempt = committed.begin_commit(at(3), key()).unwrap();
    let result = CommitResult::Committed;
    committed.finish_commit(at(5), &attempt, result).unwrap();
    let outcome = terminal(Outcome::Committed, 5);
    assert_eq!(phase(&mut committed, 54), outcome);
    let gone = LeasePhase::Expired { attempted: true };
    assert_eq!(phase(&mut committed, 55), gone);
    let external = ExternalOutcome::Committed;
    let late = committed.resolve_indeterminate(at(56), external);
    assert_eq!(late, Err(LeaseError::Expired));
}

#[test]
fn resolve_matrix_never_flips_a_definite_outcome() {
    use ExternalOutcome as X;
    let committed = Ok(Outcome::Committed);
    let absent = Ok(Outcome::CommitProvenAbsent);
    let unknown = Ok(Outcome::CommitIndeterminate);
    let conflict = Err(LeaseError::ConflictingResolution);
    let rejected = Err(LeaseError::NotIndeterminate);

    let mut lease = indeterminate();
    let steps = [
        (11, X::Indeterminate, unknown),
        (12, X::Committed, committed),
        (13, X::Committed, committed),
        (14, X::Indeterminate, committed),
        (15, X::ProvenAbsent, conflict),
    ];
    resolve_all(&mut lease, &steps);
    let resolved = terminal(Outcome::Committed, 10);
    assert_eq!(lease.snapshot().phase, resolved);

    let mut proven = indeterminate();
    let steps = [
        (11, X::ProvenAbsent, absent),
        (12, X::Committed, conflict),
        (13, X::Indeterminate, absent),
    ];
    resolve_all(&mut proven, &steps);

    let mut reported = start();
    let attempt = reported.begin_commit(at(3), key()).unwrap();
    let result = CommitResult::NotCommitted;
    reported.finish_commit(at(4), &attempt, result).unwrap();
    let steps = [
        (5, X::Committed, conflict),
        (6, X::ProvenAbsent, absent),
        (7, X::Indeterminate, absent),
    ];
    resolve_all(&mut reported, &steps);

    let mut idle = start();
    let mut waiting = start();
    let _attempt = waiting.begin_commit(at(3), key()).unwrap();
    let mut overdue = start();
    let _handle = overdue.begin_operation(at(1)).unwrap();
    overdue.observe(at(15)).unwrap();
    let mut rolled = start();
    rolled.rollback(at(1)).unwrap();
    // Each probe precedes that lease's next deadline: waiting decides at 10.
    let probes = [
        (&mut idle, 5),
        (&mut waiting, 5),
        (&mut overdue, 20),
        (&mut rolled, 20),
    ];
    for (lease, time) in probes {
        for external in [X::Committed, X::ProvenAbsent, X::Indeterminate] {
            let result = lease.resolve_indeterminate(at(time), external);
            assert_eq!(result, rejected, "{external:?}");
        }
    }
    assert_eq!(idle.snapshot().phase, LeasePhase::Idle);
    let decide_by = LogicalTime(10);
    let pending = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(waiting.snapshot().phase, pending);
}

// ------------------------------------------------- restart

#[derive(Clone, Copy, Debug)]
enum Kind {
    Idle,
    Operating,
    Cancelling,
    RolledBack,
    Overdue,
    ExpiredClean,
    Attempted,
    Committed,
    Absent,
    Indeterminate,
    ExpiredAttempted,
}

const KINDS: [Kind; 11] = [
    Kind::Idle,
    Kind::Operating,
    Kind::Cancelling,
    Kind::RolledBack,
    Kind::Overdue,
    Kind::ExpiredClean,
    Kind::Attempted,
    Kind::Committed,
    Kind::Absent,
    Kind::Indeterminate,
    Kind::ExpiredAttempted,
];

fn commit_with(lease: &mut Lease, result: CommitResult) {
    let attempt = lease.begin_commit(at(3), key()).unwrap();
    lease.finish_commit(at(4), &attempt, result).unwrap();
}

fn make(kind: Kind) -> Lease {
    let mut lease = start();
    match kind {
        Kind::Idle => {}
        Kind::Operating => {
            let _handle = lease.begin_operation(at(1)).unwrap();
        }
        Kind::Cancelling => {
            let _handle = lease.begin_operation(at(1)).unwrap();
            lease.request_cancel(at(2)).unwrap();
        }
        Kind::RolledBack => {
            lease.rollback(at(1)).unwrap();
        }
        Kind::Overdue => {
            let _handle = lease.begin_operation(at(1)).unwrap();
            lease.request_cancel(at(2)).unwrap();
            lease.observe(at(7)).unwrap();
        }
        Kind::ExpiredClean => {
            lease.rollback(at(1)).unwrap();
            lease.observe(at(60)).unwrap();
        }
        Kind::Attempted => {
            let _attempt = lease.begin_commit(at(3), key()).unwrap();
        }
        Kind::Committed => commit_with(&mut lease, CommitResult::Committed),
        Kind::Absent => commit_with(&mut lease, CommitResult::NotCommitted),
        Kind::Indeterminate => {
            let _attempt = lease.begin_commit(at(3), key()).unwrap();
            lease.observe(at(10)).unwrap();
        }
        Kind::ExpiredAttempted => {
            let _attempt = lease.begin_commit(at(3), key()).unwrap();
            lease.observe(at(100)).unwrap();
        }
    }
    lease
}

fn recorded(kind: Kind) -> Option<ExternalOutcome> {
    match kind {
        Kind::Committed => Some(ExternalOutcome::Committed),
        Kind::Absent => Some(ExternalOutcome::ProvenAbsent),
        Kind::Attempted => Some(ExternalOutcome::Indeterminate),
        Kind::Indeterminate => Some(ExternalOutcome::Indeterminate),
        Kind::ExpiredAttempted => Some(ExternalOutcome::Indeterminate),
        Kind::Idle | Kind::Operating | Kind::Cancelling => None,
        Kind::RolledBack | Kind::Overdue | Kind::ExpiredClean => None,
    }
}

fn expected_restart(kind: Kind, lookup: Option<ExternalOutcome>) -> Restarted {
    use ExternalOutcome as X;
    use RestartClass as R;
    let contradiction = Err(LeaseError::RestartContradiction);
    let Some(known) = recorded(kind) else {
        return lookup.map_or(Ok(R::StagedDiscarded), |_| contradiction);
    };
    let class = match (known, lookup) {
        (X::Committed, Some(X::ProvenAbsent)) => return contradiction,
        (X::ProvenAbsent, Some(X::Committed)) => return contradiction,
        (X::Indeterminate, Some(X::Committed)) => R::Committed,
        (X::Indeterminate, Some(X::ProvenAbsent)) => R::CommitProvenAbsent,
        (X::Indeterminate, _) => R::Indeterminate,
        (X::Committed, _) => R::Committed,
        (X::ProvenAbsent, _) => R::CommitProvenAbsent,
    };
    Ok(class)
}

#[test]
fn restart_matrix_never_resumes_staged_state_or_manufactures_truth() {
    let lookups = [
        None,
        Some(ExternalOutcome::Committed),
        Some(ExternalOutcome::ProvenAbsent),
        Some(ExternalOutcome::Indeterminate),
    ];
    for kind in KINDS {
        for lookup in lookups {
            let record = make(kind).restart();
            let expected = expected_restart(kind, lookup);
            assert_eq!(record.classify(lookup), expected, "{kind:?} {lookup:?}");
        }
    }
    let attempted = make(Kind::Attempted).restart();
    assert_eq!(attempted.commit_key(), Some(key()));
    assert_eq!(attempted.id(), LeaseId::new(1));
    assert_eq!(make(Kind::Idle).restart().commit_key(), None);
}

// ------------------------------------------------- handles and types

#[test]
fn handles_cannot_forge_completion_across_generations_or_leases() {
    let mut first = start();
    let stale = first.begin_operation(at(1)).unwrap();
    let mut second = start();
    let generation = second.snapshot().generation;
    second.renew(at(1), generation, ext(20)).unwrap();
    let genuine = second.begin_operation(at(2)).unwrap();
    let result = second.finish_operation(at(3), &stale);
    assert_eq!(result, Err(LeaseError::StaleHandle));
    assert_eq!(second.snapshot().phase, LeasePhase::Operating);
    let end = second.finish_operation(at(4), &genuine);
    assert_eq!(end, Ok(OperationEnd::Completed));

    let mut other = begin_as(2, 0, limits()).unwrap();
    let foreign = other.begin_operation(at(1)).unwrap();
    let mut third = start();
    let _own = third.begin_operation(at(1)).unwrap();
    let result = third.finish_operation(at(2), &foreign);
    assert_eq!(result, Err(LeaseError::StaleHandle));

    let mut old = start();
    let old_attempt = old.begin_commit(at(1), key()).unwrap();
    let mut renewed = start();
    let generation = renewed.snapshot().generation;
    renewed.renew(at(1), generation, ext(20)).unwrap();
    let attempt = renewed.begin_commit(at(2), key()).unwrap();
    let result = CommitResult::Committed;
    let forged = renewed.finish_commit(at(3), &old_attempt, result);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    let decide_by = LogicalTime(9);
    let pending = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(renewed.snapshot().phase, pending);
    let genuine = renewed.finish_commit(at(4), &attempt, result);
    assert_eq!(genuine, Ok(Outcome::Committed));
}

#[test]
fn identical_twin_leases_cannot_complete_each_other() {
    let mut first = start();
    let mut twin = start();
    let handle = first.begin_operation(at(1)).unwrap();
    let _own = twin.begin_operation(at(1)).unwrap();
    let before = twin.snapshot();
    assert_eq!(before, first.snapshot());
    let result = twin.finish_operation(at(2), &handle);
    assert_eq!(result, Err(LeaseError::StaleHandle));
    let mut after = twin.snapshot();
    assert_eq!(after.phase, LeasePhase::Operating);
    after.last_seen = before.last_seen;
    assert_eq!(after, before);

    let mut left = start();
    let mut right = start();
    let attempt = left.begin_commit(at(1), key()).unwrap();
    let _own = right.begin_commit(at(1), key()).unwrap();
    assert_eq!(left.snapshot(), right.snapshot());
    let result = CommitResult::Committed;
    let forged = right.finish_commit(at(2), &attempt, result);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    let decide_by = LogicalTime(8);
    let pending = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(right.snapshot().phase, pending);
}

#[test]
fn handles_of_a_restarted_lease_cannot_complete_its_successor() {
    let mut old = start();
    let handle = old.begin_operation(at(1)).unwrap();
    let record = old.restart();
    let class = record.classify(None);
    assert_eq!(class, Ok(RestartClass::StagedDiscarded));
    let mut successor = start();
    let _own = successor.begin_operation(at(1)).unwrap();
    let result = successor.finish_operation(at(2), &handle);
    assert_eq!(result, Err(LeaseError::StaleHandle));
    assert_eq!(successor.snapshot().phase, LeasePhase::Operating);
}

#[test]
fn rejected_operation_finish_keeps_the_handle_for_a_retry() {
    let mut lease = start();
    let handle = lease.begin_operation(at(5)).unwrap();
    let before = lease.snapshot();
    let regressed = lease.finish_operation(at(4), &handle);
    assert_eq!(regressed, Err(LeaseError::TimeRegression));
    let foreign = call_as(stranger(), 6);
    let mismatched = lease.finish_operation(foreign, &handle);
    assert_eq!(mismatched, Err(LeaseError::BindingMismatch));
    assert_eq!(lease.snapshot(), before);
    let end = lease.finish_operation(at(6), &handle);
    assert_eq!(end, Ok(OperationEnd::Completed));
    assert_eq!(lease.snapshot().phase, LeasePhase::Idle);
    let replay = lease.finish_operation(at(7), &handle);
    assert_eq!(replay, Err(LeaseError::StaleHandle));
    let next = lease.begin_operation(at(8)).unwrap();
    let replay = lease.finish_operation(at(8), &handle);
    assert_eq!(replay, Err(LeaseError::StaleHandle));
    assert_eq!(lease.snapshot().phase, LeasePhase::Operating);
    let end = lease.finish_operation(at(9), &next);
    assert_eq!(end, Ok(OperationEnd::Completed));
    assert_eq!(lease.snapshot().operation_count, 2);
}

#[test]
fn rejected_cancellation_acknowledgement_keeps_the_handle_for_a_retry() {
    let mut lease = start();
    let handle = lease.begin_operation(at(1)).unwrap();
    lease.request_cancel(at(2)).unwrap();
    let before = lease.snapshot();
    let regressed = lease.finish_operation(at(1), &handle);
    assert_eq!(regressed, Err(LeaseError::TimeRegression));
    let foreign = call_as(stranger(), 3);
    let mismatched = lease.finish_operation(foreign, &handle);
    assert_eq!(mismatched, Err(LeaseError::BindingMismatch));
    assert_eq!(lease.snapshot(), before);
    let end = lease.finish_operation(at(3), &handle);
    assert_eq!(end, Ok(OperationEnd::CancelledAcknowledged));
    let cancelled = rolled_back(RollbackReason::Cancelled, 3);
    assert_eq!(lease.snapshot().phase, cancelled);
    let replay = lease.finish_operation(at(4), &handle);
    assert_eq!(replay, Err(LeaseError::AlreadyTerminal));
    assert_eq!(lease.snapshot().phase, cancelled);
}

#[test]
fn rejected_commit_finish_keeps_the_attempt_for_a_retry() {
    let cases = [
        (CommitResult::Committed, Outcome::Committed),
        (CommitResult::NotCommitted, Outcome::CommitProvenAbsent),
    ];
    let reports = [
        CommitResult::Committed,
        CommitResult::NotCommitted,
        CommitResult::Indeterminate,
    ];
    for (result, outcome) in cases {
        let mut lease = start();
        let attempt = lease.begin_commit(at(5), key()).unwrap();
        let before = lease.snapshot();
        let regressed = lease.finish_commit(at(4), &attempt, result);
        assert_eq!(regressed, Err(LeaseError::TimeRegression), "{result:?}");
        let foreign = call_as(stranger(), 6);
        let mismatched = lease.finish_commit(foreign, &attempt, result);
        assert_eq!(mismatched, Err(LeaseError::BindingMismatch), "{result:?}");
        assert_eq!(lease.snapshot(), before, "{result:?}");
        let finished = lease.finish_commit(at(6), &attempt, result);
        assert_eq!(finished, Ok(outcome), "{result:?}");
        assert_eq!(lease.snapshot().phase, terminal(outcome, 6));
        for report in reports {
            let replay = lease.finish_commit(at(7), &attempt, report);
            let error = Err(LeaseError::AlreadyTerminal);
            assert_eq!(replay, error, "{result:?} then {report:?}");
        }
        assert_eq!(lease.snapshot().phase, terminal(outcome, 6));
    }
}

#[test]
fn retained_handles_still_cannot_complete_another_instance() {
    let mut own = start();
    let mut twin = start();
    let handle = own.begin_operation(at(1)).unwrap();
    let _twin_handle = twin.begin_operation(at(1)).unwrap();
    let regressed = own.finish_operation(at(0), &handle);
    assert_eq!(regressed, Err(LeaseError::TimeRegression));
    let forged = twin.finish_operation(at(2), &handle);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    assert_eq!(twin.snapshot().phase, LeasePhase::Operating);
    let end = own.finish_operation(at(2), &handle);
    assert_eq!(end, Ok(OperationEnd::Completed));
    let forged = twin.finish_operation(at(3), &handle);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    assert_eq!(twin.snapshot().phase, LeasePhase::Operating);

    let mut left = start();
    let mut right = start();
    let attempt = left.begin_commit(at(1), key()).unwrap();
    let _right_attempt = right.begin_commit(at(1), key()).unwrap();
    let result = CommitResult::Committed;
    let foreign = call_as(stranger(), 2);
    let mismatched = left.finish_commit(foreign, &attempt, result);
    assert_eq!(mismatched, Err(LeaseError::BindingMismatch));
    let forged = right.finish_commit(at(2), &attempt, result);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    let genuine = left.finish_commit(at(2), &attempt, result);
    assert_eq!(genuine, Ok(Outcome::Committed));
    let forged = right.finish_commit(at(3), &attempt, result);
    assert_eq!(forged, Err(LeaseError::StaleHandle));
    let decide_by = LogicalTime(8);
    let pending = LeasePhase::CommitAttempted { decide_by };
    assert_eq!(right.snapshot().phase, pending);
}

// Compile-time proof that authority types are not Clone: for a Clone type
// both blanket impls apply and the probe path becomes ambiguous.
trait AmbiguousIfClone<A> {
    fn probe() {}
}

impl<T: ?Sized> AmbiguousIfClone<()> for T {}

impl<T: ?Sized + Clone> AmbiguousIfClone<u8> for T {}

fn assert_send<T: Send>() {}

fn assert_clone<T: Clone>() {}

#[test]
fn authority_types_are_send_not_clone_and_snapshots_are_plain_data() {
    let _ = <Lease as AmbiguousIfClone<_>>::probe;
    let _ = <OperationHandle as AmbiguousIfClone<_>>::probe;
    let _ = <CommitAttempt as AmbiguousIfClone<_>>::probe;
    assert_send::<Lease>();
    assert_send::<OperationHandle>();
    assert_send::<CommitAttempt>();
    assert_send::<LeaseSnapshot>();
    assert_clone::<LeaseSnapshot>();
    assert_clone::<RestartRecord>();
}

// ------------------------------------------------- trace consumer

const SEEDS: u64 = 256;
const STEPS: usize = 64;
const GRACE: u128 = 5;
const EXT: u128 = 20;
const ABS: u128 = 100;
const WAIT: u128 = 7;
const RETENTION: u128 = 50;
const REQUESTS: [u64; 5] = [1, 5, 20, 25, u64::MAX];
const RETRY_ODDS: u64 = 16;
const COMMAND: &str = "cargo test -p oxigraph-cli --test lease_state_model";

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
}

#[derive(Clone, Copy, Debug)]
enum Action {
    BeginOp,
    FinishOp,
    Renew { fresh: bool, request: u64 },
    Cancel,
    Rollback,
    Dropped,
    BeginCommit,
    FinishCommit(CommitResult),
    ResponseLost,
    Resolve(ExternalOutcome),
    Observe,
}

#[derive(Clone, Copy, Debug)]
struct Step {
    at: u64,
    wrong_binding: bool,
    action: Action,
}

fn next_time(rng: &mut Rng, clock: &mut u64) -> u64 {
    if rng.below(12) == 0 {
        return clock.saturating_sub(1 + rng.below(3));
    }
    let jump = rng.below(16) == 0;
    let bound = if jump { 30 } else { 4 };
    *clock += rng.below(bound);
    *clock
}

fn commit_result(choice: u64) -> CommitResult {
    match choice {
        0 => CommitResult::Committed,
        1 => CommitResult::NotCommitted,
        _ => CommitResult::Indeterminate,
    }
}

fn external_outcome(choice: u64) -> ExternalOutcome {
    match choice {
        0 => ExternalOutcome::Committed,
        1 => ExternalOutcome::ProvenAbsent,
        _ => ExternalOutcome::Indeterminate,
    }
}

fn next_action(rng: &mut Rng) -> Action {
    match rng.below(100) {
        0..=14 => Action::BeginOp,
        15..=29 => Action::FinishOp,
        30..=41 => {
            let fresh = rng.below(5) != 0;
            let index = usize::try_from(rng.below(5)).unwrap();
            let request = REQUESTS[index];
            Action::Renew { fresh, request }
        }
        42..=46 => Action::Cancel,
        47..=51 => Action::Rollback,
        52..=54 => Action::Dropped,
        55..=62 => Action::BeginCommit,
        63..=72 => Action::FinishCommit(commit_result(rng.below(3))),
        73..=76 => Action::ResponseLost,
        77..=86 => Action::Resolve(external_outcome(rng.below(3))),
        _ => Action::Observe,
    }
}

fn random_step(rng: &mut Rng, clock: &mut u64) -> Step {
    let time = next_time(rng, clock);
    let action = next_action(rng);
    let wrong_binding = rng.below(20) == 0;
    Step {
        at: time,
        wrong_binding,
        action,
    }
}

// Begins one handle, rejects its finish before any transition (stranger
// binding or regressed time), then retries it as the owner. The clock
// advances first, so the begin always moves last_seen to `time`. The retry
// succeeds only if the lease is still live; the oracle judges every step.
fn retry_segment(rng: &mut Rng, clock: &mut u64) -> [Step; 3] {
    *clock += 1 + rng.below(3);
    let time = *clock;
    let (begin, finish) = if rng.below(2) == 0 {
        (Action::BeginOp, Action::FinishOp)
    } else {
        let result = commit_result(rng.below(3));
        (Action::BeginCommit, Action::FinishCommit(result))
    };
    let foreign = rng.below(2) == 0;
    let rejected_at = if foreign { time } else { time - 1 };
    let step = |at, wrong_binding, action| Step {
        at,
        wrong_binding,
        action,
    };
    [
        step(time, false, begin),
        step(rejected_at, foreign, finish),
        step(time, false, finish),
    ]
}

fn generate(seed: u64) -> Vec<Step> {
    let mut rng = Rng(seed);
    let mut clock = 0_u64;
    let mut steps = Vec::with_capacity(STEPS + 2);
    while steps.len() < STEPS {
        if rng.below(RETRY_ODDS) == 0 {
            steps.extend(retry_segment(&mut rng, &mut clock));
        } else {
            steps.push(random_step(&mut rng, &mut clock));
        }
    }
    steps.truncate(STEPS);
    steps
}

// The oracle shares no code with the model: separate types, u128 arithmetic
// and one explicit rule per (action, state) pair.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Out {
    Explicit,
    Dropped,
    Expired,
    Cancelled,
    Overdue(bool),
    Committed,
    Absent,
    Indeterminate,
}

impl Out {
    fn rolled_back(self) -> bool {
        match self {
            Self::Explicit | Self::Dropped | Self::Expired | Self::Cancelled => true,
            Self::Overdue(_) | Self::Committed | Self::Absent | Self::Indeterminate => false,
        }
    }

    fn attempted(self) -> bool {
        !self.rolled_back() && !matches!(self, Self::Overdue(_))
    }
}

fn out_of(outcome: Outcome) -> Out {
    match outcome {
        Outcome::RolledBack(RollbackReason::Explicit) => Out::Explicit,
        Outcome::RolledBack(RollbackReason::Dropped) => Out::Dropped,
        Outcome::RolledBack(RollbackReason::Expired) => Out::Expired,
        Outcome::RolledBack(RollbackReason::Cancelled) => Out::Cancelled,
        Outcome::CleanupOverdue(cause) => Out::Overdue(cause == CancelCause::Expiry),
        Outcome::Committed => Out::Committed,
        Outcome::CommitProvenAbsent => Out::Absent,
        Outcome::CommitIndeterminate => Out::Indeterminate,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum St {
    Idle,
    Op,
    Cancel(u128, bool),
    Commit(u128),
    Term(Out, u128),
    Gone(bool),
}

#[derive(Clone, Copy)]
enum Fault {
    Exact,
    SkewGrace,
}

#[derive(Debug, Eq, PartialEq)]
struct View {
    st: St,
    generation: u128,
    deadline: u128,
    last: u128,
    ops: u128,
    lost: bool,
    attempted: bool,
}

fn wide(time: LogicalTime) -> u128 {
    u128::from(time.0)
}

fn st_of(phase: LeasePhase) -> St {
    match phase {
        LeasePhase::Idle => St::Idle,
        LeasePhase::Operating => St::Op,
        LeasePhase::Cancelling {
            cleanup_deadline,
            cause,
        } => St::Cancel(wide(cleanup_deadline), cause == CancelCause::Expiry),
        LeasePhase::CommitAttempted { decide_by } => St::Commit(wide(decide_by)),
        LeasePhase::Terminal { outcome, at } => St::Term(out_of(outcome), wide(at)),
        LeasePhase::Expired { attempted } => St::Gone(attempted),
    }
}

fn view_of(snapshot: &LeaseSnapshot) -> View {
    View {
        st: st_of(snapshot.phase),
        generation: u128::from(snapshot.generation.get()),
        deadline: wide(snapshot.deadline),
        last: wide(snapshot.last_seen),
        ops: u128::from(snapshot.operation_count),
        lost: snapshot.response_lost,
        attempted: snapshot.commit_attempted,
    }
}

fn blocked(st: St) -> LeaseError {
    match st {
        St::Idle | St::Op | St::Cancel(..) => LeaseError::Busy,
        St::Commit(_) => LeaseError::CommitAttempted,
        St::Term(..) => LeaseError::AlreadyTerminal,
        St::Gone(_) => LeaseError::Expired,
    }
}

struct Oracle {
    st: St,
    generation: u128,
    deadline: u128,
    last: u128,
    ops: u128,
    lost: bool,
    attempted: bool,
    grace: u128,
}

impl Oracle {
    fn new(fault: Fault) -> Self {
        let skew = u128::from(matches!(fault, Fault::SkewGrace));
        Self {
            st: St::Idle,
            generation: 1,
            deadline: 10,
            last: 0,
            ops: 0,
            lost: false,
            attempted: false,
            grace: GRACE + skew,
        }
    }

    fn view(&self) -> View {
        View {
            st: self.st,
            generation: self.generation,
            deadline: self.deadline,
            last: self.last,
            ops: self.ops,
            lost: self.lost,
            attempted: self.attempted,
        }
    }

    fn settle(&mut self, now: u128) {
        loop {
            self.st = match self.st {
                St::Idle if now >= self.deadline => St::Term(Out::Expired, self.deadline),
                St::Op if now >= self.deadline => St::Cancel(self.deadline + self.grace, true),
                St::Cancel(due, expiry) if now >= due => St::Term(Out::Overdue(expiry), due),
                St::Commit(due) if now >= due => St::Term(Out::Indeterminate, due),
                St::Term(out, since) if now >= since + RETENTION => St::Gone(out.attempted()),
                _ => return,
            };
        }
    }

    fn apply(&mut self, step: &Step) -> Result<(), LeaseError> {
        if step.wrong_binding {
            return Err(LeaseError::BindingMismatch);
        }
        let now = u128::from(step.at);
        if now < self.last {
            return Err(LeaseError::TimeRegression);
        }
        self.last = now;
        self.settle(now);
        match step.action {
            Action::Observe => Ok(()),
            Action::ResponseLost => {
                self.lost = true;
                Ok(())
            }
            Action::BeginOp => self.begin_op(),
            Action::BeginCommit => self.begin_commit(now),
            Action::Renew { fresh, request } => self.renew(now, fresh, request),
            Action::Cancel => self.cancel(now),
            Action::Rollback => self.rollback(now, Out::Explicit),
            Action::Dropped => self.rollback(now, Out::Dropped),
            Action::FinishOp => self.finish_op(now),
            Action::FinishCommit(result) => self.finish_commit(now, result),
            Action::Resolve(external) => self.resolve(external),
        }
    }

    fn begin_op(&mut self) -> Result<(), LeaseError> {
        if self.st != St::Idle {
            return Err(blocked(self.st));
        }
        self.st = St::Op;
        self.ops += 1;
        Ok(())
    }

    fn begin_commit(&mut self, now: u128) -> Result<(), LeaseError> {
        if self.st != St::Idle {
            return Err(blocked(self.st));
        }
        self.st = St::Commit(now + WAIT);
        self.attempted = true;
        Ok(())
    }

    fn renew(&mut self, now: u128, fresh: bool, request: u64) -> Result<(), LeaseError> {
        if self.st != St::Idle {
            return Err(blocked(self.st));
        }
        if !fresh {
            return Err(LeaseError::StaleGeneration);
        }
        let next = (now + u128::from(request).min(EXT)).min(ABS);
        if next <= self.deadline {
            return Err(LeaseError::NoExtension);
        }
        self.deadline = next;
        self.generation += 1;
        Ok(())
    }

    fn cancel(&mut self, now: u128) -> Result<(), LeaseError> {
        self.st = match self.st {
            St::Idle => St::Term(Out::Cancelled, now),
            St::Op => St::Cancel(now + self.grace, false),
            St::Cancel(..) => self.st,
            St::Term(out, _) if out.rolled_back() => self.st,
            other => return Err(blocked(other)),
        };
        Ok(())
    }

    fn rollback(&mut self, now: u128, out: Out) -> Result<(), LeaseError> {
        self.st = match self.st {
            St::Idle => St::Term(out, now),
            St::Term(done, _) if done.rolled_back() => self.st,
            other => return Err(blocked(other)),
        };
        Ok(())
    }

    fn finish_op(&mut self, now: u128) -> Result<(), LeaseError> {
        self.st = match self.st {
            St::Op => St::Idle,
            St::Cancel(_, true) => St::Term(Out::Expired, now),
            St::Cancel(_, false) => St::Term(Out::Cancelled, now),
            St::Term(..) => return Err(LeaseError::AlreadyTerminal),
            St::Gone(_) => return Err(LeaseError::Expired),
            St::Idle | St::Commit(_) => return Err(LeaseError::StaleHandle),
        };
        Ok(())
    }

    fn finish_commit(&mut self, now: u128, result: CommitResult) -> Result<(), LeaseError> {
        let out = match result {
            CommitResult::Committed => Out::Committed,
            CommitResult::NotCommitted => Out::Absent,
            CommitResult::Indeterminate => Out::Indeterminate,
        };
        self.st = match self.st {
            St::Commit(_) => St::Term(out, now),
            St::Term(..) => return Err(LeaseError::AlreadyTerminal),
            St::Gone(_) => return Err(LeaseError::Expired),
            St::Idle | St::Op | St::Cancel(..) => return Err(LeaseError::StaleHandle),
        };
        Ok(())
    }

    fn resolve(&mut self, external: ExternalOutcome) -> Result<(), LeaseError> {
        use ExternalOutcome as X;
        let conflict = LeaseError::ConflictingResolution;
        let (out, since) = match self.st {
            St::Term(out, since) => (out, since),
            St::Gone(_) => return Err(LeaseError::Expired),
            _ => return Err(LeaseError::NotIndeterminate),
        };
        let resolved = match (out, external) {
            (Out::Indeterminate, X::Committed) => Out::Committed,
            (Out::Indeterminate, X::ProvenAbsent) => Out::Absent,
            (Out::Indeterminate, X::Indeterminate) => Out::Indeterminate,
            (Out::Committed, X::ProvenAbsent) => return Err(conflict),
            (Out::Absent, X::Committed) => return Err(conflict),
            (Out::Committed | Out::Absent, _) => out,
            _ => return Err(LeaseError::NotIndeterminate),
        };
        self.st = St::Term(resolved, since);
        Ok(())
    }
}

struct Harness {
    lease: Lease,
    operation: Option<OperationHandle>,
    attempt: Option<CommitAttempt>,
    duplicate: bool,
    begun: u32,
    finished: u32,
}

fn stale(current: Generation) -> Generation {
    Generation::new(current.get().wrapping_add(1000))
}

impl Harness {
    fn new() -> Self {
        Self {
            lease: begin_as(9, 0, limits()).unwrap(),
            operation: None,
            attempt: None,
            duplicate: false,
            begun: 0,
            finished: 0,
        }
    }

    fn lacks_handle(&self, action: Action) -> bool {
        match action {
            Action::FinishOp => self.operation.is_none(),
            Action::FinishCommit(_) => self.attempt.is_none(),
            _ => false,
        }
    }

    fn run(&mut self, step: &Step, current: Generation) -> Ran {
        let binding = [owner(), stranger()][usize::from(step.wrong_binding)];
        let call = call_as(binding, step.at);
        match step.action {
            Action::Observe => (self.lease.observe(call).map(drop), None),
            Action::ResponseLost => (self.lease.response_lost(call), None),
            Action::BeginOp => (self.begin_op(call), None),
            Action::FinishOp => (self.finish_op(call), None),
            Action::Renew { fresh, request } => {
                let expected = if fresh { current } else { stale(current) };
                let requested = NonZeroU64::new(request).unwrap();
                match self.lease.renew(call, expected, requested) {
                    Ok(renewal) => (Ok(()), Some(renewal.granted)),
                    Err(error) => (Err(error), None),
                }
            }
            Action::Cancel => (self.lease.request_cancel(call).map(drop), None),
            Action::Rollback => (self.lease.rollback(call).map(drop), None),
            Action::Dropped => (self.lease.dropped(call).map(drop), None),
            Action::BeginCommit => (self.begin_commit(call), None),
            Action::FinishCommit(result) => (self.finish_commit(call, result), None),
            Action::Resolve(external) => (self.resolve(call, external), None),
        }
    }

    fn begin_op(&mut self, call: Call<'_>) -> Result<(), LeaseError> {
        let handle = self.lease.begin_operation(call)?;
        self.duplicate |= self.operation.replace(handle).is_some();
        Ok(())
    }

    // Only a successful finish retires the handle. A rejected finish keeps it,
    // so later finish steps still reach both the model and the oracle.
    fn finish_op(&mut self, call: Call<'_>) -> Result<(), LeaseError> {
        let handle = self.operation.as_ref().unwrap();
        self.lease.finish_operation(call, handle)?;
        self.operation = None;
        Ok(())
    }

    fn begin_commit(&mut self, call: Call<'_>) -> Result<(), LeaseError> {
        let attempt = self.lease.begin_commit(call, key())?;
        self.attempt = Some(attempt);
        self.begun += 1;
        Ok(())
    }

    fn finish_commit(&mut self, call: Call<'_>, result: CommitResult) -> Result<(), LeaseError> {
        let attempt = self.attempt.as_ref().unwrap();
        self.lease.finish_commit(call, attempt, result)?;
        self.attempt = None;
        self.finished += 1;
        Ok(())
    }

    fn resolve(&mut self, call: Call<'_>, outcome: ExternalOutcome) -> Result<(), LeaseError> {
        self.lease.resolve_indeterminate(call, outcome).map(drop)
    }
}

#[derive(Debug)]
struct Failure {
    index: usize,
    message: String,
}

fn fail(index: usize, message: impl Into<String>) -> Failure {
    Failure {
        index,
        message: message.into(),
    }
}

#[derive(Default)]
struct Coverage {
    renewals: u32,
    busy: u32,
    commits: u32,
    gone: u32,
    operation_retries: u32,
    commit_retries: u32,
}

impl Coverage {
    fn add(&mut self, other: &Self) {
        self.renewals += other.renewals;
        self.busy += other.busy;
        self.commits += other.commits;
        self.gone += other.gone;
        self.operation_retries += other.operation_retries;
        self.commit_retries += other.commit_retries;
    }
}

fn rejected_before_transition(error: LeaseError) -> bool {
    matches!(
        error,
        LeaseError::BindingMismatch | LeaseError::TimeRegression
    )
}

/// Last rejection of one retained handle kind. A finish counts as a retry
/// only if it succeeds right after that handle was rejected without any
/// transition; a replay after a terminal rejection never counts.
#[derive(Default)]
struct Retry {
    rejected: Option<LeaseError>,
}

impl Retry {
    fn reset(&mut self) {
        self.rejected = None;
    }

    fn observe(&mut self, got: Result<(), LeaseError>) -> u32 {
        let retried = got.is_ok() && self.rejected.is_some_and(rejected_before_transition);
        self.rejected = got.err();
        u32::from(retried)
    }
}

fn is_expired(phase: LeasePhase) -> bool {
    matches!(phase, LeasePhase::Expired { .. })
}

fn non_commit_terminal(phase: LeasePhase) -> bool {
    match phase {
        LeasePhase::Terminal { outcome, .. } => !outcome.is_commit_attempt(),
        _ => false,
    }
}

fn terminal_violation(prev: LeasePhase, now: LeasePhase) -> Option<&'static str> {
    let before = match prev {
        LeasePhase::Terminal { outcome, at } => (outcome, at),
        LeasePhase::Expired { .. } => {
            let kept = is_expired(now);
            return (!kept).then_some("expired tombstone was left");
        }
        _ => return None,
    };
    let after = match now {
        LeasePhase::Terminal { outcome, at } => (outcome, at),
        LeasePhase::Expired { .. } => return None,
        _ => return Some("terminal state was left"),
    };
    let resolution = before.0 == Outcome::CommitIndeterminate && after.0.is_commit_attempt();
    if before.1 != after.1 || (before.0 != after.0 && !resolution) {
        return Some("terminal outcome changed without a resolution");
    }
    None
}

fn invariants(
    prev: &LeaseSnapshot,
    now: &LeaseSnapshot,
    got: Result<(), LeaseError>,
    granted: Option<u64>,
    harness: &Harness,
) -> Option<&'static str> {
    let renewed = u64::from(granted.is_some());
    if now.generation.get() != prev.generation.get() + renewed {
        return Some("generation changed other than by a successful renewal");
    }
    if granted.is_some_and(|value| u128::from(value) > EXT) {
        return Some("renewal grant exceeds the maximum extension");
    }
    if now.deadline > now.absolute_deadline || now.last_seen < prev.last_seen {
        return Some("deadline or last_seen bound violated");
    }
    if harness.duplicate {
        return Some("second live operation handle");
    }
    if harness.begun > 1 || harness.finished > 1 {
        return Some("more than one commit attempt or commit finish");
    }
    if now.commit_attempted && non_commit_terminal(now.phase) {
        return Some("attempted commit reached a non-commit terminal");
    }
    let cleared_attempt = prev.commit_attempted && !now.commit_attempted;
    let cleared_loss = prev.response_lost && !now.response_lost;
    if cleared_attempt || cleared_loss {
        return Some("a monotone flag was cleared");
    }
    let untouched = [LeaseError::BindingMismatch, LeaseError::TimeRegression];
    if got.is_err_and(|error| untouched.contains(&error)) && now != prev {
        return Some("rejected call mutated the lease");
    }
    let atomic = now.commit_attempted == prev.commit_attempted
        && now.commit_key == prev.commit_key
        && now.response_lost == prev.response_lost
        && now.operation_count == prev.operation_count;
    if got.is_err() && !atomic {
        return Some("rejection was not atomic");
    }
    terminal_violation(prev.phase, now.phase)
}

fn replay(steps: &[Step], fault: Fault) -> Result<Coverage, Failure> {
    let mut harness = Harness::new();
    let mut oracle = Oracle::new(fault);
    let mut coverage = Coverage::default();
    let mut prev = harness.lease.snapshot();
    let mut operation = Retry::default();
    let mut commit = Retry::default();
    for (index, step) in steps.iter().enumerate() {
        if harness.lacks_handle(step.action) {
            continue;
        }
        let expected = oracle.apply(step);
        let (got, granted) = harness.run(step, prev.generation);
        if got != expected {
            let action = step.action;
            let message = format!("{action:?}: model {got:?}, oracle {expected:?}");
            return Err(fail(index, message));
        }
        let now = harness.lease.snapshot();
        let (model, predicted) = (view_of(&now), oracle.view());
        if model != predicted {
            let message = format!("model {model:?} != oracle {predicted:?}");
            return Err(fail(index, message));
        }
        if let Some(message) = invariants(&prev, &now, got, granted, &harness) {
            return Err(fail(index, message));
        }
        coverage.renewals += u32::from(granted.is_some());
        coverage.busy += u32::from(got == Err(LeaseError::Busy));
        let committed = matches!(step.action, Action::BeginCommit) && got.is_ok();
        coverage.commits += u32::from(committed);
        let gone = is_expired(now.phase) && !is_expired(prev.phase);
        coverage.gone += u32::from(gone);
        match step.action {
            Action::BeginOp if got.is_ok() => operation.reset(),
            Action::BeginCommit if got.is_ok() => commit.reset(),
            Action::FinishOp => coverage.operation_retries += operation.observe(got),
            Action::FinishCommit(_) => coverage.commit_retries += commit.observe(got),
            _ => {}
        }
        prev = now;
    }
    Ok(coverage)
}

fn shrink<T: Clone>(steps: Vec<T>, fails: impl Fn(&[T]) -> bool) -> Vec<T> {
    let mut current = steps;
    loop {
        let mut progressed = false;
        let mut index = 0;
        while index < current.len() {
            let mut candidate = current.clone();
            candidate.remove(index);
            if fails(&candidate) {
                current = candidate;
                progressed = true;
            } else {
                index += 1;
            }
        }
        if !progressed {
            return current;
        }
    }
}

fn report(seed: u64, steps: &[Step], failure: &Failure) -> ! {
    let fails = |candidate: &[Step]| replay(candidate, Fault::Exact).is_err();
    let minimal = shrink(steps.to_vec(), fails);
    let index = failure.index;
    let reason = &failure.message;
    let count = minimal.len();
    let header = format!("seed={seed} step={index} reason={reason}");
    let trace = format!("minimal ({count} steps): {minimal:#?}");
    let hint = format!("LEASE_TRACE_SEED={seed} {COMMAND}");
    panic!("lease trace failed: {header}\n{trace}\n{hint}");
}

fn seeds() -> Vec<u64> {
    let pinned = std::env::var("LEASE_TRACE_SEED").ok();
    match pinned.and_then(|value| value.parse().ok()) {
        Some(seed) => vec![seed],
        None => (0..SEEDS).collect(),
    }
}

#[test]
fn seeded_traces_agree_with_the_independent_oracle() {
    let selected = seeds();
    let full = selected.len() == usize::try_from(SEEDS).unwrap();
    let mut total = Coverage::default();
    for seed in selected {
        let steps = generate(seed);
        match replay(&steps, Fault::Exact) {
            Ok(coverage) => total.add(&coverage),
            Err(failure) => report(seed, &steps, &failure),
        }
    }
    if full {
        assert!(total.renewals > 0 && total.busy > 0);
        assert!(total.commits > 0 && total.gone > 0);
        assert!(total.operation_retries > 0, "no successful operation retry");
        assert!(total.commit_retries > 0, "no successful commit retry");
    }
}

#[test]
fn trace_generation_is_deterministic() {
    let first = format!("{:?}", generate(42));
    assert_eq!(first, format!("{:?}", generate(42)));
    assert_ne!(first, format!("{:?}", generate(43)));
    assert_eq!(generate(7).len(), STEPS);
}

fn scripted(at: u64, wrong_binding: bool, action: Action) -> Step {
    Step {
        at,
        wrong_binding,
        action,
    }
}

fn retries(steps: &[Step]) -> (u32, u32) {
    let coverage = replay(steps, Fault::Exact).unwrap();
    (coverage.operation_retries, coverage.commit_retries)
}

#[test]
fn retry_coverage_counts_only_successful_same_handle_retries() {
    let finish = Action::FinishCommit(CommitResult::Committed);
    let regressed = [
        scripted(5, false, Action::BeginOp),
        scripted(4, false, Action::FinishOp),
        scripted(6, false, Action::FinishOp),
    ];
    assert_eq!(retries(&regressed), (1, 0));
    let mismatched = [
        scripted(5, false, Action::BeginCommit),
        scripted(6, true, finish),
        scripted(6, false, finish),
    ];
    assert_eq!(retries(&mismatched), (0, 1));
    // Negative controls: each has a finish after a rejected finish, which the
    // former counter accepted, but none completes a handle after a rejection
    // that changed nothing.
    let overdue = [
        scripted(1, false, Action::BeginOp),
        scripted(2, false, Action::Cancel),
        scripted(7, false, Action::FinishOp),
        scripted(8, false, Action::FinishOp),
    ];
    let undecided = [
        scripted(3, false, Action::BeginCommit),
        scripted(10, false, finish),
        scripted(11, false, finish),
    ];
    let late_operation = [
        scripted(5, false, Action::BeginOp),
        scripted(4, false, Action::FinishOp),
        scripted(15, false, Action::FinishOp),
    ];
    let late_commit = [
        scripted(5, false, Action::BeginCommit),
        scripted(6, true, finish),
        scripted(12, false, finish),
    ];
    let controls = [
        &overdue[..],
        &undecided[..],
        &late_operation[..],
        &late_commit[..],
    ];
    for control in controls {
        assert_eq!(retries(control), (0, 0), "{control:?}");
    }
}

#[test]
fn consumer_detects_a_wrong_oracle_and_shrinks_the_trace() {
    let skewed = |steps: &[Step]| replay(steps, Fault::SkewGrace).is_err();
    let seed = (0..SEEDS).find(|&seed| skewed(&generate(seed)[..]));
    let seed = seed.expect("a skewed oracle must be detected");
    let minimal = shrink(generate(seed), skewed);
    assert!(skewed(&minimal), "seed {seed}");
    assert!(minimal.len() <= 4, "seed {seed}: {minimal:?}");
    assert!(replay(&minimal, Fault::Exact).is_ok(), "seed {seed}");
}

#[test]
fn shrinker_reduces_a_synthetic_predicate_to_the_two_culprit_steps() {
    let mut steps: Vec<u8> = (0..40).map(|n| n % 5).collect();
    steps[6] = 3;
    steps[29] = 7;
    steps[12] = 7;
    steps[35] = 3;
    let fails = |candidate: &[u8]| {
        candidate
            .iter()
            .enumerate()
            .any(|(i, a)| *a == 3 && candidate[i + 1..].contains(&7))
    };
    assert!(fails(&steps));
    assert_eq!(shrink(steps, fails), vec![3, 7]);
}
