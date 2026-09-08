#![expect(clippy::tests_outside_test_module, reason = "CLI startup contracts")]
use anyhow::{Result, ensure};
use std::process::Command;

#[test]
fn remote_anonymous_listener_is_rejected_before_opening_the_store() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    for subcommand in ["serve", "serve-read-only"] {
        let location = directory.path().join(subcommand);
        let output = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args([subcommand, "--bind", "192.0.2.1:7878", "--location"])
            .arg(&location)
            .env_remove("NOTIFY_SOCKET")
            .output()?;
        ensure!(
            !output.status.success(),
            "anonymous remote startup succeeded"
        );
        let stderr = String::from_utf8(output.stderr)?;
        ensure!(
            stderr.contains(
                "non-loopback anonymous listener requires --unsafe-allow-remote-anonymous"
            ),
            "startup did not enforce anonymous boundary: {stderr}"
        );
        ensure!(!location.exists(), "rejected startup created a database");
    }
    Ok(())
}

#[test]
fn explicit_remote_consent_is_parsed_and_warns_before_read_only_open() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let missing = directory.path().join("missing");
    // A missing read-only store stops before socket binding; this test never
    // starts an unauthenticated non-loopback listener.
    let output = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args([
            "serve-read-only",
            "--unsafe-allow-remote-anonymous",
            "--bind",
            "192.0.2.1:7878",
            "--location",
        ])
        .arg(&missing)
        .env_remove("NOTIFY_SOCKET")
        .output()?;
    ensure!(!output.status.success(), "missing read-only store opened");
    let stderr = String::from_utf8(output.stderr)?;
    ensure!(stderr.contains("WARNING: unsafe anonymous remote access enabled"));
    ensure!(!stderr.contains("requires --unsafe-allow-remote-anonymous"));
    ensure!(!missing.exists());
    Ok(())
}
