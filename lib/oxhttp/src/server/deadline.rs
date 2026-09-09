use std::io::{Error, ErrorKind, Result};
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{Builder, JoinHandle};
use std::time::{Duration, Instant};

const TRANSPORT_POLL: Duration = Duration::from_millis(10);

/// An absolute request deadline installed by a trusted admission hook.
///
/// The transport closes both socket directions on expiry, so a partial response
/// cannot end as a valid success. Application work must separately observe this
/// same deadline: closing a socket cannot preempt CPU work or undo a commit.
#[derive(Clone, Copy, Debug)]
pub struct RequestDeadline(pub Instant);

/// A trusted callback invoked after an active request's socket error is latched.
///
/// Install this extension from a request-admission hook to connect observed TCP
/// failures to an application cancellation token. Each request monitor invokes
/// its callback at most once, outside OxHTTP locks. A FIN is not a cancellation
/// signal, and socket I/O may consume an error before this best-effort observer
/// sees it. The callback must return promptly because request teardown joins the
/// monitor before the connection can be reused.
#[derive(Clone)]
pub struct RequestTransportCancellation {
    callback: Arc<dyn Fn() + Send + Sync>,
}

impl RequestTransportCancellation {
    pub fn new(callback: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            callback: Arc::new(callback),
        }
    }
}

struct State {
    stop: bool,
    transport_failed: bool,
}

pub(super) struct RequestWatch {
    state: Arc<(Mutex<State>, Condvar)>,
    worker: Option<JoinHandle<()>>,
    deadline: Option<Instant>,
}

impl RequestWatch {
    pub(super) fn start(
        stream: &TcpStream,
        deadline: Option<Instant>,
        cancellation: Option<RequestTransportCancellation>,
    ) -> Result<Option<Self>> {
        if deadline.is_none() && cancellation.is_none() {
            return Ok(None);
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err(Error::new(ErrorKind::TimedOut, "request deadline elapsed"));
        }
        let stream = stream.try_clone()?;
        let state = Arc::new((
            Mutex::new(State {
                stop: false,
                transport_failed: false,
            }),
            Condvar::new(),
        ));
        let watched = Arc::clone(&state);
        let worker = Builder::new()
            .name("HTTP request watch".into())
            .spawn(move || {
                let (lock, changed) = &*watched;
                let mut state = lock
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                loop {
                    if state.stop {
                        return;
                    }
                    let now = Instant::now();
                    if deadline.is_some_and(|deadline| now >= deadline) {
                        // This worker returns immediately after its own shutdown,
                        // so it cannot observe and relabel that error as a reset.
                        drop(state);
                        drop(stream.shutdown(Shutdown::Both));
                        return;
                    }
                    if cancellation.is_some() {
                        drop(state);
                        let failed = !matches!(stream.take_error(), Ok(None));
                        state = lock
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if failed {
                            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                                drop(state);
                                drop(stream.shutdown(Shutdown::Both));
                                return;
                            }
                            // SO_ERROR is consuming. Latch the result and force
                            // later transport operations to fail before callback.
                            state.transport_failed = true;
                            let stopped = state.stop;
                            drop(state);
                            drop(stream.shutdown(Shutdown::Both));
                            if !stopped {
                                // A trusted application callback must not poison
                                // cleanup if it unwinds.
                                drop(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                    || (cancellation.as_ref().unwrap().callback)(),
                                )));
                            }
                            return;
                        }
                    }
                    let wait = match (deadline, cancellation.is_some()) {
                        (Some(deadline), true) => deadline
                            .saturating_duration_since(Instant::now())
                            .min(TRANSPORT_POLL),
                        (Some(deadline), false) => {
                            deadline.saturating_duration_since(Instant::now())
                        }
                        (None, true) => TRANSPORT_POLL,
                        (None, false) => unreachable!(),
                    };
                    state = changed
                        .wait_timeout(state, wait)
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .0;
                }
            })?;
        Ok(Some(Self {
            state,
            worker: Some(worker),
            deadline,
        }))
    }

    pub(super) fn check(&self) -> Result<()> {
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(Error::new(ErrorKind::TimedOut, "request deadline elapsed"));
        }
        if self
            .state
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .transport_failed
        {
            return Err(Error::new(
                ErrorKind::ConnectionAborted,
                "connection failed during active request",
            ));
        }
        Ok(())
    }
}

impl Drop for RequestWatch {
    fn drop(&mut self) {
        let (lock, changed) = &*self.state;
        lock.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .stop = true;
        changed.notify_one();
        if let Some(worker) = self.worker.take() {
            drop(worker.join());
        }
    }
}
