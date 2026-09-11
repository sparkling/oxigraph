use super::*;

fn check_state_inspection(
    control: &TransactionStartControl,
    started_at: Instant,
) -> Result<(), StorageError> {
    control
        .check(started_at)
        .map_err(|_| StorageError::Other("state inspection was cancelled or timed out".into()))
}

impl RocksDbStorage {
    pub fn inspect_state(
        path: &Path,
        control: &TransactionStartControl,
    ) -> Result<crate::store::StoreStateInspection, StorageError> {
        use crate::store::{
            GovernanceStateInspectionStatus, StoreVersionStatus, UpgradeGuardInspectionStatus,
        };

        let started_at = Instant::now();
        check_state_inspection(control, started_at)?;
        let upgrade_guard_status =
            match symlink_metadata(path.join(crate::store::upgrade::UPGRADE_GUARD)) {
                Ok(_) => UpgradeGuardInspectionStatus::Present,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    UpgradeGuardInspectionStatus::Absent
                }
                Err(error) => return Err(StorageError::Io(error)),
            };
        check_state_inspection(control, started_at)?;

        let format = Self::inspect(path)?;
        check_state_inspection(control, started_at)?;
        if format.version_status() != StoreVersionStatus::Current
            || !format.missing_column_families().is_empty()
            || !format.unexpected_column_families().is_empty()
        {
            return Ok(crate::store::StoreStateInspection::new(
                format,
                upgrade_guard_status,
                GovernanceStateInspectionStatus::NotInspected,
                None,
                None,
            ));
        }

        let db = Db::open_read_only_with_options(path, Vec::new(), DbOptions::default())?;
        check_state_inspection(control, started_at)?;
        let default_cf = db.column_family(DEFAULT_CF)?;
        let bytes = db.get(&default_cf, GOVERNANCE_STATE_KEY)?;
        check_state_inspection(control, started_at)?;
        let Some(bytes) = bytes else {
            return Ok(crate::store::StoreStateInspection::new(
                format,
                upgrade_guard_status,
                GovernanceStateInspectionStatus::Absent,
                None,
                None,
            ));
        };
        let state = GovernanceState::decode(&bytes)?;
        check_state_inspection(control, started_at)?;
        Ok(crate::store::StoreStateInspection::new(
            format,
            upgrade_guard_status,
            GovernanceStateInspectionStatus::Present,
            Some(state.store_identity),
            Some(state.sequence),
        ))
    }
}
