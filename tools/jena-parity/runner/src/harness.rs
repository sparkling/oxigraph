use crate::assertions;
use crate::engine;
use crate::inventory::{self, LoadedInventory};
use crate::lock::{self, PreparedOracle};
use crate::model::{JenaOutput, Receipt, ReceiptCounts, ScenarioReceipt};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const OUTPUT_NAMES: [&str; 3] = [
    "parity-receipt.json",
    "resolved-inventory.json",
    "jena-observations.json",
];

pub fn root() -> Result<PathBuf, String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "runner manifest has no parent".to_owned())?
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize parity root: {error}"))
}

pub fn refresh_lock(root: &Path) -> Result<ReceiptCounts, String> {
    let inventory = inventory::load(root)?;
    let oracle = lock::prepare_oracle(root)?;
    let tools = lock::toolchains()?;
    let sources = lock::source_hashes(root)?;
    let subject = lock::subject_hash(repository_root(root)?)?;
    let profile = lock::build(&inventory, subject, sources, oracle.dependencies, tools);
    lock::write(root, &profile)?;
    Ok(counts(&inventory))
}

pub fn run(root: &Path) -> Result<ReceiptCounts, String> {
    let output = output_directory(root)?;
    invalidate_outputs(&output)?;
    let inventory = inventory::load(root)?;
    let oracle = lock::prepare_oracle(root)?;
    let tools = lock::toolchains()?;
    let sources = lock::source_hashes(root)?;
    let subject = lock::subject_hash(repository_root(root)?)?;
    let profile = lock::build(
        &inventory,
        subject,
        sources,
        oracle.dependencies.clone(),
        tools,
    );
    lock::verify(root, &profile)?;

    let resolved_path = output.join("resolved-inventory.json");
    lock::write_json(&resolved_path, &inventory.scenarios)?;
    let jena_path = output.join("jena-observations.json");
    run_jena(root, &oracle, &resolved_path, &jena_path)?;
    let jena = read_jena(&jena_path, &inventory)?;
    let mut jena_by_id = observations_by_id(jena.observations, "Jena")?;

    let mut receipts = Vec::with_capacity(inventory.scenarios.len());
    for scenario in &inventory.scenarios {
        let jena_observation = jena_by_id
            .remove(&scenario.id)
            .ok_or_else(|| format!("Jena omitted scenario {}", scenario.id))?;
        let oxigraph_observation = engine::observe(scenario);
        assertions::verify(scenario, &jena_observation, &oxigraph_observation)?;
        receipts.push(ScenarioReceipt {
            id: scenario.id.clone(),
            domain: scenario.domain.clone(),
            classification: scenario.classification,
            assertion_count: scenario.assertions.len(),
            jena: jena_observation,
            oxigraph: oxigraph_observation,
        });
    }
    if !jena_by_id.is_empty() {
        return Err(format!(
            "Jena returned unexpected scenarios: {:?}",
            jena_by_id.keys().collect::<Vec<_>>()
        ));
    }
    let summary = counts(&inventory);
    let receipt = Receipt {
        schema_version: 1,
        gate_closed: true,
        profile_id: inventory.index.profile_id,
        scope_statement: inventory.index.scope_statement,
        subject_sha256: profile.subject_sha256,
        inventory_sha256: profile.inventory_sha256,
        source_sha256: profile.source_sha256,
        dependency_sha256: profile.dependency_sha256,
        toolchains: profile.toolchains,
        scenarios: receipts,
        counts: summary,
    };
    let receipt_path = output.join("parity-receipt.json");
    lock::write_json(&receipt_path, &receipt)?;
    Ok(receipt.counts)
}

fn repository_root(root: &Path) -> Result<&Path, String> {
    root.parent()
        .and_then(Path::parent)
        .ok_or_else(|| "parity root has no repository ancestor".to_owned())
}

fn output_directory(root: &Path) -> Result<PathBuf, String> {
    let target = repository_root(root)?.join("target");
    ensure_real_directory(&target)?;
    let output = target.join("jena-parity");
    ensure_real_directory(&output)?;
    Ok(output)
}

fn ensure_real_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(format!(
            "output directory is not a real non-symlink directory: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|error| format!("cannot create output directory {}: {error}", path.display())),
        Err(error) => Err(format!(
            "cannot inspect output directory {}: {error}",
            path.display()
        )),
    }
}

fn run_jena(
    root: &Path,
    oracle: &PreparedOracle,
    inventory: &Path,
    output: &Path,
) -> Result<(), String> {
    lock::checked(
        Command::new("java")
            .current_dir(root)
            .arg("-cp")
            .arg(&oracle.classpath)
            .arg("org.oxigraph.parity.JenaOracle")
            .arg(inventory)
            .arg(output),
        "Jena oracle execution",
    )?;
    Ok(())
}

