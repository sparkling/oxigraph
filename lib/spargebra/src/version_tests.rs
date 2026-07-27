use crate::{SparqlParser, SparqlVersion};

#[test]
fn explicit_version_configuration_is_retained() {
    let parsed = SparqlParser::new()
        .with_version(SparqlVersion::V1_1)
        .parse_query_with_metadata("ASK {}")
        .unwrap();
    assert_eq!(parsed.declared_version(), None);
    assert_eq!(parsed.effective_version(), SparqlVersion::V1_1);
}

#[test]
fn unavailable_version_is_rejected() {
    if !cfg!(feature = "sparql-12") {
        SparqlParser::new()
            .with_version(SparqlVersion::V1_2)
            .parse_query("ASK {}")
            .unwrap_err();
        SparqlParser::new()
            .parse_query("VERSION \"1.1\" ASK {}")
            .unwrap_err();
    }
}

#[test]
fn typed_literals_cannot_use_datatypes_that_require_language_components() {
    SparqlParser::new()
        .parse_query(concat!(
            "SELECT * WHERE { BIND(\"hello\"^^",
            "<http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> AS ?value) }",
        ))
        .unwrap_err();
    #[cfg(feature = "sparql-12")]
    SparqlParser::new()
        .parse_query(concat!(
            "SELECT * WHERE { BIND(\"hello\"^^",
            "<http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString> AS ?value) }",
        ))
        .unwrap_err();
}

#[cfg(feature = "sparql-12")]
#[test]
fn declared_versions_are_retained_and_enforced() {
    let basic = SparqlParser::new()
        .parse_query_with_metadata(
            "VERSION \"1.2-basic\" SELECT (\"hello\"@en--ltr AS ?value) WHERE {}",
        )
        .unwrap();
    assert_eq!(basic.declared_version(), Some(SparqlVersion::V1_2Basic));
    assert_eq!(basic.effective_version(), SparqlVersion::V1_2Basic);

    let triple_term = concat!(
        "BIND(<<( <http://example.com/s> <http://example.com/p> ",
        "<http://example.com/o> )>> AS ?triple)"
    );
    SparqlParser::new()
        .parse_query_with_metadata(&format!("VERSION \"1.2-basic\" ASK {{ {triple_term} }}"))
        .unwrap_err();
    SparqlParser::new()
        .parse_query_with_metadata(&format!("VERSION \"1.2\" ASK {{ {triple_term} }}"))
        .unwrap();
    SparqlParser::new()
        .parse_query_with_metadata(&format!("VERSION \"1.1\" ASK {{ {triple_term} }}"))
        .unwrap_err();
}

#[cfg(feature = "sparql-12")]
#[test]
fn declaration_overrides_the_configured_fallback() {
    let parsed = SparqlParser::new()
        .with_version(SparqlVersion::V1_2)
        .parse_query_with_metadata("VERSION \"1.1\" ASK {}")
        .unwrap();
    assert_eq!(parsed.declared_version(), Some(SparqlVersion::V1_1));
    assert_eq!(parsed.effective_version(), SparqlVersion::V1_1);
}

#[cfg(feature = "sparql-12")]
#[test]
fn repeated_version_declarations_use_the_strongest_requirement() {
    let parsed = SparqlParser::new()
        .parse_query_with_metadata("VERSION \"1.2\" VERSION \"1.2-basic\" VERSION \"1.1\" ASK {}")
        .unwrap();
    assert_eq!(parsed.declared_version(), Some(SparqlVersion::V1_2));
    assert_eq!(parsed.effective_version(), SparqlVersion::V1_2);
}

#[cfg(feature = "sparql-12")]
#[test]
fn update_version_metadata_is_retained() {
    let parsed = SparqlParser::new()
        .parse_update_with_metadata("VERSION \"1.1\" CLEAR ALL")
        .unwrap();
    assert_eq!(parsed.declared_version(), Some(SparqlVersion::V1_1));
    assert_eq!(parsed.effective_version(), SparqlVersion::V1_1);
    let repeated = SparqlParser::new()
        .parse_update_with_metadata("VERSION \"1.1\" VERSION \"1.2\" CLEAR ALL; CLEAR DEFAULT")
        .unwrap();
    assert_eq!(repeated.declared_version(), Some(SparqlVersion::V1_2));
    assert_eq!(repeated.effective_version(), SparqlVersion::V1_2);
}

#[cfg(feature = "sparql-12")]
#[test]
fn invalid_rdf_12_update_data_returns_an_error_instead_of_panicking() {
    SparqlParser::new()
        .parse_update(concat!(
            "VERSION \"1.2\" INSERT DATA { ",
            "<<( <http://example.com/s> <http://example.com/p> ",
            "<http://example.com/o> )>> <http://example.com/source> ",
            "<http://example.com/test> }",
        ))
        .unwrap_err();
}
