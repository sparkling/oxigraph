use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventoryIndex {
    pub profile_id: String,
    pub scope_statement: String,
    pub oracle: OracleIdentity,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OracleIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioFile {
    pub scenarios: Vec<Scenario>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub id: String,
    pub domain: String,
    pub operation: String,
    pub classification: Classification,
    pub normative_basis: String,
    pub reviewed: bool,
    #[serde(default)]
    pub syntax: Option<String>,
    #[serde(default)]
    pub output_syntax: Option<String>,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub update: Option<String>,
    #[serde(default)]
    pub shapes: Option<String>,
    #[serde(default)]
    pub reasoner: Option<String>,
    #[serde(default)]
    pub ordered: bool,
    pub assertions: Vec<Assertion>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Classification {
    Agreement,
    W3cOverridesJena,
    W3cPermittedDivergence,
    JenaExtension,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Assertion {
    pub target: AssertionTarget,
    pub pointer: String,
    pub equals: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssertionTarget {
    Both,
    Jena,
    Oxigraph,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub id: String,
    pub status: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

impl Observation {
    pub fn success(id: &str, kind: &str, value: Value) -> Self {
        Self {
            id: id.to_owned(),
            status: "success".to_owned(),
            kind: kind.to_owned(),
            value: Some(value),
            error_code: None,
            diagnostic_type: None,
            diagnostic: None,
        }
    }

    pub fn error(id: &str, diagnostic_type: &str) -> Self {
        Self {
            id: id.to_owned(),
            status: "error".to_owned(),
            kind: "error".to_owned(),
            value: None,
            error_code: Some("syntax-or-evaluation".to_owned()),
            diagnostic_type: Some(diagnostic_type.to_owned()),
            diagnostic: None,
        }
    }

    pub fn unsupported(id: &str, diagnostic: &str) -> Self {
        Self {
            id: id.to_owned(),
            status: "unsupported".to_owned(),
            kind: "unsupported".to_owned(),
            value: None,
            error_code: Some("unsupported-profile".to_owned()),
            diagnostic_type: None,
            diagnostic: Some(diagnostic.to_owned()),
        }
    }

    pub fn comparable(&self) -> ComparableObservation<'_> {
        ComparableObservation {
            status: &self.status,
            kind: &self.kind,
            value: self.value.as_ref(),
            error_code: self.error_code.as_deref(),
        }
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct ComparableObservation<'a> {
    status: &'a str,
    kind: &'a str,
    value: Option<&'a Value>,
    error_code: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JenaOutput {
    pub oracle: JenaIdentity,
    pub observations: Vec<Observation>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JenaIdentity {
    pub name: String,
    pub version: String,
    pub java: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileLock {
    pub profile_id: String,
    pub subject_sha256: String,
    pub inventory_sha256: BTreeMap<String, String>,
    pub scenario_count: usize,
    pub assertion_count: usize,
    pub domain_counts: BTreeMap<String, usize>,
    pub classification_counts: BTreeMap<Classification, usize>,
    pub source_sha256: BTreeMap<String, String>,
    pub dependency_sha256: BTreeMap<String, String>,
    pub toolchains: ToolchainLock,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ToolchainLock {
    pub java: String,
    pub maven: String,
    pub rustc: String,
    pub jena: String,
}

#[derive(Debug, Serialize)]
pub struct Receipt {
    pub schema_version: u32,
    pub gate_closed: bool,
    pub profile_id: String,
    pub scope_statement: String,
    pub subject_sha256: String,
    pub inventory_sha256: BTreeMap<String, String>,
    pub source_sha256: BTreeMap<String, String>,
    pub dependency_sha256: BTreeMap<String, String>,
    pub toolchains: ToolchainLock,
    pub scenarios: Vec<ScenarioReceipt>,
    pub counts: ReceiptCounts,
}

#[derive(Debug, Serialize)]
pub struct ScenarioReceipt {
    pub id: String,
    pub domain: String,
    pub classification: Classification,
    pub assertion_count: usize,
    pub jena: Observation,
    pub oxigraph: Observation,
}

#[derive(Debug, Default, Serialize)]
pub struct ReceiptCounts {
    pub scenarios: usize,
    pub assertions: usize,
    pub domains: BTreeMap<String, usize>,
    pub classifications: BTreeMap<Classification, usize>,
}
