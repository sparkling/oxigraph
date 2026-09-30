//! Bounded analytical access over one retained storage reader.
//!
//! On RocksDB a `Relation` is a descriptor of one EXISTING quad index whose key
//! order places the pattern's graph and constants first, then its variables in
//! the requested global order. Building reads no quad and every seek is one
//! ordered prefix seek on the caller's snapshot reader, charged to `Control`.
//! Only the in-memory backend materializes a bounded, sorted transient
//! relation. No persistent index, schema or public trait is added.

use super::StorageError;
use super::StorageReader;
use super::StorageReaderKind;
use super::binary_encoder::{TermReader, WRITTEN_TERM_MAX_SIZE, write_term};
use super::numeric_encoder::EncodedTerm;
use std::cmp::Ordering;
use std::error::Error;
use std::fmt;
use std::mem::size_of;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Limit {
    Rows,
    Bytes,
    Work,
}

#[derive(Debug)]
pub(crate) enum AccessError {
    Storage(StorageError),
    Limit(Limit),
    Interrupted,
    /// A term or shape outside the bounded profile, such as a triple term.
    Unsupported,
    /// No existing index orders the pattern's constants before its variables
    /// in the requested variable order. Returned by `Relation::build` only,
    /// before any byte is charged or any row is read.
    #[cfg_attr(
        not(all(not(target_family = "wasm"), feature = "rocksdb")),
        expect(
            dead_code,
            reason = "Only native index selection refuses an index order"
        )
    )]
    UnsupportedOrder,
}

impl From<StorageError> for AccessError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

impl fmt::Display for AccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(error) => write!(f, "{error}"),
            Self::Limit(limit) => write!(f, "analytical {limit:?} limit exceeded"),
            Self::Interrupted => f.write_str("analytical access interrupted"),
            Self::Unsupported => {
                f.write_str("analytical access does not support this term or shape")
            }
            Self::UnsupportedOrder => {
                f.write_str("no existing index supports this analytical variable order")
            }
        }
    }
}

impl Error for AccessError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(error) => Some(error),
            _ => None,
        }
    }
}

/// Requested transient allocations and work, not native snapshot memory or RSS.
pub(crate) struct Control<F> {
    max_rows: usize,
    max_bytes: usize,
    max_work: u64,
    bytes: usize,
    work: u64,
    alive: F,
}

impl<F: FnMut() -> bool> Control<F> {
    pub(crate) fn new(max_rows: usize, max_bytes: usize, max_work: u64, alive: F) -> Self {
        Self {
            max_rows,
            max_bytes,
            max_work,
            bytes: 0,
            work: 0,
            alive,
        }
    }

    pub(crate) fn bytes(&self) -> usize {
        self.bytes
    }

    pub(crate) fn work(&self) -> u64 {
        self.work
    }

    pub(crate) fn tick(&mut self, work: u64) -> Result<(), AccessError> {
        if !(self.alive)() {
            return Err(AccessError::Interrupted);
        }
        let next = self
            .work
            .checked_add(work)
            .ok_or(AccessError::Limit(Limit::Work))?;
        if next > self.max_work {
            return Err(AccessError::Limit(Limit::Work));
        }
        self.work = next;
        Ok(())
    }

    /// Charges transient bytes before they are allocated.
    pub(crate) fn reserve(&mut self, bytes: usize) -> Result<(), AccessError> {
        self.tick(0)?;
        let next = self
            .bytes
            .checked_add(bytes)
            .ok_or(AccessError::Limit(Limit::Bytes))?;
        if next > self.max_bytes {
            return Err(AccessError::Limit(Limit::Bytes));
        }
        self.bytes = next;
        Ok(())
    }

    /// Returns the charge of transient state that has been dropped.
    pub(crate) fn release(&mut self, bytes: usize) {
        self.bytes = self.bytes.saturating_sub(bytes);
    }

    /// Bytes still available below the ceiling.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "consumer byte accounting is repaired separately")
    )]
    pub(crate) fn remaining_bytes(&self) -> usize {
        self.max_bytes.saturating_sub(self.bytes)
    }
}

/// One encoded non-recursive term; byte order is the physical index order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Key {
    bytes: [u8; WRITTEN_TERM_MAX_SIZE],
    len: usize,
}

impl Key {
    const EMPTY: Self = Self {
        bytes: [0; WRITTEN_TERM_MAX_SIZE],
        len: 0,
    };

    pub(crate) fn encode(term: &EncodedTerm) -> Result<Self, AccessError> {
        // Recursive terms need a separate bounded encoding profile.
        #[cfg(feature = "rdf-12")]
        if matches!(term, EncodedTerm::Triple(_)) {
            return Err(AccessError::Unsupported);
        }
        let mut encoded = Vec::with_capacity(WRITTEN_TERM_MAX_SIZE);
        write_term(&mut encoded, term);
        Self::from_bytes(&encoded)
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, AccessError> {
        let mut result = Self::EMPTY;
        result
            .bytes
            .get_mut(..bytes.len())
            .ok_or(AccessError::Unsupported)?
            .copy_from_slice(bytes);
        result.len = bytes.len();
        Ok(result)
    }

    fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len]
    }

    pub(crate) fn decode(&self) -> Result<EncodedTerm, StorageError> {
        let mut bytes = self.as_bytes();
        bytes.read_term()
    }
}

impl Ord for Key {
    fn cmp(&self, other: &Self) -> Ordering {
        self.as_bytes().cmp(other.as_bytes())
    }
}

impl PartialOrd for Key {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone)]
pub(crate) enum Position {
    Constant(EncodedTerm),
    Variable(usize),
}

