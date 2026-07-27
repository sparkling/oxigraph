use super::{ShaclcError, ShaclcLimits, ShaclcParser, parse_shaclc};
use oxrdf::{NamedNodeRef, Term};
use std::fmt::Write as _;

mod lexical;

const RDF_TYPE: NamedNodeRef<'_> =
    NamedNodeRef::new_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const OWL_IMPORTS: NamedNodeRef<'_> =
    NamedNodeRef::new_unchecked("http://www.w3.org/2002/07/owl#imports");
const SH_CLASS: NamedNodeRef<'_> = NamedNodeRef::new_unchecked("http://www.w3.org/ns/shacl#class");
const SH_DATATYPE: NamedNodeRef<'_> =
    NamedNodeRef::new_unchecked("http://www.w3.org/ns/shacl#datatype");
const SH_PATH: NamedNodeRef<'_> = NamedNodeRef::new_unchecked("http://www.w3.org/ns/shacl#path");

#[test]
fn maps_basic_shape_and_standard_prefixes() {
    let graph = parse_shaclc(
        "PREFIX ex: <http://example/> shape ex:S -> ex:C { ex:p xsd:string [1..2] . }",
        Some("urn:test:base"),
    )
    .unwrap();
    let predicates = graph
        .dataset()
        .iter()
        .map(|quad| quad.predicate.as_str().to_owned())
        .collect::<Vec<_>>();
    assert!(
        predicates
            .iter()
            .any(|value| value.ends_with("targetClass"))
    );
    assert!(predicates.iter().any(|value| value.ends_with("datatype")));
    assert!(predicates.iter().any(|value| value.ends_with("minCount")));
    assert!(predicates.iter().any(|value| value.ends_with("maxCount")));
}

#[test]
fn rejects_invalid_compact_documents() {
    for source in [
        "base <urn:test:> shape <urn:s> {}",
        "shape <urn:s> {} PREFIX ex: <urn:ex:>",
        "shape <urn:s> { <urn:p> IRI }",
        "shape missing:S {}",
        "shape <urn:s> { <urn:p> in=[1, 2] . }",
        "shape <urn:s> { datatype=xsd:string| . }",
        "shapeClass <urn:s> -> <urn:c> {}",
    ] {
        assert!(matches!(
            parse_shaclc(source, Some("urn:test:base")),
            Err(ShaclcError::Syntax { .. })
        ));
    }
    assert!(matches!(
        parse_shaclc("IMPORTS <urn:import>", None),
        Err(ShaclcError::ImportsWithoutBase)
    ));
}

#[test]
fn reserved_language_datatypes_require_language_components() {
    assert!(matches!(
        parse_shaclc(
            r#"shape <urn:s> { <urn:p> hasValue="hello"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> . }"#,
            Some("urn:test:base"),
        ),
        Err(ShaclcError::Literal(_))
    ));

    #[cfg(feature = "rdf-12")]
    assert!(matches!(
        parse_shaclc(
            r#"shape <urn:s> { <urn:p> hasValue="hello"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString> . }"#,
            Some("urn:test:base"),
        ),
        Err(ShaclcError::Literal(_))
    ));
}

#[test]
fn parser_limits_fail_closed() {
    let parser = ShaclcParser::new()
        .with_base_iri("urn:test:base")
        .unwrap()
        .with_limits(ShaclcLimits {
            max_source_bytes: 1024,
            max_tokens: 100,
            max_nesting_depth: 4,
            max_shapes: 10,
            max_list_items: 10,
            max_triples: 1,
        });
    assert!(matches!(
        parser.parse("shape <urn:s> {}"),
        Err(ShaclcError::LimitExceeded {
            kind: "mapped triples",
            ..
        })
    ));
}

