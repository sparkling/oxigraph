//! Public-API tests for the ADR-0031 lifecycle model (gate 1). No clock, no I/O:
//! every time value is injected.

use oxigraph_cli::lease::LogicalTime;
use oxigraph_cli::repository::*;
use std::collections::BTreeMap;

type Attempt = Result<(), RepositoryError>;
type Counts = BTreeMap<String, u32>;

const RETENTION: u64 = 50;
const MAX_GENERATION: u64 = 1000;
const RECOVERY_REF: [u8; 16] = [1; 16];
const PURGE_REF: [u8; 16] = [2; 16];
const RW: OpenMode = OpenMode::ReadWrite;
const RO: OpenMode = OpenMode::ReadOnly;
const PASSED: ValidationOutcome = ValidationOutcome::Passed;
const TOMBSTONE: QuiesceTarget = QuiesceTarget::Tombstone;
const CLOSE: QuiesceTarget = QuiesceTarget::Close;
const DELETED: DeletionOutcome = DeletionOutcome::Deleted;

const STATES: [RepositoryState; 9] = [
    RepositoryState::Provisioning,
    RepositoryState::Closed,
    RepositoryState::Opening,
    RepositoryState::ReadyReadWrite,
    RepositoryState::ReadyReadOnly,
    RepositoryState::Quiescing,
    RepositoryState::Tombstoned,
    RepositoryState::Deleting,
    RepositoryState::Failed,
];

fn t(value: u64) -> LogicalTime {
    LogicalTime(value)
}

fn id(text: &str) -> RepositoryId {
    RepositoryId::parse(text).unwrap()
}

fn recovery() -> RecoveryAssertion {
    RecoveryAssertion::caller_asserted(RECOVERY_REF).unwrap()
}

fn purge() -> PurgeAssertion {
    PurgeAssertion::caller_asserted(PURGE_REF).unwrap()
}

fn drained() -> DrainConfirmation {
    DrainConfirmation::new(WorkDrain::Drained, LeaseStatus::NoActiveLeases)
}

// ------------------------------------------------------------------ fixture

struct Fixture {
    repo: Repository,
    handle: TransitionHandle,
    now: u64,
}

impl Fixture {
    fn with_limits(retention: u64, max_generation: u64) -> Self {
        let limits = RepositoryLimits::new(retention, max_generation).unwrap();
        let (repo, handle) = Repository::provision(id("repo-1"), limits, t(0));
        Self {
            repo,
            handle,
            now: 0,
        }
    }

    fn new() -> Self {
        Self::with_limits(RETENTION, MAX_GENERATION)
    }

    fn tick(&mut self) -> LogicalTime {
        self.now += 1;
        t(self.now)
    }

    fn snapshot(&self) -> RepositorySnapshot {
        self.repo.snapshot()
    }

    fn generation(&self) -> Generation {
        self.snapshot().generation
    }

    fn provisioned(&mut self, outcome: ValidationOutcome) {
        let at = self.tick();
        let result = self.repo.complete_provisioning(&self.handle, outcome, at);
        result.unwrap();
    }

    fn begin_open(&mut self, mode: OpenMode) {
        let at = self.tick();
        let generation = self.generation();
        self.handle = self.repo.begin_open(generation, mode, at).unwrap();
    }

    fn finish_open(&mut self, outcome: ValidationOutcome) {
        let at = self.tick();
        let result = self.repo.complete_open(&self.handle, outcome, at);
        result.unwrap();
    }

    fn open(&mut self, mode: OpenMode) {
        self.begin_open(mode);
        self.finish_open(PASSED);
    }

    fn begin_quiesce(&mut self) {
        let at = self.tick();
        let generation = self.generation();
        self.handle = self.repo.begin_quiesce(generation, at).unwrap();
    }

    fn finish_quiesce(&mut self, target: QuiesceTarget) {
        let at = self.tick();
        let drain = drained();
        let result = self.repo.complete_quiesce(&self.handle, drain, target, at);
        result.unwrap();
    }

    fn restore(&mut self) {
        let at = self.tick();
        let generation = self.generation();
        let result = self.repo.restore(generation, recovery(), at);
        result.unwrap();
    }

    // Moves time to the tombstone deadline when one is set.
    fn begin_purge(&mut self) {
        if let Some(deadline) = self.snapshot().tombstone_deadline {
            self.now = self.now.max(deadline.0 - 1);
        }
        let at = self.tick();
        let generation = self.generation();
        self.handle = self.repo.begin_purge(generation, purge(), at).unwrap();
    }

    fn finish_purge(&mut self, outcome: DeletionOutcome) {
        let at = self.tick();
        let result = self.repo.complete_purge(&self.handle, outcome, at);
        result.unwrap();
    }
}

fn reach(target: RepositoryState) -> Fixture {
    use RepositoryState as S;
    let mut f = Fixture::new();
    if target == S::Provisioning {
        return f;
    }
    let outcome = if target == S::Failed {
        ValidationOutcome::Failed
    } else {
        PASSED
    };
    f.provisioned(outcome);
    match target {
        S::Provisioning | S::Closed | S::Failed => {}
        S::Opening => f.begin_open(RW),
        S::ReadyReadWrite => f.open(RW),
        S::ReadyReadOnly => f.open(RO),
        S::Quiescing => {
            f.open(RW);
            f.begin_quiesce();
        }
        S::Tombstoned => {
            f.open(RW);
            f.begin_quiesce();
            f.finish_quiesce(TOMBSTONE);
        }
        S::Deleting => {
            f.open(RW);
            f.begin_quiesce();
            f.finish_quiesce(TOMBSTONE);
            f.begin_purge();
        }
    }
    assert_eq!(f.snapshot().state, target);
    f
}

fn admit(f: &mut Fixture, kind: WorkKind) -> Attempt {
    let at = f.tick();
    f.repo.admit(at, kind)
}

// ------------------------------------------------------ IDs, limits, assertions

fn grammar_ok(text: &str) -> bool {
    let first = |c: char| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9');
    let rest = |c: char| first(c) || matches!(c, '.' | '_' | '-');
    let mut chars = text.chars();
    match chars.next() {
        Some(c) if first(c) => {}
        _ => return false,
    }
    text.chars().count() <= 64 && chars.all(rest)
}

#[test]
fn repository_id_grammar_boundaries_are_exact() {
    let longest = "a".repeat(64);
    let too_long = "a".repeat(65);
    assert!(RepositoryId::parse("a").is_ok());
    assert!(RepositoryId::parse(&longest).is_ok());
    assert_eq!(id(&longest).as_str(), longest);
    let mixed = format!("Z{}", "._-9".repeat(15));
    assert_eq!(mixed.len(), 61);
    assert!(RepositoryId::parse(&mixed).is_ok());
    let bad = [
        "",
        too_long.as_str(),
        ".a",
        "-a",
        "_a",
        "a/b",
        "/a",
        "..",
        "a b",
        "a\0",
        "a\n",
        "a%2e",
        "\u{e9}",
        "a\u{e9}",
        "\u{ff21}",
        "a\u{200b}",
    ];
    for text in bad {
        let parsed = RepositoryId::parse(text);
        assert_eq!(parsed.unwrap_err(), RepositoryError::InvalidId, "{text:?}");
    }
}

#[test]
fn every_ascii_byte_matches_the_independent_grammar() {
    for byte in 0_u8..128 {
        let single = char::from(byte).to_string();
        let second = format!("a{single}");
        for candidate in [single, second] {
            let parsed = RepositoryId::parse(&candidate);
            assert_eq!(parsed.is_ok(), grammar_ok(&candidate), "{candidate:?}");
            if let Err(error) = parsed {
                assert_eq!(error, RepositoryError::InvalidId);
            }
        }
    }
}

