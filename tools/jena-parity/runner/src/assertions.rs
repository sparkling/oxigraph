use crate::model::{Assertion, AssertionTarget, Classification, Observation, Scenario};
use serde_json::Value;

pub fn verify(
    scenario: &Scenario,
    jena: &Observation,
    oxigraph: &Observation,
) -> Result<(), String> {
    if jena.id != scenario.id || oxigraph.id != scenario.id {
        return Err(format!("observation id mismatch for {}", scenario.id));
    }
    verify_classification(scenario, jena, oxigraph)?;
    let jena_value = serde_json::to_value(jena)
        .map_err(|error| format!("cannot encode Jena observation: {error}"))?;
    let oxigraph_value = serde_json::to_value(oxigraph)
        .map_err(|error| format!("cannot encode Oxigraph observation: {error}"))?;
    for assertion in &scenario.assertions {
        match assertion.target {
            AssertionTarget::Both => {
                verify_one(scenario, assertion, "jena", &jena_value)?;
                verify_one(scenario, assertion, "oxigraph", &oxigraph_value)?;
            }
            AssertionTarget::Jena => {
                verify_one(scenario, assertion, "jena", &jena_value)?;
            }
            AssertionTarget::Oxigraph => {
                verify_one(scenario, assertion, "oxigraph", &oxigraph_value)?;
            }
        }
    }
    Ok(())
}

fn verify_classification(
    scenario: &Scenario,
    jena: &Observation,
    oxigraph: &Observation,
) -> Result<(), String> {
    let same = jena.comparable() == oxigraph.comparable();
    let valid = match scenario.classification {
        Classification::Agreement => same && jena.status != "unsupported",
        Classification::W3cOverridesJena => !same && oxigraph.status == "success",
        Classification::W3cPermittedDivergence => {
            !same && jena.status == "success" && oxigraph.status == "success"
        }
        Classification::JenaExtension => !same && jena.status == "success",
        Classification::Unsupported => {
            jena.status == "unsupported" || oxigraph.status == "unsupported"
        }
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "classification {:?} contradicted by outcomes for {}\nJena: {jena:?}\nOxigraph: {oxigraph:?}",
            scenario.classification, scenario.id,
        ))
    }
}

fn verify_one(
    scenario: &Scenario,
    assertion: &Assertion,
    engine: &str,
    observation: &Value,
) -> Result<(), String> {
    let actual = observation.pointer(&assertion.pointer).ok_or_else(|| {
        format!(
            "{} assertion path {} is absent for {engine}",
            scenario.id, assertion.pointer
        )
    })?;
    if actual == &assertion.equals {
        Ok(())
    } else {
        Err(format!(
            "{} assertion {} for {engine}: expected {}, got {}",
            scenario.id, assertion.pointer, assertion.equals, actual
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scenario(classification: Classification) -> Scenario {
        Scenario {
            id: "test-case".to_owned(),
            domain: "sparql".to_owned(),
            operation: "sparql-ask".to_owned(),
            classification,
            normative_basis: "https://www.w3.org/TR/sparql12-query/".to_owned(),
            reviewed: true,
            syntax: None,
            output_syntax: None,
            data: None,
            query: Some("ASK {}".to_owned()),
            update: None,
            shapes: None,
            reasoner: None,
            ordered: false,
            assertions: vec![Assertion {
                target: AssertionTarget::Both,
                pointer: "/value".to_owned(),
                equals: json!(true),
            }],
        }
    }

    #[test]
    fn accepts_matching_agreement() -> Result<(), String> {
        let jena = Observation::success("test-case", "boolean", json!(true));
        let oxigraph = jena.clone();
        verify(&scenario(Classification::Agreement), &jena, &oxigraph)
    }

    #[test]
    fn accepts_distinct_successful_w3c_permitted_outcomes() -> Result<(), String> {
        let scenario = scenario(Classification::W3cPermittedDivergence);
        let jena = Observation::success("test-case", "boolean", json!(true));
        let oxigraph = Observation::success("test-case", "boolean", json!(false));
        verify_classification(&scenario, &jena, &oxigraph)
    }
}
