#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public import-closure boundary"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, GraphSnapshot, LimitKind, ProfileSet, ShapesGraph, ValidationError,
    ValidationOptions,
};
use std::cell::RefCell;
use std::io;

const OWL_IMPORTS: &str = "http://www.w3.org/2002/07/owl#imports";
const OWL_VERSION_IRI: &str = "http://www.w3.org/2002/07/owl#versionIRI";
const OWL_INCOMPATIBLE_WITH: &str = "http://www.w3.org/2002/07/owl#incompatibleWith";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn ex(local: &str) -> NamedNode {
    iri(&format!("http://example.com/{local}"))
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: &str,
    object: impl Into<Term>,
) {
    dataset.insert(Quad::new(
        subject,
        iri(predicate),
        object,
        GraphName::DefaultGraph,
    ));
}

fn snapshot(dataset: Dataset) -> GraphSnapshot {
    GraphSnapshot::default_graph(dataset)
}

fn checked(source: Dataset) -> Result<ShapesGraph, CompileError> {
    ShapesGraph::compile_checked(
        &snapshot(source),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
}

fn checked_with<R: oxshacl::ShapesGraphImportResolver>(
    source: Dataset,
    options: &ValidationOptions,
    resolver: &R,
) -> Result<ShapesGraph, CompileError> {
    ShapesGraph::compile_checked_with_imports(
        &snapshot(source),
        ProfileSet::default(),
        options,
        resolver,
    )
}

#[test]
fn owl_import_metadata_requires_iri_objects_and_named_identity_subjects() {
    for predicate in [OWL_IMPORTS, OWL_VERSION_IRI, OWL_INCOMPATIBLE_WITH] {
        let mut source = Dataset::new();
        insert(
            &mut source,
            ex("graph"),
            predicate,
            Literal::from("not-an-iri"),
        );
        assert!(matches!(
            checked(source),
            Err(CompileError::Validation(ValidationError::IllFormed(reason)))
                if reason.contains("values must be IRIs")
        ));
    }

    for predicate in [OWL_VERSION_IRI, OWL_INCOMPATIBLE_WITH] {
        let mut source = Dataset::new();
        insert(
            &mut source,
            BlankNode::new_unchecked("anonymous"),
            predicate,
            ex("other"),
        );
        assert!(matches!(
            checked(source),
            Err(CompileError::Validation(ValidationError::IllFormed(reason)))
                if reason.contains("subjects must be IRIs")
        ));
    }
}

#[test]
fn original_graph_imports_are_followed_even_from_an_anonymous_owner() {
    let imported = ex("imported");
    let mut source = Dataset::new();
    insert(
        &mut source,
        BlankNode::new_unchecked("root"),
        OWL_IMPORTS,
        imported.clone(),
    );
    let calls = RefCell::new(Vec::new());
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        calls.borrow_mut().push(requested.clone());
        Ok(Some(snapshot(Dataset::new())))
    };

    checked_with(source, &ValidationOptions::default(), &resolver).unwrap();
    assert_eq!(calls.into_inner(), vec![imported]);
}

#[test]
fn local_identity_metadata_is_checked_without_imports() {
    let series = ex("series");
    let mut multiple_versions = Dataset::new();
    insert(
        &mut multiple_versions,
        series.clone(),
        OWL_VERSION_IRI,
        ex("version-1"),
    );
    insert(
        &mut multiple_versions,
        series,
        OWL_VERSION_IRI,
        ex("version-2"),
    );
    assert!(matches!(
        checked(multiple_versions),
        Err(CompileError::Validation(ValidationError::IllFormed(reason)))
            if reason.contains("multiple owl:versionIRI")
    ));

    let left = ex("left");
    let right = ex("right");
    let mut incompatible = Dataset::new();
    insert(
        &mut incompatible,
        left.clone(),
        OWL_INCOMPATIBLE_WITH,
        right.clone(),
    );
    insert(
        &mut incompatible,
        right,
        OWL_VERSION_IRI,
        ex("right-version"),
    );
    assert!(matches!(
        checked(incompatible),
        Err(CompileError::Validation(ValidationError::IllFormed(reason)))
            if reason.contains("owl:incompatibleWith")
    ));
}