impl Position {
    fn constant(&self) -> Option<&EncodedTerm> {
        if let Self::Constant(value) = self {
            Some(value)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd)]
struct Row([Key; 3]);

pub(crate) struct Relation {
    variables: [usize; 3],
    arity: usize,
    access: Access,
}

enum Access {
    /// Sorted, deduplicated rows; the in-memory backend only.
    Materialized(Vec<Row>),
    /// A descriptor of one existing RocksDB quad index; no rows are held.
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    Native(native::Index),
}

impl Relation {
    /// Whether `build` accepts `order` for this pattern on `reader`: always on
    /// the materializing backend, otherwise when an existing index orders the
    /// graph, the constants, then the restriction of `order`. `order` may be a
    /// prefix of the global order as long as it covers every pattern variable;
    /// the restriction, hence the answer, is then that of every completion.
    /// Reads no data and charges nothing.
    #[cfg_attr(
        not(all(not(target_family = "wasm"), feature = "rocksdb")),
        expect(
            unused_variables,
            reason = "only native descriptors depend on the order"
        )
    )]
    pub(crate) fn supports_order(
        reader: &StorageReader<'_>,
        pattern: &[Position; 3],
        graph: &EncodedTerm,
        order: &[usize],
    ) -> Result<bool, AccessError> {
        if order.len() > 8 {
            return Err(AccessError::Unsupported);
        }
        let (variables, arity) = relation_variables(pattern, order)?;
        for constant in pattern
            .iter()
            .filter_map(Position::constant)
            .chain(std::iter::once(graph))
        {
            Key::encode(constant)?;
        }
        match &reader.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(_) => {
                match native::Index::select(pattern, graph, &variables[..arity]) {
                    Ok(_) => Ok(true),
                    Err(AccessError::UnsupportedOrder) => Ok(false),
                    Err(error) => Err(error),
                }
            }
            StorageReaderKind::Memory(_) => Ok(true),
        }
    }
    pub(crate) fn variables(&self) -> &[usize] {
        &self.variables[..self.arity]
    }

    pub(crate) fn build<F: FnMut() -> bool>(
        reader: &StorageReader<'_>,
        pattern: &[Position; 3],
        graph: &EncodedTerm,
        order: &[usize],
        control: &mut Control<F>,
    ) -> Result<Self, AccessError> {
        control.tick(1)?;
        if order.len() > 8 || control.max_rows == 0 {
            return Err(AccessError::Unsupported);
        }
        let (variables, arity) = relation_variables(pattern, order)?;
        for constant in pattern
            .iter()
            .filter_map(Position::constant)
            .chain(std::iter::once(graph))
        {
            Key::encode(constant)?;
        }
        let access = match &reader.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(_) => {
                // Selected before any charge; building reads no quad.
                let index = native::Index::select(pattern, graph, &variables[..arity])?;
                control.reserve(size_of::<Self>())?;
                Access::Native(index)
            }
            StorageReaderKind::Memory(_) => {
                control.reserve(size_of::<Self>())?;
                Access::Materialized(materialize(
                    reader,
                    pattern,
                    graph,
                    &variables[..arity],
                    control,
                )?)
            }
        };
        Ok(Self {
            variables,
            arity,
            access,
        })
    }

    /// Least next-column value under an exact prefix. Exclusive lower advances
    /// to the next distinct value, never the next row with the same value.
    /// The reader must be of the backend the relation was built on.
    #[cfg_attr(
        not(all(not(target_family = "wasm"), feature = "rocksdb")),
        expect(unused_variables, reason = "materialized rows need no reader")
    )]
    pub(crate) fn seek<F: FnMut() -> bool>(
        &self,
        reader: &StorageReader<'_>,
        prefix: &[Key],
        lower: Option<&Key>,
        exclusive: bool,
        control: &mut Control<F>,
    ) -> Result<Option<Key>, AccessError> {
        control.tick(1)?;
        if prefix.len() >= self.arity {
            return Err(AccessError::Unsupported);
        }
        match &self.access {
            Access::Materialized(rows) => {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                if let StorageReaderKind::RocksDb(_) = &reader.kind {
                    return Err(AccessError::Unsupported);
                }
                seek_rows(rows, prefix, lower, exclusive, control)
            }
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            Access::Native(index) => match &reader.kind {
                StorageReaderKind::RocksDb(reader) => {
                    index.seek(reader, prefix, lower, exclusive, control)
                }
                StorageReaderKind::Memory(_) => Err(AccessError::Unsupported),
            },
        }
    }

    #[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
    fn native_order(&self) -> Option<(native::Order, bool)> {
        match &self.access {
            Access::Native(index) => Some(index.order()),
            Access::Materialized(_) => None,
        }
    }
}

/// Pattern variables in the restriction of the global order.
fn relation_variables(
    pattern: &[Position; 3],
    order: &[usize],
) -> Result<([usize; 3], usize), AccessError> {
    let mut variables = [0; 3];
    let mut arity = 0;
    for (index, variable) in order.iter().enumerate() {
        if order[..index].contains(variable) {
            return Err(AccessError::Unsupported);
        }
        if pattern
            .iter()
            .any(|p| matches!(p, Position::Variable(v) if v == variable))
        {
            *variables.get_mut(arity).ok_or(AccessError::Unsupported)? = *variable;
            arity += 1;
        }
    }
    if arity == 0
        || pattern
            .iter()
            .any(|p| matches!(p, Position::Variable(v) if !variables[..arity].contains(v)))
    {
        return Err(AccessError::Unsupported);
    }
    Ok((variables, arity))
}

