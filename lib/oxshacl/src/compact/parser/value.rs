use super::Parser;
use crate::compact::ShaclcError;
use crate::compact::lexer::TokenKind;
use crate::compact::model::Value;
use oxrdf::{Literal, NamedNode, Term};

const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_DECIMAL: &str = "http://www.w3.org/2001/XMLSchema#decimal";
const XSD_DOUBLE: &str = "http://www.w3.org/2001/XMLSchema#double";

impl Parser<'_> {
    pub(super) fn value(&mut self, depth: usize) -> Result<Value, ShaclcError> {
        self.check_depth(depth)?;
        if self.take(&TokenKind::LeftBracket) {
            let mut values = Vec::new();
            while !self.take(&TokenKind::RightBracket) {
                if self.at_end() {
                    return Err(self.expected("`]`"));
                }
                values.push(self.iri_or_literal()?);
                self.check_list(values.len())?;
            }
            Ok(Value::List(values))
        } else {
            Ok(Value::Term(self.iri_or_literal()?))
        }
    }

    fn iri_or_literal(&mut self) -> Result<Term, ShaclcError> {
        match self.peek_kind() {
            TokenKind::IriRef(_) => {
                let iri = self.iri()?;
                Ok(NamedNode::new_unchecked(iri).into())
            }
            TokenKind::Bare(value) if value.contains(':') => {
                let iri = self.iri()?;
                Ok(NamedNode::new_unchecked(iri).into())
            }
            TokenKind::Bare(value) if value == "true" || value == "false" => {
                let value = value == "true";
                self.next_kind();
                Ok(Literal::from(value).into())
            }
            TokenKind::String(_) => {
                let TokenKind::String(lexical) = self.next_kind() else {
                    unreachable!();
                };
                self.rdf_literal(lexical)
            }
            TokenKind::Number(_) => {
                let TokenKind::Number(lexical) = self.next_kind() else {
                    unreachable!();
                };
                numeric_literal(lexical)
            }
            _ => Err(self.expected("IRI or literal")),
        }
    }

    fn rdf_literal(&mut self, lexical: String) -> Result<Term, ShaclcError> {
        if let TokenKind::Lang(language) = self.peek_kind() {
            let language = language.clone();
            self.next_kind();
            return Literal::new_language_tagged_literal(lexical, language)
                .map(Term::from)
                .map_err(|error| ShaclcError::Literal(error.to_string()));
        }
        if self.take(&TokenKind::Datatype) {
            let datatype = self.iri()?;
            return Literal::try_new_typed_literal(lexical, NamedNode::new_unchecked(datatype))
                .map(Term::from)
                .map_err(|error| ShaclcError::Literal(error.to_string()));
        }
        Ok(Literal::new_simple_literal(lexical).into())
    }
}

fn numeric_literal(lexical: String) -> Result<Term, ShaclcError> {
    let datatype = if is_double(&lexical) {
        XSD_DOUBLE
    } else if is_decimal(&lexical) {
        XSD_DECIMAL
    } else if is_integer(&lexical) {
        XSD_INTEGER
    } else {
        return Err(ShaclcError::Literal(format!(
            "invalid numeric literal `{lexical}`"
        )));
    };
    Ok(Literal::new_typed_literal(lexical, NamedNode::new_unchecked(datatype)).into())
}

fn is_integer(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    !value.is_empty() && value.bytes().all(|value| value.is_ascii_digit())
}

fn is_decimal(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    let Some((integer, fraction)) = value.split_once('.') else {
        return false;
    };
    !fraction.is_empty()
        && integer.bytes().all(|value| value.is_ascii_digit())
        && fraction.bytes().all(|value| value.is_ascii_digit())
}

fn is_double(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    let Some((mantissa, exponent)) = value.split_once(['e', 'E']) else {
        return false;
    };
    let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
    !exponent.is_empty()
        && exponent.bytes().all(|value| value.is_ascii_digit())
        && (is_integer(mantissa)
            || is_decimal(mantissa)
            || mantissa
                .strip_suffix('.')
                .is_some_and(|value| !value.is_empty() && is_integer(value)))
}
