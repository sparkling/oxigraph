use super::*;
#[cfg(feature = "rdf-12")]
use crate::model::{BaseDirection, Literal, Triple};
use crate::store::{Store, TransactionKey, TransactionRequest, WritableDataset};
#[cfg(not(feature = "rdf-12"))]
use crate::store::{OutboxReadError, StoreOptions};
#[cfg(feature = "rdf-12")]
use crate::store::{OutboxRecord, SemanticChange};
use std::collections::BTreeMap;
#[cfg(not(feature = "rdf-12"))]
use std::io;
use std::num::NonZeroUsize;
use std::path::PathBuf;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn files(path: &Path) -> Result<BTreeMap<PathBuf, (usize, [u8; 32])>> {
    use sha2::{Digest, Sha256};

    let mut result = BTreeMap::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        assert!(entry.file_type()?.is_file());
        let bytes = std::fs::read(entry.path())?;
        result.insert(
            entry.file_name().into(),
            (bytes.len(), Sha256::digest(bytes).into()),
        );
    }
    Ok(result)
}

#[cfg(not(feature = "rdf-12"))]
fn current_fixture(path: &Path) -> Result<Db> {
    let db = Db::open_read_write(path, RocksDbStorage::column_families(), DbOptions::default())?;
    db.insert(
        &db.column_family(DEFAULT_CF)?,
        b"oxversion",
        &LATEST_STORAGE_VERSION.to_be_bytes(),
    )?;
    Ok(db)
}

