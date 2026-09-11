#![cfg(test)]
#![expect(clippy::panic_in_result_fn)]

use oxigraph::io::RdfFormat;
use oxigraph::model::vocab::{rdf, xsd};
use oxigraph::model::*;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use oxigraph::store::StoreOptions;
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
use oxigraph::store::{
    PreparedUpgrade, TransformedUpgrade, UpgradeOptions, UpgradeTransformOptions,
};
use std::error::Error;
#[cfg(all(target_os = "linux", feature = "rocksdb"))]
use std::fs::remove_dir_all;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::fs::{File, create_dir_all, read_dir, remove_dir};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::io::Write;
use std::iter::empty;
#[cfg(all(target_os = "linux", feature = "rocksdb"))]
use std::iter::once;
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
use std::path::{Path, PathBuf};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use tempfile::TempDir;

#[expect(clippy::non_ascii_literal)]
const DATA: &str = r#"
@prefix schema: <http://schema.org/> .
@prefix wd: <http://www.wikidata.org/entity/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

wd:Q90 a schema:City ;
    schema:name "Paris"@fr , "la ville lumière"@fr ;
    schema:country wd:Q142 ;
    schema:population 2000000 ;
    schema:startDate "-300"^^xsd:gYear ;
    schema:url "https://www.paris.fr/"^^xsd:anyURI ;
    schema:postalCode "75001" .
"#;

#[expect(clippy::non_ascii_literal)]
const GRAPH_DATA: &str = r#"
@prefix schema: <http://schema.org/> .
@prefix wd: <http://www.wikidata.org/entity/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

GRAPH <http://www.wikidata.org/wiki/Special:EntityData/Q90> {
    wd:Q90 a schema:City ;
        schema:name "Paris"@fr , "la ville lumière"@fr ;
        schema:country wd:Q142 ;
        schema:population 2000000 ;
        schema:startDate "-300"^^xsd:gYear ;
        schema:url "https://www.paris.fr/"^^xsd:anyURI ;
        schema:postalCode "75001" .
}
"#;
const NUMBER_OF_TRIPLES: usize = 8;

fn quads(graph_name: impl Into<GraphName>) -> Vec<Quad> {
    let graph_name = graph_name.into();
    let paris = NamedNode::new_unchecked("http://www.wikidata.org/entity/Q90");
    let france = NamedNode::new_unchecked("http://www.wikidata.org/entity/Q142");
    let city = NamedNode::new_unchecked("http://schema.org/City");
    let name = NamedNode::new_unchecked("http://schema.org/name");
    let country = NamedNode::new_unchecked("http://schema.org/country");
    let population = NamedNode::new_unchecked("http://schema.org/population");
    let start_date = NamedNode::new_unchecked("http://schema.org/startDate");
    let url = NamedNode::new_unchecked("http://schema.org/url");
    let postal_code = NamedNode::new_unchecked("http://schema.org/postalCode");
    vec![
        Quad::new(paris.clone(), rdf::TYPE, city, graph_name.clone()),
        Quad::new(
            paris.clone(),
            name.clone(),
            Literal::new_language_tagged_literal_unchecked("Paris", "fr"),
            graph_name.clone(),
        ),
        Quad::new(
            paris.clone(),
            name,
            Literal::new_language_tagged_literal_unchecked("la ville lumi\u{E8}re", "fr"),
            graph_name.clone(),
        ),
        Quad::new(paris.clone(), country, france, graph_name.clone()),
        Quad::new(
            paris.clone(),
            population,
            Literal::new_typed_literal("2000000", xsd::INTEGER),
            graph_name.clone(),
        ),
        Quad::new(
            paris.clone(),
            start_date,
            Literal::new_typed_literal("-300", xsd::G_YEAR),
            graph_name.clone(),
        ),
        Quad::new(
            paris.clone(),
            url,
            Literal::new_typed_literal("https://www.paris.fr/", xsd::ANY_URI),
            graph_name.clone(),
        ),
        Quad::new(
            paris.clone(),
            postal_code,
            Literal::new_simple_literal("75001"),
            graph_name,
        ),
    ]
}

