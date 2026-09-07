//! Explicit, bounded native outbox retention (ADR-0020).
use super::receipt::GovernanceState;
#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
use super::receipt::{envelope_checksum, receipt_field};
use super::{
    CommitReceipt, OutboxCursor, OutboxReadError, OutboxRecord, StorageError, StoreIdentity,
};
use crate::storage::CorruptionError;
use std::collections::BTreeMap;
use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LEASES: u16 = 128;

/// An explicitly supplied UTC observation. Maintenance callers own clock trust;
/// persisted observations reject regressions. Reads never expire leases.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GovernanceTime(u64);
impl GovernanceTime {
    pub const fn from_unix_millis(value: u64) -> Self {
        Self(value)
    }
    pub const fn as_unix_millis(self) -> u64 {
        self.0
    }
    pub fn now() -> Result<Self, GovernanceError> {
        Ok(Self(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| GovernanceError::InvalidTime)?
                .as_millis()
                .try_into()
                .map_err(|_| GovernanceError::InvalidTime)?,
        ))
    }
}

/// Opt-in physical outbox record cap, including records waiting for cleanup.
/// It is not a byte cap or a limit on permanent transaction-key tombstones.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OutboxRetentionPolicy {
    max_records: NonZeroU64,
    max_leases: NonZeroU16,
}
impl OutboxRetentionPolicy {
    pub fn new(max_records: NonZeroU64, max_leases: NonZeroU16) -> Result<Self, GovernanceError> {
        if max_leases.get() > MAX_LEASES {
            return Err(GovernanceError::InvalidPolicy);
        }
        Ok(Self {
            max_records,
            max_leases,
        })
    }
    pub const fn max_records(&self) -> NonZeroU64 {
        self.max_records
    }
    pub const fn max_leases(&self) -> NonZeroU16 {
        self.max_leases
    }
}

