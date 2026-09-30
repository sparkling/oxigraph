//! Private checkpoint tests of the analytical operator.
//!
//! Every counted `Control` checkpoint of planning, order search, relation
//! build and leapfrog search is interrupted in turn, and the stop is mapped
//! through the production `access_stop`, `stream_failure` and `conclude`.
//!
//! Cancellation is a real `CancellationToken::cancel` issued from inside the
//! checkpoint closure and observed through the production `alive` closure. A
//! deadline cannot be made to elapse at an exact checkpoint without a clock
//! seam, so deadline sweeps switch, at the counted checkpoint, from a live
//! production closure to the production closure over an already elapsed
//! deadline: a caller token built with `with_deadline`, or the analytical
//! wall-time deadline. They prove the typed mapping and the absence of
//! fallback at every checkpoint, not when a real clock would expire.
//!
//! An empty answer is exhausted by the first binding search before its stream
//! is returned. Its terminal poll observes one checkpoint, interrupted the same
//! way, and a later poll of the fused stream consults none.

#![expect(
    clippy::panic_in_result_fn,
    reason = "checkpoint assertions in fallible fixtures"
)]

use super::*;
use crate::model::{GraphName, NamedNode, Quad};
use crate::sparql::SparqlEvaluator;
use crate::store::EvaluationOutcome;
use std::cell::Cell;
use std::error::Error;
use std::rc::Rc;

type TestResult = Result<(), Box<dyn Error>>;
type StreamItem = Result<Vec<Option<Term>>, QueryEvaluationError>;
type Poll = Option<Result<QuerySolution, QueryEvaluationError>>;

const TRIANGLE: &str = "SELECT * WHERE { ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }";

/// Analytical, with an empty answer: the predicate occurs in no quad.
const EMPTY: &str = "SELECT * WHERE { ?a <urn:analytical-checkpoint:absent> ?b . ?b ?q ?c }";

// One triangle (three rotations), a dead-end path and a hub.
const EDGES: [(&str, &str, &str); 7] = [
    ("n1", "p1", "n2"),
    ("n2", "p2", "n3"),
    ("n3", "p3", "n1"),
    ("n1", "p1", "n4"),
    ("n4", "p2", "n5"),
    ("h", "s1", "l1"),
    ("h", "s2", "l2"),
];

fn node(name: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:analytical-checkpoint:{name}"))
}

fn load(store: &Store) -> Result<(), StorageError> {
    store.extend(EDGES.map(|(subject, predicate, object)| {
        Quad::new(
            node(subject),
            node(predicate),
            node(object),
            GraphName::DefaultGraph,
        )
    }))
}

fn on_backends(scenario: impl Fn(&str, &Store) -> TestResult) -> TestResult {
    let memory = Store::new()?;
    load(&memory)?;
    scenario("memory", &memory)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let directory = tempfile::TempDir::new()?;
        let native = Store::open(directory.path())?;
        load(&native)?;
        scenario("rocksdb", &native)?;
    }
    Ok(())
}

fn evaluator() -> SparqlEvaluator {
    #[cfg(feature = "rdf-12")]
    {
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2)
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        SparqlEvaluator::new()
    }
}

fn limits() -> Result<AnalyticalExecutionLimits, AnalyticalLimitsError> {
    AnalyticalExecutionLimits::new(
        16,
        8,
        4096,
        64 * 1024 * 1024,
        50_000_000,
        1_000_000,
        Duration::from_secs(3600),
    )
}

/// An instant that has already elapsed; monotonic, so never in the future.
fn past() -> Instant {
    Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(Instant::now)
}

fn standard_rows(store: &Store, prepared: &PreparedSparqlQuery) -> Result<u64, Box<dyn Error>> {
    let QueryResults::Solutions(solutions) = prepared.clone().on_store(store).execute()? else {
        return Err("solutions expected".into());
    };
    let mut rows = 0;
    for solution in solutions {
        solution?;
        rows += 1;
    }
    Ok(rows)
}

fn outcomes(store: &Store) -> [u64; 7] {
    let metrics = store.evaluation_metrics();
    EvaluationOutcome::ALL.map(|outcome| metrics.count(EvaluationOperation::Query, outcome))
}

/// Query outcomes observed since `before`.
fn delta(store: &Store, before: &[u64; 7]) -> Vec<(EvaluationOutcome, u64)> {
    let mut changed = Vec::new();
    for ((outcome, now), then) in EvaluationOutcome::ALL
        .into_iter()
        .zip(outcomes(store))
        .zip(before)
    {
        if now != *then {
            changed.push((outcome, now - then));
        }
    }
    changed
}