fn read_jena(path: &Path, inventory: &LoadedInventory) -> Result<JenaOutput, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect Jena output: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Jena output is not a regular non-symlink file".to_owned());
    }
    let bytes = fs::read(path).map_err(|error| format!("cannot read Jena output: {error}"))?;
    let output: JenaOutput =
        serde_json::from_slice(&bytes).map_err(|error| format!("invalid Jena output: {error}"))?;
    if output.oracle.name != inventory.index.oracle.name
        || output.oracle.version != inventory.index.oracle.version
        || output.oracle.java != "21.0.11"
    {
        return Err(format!(
            "Jena oracle identity drift: {} {} on Java {}",
            output.oracle.name, output.oracle.version, output.oracle.java
        ));
    }
    if output.observations.len() != inventory.scenarios.len() {
        return Err(format!(
            "Jena returned {} observations for {} scenarios",
            output.observations.len(),
            inventory.scenarios.len()
        ));
    }
    Ok(output)
}

fn observations_by_id(
    observations: Vec<crate::model::Observation>,
    engine: &str,
) -> Result<BTreeMap<String, crate::model::Observation>, String> {
    let mut result = BTreeMap::new();
    for observation in observations {
        if observation.id.is_empty() {
            return Err(format!("{engine} returned an empty observation id"));
        }
        if result.insert(observation.id.clone(), observation).is_some() {
            return Err(format!("{engine} returned a duplicate observation id"));
        }
    }
    Ok(result)
}

fn counts(inventory: &LoadedInventory) -> ReceiptCounts {
    let mut result = ReceiptCounts {
        scenarios: inventory.scenarios.len(),
        ..ReceiptCounts::default()
    };
    for scenario in &inventory.scenarios {
        result.assertions += scenario.assertions.len();
        *result.domains.entry(scenario.domain.clone()).or_default() += 1;
        *result
            .classifications
            .entry(scenario.classification)
            .or_default() += 1;
    }
    result
}

fn invalidate_outputs(output: &Path) -> Result<(), String> {
    for name in OUTPUT_NAMES {
        invalidate_output(&output.join(name))?;
    }
    Ok(())
}

fn invalidate_output(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::remove_file(path).map_err(|error| {
                format!("cannot invalidate old output {}: {error}", path.display())
            })
        }
        Ok(_) => Err(format!(
            "old output is not a regular non-symlink file: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "cannot inspect old output {}: {error}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TREE: AtomicU64 = AtomicU64::new(0);

    struct ScratchTree {
        repository: PathBuf,
        parity: PathBuf,
    }

    impl ScratchTree {
        fn new() -> Result<Self, String> {
            let repository = std::env::temp_dir().join(format!(
                "oxigraph-jena-parity-{}-{}",
                std::process::id(),
                NEXT_TREE.fetch_add(1, Ordering::Relaxed)
            ));
            let parity = repository.join("tools/jena-parity");
            fs::create_dir_all(&parity)
                .map_err(|error| format!("cannot create scratch tree: {error}"))?;
            Ok(Self { repository, parity })
        }
    }

    impl Drop for ScratchTree {
        fn drop(&mut self) {
            drop(fs::remove_dir_all(&self.repository));
        }
    }

    #[test]
    fn fixed_outputs_are_target_local_and_invalidated_together() -> Result<(), String> {
        let tree = ScratchTree::new()?;
        let output = output_directory(&tree.parity)?;
        assert_eq!(output, tree.repository.join("target/jena-parity"));
        for name in OUTPUT_NAMES {
            fs::write(output.join(name), b"stale")
                .map_err(|error| format!("cannot seed output: {error}"))?;
        }

        invalidate_outputs(&output)?;

        for name in OUTPUT_NAMES {
            assert!(!output.join(name).exists());
        }
        Ok(())
    }

    #[test]
    fn output_target_rejects_a_non_directory_component() -> Result<(), String> {
        let tree = ScratchTree::new()?;
        fs::write(tree.repository.join("target"), b"not a directory")
            .map_err(|error| format!("cannot seed target: {error}"))?;

        assert!(output_directory(&tree.parity).is_err());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn invalidation_rejects_a_symlinked_artifact() -> Result<(), String> {
        use std::os::unix::fs::symlink;

        let tree = ScratchTree::new()?;
        let output = output_directory(&tree.parity)?;
        let source = output.join("source.json");
        fs::write(&source, b"{}").map_err(|error| format!("cannot seed source: {error}"))?;
        symlink(&source, output.join(OUTPUT_NAMES[0]))
            .map_err(|error| format!("cannot seed symlink: {error}"))?;

        assert!(invalidate_outputs(&output).is_err());
        Ok(())
    }
}
