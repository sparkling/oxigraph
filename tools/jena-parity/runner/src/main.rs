mod assertions;
mod canonical;
mod engine;
mod harness;
mod inventory;
mod lock;
mod model;

use std::process::ExitCode;

fn main() -> ExitCode {
    match execute() {
        Ok(summary) => {
            println!(
                "jena-parity: {} scenarios, {} assertions, domains={:?}, classifications={:?}",
                summary.scenarios, summary.assertions, summary.domains, summary.classifications
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("jena-parity failed: {error}");
            ExitCode::FAILURE
        }
    }
}

fn execute() -> Result<model::ReceiptCounts, String> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let root = harness::root()?;
    match arguments.as_slice() {
        [command] if command == "lock" => harness::refresh_lock(&root),
        [command] if command == "run" => harness::run(&root),
        _ => Err("usage: oxigraph-jena-parity <lock|run>".to_owned()),
    }
}