#[test]
fn repository_id_is_case_sensitive_and_never_normalized() {
    assert_ne!(id("Repo"), id("repo"));
    assert_eq!(id("Repo-1.x_Y").as_str(), "Repo-1.x_Y");
    let (repo, _handle) = Repository::provision(id("Repo"), limits(1, 1), t(0));
    assert_eq!(repo.id().as_str(), "Repo");
}

fn limits(retention: u64, max_generation: u64) -> RepositoryLimits {
    RepositoryLimits::new(retention, max_generation).unwrap()
}

#[test]
fn limits_reject_zero_values() {
    let invalid = Err(RepositoryError::InvalidLimits);
    assert_eq!(RepositoryLimits::new(0, 5), invalid);
    assert_eq!(RepositoryLimits::new(5, 0), invalid);
    assert_eq!(RepositoryLimits::new(0, 0), invalid);
    let ok = limits(1, 1);
    assert_eq!((ok.retention(), ok.max_generation()), (1, 1));
}

#[test]
fn caller_assertions_reject_all_zero_and_keep_their_reference() {
    let invalid = RepositoryError::InvalidAssertion;
    let zero_recovery = RecoveryAssertion::caller_asserted([0; 16]);
    assert_eq!(zero_recovery.unwrap_err(), invalid);
    let zero_purge = PurgeAssertion::caller_asserted([0; 16]);
    assert_eq!(zero_purge.unwrap_err(), invalid);
    let mut single = [0; 16];
    single[15] = 9;
    let recovery = RecoveryAssertion::caller_asserted(single).unwrap();
    let purge = PurgeAssertion::caller_asserted(single).unwrap();
    assert_eq!(recovery.reference(), single);
    assert_eq!(purge.reference(), single);
}

// ------------------------------------------------- state x operation table

#[derive(Clone, Copy, Debug)]
enum Op {
    BeginOpen,
    BeginQuiesce,
    Restore,
    BeginPurge,
    CompleteProvisioning,
    CompleteOpen,
    CompleteQuiesce,
    CompletePurge,
    Read,
    Write,
}

const OPS: [Op; 10] = [
    Op::BeginOpen,
    Op::BeginQuiesce,
    Op::Restore,
    Op::BeginPurge,
    Op::CompleteProvisioning,
    Op::CompleteOpen,
    Op::CompleteQuiesce,
    Op::CompletePurge,
    Op::Read,
    Op::Write,
];

fn run(f: &mut Fixture, op: Op) -> Attempt {
    let at = f.tick();
    let generation = f.generation();
    let drain = drained();
    let repo = &mut f.repo;
    match op {
        Op::BeginOpen => {
            f.handle = repo.begin_open(generation, RW, at)?;
        }
        Op::BeginQuiesce => {
            f.handle = repo.begin_quiesce(generation, at)?;
        }
        Op::Restore => {
            repo.restore(generation, recovery(), at)?;
        }
        Op::BeginPurge => {
            f.handle = repo.begin_purge(generation, purge(), at)?;
        }
        Op::CompleteProvisioning => {
            repo.complete_provisioning(&f.handle, PASSED, at)?;
        }
        Op::CompleteOpen => {
            repo.complete_open(&f.handle, PASSED, at)?;
        }
        Op::CompleteQuiesce => {
            repo.complete_quiesce(&f.handle, drain, TOMBSTONE, at)?;
        }
        Op::CompletePurge => {
            repo.complete_purge(&f.handle, DELETED, at)?;
        }
        Op::Read => {
            repo.admit(at, WorkKind::Read)?;
        }
        Op::Write => {
            repo.admit(at, WorkKind::Write)?;
        }
    }
    Ok(())
}

fn expected(state: RepositoryState, op: Op) -> Result<RepositoryState, RepositoryError> {
    use RepositoryError as E;
    use RepositoryState as S;
    let invalid: Result<S, E> = Err(E::InvalidState);
    match op {
        Op::BeginOpen => match state {
            S::Closed => Ok(S::Opening),
            _ => invalid,
        },
        Op::BeginQuiesce => match state {
            S::Closed | S::ReadyReadWrite | S::ReadyReadOnly => Ok(S::Quiescing),
            _ => invalid,
        },
        Op::Restore => match state {
            S::Tombstoned => Ok(S::Closed),
            _ => invalid,
        },
        Op::BeginPurge => match state {
            S::Failed => Ok(S::Deleting),
            S::Tombstoned => Err(E::RetentionActive),
            _ => invalid,
        },
        Op::CompleteProvisioning | Op::CompleteOpen | Op::CompleteQuiesce | Op::CompletePurge => {
            let live = matches!(
                state,
                S::Provisioning | S::Opening | S::Quiescing | S::Deleting
            );
            let success = match (op, state) {
                (Op::CompleteProvisioning, S::Provisioning) => Some(S::Closed),
                (Op::CompleteOpen, S::Opening) => Some(S::ReadyReadWrite),
                (Op::CompleteQuiesce, S::Quiescing) => Some(S::Tombstoned),
                (Op::CompletePurge, S::Deleting) => Some(S::Deleting),
                _ => None,
            };
            match (live, success) {
                (false, _) => Err(E::StaleHandle),
                (true, Some(next)) => Ok(next),
                (true, None) => invalid,
            }
        }
        Op::Read | Op::Write => match (state, op) {
            (S::ReadyReadWrite, _) | (S::ReadyReadOnly, Op::Read) => Ok(state),
            (S::ReadyReadOnly, _) => Err(E::ReadOnly),
            (S::Quiescing, _) => Err(E::Quiescing),
            _ => Err(E::NotReady),
        },
    }
}

#[test]
fn every_state_and_operation_pair_matches_the_rejection_table() {
    for state in STATES {
        for op in OPS {
            let mut f = reach(state);
            let before = f.snapshot();
            let got = run(&mut f, op).map(|()| f.snapshot().state);
            let want = expected(state, op);
            assert_eq!(got, want, "{state:?} {op:?}");
            let after = f.snapshot();
            let admit_op = matches!(op, Op::Read | Op::Write);
            if want.is_err() {
                assert_eq!(after, before, "{state:?} {op:?}");
            } else if admit_op {
                assert_eq!(after.generation, before.generation, "{state:?} {op:?}");
            } else {
                let bumped = before.generation.get() + 1;
                assert_eq!(after.generation.get(), bumped, "{state:?} {op:?}");
            }
        }
    }
}

// ------------------------------------------------------- lifecycle behaviour

#[test]
fn readiness_needs_validation_and_failures_stay_non_ready() {
    use RepositoryError as E;
    use RepositoryState as S;
    let mut f = Fixture::new();
    assert_eq!(admit(&mut f, WorkKind::Read), Err(E::NotReady));
    f.provisioned(PASSED);
    assert_eq!(admit(&mut f, WorkKind::Read), Err(E::NotReady));
    f.begin_open(RW);
    assert_eq!(admit(&mut f, WorkKind::Write), Err(E::NotReady));
    f.finish_open(ValidationOutcome::Failed);
    assert_eq!(f.snapshot().state, S::Failed);
    assert_eq!(admit(&mut f, WorkKind::Read), Err(E::NotReady));
    let at = f.tick();
    let generation = f.generation();
    let reopened = f.repo.begin_open(generation, RW, at);
    assert_eq!(reopened.err(), Some(E::InvalidState));

    let mut created = Fixture::new();
    created.provisioned(ValidationOutcome::Failed);
    assert_eq!(created.snapshot().state, S::Failed);
    assert_eq!(admit(&mut created, WorkKind::Read), Err(E::NotReady));
}

