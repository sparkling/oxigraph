//! One logical v1 encoder for receipt hashing and outbox persistence.
use super::{NamespacePrefix, SemanticChange, SemanticChangeSet, StorageError};
use crate::model::{
    BlankNode, GraphName, GraphNameRef, Literal, NamedNode, NamedOrBlankNode, Quad, Term, TermRef,
};
use crate::storage::CorruptionError;
use sha2::{Digest, Sha256};

#[cfg(feature = "rdf-12")]
const MAX_TRIPLE_DEPTH: usize = 32;

pub(super) fn checksum(changes: &SemanticChangeSet) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"oxigraph.semantic-changes.v1\0");
    hasher.update((changes.len() as u64).to_be_bytes());
    for change in changes.as_slice() {
        emit(change, &mut |bytes| hasher.update(bytes));
    }
    hasher.finalize().into()
}

pub(super) fn encode(change: &SemanticChange) -> Result<Vec<u8>, StorageError> {
    let mut bytes = Vec::new();
    emit(change, &mut |part| bytes.extend_from_slice(part));
    // Enforce the exact same representability/depth boundary before commit as
    // on replay. Receipt-only hashing stays infallible and has no depth limit.
    decode(&bytes).map_err(|_| StorageError::Other("governed effect is not encodable in outbox v1 (valid RDF and at most 32 nested triple terms required)".into()))?;
    Ok(bytes)
}

pub(super) fn emit(change: &SemanticChange, put: &mut impl FnMut(&[u8])) {
    put(&[match change {
        SemanticChange::QuadAdded(_) => 0,
        SemanticChange::QuadRemoved(_) => 1,
        SemanticChange::NamedGraphCreated(_) => 2,
        SemanticChange::GraphCleared(_) => 3,
        SemanticChange::NamedGraphDropped(_) => 4,
        SemanticChange::AllNamedGraphsCleared => 5,
        SemanticChange::AllGraphsCleared => 6,
        SemanticChange::AllNamedGraphsDropped => 7,
        SemanticChange::DatasetCleared => 8,
        SemanticChange::NamespaceChanged { .. } => 9,
        SemanticChange::NamespacesCleared => 10,
    }]);
    match change {
        SemanticChange::QuadAdded(quad) | SemanticChange::QuadRemoved(quad) => {
            term(quad.subject.as_ref().into(), put);
            term(quad.predicate.as_ref().into(), put);
            term(quad.object.as_ref(), put);
            graph(quad.graph_name.as_ref(), put);
        }
        SemanticChange::NamedGraphCreated(name) | SemanticChange::NamedGraphDropped(name) => {
            term(name.as_ref().into(), put)
        }
        SemanticChange::GraphCleared(name) => graph(name.as_ref(), put),
        SemanticChange::NamespaceChanged {
            prefix,
            before,
            after,
        } => {
            field(prefix.as_str(), put);
            for iri in [before, after] {
                put(&[u8::from(iri.is_some())]);
                if let Some(iri) = iri {
                    field(iri.as_str(), put);
                }
            }
        }
        _ => (),
    }
}

fn field(value: &str, put: &mut impl FnMut(&[u8])) {
    put(&(value.len() as u64).to_be_bytes());
    put(value.as_bytes());
}
fn graph(value: GraphNameRef<'_>, put: &mut impl FnMut(&[u8])) {
    match value {
        GraphNameRef::DefaultGraph => put(&[0]),
        GraphNameRef::NamedNode(value) => term(value.into(), put),
        GraphNameRef::BlankNode(value) => term(value.into(), put),
    }
}
fn term(value: TermRef<'_>, put: &mut impl FnMut(&[u8])) {
    let mut stack = vec![value];
    while let Some(value) = stack.pop() {
        match value {
            TermRef::NamedNode(value) => {
                put(&[1]);
                field(value.as_str(), put);
            }
            TermRef::BlankNode(value) => {
                put(&[2]);
                field(value.as_str(), put);
            }
            TermRef::Literal(value) => {
                put(&[3]);
                field(value.value(), put);
                field(value.datatype().as_str(), put);
                put(&[u8::from(value.language().is_some())]);
                if let Some(language) = value.language() {
                    field(language, put);
                }
                #[cfg(feature = "rdf-12")]
                let direction = match value.direction() {
                    None => 0,
                    Some(crate::model::BaseDirection::Ltr) => 1,
                    Some(crate::model::BaseDirection::Rtl) => 2,
                };
                #[cfg(not(feature = "rdf-12"))]
                let direction = 0;
                put(&[direction]);
            }
            #[cfg(feature = "rdf-12")]
            TermRef::Triple(value) => {
                put(&[4]);
                stack.push(value.object.as_ref());
                stack.push(value.predicate.as_ref().into());
                stack.push(value.subject.as_ref().into());
            }
        }
    }
}

