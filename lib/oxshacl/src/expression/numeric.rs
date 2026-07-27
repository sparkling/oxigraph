use crate::control::ValidationError;
use oxrdf::{Literal, NamedNode, Term};
use oxsdatatypes::Decimal;
use std::str::FromStr;

const XSD: &str = "http://www.w3.org/2001/XMLSchema#";

pub(super) fn sum_terms(values: &[Term]) -> Result<Literal, ValidationError> {
    if values.is_empty() {
        return Ok(Literal::from(0));
    }
    let literals = values
        .iter()
        .map(|term| match term {
            Term::Literal(literal) => Ok(literal),
            _ => Err(non_numeric()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let has_float = literals.iter().any(|literal| {
        matches!(
            literal.datatype().as_str(),
            "http://www.w3.org/2001/XMLSchema#float" | "http://www.w3.org/2001/XMLSchema#double"
        )
    });
    if has_float {
        let mut sum = 0_f64;
        for literal in literals {
            sum += literal.value().parse::<f64>().map_err(|_| non_numeric())?;
        }
        return Ok(Literal::from(sum));
    }
    let has_decimal = literals
        .iter()
        .any(|literal| literal.datatype().as_str() == format!("{XSD}decimal"));
    if has_decimal {
        let mut sum = Decimal::from(0);
        let mut decimal_scale = 0;
        for literal in literals {
            let value = Decimal::from_str(literal.value()).map_err(|_| non_numeric())?;
            sum = sum.checked_add(value).ok_or_else(non_numeric)?;
            decimal_scale = decimal_scale.max(
                literal
                    .value()
                    .split_once('.')
                    .map_or(0, |(_, fraction)| fraction.len()),
            );
        }
        let mut lexical = sum.to_string();
        if decimal_scale > 0 && !lexical.contains('.') {
            lexical.push('.');
            lexical.push_str(&"0".repeat(decimal_scale));
        }
        return Ok(Literal::new_typed_literal(
            lexical,
            NamedNode::new_unchecked(format!("{XSD}decimal")),
        ));
    }
    let mut sum = 0_i64;
    for literal in literals {
        sum = sum
            .checked_add(literal.value().parse::<i64>().map_err(|_| non_numeric())?)
            .ok_or_else(non_numeric)?;
    }
    Ok(Literal::from(sum))
}

fn non_numeric() -> ValidationError {
    ValidationError::IllFormed("sum expression received a non-numeric term".to_owned())
}