#[test]
fn read_only_rejects_writes_and_admit_records_only_the_time() {
    use RepositoryError as E;
    let mut f = reach(RepositoryState::ReadyReadOnly);
    let before = f.snapshot();
    assert_eq!(admit(&mut f, WorkKind::Write), Err(E::ReadOnly));
    assert_eq!(f.snapshot(), before);
    let at = f.tick();
    assert_eq!(f.repo.admit(at, WorkKind::Read), Ok(()));
    let after = f.snapshot();
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.state, before.state);
    assert_eq!(after.last_seen, at);
}

#[test]
fn quiescing_rejects_all_new_work() {
    let mut f = reach(RepositoryState::Quiescing);
    let before = f.snapshot();
    for kind in [WorkKind::Read, WorkKind::Write] {
        assert_eq!(admit(&mut f, kind), Err(RepositoryError::Quiescing));
    }
    assert_eq!(f.snapshot(), before);
}

#[test]
fn quiesce_needs_the_full_drain_confirmation() {
    use RepositoryError as E;
    use RepositoryState as S;
    let combos = [
        (WorkDrain::Drained, LeaseStatus::NoActiveLeases, true),
        (WorkDrain::Drained, LeaseStatus::ActiveLeases, false),
        (WorkDrain::InFlight, LeaseStatus::NoActiveLeases, false),
        (WorkDrain::InFlight, LeaseStatus::ActiveLeases, false),
    ];
    let full = drained();
    for (work, leases, confirmed) in combos {
        let mut f = reach(S::Quiescing);
        let before = f.snapshot();
        let at = f.tick();
        let drain = DrainConfirmation::new(work, leases);
        let first = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, at);
        if confirmed {
            assert_eq!(first, Ok(S::Tombstoned));
            continue;
        }
        assert_eq!(first, Err(E::NotDrained), "{work:?} {leases:?}");
        assert_eq!(f.snapshot(), before);
        let retry = f.repo.complete_quiesce(&f.handle, full, TOMBSTONE, at);
        assert_eq!(retry, Ok(S::Tombstoned));
    }
}

#[test]
fn quiesce_to_close_leaves_no_deadline_and_tombstone_sets_one() {
    use RepositoryState as S;
    let mut closed = reach(S::Quiescing);
    closed.finish_quiesce(CLOSE);
    let snapshot = closed.snapshot();
    assert_eq!(snapshot.state, S::Closed);
    assert_eq!(snapshot.tombstone_deadline, None);

    let mut tomb = reach(S::Quiescing);
    tomb.finish_quiesce(TOMBSTONE);
    let snapshot = tomb.snapshot();
    assert_eq!(snapshot.tombstone_deadline, Some(t(tomb.now + RETENTION)));
}

fn tombstoned() -> (Fixture, u64) {
    let f = reach(RepositoryState::Tombstoned);
    let deadline = f.snapshot().tombstone_deadline.unwrap().0;
    assert_eq!(deadline, f.now + RETENTION);
    (f, deadline)
}

#[test]
fn restore_boundary_is_exclusive_and_rejections_keep_authority() {
    use RepositoryError as E;
    use RepositoryState as S;
    let (mut f, deadline) = tombstoned();
    let generation = f.generation();
    let before = f.snapshot();
    let late = f.repo.restore(generation, recovery(), t(deadline));
    assert_eq!(late, Err(E::RetentionExpired));
    let early_purge = f.repo.begin_purge(generation, purge(), t(deadline - 1));
    assert_eq!(early_purge.err(), Some(E::RetentionActive));
    assert_eq!(f.snapshot(), before);
    // Rejections did not advance last_seen, so an earlier valid time still works.
    let ok = f.repo.restore(generation, recovery(), t(deadline - 1));
    assert_eq!(ok, Ok(S::Closed));
    let after = f.snapshot();
    assert_eq!(after.tombstone_deadline, None);
    assert_eq!(after.recovery_reference, Some(RECOVERY_REF));
    assert_eq!(after.purge_reference, None);
    let next = f.repo.admit(t(deadline), WorkKind::Read);
    assert_eq!(next, Err(E::NotReady));
}

#[test]
fn purge_boundary_is_inclusive_and_records_the_assertion() {
    use RepositoryError as E;
    use RepositoryState as S;
    let (mut f, deadline) = tombstoned();
    let generation = f.generation();
    let before = f.snapshot();
    let early = f.repo.begin_purge(generation, purge(), t(deadline - 1));
    assert_eq!(early.err(), Some(E::RetentionActive));
    assert_eq!(f.snapshot(), before);
    let handle = f.repo.begin_purge(generation, purge(), t(deadline));
    f.handle = handle.unwrap();
    let after = f.snapshot();
    assert_eq!(after.state, S::Deleting);
    assert_eq!(after.tombstone_deadline, None);
    assert_eq!(after.purge_reference, Some(PURGE_REF));
    assert_eq!(f.handle.generation(), after.generation);
    let late = f.repo.restore(after.generation, recovery(), t(deadline));
    assert_eq!(late, Err(E::InvalidState));
}

#[test]
fn restore_needs_revalidation_before_work() {
    use RepositoryError as E;
    let mut f = reach(RepositoryState::Tombstoned);
    f.restore();
    assert_eq!(f.snapshot().state, RepositoryState::Closed);
    assert_eq!(admit(&mut f, WorkKind::Read), Err(E::NotReady));
    f.open(RW);
    assert_eq!(admit(&mut f, WorkKind::Write), Ok(()));
}

#[test]
fn purge_failure_can_retry_and_success_retires_everything() {
    use RepositoryError as E;
    use RepositoryState as S;
    let mut f = reach(S::Failed);
    f.begin_purge();
    f.finish_purge(DeletionOutcome::Failed);
    assert_eq!(f.snapshot().state, S::Failed);
    assert_eq!(f.snapshot().retirement, Retirement::Live);
    f.begin_purge();
    let old = f.handle.generation();
    let at = f.tick();
    let done = f.repo.complete_purge(&f.handle, DELETED, at);
    assert_eq!(done, Ok(S::Deleting));
    let retired = f.snapshot();
    assert_eq!(retired.retirement, Retirement::Retired);
    assert_eq!(retired.state, S::Deleting);
    assert_eq!(retired.purge_reference, Some(PURGE_REF));
    assert!(retired.generation > old);

    let generation = retired.generation;
    let stale = Generation::new(generation.get() + 1);
    let at = f.tick();
    let results = [
        f.repo.begin_open(generation, RW, at).err(),
        f.repo.begin_quiesce(generation, at).err(),
        f.repo.begin_purge(generation, purge(), at).err(),
        f.repo.restore(generation, recovery(), at).err(),
        f.repo.admit(at, WorkKind::Read).err(),
    ];
    for result in results {
        assert_eq!(result, Some(E::Retired));
    }
    let stale_cas = f.repo.begin_open(stale, RW, at);
    assert_eq!(stale_cas.err(), Some(E::StaleGeneration));
    let replay = f.repo.complete_purge(&f.handle, DELETED, at);
    assert_eq!(replay, Err(E::StaleHandle));
    assert_eq!(f.snapshot(), retired);
}

// ------------------------------------------------- rejection order and bounds

