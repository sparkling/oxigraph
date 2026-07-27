#![cfg(test)]

use spargebra::SparqlParser;

#[test]
fn empty_negated_property_set_is_valid() {
    SparqlParser::new()
        .parse_query("ASK { <urn:s> !() <urn:o> }")
        .unwrap();
}

#[test]
fn incomplete_negated_property_set_is_invalid() {
    SparqlParser::new()
        .parse_query("ASK { <urn:s> ! <urn:o> }")
        .unwrap_err();
}

#[test]
fn a_prefix_cannot_be_declared_twice_in_one_query() {
    let error = SparqlParser::new()
        .parse_query("PREFIX ex: <urn:first:> PREFIX ex: <urn:second:> ASK {}")
        .unwrap_err();
    assert!(error.message().contains("declared more than once"));
}

#[test]
fn a_query_prefix_may_override_a_parser_configured_prefix() {
    let query = SparqlParser::new()
        .with_prefix("ex", "urn:configured:")
        .unwrap()
        .parse_query("PREFIX ex: <urn:query:> ASK { ex:s ex:p ex:o }")
        .unwrap();
    assert!(query.to_string().contains("<urn:query:s>"));
}

#[test]
fn an_earlier_select_alias_is_visible_in_a_grouped_projection() {
    SparqlParser::new()
        .parse_query(
            "SELECT (?g AS ?a) (?a AS ?b) (COUNT(*) AS ?count)
             WHERE { VALUES ?g { 1 } }
             GROUP BY ?g",
        )
        .unwrap();
}

#[test]
fn a_forward_select_alias_is_not_visible_in_a_grouped_projection() {
    for query in [
        "SELECT (?a AS ?b) (?g AS ?a) (COUNT(*) AS ?count)
         WHERE { VALUES ?g { 1 } }
         GROUP BY ?g",
        "SELECT (?count + 1 AS ?plus) (COUNT(*) AS ?count)
         WHERE {}",
    ] {
        SparqlParser::new().parse_query(query).unwrap_err();
    }
}

#[test]
fn an_aggregate_alias_cannot_reuse_an_input_or_group_variable() {
    for query in [
        "SELECT (COUNT(*) AS ?g) WHERE { VALUES ?g { 1 } }",
        "SELECT (COUNT(*) AS ?g) WHERE {} GROUP BY (1 AS ?g)",
    ] {
        SparqlParser::new().parse_query(query).unwrap_err();
    }
}

#[test]
fn all_select_expression_forms_enforce_grouped_variable_scope() {
    for expression in [
        "BOUND(?u)",
        "COALESCE(?g, ?u)",
        "(?g || ?u)",
        "(?g && ?u)",
        "(?g IN (?u))",
        "IF(?g, ?g, ?u)",
    ] {
        let query = format!(
            "SELECT ({expression} AS ?result) (COUNT(*) AS ?count)
             WHERE {{ VALUES ?g {{ true }} }}
             GROUP BY ?g"
        );
        let error = SparqlParser::new().parse_query(&query).unwrap_err();
        assert!(
            error.message().contains("unbound"),
            "unexpected error for {expression}: {error}"
        );
    }
}
