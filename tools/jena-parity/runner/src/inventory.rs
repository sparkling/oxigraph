use crate::model::{AssertionTarget, Classification, InventoryIndex, Scenario, ScenarioFile};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path};

pub struct LoadedInventory {
    pub index: InventoryIndex,
    pub scenarios: Vec<Scenario>,
    pub hashes: BTreeMap<String, String>,
}

pub fn load(root: &Path) -> Result<LoadedInventory, String> {
    let inventory_root = root.join("inventory");
    let index_path = inventory_root.join("index.json");
    let index_bytes = read_regular(&index_path)?;
    let index: InventoryIndex =
        serde_json::from_slice(&index_bytes).map_err(|error| format!("invalid index: {error}"))?;
    validate_index(&index)?;

    let mut hashes = BTreeMap::from([("inventory/index.json".to_owned(), sha256(&index_bytes))]);
    let mut scenarios = Vec::new();
    let mut ids = BTreeSet::new();
    for relative in &index.files {
        validate_relative(relative)?;
        let path = inventory_root.join(relative);
        let bytes = read_regular(&path)?;
        let key = format!("inventory/{relative}");
        if hashes.insert(key, sha256(&bytes)).is_some() {
            return Err(format!("duplicate inventory file {relative}"));
        }
        let scenario_file: ScenarioFile = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid inventory file {relative}: {error}"))?;
        if scenario_file.scenarios.is_empty() {
            return Err(format!("inventory file {relative} is empty"));
        }
        for scenario in scenario_file.scenarios {
            validate_scenario(&scenario)?;
            if !ids.insert(scenario.id.clone()) {
                return Err(format!("duplicate scenario id {}", scenario.id));
            }
            scenarios.push(scenario);
        }
    }
    if scenarios.is_empty() {
        return Err("inventory contains no scenarios".to_owned());
    }
    scenarios.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(LoadedInventory {
        index,
        scenarios,
        hashes,
    })
}

fn validate_index(index: &InventoryIndex) -> Result<(), String> {
    if index.profile_id.trim().is_empty() || index.scope_statement.trim().is_empty() {
        return Err("index profileId and scopeStatement must be non-empty".to_owned());
    }
    if index.oracle.name != "Apache Jena" || index.oracle.version != "6.1.0" {
        return Err("inventory must pin the Apache Jena 6.1.0 oracle".to_owned());
    }
    if index.files.is_empty() {
        return Err("index files must be non-empty".to_owned());
    }
    Ok(())
}

fn validate_relative(relative: &str) -> Result<(), String> {
    let path = Path::new(relative);
    if path.extension().and_then(|value| value.to_str()) != Some("json")
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe inventory path {relative}"));
    }
    Ok(())
}

fn validate_scenario(scenario: &Scenario) -> Result<(), String> {
    if scenario.id.is_empty()
        || !scenario
            .id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(format!("invalid scenario id {}", scenario.id));
    }
    if !matches!(
        scenario.domain.as_str(),
        "rdf" | "sparql" | "shacl" | "rdfs" | "owl2-rl"
    ) {
        return Err(format!("invalid domain for {}", scenario.id));
    }
    if !scenario.reviewed || scenario.normative_basis.trim().is_empty() {
        return Err(format!(
            "scenario {} must be reviewed with a normative basis",
            scenario.id
        ));
    }
    validate_classification(scenario)?;
    validate_operation(scenario)?;
    if scenario.assertions.is_empty() {
        return Err(format!("scenario {} has no assertions", scenario.id));
    }
    for assertion in &scenario.assertions {
        if !assertion.pointer.starts_with('/') {
            return Err(format!(
                "scenario {} has invalid JSON pointer {}",
                scenario.id, assertion.pointer
            ));
        }
        if matches!(assertion.target, AssertionTarget::Both)
            && matches!(
                scenario.classification,
                Classification::W3cOverridesJena
                    | Classification::W3cPermittedDivergence
                    | Classification::JenaExtension
            )
        {
            return Err(format!(
                "divergence scenario {} cannot use a both-target assertion",
                scenario.id
            ));
        }
    }
    Ok(())
}

fn validate_classification(scenario: &Scenario) -> Result<(), String> {
    let basis = scenario.normative_basis.as_str();
    match scenario.classification {
        Classification::Agreement => {
            if !basis.starts_with("https://www.w3.org/")
                && !basis.starts_with("https://jena.apache.org/")
            {
                return Err(format!("agreement {} has an unofficial basis", scenario.id));
            }
        }
        Classification::W3cOverridesJena => {
            if !basis.starts_with("https://www.w3.org/") {
                return Err(format!("W3C override {} lacks a W3C basis", scenario.id));
            }
        }
        Classification::W3cPermittedDivergence => {
            if !basis.starts_with("https://www.w3.org/") {
                return Err(format!(
                    "W3C-permitted divergence {} lacks a W3C basis",
                    scenario.id
                ));
            }
        }
        Classification::JenaExtension => {
            if !basis.starts_with("https://jena.apache.org/") {
                return Err(format!("Jena extension {} lacks a Jena basis", scenario.id));
            }
        }
        Classification::Unsupported => {}
    }
    Ok(())
}

fn validate_operation(scenario: &Scenario) -> Result<(), String> {
    let has_data = scenario.data.is_some();
    let has_query = scenario.query.is_some();
    let valid = match scenario.operation.as_str() {
        "rdf-parse" => has_data && scenario.syntax.is_some(),
        "rdf-roundtrip" => {
            has_data && scenario.syntax.is_some() && scenario.output_syntax.is_some()
        }
        "sparql-select" | "sparql-ask" | "sparql-construct" | "sparql-describe"
        | "sparql-service" => has_query,
        "sparql-update" => scenario.update.is_some(),
        "shacl-validate" | "shacl-sparql-validate" => scenario.shapes.is_some(),
        "entailment" => has_data && has_query && scenario.reasoner.is_some(),
        "sparql-unsupported" | "shacl-unsupported" => {
            matches!(scenario.classification, Classification::Unsupported)
        }
        _ => false,
    };
    if !valid {
        return Err(format!(
            "scenario {} has invalid fields for operation {}",
            scenario.id, scenario.operation
        ));
    }
    Ok(())
}

fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(format!(
            "{} is not a regular non-symlink file",
            path.display()
        ));
    }
    fs::read(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_components() {
        assert!(validate_relative("../escape.json").is_err());
        assert!(validate_relative("rdf.json").is_ok());
    }
}
