use crate::datatype::compare_literals;
use oxrdf::Term;
use std::cmp::Ordering;

pub(crate) fn compare_terms(left: &Term, right: &Term) -> Option<Ordering> {
    match (numeric_value(left), numeric_value(right)) {
        (Some(left), Some(right)) => left.partial_cmp(&right),
        _ => match (left, right) {
            (Term::Literal(left), Term::Literal(right)) => compare_literals(left, right),
            _ => None,
        },
    }
}

fn numeric_value(term: &Term) -> Option<f64> {
    let Term::Literal(literal) = term else {
        return None;
    };
    let datatype = literal.datatype().as_str();
    if datatype.starts_with("http://www.w3.org/2001/XMLSchema#")
        && matches!(
            datatype.rsplit_once('#').map(|(_, local)| local),
            Some(
                "decimal"
                    | "double"
                    | "float"
                    | "integer"
                    | "long"
                    | "int"
                    | "short"
                    | "byte"
                    | "nonNegativeInteger"
                    | "positiveInteger"
                    | "nonPositiveInteger"
                    | "negativeInteger"
                    | "unsignedLong"
                    | "unsignedInt"
                    | "unsignedShort"
                    | "unsignedByte"
            )
        )
    {
        literal.value().parse().ok()
    } else {
        None
    }
}
