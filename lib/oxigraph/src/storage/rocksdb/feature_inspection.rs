use super::*;
use std::time::Instant;

fn check(
    control: &TransactionStartControl,
    started_at: Instant,
) -> Result<(), StorageError> {
    control.check(started_at).map_err(|_| {
        StorageError::Other("feature inspection was cancelled or timed out".into())
    })
}

impl RocksDbStorage {
    pub fn inspect_features(
        path: &Path,
        control: &TransactionStartControl,
    ) -> Result<crate::store::StoreFeatureInspection, StorageError> {
        let started_at = Instant::now();
        check(control, started_at)?;
        reject_incomplete_upgrade(path)?;
        let format = Self::inspect(path)?;
        if !format.unexpected_column_families().is_empty() {
            return Err(StorageError::SchemaUnknown);
        }
        let version = format.storage_version().ok_or(StorageError::SchemaUnknown)?;
        if version > LATEST_STORAGE_VERSION {
            return Err(StorageError::SchemaTooNew {
                found: version,
                supported: LATEST_STORAGE_VERSION,
            });
        }
        if version < LATEST_STORAGE_VERSION
            && legacy_layout(version, format.missing_column_families())
        {
            return Err(StorageError::UpgradeRequired {
                found: version,
                supported: LATEST_STORAGE_VERSION,
            });
        }
        if version != LATEST_STORAGE_VERSION
            || !format.missing_column_families().is_empty()
        {
            return Err(StorageError::SchemaUnknown);
        }
        check(control, started_at)?;
        let live_rdf_12_required =
            Self::contains_rdf_12_terms(path, DbOptions::default())?;
        check(control, started_at)?;

        // Open only the default metadata/outbox family. Do not construct a Store,
        // call setup, migrate, or decode namespaces and primary-index terms.
        let db = Db::open_read_only_with_options(path, Vec::new(), DbOptions::default())?;
        let default_cf = db.column_family(DEFAULT_CF)?;
        let reader = db.snapshot();
        let state = reader.get(&default_cf, GOVERNANCE_STATE_KEY)?;
        let state = state.as_deref().map(GovernanceState::decode).transpose()?;
        let first = reader.scan_prefix(&default_cf, OUTBOX_RECORD_PREFIX);
        first.status()?;
        let physical_gc = state
            .as_ref()
            .map_or(0, crate::store::retention::physical_gc);
        let high = state
            .as_ref()
            .and_then(|state| state.outbox.as_ref())
            .map_or(0, |state| state.high_water);
        let expected = (physical_gc < high).then(|| outbox_record_key(physical_gc + 1));
        if first.key() != expected.as_deref() {
            return Err(CorruptionError::msg("invalid outbox origin key").into());
        }
        let retained = crate::store::outbox::inspect_retained_features(
            state.as_ref(),
            |position| Self::read_outbox_record_from(&reader, &default_cf, position),
            |key| {
                if reader
                    .get(&default_cf, &transaction_outcome_key(key))?
                    .is_some()
                {
                    return Err(
                        CorruptionError::msg("outbox key also has a legacy outcome").into(),
                    );
                }
                let value = reader.get(&default_cf, &governed_outcome_key(key))?;
                value
                    .map(|value| {
                        if value.starts_with(&[2, 4]) {
                            let state = state.as_ref().ok_or_else(|| {
                                CorruptionError::msg(
                                    "expired anchor without governance state",
                                )
                            })?;
                            return crate::store::retention::anchor_receipt(
                                state,
                                &crate::store::ExpiredCommitReceipt::decode(
                                    key, &value, state,
                                )?,
                            );
                        }
                        Ok(
                            crate::store::shacl_receipt::GovernedReceipt::decode(&value)?
                                .receipt()
                                .clone(),
                        )
                    })
                    .transpose()
            },
            |position| {
                let mut lower = outbox_record_key(position);
                lower.push(0);
                let records = reader.scan_prefix_from(
                    &default_cf,
                    OUTBOX_RECORD_PREFIX,
                    &lower,
                );
                records.status()?;
                Ok(records.is_valid())
            },
            || check(control, started_at),
        )?;
        check(control, started_at)?;
        Ok(crate::store::StoreFeatureInspection::new(
            format,
            live_rdf_12_required,
            retained.rdf_12_required,
            retained.records,
            retained.from,
            retained.through,
            retained.coverage_after_receipt_sequence,
            retained.expired_history_unexamined,
        ))
    }
}
