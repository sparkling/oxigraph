#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public checked-compilation boundary"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, GraphSnapshot, ProfileSet, ShapesGraph, ValidationError, ValidationOptions,
    validate,
};
use std::io;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const OWL_IMPORTS: &str = "http://www.w3.org/2002/07/owl#imports";
const OWL_VERSION_IRI: &str = "http://www.w3.org/2002/07/owl#versionIRI";
const OWL_INCOMPATIBLE_WITH: &str = "http://www.w3.org/2002/07/owl#incompatibleWith";
const SH: &str = "http://www.w3.org/ns/shacl#";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn sh(local: &str) -> NamedNode {
    iri(&format!("{SH}{local}"))
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: impl Into<NamedNode>,
    object: impl Into<Term>,
) {
    dataset.insert(Quad::new(
        subject,
        predicate,
        object,
        GraphName::DefaultGraph,
    ));
}

fn snapshot(dataset: Dataset) -> GraphSnapshot {
    GraphSnapshot::default_graph(dataset)
}

fn node_shape() -> GraphSnapshot {
    let mut dataset = Dataset::new();
    insert(
        &mut dataset,
        iri("http://example.com/shape"),
        iri(RDF_TYPE),
        sh("NodeShape"),
    );
    snapshot(dataset)
}

fn compile_checked(graph: &GraphSnapshot) -> Result<ShapesGraph, CompileError> {
    ShapesGraph::compile_checked(graph, ProfileSet::default(), &ValidationOptions::default())
}

#[test]
fn checked_core_rejects_blank_target_node_but_legacy_compile_remains_compatible() {
    // The pinned approved core/node/nodeKind-002.ttl uses `sh:targetNode _:bob`,
    // while targetNode-nodeKind plus IRIExpression/LiteralExpression permit
    // only IRIs and literals in Core. Keep that bounded suite exception on the
    // legacy path; the certifying path follows the pinned draft text.
    let mut dataset = node_shape().dataset().clone();
    insert(
        &mut dataset,
        iri("http://example.com/shape"),
        sh("targetNode"),
        BlankNode::new_unchecked("bob"),
    );
    let graph = snapshot(dataset);

    ShapesGraph::compile(&graph, ProfileSet::default(), &ValidationOptions::default()).unwrap();
    let error = compile_checked(&graph).unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("Core node expressions must be IRIs or literals")
    ));
}

#[test]
fn checked_compile_never_dereferences_imports_implicitly() {
    let import = iri("http://example.com/shapes/version/1");
    let mut dataset = Dataset::new();
    insert(
        &mut dataset,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        import.clone(),
    );

    assert!(matches!(
        compile_checked(&snapshot(dataset)),
        Err(CompileError::UnresolvedImport { iri }) if iri == import
    ));
}

#[test]
fn resolver_failure_is_distinct_from_an_ill_formed_shapes_graph() {
    let import = iri("http://example.com/shapes/version/1");
    let mut dataset = Dataset::new();
    insert(
        &mut dataset,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        import.clone(),
    );
    let resolver = |_iri: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Err(io::Error::other("resolver unavailable"))
    };

    let error = ShapesGraph::compile_checked_with_imports(
        &snapshot(dataset),
        ProfileSet::default(),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::ImportResolution { iri, .. } if iri == import
    ));
}

