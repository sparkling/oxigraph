use std::io::{Error, ErrorKind, Result};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

/// A non-blocking socket-failure probe available in the immutable admission head.
///
/// [`super::Server::with_request_admission`] installs a fresh probe per request.
/// Poll it while waiting for admission to notice transport errors such as a TCP
/// reset without reading the body, changing socket modes, or starting a thread.
/// An observed error is latched because reading `SO_ERROR` clears it.
///
/// This is not a liveness guarantee: a FIN (including a valid write-half-close),
/// an unreachable peer, or a graceful close without a socket error is not an
/// abort signal. Bound those waits with an admission/request deadline.
///
/// After the admission hook returns or unwinds, all clones become inert and
/// release their socket handle. They retain only the previously observed result;
/// they cannot monitor active work or a later keep-alive request.
#[derive(Clone, Debug)]
pub struct AdmissionAbort(Arc<Mutex<State>>);

#[derive(Debug)]
struct State {
    socket: Option<TcpStream>,
    aborted: bool,
}

impl State {
    fn poll(&mut self) -> bool {
        if !self.aborted {
            if let Some(socket) = &self.socket {
                self.aborted = !matches!(socket.take_error(), Ok(None));
            }
        }
        self.aborted
    }
}

impl AdmissionAbort {
    /// Poll for a socket error during admission; preserve a previously observed
    /// failure. Failure to inspect the socket also fails closed.
    pub fn is_aborted(&self) -> bool {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.poll()
    }
}

pub(super) struct AdmissionAbortGuard(pub(super) AdmissionAbort);

impl AdmissionAbortGuard {
    pub(super) fn new(socket: &TcpStream) -> Result<Self> {
        Ok(Self(AdmissionAbort(Arc::new(Mutex::new(State {
            socket: Some(socket.try_clone()?),
            aborted: false,
        })))))
    }

    pub(super) fn finish(self) -> Result<()> {
        // Also defend a hook that ignored the probe or returned just as a reset
        // arrived. Drop disarms escaped clones before any application I/O.
        let aborted = {
            let mut state = self
                .0
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let aborted = state.poll();
            state.socket = None;
            aborted
        };
        if aborted {
            Err(Error::new(
                ErrorKind::ConnectionAborted,
                "connection failed during admission",
            ))
        } else {
            Ok(())
        }
    }
}

impl Drop for AdmissionAbortGuard {
    fn drop(&mut self) {
        self.0
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .socket = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::{Ipv4Addr, Shutdown, TcpListener};
    use std::time::{Duration, Instant};

    fn pair() -> Result<(TcpStream, TcpStream)> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let peer = TcpStream::connect(listener.local_addr()?)?;
        peer.set_read_timeout(Some(Duration::from_secs(3)))?;
        Ok((listener.accept()?.0, peer))
    }

    #[test]
    fn half_close_is_not_an_abort_and_finish_disarms_every_clone() -> Result<()> {
        let (socket, peer) = pair()?;
        let guard = AdmissionAbortGuard::new(&socket)?;
        let probe = guard.0.clone();
        peer.shutdown(Shutdown::Write)?;
        assert!(!probe.is_aborted());
        guard.finish()?;
        assert!(probe.0.lock().unwrap().socket.is_none());
        assert!(!probe.is_aborted());
        Ok(())
    }

    #[test]
    fn unwind_disarms_escaped_probe() -> Result<()> {
        let (socket, _peer) = pair()?;
        let guard = AdmissionAbortGuard::new(&socket)?;
        let probe = guard.0.clone();
        assert!(
            std::panic::catch_unwind(move || {
                let _guard = guard;
                panic!("admission unwind");
            })
            .is_err()
        );
        assert!(probe.0.lock().unwrap().socket.is_none());
        Ok(())
    }

    // Linux closes a TCP socket with unread received data using an active reset.
    // This produces a real SO_ERROR without unsafe linger setup or a dependency.
    #[cfg(target_os = "linux")]
    #[test]
    fn reset_is_latched_across_clones_and_finish() -> Result<()> {
        let (mut socket, peer) = pair()?;
        let guard = AdmissionAbortGuard::new(&socket)?;
        let probe = guard.0.clone();
        socket.write_all(b"unread")?;
        assert!(peer.peek(&mut [0; 1])? > 0);
        drop(peer);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !probe.is_aborted() {
            assert!(Instant::now() < deadline, "reset was not observed");
            std::thread::yield_now();
        }
        assert!(
            socket.take_error()?.is_none(),
            "probe must have consumed SO_ERROR"
        );
        assert!(probe.clone().is_aborted());
        assert_eq!(
            guard.finish().unwrap_err().kind(),
            ErrorKind::ConnectionAborted
        );
        assert!(probe.0.lock().unwrap().socket.is_none());
        assert!(probe.is_aborted());
        Ok(())
    }
}