#[test]
fn rejection_order_is_time_then_generation_then_state() {
    use RepositoryError as E;
    let mut f = reach(RepositoryState::Opening);
    let before = f.snapshot();
    let current = f.generation();
    let stale = Generation::new(current.get() + 1);
    let early = t(f.now - 1);
    let late = t(f.now + 1);
    let time = f.repo.begin_open(stale, RW, early);
    assert_eq!(time.err(), Some(E::TimeRegression));
    let generation = f.repo.begin_open(stale, RW, late);
    assert_eq!(generation.err(), Some(E::StaleGeneration));
    let state = f.repo.begin_open(current, RW, late);
    assert_eq!(state.err(), Some(E::InvalidState));
    assert_eq!(f.snapshot(), before);
}

#[test]
fn time_regression_keeps_the_handle_usable_and_equal_time_is_accepted() {
    let mut f = reach(RepositoryState::Opening);
    let before = f.snapshot();
    let regressed = t(f.now - 1);
    let result = f.repo.complete_open(&f.handle, PASSED, regressed);
    assert_eq!(result, Err(RepositoryError::TimeRegression));
    assert_eq!(f.snapshot(), before);
    let result = f.repo.complete_open(&f.handle, PASSED, t(f.now));
    assert_eq!(result, Ok(RepositoryState::ReadyReadWrite));
}

#[test]
fn time_overflow_boundary_is_exact_and_atomic() {
    use RepositoryError as E;
    use RepositoryState as S;
    let drain = drained();
    let mut f = reach(S::Quiescing);
    let before = f.snapshot();
    let over = t(u64::MAX - RETENTION + 1);
    let result = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, over);
    assert_eq!(result, Err(E::TimeOverflow));
    assert_eq!(f.snapshot(), before);
    // The rejected call did not advance last_seen; the edge time still works.
    let edge = t(u64::MAX - RETENTION);
    let result = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, edge);
    assert_eq!(result, Ok(S::Tombstoned));
    assert_eq!(f.snapshot().tombstone_deadline, Some(t(u64::MAX)));
    let generation = f.generation();
    let purge = f.repo.begin_purge(generation, purge(), t(u64::MAX));
    assert!(purge.is_ok());

    let mut close = reach(S::Quiescing);
    let max = t(u64::MAX);
    let handle = &close.handle;
    let result = close.repo.complete_quiesce(handle, drain, CLOSE, max);
    assert_eq!(result, Ok(S::Closed));
    assert_eq!(close.snapshot().last_seen, max);
}

#[test]
fn generation_exhaustion_is_checked_and_atomic() {
    use RepositoryError as E;
    let mut f = Fixture::with_limits(RETENTION, 3);
    f.provisioned(PASSED);
    f.begin_open(RW);
    let before = f.snapshot();
    assert_eq!(before.generation.get(), 3);
    let at = f.tick();
    for _ in 0..2 {
        let result = f.repo.complete_open(&f.handle, PASSED, at);
        assert_eq!(result, Err(E::GenerationExhausted));
        assert_eq!(f.snapshot(), before);
    }
    let generation = f.generation();
    let state_first = f.repo.begin_open(generation, RW, at);
    assert_eq!(state_first.err(), Some(E::InvalidState));

    let mut single = Fixture::with_limits(RETENTION, 1);
    let at = single.tick();
    let handle = &single.handle;
    let result = single.repo.complete_provisioning(handle, PASSED, at);
    assert_eq!(result, Err(E::GenerationExhausted));
    assert_eq!(single.snapshot().generation.get(), 1);
}

#[test]
fn exhaustion_comes_after_state_drain_and_handle_checks_but_before_overflow() {
    use RepositoryError as E;
    let drain = drained();
    let mut f = Fixture::with_limits(RETENTION, 5);
    f.provisioned(PASSED);
    f.open(RW);
    f.begin_quiesce();
    assert_eq!(f.generation().get(), 5);
    let before = f.snapshot();
    let far = t(u64::MAX);
    let at = t(f.now + 1);
    let pending = DrainConfirmation::new(WorkDrain::InFlight, LeaseStatus::NoActiveLeases);
    let undrained = f.repo.complete_quiesce(&f.handle, pending, TOMBSTONE, far);
    assert_eq!(undrained, Err(E::NotDrained));
    let exhausted = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, far);
    assert_eq!(exhausted, Err(E::GenerationExhausted));
    let regressed = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, t(1));
    assert_eq!(regressed, Err(E::TimeRegression));
    let (_twin, foreign) = Repository::provision(id("repo-1"), limits(1, 1), t(0));
    let forged = f.repo.complete_quiesce(&foreign, drain, TOMBSTONE, at);
    assert_eq!(forged, Err(E::StaleHandle));
    let plain = f.repo.complete_quiesce(&f.handle, drain, CLOSE, at);
    assert_eq!(plain, Err(E::GenerationExhausted));
    assert_eq!(f.snapshot(), before);
}

#[test]
fn generation_compare_and_swap_rejects_stale_values() {
    let mut f = reach(RepositoryState::Closed);
    let current = f.generation();
    let before = f.snapshot();
    let at = f.tick();
    let behind = Generation::new(current.get() - 1);
    let ahead = Generation::new(current.get() + 1);
    for expected in [behind, ahead] {
        let result = f.repo.begin_open(expected, RW, at);
        assert_eq!(result.err(), Some(RepositoryError::StaleGeneration));
    }
    assert_eq!(f.snapshot(), before);
    let handle = f.repo.begin_open(current, RW, at).unwrap();
    assert_eq!(handle.generation().get(), current.get() + 1);
    assert_eq!(handle.generation(), f.generation());
}

// ------------------------------------------------------------- handle binding