#[test]
fn mapped_graph_survives_dataset_round_trip() {
    let graph = parse_shaclc(
        "PREFIX ex: <urn:ex:> shape ex:S { ex:p in=[ex:A true \"x\"@en 42] . }",
        Some("urn:test:base"),
    )
    .unwrap();
    let round_trip = oxrdf::Dataset::from_iter(graph.dataset().iter());
    assert_eq!(graph.dataset(), &round_trip);
    assert!(round_trip.iter().any(
        |quad| matches!(&quad.object, Term::Literal(literal) if literal.language() == Some("en"))
    ));
}

#[test]
fn follows_grammar_whitespace_and_lexical_count_mapping() {
    assert!(matches!(
        parse_shaclc("shape\u{00A0}<urn:s> {}", Some("urn:test:base")),
        Err(ShaclcError::Syntax { .. })
    ));

    let graph = parse_shaclc("shape <urn:s> { <urn:p> [+0..0] . }", Some("urn:test:base")).unwrap();
    let counts = graph
        .dataset()
        .iter()
        .filter(|quad| {
            matches!(
                quad.predicate.as_str(),
                "http://www.w3.org/ns/shacl#minCount" | "http://www.w3.org/ns/shacl#maxCount"
            )
        })
        .map(|quad| quad.object.to_string())
        .collect::<Vec<_>>();
    assert_eq!(counts.len(), 2);
    assert!(counts.iter().any(|value| value.starts_with("\"+0\"")));
    assert!(counts.iter().any(|value| value.starts_with("\"0\"")));
}

#[test]
fn parameter_and_node_kind_surfaces_are_exact() {
    const NODE_PARAMETERS: &[&str] = &[
        "targetNode",
        "targetObjectsOf",
        "targetSubjectsOf",
        "deactivated",
        "severity",
        "message",
        "class",
        "datatype",
        "nodeKind",
        "minExclusive",
        "minInclusive",
        "maxExclusive",
        "maxInclusive",
        "minLength",
        "maxLength",
        "pattern",
        "flags",
        "languageIn",
        "equals",
        "disjoint",
        "closed",
        "ignoredProperties",
        "hasValue",
        "in",
    ];
    const PROPERTY_PARAMETERS: &[&str] = &[
        "deactivated",
        "severity",
        "message",
        "class",
        "datatype",
        "nodeKind",
        "minExclusive",
        "minInclusive",
        "maxExclusive",
        "maxInclusive",
        "minLength",
        "maxLength",
        "pattern",
        "flags",
        "languageIn",
        "uniqueLang",
        "equals",
        "disjoint",
        "lessThan",
        "lessThanOrEquals",
        "qualifiedValueShape",
        "qualifiedMinCount",
        "qualifiedMaxCount",
        "qualifiedValueShapesDisjoint",
        "closed",
        "ignoredProperties",
        "hasValue",
        "in",
    ];

    let mut source = "PREFIX ex: <urn:ex:> shape ex:S {".to_owned();
    for parameter in NODE_PARAMETERS {
        write!(source, " {parameter}=true .").unwrap();
    }
    for (index, parameter) in PROPERTY_PARAMETERS.iter().enumerate() {
        write!(source, " <urn:p{index}> {parameter}=true .").unwrap();
    }
    source.push_str(
        " <urn:k> BlankNode IRI Literal BlankNodeOrIRI BlankNodeOrLiteral IRIOrLiteral . }",
    );
    parse_shaclc(&source, Some("urn:base:")).unwrap();

    for parameter in ["targetNode", "targetObjectsOf", "targetSubjectsOf"] {
        let source = format!("shape <urn:s> {{ <urn:p> {parameter}=<urn:value> . }}");
        assert!(
            parse_shaclc(&source, Some("urn:base:")).is_err(),
            "{parameter} is not a propertyParam"
        );
    }
    for parameter in [
        "uniqueLang",
        "lessThan",
        "lessThanOrEquals",
        "qualifiedValueShape",
        "qualifiedMinCount",
        "qualifiedMaxCount",
        "qualifiedValueShapesDisjoint",
    ] {
        let source = format!("shape <urn:s> {{ {parameter}=true . }}");
        assert!(
            parse_shaclc(&source, Some("urn:base:")).is_err(),
            "{parameter} is not a nodeParam"
        );
    }
}

