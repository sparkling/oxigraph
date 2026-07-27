use crate::control::ValidationError;
use oxrdf::Term;

pub(super) fn single_argument(
    values: Vec<Term>,
    name: &str,
) -> Result<Option<Term>, ValidationError> {
    match values.as_slice() {
        [] => Ok(None),
        [_] => Ok(values.into_iter().next()),
        _ => Err(ValidationError::IllFormed(format!(
            "conformsToShape {name} argument produced more than one node"
        ))),
    }
}
