//! `cargo run --locked -p oxigraph --example derived_generations`
//! A count-only toy provider demonstrates lifecycle APIs, not a search engine.
#[cfg(all(unix, feature = "rocksdb"))]
mod native {
    use oxigraph::model::{GraphName, NamedNode, Quad};
    use oxigraph::store::{
        ContributorIdentity, DerivedFiles, DerivedGenerationError, DerivedGenerationLimits,
        DerivedIndex, DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedWriter, Store,
        TransactionStartControl,
    };
    use std::io::{Read, Write};
    use std::num::NonZeroU32;
    struct Counts;
    impl DerivedProvider for Counts {
        fn identity(&self) -> ContributorIdentity {
            ContributorIdentity::new([24; 16], NonZeroU32::MIN)
        }
        fn rebuild(
            &self,
            source: &DerivedSnapshot,
            output: &mut DerivedWriter<'_>,
            limits: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            let count = source.scan(limits, |_| Ok(()))?.records();
            output.write_file("count", count.to_be_bytes().as_slice())
        }
        fn reconcile(
            &self,
            source: &DerivedSnapshot,
            files: &DerivedFiles,
            limits: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            let expected = source.scan(limits, |_| Ok(()))?.records();
            let mut bytes = [0; 8];
            files.read("count")?.read_exact(&mut bytes)?;
            if u64::from_be_bytes(bytes) != expected {
                return Err(DerivedGenerationError::Reconciliation(
                    "count differs".into(),
                ));
            }
            Ok(())
        }
    }
    pub fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("primary"))?;
        let node = NamedNode::new("urn:example")?;
        store.insert(Quad::new(
            node.clone(),
            node.clone(),
            node.clone(),
            GraphName::DefaultGraph,
        ))?;
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        let root = directory.path().join("index");
        let limits = DerivedGenerationLimits::default();
        let mut index = DerivedIndex::create(&root, Counts.identity())?;
        let generation = index.rebuild(&source, &Counts, &limits)?;
        index.activate(&generation, &source, &Counts, &limits)?;
        drop(index);
        let index = DerivedIndex::open(&root, Counts.identity())?;
        let view = index.strict(&source, &limits)?;
        let mut count = [0; 8];
        view.generation()
            .files()
            .read("count")?
            .read_exact(&mut count)?;
        store.insert_named_graph(node)?;
        let newer = store.derived_snapshot(&TransactionStartControl::new())?;
        let stale = matches!(
            index.strict(&newer, &limits),
            Err(DerivedGenerationError::NotFresh)
        );
        if !stale || u64::from_be_bytes(count) != 1 {
            return Err("unexpected generation behavior".into());
        }
        writeln!(
            std::io::stdout().lock(),
            "reopened_count={} strict_new_snapshot_not_fresh={stale} eventual_opt_in={}",
            u64::from_be_bytes(count),
            index.eventual(&newer, &limits)?.is_eventual()
        )?;
        Ok(())
    }
}
#[cfg(all(unix, feature = "rocksdb"))]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    native::run()
}
#[cfg(not(all(unix, feature = "rocksdb")))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires Unix native RocksDB support".into())
}