#[test]
fn test_load_graph() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.load_from_reader(RdfFormat::Turtle, DATA.as_bytes())?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_load_graph_on_disk() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    store.load_from_reader(RdfFormat::Turtle, DATA.as_bytes())?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_merged_default_graph_on_disk() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    assert_merged_default_graph(&store)
}

#[test]
fn test_merged_default_graph_in_memory() -> Result<(), Box<dyn Error>> {
    assert_merged_default_graph(&Store::new()?)
}

fn assert_merged_default_graph(store: &Store) -> Result<(), Box<dyn Error>> {
    let s1 = NamedNode::new_unchecked("urn:s1");
    let s2 = NamedNode::new_unchecked("urn:s2");
    let s3 = NamedNode::new_unchecked("urn:s3");
    let p1 = NamedNode::new_unchecked("urn:p1");
    let p2 = NamedNode::new_unchecked("urn:p2");
    let o1 = NamedNode::new_unchecked("urn:o1");
    let o2 = NamedNode::new_unchecked("urn:o2");
    let g1 = NamedNode::new_unchecked("urn:g1");
    let g2 = NamedNode::new_unchecked("urn:g2");
    for quad in [
        Quad::new(
            NamedNode::new_unchecked("urn:default-only"),
            p1.clone(),
            o1.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(s1.clone(), p1.clone(), o1.clone(), g1.clone()),
        Quad::new(s2.clone(), p1.clone(), o1.clone(), g1.clone()),
        Quad::new(s1.clone(), p2.clone(), o2.clone(), g1.clone()),
        Quad::new(s1.clone(), p1.clone(), o1.clone(), g2.clone()),
        Quad::new(s1.clone(), p2.clone(), o2.clone(), g2.clone()),
        Quad::new(s3, p1, o1, g2),
    ] {
        store.insert(quad)?;
    }

    for (pattern, expected_count) in [
        ("?s ?p ?o", 4),
        ("<urn:s1> ?p ?o", 2),
        ("?s <urn:p1> ?o", 3),
        ("?s ?p <urn:o1>", 3),
        ("<urn:s1> ?p <urn:o1>", 1),
        ("<urn:s1> <urn:p1> ?o", 1),
        ("?s <urn:p1> <urn:o1>", 3),
        ("<urn:s1> <urn:p1> <urn:o1>", 1),
    ] {
        let query = format!("SELECT * FROM <urn:g1> FROM <urn:g2> WHERE {{ {pattern} }}");
        let QueryResults::Solutions(solutions) = SparqlEvaluator::new()
            .parse_query(&query)?
            .on_store(store)
            .execute()?
        else {
            unreachable!()
        };
        assert_eq!(
            solutions.collect::<Result<Vec<_>, _>>()?.len(),
            expected_count,
            "pattern: {pattern}"
        );
    }

    let mut query = SparqlEvaluator::new().parse_query("SELECT * WHERE { ?s ?p ?o }")?;
    query.dataset_mut().set_default_graph_as_union();
    let QueryResults::Solutions(solutions) = query.on_store(store).execute()? else {
        unreachable!()
    };
    assert_eq!(solutions.collect::<Result<Vec<_>, _>>()?.len(), 4);
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_load_graph_on_disk_with_options() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open_with_options(
        &dir,
        StoreOptions::default()
            .with_max_open_files(128)
            .with_fd_reserve(64),
    )?;
    store.load_from_reader(RdfFormat::Turtle, DATA.as_bytes())?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
fn test_bulk_load_graph() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader();
    loader.load_from_slice(RdfFormat::Turtle, DATA.as_bytes())?;
    loader.commit()?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_bulk_load_graph_on_disk() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    let mut loader = store.bulk_loader();
    loader.load_from_slice(RdfFormat::Turtle, DATA.as_bytes())?;
    loader.commit()?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
fn test_bulk_load_graph_lenient() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader().on_parse_error(|_| Ok(()));
    loader.load_from_slice(
        RdfFormat::NTriples,
        b"<http://example.com> <http://example.com> <http://example.com##> .\n<http://example.com> <http://example.com> <http://example.com> .".as_slice(),
    )?;
    loader.commit()?;
    assert_eq!(store.len()?, 1);
    assert!(store.contains(&Quad::new(
        NamedNode::new_unchecked("http://example.com"),
        NamedNode::new_unchecked("http://example.com"),
        NamedNode::new_unchecked("http://example.com"),
        GraphName::DefaultGraph
    ))?);
    store.validate()?;
    Ok(())
}

#[test]
fn test_bulk_load_empty() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader();
    loader.load_quads(empty::<Quad>())?;
    loader.commit()?;
    assert!(store.is_empty()?);
    store.validate()?;
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn test_bulk_load_rollback() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    let before_files = read_dir(&dir)?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut loader = store.bulk_loader();
    loader.load_from_slice(RdfFormat::Turtle, DATA.as_bytes())?;
    drop(loader);
    store.validate()?;
    let after_files = read_dir(&dir)?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(
        before_files, after_files,
        "Files created even if bulk loader got rolled back"
    );
    Ok(())
}

