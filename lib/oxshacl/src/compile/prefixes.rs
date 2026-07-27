use super::rdf::{RdfView, as_literal, sh, to_shape_id};
use crate::control::ValidationError;
use crate::model::ShapeId;
use oxrdf::Term;
use spargebra::SparqlParser;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const OWL_IMPORTS: &str = "http://www.w3.org/2002/07/owl#imports";
const OWL_VERSION_IRI: &str = "http://www.w3.org/2002/07/owl#versionIRI";
const SHAPES_GRAPH: &str = "http://www.w3.org/ns/shacl#ShapesGraph";
const RULES_GRAPH: &str = "http://www.w3.org/ns/shacl#RulesGraph";
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const XSD_ANY_URI: &str = "http://www.w3.org/2001/XMLSchema#anyURI";

#[expect(
    clippy::multiple_inherent_impl,
    reason = "feature compilers extend the shared bounded RDF view"
)]
impl RdfView<'_> {
    pub(super) fn apply_sparql_prefixes(
        &self,
        owner: &ShapeId,
        query: &str,
    ) -> Result<String, ValidationError> {
        let explicit = self.objects(owner, &sh("prefixes"));
        let (roots, follow_imports) = if explicit.is_empty() {
            (self.global_prefix_roots(), false)
        } else {
            (
                explicit
                    .into_iter()
                    .map(|term| {
                        to_shape_id(&term).ok_or_else(|| {
                            ValidationError::IllFormed(
                                "sh:prefixes values must be IRIs or blank nodes".to_owned(),
                            )
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                true,
            )
        };
        let declarations = self.prefix_declarations(roots, follow_imports)?;
        let uppercase = query.to_ascii_uppercase();
        let mut prologue = String::new();
        for (prefix, namespace) in declarations {
            if uppercase.contains(&format!("PREFIX {}:", prefix.to_ascii_uppercase())) {
                continue;
            }
            prologue.push_str("PREFIX ");
            prologue.push_str(&prefix);
            prologue.push_str(": <");
            prologue.push_str(&namespace);
            prologue.push_str(">\n");
        }
        prologue.push_str(query);
        Ok(prologue)
    }

    fn global_prefix_roots(&self) -> Vec<ShapeId> {
        self.graph()
            .triples()
            .filter(|triple| {
                triple.predicate.as_str() == RDF_TYPE
                    && matches!(
                        &triple.object,
                        Term::NamedNode(node) if self.is_shapes_graph_class(node.as_str())
                    )
            })
            .map(|triple| triple.subject)
            .collect()
    }

    fn is_shapes_graph_class(&self, class: &str) -> bool {
        let mut active = vec![class.to_owned()];
        let mut seen = BTreeSet::new();
        while let Some(class) = active.pop() {
            if matches!(class.as_str(), SHAPES_GRAPH | RULES_GRAPH) {
                return true;
            }
            if !seen.insert(class.clone()) {
                continue;
            }
            for triple in self.graph().triples().filter(|triple| {
                triple.predicate.as_str() == RDFS_SUBCLASS
                    && triple.subject.to_string() == format!("<{class}>")
            }) {
                if let Term::NamedNode(parent) = triple.object {
                    active.push(parent.as_str().to_owned());
                }
            }
        }
        false
    }

    fn prefix_declarations(
        &self,
        roots: Vec<ShapeId>,
        follow_imports: bool,
    ) -> Result<BTreeMap<String, String>, ValidationError> {
        let mut queue = VecDeque::from(roots);
        let mut seen = BTreeSet::new();
        let mut declarations = BTreeMap::new();
        while let Some(root) = queue.pop_front() {
            if !seen.insert(root.to_string()) {
                continue;
            }
            if follow_imports {
                for import_owner in self.import_owners(&root) {
                    for imported in self.objects(&import_owner, OWL_IMPORTS) {
                        if let Some(imported) = to_shape_id(&imported) {
                            queue.push_back(imported);
                        }
                    }
                }
            }
            for declaration in self.objects(&root, &sh("declare")) {
                let declaration = to_shape_id(&declaration).ok_or_else(|| {
                    ValidationError::IllFormed(
                        "sh:declare values must be IRIs or blank nodes".to_owned(),
                    )
                })?;
                let prefix = as_literal(
                    self.exactly_one(&declaration, &sh("prefix"))?,
                    &sh("prefix"),
                )?;
                let namespace = as_literal(
                    self.exactly_one(&declaration, &sh("namespace"))?,
                    &sh("namespace"),
                )?;
                if prefix.datatype().as_str() != XSD_STRING {
                    return Err(ValidationError::IllFormed(
                        "sh:prefix values must have datatype xsd:string".to_owned(),
                    ));
                }
                if !matches!(namespace.datatype().as_str(), XSD_STRING | XSD_ANY_URI) {
                    return Err(ValidationError::IllFormed(
                        "sh:namespace values must have datatype xsd:string or xsd:anyURI"
                            .to_owned(),
                    ));
                }
                validate_prefix(prefix.value(), namespace.value())?;
                if let Some(previous) =
                    declarations.insert(prefix.value().to_owned(), namespace.value().to_owned())
                    && previous != namespace.value()
                {
                    return Err(ValidationError::IllFormed(format!(
                        "prefix `{}` maps to multiple namespaces",
                        prefix.value()
                    )));
                }
            }
        }
        Ok(declarations)
    }

    fn import_owners(&self, root: &ShapeId) -> Vec<ShapeId> {
        let mut owners = vec![root.clone()];
        let root = root.to_string();
        owners.extend(self.graph().triples().filter_map(|triple| {
            (triple.predicate.as_str() == OWL_VERSION_IRI && triple.object.to_string() == root)
                .then_some(triple.subject)
        }));
        owners
    }
}

fn validate_prefix(prefix: &str, namespace: &str) -> Result<(), ValidationError> {
    if namespace.contains(['<', '>', '\r', '\n']) {
        return Err(ValidationError::IllFormed(
            "unsafe SHACL-SPARQL prefix declaration".to_owned(),
        ));
    }
    let declaration = format!("PREFIX {prefix}: <{namespace}>\nASK {{ }}");
    SparqlParser::new()
        .parse_query(&declaration)
        .map_err(|error| ValidationError::IllFormed(format!("invalid prefix mapping: {error}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::GraphSnapshot;
    use oxrdf::{Dataset, GraphName, Literal, NamedNode, Quad};

    fn node(value: &str) -> NamedNode {
        NamedNode::new_unchecked(value.to_owned())
    }

    fn insert_declaration(
        dataset: &mut Dataset,
        root: &str,
        declaration: &str,
        prefix: Literal,
        namespace: Literal,
    ) {
        dataset.insert(Quad::new(
            node(root),
            node(&sh("declare")),
            node(declaration),
            GraphName::DefaultGraph,
        ));
        dataset.insert(Quad::new(
            node(declaration),
            node(&sh("prefix")),
            prefix,
            GraphName::DefaultGraph,
        ));
        dataset.insert(Quad::new(
            node(declaration),
            node(&sh("namespace")),
            namespace,
            GraphName::DefaultGraph,
        ));
    }

    #[test]
    fn explicit_prefix_roots_do_not_union_global_roots() {
        let mut dataset = Dataset::new();
        dataset.insert(Quad::new(
            node("urn:global"),
            node(RDF_TYPE),
            node(SHAPES_GRAPH),
            GraphName::DefaultGraph,
        ));
        dataset.insert(Quad::new(
            node("urn:owner"),
            node(&sh("prefixes")),
            node("urn:explicit"),
            GraphName::DefaultGraph,
        ));
        insert_declaration(
            &mut dataset,
            "urn:global",
            "urn:global-declaration",
            Literal::from("global"),
            Literal::from("urn:global:"),
        );
        insert_declaration(
            &mut dataset,
            "urn:explicit",
            "urn:explicit-declaration",
            Literal::from("local"),
            Literal::from("urn:local:"),
        );
        let graph = GraphSnapshot::default_graph(dataset);
        let query = RdfView::new(&graph)
            .apply_sparql_prefixes(
                &node("urn:owner").into(),
                "SELECT ?this WHERE { ?this local:p ?value }",
            )
            .unwrap();
        assert!(query.contains("PREFIX local:"));
        assert!(!query.contains("PREFIX global:"));
    }

    #[test]
    fn follows_inverse_version_iri_before_imports() {
        let mut dataset = Dataset::new();
        dataset.insert(Quad::new(
            node("urn:owner"),
            node(&sh("prefixes")),
            node("urn:version"),
            GraphName::DefaultGraph,
        ));
        dataset.insert(Quad::new(
            node("urn:ontology"),
            node(OWL_VERSION_IRI),
            node("urn:version"),
            GraphName::DefaultGraph,
        ));
        dataset.insert(Quad::new(
            node("urn:ontology"),
            node(OWL_IMPORTS),
            node("urn:imported"),
            GraphName::DefaultGraph,
        ));
        insert_declaration(
            &mut dataset,
            "urn:imported",
            "urn:declaration",
            Literal::from("imported"),
            Literal::from("urn:imported:"),
        );
        let graph = GraphSnapshot::default_graph(dataset);
        let query = RdfView::new(&graph)
            .apply_sparql_prefixes(
                &node("urn:owner").into(),
                "SELECT ?this WHERE { ?this imported:p ?value }",
            )
            .unwrap();
        assert!(query.contains("PREFIX imported: <urn:imported:>"));
    }

    #[test]
    fn rejects_conflicting_and_mistyped_declarations() {
        let mut dataset = Dataset::new();
        dataset.insert(Quad::new(
            node("urn:owner"),
            node(&sh("prefixes")),
            node("urn:root"),
            GraphName::DefaultGraph,
        ));
        insert_declaration(
            &mut dataset,
            "urn:root",
            "urn:first",
            Literal::from("ex"),
            Literal::from("urn:first:"),
        );
        insert_declaration(
            &mut dataset,
            "urn:root",
            "urn:second",
            Literal::from("ex"),
            Literal::from("urn:second:"),
        );
        let graph = GraphSnapshot::default_graph(dataset);
        let error = RdfView::new(&graph)
            .apply_sparql_prefixes(&node("urn:owner").into(), "SELECT ?this WHERE { }")
            .unwrap_err();
        assert!(matches!(error, ValidationError::IllFormed(_)));

        let mut dataset = Dataset::new();
        dataset.insert(Quad::new(
            node("urn:owner"),
            node(&sh("prefixes")),
            node("urn:root"),
            GraphName::DefaultGraph,
        ));
        insert_declaration(
            &mut dataset,
            "urn:root",
            "urn:declaration",
            Literal::new_language_tagged_literal_unchecked("ex", "en"),
            Literal::from("urn:example:"),
        );
        let graph = GraphSnapshot::default_graph(dataset);
        RdfView::new(&graph)
            .apply_sparql_prefixes(&node("urn:owner").into(), "SELECT ?this WHERE { }")
            .unwrap_err();
    }
}
