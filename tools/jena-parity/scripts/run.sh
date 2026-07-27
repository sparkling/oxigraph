#!/bin/sh
set -eu

parity_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$parity_root"

mise exec -- cargo test --manifest-path runner/Cargo.toml --locked
mise exec -- cargo clippy --manifest-path runner/Cargo.toml --locked --all-targets -- -D warnings
mise exec -- cargo run --manifest-path runner/Cargo.toml --locked -- run
