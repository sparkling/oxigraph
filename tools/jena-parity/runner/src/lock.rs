use crate::inventory::{LoadedInventory, sha256};
use crate::model::{ProfileLock, ToolchainLock};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const EXPECTED_JAVA: &str = "21.0.11";
const EXPECTED_MAVEN: &str = "3.9.11";
const EXPECTED_RUSTC: &str = "1.96.0";
const EXPECTED_JENA: &str = "6.1.0";

pub struct PreparedOracle {
    pub classpath: OsString,
    pub dependencies: BTreeMap<String, String>,
}

pub fn prepare_oracle(root: &Path) -> Result<PreparedOracle, String> {
    checked(
        Command::new("mvn").current_dir(root).args([
            "--batch-mode",
            "--no-transfer-progress",
            "-f",
            "oracle/pom.xml",
            "verify",
        ]),
        "Maven oracle verification",
    )?;
    let classpath_file = root.join("oracle/target/runtime-classpath.txt");
    let output_argument = format!("-Dmdep.outputFile={}", classpath_file.display());
    checked(
        Command::new("mvn")
            .current_dir(root)
            .args([
                "--batch-mode",
                "--no-transfer-progress",
                "-f",
                "oracle/pom.xml",
                "dependency:build-classpath",
                "-DincludeScope=runtime",
            ])
            .arg(output_argument),
        "Maven runtime classpath resolution",
    )?;
    let raw = fs::read_to_string(&classpath_file)
        .map_err(|error| format!("cannot read Maven classpath: {error}"))?;
    let paths = std::env::split_paths(raw.trim()).collect::<Vec<_>>();
    if paths.is_empty() {
        return Err("Maven runtime classpath is empty".to_owned());
    }
    let mut dependencies = BTreeMap::new();
    for path in &paths {
        let bytes = read_regular(path)?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("dependency has no UTF-8 filename: {}", path.display()))?;
        if dependencies
            .insert(name.to_owned(), sha256(&bytes))
            .is_some()
        {
            return Err(format!("duplicate dependency filename {name}"));
        }
    }
    let mut full_classpath = vec![root.join("oracle/target/classes")];
    full_classpath.extend(paths);
    let classpath = std::env::join_paths(full_classpath)
        .map_err(|error| format!("cannot build Java classpath: {error}"))?;
    Ok(PreparedOracle {
        classpath,
        dependencies,
    })
}

pub fn toolchains() -> Result<ToolchainLock, String> {
    let java_output = checked(Command::new("java").arg("-version"), "Java version check")?;
    let java_text = output_text(&java_output);
    let java = java_text
        .split('"')
        .nth(1)
        .ok_or_else(|| format!("cannot parse Java version from {java_text:?}"))?
        .to_owned();

    let maven_output = checked(Command::new("mvn").arg("--version"), "Maven version check")?;
    let maven_text = output_text(&maven_output);
    let maven = maven_text
        .lines()
        .find_map(|line| line.strip_prefix("Apache Maven "))
        .and_then(|rest| rest.split_whitespace().next())
        .ok_or_else(|| format!("cannot parse Maven version from {maven_text:?}"))?
        .to_owned();

    let rustc_output = checked(Command::new("rustc").arg("--version"), "Rust version check")?;
    let rustc_text = output_text(&rustc_output);
    let rustc = rustc_text
        .strip_prefix("rustc ")
        .and_then(|rest| rest.split_whitespace().next())
        .ok_or_else(|| format!("cannot parse Rust version from {rustc_text:?}"))?
        .to_owned();

    let observed = ToolchainLock {
        java,
        maven,
        rustc,
        jena: EXPECTED_JENA.to_owned(),
    };
    let expected = expected_toolchains();
    if observed != expected {
        return Err(format!(
            "toolchain drift: expected {expected:?}, observed {observed:?}"
        ));
    }
    Ok(observed)
}

pub fn source_hashes(root: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files, false)?;
    files.sort();
    let mut hashes = BTreeMap::new();
    for relative in files {
        let key = format!("harness/{}", display_path(&relative)?);
        let bytes = read_regular(&root.join(&relative))?;
        hashes.insert(key, sha256(&bytes));
    }
    Ok(hashes)
}