#[test]
fn test_load_dataset() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.load_from_reader(RdfFormat::TriG, GRAPH_DATA.as_bytes())?;
    for q in quads(NamedNode::new_unchecked(
        "http://www.wikidata.org/wiki/Special:EntityData/Q90",
    )) {
        assert!(store.contains(&q)?);
    }
    store.validate()?;
    Ok(())
}

#[test]
fn test_bulk_load_dataset() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader();
    loader.load_from_slice(RdfFormat::TriG, GRAPH_DATA.as_bytes())?;
    loader.commit()?;
    let graph_name =
        NamedNode::new_unchecked("http://www.wikidata.org/wiki/Special:EntityData/Q90");
    for q in quads(graph_name.clone()) {
        assert!(store.contains(&q)?);
    }
    assert!(store.contains_named_graph(&graph_name.into())?);
    store.validate()?;
    Ok(())
}

#[test]
fn test_load_graph_generates_new_blank_nodes() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    for _ in 0..2 {
        store.load_from_reader(
            RdfFormat::NTriples,
            "_:a <http://example.com/p> <http://example.com/p> .".as_bytes(),
        )?;
    }
    assert_eq!(store.len()?, 2);
    Ok(())
}

#[test]
fn test_dump_graph() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    for q in quads(GraphName::DefaultGraph) {
        store.insert(q)?;
    }

    let mut buffer = Vec::new();
    store.dump_graph_to_writer(&GraphName::DefaultGraph, RdfFormat::NTriples, &mut buffer)?;
    assert_eq!(
        buffer.into_iter().filter(|c| *c == b'\n').count(),
        NUMBER_OF_TRIPLES
    );
    Ok(())
}

#[test]
fn test_dump_dataset() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    for q in quads(GraphName::DefaultGraph) {
        store.insert(q)?;
    }

    let buffer = store.dump_to_writer(RdfFormat::NQuads, Vec::new())?;
    assert_eq!(
        buffer.into_iter().filter(|c| *c == b'\n').count(),
        NUMBER_OF_TRIPLES
    );
    Ok(())
}

#[test]
fn test_snapshot_isolation_iterator() -> Result<(), Box<dyn Error>> {
    let quad = Quad::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/p")?,
        NamedNode::new("http://example.com/o")?,
        NamedNode::new("http://www.wikidata.org/wiki/Special:EntityData/Q90")?,
    );
    let store = Store::new()?;
    store.insert(quad.clone())?;
    let iter = store.iter();
    store.remove(&quad)?;
    assert_eq!(iter.collect::<Result<Vec<_>, _>>()?, vec![quad]);
    store.validate()?;
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_snapshot_isolation_iterator_on_disk() -> Result<(), Box<dyn Error>> {
    let quad = Quad::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/p")?,
        NamedNode::new("http://example.com/o")?,
        NamedNode::new("http://www.wikidata.org/wiki/Special:EntityData/Q90")?,
    );
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    store.insert(quad.clone())?;
    let iter = store.iter();
    store.remove(&quad)?;
    assert_eq!(iter.collect::<Result<Vec<_>, _>>()?, vec![quad]);
    store.validate()?;
    Ok(())
}

