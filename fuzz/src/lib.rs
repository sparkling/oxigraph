use oxrdf::graph::CanonicalizationAlgorithm;
use oxrdf::{Graph, Quad, RdfVersion, Term, Triple};
use oxttl::TriGSerializer;

pub mod result_format;

pub fn count_triple_blank_nodes(triple: &Triple) -> usize {
    usize::from(triple.subject.is_blank_node())
        + match &triple.object {
            Term::BlankNode(_) => 1,
            Term::Triple(t) => count_triple_blank_nodes(t.as_ref()),
            _ => 0,
        }
}

pub fn count_quad_blank_nodes(quad: &Quad) -> usize {
    usize::from(quad.subject.is_blank_node())
        + match &quad.object {
            Term::BlankNode(_) => 1,
            Term::Triple(t) => count_triple_blank_nodes(t.as_ref()),
            _ => 0,
        }
        + usize::from(quad.graph_name.is_blank_node())
}

pub fn serialize_trig_quads(
    quads: &[Quad],
    prefixes: impl IntoIterator<Item = (String, String)>,
    base_iri: Option<String>,
) -> Vec<u8> {
    // The parser accepts RDF 1.2 terms, so its round-trip serializer must do so too.
    // RDF 1.2 is a superset of the RDF 1.1 output accepted by this target.
    let mut serializer = TriGSerializer::new().with_rdf_version(RdfVersion::V1_2);
    for (prefix_name, prefix_iri) in prefixes {
        serializer = serializer.with_prefix(&prefix_name, &prefix_iri).unwrap();
    }
    if let Some(base_iri) = base_iri {
        serializer = serializer.with_base_iri(&base_iri).unwrap();
    }
    let mut serializer = serializer.for_writer(Vec::new());
    for quad in quads {
        serializer.serialize_quad(quad).unwrap();
    }
    serializer.finish().unwrap()
}

/// Compares two RDF graphs modulo blank-node renaming within the fuzz target's
/// existing four-blank-node canonicalization budget.
///
/// `None` means that both sides preserve triple and blank-node occurrence
/// counts but exceed the bounded canonicalization budget.
pub fn bounded_triple_graphs_are_isomorphic(left: &[Triple], right: &[Triple]) -> Option<bool> {
    if left.len() != right.len() {
        return Some(false);
    }
    let left_blank_nodes = left.iter().map(count_triple_blank_nodes).sum::<usize>();
    let right_blank_nodes = right.iter().map(count_triple_blank_nodes).sum::<usize>();
    if left_blank_nodes != right_blank_nodes {
        return Some(false);
    }
    if left_blank_nodes > 4 {
        return None;
    }
    let mut left_graph = left.iter().cloned().collect::<Graph>();
    let mut right_graph = right.iter().cloned().collect::<Graph>();
    if left_blank_nodes > 0 {
        if let Err(error) =
            left_graph.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        {
            unreachable!("four-node comparison exceeded its trusted work budget: {error}");
        }
        if let Err(error) =
            right_graph.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        {
            unreachable!("four-node comparison exceeded its trusted work budget: {error}");
        }
    }
    Some(left_graph == right_graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxrdf::{BlankNode, NamedNode};
    use oxrdfxml::{RdfXmlParser, RdfXmlSerializer};
    use oxttl::TriGParser;

    #[test]
    fn rdf12_trig_regression_roundtrips_with_the_shared_serializer() {
        let input = include_bytes!("../regressions/trig/rdf12-triple-term.trig");
        let quads = TriGParser::new()
            .for_slice(input)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let serialized = serialize_trig_quads(&quads, Vec::new(), None);
        assert!(serialized.starts_with(b"VERSION \"1.2\"\n"));
        assert_eq!(
            TriGParser::new()
                .for_slice(&serialized)
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            quads
        );
    }

    #[test]
    fn bounded_graph_equivalence_preserves_blank_node_aliasing() {
        let predicate = NamedNode::new_unchecked("http://example.com/p");
        let left = BlankNode::new_unchecked("left");
        let renamed = BlankNode::new_unchecked("renamed");
        let split = BlankNode::new_unchecked("split");
        let expected = vec![Triple::new(left.clone(), predicate.clone(), left.clone())];
        let equivalent = vec![Triple::new(renamed.clone(), predicate.clone(), renamed)];
        let inequivalent = vec![Triple::new(
            BlankNode::new_unchecked("other"),
            predicate,
            split,
        )];

        assert_eq!(
            bounded_triple_graphs_are_isomorphic(&expected, &equivalent),
            Some(true)
        );
        assert_eq!(
            bounded_triple_graphs_are_isomorphic(&expected, &inequivalent),
            Some(false)
        );
    }

    #[test]
    fn anonymous_rdf_xml_subject_regression_roundtrips_isomorphically() {
        let input = include_bytes!("../regressions/rdf_xml/anonymous-subject.rdf");
        let triples = RdfXmlParser::new()
            .for_slice(input)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut serializer = RdfXmlSerializer::new().for_writer(Vec::new());
        for triple in &triples {
            serializer.serialize_triple(triple).unwrap();
        }
        let serialized = serializer.finish().unwrap();
        let roundtrip = RdfXmlParser::new()
            .for_slice(&serialized)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            bounded_triple_graphs_are_isomorphic(&roundtrip, &triples),
            Some(true)
        );
    }
}