/// Fenced, store-bound lease handle. Save these bytes to renew after restart.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxLeaseToken {
    identity: StoreIdentity,
    id: [u8; 16],
    nonce: [u8; 16],
}
impl OutboxLeaseToken {
    pub fn to_bytes(&self) -> [u8; 48] {
        let mut bytes = [0; 48];
        bytes[..16].copy_from_slice(self.identity.as_bytes());
        bytes[16..32].copy_from_slice(&self.id);
        bytes[32..].copy_from_slice(&self.nonce);
        bytes
    }
    pub fn from_bytes(bytes: [u8; 48]) -> Self {
        let mut identity = [0; 16];
        identity.copy_from_slice(&bytes[..16]);
        let mut id = [0; 16];
        id.copy_from_slice(&bytes[16..32]);
        let mut nonce = [0; 16];
        nonce.copy_from_slice(&bytes[32..]);
        Self {
            identity: StoreIdentity::from_bytes(identity),
            id,
            nonce,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxLease {
    token: OutboxLeaseToken,
    checkpoint: Option<OutboxCursor>,
    expires_at: GovernanceTime,
}
impl OutboxLease {
    pub const fn token(&self) -> &OutboxLeaseToken {
        &self.token
    }
    pub const fn checkpoint(&self) -> Option<&OutboxCursor> {
        self.checkpoint.as_ref()
    }
    pub const fn expires_at(&self) -> GovernanceTime {
        self.expires_at
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum GovernanceError {
    #[error("retention policy must be configured explicitly")]
    NotConfigured,
    #[error("retention requires an established lineage when governed keys already exist")]
    LineageUnavailable,
    #[error("invalid retention policy (at most 128 leases are supported)")]
    InvalidPolicy,
    #[error("clock is outside the supported UTC millisecond range")]
    InvalidTime,
    #[error("clock observation precedes the durable governance clock")]
    ClockRegressed,
    #[error("lease deadline must be later than the supplied clock observation")]
    InvalidDeadline,
    #[error("a live lease already owns this identifier")]
    LeaseExists,
    #[error("configured lease capacity is exhausted")]
    LeaseCapacity,
    #[error("lease is expired, unknown, or fenced by a newer owner")]
    LeaseUnavailable,
    #[error("lease checkpoints must advance monotonically")]
    CheckpointRegressed,
    #[error("physical outbox record capacity is exhausted; maintain retention before retrying")]
    Backpressure,
    /// The synchronous maintenance batch may have committed. Observe health,
    /// receipts and leases before retrying; never replay primary mutations.
    #[error("maintenance batch acknowledgement failed; outcome is indeterminate: {0}")]
    MaintenanceIndeterminate(StorageError),
    #[error(transparent)]
    Cursor(#[from] OutboxReadError),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl GovernanceError {
    pub(crate) fn into_storage(self) -> StorageError {
        match self {
            Self::Storage(error) => error,
            error => StorageError::Other(Box::new(error)),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxMaintenance {
    expired_receipt: Option<CommitReceipt>,
    removed_records: usize,
    retained_after: Option<OutboxCursor>,
    cleanup_through: Option<OutboxCursor>,
    pinned: bool,
}
impl OutboxMaintenance {
    pub const fn removed_records(&self) -> usize {
        self.removed_records
    }
    pub fn expired_receipt_sequence(&self) -> Option<u64> {
        self.expired_receipt.as_ref().map(CommitReceipt::sequence)
    }
    pub const fn retained_after(&self) -> Option<&OutboxCursor> {
        self.retained_after.as_ref()
    }
    pub const fn cleanup_through(&self) -> Option<&OutboxCursor> {
        self.cleanup_through.as_ref()
    }
    pub const fn pinned_by_lease(&self) -> bool {
        self.pinned
    }
}

/// Bounded, snapshot-local observations, not a full-store readiness certificate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceHealth {
    retention_anchor: Option<CommitReceipt>,
    latest_receipt: Option<CommitReceipt>,
    schema_version: Option<u8>,
    store_identity: Option<StoreIdentity>,
    policy: Option<OutboxRetentionPolicy>,
    retained_after: Option<OutboxCursor>,
    cleanup_through: Option<OutboxCursor>,
    high_water: Option<OutboxCursor>,
    retained_records: u64,
    physical_records: u64,
    live_leases: usize,
    expired_leases: usize,
    oldest_live_checkpoint: Option<OutboxCursor>,
    validated_through: Option<OutboxCursor>,
}
impl GovernanceHealth {
    /// Full last-expired receipt retained as the authoritative commit boundary.
    pub const fn retention_anchor(&self) -> Option<&CommitReceipt> {
        self.retention_anchor.as_ref()
    }
    /// Exact latest commit-end identity verified with the governance snapshot.
    pub const fn latest_receipt(&self) -> Option<&CommitReceipt> {
        self.latest_receipt.as_ref()
    }
    /// Recognized governance encoding, or `None` before any governance state.
    pub const fn schema_version(&self) -> Option<u8> {
        self.schema_version
    }
    pub const fn store_identity(&self) -> Option<&StoreIdentity> {
        self.store_identity.as_ref()
    }
    pub const fn policy(&self) -> Option<&OutboxRetentionPolicy> {
        self.policy.as_ref()
    }
    pub const fn retained_after(&self) -> Option<&OutboxCursor> {
        self.retained_after.as_ref()
    }
    pub const fn cleanup_through(&self) -> Option<&OutboxCursor> {
        self.cleanup_through.as_ref()
    }
    pub const fn high_water(&self) -> Option<&OutboxCursor> {
        self.high_water.as_ref()
    }
    pub const fn retained_records(&self) -> u64 {
        self.retained_records
    }
    pub const fn physical_records(&self) -> u64 {
        self.physical_records
    }
    pub const fn live_leases(&self) -> usize {
        self.live_leases
    }
    pub const fn expired_leases(&self) -> usize {
        self.expired_leases
    }
    pub const fn oldest_live_checkpoint(&self) -> Option<&OutboxCursor> {
        self.oldest_live_checkpoint.as_ref()
    }
    pub const fn validated_through(&self) -> Option<&OutboxCursor> {
        self.validated_through.as_ref()
    }
    pub fn backpressured(&self) -> bool {
        self.policy
            .as_ref()
            .is_some_and(|policy| self.physical_records >= policy.max_records.get())
    }
}

#[derive(Clone)]
pub(crate) struct LeaseState {
    nonce: [u8; 16],
    position: u64,
    expires: u64,
}
#[derive(Clone)]
pub(crate) struct RetentionState {
    pub policy: OutboxRetentionPolicy,
    pub clock: u64,
    pub floor: u64,
    pub physical_gc: u64,
    pub anchor: Option<CommitReceipt>,
    pub leases: BTreeMap<[u8; 16], LeaseState>,
}

#[derive(Clone, Copy)]
pub(crate) enum Action<'a> {
    Configure(OutboxRetentionPolicy),
    Acquire {
        id: [u8; 16],
        after: Option<&'a OutboxCursor>,
        expires: GovernanceTime,
    },
    Checkpoint {
        token: &'a OutboxLeaseToken,
        after: &'a OutboxCursor,
        expires: GovernanceTime,
    },
    Release(&'a OutboxLeaseToken),
    Maintain {
        through: &'a OutboxCursor,
        limit: NonZeroUsize,
    },
}
impl Action<'_> {
    pub fn cursor(&self) -> Option<&OutboxCursor> {
        match self {
            Self::Acquire { after, .. } => *after,
            Self::Checkpoint { after, .. } => Some(after),
            Self::Maintain { through, .. } => Some(through),
            Self::Configure(_) | Self::Release(_) => None,
        }
    }
}
pub(crate) enum ActionResult {
    Configured,
    Lease(OutboxLease),
    Released,
    Maintenance(OutboxMaintenance),
}
pub(crate) struct PreparedMaintenance {
    pub state: GovernanceState,
    pub result: ActionResult,
    pub expired: Option<CommitReceipt>,
    pub remove: Vec<u64>,
}

pub(crate) fn cursor(identity: &StoreIdentity, position: u64) -> Option<OutboxCursor> {
    (position != 0).then(|| OutboxCursor::new(identity.clone(), position))
}
pub(crate) fn floor(state: &GovernanceState) -> u64 {
    state.retention.as_ref().map_or(0, |state| state.floor)
}
pub(crate) fn physical_gc(state: &GovernanceState) -> u64 {
    state
        .retention
        .as_ref()
        .map_or(0, |state| state.physical_gc)
}

pub(crate) fn validate_cleanup_head(
    state: &GovernanceState,
    mut read: impl FnMut(u64) -> Result<Option<Vec<u8>>, StorageError>,
) -> Result<(), StorageError> {
    validate(state)?;
    if let Some(retention) = &state.retention
        && retention.physical_gc < retention.floor
    {
        let position = retention.physical_gc + 1;
        let bytes = read(position)?
            .ok_or_else(|| CorruptionError::msg("missing pending cleanup record"))?;
        let record = super::outbox::decode_record(&state.store_identity, position, &bytes)?;
        let anchor = retention
            .anchor
            .as_ref()
            .ok_or_else(|| CorruptionError::msg("missing pending cleanup anchor"))?;
        match &record {
            OutboxRecord::Commit { receipt, .. } if receipt != anchor => {
                return Err(CorruptionError::msg("cleanup header disagrees with anchor").into());
            }
            _ => super::outbox::validate_event(&record, anchor)?,
        }
    }
    Ok(())
}

pub(crate) fn validate(state: &GovernanceState) -> Result<(), StorageError> {
    let Some(retention) = &state.retention else {
        return Ok(());
    };
    let high = state.outbox.as_ref().map_or(0, |state| state.high_water);
    if retention.policy.max_leases.get() > MAX_LEASES
        || retention.leases.len() > usize::from(retention.policy.max_leases.get())
        || retention.physical_gc > retention.floor
        || retention.floor > high
    {
        return Err(CorruptionError::msg("invalid retention bounds or lease capacity").into());
    }
    match (&retention.anchor, retention.floor) {
        (None, 0) => (),
        (Some(anchor), floor)
            if anchor.store_identity() == &state.store_identity
                && anchor.sequence() <= state.sequence
                && state
                    .outbox
                    .as_ref()
                    .is_some_and(|outbox| anchor.sequence() > outbox.after_receipt_sequence)
                && anchor
                    .outbox_end_cursor()
                    .is_some_and(|cursor| cursor.position() == floor) => {}
        _ => {
            return Err(
                CorruptionError::msg("retention anchor disagrees with floor or lineage").into(),
            );
        }
    }
    for lease in retention.leases.values() {
        if lease.position > high
            || (lease.expires > retention.clock && lease.position < retention.floor)
        {
            return Err(CorruptionError::msg("lease checkpoint outside retained outbox").into());
        }
    }
    Ok(())
}

pub(crate) fn check_capacity(state: &GovernanceState, added: u64) -> Result<(), StorageError> {
    validate(state)?;
    if let Some(retention) = &state.retention {
        let high = state.outbox.as_ref().map_or(0, |state| state.high_water);
        if high
            .checked_sub(retention.physical_gc)
            .and_then(|count| count.checked_add(added))
            .is_none_or(|count| count > retention.policy.max_records.get())
        {
            return Err(GovernanceError::Backpressure.into_storage());
        }
    }
    Ok(())
}

/// The caller holds the same writer permit as commits, validates existing feed
/// boundaries and outcomes, then applies this plan atomically or not at all.
pub(crate) fn prepare(
    state: &GovernanceState,
    action: Action<'_>,
    now: GovernanceTime,
    mut read: impl FnMut(u64) -> Result<OutboxRecord, StorageError>,
) -> Result<PreparedMaintenance, GovernanceError> {
    validate(state)?;
    if state
        .retention
        .as_ref()
        .is_some_and(|retention| now.0 < retention.clock)
    {
        return Err(GovernanceError::ClockRegressed);
    }
    let mut state = state.clone();
    let high = state.outbox.as_ref().map_or(0, |outbox| outbox.high_water);
    let identity = state.store_identity.clone();
    if let Action::Configure(policy) = &action {
        if let Some(retention) = &mut state.retention {
            if retention
                .leases
                .values()
                .filter(|lease| lease.expires > now.0)
                .count()
                > usize::from(policy.max_leases.get())
            {
                return Err(GovernanceError::LeaseCapacity);
            }
            retention.policy = *policy;
        } else {
            state.retention = Some(RetentionState {
                policy: *policy,
                clock: now.0,
                floor: 0,
                physical_gc: 0,
                anchor: None,
                leases: BTreeMap::new(),
            });
        }
    }
    let retention = state
        .retention
        .as_mut()
        .ok_or(GovernanceError::NotConfigured)?;
    retention.leases.retain(|_, lease| lease.expires > now.0);
    retention.clock = now.0;
    let position = |after: Option<&OutboxCursor>| -> Result<u64, GovernanceError> {
        let Some(after) = after else {
            return Ok(retention.floor);
        };
        if after.store_identity() != &identity {
            return Err(OutboxReadError::DifferentStore.into());
        }
        if after.position() > high {
            return Err(OutboxReadError::CursorAhead.into());
        }
        if after.position() < retention.floor {
            return Err(OutboxReadError::CursorExpired {
                retained_after: OutboxCursor::new(identity.clone(), retention.floor),
            }
            .into());
        }
        Ok(after.position())
    };
    let mut expired = None;
    let mut remove = Vec::new();
    let result = match action {
        Action::Configure(_) => ActionResult::Configured,
        Action::Acquire { id, after, expires } => {
            let position = position(after)?;
            if expires.0 <= now.0 {
                return Err(GovernanceError::InvalidDeadline);
            }
            if retention.leases.contains_key(&id) {
                return Err(GovernanceError::LeaseExists);
            }
            if retention.leases.len() >= usize::from(retention.policy.max_leases.get()) {
                return Err(GovernanceError::LeaseCapacity);
            }
            let nonce = rand::random();
            retention.leases.insert(
                id,
                LeaseState {
                    nonce,
                    position,
                    expires: expires.0,
                },
            );
            ActionResult::Lease(OutboxLease {
                token: OutboxLeaseToken {
                    identity: identity.clone(),
                    id,
                    nonce,
                },
                checkpoint: cursor(&identity, position),
                expires_at: expires,
            })
        }
        Action::Checkpoint {
            token,
            after,
            expires,
        } => {
            let position = position(Some(after))?;
            if expires.0 <= now.0 {
                return Err(GovernanceError::InvalidDeadline);
            }
            let lease = retention
                .leases
                .get_mut(&token.id)
                .filter(|lease| token.identity == identity && token.nonce == lease.nonce)
                .ok_or(GovernanceError::LeaseUnavailable)?;
            if position < lease.position {
                return Err(GovernanceError::CheckpointRegressed);
            }
            lease.position = position;
            lease.expires = expires.0;
            ActionResult::Lease(OutboxLease {
                token: token.clone(),
                checkpoint: cursor(&identity, position),
                expires_at: expires,
            })
        }
        Action::Release(token) => {
            if retention
                .leases
                .get(&token.id)
                .is_none_or(|lease| token.identity != identity || token.nonce != lease.nonce)
            {
                return Err(GovernanceError::LeaseUnavailable);
            }
            retention.leases.remove(&token.id);
            ActionResult::Released
        }
        Action::Maintain { through, limit } => {
            let through = position(Some(through))?;
            let pin = retention
                .leases
                .values()
                .map(|lease| lease.position)
                .min()
                .unwrap_or(high);
            let mut pinned = false;
            if retention.physical_gc == retention.floor && retention.floor < through {
                let OutboxRecord::Commit { receipt, .. } = read(retention.floor + 1)? else {
                    return Err(StorageError::from(CorruptionError::msg(
                        "retention boundary is not a commit header",
                    ))
                    .into());
                };
                let end = receipt
                    .outbox_end_cursor()
                    .ok_or_else(|| {
                        StorageError::from(CorruptionError::msg(
                            "retention header has no outbox range",
                        ))
                    })?
                    .position();
                pinned = end > pin;
                if end <= through && end <= pin {
                    retention.floor = end;
                    retention.anchor = Some(receipt.clone());
                    expired = Some(receipt);
                }
            }
            let count = (retention.floor - retention.physical_gc)
                .min(limit.get().try_into().unwrap_or(u64::MAX));
            for _ in 0..count {
                let position = retention.physical_gc + 1;
                let record = read(position)?;
                let anchor = retention.anchor.as_ref().ok_or_else(|| {
                    StorageError::from(CorruptionError::msg("missing cleanup anchor"))
                })?;
                match &record {
                    OutboxRecord::Commit { receipt, .. } if receipt != anchor => {
                        return Err(StorageError::from(CorruptionError::msg(
                            "cleanup header disagrees with anchor",
                        ))
                        .into());
                    }
                    _ => super::outbox::validate_event(&record, anchor)?,
                }
                remove.push(position);
                retention.physical_gc = position;
            }
            ActionResult::Maintenance(OutboxMaintenance {
                expired_receipt: expired.clone(),
                removed_records: remove.len(),
                retained_after: cursor(&identity, retention.floor),
                cleanup_through: cursor(&identity, retention.physical_gc),
                pinned,
            })
        }
    };
    validate(&state)?;
    Ok(PreparedMaintenance {
        state,
        result,
        expired,
        remove,
    })
}

/// Permanent, compact evidence that a key committed, without its expired payload.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpiredCommitReceipt {
    identity: StoreIdentity,
    key: super::TransactionKey,
    sequence: u64,
}
impl ExpiredCommitReceipt {
    pub const fn store_identity(&self) -> &StoreIdentity {
        &self.identity
    }
    pub const fn transaction_key(&self) -> &super::TransactionKey {
        &self.key
    }
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }
    pub(crate) fn new(receipt: &CommitReceipt) -> Self {
        Self {
            identity: receipt.store_identity().clone(),
            key: receipt.transaction_key().clone(),
            sequence: receipt.sequence(),
        }
    }
    pub(crate) fn validate(&self, state: &GovernanceState) -> Result<(), StorageError> {
        if self.identity != state.store_identity
            || state
                .outbox
                .as_ref()
                .is_none_or(|outbox| self.sequence <= outbox.after_receipt_sequence)
            || state
                .retention
                .as_ref()
                .and_then(|state| state.anchor.as_ref())
                .is_none_or(|anchor| self.sequence > anchor.sequence())
        {
            return Err(
                CorruptionError::msg("expired receipt disagrees with retention state").into(),
            );
        }
        Ok(())
    }
    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut bytes = vec![2, 4];
        bytes.extend_from_slice(self.identity.as_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        let mut bound = self.key.as_bytes().to_vec();
        bound.extend_from_slice(&bytes);
        bytes.extend_from_slice(&envelope_checksum(b"oxigraph.expired-receipt.v1\0", &bound));
        bytes
    }
    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn decode(
        key: &[u8; 16],
        bytes: &[u8],
        state: &GovernanceState,
    ) -> Result<Self, StorageError> {
        if bytes.len() != 58 || !bytes.starts_with(&[2, 4]) {
            return Err(CorruptionError::msg("invalid expired receipt encoding").into());
        }
        let mut bound = key.to_vec();
        bound.extend_from_slice(&bytes[..26]);
        if bytes[26..] != envelope_checksum(b"oxigraph.expired-receipt.v1\0", &bound) {
            return Err(CorruptionError::msg("expired receipt checksum mismatch").into());
        }
        let result = Self {
            identity: StoreIdentity::from_bytes(receipt_field(&bytes[2..18])?),
            key: super::TransactionKey::new(*key),
            sequence: u64::from_be_bytes(receipt_field(&bytes[18..26])?),
        };
        result.validate(state)?;
        Ok(result)
    }
}

/// Only the fixed boundary anchor can resolve an expired receipt internally.
pub(crate) fn anchor_receipt(
    state: &GovernanceState,
    expired: &ExpiredCommitReceipt,
) -> Result<CommitReceipt, StorageError> {
    expired.validate(state)?;
    state
        .retention
        .as_ref()
        .and_then(|state| state.anchor.as_ref())
        .filter(|anchor| ExpiredCommitReceipt::new(anchor) == *expired)
        .cloned()
        .ok_or_else(|| CorruptionError::msg("expired receipt is not the retention anchor").into())
}

pub(crate) fn health(
    state: Option<&GovernanceState>,
    now: GovernanceTime,
    page: &super::OutboxBatch,
) -> Result<GovernanceHealth, GovernanceError> {
    if let Some(state) = state {
        validate(state)?;
    }
    let retention = state.and_then(|state| state.retention.as_ref());
    if retention.is_some_and(|state| now.0 < state.clock) {
        return Err(GovernanceError::ClockRegressed);
    }
    let high = state
        .and_then(|state| state.outbox.as_ref())
        .map_or(0, |state| state.high_water);
    let live = retention.map_or(0, |state| {
        state
            .leases
            .values()
            .filter(|lease| lease.expires > now.0)
            .count()
    });
    let oldest = retention.and_then(|state| {
        state
            .leases
            .values()
            .filter(|lease| lease.expires > now.0)
            .map(|lease| lease.position)
            .min()
    });
    Ok(GovernanceHealth {
        retention_anchor: retention.and_then(|retention| retention.anchor.clone()),
        latest_receipt: page.latest_receipt().cloned(),
        schema_version: state.and_then(|state| {
            if state.retention.is_some() {
                Some(3)
            } else if state.outbox.is_some() {
                Some(2)
            } else {
                (state.sequence > 0).then_some(1)
            }
        }),
        store_identity: state.map(|state| state.store_identity.clone()),
        policy: retention.map(|state| state.policy),
        retained_after: state.and_then(|state| cursor(&state.store_identity, floor(state))),
        cleanup_through: state.and_then(|state| cursor(&state.store_identity, physical_gc(state))),
        high_water: page.high_water().cloned(),
        retained_records: high - state.map_or(0, floor),
        physical_records: high - state.map_or(0, physical_gc),
        live_leases: live,
        expired_leases: retention.map_or(0, |state| state.leases.len()) - live,
        oldest_live_checkpoint: state.and_then(|state| cursor(&state.store_identity, oldest?)),
        validated_through: page.next_cursor().cloned(),
    })
}

#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
pub(crate) fn encode_state(state: &GovernanceState) -> Vec<u8> {
    let mut bytes = vec![3];
    bytes.extend_from_slice(state.store_identity.as_bytes());
    bytes.extend_from_slice(&state.sequence.to_be_bytes());
    bytes.push(u8::from(state.outbox.is_some()));
    if let Some(outbox) = &state.outbox {
        bytes.extend_from_slice(&outbox.high_water.to_be_bytes());
        bytes.extend_from_slice(&outbox.after_receipt_sequence.to_be_bytes());
    }
    if let Some(retention) = &state.retention {
        bytes.extend_from_slice(&retention.policy.max_records.get().to_be_bytes());
        bytes.extend_from_slice(&retention.policy.max_leases.get().to_be_bytes());
        for number in [retention.clock, retention.floor, retention.physical_gc] {
            bytes.extend_from_slice(&number.to_be_bytes());
        }
        bytes.push(u8::from(retention.anchor.is_some()));
        if let Some(anchor) = &retention.anchor {
            bytes.extend_from_slice(&anchor.encode());
        }
        // Validation caps this at 128. Invalid internal states encode a rejected
        // sentinel rather than silently truncating their declared count.
        bytes.extend_from_slice(
            &u16::try_from(retention.leases.len())
                .unwrap_or(u16::MAX)
                .to_be_bytes(),
        );
        for (id, lease) in &retention.leases {
            bytes.extend_from_slice(id);
            bytes.extend_from_slice(&lease.nonce);
            bytes.extend_from_slice(&lease.position.to_be_bytes());
            bytes.extend_from_slice(&lease.expires.to_be_bytes());
        }
    }
    bytes.extend_from_slice(&envelope_checksum(b"oxigraph.governance.v3\0", &bytes));
    bytes
}

#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
pub(crate) fn decode_state(bytes: &[u8]) -> Result<GovernanceState, StorageError> {
    // Fixed header, one fixed-size anchor, and no more than 128 fixed-size leases.
    if bytes.len() < 95 || bytes.len() > 6408 || bytes.first() != Some(&3) {
        return Err(CorruptionError::msg("invalid governance v3 size or version").into());
    }
    let (body, checksum) = bytes.split_at(bytes.len() - 32);
    if checksum != envelope_checksum(b"oxigraph.governance.v3\0", body) {
        return Err(CorruptionError::msg("invalid governance v3 checksum").into());
    }
    let mut input = Fields(&body[1..]);
    let store_identity = StoreIdentity::from_bytes(input.take()?);
    let sequence = input.number()?;
    let outbox = if input.flag()? {
        let high_water = input.number()?;
        let after_receipt_sequence = input.number()?;
        if high_water == 0
            || after_receipt_sequence >= sequence
            || high_water < sequence - after_receipt_sequence
        {
            return Err(CorruptionError::msg("invalid governance v3 outbox range").into());
        }
        Some(super::outbox::OutboxState {
            high_water,
            after_receipt_sequence,
        })
    } else {
        None
    };
    let max_records = NonZeroU64::new(input.number()?)
        .ok_or_else(|| CorruptionError::msg("zero retention record cap"))?;
    let max_leases = NonZeroU16::new(u16::from_be_bytes(input.take()?))
        .ok_or_else(|| CorruptionError::msg("zero lease cap"))?;
    let policy = OutboxRetentionPolicy::new(max_records, max_leases)
        .map_err(|_| CorruptionError::msg("invalid lease cap"))?;
    let clock = input.number()?;
    let floor = input.number()?;
    let physical_gc = input.number()?;
    let anchor = if input.flag()? {
        Some(CommitReceipt::decode(&input.take::<153>()?)?)
    } else {
        None
    };
    let count = u16::from_be_bytes(input.take()?);
    if count > max_leases.get() {
        return Err(CorruptionError::msg("lease count exceeds cap").into());
    }
    let mut leases = BTreeMap::new();
    for _ in 0..count {
        let id = input.take()?;
        if leases
            .last_key_value()
            .is_some_and(|(previous, _)| previous >= &id)
        {
            return Err(CorruptionError::msg("duplicate or unordered lease identifier").into());
        }
        leases.insert(
            id,
            LeaseState {
                nonce: input.take()?,
                position: input.number()?,
                expires: input.number()?,
            },
        );
    }
    if !input.0.is_empty() {
        return Err(CorruptionError::msg("governance v3 trailing bytes").into());
    }
    let state = GovernanceState {
        store_identity,
        sequence,
        outbox,
        retention: Some(RetentionState {
            policy,
            clock,
            floor,
            physical_gc,
            anchor,
            leases,
        }),
    };
    validate(&state)?;
    Ok(state)
}

#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
struct Fields<'a>(&'a [u8]);
#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
impl Fields<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], StorageError> {
        let (field, remaining) = self
            .0
            .split_at_checked(N)
            .ok_or_else(|| CorruptionError::msg("truncated governance v3 field"))?;
        self.0 = remaining;
        receipt_field(field)
    }
    fn number(&mut self) -> Result<u64, StorageError> {
        Ok(u64::from_be_bytes(self.take()?))
    }
    fn flag(&mut self) -> Result<bool, StorageError> {
        match self.take()? {
            [0] => Ok(false),
            [1] => Ok(true),
            _ => Err(CorruptionError::msg("invalid governance v3 flag").into()),
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "governance format and native failure assertions"
)]
mod tests {
    use super::*;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    use crate::store::{Store, TransactionKey, TransactionRequest};
    fn policy() -> OutboxRetentionPolicy {
        OutboxRetentionPolicy::new(
            NonZeroU64::new(1000).unwrap(),
            NonZeroU16::new(128).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn v3_codec_is_bounded_checksums_every_byte_and_preserves_old_formats()
    -> Result<(), GovernanceError> {
        let initial = super::super::outbox::prepare(
            &GovernanceState::default(),
            &[1; 16],
            &super::super::SemanticChangeSet::default(),
        )?;
        assert_eq!(initial.state.encode()[0], 2);
        assert_eq!(
            GovernanceState::decode(&initial.state.encode())?.encode(),
            initial.state.encode()
        );
        let configured = prepare(
            &initial.state,
            Action::Configure(policy()),
            GovernanceTime(10),
            |_| unreachable!(),
        )?;
        let high = initial.receipt.outbox_end_cursor().unwrap();
        let records: BTreeMap<_, _> = initial.records.into_iter().collect();
        let mut state = prepare(
            &configured.state,
            Action::Maintain {
                through: &high,
                limit: NonZeroUsize::MIN,
            },
            GovernanceTime(10),
            |position| {
                super::super::outbox::decode_record(
                    &initial.state.store_identity,
                    position,
                    &records[&position],
                )
            },
        )?
        .state;
        for id in 0..128 {
            state = prepare(
                &state,
                Action::Acquire {
                    id: [id; 16],
                    after: None,
                    expires: GovernanceTime(1000),
                },
                GovernanceTime(10),
                |_| unreachable!(),
            )?
            .state;
        }
        let encoded = state.encode();
        assert_eq!(encoded.len(), 6408);
        assert_eq!(encoded[0], 3);
        assert_eq!(GovernanceState::decode(&encoded)?.encode(), encoded);
        for index in 0..encoded.len() {
            let mut bytes = encoded.clone();
            bytes[index] ^= 1;
            assert!(GovernanceState::decode(&bytes).is_err(), "byte {index}");
        }
        for end in 0..encoded.len() {
            assert!(
                GovernanceState::decode(&encoded[..end]).is_err(),
                "truncation {end}"
            );
        }
        let mut extra = encoded.clone();
        extra.push(0);
        assert!(GovernanceState::decode(&extra).is_err());
        let mut invalid = state.clone();
        invalid.retention.as_mut().unwrap().physical_gc = 2;
        assert!(GovernanceState::decode(&invalid.encode()).is_err());
        let mut invalid = state.clone();
        invalid
            .retention
            .as_mut()
            .unwrap()
            .leases
            .get_mut(&[0; 16])
            .unwrap()
            .position = 0;
        assert!(GovernanceState::decode(&invalid.encode()).is_err());
        let expired = ExpiredCommitReceipt::new(&initial.receipt);
        let bytes = expired.encode();
        assert_eq!(
            ExpiredCommitReceipt::decode(&[1; 16], &bytes, &state)?,
            expired
        );
        assert!(ExpiredCommitReceipt::decode(&[2; 16], &bytes, &state).is_err());
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(ExpiredCommitReceipt::decode(&[1; 16], &corrupt, &state).is_err());
        }
        Ok(())
    }

    #[test]
    fn explicit_activation_allows_an_empty_lineage_but_not_invalid_lease_bounds()
    -> Result<(), GovernanceError> {
        let configured = prepare(
            &GovernanceState::default(),
            Action::Configure(policy()),
            GovernanceTime(0),
            |_| unreachable!(),
        )?;
        assert_eq!(configured.state.sequence, 0);
        assert_eq!(
            GovernanceState::decode(&configured.state.encode())?.encode(),
            configured.state.encode()
        );
        assert!(matches!(
            OutboxRetentionPolicy::new(NonZeroU64::MIN, NonZeroU16::new(129).unwrap()),
            Err(GovernanceError::InvalidPolicy)
        ));
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn synchronous_maintenance_lost_acknowledgement_resolves_after_reopen()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::model::{GraphName, NamedNode, Quad};
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        use crate::store::{CommitReceiptOutcome, WritableDataset};
        for point in [Fault::GovernanceBatchBefore, Fault::GovernanceBatchAfter] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            store.configure_outbox_retention(policy(), GovernanceTime(10))?;
            let mut tx = store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([1; 16]),
                )?
                .into_transaction();
            let node = NamedNode::new_unchecked("urn:retained");
            let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
            tx.insert(quad.clone())?;
            let receipt = tx.commit()?;
            let high = receipt.outbox_end_cursor().unwrap();
            store.storage.arm_transaction_outcome_fault(point)?;
            assert!(matches!(
                store.maintain_outbox(&high, NonZeroUsize::MIN, GovernanceTime(11)),
                Err(GovernanceError::MaintenanceIndeterminate(_))
            ));
            assert!(
                store
                    .storage
                    .transaction_outcome_fault_events()?
                    .contains(&point)
            );
            drop(store);
            let reopened = Store::open(directory.path())?;
            assert!(reopened.contains(&quad)?);
            let expired = point == Fault::GovernanceBatchAfter;
            assert_eq!(
                matches!(
                    reopened.lookup_commit_receipt(&TransactionKey::new([1; 16]))?,
                    CommitReceiptOutcome::Expired(_)
                ),
                expired
            );
            let health = reopened.governance_health(GovernanceTime(11), NonZeroUsize::MIN)?;
            assert_eq!(health.physical_records(), if expired { 1 } else { 2 });
            assert_eq!(health.retained_records(), if expired { 0 } else { 2 });
            assert!(
                reopened
                    .start_governed_transaction(
                        TransactionRequest::default(),
                        TransactionKey::new([1; 16])
                    )
                    .is_err()
            );
            reopened.maintain_outbox(&high, NonZeroUsize::MIN, GovernanceTime(11))?;
        }
        Ok(())
    }
}