#[test]
fn twin_repositories_with_identical_ids_cannot_complete_each_other() {
    use RepositoryError as E;
    use RepositoryState as S;
    let shared = limits(RETENTION, MAX_GENERATION);
    let (mut a, ha) = Repository::provision(id("same"), shared, t(0));
    let (mut b, hb) = Repository::provision(id("same"), shared, t(0));
    assert_eq!(a.snapshot(), b.snapshot());
    assert_eq!(ha.generation(), hb.generation());
    let before = b.snapshot();
    let forged = b.complete_provisioning(&ha, PASSED, t(1));
    assert_eq!(forged, Err(E::StaleHandle));
    assert_eq!(b.snapshot(), before);
    let done = a.complete_provisioning(&ha, PASSED, t(1));
    assert_eq!(done, Ok(S::Closed));
    let forged = b.complete_provisioning(&ha, PASSED, t(2));
    assert_eq!(forged, Err(E::StaleHandle));
    let own = b.complete_provisioning(&hb, PASSED, t(2));
    assert_eq!(own, Ok(S::Closed));

    let generation_a = a.snapshot().generation;
    let generation_b = b.snapshot().generation;
    assert_eq!(generation_a, generation_b);
    let open_a = a.begin_open(generation_a, RW, t(3)).unwrap();
    let open_b = b.begin_open(generation_b, RW, t(3)).unwrap();
    assert_eq!(a.snapshot(), b.snapshot());
    let forged = b.complete_open(&open_a, PASSED, t(4));
    assert_eq!(forged, Err(E::StaleHandle));
    let forged = a.complete_open(&open_b, PASSED, t(4));
    assert_eq!(forged, Err(E::StaleHandle));
    let done_a = a.complete_open(&open_a, PASSED, t(4));
    let done_b = b.complete_open(&open_b, PASSED, t(4));
    assert_eq!(done_a, Ok(S::ReadyReadWrite));
    assert_eq!(done_b, Ok(S::ReadyReadWrite));
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn a_completed_handle_cannot_be_replayed_or_reused_later() {
    use RepositoryError as E;
    let mut f = Fixture::new();
    let first = f.repo.complete_provisioning(&f.handle, PASSED, t(1));
    assert_eq!(first, Ok(RepositoryState::Closed));
    let after = f.snapshot();
    let replay = f.repo.complete_provisioning(&f.handle, PASSED, t(2));
    assert_eq!(replay, Err(E::StaleHandle));
    assert_eq!(f.snapshot(), after);
    f.now = 1;
    f.open(RW);
    let late = f.repo.complete_provisioning(&f.handle, PASSED, t(9));
    assert_eq!(late, Err(E::StaleHandle));
}

#[test]
fn a_handle_from_another_operation_binds_only_its_own_generation() {
    use RepositoryError as E;
    let drain = drained();
    let mut f = reach(RepositoryState::Opening);
    let before = f.snapshot();
    let at = t(f.now + 1);
    let wrong = f.repo.complete_quiesce(&f.handle, drain, TOMBSTONE, at);
    assert_eq!(wrong, Err(E::InvalidState));
    assert_eq!(f.snapshot(), before);
    let right = f.repo.complete_open(&f.handle, PASSED, at);
    assert_eq!(right, Ok(RepositoryState::ReadyReadWrite));
}

// Compile-time proof that authority types are not Clone: for a Clone type both
// blanket impls apply and the probe path becomes ambiguous.
trait AmbiguousIfClone<A> {
    fn probe() {}
}

impl<T: ?Sized> AmbiguousIfClone<()> for T {}

impl<T: ?Sized + Clone> AmbiguousIfClone<u8> for T {}

fn assert_send<T: Send>() {}

fn assert_clone<T: Clone>() {}

#[test]
fn authority_types_are_send_not_clone_and_snapshots_are_plain_data() {
    let _ = <Repository as AmbiguousIfClone<_>>::probe;
    let _ = <TransitionHandle as AmbiguousIfClone<_>>::probe;
    assert_send::<Repository>();
    assert_send::<TransitionHandle>();
    assert_send::<RepositorySnapshot>();
    assert_clone::<RepositorySnapshot>();
    assert_clone::<RepositoryLimits>();
}

// ------------------------------------------------------------- trace consumer

const SEEDS: u64 = 256;
const STEPS: usize = 64;
const MAX_PASSES: usize = 64;
const TRACE_RETENTION: u64 = 10;
const COMMAND: &str = "cargo test -p oxigraph-cli --test repository_lifecycle";

#[derive(Clone, Copy, Debug)]
struct Cfg {
    retention: u64,
    max_generation: u64,
}

fn config(seed: u64) -> Cfg {
    Cfg {
        retention: TRACE_RETENTION,
        max_generation: 8 + seed % 24,
    }
}

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

    fn byte(&mut self, bound: u64) -> u8 {
        u8::try_from(self.below(bound)).unwrap()
    }
}

#[derive(Clone, Copy, Debug)]
enum Act {
    BeginOpen(OpenMode),
    BeginQuiesce,
    Restore(u8),
    BeginPurge(u8),
    CompleteProvisioning(ValidationOutcome),
    CompleteOpen(ValidationOutcome),
    CompleteQuiesce { drain: u8, target: QuiesceTarget },
    CompletePurge(DeletionOutcome),
    Admit(WorkKind),
}

impl Act {
    fn kind(self) -> &'static str {
        match self {
            Self::BeginOpen(_) => "begin-open",
            Self::BeginQuiesce => "begin-quiesce",
            Self::Restore(_) => "restore",
            Self::BeginPurge(_) => "begin-purge",
            Self::CompleteProvisioning(_) => "complete-provisioning",
            Self::CompleteOpen(_) => "complete-open",
            Self::CompleteQuiesce { .. } => "complete-quiesce",
            Self::CompletePurge(_) => "complete-purge",
            Self::Admit(_) => "admit",
        }
    }

    fn transitions(self) -> bool {
        !matches!(self, Self::Admit(_))
    }
}

#[derive(Clone, Copy, Debug)]
struct Step {
    at: u64,
    fresh: bool,
    foreign: bool,
    act: Act,
}

fn drain_of(index: u8) -> DrainConfirmation {
    let (work, leases) = match index {
        0 => (WorkDrain::Drained, LeaseStatus::NoActiveLeases),
        1 => (WorkDrain::Drained, LeaseStatus::ActiveLeases),
        2 => (WorkDrain::InFlight, LeaseStatus::NoActiveLeases),
        _ => (WorkDrain::InFlight, LeaseStatus::ActiveLeases),
    };
    DrainConfirmation::new(work, leases)
}

// The oracle shares no code with the model: separate state type, u128
// arithmetic and one explicit rule per (action, state) pair.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Sx {
    Prov,
    Closed,
    Opening(bool),
    Rw,
    Ro,
    Quiescing,
    Tomb(u128),
    Deleting,
    Failed,
    Bad,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Fault {
    Exact,
    RetentionOffByOne,
    StaleGenerationAccepted,
    DrainSkipped,
    AdmitSkipsTime,
}

#[derive(Debug, Eq, PartialEq)]
struct View {
    sx: Sx,
    generation: u128,
    last: u128,
    retired: bool,
    recovery: Option<[u8; 16]>,
    purge: Option<[u8; 16]>,
}

fn view_of(s: &RepositorySnapshot) -> View {
    use RepositoryState as R;
    let sx = match (s.state, s.pending_open, s.tombstone_deadline) {
        (R::Provisioning, None, None) => Sx::Prov,
        (R::Closed, None, None) => Sx::Closed,
        (R::Opening, Some(mode), None) => Sx::Opening(mode == OpenMode::ReadOnly),
        (R::ReadyReadWrite, None, None) => Sx::Rw,
        (R::ReadyReadOnly, None, None) => Sx::Ro,
        (R::Quiescing, None, None) => Sx::Quiescing,
        (R::Tombstoned, None, Some(deadline)) => Sx::Tomb(u128::from(deadline.0)),
        (R::Deleting, None, None) => Sx::Deleting,
        (R::Failed, None, None) => Sx::Failed,
        _ => Sx::Bad,
    };
    View {
        sx,
        generation: u128::from(s.generation.get()),
        last: u128::from(s.last_seen.0),
        retired: s.retirement == Retirement::Retired,
        recovery: s.recovery_reference,
        purge: s.purge_reference,
    }
}

struct Oracle {
    sx: Sx,
    generation: u128,
    handle: u128,
    last: u128,
    retired: bool,
    recovery: Option<[u8; 16]>,
    purge: Option<[u8; 16]>,
    retention: u128,
    max: u128,
    fault: Fault,
}

impl Oracle {
    fn new(cfg: Cfg, fault: Fault) -> Self {
        Self {
            sx: Sx::Prov,
            generation: 1,
            handle: 1,
            last: 0,
            retired: false,
            recovery: None,
            purge: None,
            retention: u128::from(cfg.retention),
            max: u128::from(cfg.max_generation),
            fault,
        }
    }

    fn view(&self) -> View {
        View {
            sx: self.sx,
            generation: self.generation,
            last: self.last,
            retired: self.retired,
            recovery: self.recovery,
            purge: self.purge,
        }
    }

    fn expired(&self, now: u128, deadline: u128) -> bool {
        if self.fault == Fault::RetentionOffByOne {
            now > deadline
        } else {
            now >= deadline
        }
    }