#[test]
fn import_closure_follows_version_iris_breaks_cycles_and_standardizes_blanks() {
    let root = iri("http://example.com/root");
    let series_a = iri("http://example.com/a");
    let version_a = iri("http://example.com/a/1");
    let series_b = iri("http://example.com/b");
    let version_b = iri("http://example.com/b/1");
    let mut root_graph = Dataset::new();
    insert(&mut root_graph, root, iri(OWL_IMPORTS), version_a.clone());
    insert(
        &mut root_graph,
        BlankNode::new_unchecked("oxshacl_import_1_0"),
        sh("path"),
        iri("http://example.com/root-path"),
    );

    let mut graph_a = Dataset::new();
    insert(
        &mut graph_a,
        series_a.clone(),
        iri(OWL_VERSION_IRI),
        version_a.clone(),
    );
    insert(&mut graph_a, series_a, iri(OWL_IMPORTS), version_b.clone());
    insert(
        &mut graph_a,
        BlankNode::new_unchecked("shared"),
        sh("path"),
        iri("http://example.com/p"),
    );

    let mut graph_b = Dataset::new();
    insert(
        &mut graph_b,
        series_b.clone(),
        iri(OWL_VERSION_IRI),
        version_b.clone(),
    );
    insert(&mut graph_b, series_b, iri(OWL_IMPORTS), version_a.clone());
    insert(
        &mut graph_b,
        BlankNode::new_unchecked("shared"),
        sh("path"),
        iri("http://example.com/q"),
    );
    let graph_a = snapshot(graph_a);
    let graph_b = snapshot(graph_b);
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Ok(match requested {
            iri if iri == &version_a => Some(graph_a.clone()),
            iri if iri == &version_b => Some(graph_b.clone()),
            _ => None,
        })
    };

    let compiled = ShapesGraph::compile_checked_with_imports(
        &snapshot(root_graph),
        ProfileSet::default(),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap();
    assert!(compiled.well_formedness_checked());
    assert_eq!(compiled.shapes().count(), 3);
    let mut ids = compiled
        .shapes()
        .map(|shape| shape.id.to_string())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 3);
}

#[test]
fn import_closure_rejects_two_versions_of_one_series() {
    let series = iri("http://example.com/shapes");
    let version_1 = iri("http://example.com/shapes/1");
    let version_2 = iri("http://example.com/shapes/2");
    let mut root = Dataset::new();
    insert(
        &mut root,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        version_1.clone(),
    );
    insert(
        &mut root,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        version_2.clone(),
    );
    let version_graph = |version: NamedNode| {
        let mut dataset = Dataset::new();
        insert(&mut dataset, series.clone(), iri(OWL_VERSION_IRI), version);
        snapshot(dataset)
    };
    let graph_1 = version_graph(version_1.clone());
    let graph_2 = version_graph(version_2.clone());
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Ok(if requested == &version_1 {
            Some(graph_1.clone())
        } else if requested == &version_2 {
            Some(graph_2.clone())
        } else {
            None
        })
    };

    let error = ShapesGraph::compile_checked_with_imports(
        &snapshot(root),
        ProfileSet::default(),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("incompatible versions")
    ));
}

#[test]
fn import_closure_rejects_owl_incompatible_with() {
    let a = iri("http://example.com/a");
    let b = iri("http://example.com/b");
    let mut root = Dataset::new();
    insert(
        &mut root,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        a.clone(),
    );
    insert(
        &mut root,
        iri("http://example.com/root"),
        iri(OWL_IMPORTS),
        b.clone(),
    );
    let mut graph_a = Dataset::new();
    insert(
        &mut graph_a,
        a.clone(),
        iri(OWL_INCOMPATIBLE_WITH),
        b.clone(),
    );
    let graph_a = snapshot(graph_a);
    let graph_b = snapshot(Dataset::new());
    let resolver = |requested: &NamedNode| -> Result<Option<GraphSnapshot>, io::Error> {
        Ok(if requested == &a {
            Some(graph_a.clone())
        } else if requested == &b {
            Some(graph_b.clone())
        } else {
            None
        })
    };

    let error = ShapesGraph::compile_checked_with_imports(
        &snapshot(root),
        ProfileSet::default(),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("owl:incompatibleWith")
    ));
}

#[test]
fn checked_compile_rejects_ambiguous_operator_paths() {
    let shape = iri("http://example.com/shape");
    let path = BlankNode::new_unchecked("path");
    let mut dataset = Dataset::new();
    insert(&mut dataset, shape, sh("path"), path.clone());
    insert(
        &mut dataset,
        path.clone(),
        sh("inversePath"),
        iri("http://example.com/p"),
    );
    insert(
        &mut dataset,
        path,
        sh("zeroOrMorePath"),
        iri("http://example.com/q"),
    );

    let error = compile_checked(&snapshot(dataset)).unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("[path-metarule]")
    ));
}