#[test]
fn imported_version_iri_must_have_one_series_owner() {
    let requested = ex("version");
    let mut root = Dataset::new();
    insert(&mut root, ex("root"), OWL_IMPORTS, requested.clone());
    let mut imported = Dataset::new();
    insert(
        &mut imported,
        ex("series-a"),
        OWL_VERSION_IRI,
        requested.clone(),
    );
    insert(
        &mut imported,
        ex("series-b"),
        OWL_VERSION_IRI,
        requested.clone(),
    );
    let imported = snapshot(imported);
    let resolver = move |_requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Ok(Some(imported.clone()))
    };

    assert!(matches!(
        checked_with(root, &ValidationOptions::default(), &resolver),
        Err(CompileError::Validation(ValidationError::IllFormed(reason)))
            if reason.contains("multiple shapes graphs")
    ));
}

#[test]
fn incompatibility_matches_the_other_graph_version_in_either_direction() {
    for reverse in [false, true] {
        let left = ex(&format!("left-{reverse}"));
        let right = ex(&format!("right-{reverse}"));
        let right_version = ex(&format!("right-{reverse}-v1"));
        let mut root = Dataset::new();
        insert(&mut root, ex("root"), OWL_IMPORTS, left.clone());
        insert(&mut root, ex("root"), OWL_IMPORTS, right_version.clone());
        let mut left_graph = Dataset::new();
        if reverse {
            insert(
                &mut left_graph,
                left.clone(),
                OWL_VERSION_IRI,
                ex(&format!("left-{reverse}-v1")),
            );
        } else {
            insert(
                &mut left_graph,
                left.clone(),
                OWL_INCOMPATIBLE_WITH,
                right_version.clone(),
            );
        }
        let mut right_graph = Dataset::new();
        insert(
            &mut right_graph,
            right.clone(),
            OWL_VERSION_IRI,
            right_version.clone(),
        );
        if reverse {
            insert(
                &mut right_graph,
                right,
                OWL_INCOMPATIBLE_WITH,
                ex(&format!("left-{reverse}-v1")),
            );
        }
        let left_graph = snapshot(left_graph);
        let right_graph = snapshot(right_graph);
        let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
            Ok(if requested == &left {
                Some(left_graph.clone())
            } else if requested == &right_version {
                Some(right_graph.clone())
            } else {
                None
            })
        };

        assert!(matches!(
            checked_with(root, &ValidationOptions::default(), &resolver),
            Err(CompileError::Validation(ValidationError::IllFormed(reason)))
                if reason.contains("owl:incompatibleWith")
        ));
    }
}

#[test]
fn imported_graph_only_follows_imports_owned_by_its_series_or_requested_iri() {
    let first = ex("first");
    let unrelated = ex("unrelated");
    let ignored = ex("ignored");
    let mut root = Dataset::new();
    insert(&mut root, ex("root"), OWL_IMPORTS, first.clone());
    let mut first_graph = Dataset::new();
    insert(&mut first_graph, unrelated, OWL_IMPORTS, ignored);
    let first_graph = snapshot(first_graph);
    let calls = RefCell::new(Vec::new());
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        calls.borrow_mut().push(requested.clone());
        Ok((requested == &first).then(|| first_graph.clone()))
    };

    checked_with(root, &ValidationOptions::default(), &resolver).unwrap();
    assert_eq!(calls.into_inner(), vec![first]);
}

#[test]
fn nested_imports_report_unresolved_targets_and_enforce_depth() {
    let first = ex("first");
    let second = ex("second");
    let mut root = Dataset::new();
    insert(&mut root, ex("root"), OWL_IMPORTS, first.clone());
    let mut first_graph = Dataset::new();
    insert(&mut first_graph, first.clone(), OWL_IMPORTS, second.clone());
    let first_graph = snapshot(first_graph);
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Ok((requested == &first).then(|| first_graph.clone()))
    };

    assert!(matches!(
        checked_with(
            root.clone(),
            &ValidationOptions::default(),
            &resolver,
        ),
        Err(CompileError::UnresolvedImport { iri }) if iri == second
    ));

    let mut limited = ValidationOptions::default();
    limited.limits.max_recursion_depth = 1;
    assert!(matches!(
        checked_with(root, &limited, &resolver),
        Err(CompileError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::RecursionDepth,
            limit: 1,
        }))
    ));
}
