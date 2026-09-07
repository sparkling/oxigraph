//! Canonical engine-neutral contributor identities and commit-end observations.
use super::receipt::envelope_checksum;
use super::{CommitReceipt, CommitReceiptOutcome, GovernanceHealth, OutboxCursor, Store};
use std::collections::BTreeMap;
use std::num::NonZeroU32;

const MAX_CONTRIBUTORS: usize = 128;

/// Stable operator-assigned provider identity and exact nonzero schema revision.
/// This identity never becomes a metric label.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ContributorIdentity {
    provider: [u8; 16],
    schema: NonZeroU32,
}
impl ContributorIdentity {
    pub const fn new(provider: [u8; 16], schema: NonZeroU32) -> Self {
        Self { provider, schema }
    }
    pub const fn provider(&self) -> &[u8; 16] {
        &self.provider
    }
    pub const fn schema(&self) -> NonZeroU32 {
        self.schema
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContributorConsistency {
    Strict,
    Eventual { max_lag_records: u64 },
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContributorHealth {
    Healthy,
    Rebuilding,
    Unavailable,
    Failed,
}

/// Profile-owned requirements; an observation cannot weaken these settings.
/// Required contributors must be healthy and fully caught up, even when their
/// normal processing contract is eventual. Only optional contributors may
/// report ready-but-degraded lag within their declared eventual bound.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ContributorDeclaration {
    identity: ContributorIdentity,
    required: bool,
    consistency: ContributorConsistency,
    authoritative_fallback: bool,
}
impl ContributorDeclaration {
    pub const fn new(
        identity: ContributorIdentity,
        required: bool,
        consistency: ContributorConsistency,
        authoritative_fallback: bool,
    ) -> Self {
        Self {
            identity,
            required,
            consistency,
            authoritative_fallback,
        }
    }
    pub const fn identity(&self) -> ContributorIdentity {
        self.identity
    }
    pub const fn required(&self) -> bool {
        self.required
    }
    pub const fn consistency(&self) -> ContributorConsistency {
        self.consistency
    }
    pub const fn authoritative_fallback(&self) -> bool {
        self.authoritative_fallback
    }
}

/// A full v2 receipt fixes a commit end, never a cursor within a paginated commit.
/// Construction checks format; evaluation additionally verifies native lookup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorCheckpoint(CommitReceipt);
impl ContributorCheckpoint {
    pub fn new(receipt: CommitReceipt) -> Result<Self, ContributorError> {
        if receipt.schema_version() != 2 || receipt.outbox_end_cursor().is_none() {
            return Err(ContributorError::InvalidCheckpoint);
        }
        Ok(Self(receipt))
    }
    pub const fn receipt(&self) -> &CommitReceipt {
        &self.0
    }
    pub fn cursor(&self) -> OutboxCursor {
        // Constructor and native receipt decoder guarantee a v2 commit end.
        OutboxCursor::new(self.0.store_identity().clone(), self.position())
    }
    fn position(&self) -> u64 {
        self.0
            .outbox_end_cursor()
            .map_or(0, |cursor| cursor.position())
    }
}

/// Caller-sampled provider state. Source names the exact authoritative target
/// used while observing; applied names its last completely applied commit.
/// None represents genesis, not an unknown nonzero checkpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorObservation {
    identity: ContributorIdentity,
    source: Option<ContributorCheckpoint>,
    applied: Option<ContributorCheckpoint>,
    health: ContributorHealth,
}
impl ContributorObservation {
    pub const fn new(
        identity: ContributorIdentity,
        source: Option<ContributorCheckpoint>,
        applied: Option<ContributorCheckpoint>,
        health: ContributorHealth,
    ) -> Self {
        Self {
            identity,
            source,
            applied,
            health,
        }
    }
    pub const fn identity(&self) -> ContributorIdentity {
        self.identity
    }
    pub const fn source(&self) -> Option<&ContributorCheckpoint> {
        self.source.as_ref()
    }
    pub const fn applied(&self) -> Option<&ContributorCheckpoint> {
        self.applied.as_ref()
    }
    pub const fn health(&self) -> ContributorHealth {
        self.health
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ContributorError {
    #[error("contributor inventory exceeds 128 entries")]
    Capacity,
    #[error("duplicate contributor provider identity")]
    Duplicate,
    #[error("unknown contributor provider/schema identity")]
    Unknown,
    #[error("required contributor observation missing")]
    MissingRequired,
    #[error("contributor checkpoint is not a v2 commit receipt")]
    InvalidCheckpoint,
    #[error("contributor source differs from the authoritative snapshot")]
    SourceMismatch,
    #[error("contributor applied checkpoint has invalid lineage, order, or receipt")]
    CursorMismatch,
    #[error("contributor applied checkpoint is below retention")]
    CursorExpired,
    #[error("contributor is behind its declared lag policy")]
    LagExceeded,
    #[error("contributor is unhealthy without an allowed authoritative fallback")]
    Unhealthy,
    #[error("native contributor receipt lookup failed")]
    Storage,
    #[error("contributor inspection was interrupted")]
    Interrupted,
}

/// At most 128 canonical declarations; duplicate provider IDs reject even if
/// their schema revisions differ. Empty is a valid native-store configuration.
#[derive(Clone, Debug, Default)]
pub struct ContributorRegistry {
    declarations: Vec<ContributorDeclaration>,
}
impl ContributorRegistry {
    pub fn new(mut declarations: Vec<ContributorDeclaration>) -> Result<Self, ContributorError> {
        if declarations.len() > MAX_CONTRIBUTORS {
            return Err(ContributorError::Capacity);
        }
        declarations.sort_unstable_by_key(|entry| entry.identity);
        if declarations
            .windows(2)
            .any(|pair| matches!(pair, [a,b] if a.identity.provider == b.identity.provider))
        {
            return Err(ContributorError::Duplicate);
        }
        Ok(Self { declarations })
    }
    pub fn declarations(&self) -> &[ContributorDeclaration] {
        &self.declarations
    }
    pub(crate) fn evaluate(
        &self,
        store: &Store,
        governance: &GovernanceHealth,
        observations: &[ContributorObservation],
        mut check: impl FnMut() -> bool,
    ) -> Result<ContributorInventory, ContributorError> {
        if observations.len() > MAX_CONTRIBUTORS {
            return Err(ContributorError::Capacity);
        }
        let mut by_id = BTreeMap::new();
        for observation in observations {
            if by_id.insert(observation.identity, observation).is_some() {
                return Err(ContributorError::Duplicate);
            }
            if self
                .declarations
                .binary_search_by_key(&observation.identity, |entry| entry.identity)
                .is_err()
            {
                return Err(ContributorError::Unknown);
            }
        }
        let mut entries = Vec::new();
        let high = governance.high_water().map_or(0, OutboxCursor::position);
        let floor = governance
            .retained_after()
            .map_or(0, OutboxCursor::position);
        for declaration in &self.declarations {
            if !check() {
                return Err(ContributorError::Interrupted);
            }
            let Some(observation) = by_id.get(&declaration.identity) else {
                if declaration.required {
                    return Err(ContributorError::MissingRequired);
                }
                if !declaration.authoritative_fallback {
                    return Err(ContributorError::Unhealthy);
                }
                entries.push(ContributorInventoryEntry {
                    declaration: *declaration,
                    observation: None,
                    lag_records: None,
                    degraded: true,
                });
                continue;
            };
            if observation
                .source
                .as_ref()
                .map(ContributorCheckpoint::receipt)
                != governance.latest_receipt()
            {
                return Err(ContributorError::SourceMismatch);
            }
            let applied = observation
                .applied
                .as_ref()
                .map_or(0, ContributorCheckpoint::position);
            if applied > high
                || observation.applied.as_ref().is_some_and(|entry| {
                    Some(entry.0.store_identity()) != governance.store_identity()
                })
            {
                return Err(ContributorError::CursorMismatch);
            }
            if applied < floor {
                return Err(ContributorError::CursorExpired);
            }
            if let Some(checkpoint) = &observation.applied {
                let matches = match store
                    .lookup_commit_receipt(checkpoint.0.transaction_key())
                    .map_err(|_| ContributorError::Storage)?
                {
                    CommitReceiptOutcome::Committed(receipt) => receipt == checkpoint.0,
                    CommitReceiptOutcome::Expired(_) => {
                        governance.retention_anchor() == Some(&checkpoint.0)
                    }
                    _ => false,
                };
                if !matches {
                    return Err(ContributorError::CursorMismatch);
                }
            }
            let lag = high - applied;
            let max_lag = match declaration.consistency {
                ContributorConsistency::Strict => 0,
                ContributorConsistency::Eventual { max_lag_records } => max_lag_records,
            };
            if lag > max_lag || (declaration.required && lag > 0) {
                return Err(ContributorError::LagExceeded);
            }
            let unhealthy = observation.health != ContributorHealth::Healthy;
            if unhealthy && (declaration.required || !declaration.authoritative_fallback) {
                return Err(ContributorError::Unhealthy);
            }
            entries.push(ContributorInventoryEntry {
                declaration: *declaration,
                observation: Some((*observation).clone()),
                lag_records: Some(lag),
                degraded: unhealthy || lag > 0,
            });
        }
        Ok(ContributorInventory { entries })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorInventoryEntry {
    declaration: ContributorDeclaration,
    observation: Option<ContributorObservation>,
    lag_records: Option<u64>,
    degraded: bool,
}
impl ContributorInventoryEntry {
    pub const fn declaration(&self) -> &ContributorDeclaration {
        &self.declaration
    }
    pub const fn observation(&self) -> Option<&ContributorObservation> {
        self.observation.as_ref()
    }
    pub const fn lag_records(&self) -> Option<u64> {
        self.lag_records
    }
    pub const fn degraded(&self) -> bool {
        self.degraded
    }
}
/// Validated, sorted inventory reusable by later backup and restore contracts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorInventory {
    entries: Vec<ContributorInventoryEntry>,
}
impl ContributorInventory {
    pub fn entries(&self) -> &[ContributorInventoryEntry] {
        &self.entries
    }
    /// Canonical v1 content identity; includes declarations and observations.
    /// This is not a backup manifest, authenticity proof, or restore receipt.
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(b"oxigraph.contributors.v1\0", &self.to_bytes())
    }
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![1];
        bytes.extend_from_slice(
            &u16::try_from(self.entries.len())
                .unwrap_or(u16::MAX)
                .to_be_bytes(),
        );
        for entry in &self.entries {
            let declaration = &entry.declaration;
            bytes.extend_from_slice(&declaration.identity.provider);
            bytes.extend_from_slice(&declaration.identity.schema.get().to_be_bytes());
            bytes.push(u8::from(declaration.required));
            bytes.push(u8::from(declaration.authoritative_fallback));
            match declaration.consistency {
                ContributorConsistency::Strict => {
                    bytes.push(0);
                    bytes.extend_from_slice(&0_u64.to_be_bytes());
                }
                ContributorConsistency::Eventual { max_lag_records } => {
                    bytes.push(1);
                    bytes.extend_from_slice(&max_lag_records.to_be_bytes());
                }
            }
            bytes.push(u8::from(entry.observation.is_some()));
            if let Some(observation) = &entry.observation {
                bytes.push(match observation.health {
                    ContributorHealth::Healthy => 0,
                    ContributorHealth::Rebuilding => 1,
                    ContributorHealth::Unavailable => 2,
                    ContributorHealth::Failed => 3,
                });
                for checkpoint in [&observation.source, &observation.applied] {
                    bytes.push(u8::from(checkpoint.is_some()));
                    if let Some(checkpoint) = checkpoint {
                        bytes.extend_from_slice(&checkpoint.0.encode());
                    }
                }
            }
        }
        bytes
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    clippy::panic_in_result_fn,
    reason = "literal checkpoint identity regressions"
)]
mod tests {
    use super::*;
    use crate::store::{
        GovernanceTime, SemanticChangeSet, StoreIdentity, TransactionKey, TransactionRequest,
    };
    #[test]
    fn arbitrary_commit_end_and_future_receipts_cannot_be_adopted()
    -> Result<(), Box<dyn std::error::Error>> {
        let store = Store::new()?;
        let first = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction()
            .commit()?;
        let health =
            store.governance_health(GovernanceTime::from_unix_millis(1), NonZeroUsize::MIN)?;
        let second = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([2; 16]),
            )?
            .into_transaction()
            .commit()?;
        let identity = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
        let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
            identity,
            true,
            ContributorConsistency::Strict,
            false,
        )])?;
        for receipt in [first.clone().with_outbox_header(9), second] {
            let observation = ContributorObservation::new(
                identity,
                Some(ContributorCheckpoint::new(first.clone())?),
                Some(ContributorCheckpoint::new(receipt)?),
                ContributorHealth::Healthy,
            );
            assert!(matches!(
                registry.evaluate(&store, &health, &[observation], || true),
                Err(ContributorError::CursorMismatch)
            ));
        }
        // An in-range forged checkpoint must fail native receipt identity,
        // not merely the high-water bounds check.
        let current = store.governance_health(
            GovernanceTime::from_unix_millis(1),
            NonZeroUsize::new(10).unwrap(),
        )?;
        let observation = ContributorObservation::new(
            identity,
            Some(ContributorCheckpoint::new(
                current.latest_receipt().unwrap().clone(),
            )?),
            Some(ContributorCheckpoint::new(first.with_outbox_header(2))?),
            ContributorHealth::Healthy,
        );
        assert!(matches!(
            registry.evaluate(&store, &current, &[observation], || true),
            Err(ContributorError::CursorMismatch)
        ));
        let legacy = CommitReceipt::new(
            StoreIdentity::from_bytes([1; 16]),
            1,
            TransactionKey::new([1; 16]),
            &SemanticChangeSet::default(),
        );
        assert!(matches!(
            ContributorCheckpoint::new(legacy),
            Err(ContributorError::InvalidCheckpoint)
        ));
        Ok(())
    }
    #[test]
    fn registry_observation_loop_checks_cancellation() -> Result<(), Box<dyn std::error::Error>> {
        let store = Store::new()?;
        let health =
            store.governance_health(GovernanceTime::from_unix_millis(1), NonZeroUsize::MIN)?;
        let identity = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
        let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
            identity,
            true,
            ContributorConsistency::Strict,
            false,
        )])?;
        let observation =
            ContributorObservation::new(identity, None, None, ContributorHealth::Healthy);
        assert!(matches!(
            registry.evaluate(&store, &health, &[observation], || false),
            Err(ContributorError::Interrupted)
        ));
        Ok(())
    }
    use std::num::NonZeroUsize;
}
