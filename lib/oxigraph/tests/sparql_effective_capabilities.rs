#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests assert effective remote capability reporting"
)]

use oxigraph::model::{NamedNode, OxString, Variable};
#[cfg(feature = "http-client")]
use oxigraph::sparql::EgressPolicy;
use oxigraph::sparql::{DefaultServiceHandler, QuerySolutionIter, ServiceHandler, SparqlEvaluator};
use oxiri::Iri;
use spargebra::algebra::QueryExpression;
use std::convert::Infallible;
#[cfg(feature = "http-client")]
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

struct EmptyDefaultServiceHandler;

impl DefaultServiceHandler for EmptyDefaultServiceHandler {
    type Error = Infallible;

    fn handle(
        &self,
        _service_name: &NamedNode,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = Arc::from([]);
        Ok(QuerySolutionIter::new(variables, []))
    }
}

struct EmptyNamedServiceHandler;

impl ServiceHandler for EmptyNamedServiceHandler {
    type Error = Infallible;

    fn handle(
        &self,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = Arc::from([]);
        Ok(QuerySolutionIter::new(variables, []))
    }
}

fn effective_remote_capabilities(evaluator: &SparqlEvaluator) -> (bool, bool) {
    let capabilities = evaluator.effective_capabilities();
    (
        capabilities.default_service_handler(),
        capabilities.remote_load(),
    )
}

#[cfg(feature = "http-client")]
fn policy_with(origin_ip: Ipv4Addr, allowed_ip: Ipv4Addr) -> EgressPolicy {
    EgressPolicy::deny_all()
        .allow_origin(&format!("http://{origin_ip}:8080"))
        .expect("the literal-IP test origin is valid")
        .allow_ip(IpAddr::V4(allowed_ip))
}

#[test]
fn explicit_default_handler_is_basic_federation_without_remote_load() {
    let evaluator = SparqlEvaluator::new();
    #[cfg(feature = "http-client")]
    let evaluator = evaluator.with_egress_policy(EgressPolicy::deny_all());
    let evaluator = evaluator.with_default_service_handler(EmptyDefaultServiceHandler);
    assert_eq!(effective_remote_capabilities(&evaluator), (true, false));
}

#[test]
fn named_only_handler_is_not_basic_federation() {
    let evaluator = SparqlEvaluator::new();
    #[cfg(feature = "http-client")]
    let evaluator = evaluator
        .with_egress_policy(EgressPolicy::deny_all())
        .without_default_http_service_handler();
    let evaluator = evaluator.with_service_handler(
        NamedNode::new_unchecked("http://example.test/named-service"),
        EmptyNamedServiceHandler,
    );
    assert_eq!(effective_remote_capabilities(&evaluator), (false, false));
}

#[cfg(feature = "http-client")]
#[test]
fn effective_capabilities_follow_egress_admission_and_http_handler_state() {
    assert_eq!(
        effective_remote_capabilities(&SparqlEvaluator::new()),
        (true, true)
    );

    let matching = SparqlEvaluator::new().with_egress_policy(policy_with(
        Ipv4Addr::new(127, 0, 0, 1),
        Ipv4Addr::new(127, 0, 0, 1),
    ));
    assert_eq!(effective_remote_capabilities(&matching), (true, true));

    let mismatched = SparqlEvaluator::new().with_egress_policy(policy_with(
        Ipv4Addr::new(127, 0, 0, 1),
        Ipv4Addr::new(127, 0, 0, 2),
    ));
    assert_eq!(effective_remote_capabilities(&mismatched), (false, false));

    let load_only = SparqlEvaluator::new()
        .with_egress_policy(policy_with(
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(127, 0, 0, 1),
        ))
        .without_default_http_service_handler();
    assert_eq!(effective_remote_capabilities(&load_only), (false, true));
}

#[cfg(feature = "http-client")]
#[test]
fn https_only_policy_requires_a_compiled_tls_transport() {
    let evaluator = SparqlEvaluator::new().with_egress_policy(
        EgressPolicy::deny_all()
            .allow_origin("https://127.0.0.1:8443")
            .expect("the literal-IP HTTPS test origin is valid")
            .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)),
    );
    let expected = cfg!(any(
        feature = "http-client-native-tls",
        feature = "http-client-rustls-native",
        feature = "http-client-rustls-webpki"
    ));
    assert_eq!(
        effective_remote_capabilities(&evaluator),
        (expected, expected)
    );
}

#[cfg(not(feature = "http-client"))]
#[test]
fn build_without_http_has_no_builtin_remote_capabilities() {
    assert_eq!(
        effective_remote_capabilities(&SparqlEvaluator::new()),
        (false, false)
    );
}