fn materialize<F: FnMut() -> bool>(
    reader: &StorageReader<'_>,
    pattern: &[Position; 3],
    graph: &EncodedTerm,
    variables: &[usize],
    control: &mut Control<F>,
) -> Result<Vec<Row>, AccessError> {
    let mut rows = Vec::new();
    let mut quads = reader.quads_for_pattern(
        pattern[0].constant(),
        pattern[1].constant(),
        pattern[2].constant(),
        Some(graph),
    );
    loop {
        control.tick(1)?;
        let Some(quad) = quads.next() else { break };
        let quad = quad?;
        let terms = [&quad.subject, &quad.predicate, &quad.object];
        let mut row = Row([Key::EMPTY; 3]);
        let mut consistent = true;
        for (column, variable) in variables.iter().enumerate() {
            let mut value = None;
            for (position, term) in pattern.iter().zip(terms) {
                if matches!(position, Position::Variable(v) if v == variable) {
                    let encoded = Key::encode(term)?;
                    if value.is_some_and(|previous| previous != encoded) {
                        consistent = false;
                    }
                    value = Some(encoded);
                }
            }
            row.0[column] = value.ok_or(AccessError::Unsupported)?;
        }
        if consistent {
            if rows.len() == control.max_rows {
                return Err(AccessError::Limit(Limit::Rows));
            }
            if rows.len() == rows.capacity() {
                grow(&mut rows, control)?;
            }
            rows.push(row);
        }
    }
    sort(&mut rows, control)?;
    // A relation is a quad set in one fixed graph, not seed solutions.
    let mut kept = 0;
    for index in 0..rows.len() {
        control.tick(1)?;
        if kept == 0 || rows[index] != rows[kept - 1] {
            rows[kept] = rows[index];
            kept += 1;
        }
    }
    rows.truncate(kept);
    control.tick(1)?;
    Ok(rows)
}

/// Geometric growth; each requested capacity is charged before allocation.
fn grow<F: FnMut() -> bool>(
    rows: &mut Vec<Row>,
    control: &mut Control<F>,
) -> Result<(), AccessError> {
    let target = rows
        .capacity()
        .saturating_mul(2)
        .max(4)
        .min(control.max_rows);
    let additional = target.saturating_sub(rows.len());
    let bytes = additional
        .checked_mul(size_of::<Row>())
        .ok_or(AccessError::Limit(Limit::Bytes))?;
    control.reserve(bytes)?;
    rows.try_reserve_exact(additional)
        .map_err(|_| AccessError::Limit(Limit::Bytes))
}

fn seek_rows<F: FnMut() -> bool>(
    rows: &[Row],
    prefix: &[Key],
    lower: Option<&Key>,
    exclusive: bool,
    control: &mut Control<F>,
) -> Result<Option<Key>, AccessError> {
    let column = prefix.len();
    let mut left = 0;
    let mut right = rows.len();
    while left < right {
        control.tick(1)?;
        let middle = left + (right - left) / 2;
        let row = &rows[middle].0;
        let cmp = row[..column]
            .cmp(prefix)
            .then_with(|| lower.map_or(Ordering::Equal, |bound| row[column].cmp(bound)));
        if cmp == Ordering::Less || (exclusive && lower.is_some() && cmp == Ordering::Equal) {
            left = middle + 1;
        } else {
            right = middle;
        }
    }
    control.tick(0)?;
    Ok(rows
        .get(left)
        .filter(|row| row.0[..column] == *prefix)
        .map(|row| row.0[column]))
}

fn sort<F: FnMut() -> bool>(rows: &mut [Row], control: &mut Control<F>) -> Result<(), AccessError> {
    fn sift<F: FnMut() -> bool>(
        rows: &mut [Row],
        mut root: usize,
        control: &mut Control<F>,
    ) -> Result<(), AccessError> {
        while root < rows.len() / 2 {
            control.tick(1)?;
            let mut child = root * 2 + 1;
            if child + 1 < rows.len() && rows[child] < rows[child + 1] {
                child += 1;
            }
            if rows[root] >= rows[child] {
                break;
            }
            rows.swap(root, child);
            root = child;
        }
        Ok(())
    }
    for root in (0..rows.len() / 2).rev() {
        sift(rows, root, control)?;
    }
    for end in (1..rows.len()).rev() {
        control.tick(1)?;
        rows.swap(0, end);
        sift(&mut rows[..end], 0, control)?;
    }
    Ok(())
}

