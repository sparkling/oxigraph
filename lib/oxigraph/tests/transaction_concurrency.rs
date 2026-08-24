#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public concurrent transaction contract"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{Store, Transaction};
use std::error::Error;
use std::io;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;

const OVERLAP_WINDOW: Duration = Duration::from_secs(1);
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug)]
enum History {
    LostUpdate,
    WriteSkew,
}

#[derive(Clone, Copy, Debug)]
enum Writer {
    First,
    Second,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Event {
    Attempting,
    Staged,
    Committed,
}

struct Worker {
    commit: Sender<()>,
    events: Receiver<Event>,
    handle: JoinHandle<Result<(), TestError>>,
}

fn counter_quad(value: u8) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:oxigraph:concurrency:counter"),
        NamedNode::new_unchecked("urn:oxigraph:concurrency:value"),
        NamedNode::new_unchecked(format!("urn:oxigraph:concurrency:value:{value}")),
        GraphName::DefaultGraph,
    )
}

fn on_call_quad(writer: Writer) -> Quad {
    let doctor = match writer {
        Writer::First => "alice",
        Writer::Second => "bob",
    };
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:concurrency:doctor:{doctor}")),
        NamedNode::new_unchecked("urn:oxigraph:concurrency:on-call"),
        NamedNode::new_unchecked("urn:oxigraph:concurrency:true"),
        GraphName::DefaultGraph,
    )
}

fn stage(
    history: History,
    writer: Writer,
    transaction: &mut Transaction<'_>,
) -> Result<(), TestError> {
    match history {
        History::LostUpdate => {
            let current = (0..=2)
                .map(counter_quad)
                .find_map(|quad| match transaction.contains(&quad) {
                    Ok(true) => Some(Ok(quad)),
                    Ok(false) => None,
                    Err(error) => Some(Err(error)),
                })
                .transpose()?
                .ok_or_else(|| io::Error::other("counter value is missing"))?;
            let value = if current == counter_quad(0) {
                0
            } else if current == counter_quad(1) {
                1
            } else {
                return Err(io::Error::other("counter exceeds the frozen history").into());
            };
            transaction.remove(&current);
            transaction.insert(counter_quad(value + 1));
        }
        History::WriteSkew => {
            let other = match writer {
                Writer::First => Writer::Second,
                Writer::Second => Writer::First,
            };
            if transaction.contains(&on_call_quad(other))? {
                transaction.remove(&on_call_quad(writer));
            }
        }
    }
    Ok(())
}

fn spawn_writer(store: Arc<Store>, history: History, writer: Writer) -> Worker {
    let (commit, commit_requested) = mpsc::channel();
    let (events, event_stream) = mpsc::channel();
    let handle = thread::spawn(move || {
        events.send(Event::Attempting)?;
        let mut transaction = store.start_transaction()?;
        stage(history, writer, &mut transaction)?;
        events.send(Event::Staged)?;
        commit_requested.recv()?;
        transaction.commit()?;
        events.send(Event::Committed)?;
        Ok(())
    });
    Worker {
        commit,
        events: event_stream,
        handle,
    }
}

fn expect_event(
    events: &Receiver<Event>,
    expected: Event,
    writer: Writer,
) -> Result<(), TestError> {
    match events.recv_timeout(EVENT_TIMEOUT) {
        Ok(actual) if actual == expected => Ok(()),
        Ok(actual) => Err(io::Error::other(format!(
            "{writer:?} writer emitted {actual:?}, expected {expected:?}"
        ))
        .into()),
        Err(error) => Err(io::Error::other(format!(
            "{writer:?} writer did not emit {expected:?}: {error}"
        ))
        .into()),
    }
}

fn join_worker(worker: Worker, writer: Writer) -> Result<(), TestError> {
    match worker.handle.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::other(format!("{writer:?} writer panicked")).into()),
    }
}

fn execute_history(store: Arc<Store>, history: History) -> Result<bool, TestError> {
    let first = spawn_writer(Arc::clone(&store), history, Writer::First);
    expect_event(&first.events, Event::Attempting, Writer::First)?;
    expect_event(&first.events, Event::Staged, Writer::First)?;

    let second = spawn_writer(store, history, Writer::Second);
    expect_event(&second.events, Event::Attempting, Writer::Second)?;
    let overlapped = match second.events.recv_timeout(OVERLAP_WINDOW) {
        Ok(Event::Staged) => true,
        Ok(actual) => {
            return Err(io::Error::other(format!(
                "second writer emitted {actual:?}, expected Staged"
            ))
            .into());
        }
        Err(RecvTimeoutError::Timeout) => false,
        Err(error) => {
            return Err(io::Error::other(format!(
                "second writer disconnected before staging: {error}"
            ))
            .into());
        }
    };

    first.commit.send(())?;
    expect_event(&first.events, Event::Committed, Writer::First)?;
    if !overlapped {
        expect_event(&second.events, Event::Staged, Writer::Second)?;
    }
    second.commit.send(())?;
    expect_event(&second.events, Event::Committed, Writer::Second)?;

    join_worker(first, Writer::First)?;
    join_worker(second, Writer::Second)?;
    Ok(overlapped)
}

fn open_store() -> Result<(tempfile::TempDir, Arc<Store>), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    Ok((directory, store))
}

#[test]
fn overlapping_read_modify_write_transactions_do_not_lose_an_update() -> Result<(), TestError> {
    let (_directory, store) = open_store()?;
    store.insert(counter_quad(0))?;
    let overlapped = execute_history(Arc::clone(&store), History::LostUpdate)?;

    assert!(
        store.contains(&counter_quad(2))?,
        "lost-update history violated serial writer semantics; overlap_observed={overlapped}; expected counter=2"
    );
    assert_eq!(
        store.len()?,
        1,
        "lost-update history must retain exactly one counter value"
    );
    Ok(())
}

#[test]
fn overlapping_write_skew_transactions_preserve_the_on_call_invariant() -> Result<(), TestError> {
    let (_directory, store) = open_store()?;
    store.insert(on_call_quad(Writer::First))?;
    store.insert(on_call_quad(Writer::Second))?;
    let overlapped = execute_history(Arc::clone(&store), History::WriteSkew)?;

    assert!(
        store.contains(&on_call_quad(Writer::First))?
            || store.contains(&on_call_quad(Writer::Second))?,
        "write-skew history removed every on-call doctor; overlap_observed={overlapped}"
    );
    Ok(())
}
