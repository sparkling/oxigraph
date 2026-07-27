use super::*;

#[test]
fn variable_service_uses_each_bound_endpoint() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json",
        JSON_LITERAL,
    )])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?service ?remote WHERE {{
                 VALUES ?service {{ <{}> }}
                 SERVICE ?service {{ ?s ?p ?remote }}
               }}",
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].get("service"),
        Some(&NamedNode::new(endpoint.iri().to_owned())?.into())
    );
    assert_eq!(rows[0].get("remote"), Some(&Literal::from("remote").into()));
    assert_service_request(&endpoint.finish()?[0]);
    Ok(())
}

#[test]
fn variable_service_invalid_names_follow_silent_semantics() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    for value in ["UNDEF", "\"not-an-iri\""] {
        let plain = select(
            SparqlEvaluator::new().without_default_http_service_handler(),
            &format!(
                "SELECT * WHERE {{
                   VALUES ?service {{ {value} }}
                   SERVICE ?service {{ ?s ?p ?o }}
                 }}"
            ),
        );
        if plain.is_ok() {
            return Err(io::Error::other("invalid variable SERVICE name was accepted").into());
        }

        let silent = select(
            SparqlEvaluator::new().without_default_http_service_handler(),
            &format!(
                "SELECT ?input WHERE {{
                   VALUES (?input ?service) {{ (1 {value}) }}
                   SERVICE SILENT ?service {{ ?s ?p ?o }}
                 }}"
            ),
        )?;
        assert_eq!(silent.len(), 1);
        assert_eq!(silent[0].get("input"), Some(&Literal::from(1).into()));
    }
    Ok(())
}

#[test]
fn blank_nodes_are_scoped_per_service_response_document() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok("application/sparql-results+json", JSON_BNODE),
        ResponseSpec::ok("application/sparql-results+json", JSON_BNODE),
    ])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?call ?node WHERE {{
                 VALUES (?service ?call) {{ (<{0}> 1) (<{0}> 2) }}
                 SERVICE ?service {{ ?s ?p ?node }}
               }} ORDER BY ?call",
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 2);
    assert_ne!(rows[0].get("node"), rows[1].get("node"));
    let requests = endpoint.finish()?;
    assert_eq!(requests.len(), 2);
    requests.iter().for_each(assert_service_request);
    Ok(())
}