/// Ordered prefix seeks through the existing RocksDB quad indexes.
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod native {
    use super::{AccessError, Control, Key, Position};
    use crate::storage::CorruptionError;
    use crate::storage::StorageError;
    use crate::storage::binary_encoder::{QuadEncoding, TermReader, WRITTEN_TERM_MAX_SIZE};
    use crate::storage::numeric_encoder::EncodedTerm;
    use crate::storage::rocksdb::RocksDbStorageReader;

    /// Longest index key made of non-recursive terms: graph plus three terms.
    const MAX_KEY: usize = 4 * WRITTEN_TERM_MAX_SIZE;

    /// Triple key orders of the existing families after a fixed graph prefix.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub(super) enum Order {
        Spo,
        Pos,
        Osp,
    }

    impl Order {
        const ALL: [Self; 3] = [Self::Spo, Self::Pos, Self::Osp];

        /// Pattern positions (subject 0, predicate 1, object 2) in key order.
        const fn positions(self) -> [usize; 3] {
            match self {
                Self::Spo => [0, 1, 2],
                Self::Pos => [1, 2, 0],
                Self::Osp => [2, 0, 1],
            }
        }

        const fn encoding(self, named: bool) -> QuadEncoding {
            match (self, named) {
                (Self::Spo, false) => QuadEncoding::Dspo,
                (Self::Pos, false) => QuadEncoding::Dpos,
                (Self::Osp, false) => QuadEncoding::Dosp,
                (Self::Spo, true) => QuadEncoding::Gspo,
                (Self::Pos, true) => QuadEncoding::Gpos,
                (Self::Osp, true) => QuadEncoding::Gosp,
            }
        }
    }

    /// Fixed-capacity key bytes; seek state never touches the heap.
    #[derive(Clone, Copy)]
    struct KeyBuffer {
        bytes: [u8; MAX_KEY],
        len: usize,
    }

    impl KeyBuffer {
        const EMPTY: Self = Self {
            bytes: [0; MAX_KEY],
            len: 0,
        };

        fn push(&mut self, bytes: &[u8]) -> Result<(), AccessError> {
            let end = self
                .len
                .checked_add(bytes.len())
                .filter(|end| *end <= MAX_KEY)
                .ok_or(AccessError::Unsupported)?;
            self.bytes[self.len..end].copy_from_slice(bytes);
            self.len = end;
            Ok(())
        }

        fn as_slice(&self) -> &[u8] {
            &self.bytes[..self.len]
        }

        /// Least byte string above every string starting with this one. False
        /// when it would no longer start with the first `floor` bytes.
        fn successor(&mut self, floor: usize) -> bool {
            while self.len > floor {
                let last = self.len - 1;
                if self.bytes[last] < u8::MAX {
                    self.bytes[last] += 1;
                    return true;
                }
                self.len = last;
            }
            false
        }
    }

    /// Bounded descriptor of one existing index; holds no reader or iterator.
    pub(super) struct Index {
        order: Order,
        named: bool,
        /// Graph and constant terms, in index key order.
        prefix: KeyBuffer,
        /// Number of adjacent key positions of each relation column.
        widths: [usize; 3],
    }

    impl Index {
        /// The first index family whose key order is the graph, the pattern's
        /// constants, then its variables in `variables` order with repeated
        /// positions adjacent. Deterministic; no data is read.
        pub(super) fn select(
            pattern: &[Position; 3],
            graph: &EncodedTerm,
            variables: &[usize],
        ) -> Result<Self, AccessError> {
            let column = |position: &Position| match position {
                Position::Constant(_) => Ok(0),
                Position::Variable(variable) => variables
                    .iter()
                    .position(|v| v == variable)
                    .map(|column| column + 1)
                    .ok_or(AccessError::Unsupported),
            };
            for order in Order::ALL {
                let positions = order.positions();
                let mut ranks = [0; 3];
                for (rank, position) in ranks.iter_mut().zip(positions) {
                    *rank = column(&pattern[position])?;
                }
                if ranks.windows(2).any(|pair| pair[0] > pair[1]) {
                    continue;
                }
                let mut prefix = KeyBuffer::EMPTY;
                // The default graph encodes to no bytes.
                prefix.push(Key::encode(graph)?.as_bytes())?;
                let mut widths = [0; 3];
                for (rank, position) in ranks.into_iter().zip(positions) {
                    if rank == 0 {
                        let Position::Constant(term) = &pattern[position] else {
                            return Err(AccessError::Unsupported);
                        };
                        prefix.push(Key::encode(term)?.as_bytes())?;
                    } else {
                        widths[rank - 1] += 1;
                    }
                }
                return Ok(Self {
                    order,
                    named: !graph.is_default_graph(),
                    prefix,
                    widths,
                });
            }
            Err(AccessError::UnsupportedOrder)
        }

        #[cfg(test)]
        pub(super) fn order(&self) -> (Order, bool) {
            (self.order, self.named)
        }

        pub(super) fn seek<F: FnMut() -> bool>(
            &self,
            reader: &RocksDbStorageReader<'_>,
            prefix: &[Key],
            lower: Option<&Key>,
            exclusive: bool,
            control: &mut Control<F>,
        ) -> Result<Option<Key>, AccessError> {
            let encoding = self.order.encoding(self.named);
            let mut base = self.prefix;
            for (value, width) in prefix.iter().zip(self.widths) {
                for _ in 0..width {
                    base.push(value.as_bytes())?;
                }
            }
            let width = *self
                .widths
                .get(prefix.len())
                .ok_or(AccessError::Unsupported)?;
            if width == 0 {
                return Err(AccessError::Unsupported);
            }
            let mut lower = lower.copied();
            let mut exclusive = exclusive && lower.is_some();
            let mut key = [0; MAX_KEY];
            loop {
                let mut from = base;
                if let Some(lower) = &lower {
                    from.push(lower.as_bytes())?;
                    // Encodings are prefix-free: the successor skips exactly
                    // the keys holding this value in this column.
                    if exclusive && !from.successor(base.len) {
                        return Ok(None);
                    }
                }
                let Some(length) = probe(reader, encoding, &base, &from, &mut key, control)? else {
                    return Ok(None);
                };
                let found = &key[..length.min(MAX_KEY)];
                if !found.starts_with(base.as_slice()) {
                    return Err(StorageError::from(CorruptionError::msg(
                        "analytical seek left its index prefix",
                    ))
                    .into());
                }
                let (value, mut offset) = read_key(found, base.len, length)?;
                let mut repeated = true;
                for _ in 1..width {
                    let (other, next) = read_key(found, offset, length)?;
                    if other != value {
                        repeated = false;
                        break;
                    }
                    offset = next;
                }
                if !repeated {
                    // Another key in this value's range may still repeat it.
                    let mut exact = base;
                    for _ in 0..width {
                        exact.push(value.as_bytes())?;
                    }
                    let mut scratch = [0; MAX_KEY];
                    if probe(reader, encoding, &exact, &exact, &mut scratch, control)?.is_none() {
                        lower = Some(value);
                        exclusive = true;
                        continue;
                    }
                }
                return Ok(Some(value));
            }
        }
    }

    /// One charged, cancellable seek on the reader's snapshot.
    fn probe<F: FnMut() -> bool>(
        reader: &RocksDbStorageReader<'_>,
        encoding: QuadEncoding,
        prefix: &KeyBuffer,
        from: &KeyBuffer,
        key: &mut [u8; MAX_KEY],
        control: &mut Control<F>,
    ) -> Result<Option<usize>, AccessError> {
        control.tick(1)?;
        Ok(reader.analytical_seek(encoding, prefix.as_slice(), from.as_slice(), key)?)
    }

    /// The non-recursive term at `offset` and the offset after it.
    fn read_key(key: &[u8], offset: usize, length: usize) -> Result<(Key, usize), AccessError> {
        let slice = key.get(offset..).ok_or(AccessError::Unsupported)?;
        let mut rest = slice;
        let term = match rest.read_term() {
            Ok(term) => term,
            // A truncated copy only omits trailing recursive terms.
            Err(_) if length > key.len() => return Err(AccessError::Unsupported),
            Err(error) => return Err(error.into()),
        };
        let used = slice.len() - rest.len();
        // Rejects triple terms and yields exactly the stored bytes otherwise.
        Ok((Key::encode(&term)?, offset + used))
    }
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "cursor contract assertions in fallible fixtures"
)]
mod tests {
    use super::*;
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::Store;

