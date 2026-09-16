use crate::cli::SchemaRdfProfileArg;
use crate::upgrade;
use oxigraph::store::{
    SchemaRdfProfile, SchemaUpgradeActivation, SchemaUpgradeOptions, SchemaUpgradeReceipt,
    SchemaUpgradeState,
};
use std::io::{Write, stdout};
use std::num::{NonZeroU64, NonZeroUsize};
use std::path::Path;

fn rdf_profile(value: SchemaRdfProfileArg) -> SchemaRdfProfile {
    match value {
        SchemaRdfProfileArg::Rdf11 => SchemaRdfProfile::Rdf11,
        SchemaRdfProfileArg::Rdf12 => SchemaRdfProfile::Rdf12,
    }
}

pub fn schema_upgrade_options(
    profile: SchemaRdfProfileArg,
    max_files: Option<NonZeroUsize>,
    max_bytes: Option<NonZeroU64>,
    timeout_ms: Option<NonZeroU64>,
    max_entries: Option<NonZeroUsize>,
    max_projection_bytes: Option<NonZeroU64>,
    max_attempts: Option<NonZeroUsize>,
) -> SchemaUpgradeOptions {
    let mut options = SchemaUpgradeOptions::new(rdf_profile(profile));
    options.limits = upgrade::recovery_options(
        max_files,
        max_bytes,
        timeout_ms,
        max_entries,
        max_projection_bytes,
        max_attempts,
    );
    options
}

fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn print_schema_upgrade_started(
    value: &SchemaUpgradeState,
    workspace: &Path,
) -> anyhow::Result<()> {
    writeln!(
        stdout().lock(),
        "schema_upgrade_started=true stage=incomplete workspace={} schema_uuid={} rdf_profile={} sealed=false active=false upgrade_authorized=false",
        serde_json::to_string(workspace)?,
        value.schema_uuid(),
        value.envelope().rdf_write_profile().as_str(),
    )?;
    Ok(())
}

fn print_receipt(value: &SchemaUpgradeReceipt, outcome: &str) -> anyhow::Result<()> {
    writeln!(
        stdout().lock(),
        "{outcome} stage=sealed workspace={} schema_uuid={} rdf_profile={} contributor_scope={} backup_fingerprint={} primary_fingerprint={} primary_records={} primary_bytes={} receipt_fingerprint={} active=false upgrade_authorized=false",
        serde_json::to_string(value.directory())?,
        value.schema_uuid(),
        value.envelope().rdf_write_profile().as_str(),
        value.contributor_scope(),
        hex(value.backup_fingerprint()),
        hex(value.primary_fingerprint()),
        value.primary_records(),
        value.primary_bytes(),
        hex(value.fingerprint()),
    )?;
    Ok(())
}

pub fn print_schema_upgrade_resumed(value: &SchemaUpgradeState) -> anyhow::Result<()> {
    if let Some(receipt) = value.receipt() {
        return print_receipt(receipt, "schema_upgrade_resumed=true");
    }
    writeln!(
        stdout().lock(),
        "schema_upgrade_resumed=true stage=incomplete workspace={} schema_uuid={} sealed=false active=false upgrade_authorized=false",
        serde_json::to_string(value.directory())?,
        value.schema_uuid(),
    )?;
    Ok(())
}

pub fn print_schema_upgrade_verified(value: &SchemaUpgradeReceipt) -> anyhow::Result<()> {
    print_receipt(value, "schema_upgrade_verified=true")
}

pub fn print_schema_upgrade_activated(value: &SchemaUpgradeActivation) -> anyhow::Result<()> {
    let receipt = value.schema_upgrade_receipt();
    writeln!(
        stdout().lock(),
        "schema_upgrade_activated=true stage=activated target={} workspace={} schema_uuid={} rdf_profile={} primary_fingerprint={} primary_records={} primary_bytes={} receipt_fingerprint={} active={} upgrade_authorized=false current_schema=false",
        serde_json::to_string(value.directory())?,
        serde_json::to_string(receipt.directory())?,
        value.schema_uuid(),
        receipt.envelope().rdf_write_profile().as_str(),
        hex(value.primary_fingerprint()),
        value.primary_records(),
        value.primary_bytes(),
        hex(receipt.fingerprint()),
        value.active(),
    )?;
    Ok(())
}
