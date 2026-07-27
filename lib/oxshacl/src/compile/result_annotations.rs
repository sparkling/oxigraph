use super::custom::parameter_name;
use super::rdf::{RdfView, as_literal, as_named, sh, to_shape_id};
use crate::control::ValidationError;
use crate::model::ShapeId;
use crate::sparql::ResultAnnotation;
use oxrdf::Variable;

pub(super) fn compile(
    view: &RdfView<'_>,
    owner: &ShapeId,
) -> Result<Vec<ResultAnnotation>, ValidationError> {
    view.objects(owner, &sh("resultAnnotation"))
        .into_iter()
        .map(|term| {
            let annotation = to_shape_id(&term).ok_or_else(|| {
                ValidationError::IllFormed(
                    "sh:resultAnnotation values must be IRIs or blank nodes".to_owned(),
                )
            })?;
            let property = as_named(
                view.exactly_one(&annotation, &sh("annotationProperty"))?,
                &sh("annotationProperty"),
            )?;
            let variable = view
                .optional_one(&annotation, &sh("annotationVarName"))?
                .map(|term| {
                    let literal = as_literal(term, &sh("annotationVarName"))?;
                    super::syntax::require_xsd_string(&literal, "sh:annotationVarName")?;
                    Variable::new(literal.value().to_owned())
                        .map(|variable| variable.as_str().to_owned())
                        .map_err(|error| ValidationError::IllFormed(error.to_string()))
                })
                .transpose()?
                .or_else(|| {
                    let local = parameter_name(property.as_str()).ok()?;
                    Variable::new(local.to_owned())
                        .ok()
                        .map(|value| value.as_str().to_owned())
                });
            Ok(ResultAnnotation::new(
                property,
                variable,
                view.objects(&annotation, &sh("annotationValue")),
            ))
        })
        .collect()
}
