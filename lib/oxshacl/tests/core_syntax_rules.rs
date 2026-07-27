#![expect(clippy::tests_outside_test_module, reason = "integration boundary")]

#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, GraphSnapshot, ProfileSet, ShapesGraph, ValidationError, ValidationOptions,
    validate,
};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
#[cfg(feature = "rdf-12")]
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
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

fn checked_error(dataset: Dataset) -> String {
    match ShapesGraph::compile_checked(
        &snapshot(dataset),
        ProfileSet::default(),
        &ValidationOptions::default(),
    ) {
        Err(CompileError::Validation(ValidationError::IllFormed(reason))) => reason,
        _ => "graph was not rejected as ill-formed".to_owned(),
    }
}

#[test]
fn outer_reference_and_list_rules_report_the_pinned_ids() {
    for (local, rule) in [
        ("targetWhere", "targetWhere-node"),
        ("memberShape", "memberShape-node"),
        ("not", "not-node"),
        ("node", "node-node"),
        ("property", "property-node"),
        ("someValue", "someValue-shape"),
        ("qualifiedValueShape", "qualifiedValueShape-node"),
        ("reifierShape", "reifierShape-node"),
    ] {
        let mut dataset = Dataset::new();
        let owner = iri("http://example.com/owner");
        if matches!(local, "qualifiedValueShape" | "reifierShape") {
            insert(
                &mut dataset,
                owner.clone(),
                sh("path"),
                iri("http://example.com/p"),
            );
        }
        insert(&mut dataset, owner, sh(local), Literal::from("not-a-shape"));
        assert!(
            checked_error(dataset).contains(&format!("[{rule}]")),
            "{local} did not report {rule}"
        );
    }

    for local in ["and", "or", "xone"] {
        let mut bad_head = Dataset::new();
        insert(
            &mut bad_head,
            iri("http://example.com/owner"),
            sh(local),
            Literal::from("not-a-list"),
        );
        assert!(checked_error(bad_head).contains(&format!("[{local}-node]")));

        let mut bad_member = Dataset::new();
        let head = BlankNode::new_unchecked("head");
        insert(
            &mut bad_member,
            iri("http://example.com/owner"),
            sh(local),
            head.clone(),
        );
        insert(
            &mut bad_member,
            head.clone(),
            iri(RDF_FIRST),
            Literal::from("not-a-shape"),
        );
        insert(&mut bad_member, head, iri(RDF_REST), iri(RDF_NIL));
        assert!(checked_error(bad_member).contains(&format!("[{local}-members-node]")));
    }
}

#[test]
fn path_entry_points_and_operator_variants_report_the_pinned_ids() {
    let mut path_literal = Dataset::new();
    insert(
        &mut path_literal,
        iri("http://example.com/shape"),
        sh("path"),
        Literal::from("not-a-path"),
    );
    assert!(checked_error(path_literal).contains("[path-node]"));

    for local in [
        "equals",
        "disjoint",
        "subsetOf",
        "lessThan",
        "lessThanOrEquals",
    ] {
        let mut dataset = Dataset::new();
        let shape = iri("http://example.com/shape");
        insert(
            &mut dataset,
            shape.clone(),
            sh("path"),
            iri("http://example.com/p"),
        );
        insert(&mut dataset, shape, sh(local), Literal::from("not-a-path"));
        assert!(checked_error(dataset).contains(&format!("[{local}-nodeKind]")));
    }

    for (operator, rule) in [
        ("alternativePath", "path-alternative"),
        ("inversePath", "path-inverse"),
        ("zeroOrMorePath", "path-zero-or-more"),
        ("oneOrMorePath", "path-one-or-more"),
        ("zeroOrOnePath", "path-zero-or-one"),
    ] {
        let mut dataset = Dataset::new();
        let path = BlankNode::new_unchecked("path");
        insert(
            &mut dataset,
            iri("http://example.com/shape"),
            sh("path"),
            path.clone(),
        );
        insert(
            &mut dataset,
            path.clone(),
            sh(operator),
            iri("http://example.com/p"),
        );
        insert(
            &mut dataset,
            path,
            iri(RDF_TYPE),
            iri("http://example.com/Extra"),
        );
        assert!(checked_error(dataset).contains(&format!("[{rule}]")));
    }
}