    type TestResult = Result<(), Box<dyn Error>>;

    fn node(name: &str) -> NamedNode {
        NamedNode::new_unchecked(format!("urn:analytical:{name}"))
    }

    fn key(name: &str) -> Result<Key, AccessError> {
        Key::encode(&EncodedTerm::from(&node(name)))
    }

    fn constant(name: &str) -> Position {
        Position::Constant(EncodedTerm::from(&node(name)))
    }

    fn subject_object() -> [Position; 3] {
        [Position::Variable(0), constant("p"), Position::Variable(1)]
    }

    fn load(store: &Store, quads: &[Quad]) -> Result<(), StorageError> {
        let mut transaction = store.storage().start_transaction()?;
        for quad in quads {
            transaction.insert(quad.clone());
        }
        transaction.commit()
    }

    fn open_memory(quads: &[Quad]) -> Result<Store, Box<dyn Error>> {
        let store = Store::new()?;
        load(&store, quads)?;
        Ok(store)
    }

    fn memory_fixture() -> Result<Store, Box<dyn Error>> {
        open_memory(
            &[("b", "z"), ("a", "x"), ("a", "y")].map(|(subject, object)| {
                Quad::new(
                    node(subject),
                    node("p"),
                    node(object),
                    GraphName::DefaultGraph,
                )
            }),
        )
    }

    fn enumerate<F: FnMut() -> bool>(
        relation: &Relation,
        reader: &StorageReader<'_>,
        control: &mut Control<F>,
    ) -> Result<Vec<Vec<Key>>, AccessError> {
        let mut bindings = Vec::new();
        let mut prefix = Vec::new();
        walk(relation, reader, &mut prefix, &mut bindings, control)?;
        Ok(bindings)
    }

    fn walk<F: FnMut() -> bool>(
        relation: &Relation,
        reader: &StorageReader<'_>,
        prefix: &mut Vec<Key>,
        bindings: &mut Vec<Vec<Key>>,
        control: &mut Control<F>,
    ) -> Result<(), AccessError> {
        let mut lower = None;
        while let Some(value) = relation.seek(
            reader,
            prefix.as_slice(),
            lower.as_ref(),
            lower.is_some(),
            control,
        )? {
            prefix.push(value);
            if prefix.len() == relation.variables().len() {
                bindings.push(prefix.clone());
            } else {
                walk(relation, reader, prefix, bindings, control)?;
            }
            prefix.pop();
            lower = Some(value);
        }
        Ok(())
    }

    #[test]
    fn materialized_exact_prefix_and_distinct_successor() -> TestResult {
        let store = memory_fixture()?;
        let reader = store.storage().snapshot();
        let mut control = Control::new(10, 100_000, 1000, || true);
        let relation = Relation::build(
            &reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[0, 1],
            &mut control,
        )?;
        assert_eq!(
            relation.variables(),
            &[0, 1],
            "relation columns follow the global order"
        );
        let mut values = [key("x")?, key("y")?];
        values.sort();
        let a = key("a")?;
        assert_eq!(
            relation.seek(&reader, &[a], None, false, &mut control)?,
            Some(values[0]),
            "least value under the prefix"
        );
        assert_eq!(
            relation.seek(&reader, &[a], Some(&values[0]), true, &mut control)?,
            Some(values[1]),
            "exclusive lower yields the next distinct value"
        );
        assert_eq!(
            relation.seek(&reader, &[a], Some(&values[1]), true, &mut control)?,
            None,
            "end of the prefix"
        );
        assert_eq!(
            relation.seek(&reader, &[key("missing")?], None, false, &mut control)?,
            None,
            "absent prefix"
        );
        assert_eq!(
            a.decode()?,
            EncodedTerm::from(&node("a")),
            "keys decode to their term"
        );
        Ok(())
    }

