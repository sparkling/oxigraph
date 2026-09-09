use std::io::{Error, ErrorKind, Result};
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{Builder, JoinHandle};
use std::time::Instant;

/// An absolute request deadline installed by a trusted admission hook.
///
/// The transport closes both socket directions on expiry, so a partial response
/// cannot end as a valid success. Application work must separately observe this
/// same deadline: closing a socket cannot preempt CPU work or undo a commit.
#[derive(Clone, Copy, Debug)]
pub struct RequestDeadline(pub Instant);

pub(super) struct DeadlineWatch {
    stop: Arc<(Mutex<bool>, Condvar)>,
    worker: Option<JoinHandle<()>>,
    deadline: Instant,
}

impl DeadlineWatch {
    pub(super) fn start(stream: &TcpStream, deadline: Instant) -> Result<Self> {
        if Instant::now() >= deadline {
            return Err(Error::new(ErrorKind::TimedOut, "request deadline elapsed"));
        }
        let stream = stream.try_clone()?;
        let stop = Arc::new((Mutex::new(false), Condvar::new()));
        let stopped = Arc::clone(&stop);
        let worker = Builder::new()
            .name("HTTP request deadline".into())
            .spawn(move || {
                let (lock, changed) = &*stopped;
                let mut stop = lock
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                loop {
                    if *stop {
                        return;
                    }
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        // The guard remains held until shutdown has happened.
                        // Finish/drop must join before reusing this connection.
                        drop(stream.shutdown(Shutdown::Both));
                        return;
                    }
                    stop = changed
                        .wait_timeout(stop, remaining)
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .0;
                }
            })?;
        Ok(Self {
            stop,
            worker: Some(worker),
            deadline,
        })
    }

    pub(super) fn check(&self) -> Result<()> {
        if Instant::now() >= self.deadline {
            Err(Error::new(ErrorKind::TimedOut, "request deadline elapsed"))
        } else {
            Ok(())
        }
    }
}

impl Drop for DeadlineWatch {
    fn drop(&mut self) {
        let (lock, changed) = &*self.stop;
        *lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        changed.notify_one();
        if let Some(worker) = self.worker.take() {
            drop(worker.join());
        }
    }
}