pub fn build(
    inventory: &LoadedInventory,
    subject: String,
    sources: BTreeMap<String, String>,
    dependencies: BTreeMap<String, String>,
    tools: ToolchainLock,
) -> ProfileLock {
    let mut domain_counts = BTreeMap::new();
    let mut classification_counts = BTreeMap::new();
    let mut assertion_count = 0;
    for scenario in &inventory.scenarios {
        *domain_counts.entry(scenario.domain.clone()).or_default() += 1;
        *classification_counts
            .entry(scenario.classification)
            .or_default() += 1;
        assertion_count += scenario.assertions.len();
    }
    ProfileLock {
        profile_id: inventory.index.profile_id.clone(),
        subject_sha256: subject,
        inventory_sha256: inventory.hashes.clone(),
        scenario_count: inventory.scenarios.len(),
        assertion_count,
        domain_counts,
        classification_counts,
        source_sha256: sources,
        dependency_sha256: dependencies,
        toolchains: tools,
    }
}

pub fn write(root: &Path, lock: &ProfileLock) -> Result<(), String> {
    let path = root.join("profile.lock.json");
    write_json(&path, lock)
}

pub fn verify(root: &Path, actual: &ProfileLock) -> Result<(), String> {
    let path = root.join("profile.lock.json");
    let bytes = read_regular(&path)?;
    let expected: ProfileLock =
        serde_json::from_slice(&bytes).map_err(|error| format!("invalid profile lock: {error}"))?;
    if &expected == actual {
        Ok(())
    } else {
        let expected_json = serde_json::to_string_pretty(&expected)
            .map_err(|error| format!("cannot encode expected lock: {error}"))?;
        let actual_json = serde_json::to_string_pretty(actual)
            .map_err(|error| format!("cannot encode actual lock: {error}"))?;
        Err(format!(
            "profile drift detected\nexpected:\n{expected_json}\nobserved:\n{actual_json}"
        ))
    }
}

pub fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path)
        && metadata.file_type().is_symlink()
    {
        return Err(format!("refusing to overwrite symlink {}", path.display()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("JSON encoding failed: {error}"))?;
    bytes.push(b'\n');
    fs::write(path, bytes).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

pub fn checked(command: &mut Command, label: &str) -> Result<Output, String> {
    let output = command
        .output()
        .map_err(|error| format!("{label} could not start: {error}"))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "{label} failed with {}\n{}",
            output.status,
            output_text(&output)
        ))
    }
}

fn expected_toolchains() -> ToolchainLock {
    ToolchainLock {
        java: EXPECTED_JAVA.to_owned(),
        maven: EXPECTED_MAVEN.to_owned(),
        rustc: EXPECTED_RUSTC.to_owned(),
        jena: EXPECTED_JENA.to_owned(),
    }
}

fn collect_files(
    root: &Path,
    directory: &Path,
    output: &mut Vec<PathBuf>,
    subject: bool,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("directory entry error: {error}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("cannot relativize {}: {error}", path.display()))?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("source tree contains symlink {}", path.display()));
        }
        if metadata.is_dir() {
            let name = entry.file_name();
            if !subject && matches!(name.to_str(), Some("target" | "receipts" | "inventory")) {
                continue;
            }
            collect_files(root, &path, output, subject)?;
        } else if metadata.is_file()
            && (subject
                || relative.file_name().and_then(|value| value.to_str())
                    != Some("profile.lock.json"))
        {
            output.push(relative.to_path_buf());
        }
    }
    Ok(())
}

pub fn subject_hash(repository: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect_files(
        &repository.join("lib"),
        &repository.join("lib"),
        &mut files,
        true,
    )?;
    files.retain(|path| {
        matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("rs" | "toml")
        )
    });
    for name in ["Cargo.toml", "Cargo.lock"] {
        files.push(PathBuf::from(format!("../{name}")));
    }
    files.sort();
    let mut digest = Sha256::new();
    for relative in files {
        let path = repository.join("lib").join(&relative);
        let bytes = read_regular(&path)?;
        digest.update(display_path(&relative)?.as_bytes());
        digest.update([0]);
        digest.update(bytes.len().to_le_bytes());
        digest.update(bytes);
    }
    Ok(hex::encode(digest.finalize()))
}

fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!(
            "{} is not a regular non-symlink file",
            path.display()
        ));
    }
    fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn display_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.replace('\\', "/"))
        .ok_or_else(|| format!("non-UTF-8 path {}", path.display()))
}

fn output_text(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}
