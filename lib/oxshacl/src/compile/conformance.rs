use crate::control::ValidationError;
use crate::model::GraphSnapshot;
use oxrdf::Term;

const SH_ENTAILMENT: &str = "http://www.w3.org/ns/shacl#entailment";

pub(super) fn reject_unsupported_entailment(source: &GraphSnapshot) -> Result<(), ValidationError> {
    if let Some(triple) = source
        .triples()
        .find(|triple| triple.predicate.as_str() == SH_ENTAILMENT)
    {
        let Term::NamedNode(regime) = triple.object else {
            return Err(ValidationError::IllFormed(
                "sh:entailment values must be IRIs".to_owned(),
            ));
        };
        return Err(ValidationError::UnsupportedFeature(format!(
            "SHACL entailment regime <{}> is not available",
            regime.as_str()
        )));
    }
    Ok(())
}