    #[test]
    fn materialized_budgets_and_cancellation_refuse() -> TestResult {
        let store = memory_fixture()?;
        let reader = store.storage().snapshot();
        for (rows, bytes, work, expected) in [
            (1, 100_000, 100, Limit::Rows),
            (10, 1, 100, Limit::Bytes),
            (10, 100_000, 1, Limit::Work),
        ] {
            let mut control = Control::new(rows, bytes, work, || true);
            let result = Relation::build(
                &reader,
                &subject_object(),
                &EncodedTerm::DefaultGraph,
                &[0, 1],
                &mut control,
            );
            assert!(
                matches!(result, Err(AccessError::Limit(actual)) if actual == expected),
                "expected the {expected:?} ceiling"
            );
        }
        let mut control = Control::new(10, 100_000, 100, || false);
        assert!(
            matches!(
                Relation::build(
                    &reader,
                    &subject_object(),
                    &EncodedTerm::DefaultGraph,
                    &[0, 1],
                    &mut control
                ),
                Err(AccessError::Interrupted)
            ),
            "cancellation stops the build"
        );
        let mut control = Control::new(10, 100_000, 100, || true);
        Relation::build(
            &reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[0, 1],
            &mut control,
        )?;
        assert_eq!(
            control.bytes(),
            size_of::<Relation>() + 4 * size_of::<Row>(),
            "growth is charged by requested capacity, not by max_rows"
        );
        Ok(())
    }

