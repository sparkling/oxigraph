//! Server-layer anonymous transport boundary (ADR-0026).
//! This is explicit local/open configuration, not request authentication.
use anyhow::{Result, ensure};
use std::net::{SocketAddr, ToSocketAddrs};

pub struct AnonymousListener {
    bind: String,
    addresses: Vec<SocketAddr>,
}

impl AnonymousListener {
    /// Resolve once, validate the entire set, and retain exactly those sockets.
    /// Call before opening a store or starting either server listener.
    pub fn resolve(bind: String, allow_remote: bool) -> Result<Self> {
        let addresses: Vec<_> = bind.to_socket_addrs()?.collect();
        validate_addresses(&addresses, allow_remote)?;
        if addresses.iter().any(|address| !address.ip().is_loopback()) {
            eprintln!(
                "WARNING: unsafe anonymous remote access enabled; this listener has no authentication or authorization. Read-only mode and CORS do not authenticate clients."
            );
        }
        Ok(Self { bind, addresses })
    }

    pub fn addresses(&self) -> &[SocketAddr] {
        &self.addresses
    }

    pub fn bind(&self) -> &str {
        &self.bind
    }
}

fn validate_addresses(addresses: &[SocketAddr], allow_remote: bool) -> Result<()> {
    ensure!(
        !addresses.is_empty(),
        "listener resolved to no socket addresses"
    );
    ensure!(
        allow_remote || addresses.iter().all(|address| address.ip().is_loopback()),
        "non-loopback anonymous listener requires --unsafe-allow-remote-anonymous; use a loopback bind for trusted local access"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_entirely_loopback_sets_are_anonymous_by_default() -> Result<()> {
        let loopback = ["127.0.0.1:7878".parse()?, "[::1]:7878".parse()?];
        validate_addresses(&loopback, false)?;
        for remote in [
            "0.0.0.0:7878",
            "[::]:7878",
            "192.0.2.1:7878",
            "[2001:db8::1]:7878",
            "[::ffff:127.0.0.1]:7878",
        ] {
            let remote = remote.parse()?;
            for addresses in [
                vec![remote],
                vec![loopback[0], remote],
                vec![remote, loopback[1]],
            ] {
                assert!(validate_addresses(&addresses, false).is_err());
                validate_addresses(&addresses, true)?;
            }
        }
        // Explicit consent cannot turn a missing resolution into a listener.
        assert!(validate_addresses(&[], false).is_err());
        assert!(validate_addresses(&[], true).is_err());
        Ok(())
    }

    #[test]
    fn resolution_retains_the_exact_validated_sockets() -> Result<()> {
        let listener = AnonymousListener::resolve("127.0.0.1:0".into(), false)?;
        assert_eq!(listener.bind(), "127.0.0.1:0");
        assert_eq!(listener.addresses(), &["127.0.0.1:0".parse()?]);
        // Resolving/validating does not open this non-loopback socket.
        let remote = AnonymousListener::resolve("192.0.2.1:7878".into(), true)?;
        assert_eq!(remote.addresses(), &["192.0.2.1:7878".parse()?]);
        assert!(AnonymousListener::resolve("invalid bind address".into(), true).is_err());
        Ok(())
    }
}