#[test]
fn checked_compile_rejects_single_member_sequence_paths() {
    let list = BlankNode::new_unchecked("list");
    let mut dataset = Dataset::new();
    insert(
        &mut dataset,
        iri("http://example.com/shape"),
        sh("path"),
        list.clone(),
    );
    insert(
        &mut dataset,
        list.clone(),
        iri(RDF_FIRST),
        iri("http://example.com/p"),
    );
    insert(&mut dataset, list, iri(RDF_REST), iri(RDF_NIL));

    let error = compile_checked(&snapshot(dataset)).unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("[path-sequence]")
    ));
}

#[test]
fn checked_compile_rejects_parameter_scope_and_datatype_errors() {
    let mut node_dataset = node_shape().dataset().clone();
    insert(
        &mut node_dataset,
        iri("http://example.com/shape"),
        sh("minCount"),
        Literal::from(1),
    );
    let scope_error = compile_checked(&snapshot(node_dataset)).unwrap_err();
    assert!(matches!(
        scope_error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("[minCount-scope]")
    ));

    let mut property_dataset = Dataset::new();
    insert(
        &mut property_dataset,
        iri("http://example.com/property"),
        sh("path"),
        iri("http://example.com/p"),
    );
    insert(
        &mut property_dataset,
        iri("http://example.com/property"),
        sh("minCount"),
        Literal::from("one"),
    );
    let datatype_error = compile_checked(&snapshot(property_dataset)).unwrap_err();
    assert!(matches!(
        datatype_error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("[minCount-datatype]")
    ));

    let mut lexical_dataset = Dataset::new();
    insert(
        &mut lexical_dataset,
        iri("http://example.com/list"),
        sh("minListLength"),
        Literal::new_typed_literal(
            "not-an-integer",
            iri("http://www.w3.org/2001/XMLSchema#integer"),
        ),
    );
    let lexical_error = compile_checked(&snapshot(lexical_dataset)).unwrap_err();
    assert!(matches!(
        lexical_error,
        CompileError::Validation(ValidationError::IllFormed(reason))
            if reason.contains("[minListLength-minInclusive]")
    ));
}

#[test]
fn checked_compile_materializes_empty_shapes_reached_only_by_shape_reference() {
    let owner = iri("http://example.com/owner");
    let referenced = iri("http://example.com/referenced");
    let mut dataset = Dataset::new();
    insert(&mut dataset, owner, sh("node"), referenced.clone());

    let compiled = compile_checked(&snapshot(dataset)).unwrap();
    assert!(compiled.shape(&referenced.into()).is_some());
}

#[test]
fn well_formed_report_term_is_opt_in_and_requires_certifying_compile() {
    let source = node_shape();
    let mut options = ValidationOptions {
        report_shapes_graph_well_formed: true,
        ..ValidationOptions::default()
    };
    let unchecked = ShapesGraph::compile(&source, ProfileSet::default(), &options).unwrap();
    let unchecked_report = validate(&unchecked, &snapshot(Dataset::new()), &options).unwrap();
    assert_eq!(unchecked_report.shapes_graph_well_formed(), None);

    let checked = compile_checked(&source).unwrap();
    let checked_report = validate(&checked, &snapshot(Dataset::new()), &options).unwrap();
    assert_eq!(checked_report.shapes_graph_well_formed(), Some(true));
    assert!(checked_report.canonical().dataset().iter().any(|quad| {
        quad.predicate == sh("shapesGraphWellFormed")
            && matches!(
                &quad.object,
                Term::Literal(literal)
                    if literal.value() == "true"
                        && literal.datatype().as_str()
                            == "http://www.w3.org/2001/XMLSchema#boolean"
            )
    }));

    options.report_shapes_graph_well_formed = false;
    let omitted = validate(&checked, &snapshot(Dataset::new()), &options).unwrap();
    assert_eq!(omitted.shapes_graph_well_formed(), None);
}
