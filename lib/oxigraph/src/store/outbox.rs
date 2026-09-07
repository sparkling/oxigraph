//! Ordered, append-only delivery of native governed commits (ADR-0020).

use super::receipt::{GovernanceState, envelope_checksum, receipt_field};
use super::{
    CommitId, CommitReceipt, SemanticChange, SemanticChangeSet, StorageError, StoreIdentity,
};
use crate::storage::CorruptionError;
use std::num::NonZeroUsize;

/// Store-bound position in the governed outbox, not a receipt sequence or timestamp.
/// Persist the opaque bytes only after processing the corresponding record.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct OutboxCursor {
    store_identity: StoreIdentity,
    position: u64,
}

impl OutboxCursor {
    pub(crate) const fn new(store_identity: StoreIdentity, position: u64) -> Self {
        Self {
            store_identity,
            position,
        }
    }
    pub(crate) const fn position(&self) -> u64 {
        self.position
    }
    pub const fn store_identity(&self) -> &StoreIdentity {
        &self.store_identity
    }

    /// Stable versioned encoding. The checksum detects corruption, not forgery.
    pub fn to_bytes(&self) -> [u8; 57] {
        let mut bytes = [0; 57];
        bytes[0] = 1;
        bytes[1..17].copy_from_slice(self.store_identity.as_bytes());
        bytes[17..25].copy_from_slice(&self.position().to_be_bytes());
        let checksum = envelope_checksum(b"oxigraph.outbox.cursor.v1\0", &bytes[..25]);
        bytes[25..].copy_from_slice(&checksum);
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, OutboxReadError> {
        let bytes: &[u8; 57] = bytes
            .try_into()
            .map_err(|_| OutboxReadError::InvalidCursor)?;
        if bytes[0] != 1
            || bytes[25..] != envelope_checksum(b"oxigraph.outbox.cursor.v1\0", &bytes[..25])
        {
            return Err(OutboxReadError::InvalidCursor);
        }
        let position = u64::from_be_bytes(receipt_field(&bytes[17..25])?);
        if position == 0 {
            return Err(OutboxReadError::InvalidCursor);
        }
        Ok(Self {
            store_identity: StoreIdentity::from_bytes(receipt_field(&bytes[1..17])?),
            position,
        })
    }
}

/// Feed coverage begins after this governed receipt sequence. Earlier receipt-only
/// commits cannot be backfilled. Legacy, ungoverned writes are never covered.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxCoverage {
    store_identity: StoreIdentity,
    after_receipt_sequence: u64,
}

impl OutboxCoverage {
    pub const fn store_identity(&self) -> &StoreIdentity {
        &self.store_identity
    }
    pub const fn after_receipt_sequence(&self) -> u64 {
        self.after_receipt_sequence
    }
}

/// An ordered commit header or one semantic effect. A no-op commit has a header
/// and no effects. Pages may split a commit; deduplicate effects by
/// `(commit_id, event_index)`, where event indices start at zero.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum OutboxRecord {
    Commit {
        cursor: OutboxCursor,
        receipt: CommitReceipt,
    },
    Event {
        cursor: OutboxCursor,
        header_cursor: OutboxCursor,
        commit_id: CommitId,
        event_index: u64,
        event_count: u64,
        change: SemanticChange,
    },
}

impl OutboxRecord {
    pub const fn cursor(&self) -> &OutboxCursor {
        match self {
            Self::Commit { cursor, .. } | Self::Event { cursor, .. } => cursor,
        }
    }
}

/// A bounded page from one storage snapshot. Poll again after `next_cursor()`;
/// retrying the same cursor gives at-least-once delivery, not an acknowledgement.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxBatch {
    latest_receipt: Option<CommitReceipt>,
    records: Vec<OutboxRecord>,
    next_cursor: Option<OutboxCursor>,
    high_water: Option<OutboxCursor>,
    coverage: Option<OutboxCoverage>,
    retained_after: Option<OutboxCursor>,
}

