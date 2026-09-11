use oxigraph::store::{
    LegacyBackupOptions, PreparedUpgrade, TransformedUpgrade, UpgradeActivation,
    UpgradeOptions, UpgradeReceipt, UpgradeRecovery, UpgradeRecoveryOptions,
    UpgradeTransformOptions, UpgradeWorkspaceInspection, UpgradeWorkspaceState,
};
use std::io::{Write, stdout};
use std::num::{NonZeroU64, NonZeroUsize};
use std::time::Duration;

pub fn legacy_options(
    max_files: Option<NonZeroUsize>,
    max_bytes: Option<NonZeroU64>,
    timeout_ms: Option<NonZeroU64>,
) -> LegacyBackupOptions {
    let mut options = LegacyBackupOptions::default();
    if let Some(value) = max_files {
        options.max_files = value;
    }
    if let Some(value) = max_bytes {
        options.max_bytes = value;
    }
    if let Some(value) = timeout_ms {
        options.control = options
            .control
            .with_timeout(Duration::from_millis(value.get()));
    }
    options
}

pub fn transform_options(
    max_files: Option<NonZeroUsize>,
    max_bytes: Option<NonZeroU64>,
    timeout_ms: Option<NonZeroU64>,
    max_entries: Option<NonZeroUsize>,
    max_projection_bytes: Option<NonZeroU64>,
) -> UpgradeTransformOptions {
    let mut options = UpgradeTransformOptions {
        backup: legacy_options(max_files, max_bytes, timeout_ms),
        ..UpgradeTransformOptions::default()
    };
    if let Some(value) = max_entries {
        options.max_entries = value;
    }
    if let Some(value) = max_projection_bytes {
        options.max_projection_bytes = value;
    }
    options
}

pub fn recovery_options(
    max_files: Option<NonZeroUsize>,
    max_bytes: Option<NonZeroU64>,
    timeout_ms: Option<NonZeroU64>,
    max_entries: Option<NonZeroUsize>,
    max_projection_bytes: Option<NonZeroU64>,
    max_attempts: Option<NonZeroUsize>,
) -> UpgradeRecoveryOptions {
    let mut options = UpgradeRecoveryOptions {
        transform: transform_options(
            max_files,
            max_bytes,
            timeout_ms,
            max_entries,
            max_projection_bytes,
        ),
        ..UpgradeRecoveryOptions::default()
    };
    if let Some(value) = max_attempts {
        options.max_attempts = value;
    }
    options
}

pub fn receipt_options(
    max_files: Option<NonZeroUsize>,
    max_bytes: Option<NonZeroU64>,
    timeout_ms: Option<NonZeroU64>,
    max_entries: Option<NonZeroUsize>,
    max_projection_bytes: Option<NonZeroU64>,
    max_attempts: Option<NonZeroUsize>,
) -> UpgradeOptions {
    UpgradeOptions {
        recovery: recovery_options(
            max_files, max_bytes, timeout_ms, max_entries, max_projection_bytes, max_attempts,
        ),
    }
}

fn print_recovery(value: UpgradeRecovery, outcome: &str) -> anyhow::Result<()> {
    let transformed_fingerprint = value
        .transformed()
        .map(|transformed| hex(transformed.fingerprint()))
        .unwrap_or_else(|| "not-published".into());
    writeln!(
        stdout().lock(),
        "{outcome} stage=recovery recovery_state={} storage_version={} attempts={} legacy_backup_fingerprint={} transformed_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} external_ancestry=exact active=false upgrade_authorized=false",
        if value.completed() {
            "completed"
        } else {
            "incomplete"
        },
        value.storage_version(),
        value.attempt_count(),
        hex(value.legacy_backup().fingerprint()),
        transformed_fingerprint,
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count()
    )?;
    Ok(())
}

pub fn print_recovery_started(value: UpgradeRecovery) -> anyhow::Result<()> {
    print_recovery(value, "upgrade_recovery_started=true")
}

pub fn print_recovery_resumed(value: UpgradeRecovery) -> anyhow::Result<()> {
    print_recovery(value, "upgrade_recovery_resumed=true")
}

pub fn print_recovery_verified(value: UpgradeRecovery) -> anyhow::Result<()> {
    print_recovery(value, "upgrade_recovery_verified=true")
}

fn print_receipt(value: &UpgradeReceipt, outcome: &str) -> anyhow::Result<()> {
    writeln!(
        stdout().lock(),
        "{outcome} stage=sealed workspace={} profile={} executable_len={} executable_sha256={} rocksdb_build_kind={} rocksdb_version={} rocksdb_source_revision={} rdf12={} legacy_backup_fingerprint={} transformed_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} output_files={} output_metadata_scope={} receipt_fingerprint={} active={} upgrade_authorized={}",
        serde_json::to_string(value.directory())?,
        value.profile(),
        value.executable_len(),
        hex(value.executable_sha256()),
        value.rocksdb_build_kind(),
        value.rocksdb_version(),
        value.rocksdb_source_revision(),
        value.rdf12(),
        hex(value.legacy_backup().fingerprint()),
        hex(value.transformed_fingerprint()),
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count(),
        value.output_file_count(),
        value.output_metadata_scope(),
        hex(value.fingerprint()),
        value.active(),
        value.upgrade_authorized(),
    )?;
    Ok(())
}

