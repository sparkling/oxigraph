#!/usr/bin/env bash

toolchain_config="$repo_root/tools/jena-parity/.mise.toml"
toolchain_java_version=""
toolchain_maven_version=""
toolchain_rustc_version=""
toolchain_config_sha256=""

bootstrap_pinned_jena_toolchain() {
  local mode=$1
  local required=$2
  local script_path=$3
  local label=$4
  local reason

  if [[ "${OXIGRAPH_PINNED_JENA_TOOLCHAIN:-}" == "1" ]]; then
    return
  fi
  if ! command -v mise >/dev/null 2>&1; then
    reason="missing executable: mise"
    if [[ "$mode" == "--if-available" ]]; then
      write_status "skipped" "false" "$reason"
      echo "SKIP: $label: $reason" >&2
      exit 0
    fi
    write_status "failed" "$required" "$reason"
    echo "ERROR: $label: $reason" >&2
    exit 1
  fi
  if [[ ! -f "$toolchain_config" || -L "$toolchain_config" ]]; then
    reason="pinned Jena toolchain configuration is missing or unsafe"
    write_status "failed" "$required" "$reason"
    echo "ERROR: $label: $reason" >&2
    exit 1
  fi
  exec env OXIGRAPH_PINNED_JENA_TOOLCHAIN=1 \
    mise exec -C "$(dirname "$toolchain_config")" -- \
    bash "$script_path" "$mode"
}

validate_pinned_jena_toolchain() {
  local expected_java
  local expected_maven
  local expected_rustc
  local java_output
  local maven_output
  local maven_java_version
  local rustc_output

  expected_java="$(
    sed -nE 's/^java = "temurin-([0-9]+\.[0-9]+\.[0-9]+).*"/\1/p' \
      "$toolchain_config"
  )"
  expected_maven="$(
    sed -nE 's/^maven = "([0-9]+\.[0-9]+\.[0-9]+)"/\1/p' \
      "$toolchain_config"
  )"
  expected_rustc="$(
    sed -nE 's/^rust = "([0-9]+\.[0-9]+\.[0-9]+)"/\1/p' \
      "$toolchain_config"
  )"
  if [[ -z "$expected_java" || -z "$expected_maven" || -z "$expected_rustc" ]]; then
    echo "pinned Jena toolchain configuration is malformed" >&2
    return 1
  fi

  java_output="$(java -version 2>&1)"
  maven_output="$(mvn --version 2>&1)"
  rustc_output="$(rustc --version 2>&1)"
  toolchain_java_version="$(
    sed -nE '1s/^[^0-9]*"?([0-9]+\.[0-9]+\.[0-9]+).*$/\1/p' \
      <<<"$java_output"
  )"
  toolchain_maven_version="$(
    sed -nE 's/^Apache Maven ([0-9]+\.[0-9]+\.[0-9]+).*$/\1/p' \
      <<<"$maven_output"
  )"
  maven_java_version="$(
    sed -nE 's/^Java version: ([0-9]+\.[0-9]+\.[0-9]+),.*$/\1/p' \
      <<<"$maven_output"
  )"
  toolchain_rustc_version="$(
    sed -nE 's/^rustc ([0-9]+\.[0-9]+\.[0-9]+).*$/\1/p' \
      <<<"$rustc_output"
  )"
  if [[ "$toolchain_java_version" != "$expected_java" ||
        "$maven_java_version" != "$expected_java" ||
        "$toolchain_maven_version" != "$expected_maven" ||
        "$toolchain_rustc_version" != "$expected_rustc" ]]; then
    echo "pinned Jena toolchain drift: expected Java $expected_java, Maven $expected_maven, and Rust $expected_rustc; observed Java $toolchain_java_version, Maven-on-Java $maven_java_version, Maven $toolchain_maven_version, and Rust $toolchain_rustc_version" >&2
    return 1
  fi
  toolchain_config_sha256="$(sha256_file "$toolchain_config")"
}
