use oxrdf::{
    Dataset, GraphName, NamedNode, Quad,
    vocab::{rdf, rdfs},
};

const RDF_NS: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_CONTAINER_PREFIX: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#_";

const AXIOMS: &[(&str, &str, &str)] = &[
    ("rdf:type", "rdfs:domain", "rdfs:Resource"),
    ("rdf:reifies", "rdfs:domain", "rdfs:Resource"),
    ("rdfs:domain", "rdfs:domain", "rdf:Property"),
    ("rdfs:range", "rdfs:domain", "rdf:Property"),
    ("rdfs:subPropertyOf", "rdfs:domain", "rdf:Property"),
    ("rdfs:subClassOf", "rdfs:domain", "rdfs:Class"),
    ("rdf:subject", "rdfs:domain", "rdf:Statement"),
    ("rdf:predicate", "rdfs:domain", "rdf:Statement"),
    ("rdf:object", "rdfs:domain", "rdf:Statement"),
    ("rdfs:member", "rdfs:domain", "rdfs:Resource"),
    ("rdf:first", "rdfs:domain", "rdf:List"),
    ("rdf:rest", "rdfs:domain", "rdf:List"),
    ("rdfs:seeAlso", "rdfs:domain", "rdfs:Resource"),
    ("rdfs:isDefinedBy", "rdfs:domain", "rdfs:Resource"),
    ("rdfs:comment", "rdfs:domain", "rdfs:Resource"),
    ("rdfs:label", "rdfs:domain", "rdfs:Resource"),
    ("rdf:value", "rdfs:domain", "rdfs:Resource"),
    ("rdf:type", "rdfs:range", "rdfs:Class"),
    ("rdf:reifies", "rdfs:range", "rdfs:Proposition"),
    ("rdfs:domain", "rdfs:range", "rdfs:Class"),
    ("rdfs:range", "rdfs:range", "rdfs:Class"),
    ("rdfs:subPropertyOf", "rdfs:range", "rdf:Property"),
    ("rdfs:subClassOf", "rdfs:range", "rdfs:Class"),
    ("rdf:subject", "rdfs:range", "rdfs:Resource"),
    ("rdf:predicate", "rdfs:range", "rdfs:Resource"),
    ("rdf:object", "rdfs:range", "rdfs:Resource"),
    ("rdfs:member", "rdfs:range", "rdfs:Resource"),
    ("rdf:first", "rdfs:range", "rdfs:Resource"),
    ("rdf:rest", "rdfs:range", "rdf:List"),
    ("rdfs:seeAlso", "rdfs:range", "rdfs:Resource"),
    ("rdfs:isDefinedBy", "rdfs:range", "rdfs:Resource"),
    ("rdfs:comment", "rdfs:range", "rdfs:Literal"),
    ("rdfs:label", "rdfs:range", "rdfs:Literal"),
    ("rdf:value", "rdfs:range", "rdfs:Resource"),
    ("rdf:Alt", "rdfs:subClassOf", "rdfs:Container"),
    ("rdf:Bag", "rdfs:subClassOf", "rdfs:Container"),
    ("rdf:Seq", "rdfs:subClassOf", "rdfs:Container"),
    (
        "rdfs:ContainerMembershipProperty",
        "rdfs:subClassOf",
        "rdf:Property",
    ),
    ("rdfs:Proposition", "rdfs:subClassOf", "rdfs:Resource"),
    ("rdfs:isDefinedBy", "rdfs:subPropertyOf", "rdfs:seeAlso"),
    ("rdfs:Datatype", "rdfs:subClassOf", "rdfs:Class"),
];

pub(crate) fn insert_static_axioms(dataset: &mut Dataset, graph: &GraphName) {
    for &(subject, predicate, object) in AXIOMS {
        dataset.insert(Quad::new(
            expand(subject),
            expand(predicate),
            expand(object),
            graph.clone(),
        ));
    }
    for property in [
        rdf::TYPE,
        rdf::SUBJECT,
        rdf::PREDICATE,
        rdf::OBJECT,
        rdf::FIRST,
        rdf::REST,
        rdf::VALUE,
        rdf::REIFIES,
    ] {
        dataset.insert(Quad::new(property, rdf::TYPE, rdf::PROPERTY, graph.clone()));
    }
    dataset.insert(Quad::new(rdf::NIL, rdf::TYPE, rdf::LIST, graph.clone()));
}

pub(crate) fn insert_container_axioms(
    dataset: &mut Dataset,
    graph: &GraphName,
    inclusive_limit: usize,
) {
    for index in 1..=inclusive_limit {
        let property = named(format!("{RDF_NS}_{index}"));
        insert_container_property_axioms(dataset, graph, &property);
    }
}

pub(crate) fn insert_container_property_axioms(
    dataset: &mut Dataset,
    graph: &GraphName,
    property: &NamedNode,
) {
    for (predicate, object) in [
        (rdf::TYPE, rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
        (rdfs::DOMAIN, rdfs::RESOURCE),
        (rdfs::RANGE, rdfs::RESOURCE),
    ] {
        dataset.insert(Quad::new(
            property.clone(),
            predicate,
            object,
            graph.clone(),
        ));
    }
}

pub(crate) fn is_container_membership_property(node: &NamedNode) -> bool {
    let Some(index) = node.as_str().strip_prefix(RDF_CONTAINER_PREFIX) else {
        return false;
    };
    !index.is_empty() && !index.starts_with('0') && index.bytes().all(|byte| byte.is_ascii_digit())
}

fn expand(compact: &str) -> NamedNode {
    let iri = if let Some(local) = compact.strip_prefix("rdf:") {
        format!("{RDF_NS}{local}")
    } else if let Some(local) = compact.strip_prefix("rdfs:") {
        format!("http://www.w3.org/2000/01/rdf-schema#{local}")
    } else {
        compact.to_owned()
    };
    named(iri)
}

#[expect(
    clippy::expect_used,
    reason = "all built-in W3C vocabulary IRIs are compile-time constants"
)]
fn named(iri: impl Into<String>) -> NamedNode {
    NamedNode::new(iri.into()).expect("built-in W3C IRI")
}