/// Consumes a result like a client would, stopping at the first error.
fn drain(result: Result<QueryResults<'_>, QueryEvaluationError>) {
    if let Ok(QueryResults::Solutions(solutions)) = result {
        for solution in solutions {
            if solution.is_err() {
                break;
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Mode {
    /// The caller's token is cancelled at the counted checkpoint.
    Cancel,
    /// The caller's token carries an elapsed deadline, observed from the
    /// counted checkpoint on.
    CallerDeadline,
    /// No caller token; the analytical wall-time deadline has elapsed and is
    /// observed from the counted checkpoint on.
    WallTime,
}

impl Mode {
    /// The token handed to the private operations, as `execute` hands over
    /// the prepared query's token.
    fn token(self) -> Option<CancellationToken> {
        match self {
            Self::Cancel => Some(CancellationToken::new()),
            Self::CallerDeadline => Some(CancellationToken::new().with_deadline(past())),
            Self::WallTime => None,
        }
    }

    fn reason(self) -> AnalyticalReason {
        match self {
            Self::Cancel => AnalyticalReason::Cancelled,
            Self::CallerDeadline => AnalyticalReason::TimedOut,
            Self::WallTime => AnalyticalReason::Budget(AnalyticalBudget::WallTime),
        }
    }

    fn outcome(self) -> EvaluationOutcome {
        match self {
            Self::Cancel => EvaluationOutcome::Cancelled,
            Self::CallerDeadline | Self::WallTime => EvaluationOutcome::TimedOut,
        }
    }

    fn is_expected(self, error: &QueryEvaluationError) -> bool {
        match self {
            Self::Cancel => matches!(error, QueryEvaluationError::Cancelled),
            Self::CallerDeadline | Self::WallTime => {
                matches!(error, QueryEvaluationError::TimedOut)
            }
        }
    }

    /// Production `alive` closures behind a checkpoint counter; checkpoint
    /// `at` is the first to observe the interruption.
    fn checkpoints(
        self,
        token: Option<&CancellationToken>,
        at: u64,
        calls: &Rc<Cell<u64>>,
    ) -> Alive {
        let calls = Rc::clone(calls);
        let mut live = alive(None, None);
        let mut stopping = match self {
            Self::Cancel | Self::CallerDeadline => alive(token.cloned(), None),
            Self::WallTime => alive(None, Some(past())),
        };
        let cancel = match self {
            Self::Cancel => token.cloned(),
            Self::CallerDeadline | Self::WallTime => None,
        };
        Box::new(move || {
            let call = calls.get().saturating_add(1);
            calls.set(call);
            if let Some(token) = &cancel {
                if call == at {
                    token.cancel();
                }
                stopping()
            } else if call < at {
                live()
            } else {
                stopping()
            }
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Planning,
    Ordering,
    Building,
    FirstBinding,
    Streaming,
}

enum Stopped {
    /// Before any binding: the `Stop` of planning, order search, building or
    /// `access_stop` for the first binding.
    PreStream(Stop),
    /// After a binding: the pair returned by `stream_failure`.
    Stream(QueryEvaluationError, AnalyticalReason),
}

struct Run {
    /// Checkpoints consulted and work charged when each phase completed.
    marks: Vec<(Phase, u64, u64)>,
    /// The interrupted phase with its production mapping, if any.
    stopped: Option<(Phase, Stopped)>,
    calls: u64,
    work: u64,
    seeks: u64,
    rows: u64,
}

impl Run {
    fn mark(&mut self, phase: Phase, calls: u64, control: &Control<Alive>) {
        self.marks.push((phase, calls, control.work()));
    }

    fn close(
        mut self,
        stopped: Option<(Phase, Stopped)>,
        calls: u64,
        control: &Control<Alive>,
        seeks: u64,
    ) -> Self {
        self.stopped = stopped;
        self.calls = calls;
        self.work = control.work();
        self.seeks = seeks;
        self
    }
}

fn mark(marks: &[(Phase, u64, u64)], phase: Phase) -> Result<(u64, u64), String> {
    marks
        .iter()
        .find(|(reached, _, _)| *reached == phase)
        .map(|(_, calls, work)| (*calls, *work))
        .ok_or_else(|| format!("{phase:?} was not reached"))
}

/// Planning, order search, building and binding search over one retained
/// snapshot, as `execute` sequences them, without decoding rows.
fn run(
    store: &Store,
    prepared: &PreparedSparqlQuery,
    mode: Mode,
    at: u64,
) -> Result<Run, Box<dyn Error>> {
    let token = mode.token();
    let token = token.as_ref();
    let calls = Rc::new(Cell::new(0));
    let limits = limits()?;
    let mut control = Control::new(
        limits.relation_rows,
        limits.materialized_bytes,
        limits.work,
        mode.checkpoints(token, at, &calls),
    );
    let reader = store.storage().snapshot();
    let mut outcome = Run {
        marks: Vec::new(),
        stopped: None,
        calls: 0,
        work: 0,
        seeks: 0,
        rows: 0,
    };
    let planned = match plan(prepared, &limits, &mut control, token) {
        Ok(planned) => planned,
        Err(stop) => {
            let stopped = Some((Phase::Planning, Stopped::PreStream(stop)));
            return Ok(outcome.close(stopped, calls.get(), &control, 0));
        }
    };
    outcome.mark(Phase::Planning, calls.get(), &control);
    let order = {
        let mut order_search = OrderSearch {
            plan: &planned,
            reader: &reader,
            token,
            nodes: 0,
        };
        order_search.choose(AnalyticalVariableOrder::default(), &mut control)
    };
    let order = match order {
        Ok(order) => order,
        Err(stop) => {
            let stopped = Some((Phase::Ordering, Stopped::PreStream(stop)));
            return Ok(outcome.close(stopped, calls.get(), &control, 0));
        }
    };
    outcome.mark(Phase::Ordering, calls.get(), &control);
    let width = planned.variable_count;
    let (relations, participants) =
        match start(&planned, &reader, &order[..width], &mut control, token) {
            Ok(built) => built,
            Err(stop) => {
                let stopped = Some((Phase::Building, Stopped::PreStream(stop)));
                return Ok(outcome.close(stopped, calls.get(), &control, 0));
            }
        };
    outcome.mark(Phase::Building, calls.get(), &control);
    let mut search = Search {
        reader,
        relations,
        participants,
        order,
        width,
        values: [None; MAX_VARIABLES],
        depth: 0,
        prefix: Vec::with_capacity(2),
        control,
        seeks: 0,
        exhausted: false,
    };
    loop {
        match search.next_binding() {
            Ok(true) => {
                outcome.rows += 1;
                if outcome.rows == 1 {
                    outcome.mark(Phase::FirstBinding, calls.get(), &search.control);
                }
            }
            Ok(false) => {
                outcome.mark(Phase::Streaming, calls.get(), &search.control);
                let seeks = search.seeks;
                return Ok(outcome.close(None, calls.get(), &search.control, seeks));
            }
            Err(error) => {
                let stopped = if outcome.rows == 0 {
                    (
                        Phase::FirstBinding,
                        Stopped::PreStream(access_stop(error, token)),
                    )
                } else {
                    let (error, reason) = stream_failure(error, token);
                    (Phase::Streaming, Stopped::Stream(error, reason))
                };
                let seeks = search.seeks;
                return Ok(outcome.close(Some(stopped), calls.get(), &search.control, seeks));
            }
        }
    }
}

/// A pre-stream stop is fatal and typed; `conclude` never starts the
/// standard executor for it, even under the `Standard` fallback policy.
fn check_concluded(
    label: &str,
    store: &Store,
    prepared: &PreparedSparqlQuery,
    mode: Mode,
    stop: Stop,
) -> TestResult {
    match &stop {
        Stop::Fatal(error, reason) => {
            assert!(mode.is_expected(error), "{label}: pre-stream {error:?}");
            assert_eq!(*reason, mode.reason(), "{label}: pre-stream reason");
        }
        Stop::Decline(reason) => {
            return Err(format!("{label}: an interruption was declined as {reason}").into());
        }
    }
    let before = outcomes(store);
    let report = AnalyticalExecutionReport::default();
    let result = conclude(
        stop,
        AnalyticalFallback::Standard,
        prepared.clone(),
        &store.storage().snapshot(),
        &report,
        Some(store.start_evaluation_observation(EvaluationOperation::Query)),
    );
    match result {
        Err(error) => assert!(mode.is_expected(&error), "{label}: concluded {error:?}"),
        Ok(_) => {
            return Err(format!("{label}: the standard fallback answered an interruption").into());
        }
    }
    let snapshot = report.snapshot();
    assert_eq!(
        snapshot.disposition,
        AnalyticalDisposition::Failed,
        "{label}: {snapshot:?}"
    );
    assert_eq!(
        snapshot.reason,
        Some(mode.reason()),
        "{label}: {snapshot:?}"
    );
    assert_eq!(
        delta(store, &before),
        [(mode.outcome(), 1)],
        "{label}: the stop was not observed exactly once with its kind"
    );
    Ok(())
}

fn sweep(backend: &str, store: &Store, mode: Mode) -> TestResult {
    let label = format!("{backend}/{mode:?}");
    let prepared = evaluator().parse_query(TRIANGLE)?;
    let base = run(store, &prepared, mode, u64::MAX)?;
    assert!(
        base.stopped.is_none(),
        "{label}: the uninterrupted run stopped"
    );
    assert_eq!(
        base.rows,
        standard_rows(store, &prepared)?,
        "{label}: binding count differs from the standard executor"
    );
    let phases = base
        .marks
        .iter()
        .map(|(phase, _, _)| *phase)
        .collect::<Vec<_>>();
    assert_eq!(
        phases,
        [
            Phase::Planning,
            Phase::Ordering,
            Phase::Building,
            Phase::FirstBinding,
            Phase::Streaming
        ],
        "{label}: phases"
    );
    let mut last = 0;
    for (phase, calls, _) in &base.marks {
        assert!(*calls > last, "{label}: {phase:?} consulted no checkpoint");
        last = *calls;
    }
    assert_eq!(last, base.calls, "{label}: checkpoints after the end");
    let (_, ordered_work) = mark(&base.marks, Phase::Ordering)?;

    let mut previous_work = 0;
    let mut partial_build = false;
    let mut partial_stream = false;
    for at in 1..=base.calls {
        let label = format!("{label}/checkpoint {at}");
        let expected = base
            .marks
            .iter()
            .find(|(_, calls, _)| *calls >= at)
            .map(|(phase, _, _)| *phase)
            .ok_or_else(|| format!("{label}: beyond the run"))?;
        let Run {
            stopped,
            calls,
            work,
            seeks,
            rows,
            ..
        } = run(store, &prepared, mode, at)?;
        let (phase, stopped) = stopped.ok_or_else(|| format!("{label}: not interrupted"))?;
        assert_eq!(phase, expected, "{label}: interrupted phase");
        assert_eq!(
            calls, at,
            "{label}: a checkpoint was consulted after the interruption"
        );
        let (_, phase_work) = mark(&base.marks, phase)?;
        assert!(
            work <= phase_work,
            "{label}: {work} charged beyond the phase total {phase_work}"
        );
        assert!(
            work >= previous_work,
            "{label}: charged work is not monotone in the checkpoint"
        );
        previous_work = work;
        assert!(seeks <= base.seeks, "{label}: extra seeks");
        assert!(rows <= base.rows, "{label}: extra bindings");
        match stopped {
            Stopped::PreStream(stop) => {
                assert_eq!(rows, 0, "{label}: pre-stream stop after a binding");
                check_concluded(&label, store, &prepared, mode, stop)?;
            }
            Stopped::Stream(error, reason) => {
                assert!(rows > 0, "{label}: stream stop before any binding");
                assert!(mode.is_expected(&error), "{label}: stream {error:?}");
                assert_eq!(reason, mode.reason(), "{label}: stream reason");
            }
        }
        if phase == Phase::Building && work > ordered_work {
            partial_build = true;
        }
        if phase == Phase::Streaming && rows < base.rows {
            partial_stream = true;
        }
    }
    assert!(
        partial_build,
        "{label}: no interruption observed partially charged relation build work"
    );
    assert!(
        partial_stream,
        "{label}: no interruption observed a partial binding search"
    );
    Ok(())
}

#[test]
fn cancellation_at_every_checkpoint_is_typed_and_final() -> TestResult {
    on_backends(|backend, store| sweep(backend, store, Mode::Cancel))
}

#[test]
fn elapsed_caller_deadline_at_every_checkpoint_is_typed_and_final() -> TestResult {
    on_backends(|backend, store| sweep(backend, store, Mode::CallerDeadline))
}

#[test]
fn elapsed_wall_time_at_every_checkpoint_is_typed_and_final() -> TestResult {
    on_backends(|backend, store| sweep(backend, store, Mode::WallTime))
}

/// The production stream: `attempt`, the first binding, then
/// `AnalyticalRows` with the caller token, as `execute` returns it.
fn stream(
    store: &Store,
    prepared: &PreparedSparqlQuery,
    mode: Mode,
    at: u64,
) -> Result<(Vec<(StreamItem, u64)>, AnalyticalExecutionSnapshot), Box<dyn Error>> {
    let token = mode.token();
    let calls = Rc::new(Cell::new(0));
    let limits = limits()?;
    let mut control = Control::new(
        limits.relation_rows,
        limits.materialized_bytes,
        limits.work,
        mode.checkpoints(token.as_ref(), at, &calls),
    );
    let reader = store.storage().snapshot();
    let report = AnalyticalExecutionReport::default();
    let Attempt {
        order,
        width,
        relations,
        participants,
        projection,
        ..
    } = match attempt(
        prepared,
        &reader,
        &limits,
        AnalyticalVariableOrder::default(),
        &mut control,
        &report,
        token.as_ref(),
    ) {
        Ok(started) => started,
        Err(_) => return Err("the attempt stopped before the stream".into()),
    };
    let mut search = Search {
        reader,
        relations,
        participants,
        order,
        width,
        values: [None; MAX_VARIABLES],
        depth: 0,
        prefix: Vec::with_capacity(2),
        control,
        seeks: 0,
        exhausted: false,
    };
    if !search.next_binding()? {
        return Err("the fixture has no first binding".into());
    }
    let built = search.relations.len();
    report.update(|snapshot| {
        snapshot.disposition = AnalyticalDisposition::Analytical;
        snapshot.reason = None;
        snapshot.relations = built;
    });
    let mut rows = AnalyticalRows {
        search,
        ready: true,
        projection,
        max_output_rows: limits.output_rows,
        emitted: 0,
        row_bytes: 0,
        finished: false,
        token,
        report: report.clone(),
    };
    let mut items = Vec::new();
    for item in rows.by_ref() {
        items.push((item, calls.get()));
    }
    if rows.next().is_some() {
        return Err("the stream is not fused".into());
    }
    Ok((items, report.snapshot()))
}

fn stream_interruption(backend: &str, store: &Store, mode: Mode) -> TestResult {
    let label = format!("{backend}/{mode:?}");
    let prepared = evaluator().parse_query(TRIANGLE)?;
    let (base, finished) = stream(store, &prepared, mode, u64::MAX)?;
    assert_eq!(
        count(base.len()),
        standard_rows(store, &prepared)?,
        "{label}: the uninterrupted stream differs from the standard executor"
    );
    assert!(
        base.iter().all(|(item, _)| item.is_ok()),
        "{label}: the uninterrupted stream failed"
    );
    assert!(
        finished.completed && finished.disposition == AnalyticalDisposition::Analytical,
        "{label}: {finished:?}"
    );
    let (first, after_first) = base.first().ok_or("the stream is empty")?;
    let at = *after_first + 1;

    let (items, snapshot) = stream(store, &prepared, mode, at)?;
    assert_eq!(items.len(), 2, "{label}: one row, then one typed failure");
    let (emitted, _) = &items[0];
    assert_eq!(
        emitted.as_ref().ok(),
        first.as_ref().ok(),
        "{label}: the first row changed"
    );
    let (failure, calls) = &items[1];
    assert_eq!(
        *calls, at,
        "{label}: a checkpoint was consulted after the interruption"
    );
    match failure {
        Err(error) => assert!(mode.is_expected(error), "{label}: {error:?}"),
        Ok(_) => return Err(format!("{label}: a row followed the interruption").into()),
    }
    assert_eq!(
        snapshot.disposition,
        AnalyticalDisposition::Failed,
        "{label}: {snapshot:?}"
    );
    assert_eq!(
        snapshot.reason,
        Some(mode.reason()),
        "{label}: {snapshot:?}"
    );
    assert_eq!(snapshot.output_rows, 1, "{label}: {snapshot:?}");
    assert!(!snapshot.completed, "{label}: {snapshot:?}");
    Ok(())
}

#[test]
fn stream_interruption_after_a_row_is_typed_fused_and_never_replayed() -> TestResult {
    on_backends(|backend, store| {
        for mode in [Mode::Cancel, Mode::CallerDeadline, Mode::WallTime] {
            stream_interruption(backend, store, mode)?;
        }
        Ok(())
    })
}

/// The stream of an empty answer with its checkpoint accounting.
struct EmptyStream {
    items: Vec<(StreamItem, u64)>,
    /// Checkpoints consulted before the stream was returned.
    before: u64,
    /// Checkpoints consulted once the stream was polled again after its end.
    after: u64,
    snapshot: AnalyticalExecutionSnapshot,
}

/// The production stream of an empty answer: `attempt`, the first binding
/// search exhausting it before the stream is returned, then `AnalyticalRows`
/// with nothing ready, as `execute` returns it.
fn empty_stream(
    store: &Store,
    prepared: &PreparedSparqlQuery,
    mode: Mode,
    at: u64,
) -> Result<EmptyStream, Box<dyn Error>> {
    let token = mode.token();
    let calls = Rc::new(Cell::new(0));
    let limits = limits()?;
    let mut control = Control::new(
        limits.relation_rows,
        limits.materialized_bytes,
        limits.work,
        mode.checkpoints(token.as_ref(), at, &calls),
    );
    let reader = store.storage().snapshot();
    let report = AnalyticalExecutionReport::default();
    let Attempt {
        order,
        width,
        relations,
        participants,
        projection,
        ..
    } = match attempt(
        prepared,
        &reader,
        &limits,
        AnalyticalVariableOrder::default(),
        &mut control,
        &report,
        token.as_ref(),
    ) {
        Ok(started) => started,
        Err(_) => return Err("the attempt stopped before the stream".into()),
    };
    let mut search = Search {
        reader,
        relations,
        participants,
        order,
        width,
        values: [None; MAX_VARIABLES],
        depth: 0,
        prefix: Vec::with_capacity(2),
        control,
        seeks: 0,
        exhausted: false,
    };
    if search.next_binding()? {
        return Err("the fixture answer is not empty".into());
    }
    let before = calls.get();
    let built = search.relations.len();
    report.update(|snapshot| {
        snapshot.disposition = AnalyticalDisposition::Analytical;
        snapshot.reason = None;
        snapshot.relations = built;
    });
    let mut rows = AnalyticalRows {
        search,
        ready: false,
        projection,
        max_output_rows: limits.output_rows,
        emitted: 0,
        row_bytes: 0,
        finished: false,
        token,
        report: report.clone(),
    };
    let mut items = Vec::new();
    for item in rows.by_ref() {
        items.push((item, calls.get()));
    }
    if rows.next().is_some() {
        return Err("the stream is not fused".into());
    }
    Ok(EmptyStream {
        items,
        before,
        after: calls.get(),
        snapshot: report.snapshot(),
    })
}

fn empty_stream_interruption(backend: &str, store: &Store, mode: Mode) -> TestResult {
    let label = format!("{backend}/{mode:?}");
    let prepared = evaluator().parse_query(EMPTY)?;
    assert_eq!(
        standard_rows(store, &prepared)?,
        0,
        "{label}: the standard answer is not empty"
    );
    let base = empty_stream(store, &prepared, mode, u64::MAX)?;
    assert!(base.before > 0, "{label}: no checkpoint before the stream");
    assert!(
        base.items.is_empty(),
        "{label}: the empty answer returned an item"
    );
    assert_eq!(
        base.after,
        base.before + 1,
        "{label}: the terminal poll must consult exactly one checkpoint"
    );
    let finished = base.snapshot;
    assert!(
        finished.completed && finished.disposition == AnalyticalDisposition::Analytical,
        "{label}: {finished:?}"
    );

    // Interrupted at the checkpoint of the terminal poll: one typed failure.
    let at = base.before + 1;
    let stopped = empty_stream(store, &prepared, mode, at)?;
    assert_eq!(
        stopped.before, base.before,
        "{label}: the interruption reached the pre-stream search"
    );
    let [(failure, calls)] = stopped.items.as_slice() else {
        return Err(format!(
            "{label}: expected exactly one typed failure, got {} items",
            stopped.items.len()
        )
        .into());
    };
    assert_eq!(*calls, at, "{label}: the failure was not observed at once");
    match failure {
        Err(error) => assert!(mode.is_expected(error), "{label}: {error:?}"),
        Ok(_) => return Err(format!("{label}: a row followed the interruption").into()),
    }
    assert_eq!(
        stopped.after, at,
        "{label}: the fused stream consulted a checkpoint"
    );
    let snapshot = stopped.snapshot;
    assert_eq!(
        snapshot.disposition,
        AnalyticalDisposition::Failed,
        "{label}: {snapshot:?}"
    );
    assert_eq!(
        snapshot.reason,
        Some(mode.reason()),
        "{label}: {snapshot:?}"
    );
    assert!(
        !snapshot.completed && snapshot.output_rows == 0,
        "{label}: {snapshot:?}"
    );

    // Already terminal: an interruption from the next checkpoint on is never
    // observed, the fused stream stays empty.
    let late = empty_stream(store, &prepared, mode, at + 1)?;
    assert!(
        late.items.is_empty(),
        "{label}: a terminal stream reported a later interruption"
    );
    assert_eq!(
        late.after, at,
        "{label}: the fused stream consulted a checkpoint"
    );
    let snapshot = late.snapshot;
    assert!(
        snapshot.completed
            && snapshot.disposition == AnalyticalDisposition::Analytical
            && snapshot.reason.is_none(),
        "{label}: {snapshot:?}"
    );
    Ok(())
}

#[test]
fn empty_answer_observes_interruption_at_its_terminal_poll_once() -> TestResult {
    on_backends(|backend, store| {
        for mode in [Mode::Cancel, Mode::CallerDeadline, Mode::WallTime] {
            empty_stream_interruption(backend, store, mode)?;
        }
        Ok(())
    })
}

/// Polls of one empty answer and, when analytical, its final report.
struct Polled {
    polls: Vec<Poll>,
    snapshot: Option<AnalyticalExecutionSnapshot>,
}

/// Executes the empty answer, then polls its stream three times. The caller
/// token is cancelled once `execute` has returned, or only after the first,
/// terminal poll.
fn empty_polls(
    store: &Store,
    options: Option<AnalyticalExecutionOptions>,
    cancel_after_first_poll: bool,
) -> Result<Polled, Box<dyn Error>> {
    let token = CancellationToken::new();
    let prepared = evaluator()
        .with_cancellation_token(token.clone())
        .parse_query(EMPTY)?;
    let (results, report) = if let Some(options) = options {
        let bound = prepared.on_store_with_analytical(store, options);
        let report = bound.report();
        (bound.execute()?, Some(report))
    } else {
        (prepared.on_store(store).execute()?, None)
    };
    let QueryResults::Solutions(mut solutions) = results else {
        return Err("solutions expected".into());
    };
    if !cancel_after_first_poll {
        token.cancel();
    }
    let mut polls = vec![solutions.next()];
    token.cancel();
    polls.push(solutions.next());
    polls.push(solutions.next());
    Ok(Polled {
        polls,
        snapshot: report.as_ref().map(AnalyticalExecutionReport::snapshot),
    })
}

#[test]
fn empty_answer_observes_cancellation_after_execute_like_standard() -> TestResult {
    on_backends(|backend, store| {
        let options = AnalyticalExecutionOptions::explicit(limits()?);
        for cancel_after_first_poll in [false, true] {
            let label = format!("{backend}/cancel after first poll {cancel_after_first_poll}");
            let before = outcomes(store);
            let standard = empty_polls(store, None, cancel_after_first_poll)?;
            let standard_metrics = delta(store, &before);
            let expected = if cancel_after_first_poll {
                EvaluationOutcome::Succeeded
            } else {
                EvaluationOutcome::Cancelled
            };
            assert_eq!(
                standard_metrics,
                [(expected, 1)],
                "{label}: standard executor observation"
            );
            let before = outcomes(store);
            let analytical = empty_polls(store, Some(options), cancel_after_first_poll)?;
            assert_eq!(
                delta(store, &before),
                standard_metrics,
                "{label}: analytical observation differs from the standard executor"
            );
            for (name, polled) in [("standard", &standard), ("analytical", &analytical)] {
                let [first, second, third] = polled.polls.as_slice() else {
                    return Err(format!("{label}/{name}: three polls expected").into());
                };
                if cancel_after_first_poll {
                    assert!(
                        first.is_none(),
                        "{label}/{name}: the empty answer was not terminal"
                    );
                } else {
                    assert!(
                        matches!(first, Some(Err(QueryEvaluationError::Cancelled))),
                        "{label}/{name}: cancellation after execute was not observed"
                    );
                }
                assert!(
                    second.is_none() && third.is_none(),
                    "{label}/{name}: the stream is not fused"
                );
            }
            let snapshot = analytical
                .snapshot
                .ok_or("an analytical report is expected")?;
            if cancel_after_first_poll {
                assert_eq!(
                    (snapshot.disposition, snapshot.reason, snapshot.completed),
                    (AnalyticalDisposition::Analytical, None, true),
                    "{label}: {snapshot:?}"
                );
            } else {
                assert_eq!(
                    (snapshot.disposition, snapshot.reason, snapshot.completed),
                    (
                        AnalyticalDisposition::Failed,
                        Some(AnalyticalReason::Cancelled),
                        false
                    ),
                    "{label}: {snapshot:?}"
                );
            }
            assert_eq!(snapshot.output_rows, 0, "{label}: {snapshot:?}");
            assert!(
                snapshot.relations > 0,
                "{label}: the answer was not analytical: {snapshot:?}"
            );
        }
        Ok(())
    })
}

#[test]
fn elapsed_caller_deadline_matches_standard_metrics() -> TestResult {
    on_backends(|backend, store| {
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        let cases = [
            (
                "elapsed deadline",
                CancellationToken::new().with_deadline(past()),
                Mode::CallerDeadline,
            ),
            (
                "cancelled with elapsed deadline",
                cancelled.with_deadline(past()),
                Mode::Cancel,
            ),
        ];
        for (name, token, mode) in cases {
            let label = format!("{backend}/{name}");
            let prepared = evaluator()
                .with_cancellation_token(token)
                .parse_query(TRIANGLE)?;
            let before = outcomes(store);
            drain(prepared.clone().on_store(store).execute());
            let standard = delta(store, &before);
            assert_eq!(
                standard,
                [(mode.outcome(), 1)],
                "{label}: standard executor observation"
            );
            let explicit = AnalyticalExecutionOptions::explicit(limits()?);
            for options in [
                explicit,
                explicit.with_fallback(AnalyticalFallback::Refuse),
                AnalyticalExecutionOptions::disabled(),
            ] {
                let label = format!("{label}/{:?}/{:?}", options.mode(), options.fallback());
                let before = outcomes(store);
                let bound = prepared.clone().on_store_with_analytical(store, options);
                let report = bound.report();
                let result = bound.execute();
                match &result {
                    Err(error) => assert!(mode.is_expected(error), "{label}: {error:?}"),
                    Ok(_) => {
                        return Err(
                            format!("{label}: an elapsed caller token returned results").into()
                        );
                    }
                }
                drain(result);
                assert_eq!(
                    delta(store, &before),
                    standard,
                    "{label}: analytical observation differs from the standard executor"
                );
                let snapshot = report.snapshot();
                assert_eq!(
                    snapshot.disposition,
                    AnalyticalDisposition::Failed,
                    "{label}: {snapshot:?}"
                );
                assert_eq!(
                    snapshot.reason,
                    Some(mode.reason()),
                    "{label}: {snapshot:?}"
                );
                assert_eq!(
                    (snapshot.relations, snapshot.work, snapshot.output_rows),
                    (0, 0, 0),
                    "{label}: work before the caller interruption was observed"
                );
            }
        }
        Ok(())
    })
}

#[test]
fn interruption_mapping_prefers_explicit_cancellation() -> TestResult {
    let live = CancellationToken::new();
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let expired = CancellationToken::new().with_deadline(past());
    let both = cancelled.clone().with_deadline(past());
    let wall = AnalyticalReason::Budget(AnalyticalBudget::WallTime);
    for (name, token, cancel, reason) in [
        ("no caller token", None, false, wall),
        ("live caller token", Some(&live), false, wall),
        (
            "cancelled",
            Some(&cancelled),
            true,
            AnalyticalReason::Cancelled,
        ),
        (
            "elapsed deadline",
            Some(&expired),
            false,
            AnalyticalReason::TimedOut,
        ),
        (
            "cancelled with elapsed deadline",
            Some(&both),
            true,
            AnalyticalReason::Cancelled,
        ),
    ] {
        let expected = |error: &QueryEvaluationError| {
            if cancel {
                matches!(error, QueryEvaluationError::Cancelled)
            } else {
                matches!(error, QueryEvaluationError::TimedOut)
            }
        };
        match access_stop(AccessError::Interrupted, token) {
            Stop::Fatal(error, actual) => {
                assert!(expected(&error), "{name}: pre-stream {error:?}");
                assert_eq!(actual, reason, "{name}: pre-stream reason");
            }
            Stop::Decline(actual) => {
                return Err(format!("{name}: interruption declined as {actual}").into());
            }
        }
        let (error, actual) = stream_failure(AccessError::Interrupted, token);
        assert!(expected(&error), "{name}: stream {error:?}");
        assert_eq!(actual, reason, "{name}: stream reason");
    }
    assert!(interrupted(None).is_none(), "no token is never interrupted");
    assert!(
        interrupted(Some(&live)).is_none(),
        "a live token is not interrupted"
    );
    for (name, mut check, expected) in [
        ("unbounded", alive(None, None), true),
        (
            "live token with a future deadline",
            alive(
                Some(live.clone()),
                Instant::now().checked_add(Duration::from_secs(3600)),
            ),
            true,
        ),
        (
            "cancelled token",
            alive(Some(cancelled.clone()), None),
            false,
        ),
        (
            "elapsed caller deadline",
            alive(Some(expired.clone()), None),
            false,
        ),
        (
            "elapsed analytical deadline",
            alive(None, Some(past())),
            false,
        ),
    ] {
        assert_eq!(check(), expected, "{name}");
    }
    Ok(())
}
