use oxigraph::store::{
    LegacyBackupOptions, PreparedUpgrade, TransformedUpgrade, UpgradeTransformOptions,
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
}