    fn bump(&self) -> Result<u128, RepositoryError> {
        if self.generation + 1 > self.max {
            Err(RepositoryError::GenerationExhausted)
        } else {
            Ok(self.generation + 1)
        }
    }

    fn go(&mut self, now: u128, generation: u128, sx: Sx) {
        self.generation = generation;
        self.last = now;
        self.sx = sx;
    }

    fn issue(&mut self, now: u128, generation: u128, sx: Sx) {
        self.go(now, generation, sx);
        self.handle = generation;
    }

    fn start_purge(&mut self, now: u128, reference: u8) -> Attempt {
        let generation = self.bump()?;
        self.issue(now, generation, Sx::Deleting);
        self.purge = Some([reference; 16]);
        Ok(())
    }

    fn apply(&mut self, step: &Step) -> Attempt {
        use RepositoryError as E;
        if matches!(step.act, Act::Restore(0) | Act::BeginPurge(0)) {
            return Err(E::InvalidAssertion);
        }
        let now = u128::from(step.at);
        if now < self.last {
            return Err(E::TimeRegression);
        }
        match step.act {
            Act::Admit(_) => {}
            Act::CompleteProvisioning(_)
            | Act::CompleteOpen(_)
            | Act::CompleteQuiesce { .. }
            | Act::CompletePurge(_) => {
                if step.foreign || self.handle != self.generation {
                    return Err(E::StaleHandle);
                }
            }
            _ => {
                if !step.fresh && self.fault != Fault::StaleGenerationAccepted {
                    return Err(E::StaleGeneration);
                }
            }
        }
        if self.retired {
            return Err(E::Retired);
        }
        match (step.act, self.sx) {
            (Act::Admit(kind), sx) => {
                match (sx, kind) {
                    (Sx::Rw, _) | (Sx::Ro, WorkKind::Read) => {}
                    (Sx::Ro, WorkKind::Write) => return Err(E::ReadOnly),
                    (Sx::Quiescing, _) => return Err(E::Quiescing),
                    _ => return Err(E::NotReady),
                }
                if self.fault != Fault::AdmitSkipsTime {
                    self.last = now;
                }
                Ok(())
            }
            (Act::BeginOpen(mode), Sx::Closed) => {
                let generation = self.bump()?;
                self.issue(now, generation, Sx::Opening(mode == OpenMode::ReadOnly));
                Ok(())
            }
            (Act::BeginQuiesce, Sx::Closed | Sx::Rw | Sx::Ro) => {
                let generation = self.bump()?;
                self.issue(now, generation, Sx::Quiescing);
                Ok(())
            }
            (Act::Restore(reference), Sx::Tomb(deadline)) => {
                if self.expired(now, deadline) {
                    return Err(E::RetentionExpired);
                }
                let generation = self.bump()?;
                self.go(now, generation, Sx::Closed);
                self.recovery = Some([reference; 16]);
                Ok(())
            }
            (Act::BeginPurge(reference), Sx::Tomb(deadline)) => {
                if !self.expired(now, deadline) {
                    return Err(E::RetentionActive);
                }
                self.start_purge(now, reference)
            }
            (Act::BeginPurge(reference), Sx::Failed) => self.start_purge(now, reference),
            (Act::CompleteProvisioning(outcome), Sx::Prov) => {
                let generation = self.bump()?;
                let sx = if outcome == ValidationOutcome::Passed {
                    Sx::Closed
                } else {
                    Sx::Failed
                };
                self.go(now, generation, sx);
                Ok(())
            }
            (Act::CompleteOpen(outcome), Sx::Opening(read_only)) => {
                let generation = self.bump()?;
                let sx = match (outcome, read_only) {
                    (ValidationOutcome::Failed, _) => Sx::Failed,
                    (ValidationOutcome::Passed, true) => Sx::Ro,
                    (ValidationOutcome::Passed, false) => Sx::Rw,
                };
                self.go(now, generation, sx);
                Ok(())
            }
            (Act::CompleteQuiesce { drain, target }, Sx::Quiescing) => {
                if drain != 0 && self.fault != Fault::DrainSkipped {
                    return Err(E::NotDrained);
                }
                let generation = self.bump()?;
                match target {
                    QuiesceTarget::Close => self.go(now, generation, Sx::Closed),
                    QuiesceTarget::Tombstone => {
                        let deadline = now + self.retention;
                        if deadline > u128::from(u64::MAX) {
                            return Err(E::TimeOverflow);
                        }
                        self.go(now, generation, Sx::Tomb(deadline));
                    }
                }
                Ok(())
            }
            (Act::CompletePurge(outcome), Sx::Deleting) => {
                let generation = self.bump()?;
                if outcome == DeletionOutcome::Deleted {
                    self.retired = true;
                    self.go(now, generation, Sx::Deleting);
                } else {
                    self.go(now, generation, Sx::Failed);
                }
                Ok(())
            }
            _ => Err(E::InvalidState),
        }
    }
}

struct Harness {
    repo: Repository,
    current: TransitionHandle,
    foreign: TransitionHandle,
}

impl Harness {
    fn new(cfg: Cfg) -> Self {
        let bounds = limits(cfg.retention, cfg.max_generation);
        let (repo, current) = Repository::provision(id("trace-1"), bounds, t(0));
        let (_twin, foreign) = Repository::provision(id("trace-1"), bounds, t(0));
        Self {
            repo,
            current,
            foreign,
        }
    }

