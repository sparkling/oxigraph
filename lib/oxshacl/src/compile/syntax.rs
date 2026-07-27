use crate::control::ValidationError;
use oxrdf::Literal;
use std::collections::BTreeSet;

const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const RDF_DIR_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
const RDF_HTML: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML";

pub(super) fn require_xsd_string(literal: &Literal, property: &str) -> Result<(), ValidationError> {
    if literal.datatype().as_str() != XSD_STRING {
        return Err(ValidationError::IllFormed(format!(
            "{property} must have datatype xsd:string"
        )));
    }
    Ok(())
}

pub(super) fn validate_messages(messages: &[Literal]) -> Result<(), ValidationError> {
    let mut languages = BTreeSet::new();
    let mut plain_strings = 0_usize;
    for message in messages {
        match message.datatype().as_str() {
            XSD_STRING => plain_strings += 1,
            RDF_LANG_STRING | RDF_DIR_LANG_STRING => {
                let language = message.language().ok_or_else(|| {
                    ValidationError::IllFormed(
                        "language-tagged sh:message has no language tag".to_owned(),
                    )
                })?;
                if !languages.insert(language.to_ascii_lowercase()) {
                    return Err(ValidationError::IllFormed(format!(
                        "multiple sh:message values use language tag `{language}`"
                    )));
                }
            }
            RDF_HTML => {}
            _ => {
                return Err(ValidationError::IllFormed(
                    "sh:message has an unsupported datatype".to_owned(),
                ));
            }
        }
    }
    if plain_strings > 1 {
        return Err(ValidationError::IllFormed(
            "multiple xsd:string sh:message values are not allowed".to_owned(),
        ));
    }
    Ok(())
}