pub fn print_upgrade_started(
    value: &UpgradeRecovery,
    _directory: &std::path::Path,
) -> anyhow::Result<()> {
    let directory = value
        .directory()
        .parent()
        .ok_or_else(|| anyhow::anyhow!("nested upgrade recovery has no outer workspace"))?;
    writeln!(
        stdout().lock(),
        "upgrade_started=true stage=incomplete workspace={} recovery_workspace={} storage_version={} attempts={} legacy_backup_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} active=false upgrade_authorized=false",
        serde_json::to_string(directory)?,
        serde_json::to_string(value.directory())?,
        value.storage_version(),
        value.attempt_count(),
        hex(value.legacy_backup().fingerprint()),
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count(),
    )?;
    Ok(())
}

pub fn print_upgrade_resumed(value: &UpgradeReceipt) -> anyhow::Result<()> {
    print_receipt(value, "upgrade_resumed=true")
}

pub fn print_upgrade_completed(value: &UpgradeReceipt) -> anyhow::Result<()> {
    print_receipt(value, "upgrade_complete=true")
}

pub fn print_upgrade_verified(value: &UpgradeReceipt) -> anyhow::Result<()> {
    print_receipt(value, "upgrade_verified=true")
}

pub fn print_upgrade_inspected(value: &UpgradeWorkspaceInspection) -> anyhow::Result<()> {
    let transformed_fingerprint = value
        .transformed_fingerprint()
        .map(hex)
        .unwrap_or_else(|| "not-published".into());
    let receipt_fingerprint = value
        .receipt_fingerprint()
        .map(hex)
        .unwrap_or_else(|| "not-published".into());
    let receipt_status = match value.state() {
        UpgradeWorkspaceState::ReceiptPending => "pending-verified",
        UpgradeWorkspaceState::Sealed => "sealed",
        _ => "absent",
    };
    let recovery_state = if value.transformed_fingerprint().is_some() {
        "completed"
    } else {
        "incomplete"
    };
    writeln!(
        stdout().lock(),
        "upgrade_inspected=true stage={} workspace={} profile={} executable_len={} executable_sha256={} rocksdb_build_kind={} rocksdb_version={} rocksdb_source_revision={} rdf12={} recovery_state={} legacy_backup_fingerprint={} transformed_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} receipt_status={} receipt_fingerprint={} external_ancestry=exact active={} upgrade_authorized={}",
        value.state().as_str(),
        serde_json::to_string(value.directory())?,
        value.profile(),
        value.executable_len(),
        hex(value.executable_sha256()),
        value.rocksdb_build_kind(),
        value.rocksdb_version(),
        value.rocksdb_source_revision(),
        value.rdf12(),
        recovery_state,
        hex(value.legacy_backup().fingerprint()),
        transformed_fingerprint,
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count(),
        receipt_status,
        receipt_fingerprint,
        value.active(),
        value.upgrade_authorized(),
    )?;
    Ok(())
}


pub fn print_upgrade_activated(value: &UpgradeActivation) -> anyhow::Result<()> {
    let receipt = value.upgrade_receipt();
    writeln!(
        stdout().lock(),
        "upgrade_activated=true stage=activated target={} workspace={} profile={} upgrade_receipt_fingerprint={} transformed_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} output_files={} active={}",
        serde_json::to_string(value.directory())?,
        serde_json::to_string(receipt.directory())?,
        receipt.profile(),
        hex(value.upgrade_receipt_fingerprint()),
        hex(receipt.transformed_fingerprint()),
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count(),
        receipt.output_file_count(),
        value.active(),
    )?;
    Ok(())
}

fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn print_prepared(value: PreparedUpgrade, outcome: &str, ancestry: &str) -> anyhow::Result<()> {
    writeln!(
        stdout().lock(),
        "{outcome} stage=prepared storage_version={} files={} legacy_backup_fingerprint={} external_ancestry={ancestry} active=false upgrade_authorized=false",
        value.legacy_backup().storage_version(),
        value.legacy_backup().files().len(),
        hex(value.legacy_backup().fingerprint())
    )?;
    Ok(())
}

pub fn print_preparation_created(value: PreparedUpgrade) -> anyhow::Result<()> {
    print_prepared(value, "upgrade_preparation_complete=true", "exact")
}

pub fn print_preparation_verified(value: PreparedUpgrade) -> anyhow::Result<()> {
    print_prepared(value, "upgrade_preparation_verified=true", "not-checked")
}

fn print_transformed(value: TransformedUpgrade, outcome: &str) -> anyhow::Result<()> {
    writeln!(
        stdout().lock(),
        "{outcome} stage=transformed files={} transformed_fingerprint={} logical_fingerprint={} quads={} named_graphs={} namespaces={} external_ancestry=exact active=false upgrade_authorized=false",
        value.files().len(),
        hex(value.fingerprint()),
        hex(value.logical_fingerprint()),
        value.quad_count(),
        value.named_graph_count(),
        value.namespace_count()
    )?;
    Ok(())
}