impl OutboxBatch {
    /// Latest governed outbox commit, verified in this page's snapshot, even
    /// when pagination does not reach it. May be the retained expiry anchor.
    pub const fn latest_receipt(&self) -> Option<&CommitReceipt> {
        self.latest_receipt.as_ref()
    }
    /// Records at or before this whole-commit boundary have expired.
    pub const fn retained_after(&self) -> Option<&OutboxCursor> {
        self.retained_after.as_ref()
    }
    pub fn records(&self) -> &[OutboxRecord] {
        &self.records
    }
    pub const fn next_cursor(&self) -> Option<&OutboxCursor> {
        self.next_cursor.as_ref()
    }
    pub const fn high_water(&self) -> Option<&OutboxCursor> {
        self.high_water.as_ref()
    }
    pub const fn coverage(&self) -> Option<&OutboxCoverage> {
        self.coverage.as_ref()
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum OutboxReadError {
    #[error("invalid outbox cursor encoding")]
    InvalidCursor,
    #[error("outbox cursor belongs to a different store lineage")]
    DifferentStore,
    #[error("outbox cursor is ahead of this store snapshot")]
    CursorAhead,
    #[error("outbox cursor has expired")]
    CursorExpired { retained_after: OutboxCursor },
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl OutboxReadError {
    pub(crate) fn into_storage(self) -> StorageError {
        match self {
            Self::Storage(error) => error,
            error => StorageError::Other(Box::new(error)),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct OutboxState {
    pub high_water: u64,
    pub after_receipt_sequence: u64,
}

pub(crate) struct PreparedOutbox {
    pub receipt: CommitReceipt,
    pub state: GovernanceState,
    pub records: Vec<(u64, Vec<u8>)>,
}

pub(crate) fn prepare(
    state: &GovernanceState,
    key: &[u8; 16],
    changes: &SemanticChangeSet,
) -> Result<PreparedOutbox, StorageError> {
    super::retention::check_capacity(
        state,
        (changes.len() as u64)
            .checked_add(1)
            .ok_or_else(|| CorruptionError::msg("outbox record count exhausted"))?,
    )?;
    let high = state.outbox.as_ref().map_or(0, |outbox| outbox.high_water);
    let header = high
        .checked_add(1)
        .ok_or_else(|| CorruptionError::msg("outbox cursor exhausted"))?;
    let end = header
        .checked_add(changes.len() as u64)
        .ok_or_else(|| CorruptionError::msg("outbox cursor exhausted"))?;
    let receipt = state.next_receipt(key, changes)?.with_outbox_header(header);
    let mut records = Vec::new();
    let mut body = vec![1, 0];
    body.extend_from_slice(&receipt.encode());
    records.push((header, seal_record(&state.store_identity, header, body)));
    for (index, change) in changes.as_slice().iter().enumerate() {
        let payload = super::change_codec::encode(change)?;
        let index = index as u64;
        let position = header + 1 + index; // checked by the end calculation above
        let mut body = vec![1, 1];
        body.extend_from_slice(&header.to_be_bytes());
        body.extend_from_slice(&index.to_be_bytes());
        body.extend_from_slice(&receipt.effect_count().to_be_bytes());
        body.extend_from_slice(receipt.commit_id().as_bytes());
        body.extend_from_slice(&payload);
        records.push((position, seal_record(&state.store_identity, position, body)));
    }
    let mut state = state.clone();
    let origin = state
        .outbox
        .as_ref()
        .map_or(state.sequence, |outbox| outbox.after_receipt_sequence);
    state.sequence = receipt.sequence();
    state.outbox = Some(OutboxState {
        high_water: end,
        after_receipt_sequence: origin,
    });
    Ok(PreparedOutbox {
        receipt,
        state,
        records,
    })
}

fn seal_record(identity: &StoreIdentity, position: u64, mut body: Vec<u8>) -> Vec<u8> {
    let checksum = record_checksum(identity, position, &body);
    body.extend_from_slice(&checksum);
    body
}

fn record_checksum(identity: &StoreIdentity, position: u64, body: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"oxigraph.outbox.record.v1\0");
    hasher.update(identity.as_bytes());
    hasher.update(position.to_be_bytes());
    hasher.update(body);
    hasher.finalize().into()
}

pub(crate) fn decode_record(
    identity: &StoreIdentity,
    position: u64,
    bytes: &[u8],
) -> Result<OutboxRecord, StorageError> {
    let size = bytes
        .len()
        .checked_sub(32)
        .filter(|size| *size >= 2)
        .ok_or_else(|| CorruptionError::msg("truncated outbox record"))?;
    let body = &bytes[..size];
    let (tag, payload) = body.split_at(2);
    let tag: [u8; 2] = receipt_field(tag)?;
    if position == 0 || tag[0] != 1 || bytes[size..] != record_checksum(identity, position, body) {
        return Err(
            CorruptionError::msg("invalid outbox record version, position or checksum").into(),
        );
    }
    let cursor = OutboxCursor {
        store_identity: identity.clone(),
        position,
    };
    match tag[1] {
        0 => {
            let receipt = CommitReceipt::decode(payload)?;
            if receipt.store_identity() != identity
                || receipt.outbox_header_cursor().as_ref() != Some(&cursor)
            {
                return Err(
                    CorruptionError::msg("outbox header does not match its receipt").into(),
                );
            }
            Ok(OutboxRecord::Commit { cursor, receipt })
        }
        1 if body.len() >= 59 => {
            let (fields, payload) = payload.split_at(56);
            let fields: [u8; 56] = receipt_field(fields)?;
            let header = u64::from_be_bytes(receipt_field(&fields[..8])?);
            let index = u64::from_be_bytes(receipt_field(&fields[8..16])?);
            let count = u64::from_be_bytes(receipt_field(&fields[16..24])?);
            if header == 0
                || index >= count
                || header.checked_add(index).and_then(|n| n.checked_add(1)) != Some(position)
            {
                return Err(CorruptionError::msg("invalid outbox event position").into());
            }
            Ok(OutboxRecord::Event {
                cursor,
                header_cursor: OutboxCursor {
                    store_identity: identity.clone(),
                    position: header,
                },
                commit_id: CommitId::from_bytes(receipt_field(&fields[24..])?),
                event_index: index,
                event_count: count,
                change: super::change_codec::decode(payload)?,
            })
        }
        _ => Err(CorruptionError::msg("invalid outbox record kind or length").into()),
    }
}

/// Both backends supply point reads from ONE locked/snapshot generation.
/// Each page does O(page length) reads, never a scan-and-skip from the origin.
pub(crate) fn read_page(
    state: Option<&GovernanceState>,
    after: Option<&OutboxCursor>,
    limit: NonZeroUsize,
    mut get: impl FnMut(u64) -> Result<Option<Vec<u8>>, StorageError>,
    mut receipt_for: impl FnMut(&[u8; 16]) -> Result<Option<CommitReceipt>, StorageError>,
    mut has_after: impl FnMut(u64) -> Result<bool, StorageError>,
) -> Result<OutboxBatch, OutboxReadError> {
    if let Some(state) = state {
        super::retention::validate(state)?;
    }
    let floor = state.map_or(0, super::retention::floor);
    let retained_after =
        state.and_then(|state| super::retention::cursor(&state.store_identity, floor));
    let high = state
        .and_then(|state| state.outbox.as_ref())
        .map_or(0, |outbox| outbox.high_water);
    if has_after(high)? {
        return Err(StorageError::from(CorruptionError::msg(
            "outbox records beyond high-water state",
        ))
        .into());
    }
    if let Some(after) = after {
        if state.is_none_or(|state| after.store_identity != state.store_identity) {
            return Err(OutboxReadError::DifferentStore);
        }
        if after.position > high {
            return Err(OutboxReadError::CursorAhead);
        }
        if after.position < floor {
            return Err(OutboxReadError::CursorExpired {
                retained_after: OutboxCursor::new(after.store_identity.clone(), floor),
            });
        }
    }
    let Some((state, outbox)) =
        state.and_then(|state| state.outbox.as_ref().map(|outbox| (state, outbox)))
    else {
        return Ok(OutboxBatch {
            latest_receipt: None,
            records: Vec::new(),
            next_cursor: after.cloned(),
            high_water: None,
            coverage: None,
            retained_after,
        });
    };
    let identity = &state.store_identity;
    let retention_anchor = state
        .retention
        .as_ref()
        .and_then(|retention| retention.anchor.as_ref());
    if let Some(anchor) = retention_anchor {
        validate_header(anchor, state, &mut receipt_for)?;
    }
    let mut read = |position| -> Result<OutboxRecord, StorageError> {
        let bytes = get(position)?
            .ok_or_else(|| CorruptionError::msg("outbox gap below high-water mark"))?;
        decode_record(identity, position, &bytes)
    };
    // Validate the latest complete commit even on an empty page. An earlier
    // page need not scan the full history to reject an inconsistent watermark.
    let last = if high == floor {
        OutboxRecord::Commit {
            cursor: OutboxCursor::new(identity.clone(), high),
            receipt: retention_anchor
                .ok_or_else(|| {
                    StorageError::from(CorruptionError::msg("missing retention anchor"))
                })?
                .clone(),
        }
    } else {
        read(high)?
    };
    let last_header = match &last {
        OutboxRecord::Commit { .. } => last.clone(),
        OutboxRecord::Event { header_cursor, .. } => read(header_cursor.position)?,
    };
    let OutboxRecord::Commit {
        receipt: latest, ..
    } = &last_header
    else {
        return Err(StorageError::from(CorruptionError::msg(
            "outbox event points to a non-header",
        ))
        .into());
    };
    if latest.sequence() != state.sequence
        || latest
            .outbox_end_cursor()
            .is_none_or(|cursor| cursor.position != high)
    {
        return Err(StorageError::from(CorruptionError::msg(
            "outbox high-water does not finish the latest receipt",
        ))
        .into());
    }
    validate_header(latest, state, &mut receipt_for)?;
    validate_event(&last, latest)?;
    let start = after.map_or(floor, |cursor| cursor.position);
    let count = (high - start).min(u64::try_from(limit.get()).unwrap_or(u64::MAX));
    let mut records = Vec::new();
    let mut cached_header: Option<CommitReceipt> = retention_anchor.cloned();
    if let Some(after) = after.filter(|cursor| cursor.position > floor) {
        let anchor = read(after.position)?;
        let header = match &anchor {
            OutboxRecord::Commit { receipt, .. } => receipt.clone(),
            OutboxRecord::Event { header_cursor, .. } => {
                let OutboxRecord::Commit { receipt, .. } = read(header_cursor.position)? else {
                    return Err(StorageError::from(CorruptionError::msg(
                        "cursor event points to a non-header",
                    ))
                    .into());
                };
                receipt
            }
        };
        validate_header(&header, state, &mut receipt_for)?;
        validate_event(&anchor, &header)?;
        cached_header = Some(header);
    }
    for offset in 1..=count {
        let record = read(start + offset)?;
        match &record {
            OutboxRecord::Commit { cursor, receipt } => {
                validate_header(receipt, state, &mut receipt_for)?;
                if let Some(previous) = &cached_header {
                    if previous
                        .outbox_end_cursor()
                        .and_then(|cursor| cursor.position.checked_add(1))
                        != Some(cursor.position)
                        || previous.sequence().checked_add(1) != Some(receipt.sequence())
                    {
                        return Err(StorageError::from(CorruptionError::msg(
                            "outbox commit boundary or sequence gap",
                        ))
                        .into());
                    }
                } else if cursor.position != 1
                    || receipt.sequence() != outbox.after_receipt_sequence + 1
                {
                    return Err(StorageError::from(CorruptionError::msg(
                        "outbox origin disagrees with first receipt",
                    ))
                    .into());
                }
                cached_header = Some(receipt.clone());
            }
            OutboxRecord::Event { .. } => {
                let Some(receipt) = &cached_header else {
                    return Err(StorageError::from(CorruptionError::msg(
                        "outbox event without preceding header",
                    ))
                    .into());
                };
                validate_event(&record, receipt)?;
            }
        }
        records.push(record);
    }
    let next_cursor = records
        .last()
        .map(|record| record.cursor().clone())
        .or_else(|| after.cloned())
        .or_else(|| retained_after.clone());
    Ok(OutboxBatch {
        latest_receipt: Some(latest.clone()),
        records,
        next_cursor,
        high_water: Some(OutboxCursor {
            store_identity: identity.clone(),
            position: high,
        }),
        coverage: Some(OutboxCoverage {
            store_identity: identity.clone(),
            after_receipt_sequence: outbox.after_receipt_sequence,
        }),
        retained_after,
    })
}

fn validate_header(
    receipt: &CommitReceipt,
    state: &GovernanceState,
    get: &mut impl FnMut(&[u8; 16]) -> Result<Option<CommitReceipt>, StorageError>,
) -> Result<(), StorageError> {
    let Some(outbox) = &state.outbox else {
        return Err(CorruptionError::msg("missing outbox state").into());
    };
    if receipt.sequence() <= outbox.after_receipt_sequence
        || receipt.sequence() > state.sequence
        || receipt.outbox_header_cursor().is_some_and(|cursor| {
            cursor.position == 1 && receipt.sequence() != outbox.after_receipt_sequence + 1
        })
        || receipt
            .outbox_end_cursor()
            .is_none_or(|cursor| cursor.position > outbox.high_water)
        || get(receipt.transaction_key().as_bytes())?.as_ref() != Some(receipt)
    {
        return Err(CorruptionError::msg(
            "outbox header disagrees with committed receipt or coverage",
        )
        .into());
    }
    Ok(())
}

pub(crate) fn validate_event(
    record: &OutboxRecord,
    receipt: &CommitReceipt,
) -> Result<(), StorageError> {
    if let OutboxRecord::Event {
        commit_id,
        event_count,
        header_cursor,
        ..
    } = record
        && (commit_id != receipt.commit_id()
            || *event_count != receipt.effect_count()
            || receipt.outbox_header_cursor().as_ref() != Some(header_cursor))
    {
        return Err(CorruptionError::msg("outbox event disagrees with its commit header").into());
    }
    Ok(())
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "outbox format and corruption assertions"
)]
mod tests {
    use super::*;
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::Store;
    use std::collections::{BTreeMap, HashMap};

    fn changes() -> SemanticChangeSet {
        let node = NamedNode::new_unchecked("urn:term");
        use crate::store::{ChangeTrackingTransaction, WritableDataset};
        let store = Store::new().unwrap();
        let mut tx = ChangeTrackingTransaction::new(store.start_transaction().unwrap());
        tx.insert(Quad::new(
            node.clone(),
            node.clone(),
            node,
            GraphName::DefaultGraph,
        ))
        .unwrap();
        tx.changes().unwrap()
    }
    fn page(
        state: Option<&GovernanceState>,
        records: &BTreeMap<u64, Vec<u8>>,
        receipts: &HashMap<[u8; 16], CommitReceipt>,
    ) -> Result<OutboxBatch, OutboxReadError> {
        read_page(
            state,
            None,
            NonZeroUsize::new(10).unwrap(),
            |position| Ok(records.get(&position).cloned()),
            |key| Ok(receipts.get(key).cloned()),
            |position| {
                Ok(records
                    .last_key_value()
                    .is_some_and(|(last, _)| *last > position))
            },
        )
    }

    #[test]
    fn receipt_only_activation_has_an_explicit_origin_and_compatible_formats()
    -> Result<(), StorageError> {
        let legacy = GovernanceState {
            sequence: 4,
            ..GovernanceState::default()
        };
        assert_eq!(legacy.encode().len(), 57);
        let prepared = prepare(&legacy, &[1; 16], &changes())?;
        assert_eq!(prepared.receipt.sequence(), 5);
        assert_eq!(prepared.receipt.schema_version(), 2);
        assert_eq!(prepared.receipt.encode().len(), 153);
        assert_eq!(
            CommitReceipt::decode(&prepared.receipt.encode())?,
            prepared.receipt
        );
        assert_eq!(prepared.state.encode().len(), 73);
        let decoded = GovernanceState::decode(&prepared.state.encode())?;
        assert_eq!(decoded.outbox.as_ref().unwrap().after_receipt_sequence, 4);
        assert_eq!(decoded.outbox.as_ref().unwrap().high_water, 2);
        let bytes = prepared.state.encode();
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(GovernanceState::decode(&corrupt).is_err());
        }
        let bytes = prepared.receipt.encode();
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(CommitReceipt::decode(&corrupt).is_err());
        }
        Ok(())
    }

    #[test]
    fn corrupt_gapped_swapped_and_inconsistent_records_stop_replay() -> Result<(), StorageError> {
        let first = prepare(&GovernanceState::default(), &[1; 16], &changes())?;
        let second = prepare(&first.state, &[2; 16], &SemanticChangeSet::default())?;
        let records: BTreeMap<_, _> = first
            .records
            .iter()
            .chain(&second.records)
            .cloned()
            .collect();
        let receipts = HashMap::from([
            ([1; 16], first.receipt.clone()),
            ([2; 16], second.receipt.clone()),
        ]);
        assert_eq!(
            page(Some(&second.state), &records, &receipts)
                .unwrap()
                .records()
                .len(),
            3
        );
        for position in 1..=3 {
            let mut damaged = records.clone();
            damaged.remove(&position);
            assert!(page(Some(&second.state), &damaged, &receipts).is_err());
            let cursor = OutboxCursor {
                store_identity: second.state.store_identity.clone(),
                position,
            };
            assert!(
                read_page(
                    Some(&second.state),
                    Some(&cursor),
                    NonZeroUsize::MIN,
                    |position| Ok(damaged.get(&position).cloned()),
                    |key| Ok(receipts.get(key).cloned()),
                    |position| Ok(damaged
                        .last_key_value()
                        .is_some_and(|(last, _)| *last > position))
                )
                .is_err()
            );
        }
        for (position, bytes) in &records {
            for index in 0..bytes.len() {
                let mut corrupt = bytes.clone();
                corrupt[index] ^= 1;
                assert!(decode_record(&second.state.store_identity, *position, &corrupt).is_err());
            }
            assert!(decode_record(&second.state.store_identity, position + 1, bytes).is_err());
            for end in 0..bytes.len() {
                assert!(
                    decode_record(&second.state.store_identity, *position, &bytes[..end]).is_err()
                );
            }
        }
        assert!(page(None, &records, &receipts).is_err());
        for high_water in [1, 2, 4] {
            let state = GovernanceState {
                outbox: Some(OutboxState {
                    high_water,
                    after_receipt_sequence: 0,
                }),
                ..second.state.clone()
            };
            assert!(page(Some(&state), &records, &receipts).is_err());
        }
        let mut absent = receipts.clone();
        absent.remove(&[1; 16]);
        assert!(page(Some(&second.state), &records, &absent).is_err());
        Ok(())
    }

    #[test]
    fn checksum_valid_headers_cannot_skip_events_or_the_coverage_origin() -> Result<(), StorageError>
    {
        let first = prepare(&GovernanceState::default(), &[1; 16], &changes())?;
        let second = prepare(&first.state, &[2; 16], &SemanticChangeSet::default())?;
        let overlapping = second.receipt.clone().with_outbox_header(2);
        let mut body = vec![1, 0];
        body.extend_from_slice(&overlapping.encode());
        let records = BTreeMap::from([
            first.records[0].clone(),
            (2, seal_record(&first.state.store_identity, 2, body)),
        ]);
        let receipts = HashMap::from([([1; 16], first.receipt), ([2; 16], overlapping)]);
        let mut state = second.state.clone();
        state.outbox.as_mut().unwrap().high_water = 2;
        assert!(page(Some(&state), &records, &receipts).is_err());
        let skipped = second.receipt.with_outbox_header(1);
        let mut body = vec![1, 0];
        body.extend_from_slice(&skipped.encode());
        let records = BTreeMap::from([(1, seal_record(&state.store_identity, 1, body))]);
        let receipts = HashMap::from([([2; 16], skipped)]);
        state.outbox.as_mut().unwrap().high_water = 1;
        assert!(page(Some(&state), &records, &receipts).is_err());
        Ok(())
    }

    #[test]
    fn outbox_overflow_is_rejected_before_allocation() {
        for high_water in [u64::MAX, u64::MAX - 1] {
            let state = GovernanceState {
                sequence: 1,
                outbox: Some(OutboxState {
                    high_water,
                    after_receipt_sequence: 0,
                }),
                ..GovernanceState::default()
            };
            assert!(prepare(&state, &[1; 16], &changes()).is_err());
        }
    }
}