    #[test]
    fn control_charges_and_releases_bytes() -> TestResult {
        let mut control = Control::new(1, 10, 10, || true);
        control.reserve(6)?;
        assert_eq!(control.remaining_bytes(), 4, "remaining below the ceiling");
        assert!(
            matches!(control.reserve(5), Err(AccessError::Limit(Limit::Bytes))),
            "reservation beyond the ceiling fails before allocation"
        );
        control.release(6);
        assert_eq!(control.bytes(), 0, "released state is no longer charged");
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    fn open_native(quads: &[Quad]) -> Result<(tempfile::TempDir, Store), Box<dyn Error>> {
        let directory = tempfile::TempDir::new()?;
        let store = Store::open(directory.path())?;
        load(&store, quads)?;
        Ok((directory, store))
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    fn fixture() -> Vec<Quad> {
        use crate::model::{Literal, Term};
        let mut quads = Vec::new();
        for graph in [GraphName::DefaultGraph, GraphName::from(node("g"))] {
            for (subject, predicate, object) in [
                ("a", "p", Term::from(node("x"))),
                ("a", "p", Term::from(node("y"))),
                ("a", "q", Term::from(node("x"))),
                ("b", "p", Term::from(node("x"))),
                ("c", "q", Term::from(node("a"))),
                ("b", "q", Term::from(Literal::new_simple_literal("v"))),
                ("c", "p", Term::from(Literal::from(7))),
            ] {
                quads.push(Quad::new(
                    node(subject),
                    node(predicate),
                    object,
                    graph.clone(),
                ));
            }
        }
        // Graph-specific quads distinguish the default and named graphs.
        quads.push(Quad::new(node("d"), node("p"), node("x"), node("g")));
        quads.push(Quad::new(
            node("e"),
            node("r"),
            node("y"),
            GraphName::DefaultGraph,
        ));
        quads
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn native_seeks_match_materialized_relations_for_every_index_order() -> TestResult {
        use super::native::Order;
        let quads = fixture();
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let native_reader = native.storage().snapshot();
        let memory_reader = memory.storage().snapshot();
        let all = [
            Position::Variable(0),
            Position::Variable(1),
            Position::Variable(2),
        ];
        let cases = [
            (all.clone(), vec![0, 1, 2], Order::Spo),
            (all.clone(), vec![1, 2, 0], Order::Pos),
            (all.clone(), vec![2, 0, 1], Order::Osp),
            (
                [constant("a"), Position::Variable(1), Position::Variable(2)],
                vec![1, 2],
                Order::Spo,
            ),
            (
                [Position::Variable(0), constant("p"), Position::Variable(2)],
                vec![2, 0],
                Order::Pos,
            ),
            (
                [Position::Variable(0), Position::Variable(1), constant("x")],
                vec![0, 1],
                Order::Osp,
            ),
        ];
        let empty_graph = EncodedTerm::from(&node("h"));
        for graph in [
            EncodedTerm::DefaultGraph,
            EncodedTerm::from(&node("g")),
            empty_graph.clone(),
        ] {
            for (pattern, order, expected) in &cases {
                let mut control = Control::new(100, 1_000_000, 100_000, || true);
                let relation =
                    Relation::build(&native_reader, pattern, &graph, order, &mut control)?;
                assert_eq!(
                    relation.native_order(),
                    Some((*expected, !graph.is_default_graph())),
                    "index family selected for {order:?}"
                );
                let actual = enumerate(&relation, &native_reader, &mut control)?;
                let materialized =
                    Relation::build(&memory_reader, pattern, &graph, order, &mut control)?;
                assert_eq!(
                    materialized.native_order(),
                    None,
                    "memory relations stay materialized"
                );
                let reference = enumerate(&materialized, &memory_reader, &mut control)?;
                assert_eq!(
                    actual, reference,
                    "native and materialized bindings differ for {order:?}"
                );
                assert_eq!(
                    actual.is_empty(),
                    graph == empty_graph,
                    "only the empty named graph has no bindings for {order:?}"
                );
            }
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn unsupported_orders_decline_before_any_charge() -> TestResult {
        let quads = fixture();
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let native_reader = native.storage().snapshot();
        let memory_reader = memory.storage().snapshot();
        let all = [
            Position::Variable(0),
            Position::Variable(1),
            Position::Variable(2),
        ];
        let cases = [
            (all.clone(), vec![0, 2, 1]),
            (all.clone(), vec![1, 0, 2]),
            (all.clone(), vec![2, 1, 0]),
            (subject_object(), vec![0, 1]),
            (
                [constant("a"), Position::Variable(1), Position::Variable(2)],
                vec![2, 1],
            ),
        ];
        for (pattern, order) in &cases {
            let mut control = Control::new(100, 1_000_000, 1_000, || true);
            let result = Relation::build(
                &native_reader,
                pattern,
                &EncodedTerm::DefaultGraph,
                order,
                &mut control,
            );
            assert!(
                matches!(result, Err(AccessError::UnsupportedOrder)),
                "{order:?} has no compatible existing index"
            );
            assert_eq!(control.bytes(), 0, "declined before any charge");
            assert!(
                Relation::build(
                    &memory_reader,
                    pattern,
                    &EncodedTerm::DefaultGraph,
                    order,
                    &mut control
                )
                .is_ok(),
                "bounded memory materialization supports {order:?}"
            );
        }
        // A constant predicate is only a prefix of POS, which needs the object
        // before the subject: no order supports a directed triangle natively.
        let edge = |from: usize, to: usize| {
            [
                Position::Variable(from),
                constant("p"),
                Position::Variable(to),
            ]
        };
        let triangle = [edge(0, 1), edge(1, 2), edge(2, 0)];
        for order in [
            [0, 1, 2],
            [0, 2, 1],
            [1, 0, 2],
            [1, 2, 0],
            [2, 0, 1],
            [2, 1, 0],
        ] {
            let declined = triangle.iter().any(|pattern| {
                matches!(
                    Relation::build(
                        &native_reader,
                        pattern,
                        &EncodedTerm::DefaultGraph,
                        &order,
                        &mut Control::new(10, 100_000, 1_000, || true)
                    ),
                    Err(AccessError::UnsupportedOrder)
                )
            });
            assert!(declined, "triangle order {order:?} must decline natively");
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn native_seeks_respect_prefix_boundaries_and_domain_ends() -> TestResult {
        use crate::model::Literal;
        let quad = |subject: &str, predicate: &str, object: &str| {
            Quad::new(
                node(subject),
                node(predicate),
                node(object),
                GraphName::DefaultGraph,
            )
        };
        let (_directory, store) = open_native(&[
            quad("z", "p", "o1"),
            quad("m", "p", "o1"),
            quad("a", "p", "o2"),
            quad("a", "q", "o1"),
        ])?;
        let reader = store.storage().snapshot();
        let mut control = Control::new(10, 100_000, 1_000, || true);
        // Object before subject: dpos with the predicate as exact prefix.
        let relation = Relation::build(
            &reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        let mut objects = [key("o1")?, key("o2")?];
        objects.sort();
        assert_eq!(
            relation.seek(&reader, &[], None, false, &mut control)?,
            Some(objects[0]),
            "least object under the predicate"
        );
        assert_eq!(
            relation.seek(&reader, &[], Some(&objects[0]), false, &mut control)?,
            Some(objects[0]),
            "an inclusive lower returns an equal value"
        );
        assert_eq!(
            relation.seek(&reader, &[], Some(&objects[0]), true, &mut control)?,
            Some(objects[1]),
            "an exclusive lower returns the next distinct value"
        );
        assert_eq!(
            relation.seek(&reader, &[], Some(&objects[1]), true, &mut control)?,
            None,
            "EOF at the end of the predicate prefix"
        );
        for (object, subjects) in [
            (key("o1")?, vec![key("m")?, key("z")?]),
            (key("o2")?, vec![key("a")?]),
        ] {
            let mut subjects = subjects;
            subjects.sort();
            let mut found = Vec::new();
            let mut lower = None;
            while let Some(subject) = relation.seek(
                &reader,
                &[object],
                lower.as_ref(),
                lower.is_some(),
                &mut control,
            )? {
                found.push(subject);
                lower = Some(subject);
            }
            assert_eq!(
                found, subjects,
                "subjects never leak across the object prefix boundary"
            );
        }
        let beyond = Key::encode(&EncodedTerm::from(&Literal::new_simple_literal("beyond")))?;
        assert_eq!(
            relation.seek(&reader, &[], Some(&beyond), false, &mut control)?,
            None,
            "a lower bound above the domain"
        );
        assert_eq!(
            relation.seek(&reader, &[key("o1")?], Some(&beyond), true, &mut control)?,
            None,
            "an exclusive lower bound above the prefix domain"
        );
        assert_eq!(
            relation.seek(&reader, &[key("missing")?], None, false, &mut control)?,
            None,
            "an absent prefix"
        );
        assert!(
            matches!(
                relation.seek(&reader, &[key("o1")?, key("m")?], None, false, &mut control),
                Err(AccessError::Unsupported)
            ),
            "a prefix binding every column is refused"
        );
        let empty = Relation::build(
            &reader,
            &[
                Position::Variable(0),
                constant("absent"),
                Position::Variable(1),
            ],
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        assert_eq!(
            empty.seek(&reader, &[], None, false, &mut control)?,
            None,
            "an empty relation"
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn exclusive_seeks_skip_repeated_values_on_both_backends() -> TestResult {
        let quads = fixture();
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let mut expected = ["a", "b", "c", "e"]
            .map(key)
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?;
        expected.sort();
        for store in [&native, &memory] {
            let reader = store.storage().snapshot();
            let mut control = Control::new(100, 1_000_000, 10_000, || true);
            let relation = Relation::build(
                &reader,
                &[
                    Position::Variable(0),
                    Position::Variable(1),
                    Position::Variable(2),
                ],
                &EncodedTerm::DefaultGraph,
                &[0, 1, 2],
                &mut control,
            )?;
            let mut subjects = Vec::new();
            let mut lower = None;
            while let Some(subject) =
                relation.seek(&reader, &[], lower.as_ref(), lower.is_some(), &mut control)?
            {
                subjects.push(subject);
                lower = Some(subject);
            }
            assert_eq!(
                subjects, expected,
                "each default-graph subject once, in index order"
            );
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn repeated_variables_require_equal_positions_on_both_backends() -> TestResult {
        use super::native::Order;
        let quad = |subject: &str, object: &str, graph: GraphName| {
            Quad::new(node(subject), node("p"), node(object), graph)
        };
        let quads = [
            quad("a", "a", GraphName::DefaultGraph),
            quad("b", "c", GraphName::DefaultGraph),
            quad("c", "c", GraphName::DefaultGraph),
            quad("d", "e", GraphName::DefaultGraph),
            quad("f", "f", GraphName::from(node("g"))),
        ];
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let mut expected = vec![vec![key("a")?], vec![key("c")?]];
        expected.sort();
        let pattern = [Position::Variable(0), constant("p"), Position::Variable(0)];
        for store in [&native, &memory] {
            let reader = store.storage().snapshot();
            let mut control = Control::new(100, 1_000_000, 10_000, || true);
            let relation = Relation::build(
                &reader,
                &pattern,
                &EncodedTerm::DefaultGraph,
                &[0],
                &mut control,
            )?;
            assert_eq!(
                enumerate(&relation, &reader, &mut control)?,
                expected,
                "only quads whose subject equals their object, in the default graph"
            );
        }
        let reader = native.storage().snapshot();
        let relation = Relation::build(
            &reader,
            &pattern,
            &EncodedTerm::DefaultGraph,
            &[0],
            &mut Control::new(1, 100_000, 100, || true),
        )?;
        assert_eq!(
            relation.native_order(),
            Some((Order::Pos, false)),
            "repeated positions are adjacent in dpos"
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn native_seeks_read_the_given_snapshot_only() -> TestResult {
        let quad =
            |subject: &str| Quad::new(node(subject), node("p"), node("x"), GraphName::DefaultGraph);
        let (_directory, store) = open_native(&[quad("a")])?;
        let before = store.storage().snapshot();
        load(&store, &[quad("b")])?;
        let after = store.storage().snapshot();
        let mut control = Control::new(10, 100_000, 1_000, || true);
        let relation = Relation::build(
            &after,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        assert_eq!(
            enumerate(&relation, &before, &mut control)?.len(),
            1,
            "an older snapshot never observes a later write"
        );
        assert_eq!(
            enumerate(&relation, &after, &mut control)?.len(),
            2,
            "the newer snapshot observes it"
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn native_seeks_observe_cancellation_and_backend() -> TestResult {
        let quads = fixture();
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let native_reader = native.storage().snapshot();
        let memory_reader = memory.storage().snapshot();
        let alive = std::rc::Rc::new(std::cell::Cell::new(true));
        let flag = std::rc::Rc::clone(&alive);
        let mut control = Control::new(10, 100_000, 1_000, move || flag.get());
        let relation = Relation::build(
            &native_reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        let materialized = Relation::build(
            &memory_reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        assert!(
            matches!(
                relation.seek(&memory_reader, &[], None, false, &mut control),
                Err(AccessError::Unsupported)
            ),
            "a native descriptor never seeks another backend"
        );
        assert!(
            matches!(
                materialized.seek(&native_reader, &[], None, false, &mut control),
                Err(AccessError::Unsupported)
            ),
            "materialized rows never pair with a RocksDB reader"
        );
        alive.set(false);
        assert!(
            matches!(
                relation.seek(&native_reader, &[], None, false, &mut control),
                Err(AccessError::Interrupted)
            ),
            "cancellation is checked before every seek"
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn native_seek_work_is_independent_of_skewed_relation_size() -> TestResult {
        const SKEW: usize = 2_000;
        let mut quads = (0..SKEW)
            .map(|index| {
                Quad::new(
                    node("hub"),
                    node("p"),
                    node(&format!("o{index}")),
                    GraphName::DefaultGraph,
                )
            })
            .collect::<Vec<_>>();
        quads.push(Quad::new(
            node("rare"),
            node("p"),
            node("o0"),
            GraphName::DefaultGraph,
        ));
        let (_directory, native) = open_native(&quads)?;
        let memory = open_memory(&quads)?;
        let native_reader = native.storage().snapshot();
        let memory_reader = memory.storage().snapshot();
        // Budgets far below the store size: one row, one relation's bytes.
        let mut control = Control::new(1, size_of::<Relation>(), 16, || true);
        let relation = Relation::build(
            &native_reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        let first = relation
            .seek(&native_reader, &[], None, false, &mut control)?
            .ok_or("the skewed relation is not empty")?;
        assert!(
            relation
                .seek(&native_reader, &[first], None, false, &mut control)?
                .is_some(),
            "every object has a subject"
        );
        let target = key("o1000")?;
        assert_eq!(
            relation.seek(&native_reader, &[], Some(&target), false, &mut control)?,
            Some(target),
            "a direct seek into the middle of the skewed range"
        );
        assert_eq!(
            control.work(),
            7,
            "one build unit, then one unit per seek plus one per index probe"
        );
        assert_eq!(
            control.bytes(),
            size_of::<Relation>(),
            "only the bounded descriptor is charged"
        );
        // The same budgets refuse the materialized path, which must read every
        // matching quad before its first seek.
        let mut control = Control::new(1, size_of::<Relation>(), 16, || true);
        assert!(
            matches!(
                Relation::build(
                    &memory_reader,
                    &subject_object(),
                    &EncodedTerm::DefaultGraph,
                    &[1, 0],
                    &mut control
                ),
                Err(AccessError::Limit(_))
            ),
            "materialization exceeds the native seek budgets"
        );
        let mut control = Control::new(SKEW + 10, usize::MAX, u64::MAX, || true);
        Relation::build(
            &memory_reader,
            &subject_object(),
            &EncodedTerm::DefaultGraph,
            &[1, 0],
            &mut control,
        )?;
        assert!(
            control.work() > SKEW as u64,
            "materialization work grows with the matching quads"
        );
        Ok(())
    }
}