pub fn print_transformation_created(value: TransformedUpgrade) -> anyhow::Result<()> {
    print_transformed(value, "upgrade_transformation_complete=true")
}

pub fn print_transformation_verified(value: TransformedUpgrade) -> anyhow::Result<()> {
    print_transformed(value, "upgrade_transformation_verified=true")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_option_adapter_preserves_defaults_and_maps_every_override() {
        let defaults = UpgradeRecoveryOptions::default();
        let adapted = recovery_options(None, None, None, None, None, None);
        assert_eq!(adapted.max_attempts, defaults.max_attempts);
        assert_eq!(
            adapted.transform.backup.max_files,
            defaults.transform.backup.max_files
        );
        assert_eq!(
            adapted.transform.backup.max_bytes,
            defaults.transform.backup.max_bytes
        );
        assert_eq!(
            adapted.transform.backup.control.timeout(),
            defaults.transform.backup.control.timeout()
        );
        assert_eq!(
            adapted.transform.max_entries,
            defaults.transform.max_entries
        );
        assert_eq!(
            adapted.transform.max_projection_bytes,
            defaults.transform.max_projection_bytes
        );

        let adapted = recovery_options(
            NonZeroUsize::new(7),
            NonZeroU64::new(11),
            NonZeroU64::new(13),
            NonZeroUsize::new(17),
            NonZeroU64::new(19),
            NonZeroUsize::new(23),
        );
        assert_eq!(adapted.transform.backup.max_files.get(), 7);
        assert_eq!(adapted.transform.backup.max_bytes.get(), 11);
        assert_eq!(
            adapted.transform.backup.control.timeout(),
            Some(Duration::from_millis(13))
        );
        assert_eq!(adapted.transform.max_entries.get(), 17);
        assert_eq!(adapted.transform.max_projection_bytes.get(), 19);
        assert_eq!(adapted.max_attempts.get(), 23);
    }

    #[test]
    fn option_adapters_preserve_defaults_and_map_every_override() {
        let defaults = LegacyBackupOptions::default();
        let adapted = legacy_options(None, None, None);
        assert_eq!(adapted.max_files, defaults.max_files);
        assert_eq!(adapted.max_bytes, defaults.max_bytes);
        assert_eq!(adapted.control.timeout(), None);

        let adapted = legacy_options(
            NonZeroUsize::new(7),
            NonZeroU64::new(11),
            NonZeroU64::new(41),
        );
        assert_eq!(adapted.max_files.get(), 7);
        assert_eq!(adapted.max_bytes.get(), 11);
        assert_eq!(adapted.control.timeout(), Some(Duration::from_millis(41)));

        let defaults = UpgradeTransformOptions::default();
        let adapted = transform_options(
            NonZeroUsize::new(13),
            NonZeroU64::new(17),
            NonZeroU64::new(43),
            NonZeroUsize::new(19),
            NonZeroU64::new(23),
        );
        assert_eq!(adapted.backup.max_files.get(), 13);
        assert_eq!(adapted.backup.max_bytes.get(), 17);
        assert_eq!(
            adapted.backup.control.timeout(),
            Some(Duration::from_millis(43))
        );
        assert_eq!(adapted.max_entries.get(), 19);
        assert_eq!(adapted.max_projection_bytes.get(), 23);
        assert_ne!(adapted.max_entries, defaults.max_entries);
        assert_ne!(adapted.max_projection_bytes, defaults.max_projection_bytes);
    }
    #[test]
    fn receipt_option_adapter_preserves_defaults_and_maps_every_override() {
        let defaults = UpgradeOptions::default();
        let adapted = receipt_options(None, None, None, None, None, None);
        assert_eq!(adapted.recovery.max_attempts, defaults.recovery.max_attempts);
        assert_eq!(
            adapted.recovery.transform.backup.max_files,
            defaults.recovery.transform.backup.max_files
        );
        assert_eq!(
            adapted.recovery.transform.backup.max_bytes,
            defaults.recovery.transform.backup.max_bytes
        );
        assert_eq!(
            adapted.recovery.transform.max_entries,
            defaults.recovery.transform.max_entries
        );
        assert_eq!(
            adapted.recovery.transform.max_projection_bytes,
            defaults.recovery.transform.max_projection_bytes
        );

        let adapted = receipt_options(
            NonZeroUsize::new(7),
            NonZeroU64::new(11),
            NonZeroU64::new(13),
            NonZeroUsize::new(17),
            NonZeroU64::new(19),
            NonZeroUsize::new(23),
        );
        assert_eq!(adapted.recovery.transform.backup.max_files.get(), 7);
        assert_eq!(adapted.recovery.transform.backup.max_bytes.get(), 11);
        assert_eq!(
            adapted.recovery.transform.backup.control.timeout(),
            Some(Duration::from_millis(13))
        );
        assert_eq!(adapted.recovery.transform.max_entries.get(), 17);
        assert_eq!(
            adapted.recovery.transform.max_projection_bytes.get(),
            19
        );
        assert_eq!(adapted.recovery.max_attempts.get(), 23);
    }

}