fn bad(message: &'static str) -> StorageError {
    CorruptionError::msg(message).into()
}

struct Cursor<'a> {
    remaining: &'a [u8],
}
impl<'a> Cursor<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], StorageError> {
        if length > self.remaining.len() {
            return Err(bad("truncated semantic-change field"));
        }
        let (value, rest) = self.remaining.split_at(length);
        self.remaining = rest;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8, StorageError> {
        Ok(self.take(1)?[0])
    }
    fn text(&mut self) -> Result<&'a str, StorageError> {
        let length = u64::from_be_bytes(super::receipt::receipt_field(self.take(8)?)?);
        let length =
            usize::try_from(length).map_err(|_| bad("semantic-change field length overflows"))?;
        std::str::from_utf8(self.take(length)?).map_err(|_| bad("invalid semantic-change UTF-8"))
    }
    fn iri(&mut self) -> Result<NamedNode, StorageError> {
        NamedNode::new(self.text()?.to_owned()).map_err(|_| bad("invalid semantic-change IRI"))
    }
    fn blank(&mut self) -> Result<BlankNode, StorageError> {
        BlankNode::new(self.text()?.to_owned())
            .map_err(|_| bad("invalid semantic-change blank node"))
    }
    fn predicate(&mut self) -> Result<NamedNode, StorageError> {
        if self.byte()? != 1 {
            return Err(bad("semantic-change predicate is not an IRI"));
        }
        self.iri()
    }
    fn subject(&mut self) -> Result<NamedOrBlankNode, StorageError> {
        match self.byte()? {
            1 => Ok(self.iri()?.into()),
            2 => Ok(self.blank()?.into()),
            _ => Err(bad("invalid semantic-change subject")),
        }
    }
    fn graph(&mut self) -> Result<GraphName, StorageError> {
        match self.byte()? {
            0 => Ok(GraphName::DefaultGraph),
            1 => Ok(self.iri()?.into()),
            2 => Ok(self.blank()?.into()),
            _ => Err(bad("invalid semantic-change graph")),
        }
    }
    fn optional_iri(&mut self) -> Result<Option<NamedNode>, StorageError> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(self.iri()?)),
            _ => Err(bad("invalid semantic-change presence byte")),
        }
    }
    fn literal(&mut self) -> Result<Literal, StorageError> {
        let value = self.text()?.to_owned();
        let datatype = self.iri()?;
        let language = match self.byte()? {
            0 => None,
            1 => Some(self.text()?.to_owned()),
            _ => return Err(bad("invalid language presence byte")),
        };
        let direction = self.byte()?;
        let result = match (language, direction) {
            (None, 0) => Literal::try_new_typed_literal(value, datatype.clone())
                .map_err(|_| bad("reserved datatype without language"))?,
            (Some(language), 0) => Literal::new_language_tagged_literal(value, language)
                .map_err(|_| bad("invalid language tag"))?,
            #[cfg(feature = "rdf-12")]
            (Some(language), direction @ (1 | 2)) => {
                Literal::new_directional_language_tagged_literal(
                    value,
                    language,
                    if direction == 1 {
                        crate::model::BaseDirection::Ltr
                    } else {
                        crate::model::BaseDirection::Rtl
                    },
                )
                .map_err(|_| bad("invalid directional language tag"))?
            }
            _ => return Err(bad("invalid or unsupported literal direction")),
        };
        if result.datatype() != &datatype {
            return Err(bad("language and datatype disagree"));
        }
        Ok(result)
    }
    fn term(&mut self, depth: usize) -> Result<Term, StorageError> {
        #[cfg(not(feature = "rdf-12"))]
        let _: usize = depth;
        match self.byte()? {
            1 => Ok(self.iri()?.into()),
            2 => Ok(self.blank()?.into()),
            3 => Ok(self.literal()?.into()),
            #[cfg(feature = "rdf-12")]
            4 => {
                if depth >= MAX_TRIPLE_DEPTH {
                    return Err(bad("semantic-change triple nesting exceeds 32"));
                }
                Ok(crate::model::Triple::new(
                    self.subject()?,
                    self.predicate()?,
                    self.term(depth + 1)?,
                )
                .into())
            }
            _ => Err(bad("invalid or unsupported semantic-change term tag")),
        }
    }
}

