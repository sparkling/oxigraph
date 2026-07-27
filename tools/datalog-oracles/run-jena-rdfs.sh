#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: run-jena-rdfs.sh [--require|--if-available]" >&2
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
evidence_dir="$repo_root/target/datalog-oracles/jena-rdfs"
status_file="$evidence_dir/status.properties"
pom_file="$script_dir/jena/pom.xml"
runner_source="$script_dir/jena/src/main/java/org/oxigraph/oracle/JenaRdfsOracle.java"
input="$script_dir/fixtures/rdfs-schema.input.nt"
entailed="$script_dir/fixtures/rdfs-schema.entailed.nt"
not_entailed="$script_dir/fixtures/rdfs-schema.not-entailed.nt"
native_output="$evidence_dir/rdfs-schema.oxrdfs.tsv"
jena_output="$evidence_dir/rdfs-schema.jena.tsv"
mkdir -p "$evidence_dir"

jena_version="$(
  sed -nE 's:.*<jena\.version>([^<]+)</jena\.version>.*:\1:p' "$pom_file"
)"
if [[ ! "$jena_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: could not read an exact Jena version from $pom_file" >&2
  exit 1
fi

sha256_file() {
  openssl dgst -sha256 "$1" | sed -E 's/^.*= //'
}

source "$script_dir/pinned-jena-toolchain.sh"

write_classpath_manifest() {
  local classpath_file=$1
  local manifest_file=$2
  local temporary_file="$manifest_file.tmp.$$"
  local entries=()
  local classpath
  classpath="$(<"$classpath_file")"
  IFS=':' read -r -a entries <<<"$classpath"
  : >"$temporary_file"
  for entry in "${entries[@]}"; do
    if [[ ! -f "$entry" || -L "$entry" ]]; then
      echo "ERROR: Maven classpath entry is not a regular non-symlink file: $entry" >&2
      rm -f "$temporary_file"
      return 1
    fi
    printf '%s  %s\n' "$(sha256_file "$entry")" "$(basename "$entry")" \
      >>"$temporary_file"
  done
  LC_ALL=C sort -o "$temporary_file" "$temporary_file"
  mv "$temporary_file" "$manifest_file"
}

write_status() {
  {
    echo "profile=rdfs-finite-jena-reference"
    echo "state=$1"
    echo "required=$2"
    echo "jena_version=$jena_version"
    echo "fixtures=rdfs-schema"
    echo "entailed_assertions=10"
    echo "not_entailed_assertions=4"
    if [[ -n "$toolchain_java_version" ]]; then
      echo "java_version=$toolchain_java_version"
      echo "maven_version=$toolchain_maven_version"
      echo "rustc_version=$toolchain_rustc_version"
      echo "toolchain_config_sha256=$toolchain_config_sha256"
    fi
    if [[ "$#" -eq 3 ]]; then
      echo "reason=$3"
    fi
  } >"$status_file"
}

bootstrap_pinned_jena_toolchain \
  "$mode" "$required" "$script_dir/run-jena-rdfs.sh" "Jena RDFS differential oracle"

missing=()
for executable in cargo java mvn openssl rustc; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    missing+=("$executable")
  fi
done
if [[ "${#missing[@]}" -ne 0 ]]; then
  reason="missing executable(s): ${missing[*]}"
  if [[ "$mode" == "--if-available" ]]; then
    write_status "skipped" "false" "$reason"
    echo "SKIP: Jena RDFS differential oracle: $reason" >&2
    exit 0
  fi
  write_status "failed" "true" "$reason"
  echo "ERROR: Jena RDFS differential oracle: $reason" >&2
  exit 1
fi

if ! validate_pinned_jena_toolchain; then
  reason="pinned Java, Maven, or Rust toolchain validation failed"
  write_status "failed" "$required" "$reason"
  echo "ERROR: Jena RDFS differential oracle: $reason" >&2
  exit 1
fi

write_status "running" "$required"
finish() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" -ne 0 ]]; then
    write_status "failed" "$required" "oracle execution or comparison failed"
  fi
  exit "$exit_code"
}
trap finish EXIT

cargo run --locked --quiet -p oxrdfs --features rdf-12 --example jena_rdfs_reference -- \
  "$input" "$entailed" "$not_entailed" "$native_output"

(
  cd "$repo_root"
  mvn --batch-mode --quiet --no-transfer-progress \
    --file "$pom_file" \
    compile \
    dependency:build-classpath \
    -Dmdep.outputFile="$evidence_dir/classpath.txt"
)
classpath_manifest="$evidence_dir/classpath.sha256"
write_classpath_manifest "$evidence_dir/classpath.txt" "$classpath_manifest"
java_classpath="$script_dir/jena/target/classes:$(<"$evidence_dir/classpath.txt")"
java -cp "$java_classpath" \
  org.oxigraph.oracle.JenaRdfsOracle \
  "$input" "$entailed" "$not_entailed" "$jena_output"

cmp "$native_output" "$jena_output"

write_status "passed" "$required"
{
  echo "pom_sha256=$(sha256_file "$pom_file")"
  echo "runner_sha256=$(sha256_file "$runner_source")"
  echo "classpath_manifest_sha256=$(sha256_file "$classpath_manifest")"
  echo "input_sha256=$(sha256_file "$input")"
  echo "entailed_sha256=$(sha256_file "$entailed")"
  echo "not_entailed_sha256=$(sha256_file "$not_entailed")"
  echo "oxrdfs_sha256=$(sha256_file "$native_output")"
  echo "jena_sha256=$(sha256_file "$jena_output")"
} >>"$status_file"
echo "PASS: OxRDFS and Apache Jena $jena_version agree on 14 frozen RDFS assertions"