#[test]
fn prefixed_names_follow_escape_rules() {
    let graph = parse_shaclc(
        "PREFIX ex: <urn:ex:>
           PREFIX Pr\u{e9}: <urn:unicode:>
           shape ex:S {
             ex:trailing\\. .
             ex:slash\\/name .
             ex:percent%2Fname .
             Pr\u{e9}:\u{540d} .
           }",
        Some("urn:base:"),
    )
    .unwrap();
    let paths = graph
        .dataset()
        .iter()
        .filter(|quad| quad.predicate == SH_PATH)
        .filter_map(|quad| match &quad.object {
            Term::NamedNode(value) => Some(value.as_str().to_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    for expected in [
        "urn:ex:trailing.",
        "urn:ex:slash/name",
        "urn:ex:percent%2Fname",
        "urn:unicode:\u{540d}",
    ] {
        assert!(
            paths.iter().any(|path| path == expected),
            "missing path <{expected}>"
        );
    }

    for invalid in [r"ex:bad\q", "ex:.bad", "ex:bad%", "ex:bad%2G"] {
        let source = format!("PREFIX ex: <urn:ex:> shape ex:S {{ {invalid} . }}");
        assert!(matches!(
            parse_shaclc(&source, Some("urn:base:")),
            Err(ShaclcError::Syntax { .. })
        ));
    }
}

#[test]
fn property_type_uses_sparql_11_datatype_set() {
    const SPARQL_XSD_TYPES: &[&str] = &[
        "integer",
        "decimal",
        "float",
        "double",
        "string",
        "boolean",
        "dateTime",
        "nonPositiveInteger",
        "negativeInteger",
        "long",
        "int",
        "short",
        "byte",
        "nonNegativeInteger",
        "unsignedLong",
        "unsignedInt",
        "unsignedShort",
        "unsignedByte",
        "positiveInteger",
    ];
    let mut source = "PREFIX ex: <urn:ex:> shape ex:S {".to_owned();
    for (index, datatype) in SPARQL_XSD_TYPES.iter().enumerate() {
        write!(source, " ex:p{index} xsd:{datatype} .").unwrap();
    }
    source.push_str(" ex:lang rdf:langString . ex:date xsd:date .");
    source.push_str(" ex:unknown xsd:notAType . ex:html rdf:HTML . }");
    let graph = parse_shaclc(&source, Some("urn:base:")).unwrap();

    for datatype in SPARQL_XSD_TYPES
        .iter()
        .map(|local| format!("http://www.w3.org/2001/XMLSchema#{local}"))
        .chain(std::iter::once(
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString".to_owned(),
        ))
    {
        assert!(has_named_object(&graph, SH_DATATYPE, &datatype));
        assert!(!has_named_object(&graph, SH_CLASS, &datatype));
    }
    for class in [
        "http://www.w3.org/2001/XMLSchema#date",
        "http://www.w3.org/2001/XMLSchema#notAType",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML",
    ] {
        assert!(has_named_object(&graph, SH_CLASS, class));
        assert!(!has_named_object(&graph, SH_DATATYPE, class));
    }
}

#[test]
fn maps_literal_and_iri_lexical_surfaces() {
    let graph = parse_shaclc(
        r#"shape <urn:\u0053> {
            hasValue=true hasValue=false
            hasValue=+42 hasValue=-.5 hasValue=1.e2 hasValue=.1E-2
            hasValue='single' hasValue="double"
            hasValue='''long
single''' hasValue="""long
double"""
            hasValue="\t\b\n\r\f\\\"\'"
            hasValue="\u0041\U0001F600"
            hasValue="chat"@en-GB
            hasValue="typed"^^xsd:string .
        }"#,
        Some("urn:base:"),
    )
    .unwrap();
    let literals = graph
        .dataset()
        .iter()
        .filter_map(|quad| match &quad.object {
            Term::Literal(value) => Some((
                value.value().to_owned(),
                value.language().map(str::to_owned),
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(literals.iter().any(|(value, _)| value == "A\u{1f600}"));
    assert!(
        literals
            .iter()
            .any(|(_, language)| language.as_deref() == Some("en-gb"))
    );
    assert!(graph.dataset().iter().any(|quad| {
        quad.subject.as_ref()
            == oxrdf::NamedOrBlankNodeRef::NamedNode(NamedNodeRef::new_unchecked("urn:S"))
            && quad.predicate == RDF_TYPE
    }));
}

#[test]
fn directives_resolve_at_declaration_time_and_map_final_base() {
    let graph = parse_shaclc(
        "IMPORTS <before>
         BASE <next/>
         IMPORTS <after>
         PREFIX ex: <ns#>
         BASE <../final>
         shape ex:S {}",
        Some("http://example.test/root/"),
    )
    .unwrap();
    assert!(has_named_object(
        &graph,
        OWL_IMPORTS,
        "http://example.test/root/before"
    ));
    assert!(has_named_object(
        &graph,
        OWL_IMPORTS,
        "http://example.test/root/next/after"
    ));
    assert!(graph.dataset().iter().any(|quad| {
        quad.subject.as_ref()
            == oxrdf::NamedOrBlankNodeRef::NamedNode(NamedNodeRef::new_unchecked(
                "http://example.test/root/final",
            ))
            && quad.predicate == RDF_TYPE
    }));
    assert!(graph.dataset().iter().any(|quad| {
        quad.subject.as_ref()
            == oxrdf::NamedOrBlankNodeRef::NamedNode(NamedNodeRef::new_unchecked(
                "http://example.test/root/next/ns#S",
            ))
    }));
}

#[test]
fn compact_surface_excludes_expression_and_annotation_extensions() {
    for source in [
        "shape <urn:s> { expression=<urn:e> . }",
        "shape <urn:s> { annotation=<urn:a> . }",
        "shape <urn:s> { <urn:p> expression=<urn:e> . }",
        "shape <urn:s> { <urn:p> annotation=<urn:a> . }",
        "shape <urn:s> { <urn:p> [ <urn:expression> ] . }",
    ] {
        assert!(matches!(
            parse_shaclc(source, Some("urn:base:")),
            Err(ShaclcError::Syntax { .. })
        ));
    }
}

#[test]
fn rejects_grammar_and_lexer_near_misses() {
    for source in [
        "Base <urn:base:>",
        "PREFIX ex <urn:ex:>",
        "shape <urn:s> -> {}",
        "shape <urn:s> { targetNode=<urn:x> }",
        "shape <urn:s> { <urn:p> [1.2] . }",
        "shape <urn:s> { <urn:p> [1..] . }",
        "shape <urn:s> { <urn:p> ^^xsd:string . }",
        "shape <urn:s> { <urn:p> @ex . }",
        "shape <urn:s> { <urn:p> hasValue=1e . }",
        "shape <urn:s> { <urn:p> hasValue=\"bad\\q\" . }",
        "shape <urn:s> { <urn:p> hasValue=\"unterminated . }",
        "shape <urn:s> { <urn:p> hasValue=<bad space> . }",
        "shape <urn:s> { (<urn:p>|) . }",
        "shape <urn:s> { <urn:p>++ . }",
    ] {
        assert!(parse_shaclc(source, Some("urn:base:")).is_err(), "{source}");
    }
}

fn has_named_object(
    graph: &crate::GraphSnapshot,
    predicate: NamedNodeRef<'_>,
    object: &str,
) -> bool {
    graph.dataset().iter().any(|quad| {
        quad.predicate == predicate
            && matches!(&quad.object, Term::NamedNode(value) if value.as_str() == object)
    })
}
