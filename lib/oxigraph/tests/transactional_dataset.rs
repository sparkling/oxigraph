#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public transactional dataset contract"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{SparqlEvaluator, UpdateEvaluationError};
use oxigraph::store::{TransactionalDataset, WritableDataset};
use std::cell::{RefCell, RefMut};
use std::convert::Infallible;

#[derive(Default)]
struct RewrittenPersistencePlane {
    dataset: RefCell<Dataset>,
}

impl RewrittenPersistencePlane {
    fn snapshot(&self) -> Dataset {
        self.dataset.borrow().clone()
    }
}

struct RewrittenTransaction<'a> {
    target: RefMut<'a, Dataset>,
    staged: Dataset,
}

impl TransactionalDataset for RewrittenPersistencePlane {
    type Error = Infallible;
    type Transaction<'a> = RewrittenTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        let staged = self.dataset.borrow().clone();
        Ok(RewrittenTransaction {
            target: self.dataset.borrow_mut(),
            staged,
        })
    }
}

impl WritableDataset for RewrittenTransaction<'_> {
    type Error = Infallible;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Infallible>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Infallible>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        let subject = subject.cloned();
        let predicate = predicate.cloned();
        let object = object.cloned();
        let graph_name = graph_name.map(Option::<&NamedOrBlankNode>::cloned);
        Box::new(
            self.staged
                .iter()
                .filter(move |quad| {
                    subject.as_ref().is_none_or(|term| term == &quad.subject)
                        && predicate
                            .as_ref()
                            .is_none_or(|term| term == &quad.predicate)
                        && object.as_ref().is_none_or(|term| term == &quad.object)
                        && match &graph_name {
                            Some(None) => quad.graph_name.is_default_graph(),
                            Some(Some(graph_name)) => {
                                quad.graph_name == GraphName::from(graph_name.clone())
                            }
                            None => !quad.graph_name.is_default_graph(),
                        }
                })
                .map(Ok),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(self.staged.named_graphs().map(Ok))
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(self.staged.contains_named_graph(graph_name.as_ref()))
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.staged.insert(quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.staged.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        let graph_name = graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
            GraphName::from(graph_name.clone())
        });
        self.staged.clear_graph(&graph_name);
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.clear_graph(&GraphName::from(graph_name));
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.staged.clear_graph(&GraphName::DefaultGraph);
        self.clear_all_named_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.remove_named_graph(graph_name.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.staged.clear();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        let Self { mut target, staged } = self;
        *target = staged;
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

#[test]
fn custom_persistence_plane_executes_sparql_update_with_read_your_writes()
-> Result<(), Box<dyn std::error::Error>> {
    let backend = RewrittenPersistencePlane::default();
    SparqlEvaluator::new()
        .parse_update(
            "CREATE GRAPH <urn:g>;
             INSERT DATA { GRAPH <urn:g> { <urn:s> <urn:p> 1 } };
             DELETE { GRAPH <urn:g> { ?s <urn:p> ?o } }
             INSERT { GRAPH <urn:g> { ?s <urn:p2> ?o } }
             WHERE { GRAPH <urn:g> { ?s <urn:p> ?o } }",
        )?
        .on_dataset(&backend)
        .execute()?;

    let snapshot = backend.snapshot();
    let graph = NamedNode::new("urn:g")?;
    assert!(snapshot.contains_named_graph(graph.as_ref()));
    assert!(
        !snapshot
            .iter()
            .any(|quad| quad.predicate.as_str() == "urn:p")
    );
    assert!(
        snapshot
            .iter()
            .any(|quad| { quad.predicate.as_str() == "urn:p2" && quad.graph_name == graph })
    );

    SparqlEvaluator::new()
        .parse_update("CLEAR GRAPH <urn:g>")?
        .on_dataset(&backend)
        .execute()?;
    let snapshot = backend.snapshot();
    assert!(snapshot.contains_named_graph(graph.as_ref()));
    assert!(snapshot.is_empty());

    SparqlEvaluator::new()
        .parse_update("DROP GRAPH <urn:g>")?
        .on_dataset(&backend)
        .execute()?;
    assert!(!backend.snapshot().contains_named_graph(graph.as_ref()));
    Ok(())
}

#[test]
fn custom_persistence_plane_rolls_back_the_whole_failed_request()
-> Result<(), Box<dyn std::error::Error>> {
    let backend = RewrittenPersistencePlane::default();
    let error = SparqlEvaluator::new()
        .parse_update(
            "INSERT DATA { <urn:s> <urn:p> <urn:o> };
             CREATE GRAPH <urn:g>;
             CREATE GRAPH <urn:g>",
        )?
        .on_dataset(&backend)
        .execute()
        .unwrap_err();
    assert!(matches!(
        error,
        UpdateEvaluationError::GraphAlreadyExists(_)
    ));
    let snapshot = backend.snapshot();
    assert!(snapshot.is_empty());
    assert_eq!(snapshot.named_graphs().count(), 0);
    Ok(())
}

#[test]
fn explicit_transaction_rollback_discards_visible_staged_writes()
-> Result<(), Box<dyn std::error::Error>> {
    let backend = RewrittenPersistencePlane::default();
    let graph = NamedNode::new("urn:g")?;
    let quad = Quad::new(
        NamedNode::new("urn:s")?,
        NamedNode::new("urn:p")?,
        NamedNode::new("urn:o")?,
        graph.clone(),
    );
    let mut transaction = backend.start_transaction()?;
    transaction.insert_named_graph(graph.clone().into())?;
    transaction.insert(quad)?;
    assert!(transaction.contains_named_graph(&graph.clone().into())?);
    assert_eq!(
        transaction
            .quads_for_pattern(None, None, None, Some(Some(&graph.clone().into())))
            .count(),
        1
    );
    transaction.rollback()?;

    let snapshot = backend.snapshot();
    assert!(snapshot.is_empty());
    assert_eq!(snapshot.named_graphs().count(), 0);
    Ok(())
}