#[test]
fn test_bulk_load_on_existing_delete_overrides_the_delete() -> Result<(), Box<dyn Error>> {
    let quad = Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        NamedNode::new_unchecked("http://www.wikidata.org/wiki/Special:EntityData/Q90"),
    );
    let store = Store::new()?;
    store.remove(&quad)?;
    let mut loader = store.bulk_loader();
    loader.load_quads([quad])?;
    loader.commit()?;
    assert_eq!(store.len()?, 1);
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_bulk_load_on_existing_delete_overrides_the_delete_on_disk() -> Result<(), Box<dyn Error>> {
    let quad = Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        NamedNode::new_unchecked("http://www.wikidata.org/wiki/Special:EntityData/Q90"),
    );
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    store.remove(&quad)?;
    let mut loader = store.bulk_loader();
    loader.load_quads([quad])?;
    loader.commit()?;
    assert_eq!(store.len()?, 1);
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_open_bad_dir() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    create_dir_all(&dir)?;
    {
        File::create(dir.as_ref().join("CURRENT"))?.write_all(b"foo")?;
    }
    assert!(Store::open(&dir).is_err());
    Ok(())
}

#[test]
#[cfg(all(target_os = "linux", feature = "rocksdb"))]
fn test_bad_stt_open() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    let store = Store::open(&dir)?;
    remove_dir_all(&dir)?;
    let mut loader = store.bulk_loader();
    loader.load_quads(once(Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        GraphName::DefaultGraph,
    )))?;
    loader.commit().unwrap_err();
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_backup() -> Result<(), Box<dyn Error>> {
    let quad = Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        GraphName::DefaultGraph,
    );
    let store_dir = TempDir::new()?;
    let backup_from_rw_dir = TempDir::new()?;
    remove_dir(&backup_from_rw_dir)?;
    let backup_from_ro_dir = TempDir::new()?;
    remove_dir(&backup_from_ro_dir)?;

    let store = Store::open(&store_dir)?;
    store.insert(quad.clone())?;
    store.backup(&backup_from_rw_dir)?;
    store.remove(&quad)?;
    assert!(!store.contains(&quad)?);

    let backup_from_rw = Store::open_read_only(&backup_from_rw_dir)?;
    backup_from_rw.validate()?;
    assert!(backup_from_rw.contains(&quad)?);
    backup_from_rw.backup(&backup_from_ro_dir)?;

    let backup_from_ro = Store::open_read_only(&backup_from_ro_dir)?;
    backup_from_ro.validate()?;
    assert!(backup_from_ro.contains(&quad)?);

    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_bad_backup() -> Result<(), Box<dyn Error>> {
    let store_dir = TempDir::new()?;
    let backup_dir = TempDir::new()?;

    create_dir_all(&backup_dir)?;
    Store::open(&store_dir)?.backup(&backup_dir).unwrap_err();
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_backup_on_in_memory() -> Result<(), Box<dyn Error>> {
    let backup_dir = TempDir::new()?;
    Store::new()?.backup(&backup_dir).unwrap_err();
    Ok(())
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
struct BackwardCompatibilityFixture {
    directory: TempDir,
    active: PathBuf,
    source_before: std::collections::BTreeMap<PathBuf, Vec<u8>>,
    backup_before: std::collections::BTreeMap<PathBuf, Vec<u8>>,
    workspace_before: std::collections::BTreeMap<PathBuf, Vec<u8>>,
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
impl AsRef<Path> for BackwardCompatibilityFixture {
    fn as_ref(&self) -> &Path {
        &self.active
    }
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
impl BackwardCompatibilityFixture {
    fn assert_preserved(&self) -> Result<(), Box<dyn Error>> {
        assert_eq!(
            tree(&self.directory.path().join("source"))?,
            self.source_before
        );
        assert_eq!(
            tree(&self.directory.path().join("backup"))?,
            self.backup_before
        );
        assert_eq!(
            tree(&self.directory.path().join("workspace"))?,
            self.workspace_before
        );
        Ok(())
    }
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
fn tree(path: &Path) -> Result<std::collections::BTreeMap<PathBuf, Vec<u8>>, Box<dyn Error>> {
    let mut files = std::collections::BTreeMap::new();
    for entry in read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            for (relative, bytes) in tree(&entry.path())? {
                files.insert(PathBuf::from(entry.file_name()).join(relative), bytes);
            }
        } else {
            assert!(entry.file_type()?.is_file());
            files.insert(entry.file_name().into(), std::fs::read(entry.path())?);
        }
    }
    Ok(files)
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
fn copy_verified_transformed_store(
    transformed: &TransformedUpgrade,
    destination: &Path,
) -> Result<(), Box<dyn Error>> {
    use sha2::{Digest, Sha256};
    let source = transformed.directory().join("store");
    std::fs::create_dir(destination)?;
    let mut expected = std::collections::BTreeMap::new();
    for file in transformed.files() {
        if file.path() == PreparedUpgrade::guard_name() {
            continue;
        }
        let source_file = source.join(file.path());
        let destination_file = destination.join(file.path());
        let bytes = std::fs::read(&source_file)?;
        assert_eq!(bytes.len() as u64, file.size());
        assert_eq!(Sha256::digest(&bytes).as_slice(), file.sha256());
        assert_eq!(std::fs::copy(&source_file, &destination_file)?, file.size());
        expected.insert(PathBuf::from(file.path()), bytes);
    }
    assert!(source.join(PreparedUpgrade::guard_name()).exists());
    assert_eq!(tree(destination)?, expected);
    Ok(())
}

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
fn copy_backward_compatibility_fixture(
    path: &str,
    expected_version: u64,
) -> Result<BackwardCompatibilityFixture, Box<dyn Error>> {
    let directory = TempDir::new()?;
    let source = directory.path().join("source");
    std::fs::create_dir(&source)?;
    for entry in read_dir(path)? {
        let entry = entry?;
        std::fs::copy(entry.path(), source.join(entry.file_name()))?;
    }
    let source_before = tree(&source)?;
    for read_only in [false, true] {
        let opened = if read_only {
            Store::open_read_only(&source)
        } else {
            Store::open(&source)
        };
        assert!(matches!(
            opened,
            Err(oxigraph::store::StorageError::UpgradeRequired {
                found,
                supported: 2
            }) if found == expected_version
        ));
        assert_eq!(tree(&source)?, source_before);
    }
    let backup = directory.path().join("backup");
    let workspace = directory.path().join("workspace");
    let active = directory.path().join("active");
    let transform_options = UpgradeTransformOptions::default();
    Store::backup_legacy(&source, &backup, &transform_options.backup)?;
    let backup_before = tree(&backup)?;
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored") {
        let options = UpgradeOptions::default();
        let receipt = Store::upgrade(&source, &backup, &workspace, &options)?;
        assert_eq!(
            receipt,
            oxigraph::store::UpgradeReceipt::verify(&source, &backup, &workspace, &options)?
        );
        let workspace_before = tree(&workspace)?;
        Store::activate_upgrade(&source, &backup, &workspace, &active, &options)?;
        Ok(BackwardCompatibilityFixture {
            source_before,
            backup_before,
            workspace_before,
            directory,
            active,
        })
    } else {
        Store::prepare_upgrade(&source, &backup, &workspace, &transform_options.backup)?;
        let transformed =
            Store::transform_prepared_upgrade(&source, &backup, &workspace, &transform_options)?;
        assert_eq!(
            transformed,
            TransformedUpgrade::verify(&source, &backup, &workspace, &transform_options)?
        );
        let workspace_before = tree(&workspace)?;
        // TEST-ONLY: this fresh native-file copy demonstrates ordinary-open
        // compatibility. It is not activation, a receipt, or upgrade authority.
        copy_verified_transformed_store(&transformed, &active)?;
        Ok(BackwardCompatibilityFixture {
            source_before,
            backup_before,
            workspace_before,
            directory,
            active,
        })
    }
}

#[test]
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
fn test_verified_transformed_copy_is_ordinary_openable() -> Result<(), Box<dyn Error>> {
    let directory = TempDir::new()?;
    let source = directory.path().join("source");
    std::fs::create_dir(&source)?;
    for entry in read_dir("tests/rocksdb_bc_data")? {
        let entry = entry?;
        std::fs::copy(entry.path(), source.join(entry.file_name()))?;
    }
    let source_before = tree(&source)?;
    assert!(matches!(
        Store::open(&source),
        Err(oxigraph::store::StorageError::UpgradeRequired {
            found: 0,
            supported: 2
        })
    ));
    assert!(matches!(
        Store::open_read_only(&source),
        Err(oxigraph::store::StorageError::UpgradeRequired {
            found: 0,
            supported: 2
        })
    ));
    assert_eq!(tree(&source)?, source_before);
    let backup = directory.path().join("backup");
    let workspace = directory.path().join("workspace");
    let active = directory.path().join("active");
    let options = UpgradeTransformOptions::default();
    Store::backup_legacy(&source, &backup, &options.backup)?;
    let backup_before = tree(&backup)?;
    Store::prepare_upgrade(&source, &backup, &workspace, &options.backup)?;
    let transformed = Store::transform_prepared_upgrade(&source, &backup, &workspace, &options)?;
    assert_eq!(
        transformed,
        TransformedUpgrade::verify(&source, &backup, &workspace, &options)?
    );
    let workspace_before = tree(&workspace)?;
    // TEST-ONLY: this fresh native-file copy demonstrates ordinary-open
    // compatibility. It is not activation, a receipt, or upgrade authority.
    copy_verified_transformed_store(&transformed, &active)?;
    assert!(
        workspace
            .join("store")
            .join(PreparedUpgrade::guard_name())
            .exists()
    );
    let store = Store::open(&active)?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(store.contains(&q)?);
    }
    drop(store);
    let reopened = Store::open_read_only(&active)?;
    for q in quads(GraphName::DefaultGraph) {
        assert!(reopened.contains(&q)?);
    }
    drop(reopened);
    assert_eq!(tree(&source)?, source_before);
    assert_eq!(tree(&backup)?, backup_before);
    assert_eq!(tree(&workspace)?, workspace_before);
    Ok(())
}

#[test]
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb"
))]
fn test_backward_compatibility() -> Result<(), Box<dyn Error>> {
    let fixture = copy_backward_compatibility_fixture("tests/rocksdb_bc_data", 0)?;
    // We run twice to check if data is properly saved and closed
    for _ in 0..2 {
        let store = Store::open(&fixture)?;
        for q in quads(GraphName::DefaultGraph) {
            assert!(store.contains(&q)?);
        }
        let graph_name =
            NamedNode::new_unchecked("http://www.wikidata.org/wiki/Special:EntityData/Q90");
        for q in quads(graph_name.clone()) {
            assert!(store.contains(&q)?);
        }
        assert!(store.contains_named_graph(&graph_name.clone().into())?);
        assert_eq!(
            vec![NamedOrBlankNode::from(graph_name)],
            store.named_graphs().collect::<Result<Vec<_>, _>>()?
        );
    }
    fixture.assert_preserved()?;
    Ok(())
}

