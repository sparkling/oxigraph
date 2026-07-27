#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: run-souffle.sh [--require|--if-available]" >&2
}

mode="${1:---require}"
if [[ "$#" -gt 1 || ("$mode" != "--require" && "$mode" != "--if-available") ]]; then
  usage
  exit 2
fi
required=false
if [[ "$mode" == "--require" ]]; then
  required=true
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source_file="$script_dir/souffle/safe-path.dl"
fixture_dir="$script_dir/souffle/fixtures"
example_file="$repo_root/lib/oxdatalog/examples/d1_reference.rs"
evidence_dir="$repo_root/target/datalog-oracles/souffle"
status_file="$evidence_dir/status.properties"
expected_version="2.5"
mkdir -p "$evidence_dir"

sha256_file() {
  openssl dgst -sha256 "$1" | sed -E 's/^.*= //'
}

write_status() {
  {
    echo "profile=datalog-d1-souffle-reference"
    echo "state=$1"
    echo "required=$2"
    echo "souffle_version=${3:-unavailable}"
    echo "fixtures=safe-path"
    if [[ "$#" -eq 4 ]]; then
      echo "reason=$4"
    fi
  } >"$status_file"
}

missing=()
for executable in cargo cmp openssl souffle; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    missing+=("$executable")
  fi
done
if [[ "${#missing[@]}" -ne 0 ]]; then
  reason="missing executable(s): ${missing[*]}"
  if [[ "$mode" == "--if-available" ]]; then
    write_status "skipped" "false" "unavailable" "$reason"
    echo "SKIP: Souffle differential oracle: $reason" >&2
    exit 0
  fi
  write_status "failed" "true" "unavailable" "$reason"
  echo "ERROR: Souffle differential oracle: $reason" >&2
  exit 1
fi

version_output="$(souffle --version 2>&1)"
version="$(sed -nE 's/.*([0-9]+\.[0-9]+(\.[0-9]+)?).*/\1/p' <<<"$version_output" | head -n 1)"
if [[ "$version" != "$expected_version" && "$version" != "$expected_version.0" ]]; then
  reason="expected Souffle $expected_version, found ${version:-unknown}"
  write_status "failed" "$required" "${version:-unknown}" "$reason"
  echo "ERROR: $reason" >&2
  exit 1
fi

write_status "running" "$required" "$version"
finish() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 ]]; then
    write_status "failed" "$required" "$version" "oracle execution or comparison failed"
  fi
  exit "$exit_code"
}
trap finish EXIT

native_output="$evidence_dir/path.oxdatalog.tsv"
souffle_output="$evidence_dir/path.tsv"
expected_output="$fixture_dir/path.expected.tsv"
rm -f "$native_output" "$souffle_output"

(
  cd "$repo_root"
  cargo run --locked --quiet -p oxdatalog --example d1_reference -- \
    "$fixture_dir" "$native_output"
)
souffle -F "$fixture_dir" -D "$evidence_dir" "$source_file"
cmp "$expected_output" "$native_output"
cmp "$expected_output" "$souffle_output"
cmp "$native_output" "$souffle_output"

write_status "passed" "$required" "$version"
{
  echo "source_sha256=$(sha256_file "$source_file")"
  echo "example_sha256=$(sha256_file "$example_file")"
  for file in edge.facts banned.facts path.expected.tsv; do
    key="${file//./_}"
    echo "${key}_sha256=$(sha256_file "$fixture_dir/$file")"
  done
  echo "oxdatalog_sha256=$(sha256_file "$native_output")"
  echo "souffle_sha256=$(sha256_file "$souffle_output")"
} >>"$status_file"
echo "PASS: OxDatalog D1 matches Souffle $version on the frozen safe-path fixture"