pub(super) fn decode(bytes: &[u8]) -> Result<SemanticChange, StorageError> {
    let mut input = Cursor { remaining: bytes };
    let change = match input.byte()? {
        tag @ (0 | 1) => {
            let quad = Quad::new(
                input.subject()?,
                input.predicate()?,
                input.term(0)?,
                input.graph()?,
            );
            if tag == 0 {
                SemanticChange::QuadAdded(quad)
            } else {
                SemanticChange::QuadRemoved(quad)
            }
        }
        2 => SemanticChange::NamedGraphCreated(input.subject()?),
        3 => SemanticChange::GraphCleared(input.graph()?),
        4 => SemanticChange::NamedGraphDropped(input.subject()?),
        5 => SemanticChange::AllNamedGraphsCleared,
        6 => SemanticChange::AllGraphsCleared,
        7 => SemanticChange::AllNamedGraphsDropped,
        8 => SemanticChange::DatasetCleared,
        9 => {
            let prefix = NamespacePrefix::new(input.text()?.to_owned())
                .map_err(|_| bad("invalid namespace prefix"))?;
            let before = input.optional_iri()?;
            let after = input.optional_iri()?;
            if before == after {
                return Err(bad("namespace record has no effect"));
            }
            SemanticChange::NamespaceChanged {
                prefix,
                before,
                after,
            }
        }
        10 => SemanticChange::NamespacesCleared,
        _ => return Err(bad("unknown semantic-change operation")),
    };
    if !input.remaining.is_empty() {
        return Err(bad("trailing semantic-change bytes"));
    }
    let mut canonical = Vec::new();
    emit(&change, &mut |part| canonical.extend_from_slice(part));
    if canonical != bytes {
        return Err(bad("noncanonical semantic-change payload"));
    }
    Ok(change)
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "logical payload format assertions"
)]
mod tests {
    use super::*;

    #[test]
    fn every_operation_and_rdf_identity_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        let iri = NamedNode::new("urn:iri")?;
        let blank = BlankNode::new("graph")?;
        let mut changes = vec![
            SemanticChange::NamedGraphCreated(iri.clone().into()),
            SemanticChange::NamedGraphDropped(blank.clone().into()),
            SemanticChange::GraphCleared(GraphName::DefaultGraph),
            SemanticChange::GraphCleared(blank.clone().into()),
            SemanticChange::AllNamedGraphsCleared,
            SemanticChange::AllGraphsCleared,
            SemanticChange::AllNamedGraphsDropped,
            SemanticChange::DatasetCleared,
            SemanticChange::NamespaceChanged {
                prefix: NamespacePrefix::new("éx")?,
                before: None,
                after: Some(iri.clone()),
            },
            SemanticChange::NamespaceChanged {
                prefix: NamespacePrefix::new("")?,
                before: Some(iri.clone()),
                after: None,
            },
            SemanticChange::NamespacesCleared,
        ];
        for object in [
            Term::from(iri.clone()),
            Term::from(blank.clone()),
            Term::from(Literal::new_simple_literal("\0é\n")),
            Term::from(Literal::new_language_tagged_literal("é", "en-GB")?),
            Term::from(Literal::new_typed_literal(
                "01",
                NamedNode::new("urn:custom-type")?,
            )),
        ] {
            let quad = Quad::new(blank.clone(), iri.clone(), object, iri.clone());
            changes.push(SemanticChange::QuadAdded(quad.clone()));
            changes.push(SemanticChange::QuadRemoved(quad));
        }
        for change in changes {
            let bytes = encode(&change)?;
            assert_eq!(decode(&bytes)?, change);
            for end in 0..bytes.len() {
                assert!(decode(&bytes[..end]).is_err());
            }
            let mut trailing = bytes;
            trailing.push(0);
            assert!(decode(&trailing).is_err());
        }
        Ok(())
    }

    #[test]
    fn malformed_fields_are_rejected_before_publication_or_replay() {
        for bytes in [
            vec![255],
            vec![2, 3],
            vec![3, 4],
            vec![9, 0],
            [vec![2, 1], u64::MAX.to_be_bytes().to_vec()].concat(),
            [vec![2, 1], 1_u64.to_be_bytes().to_vec(), vec![255]].concat(),
            [vec![9], 0_u64.to_be_bytes().to_vec(), vec![2]].concat(),
            [vec![9], 0_u64.to_be_bytes().to_vec(), vec![0, 0]].concat(),
        ] {
            assert!(decode(&bytes).is_err());
        }
        assert!(
            encode(&SemanticChange::NamedGraphCreated(
                NamedNode::new_unchecked("relative").into()
            ))
            .is_err()
        );
        assert!(
            encode(&SemanticChange::NamedGraphCreated(
                BlankNode::new_unchecked("bad blank").into()
            ))
            .is_err()
        );
    }
}