    fn run(&mut self, step: &Step) -> Attempt {
        let at = t(step.at);
        let generation = self.repo.snapshot().generation;
        let expected = if step.fresh {
            generation
        } else {
            Generation::new(generation.get().wrapping_add(1000))
        };
        let handle = if step.foreign {
            &self.foreign
        } else {
            &self.current
        };
        match step.act {
            Act::BeginOpen(mode) => {
                self.current = self.repo.begin_open(expected, mode, at)?;
            }
            Act::BeginQuiesce => {
                self.current = self.repo.begin_quiesce(expected, at)?;
            }
            Act::Restore(reference) => {
                let assertion = RecoveryAssertion::caller_asserted([reference; 16])?;
                self.repo.restore(expected, assertion, at)?;
            }
            Act::BeginPurge(reference) => {
                let assertion = PurgeAssertion::caller_asserted([reference; 16])?;
                self.current = self.repo.begin_purge(expected, assertion, at)?;
            }
            Act::CompleteProvisioning(outcome) => {
                self.repo.complete_provisioning(handle, outcome, at)?;
            }
            Act::CompleteOpen(outcome) => {
                self.repo.complete_open(handle, outcome, at)?;
            }
            Act::CompleteQuiesce { drain, target } => {
                let drain = drain_of(drain);
                self.repo.complete_quiesce(handle, drain, target, at)?;
            }
            Act::CompletePurge(outcome) => {
                self.repo.complete_purge(handle, outcome, at)?;
            }
            Act::Admit(kind) => {
                self.repo.admit(at, kind)?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Category {
    ResultMismatch,
    StateMismatch,
    InvariantViolation,
}

#[derive(Debug)]
struct Failure {
    index: usize,
    category: Category,
    message: String,
}

fn invariants(
    prev: &RepositorySnapshot,
    now: &RepositorySnapshot,
    got: Attempt,
    transition: bool,
    at: u64,
    max_generation: u64,
) -> Option<&'static str> {
    if got.is_err() {
        let changed = now != prev;
        return changed.then_some("rejected call changed the snapshot");
    }
    if prev.retirement == Retirement::Retired {
        return Some("retired repository accepted a call");
    }
    if now.last_seen != LogicalTime(at) {
        return Some("accepted call did not record its time");
    }
    let bump = u64::from(transition);
    let expected = prev.generation.get().saturating_add(bump);
    if now.generation.get() != expected {
        return Some("generation changed other than once per transition");
    }
    if now.generation.get() > max_generation {
        return Some("generation exceeded its limit");
    }
    let same = now.state == prev.state && now.tombstone_deadline == prev.tombstone_deadline;
    if !transition && !same {
        return Some("admission changed the lifecycle state");
    }
    None
}

fn count(counts: &mut Counts, key: impl Into<String>) {
    *counts.entry(key.into()).or_default() += 1;
}

fn merge(total: &mut Counts, other: &Counts) {
    for (key, value) in other {
        *total.entry(key.clone()).or_default() += value;
    }
}

fn record(
    counts: &mut Counts,
    step: &Step,
    got: Attempt,
    prev: &RepositorySnapshot,
    now: &RepositorySnapshot,
) {
    match got {
        Ok(()) => count(counts, format!("ok:{}", step.act.kind())),
        Err(error) => count(counts, format!("{error:?}")),
    }
    if prev.retirement != now.retirement {
        count(counts, "retired");
    }
}

fn fail(index: usize, category: Category, message: String) -> Failure {
    Failure {
        index,
        category,
        message,
    }
}

fn replay(steps: &[Step], cfg: Cfg, fault: Fault) -> Result<Counts, Failure> {
    let mut harness = Harness::new(cfg);
    let mut oracle = Oracle::new(cfg, fault);
    let mut counts = Counts::new();
    let mut prev = harness.repo.snapshot();
    for (index, step) in steps.iter().enumerate() {
        let expected = oracle.apply(step);
        let got = harness.run(step);
        if got != expected {
            let message = format!("{:?}: model {got:?}, oracle {expected:?}", step.act);
            return Err(fail(index, Category::ResultMismatch, message));
        }
        let now = harness.repo.snapshot();
        let (model, predicted) = (view_of(&now), oracle.view());
        if model != predicted {
            let message = format!("model {model:?} != oracle {predicted:?}");
            return Err(fail(index, Category::StateMismatch, message));
        }
        let checked = invariants(
            &prev,
            &now,
            got,
            step.act.transitions(),
            step.at,
            cfg.max_generation,
        );
        if let Some(reason) = checked {
            let message = reason.to_owned();
            return Err(fail(index, Category::InvariantViolation, message));
        }
        record(&mut counts, step, got, &prev, &now);
        prev = now;
    }
    Ok(counts)
}

fn category_of(steps: &[Step], cfg: Cfg, fault: Fault) -> Option<Category> {
    replay(steps, cfg, fault).err().map(|f| f.category)
}

/// Bounded greedy deletion. A candidate is kept only if it still fails in the
/// same category, so a shrunk trace cannot silently change what it proves.
fn shrink<T: Clone, C: Copy + PartialEq>(
    steps: Vec<T>,
    category: C,
    fails: &impl Fn(&[T]) -> Option<C>,
) -> Vec<T> {
    let mut current = steps;
    for _ in 0..MAX_PASSES {
        let mut progressed = false;
        let mut index = 0;
        while index < current.len() {
            let mut candidate = current.clone();
            candidate.remove(index);
            if fails(&candidate) == Some(category) {
                current = candidate;
                progressed = true;
            } else {
                index += 1;
            }
        }
        if !progressed {
            break;
        }
    }
    current
}

fn next_time(rng: &mut Rng, clock: &mut u64) -> u64 {
    if rng.below(12) == 0 {
        return clock.saturating_sub(1 + rng.below(3));
    }
    let bound = if rng.below(16) == 0 { 30 } else { 4 };
    *clock += rng.below(bound);
    *clock
}

fn validation(rng: &mut Rng) -> ValidationOutcome {
    if rng.below(10) == 0 {
        ValidationOutcome::Failed
    } else {
        ValidationOutcome::Passed
    }
}

fn mode(rng: &mut Rng) -> OpenMode {
    if rng.below(3) == 0 { RO } else { RW }
}

fn work(rng: &mut Rng) -> WorkKind {
    if rng.below(2) == 0 {
        WorkKind::Read
    } else {
        WorkKind::Write
    }
}

fn target(rng: &mut Rng) -> QuiesceTarget {
    if rng.below(2) == 0 {
        QuiesceTarget::Close
    } else {
        QuiesceTarget::Tombstone
    }
}

fn deletion(rng: &mut Rng) -> DeletionOutcome {
    if rng.below(4) == 0 {
        DeletionOutcome::Failed
    } else {
        DeletionOutcome::Deleted
    }
}

fn reference(rng: &mut Rng) -> u8 {
    rng.byte(6)
}

fn natural(rng: &mut Rng, sx: Sx) -> Act {
    match sx {
        Sx::Prov => Act::CompleteProvisioning(validation(rng)),
        Sx::Closed => {
            if rng.below(4) == 0 {
                Act::BeginQuiesce
            } else {
                Act::BeginOpen(mode(rng))
            }
        }
        Sx::Opening(_) => Act::CompleteOpen(validation(rng)),
        Sx::Rw | Sx::Ro => {
            if rng.below(6) == 0 {
                Act::BeginQuiesce
            } else {
                Act::Admit(work(rng))
            }
        }
        Sx::Quiescing => {
            if rng.below(8) == 0 {
                return Act::Admit(work(rng));
            }
            let stale = rng.below(4) == 0;
            let drain = if stale { 1 + rng.byte(3) } else { 0 };
            Act::CompleteQuiesce {
                drain,
                target: target(rng),
            }
        }
        Sx::Tomb(_) => {
            if rng.below(5) < 3 {
                Act::Restore(reference(rng))
            } else {
                Act::BeginPurge(reference(rng))
            }
        }
        Sx::Deleting => Act::CompletePurge(deletion(rng)),
        Sx::Failed => Act::BeginPurge(reference(rng)),
        Sx::Bad => Act::Admit(WorkKind::Read),
    }
}

fn random_act(rng: &mut Rng) -> Act {
    match rng.below(9) {
        0 => Act::BeginOpen(mode(rng)),
        1 => Act::BeginQuiesce,
        2 => Act::Restore(reference(rng)),
        3 => Act::BeginPurge(reference(rng)),
        4 => Act::CompleteProvisioning(validation(rng)),
        5 => Act::CompleteOpen(validation(rng)),
        6 => Act::CompleteQuiesce {
            drain: rng.byte(4),
            target: target(rng),
        },
        7 => Act::CompletePurge(deletion(rng)),
        _ => Act::Admit(work(rng)),
    }
}

// Steered by the exact oracle so most traces walk the lifecycle, while a
// share of random actions and stale inputs keeps every rejection reachable.
fn next_step(rng: &mut Rng, clock: &mut u64, oracle: &Oracle) -> Step {
    let mut at = next_time(rng, clock);
    let act = if rng.below(10) < 7 {
        natural(rng, oracle.sx)
    } else {
        random_act(rng)
    };
    let fresh = rng.below(6) != 0;
    let foreign = rng.below(8) == 0;
    if let (Sx::Tomb(deadline), Act::Restore(_) | Act::BeginPurge(_)) = (oracle.sx, act) {
        if rng.below(3) != 0 {
            let edge = u64::try_from(deadline).unwrap() - rng.below(2);
            *clock = (*clock).max(edge);
            at = *clock;
        }
    }
    let overflowing = match act {
        Act::CompleteQuiesce { target, .. } => target == TOMBSTONE,
        _ => false,
    };
    if overflowing && rng.below(3) == 0 {
        at = u64::MAX - rng.below(TRACE_RETENTION);
    }
    Step {
        at,
        fresh,
        foreign,
        act,
    }
}

fn generate(seed: u64) -> Vec<Step> {
    let mut rng = Rng(seed);
    let mut oracle = Oracle::new(config(seed), Fault::Exact);
    let mut clock = 0_u64;
    let mut steps = Vec::with_capacity(STEPS);
    for _ in 0..STEPS {
        let step = next_step(&mut rng, &mut clock, &oracle);
        let _ = oracle.apply(&step);
        steps.push(step);
    }
    steps
}

fn seeds() -> Vec<u64> {
    let pinned = std::env::var("REPOSITORY_TRACE_SEED").ok();
    match pinned.and_then(|value| value.parse().ok()) {
        Some(seed) => vec![seed],
        None => (0..SEEDS).collect(),
    }
}

fn report(seed: u64, cfg: Cfg, steps: &[Step], failure: &Failure) -> ! {
    let fails = |candidate: &[Step]| category_of(candidate, cfg, Fault::Exact);
    let minimal = shrink(steps.to_vec(), failure.category, &fails);
    let index = failure.index;
    let category = failure.category;
    let reason = &failure.message;
    let count = minimal.len();
    let header = format!("seed={seed} step={index} {category:?}: {reason}");
    let trace = format!("minimal ({count} steps): {minimal:#?}");
    let hint = format!("REPOSITORY_TRACE_SEED={seed} {COMMAND}");
    panic!("repository trace failed: {header}\n{trace}\n{hint}");
}

const REQUIRED: [&str; 20] = [
    "ok:restore",
    "ok:begin-purge",
    "ok:complete-purge",
    "ok:complete-quiesce",
    "ok:admit",
    "retired",
    "GenerationExhausted",
    "TimeOverflow",
    "NotDrained",
    "RetentionExpired",
    "RetentionActive",
    "StaleHandle",
    "StaleGeneration",
    "TimeRegression",
    "InvalidAssertion",
    "ReadOnly",
    "Quiescing",
    "NotReady",
    "Retired",
    "InvalidState",
];

#[test]
fn seeded_traces_agree_with_the_independent_oracle() {
    let selected = seeds();
    let full = selected.len() == usize::try_from(SEEDS).unwrap();
    let mut total = Counts::new();
    for seed in selected {
        let steps = generate(seed);
        let cfg = config(seed);
        match replay(&steps, cfg, Fault::Exact) {
            Ok(counts) => merge(&mut total, &counts),
            Err(failure) => report(seed, cfg, &steps, &failure),
        }
    }
    if full {
        for key in REQUIRED {
            let seen = total.get(key).copied().unwrap_or(0);
            assert!(seen > 0, "no trace exercised {key}: {total:?}");
        }
    }
}

#[test]
fn trace_generation_is_deterministic() {
    let first = format!("{:?}", generate(42));
    assert_eq!(first, format!("{:?}", generate(42)));
    assert_ne!(first, format!("{:?}", generate(43)));
    assert_eq!(generate(7).len(), STEPS);
}

const FAULTS: [(Fault, Category); 4] = [
    (Fault::RetentionOffByOne, Category::ResultMismatch),
    (Fault::StaleGenerationAccepted, Category::ResultMismatch),
    (Fault::DrainSkipped, Category::ResultMismatch),
    (Fault::AdmitSkipsTime, Category::StateMismatch),
];

fn first_detection(fault: Fault) -> Option<(u64, Vec<Step>, Category)> {
    (0..SEEDS).find_map(|seed| {
        let steps = generate(seed);
        let failure = replay(&steps, config(seed), fault).err()?;
        Some((seed, steps, failure.category))
    })
}

#[test]
fn oracle_faults_are_detected_and_shrunk_to_small_same_category_traces() {
    for (fault, expected) in FAULTS {
        let found = first_detection(fault);
        let (seed, steps, category) = found.unwrap_or_else(|| panic!("{fault:?} undetected"));
        assert_eq!(category, expected, "{fault:?} seed {seed}");
        let cfg = config(seed);
        let fails = |candidate: &[Step]| category_of(candidate, cfg, fault);
        let minimal = shrink(steps, category, &fails);
        assert!(minimal.len() <= 10, "{fault:?} seed {seed}: {minimal:?}");
        assert_eq!(fails(&minimal), Some(category), "{fault:?}");
        let exact = replay(&minimal, cfg, Fault::Exact);
        assert!(exact.is_ok(), "{fault:?} {minimal:?}");
    }
}

fn snap() -> RepositorySnapshot {
    RepositorySnapshot {
        state: RepositoryState::Closed,
        generation: Generation::new(2),
        last_seen: t(5),
        pending_open: None,
        tombstone_deadline: None,
        retirement: Retirement::Live,
        recovery_reference: None,
        purge_reference: None,
    }
}

#[test]
fn invariant_checker_detects_each_violation_class() {
    let prev = snap();
    let rejected = Err(RepositoryError::NotReady);
    assert_eq!(invariants(&prev, &prev, rejected, false, 6, 10), None);

    let mut moved = snap();
    moved.last_seen = t(6);
    assert!(invariants(&prev, &moved, rejected, false, 6, 10).is_some());
    assert_eq!(invariants(&prev, &moved, Ok(()), false, 6, 10), None);
    assert!(invariants(&prev, &moved, Ok(()), false, 7, 10).is_some());

    let mut bumped = moved.clone();
    bumped.generation = Generation::new(3);
    assert!(invariants(&prev, &bumped, Ok(()), false, 6, 10).is_some());
    assert_eq!(invariants(&prev, &bumped, Ok(()), true, 6, 10), None);
    assert!(invariants(&prev, &bumped, Ok(()), true, 6, 2).is_some());

    let mut changed = moved.clone();
    changed.state = RepositoryState::ReadyReadWrite;
    assert!(invariants(&prev, &changed, Ok(()), false, 6, 10).is_some());

    let mut retired = snap();
    retired.retirement = Retirement::Retired;
    assert!(invariants(&retired, &moved, Ok(()), false, 6, 10).is_some());
}

#[test]
fn shrinker_keeps_only_candidates_that_fail_in_the_same_category() {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum Kind {
        Both,
        Only,
    }
    let fails = |candidate: &[u8]| {
        if candidate.contains(&5) && candidate.contains(&6) {
            Some(Kind::Both)
        } else if candidate.contains(&5) {
            Some(Kind::Only)
        } else {
            None
        }
    };
    let steps = vec![1, 5, 2, 6, 3, 4];
    assert_eq!(fails(&steps), Some(Kind::Both));
    assert_eq!(fails(&[5]), Some(Kind::Only));
    assert_eq!(shrink(steps, Kind::Both, &fails), vec![5, 6]);
}

#[test]
fn shrinker_reduces_a_synthetic_predicate_to_the_two_culprit_steps() {
    let mut steps: Vec<u8> = (0..40).map(|n| n % 5).collect();
    steps[6] = 3;
    steps[29] = 7;
    steps[12] = 7;
    steps[35] = 3;
    let fails = |candidate: &[u8]| {
        let hit = candidate
            .iter()
            .enumerate()
            .any(|(i, a)| *a == 3 && candidate[i + 1..].contains(&7));
        hit.then_some(())
    };
    assert!(fails(&steps).is_some());
    assert_eq!(shrink(steps, (), &fails), vec![3, 7]);
}