#[test]
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little",
    feature = "rocksdb",
    feature = "rdf-12"
))]
fn test_rdf_star_backward_compatibility() -> Result<(), Box<dyn Error>> {
    let fixture = copy_backward_compatibility_fixture("tests/rocksdb_bc_rdf_star_data", 1)?;
    // We run twice to check if data is properly saved and closed
    let s = NamedNode::new_unchecked("http://example.com/s");
    let p = NamedNode::new_unchecked("http://example.com/p");
    let o = NamedNode::new_unchecked("http://example.com/o");
    let g = NamedNode::new_unchecked("http://example.com/g");
    let bnode = BlankNode::new_unchecked("f2fef82410957224105241225fd0a648");
    for _ in 0..2 {
        let store = Store::open(&fixture)?;
        assert!(store.contains(&Quad::new(s.clone(), p.clone(), o.clone(), g.clone()))?);
        assert!(store.contains(&Quad::new(
            s.clone(),
            p.clone(),
            o.clone(),
            GraphName::DefaultGraph
        ))?);
        assert!(store.contains(&Quad::new(bnode.clone(), p.clone(), o.clone(), g.clone()))?);
        assert!(store.contains(&Quad::new(
            bnode.clone(),
            p.clone(),
            o.clone(),
            GraphName::DefaultGraph
        ))?);
        assert!(store.contains(&Quad::new(s.clone(), p.clone(), bnode.clone(), g.clone()))?);
        assert!(store.contains(&Quad::new(
            s.clone(),
            p.clone(),
            bnode.clone(),
            GraphName::DefaultGraph
        ))?);
        assert!(store.contains(&Quad::new(
            bnode.clone(),
            rdf::REIFIES,
            Triple::new(s.clone(), p.clone(), o.clone()),
            g.clone()
        ))?);
        assert!(store.contains(&Quad::new(
            bnode.clone(),
            rdf::REIFIES,
            Triple::new(s.clone(), p.clone(), o.clone()),
            GraphName::DefaultGraph
        ))?);
    }
    fixture.assert_preserved()?;
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_read_only() -> Result<(), Box<dyn Error>> {
    let s = NamedNode::new_unchecked("http://example.com/s");
    let p = NamedNode::new_unchecked("http://example.com/p");
    let first_quad = Quad::new(
        s.clone(),
        p.clone(),
        NamedNode::new_unchecked("http://example.com/o"),
        GraphName::DefaultGraph,
    );
    let second_quad = Quad::new(
        s,
        p,
        NamedNode::new_unchecked("http://example.com/o2"),
        GraphName::DefaultGraph,
    );
    let store_dir = TempDir::new()?;

    // We write to the store and close it
    {
        let read_write = Store::open(&store_dir)?;
        read_write.insert(first_quad.clone())?;
        read_write.flush()?;
    }

    // We open as read-only
    let read_only = Store::open_read_only(&store_dir)?;
    assert!(read_only.contains(&first_quad)?);
    assert_eq!(
        read_only.iter().collect::<Result<Vec<_>, _>>()?,
        vec![first_quad]
    );
    read_only.validate()?;
    drop(read_only);

    // We open as read-write again
    let read_write = Store::open(&store_dir)?;
    read_write.insert(second_quad.clone())?;
    read_write.flush()?;
    read_write.optimize()?; // Makes sure it's well flushed
    drop(read_write);

    // We reopen as read-only after the writer closes
    let read_only = Store::open_read_only(&store_dir)?;
    assert!(read_only.contains(&second_quad)?);
    read_only.validate()?;

    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_open_read_only_bad_dir() -> Result<(), Box<dyn Error>> {
    let dir = TempDir::new()?;
    create_dir_all(&dir)?;
    {
        File::create(dir.as_ref().join("CURRENT"))?.write_all(b"foo")?;
    }
    assert!(Store::open_read_only(&dir).is_err());
    Ok(())
}

#[test]
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn test_read_your_own_write_transaction() -> Result<(), Box<dyn Error>> {
    let store_dir = TempDir::new()?;

    let quad = Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        GraphName::DefaultGraph,
    );

    let store = Store::open(&store_dir)?;
    let mut transaction = store.start_transaction()?;
    transaction.insert(quad.clone());
    assert_eq!(transaction.iter().collect::<Result<Vec<_>, _>>()?, [quad]);

    Ok(())
}