#[test]
fn graph_types_and_property_value_expressions_report_distinct_ids() {
    for (class, rule) in [("ShapesGraph", "ShapesGraph"), ("DataGraph", "DataGraph")] {
        let mut dataset = Dataset::new();
        insert(
            &mut dataset,
            BlankNode::new_unchecked("graph"),
            iri(RDF_TYPE),
            sh(class),
        );
        assert!(checked_error(dataset).contains(&format!("[{rule}]")));
    }

    for (local, rule) in [
        ("values", "path-values"),
        ("defaultValue", "path-defaultValue"),
    ] {
        let mut dataset = Dataset::new();
        let shape = iri("http://example.com/shape");
        insert(
            &mut dataset,
            shape.clone(),
            sh("path"),
            iri("http://example.com/p"),
        );
        insert(
            &mut dataset,
            shape,
            sh(local),
            BlankNode::new_unchecked("expression"),
        );
        assert!(checked_error(dataset).contains(&format!("[{rule}]")));
    }
}

#[test]
fn xpath_quote_flag_is_accepted_and_evaluated_literally() {
    let focus = iri("http://example.com/focus");
    let property = iri("http://example.com/p");
    let mut shapes = Dataset::new();
    let shape = iri("http://example.com/shape");
    insert(&mut shapes, shape.clone(), sh("path"), property.clone());
    insert(&mut shapes, shape.clone(), sh("targetNode"), focus.clone());
    insert(
        &mut shapes,
        shape.clone(),
        sh("pattern"),
        Literal::from("."),
    );
    insert(&mut shapes, shape, sh("flags"), Literal::from("q"));
    let compiled = ShapesGraph::compile_checked(
        &snapshot(shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();

    let mut matching = Dataset::new();
    insert(
        &mut matching,
        focus.clone(),
        property.clone(),
        Literal::from("."),
    );
    assert!(
        validate(
            &compiled,
            &snapshot(matching),
            &ValidationOptions::default()
        )
        .unwrap()
        .conforms()
    );

    let mut non_matching = Dataset::new();
    insert(&mut non_matching, focus, property, Literal::from("x"));
    assert!(
        !validate(
            &compiled,
            &snapshot(non_matching),
            &ValidationOptions::default()
        )
        .unwrap()
        .conforms()
    );
}

#[test]
fn list_valued_root_class_and_rdf_nil_iri_values_compile_correctly() {
    let focus = iri("http://example.com/Child");
    let mut shapes = Dataset::new();
    let shape = iri("http://example.com/shape");
    let head = BlankNode::new_unchecked("head");
    let tail = BlankNode::new_unchecked("tail");
    insert(&mut shapes, shape.clone(), sh("targetNode"), focus.clone());
    insert(&mut shapes, shape.clone(), sh("rootClass"), head.clone());
    insert(
        &mut shapes,
        head.clone(),
        iri(RDF_FIRST),
        iri("http://example.com/Other"),
    );
    insert(&mut shapes, head, iri(RDF_REST), tail.clone());
    insert(
        &mut shapes,
        tail.clone(),
        iri(RDF_FIRST),
        iri("http://example.com/Root"),
    );
    insert(&mut shapes, tail, iri(RDF_REST), iri(RDF_NIL));
    insert(&mut shapes, shape, sh("uniqueValuesFor"), iri(RDF_NIL));
    let compiled = ShapesGraph::compile_checked(
        &snapshot(shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();

    let mut data = Dataset::new();
    insert(
        &mut data,
        focus,
        iri(RDFS_SUBCLASS),
        iri("http://example.com/Root"),
    );
    assert!(
        validate(&compiled, &snapshot(data), &ValidationOptions::default())
            .unwrap()
            .conforms()
    );

    let mut nil_root_shapes = Dataset::new();
    let nil_shape = iri("http://example.com/nil-root-shape");
    let nil_focus = iri("http://example.com/NilChild");
    insert(
        &mut nil_root_shapes,
        nil_shape.clone(),
        sh("targetNode"),
        nil_focus.clone(),
    );
    insert(
        &mut nil_root_shapes,
        nil_shape,
        sh("rootClass"),
        iri(RDF_NIL),
    );
    let compiled = ShapesGraph::compile_checked(
        &snapshot(nil_root_shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
    let mut nil_root_data = Dataset::new();
    insert(
        &mut nil_root_data,
        nil_focus,
        iri(RDFS_SUBCLASS),
        iri(RDF_NIL),
    );
    assert!(
        validate(
            &compiled,
            &snapshot(nil_root_data),
            &ValidationOptions::default()
        )
        .unwrap()
        .conforms()
    );
}

#[test]
fn message_datatype_is_normative_but_duplicates_are_advisory() {
    let mut invalid = Dataset::new();
    let invalid_shape = iri("http://example.com/invalid-shape");
    insert(
        &mut invalid,
        invalid_shape.clone(),
        sh("targetNode"),
        invalid_shape.clone(),
    );
    insert(
        &mut invalid,
        invalid_shape,
        sh("message"),
        iri("http://example.com/not-a-literal"),
    );
    assert!(checked_error(invalid).contains("[message-datatype]"));

    let mut shapes = Dataset::new();
    let shape = iri("http://example.com/shape");
    insert(&mut shapes, shape.clone(), sh("targetNode"), shape.clone());
    insert(
        &mut shapes,
        shape.clone(),
        sh("message"),
        Literal::from("first"),
    );
    insert(&mut shapes, shape, sh("message"), Literal::from("second"));
    ShapesGraph::compile_checked(
        &snapshot(shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
}

#[test]
fn annotations_on_unrelated_nodes_do_not_create_shapes() {
    let mut shapes = Dataset::new();
    insert(
        &mut shapes,
        iri("http://example.com/metadata"),
        sh("message"),
        iri("http://example.com/not-a-literal"),
    );
    ShapesGraph::compile_checked(
        &snapshot(shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
}

#[test]
fn deactivation_accepts_both_xsd_boolean_lexical_forms() {
    let datatype = iri("http://www.w3.org/2001/XMLSchema#boolean");
    for lexical in ["0", "1", "false", "true"] {
        let mut shapes = Dataset::new();
        let shape = iri("http://example.com/shape");
        insert(&mut shapes, shape.clone(), sh("targetNode"), shape.clone());
        insert(
            &mut shapes,
            shape,
            sh("deactivated"),
            Literal::new_typed_literal(lexical, datatype.clone()),
        );
        ShapesGraph::compile_checked(
            &snapshot(shapes),
            ProfileSet::default(),
            &ValidationOptions::default(),
        )
        .unwrap();
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn constraint_reifier_annotations_are_counted_across_component_statements() {
    for (annotation, first, second, rule) in [
        (
            "severity",
            Term::from(iri("http://example.com/Warning")),
            Term::from(iri("http://example.com/Info")),
            "severity-reifier-maxCount",
        ),
        (
            "message",
            Term::from(Literal::from("first")),
            Term::from(Literal::from("second")),
            "message-reifier-maxCount",
        ),
    ] {
        let mut dataset = Dataset::new();
        let shape = iri("http://example.com/shape");
        let pattern = Triple::new(shape.clone(), sh("pattern"), Literal::from("x"));
        let flags = Triple::new(shape.clone(), sh("flags"), Literal::from("i"));
        insert(
            &mut dataset,
            pattern.subject.clone(),
            pattern.predicate.clone(),
            pattern.object.clone(),
        );
        insert(
            &mut dataset,
            flags.subject.clone(),
            flags.predicate.clone(),
            flags.object.clone(),
        );
        for (id, statement, value) in [
            ("first", pattern.clone(), first),
            ("second", flags.clone(), second),
        ] {
            let reifier = BlankNode::new_unchecked(id);
            insert(
                &mut dataset,
                reifier.clone(),
                iri(RDF_REIFIES),
                Term::from(statement),
            );
            insert(&mut dataset, reifier, sh(annotation), value);
        }
        assert!(checked_error(dataset).contains(&format!("[{rule}]")));
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn reifier_severity_node_kind_has_its_own_error_branch() {
    let mut dataset = Dataset::new();
    let shape = iri("http://example.com/shape");
    let statement = Triple::new(shape, sh("class"), iri("http://example.com/Class"));
    insert(
        &mut dataset,
        statement.subject.clone(),
        statement.predicate.clone(),
        statement.object.clone(),
    );
    let reifier = BlankNode::new_unchecked("reifier");
    insert(
        &mut dataset,
        reifier.clone(),
        iri(RDF_REIFIES),
        Term::from(statement),
    );
    insert(
        &mut dataset,
        reifier,
        sh("severity"),
        Literal::from("not-an-iri"),
    );
    assert!(checked_error(dataset).contains("[severity-nodeKind]"));
}