#[cfg(not(feature = "rdf-12"))]
fn insert_object_leading_tag(path: &Path, column_family: &'static str, tag: u8) -> Result {
    let db = current_fixture(path)?;
    db.insert(&db.column_family(column_family)?, &[tag], &[])?;
    db.flush()?;
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
fn assert_feature_incompatible(error: StorageError) {
    assert!(matches!(
        error,
        StorageError::FeatureIncompatible { feature: "rdf-12" }
    ));
    assert_eq!(io::Error::from(error).kind(), io::ErrorKind::InvalidData);
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn safe_open_rejects_each_declared_disabled_object_tag_without_source_changes() -> Result {
    for column_family in [DOSP_CF, OSPG_CF] {
        for tag in crate::storage::binary_encoder::RDF_12_ONLY_TERM_TYPES {
            let directory = tempfile::tempdir()?;
            insert_object_leading_tag(directory.path(), column_family, *tag)?;
            let before = files(directory.path())?;
            let report = Store::inspect_features(directory.path())?;
            assert!(report.live_rdf_12_required());
            assert!(!report.retained_outbox_rdf_12_required());
            assert!(report.rdf_12_unsupported());
            assert_eq!(files(directory.path())?, before);
            for _ in 0..2 {
                assert_feature_incompatible(Store::open(directory.path()).err().expect("feature-incompatible open must fail"));
                assert_feature_incompatible(
                    Store::open_with_options(directory.path(), StoreOptions::default()).err().expect("feature-incompatible open must fail"),
                );
                assert_feature_incompatible(Store::open_read_only(directory.path()).err().expect("feature-incompatible open must fail"));
                assert_eq!(files(directory.path())?, before);
            }
        }
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn safe_open_admits_prefix_adjacent_tags_and_compatible_quads() -> Result {
    for tag in [47, 64] {
        for column_family in [DOSP_CF, OSPG_CF] {
            let directory = tempfile::tempdir()?;
            insert_object_leading_tag(directory.path(), column_family, tag)?;
            assert!(!RocksDbStorage::contains_rdf_12_terms(
                directory.path(),
                DbOptions::default(),
            )?);
            assert!(!Store::inspect_features(directory.path())?.rdf_12_required());
        }
    }

    let directory = tempfile::tempdir()?;
    let quad = Quad::new(
        NamedNode::new("urn:compatible:s")?,
        NamedNode::new("urn:compatible:p")?,
        NamedNode::new("urn:compatible:o")?,
        GraphName::DefaultGraph,
    );
    let store = Store::open(directory.path())?;
    store.insert(quad.clone())?;
    drop(store);
    let reopened = Store::open_read_only(directory.path())?;
    assert!(reopened.contains(&quad)?);
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn safe_open_feature_refusal_follows_schema_and_guard_priority_and_releases_lease() -> Result {
    let directory = tempfile::tempdir()?;
    let db = current_fixture(directory.path())?;
    db.insert(&db.column_family(DEFAULT_CF)?, b"oxversion", &[2])?;
    db.insert(&db.column_family(DOSP_CF)?, &[48], &[])?;
    db.flush()?;
    drop(db);
    assert!(matches!(
        Store::open(directory.path()),
        Err(StorageError::SchemaUnknown)
    ));

    let directory = tempfile::tempdir()?;
    insert_object_leading_tag(directory.path(), DOSP_CF, 48)?;
    std::fs::write(directory.path().join(crate::store::upgrade::UPGRADE_GUARD), b"guard")?;
    assert!(matches!(
        Store::open(directory.path()),
        Err(StorageError::UpgradeIncomplete)
    ));

    let directory = tempfile::tempdir()?;
    insert_object_leading_tag(directory.path(), DOSP_CF, 48)?;
    assert_feature_incompatible(Store::open(directory.path()).err().expect("feature-incompatible open must fail"));
    let db = Db::open_read_write(
        directory.path(),
        RocksDbStorage::column_families(),
        DbOptions::default(),
    )?;
    drop(db);
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn safe_open_feature_refusal_checkpoint_adds_only_native_lock() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    insert_object_leading_tag(&source, DOSP_CF, 48)?;
    let db = Db::open_read_only(&source, RocksDbStorage::column_families())?;
    let checkpoint = directory.path().join("checkpoint");
    db.backup(&checkpoint)?;
    drop(db);
    let before = files(&checkpoint)?;
    assert!(!checkpoint.join("LOCK").exists());
    assert_feature_incompatible(
        Store::open_read_only(&checkpoint)
            .err()
            .expect("feature-incompatible read-only open must fail"),
    );
    assert_eq!(files(&checkpoint)?, before);
    assert!(!checkpoint.join("LOCK").exists());
    assert_feature_incompatible(
        Store::open(&checkpoint)
            .err()
            .expect("feature-incompatible writable open must fail"),
    );
    let mut after = files(&checkpoint)?;
    assert_eq!(std::fs::metadata(checkpoint.join("LOCK"))?.len(), 0);
    after.remove(Path::new("LOCK"));
    assert_eq!(after, before);
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn retained_only_rdf_12_outbox_payload_fails_on_consumption_without_source_changes() -> Result {
    let directory = tempfile::tempdir()?;
    let path = directory.path();
    let subject = NamedNode::new("urn:history:s")?;
    let predicate = NamedNode::new("urn:history:p")?;
    let object = NamedNode::new("urn:history:o")?;
    let quad = Quad::new(
        subject.clone(),
        predicate.clone(),
        object,
        GraphName::DefaultGraph,
    );

    let store = Store::open(path)?;
    let mut insert = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([11; 16]),
        )?
        .into_transaction();
    insert.insert(quad.clone())?;
    insert.commit()?;

    let mut remove = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([12; 16]),
        )?
        .into_transaction();
    remove.remove(&quad)?;
    remove.commit()?;

    store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([13; 16]),
        )?
        .into_transaction()
        .commit()?;
    assert!(!store.contains(&quad)?);
    let identity = store
        .read_outbox(None, NonZeroUsize::MIN)?
        .coverage()
        .ok_or("missing outbox coverage")?
        .store_identity()
        .clone();
    drop(store);

    let compatible = Store::open_read_only(path)?;
    assert_eq!(
        compatible
            .read_outbox(None, NonZeroUsize::new(5).expect("five is non-zero"))?
            .records()
            .len(),
        5
    );
    drop(compatible);

    {
        let db =
            Db::open_read_write(path, RocksDbStorage::column_families(), DbOptions::default())?;
        let cf = db.column_family(DEFAULT_CF)?;
        let key = outbox_record_key(2);
        let record = db
            .get(&cf, &key)?
            .ok_or("missing first outbox event")?
            .to_vec();
        assert_eq!(&record[..2], &[1, 1]);
        let mut body = record[..58].to_vec();
        body.extend_from_slice(&crate::store::outbox::rdf_12_payload_for_test());
        let record = crate::store::outbox::seal_record_for_test(&identity, 2, body);
        db.insert(&cf, &key, &record)?;
        db.flush()?;
    }

    // This is a raw, same-format retained-history fixture for replay error
    // propagation. It does not claim a cross-binary writer journey or complete
    // history admission.
    let before = files(path)?;
    let inspection = Store::inspect_features(path)?;
    assert!(!inspection.live_rdf_12_required());
    assert!(inspection.retained_outbox_rdf_12_required());
    assert!(inspection.rdf_12_unsupported());
    assert_eq!(inspection.retained_outbox_records(), 5);
    assert_eq!(files(path)?, before);
    let reopened = Store::open_read_only(path)?;
    let header = reopened.read_outbox(None, NonZeroUsize::MIN)?;
    assert!(matches!(
        header.records(),
        [crate::store::OutboxRecord::Commit { .. }]
    ));
    let error = reopened
        .read_outbox(header.next_cursor(), NonZeroUsize::MIN)
        .err()
        .expect("the retained RDF 1.2 event must fail on consumption");
    let OutboxReadError::Storage(error) = error else {
        panic!("expected a storage feature error");
    };
    assert_feature_incompatible(error);
    drop(reopened);
    assert_eq!(files(path)?, before);
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn rdf_12_object_terms() -> Result<Vec<Term>> {
    let subject = NamedNode::new("urn:rdf12:s")?;
    let predicate = NamedNode::new("urn:rdf12:p")?;
    let object = NamedNode::new("urn:rdf12:o")?;
    let triple = Triple::new(subject.clone(), predicate.clone(), object);
    let nested = Triple::new(subject, predicate, triple.clone());
    let mut terms = vec![triple.into(), nested.into()];
    for direction in [BaseDirection::Ltr, BaseDirection::Rtl] {
        for (value, language) in [
            ("value", "en"),
            ("value", "fr-Latn-FR-x-foo-bar-baz-bat-aaaa-bbbb-cccc"),
            ("foo-fr-literal-thisisaverylargelanguagetaggedstringliteral", "fr"),
            (
                "foo-big-literal-thisisaverylargelanguagetaggedstringliteral",
                "fr-Latn-FR-x-foo-bar-baz-bat-aaaa-bbbb-cccc",
            ),
        ] {
            terms.push(
                Literal::new_directional_language_tagged_literal(value, language, direction)?
                    .into(),
            );
        }
    }
    Ok(terms)
}

#[cfg(feature = "rdf-12")]
#[test]
fn safe_open_rdf_12_writer_terms_roundtrip_and_private_disabled_profile_probe() -> Result {
    let directory = tempfile::tempdir()?;
    let path = directory.path();
    let subject = NamedNode::new("urn:rdf12:s")?;
    let predicate = NamedNode::new("urn:rdf12:p")?;
    let graph = NamedNode::new("urn:rdf12:g")?;
    let terms = rdf_12_object_terms()?;
    let mut tags = terms
        .iter()
        .map(|term| encode_term(&EncodedTerm::from(term))[0])
        .collect::<Vec<_>>();
    tags.sort_unstable();
    assert_eq!(tags, vec![49, 49, 56, 57, 58, 59, 60, 61, 62, 63]);

    let store = Store::open(path)?;
    let mut quads = Vec::new();
    for term in terms {
        for graph_name in [GraphName::DefaultGraph, graph.clone().into()] {
            let quad = Quad::new(
                subject.clone(),
                predicate.clone(),
                term.clone(),
                graph_name,
            );
            store.insert(quad.clone())?;
            quads.push(quad);
        }
    }
    drop(store);

    let writable = Store::open(path)?;
    assert!(quads.iter().all(|quad| writable.contains(quad).unwrap()));
    drop(writable);
    let options = Store::open_with_options(path, crate::store::StoreOptions::default())?;
    assert!(quads.iter().all(|quad| options.contains(quad).unwrap()));
    drop(options);
    let read_only = Store::open_read_only(path)?;
    assert!(quads.iter().all(|quad| read_only.contains(quad).unwrap()));
    drop(read_only);

    let before = files(path)?;
    let inspection = Store::inspect_features(path)?;
    assert!(inspection.live_rdf_12_required());
    assert!(!inspection.rdf_12_unsupported());
    assert!(RocksDbStorage::contains_rdf_12_terms(
        path,
        DbOptions::default(),
    )?);
    assert_eq!(files(path)?, before);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn safe_open_outbox_history_is_not_live_feature_admission() -> Result {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    let subject = NamedNode::new("urn:rdf12:history:s")?;
    let predicate = NamedNode::new("urn:rdf12:history:p")?;
    let triple = Triple::new(subject.clone(), predicate.clone(), NamedNode::new("urn:rdf12:o")?);
    let quad = Quad::new(subject, predicate, triple, GraphName::DefaultGraph);
    let mut insert = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([1; 16]),
        )?
        .into_transaction();
    insert.insert(quad.clone())?;
    insert.commit()?;
    let mut remove = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([2; 16]),
        )?
        .into_transaction();
    remove.remove(&quad)?;
    remove.commit()?;
    assert!(!store.contains(&quad)?);
    drop(store);
    let reopened = Store::open_read_only(directory.path())?;
    let batch = reopened.read_outbox(
        None,
        NonZeroUsize::new(4).expect("four is non-zero"),
    )?;
    let records = batch.records();
    assert!(records.iter().any(|record| {
        matches!(
            record,
            OutboxRecord::Event {
                change: SemanticChange::QuadAdded(actual),
                ..
            } if actual == &quad
        )
    }));
    assert!(records.iter().any(|record| {
        matches!(
            record,
            OutboxRecord::Event {
                change: SemanticChange::QuadRemoved(actual),
                ..
            } if actual == &quad
        )
    }));
    drop(reopened);
    // Live indexes are ordinary-compatible, while retained history still
    // records the recognized RDF 1.2 requirement.
    let before = files(directory.path())?;
    let inspection = Store::inspect_features(directory.path())?;
    assert!(!inspection.live_rdf_12_required());
    assert!(inspection.retained_outbox_rdf_12_required());
    assert!(inspection.rdf_12_supported());
    assert!(!inspection.rdf_12_unsupported());
    assert!(!RocksDbStorage::contains_rdf_12_terms(
        directory.path(),
        DbOptions::default(),
    )?);
    assert_eq!(files(directory.path())?, before);
    Ok(())
}
