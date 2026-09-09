#![expect(
    clippy::cloned_ref_to_slice_refs,
    clippy::multiple_inherent_impl,
    reason = "rule evidence is owned and the runtime is split by rule family"
)]

mod binary;
mod datetime;
mod numeric;
mod text;
mod xml;

use self::{
    binary::{parse_base64, parse_hex},
    datetime::{DateTimeValue, parse_date_time},
    numeric::{
        DecimalValue, decimal_from_integer, decimal_integer, integer_datatype, integer_in_range,
        parse_decimal, parse_double, parse_float, parse_integer,
    },
    text::{
        TextValue, collapse_whitespace, parse_language_text, parse_text, string_datatype,
        text_in_datatype, xml_chars,
    },
    xml::safe_xml_fragment,
};
use super::{Owl2RlRdfError, Owl2RlRdfInputError, Runtime};
use crate::vocabulary::DIFFERENT_FROM;
use oxrdf::{
    GraphName, Literal, NamedNode, Term,
    vocab::{rdf, rdfs, xsd},
};

const PLAIN_LITERAL: NamedNode =
    NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#PlainLiteral");

/// OWL 2 RL datatype handling policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Owl2RlDatatypeMode {
    /// Reject literals outside the normative OWL 2 RL datatype map.
    Strict,
    /// Leave unsupported datatypes opaque while retaining sound rule results.
    Permissive,
}

/// The 32 datatypes supported by the OWL 2 RL profile.
pub const OWL2_RL_DATATYPES: &[NamedNode] = &[
    PLAIN_LITERAL,
    rdf::XML_LITERAL,
    rdfs::LITERAL,
    xsd::DECIMAL,
    xsd::INTEGER,
    xsd::NON_NEGATIVE_INTEGER,
    xsd::NON_POSITIVE_INTEGER,
    xsd::POSITIVE_INTEGER,
    xsd::NEGATIVE_INTEGER,
    xsd::LONG,
    xsd::INT,
    xsd::SHORT,
    xsd::BYTE,
    xsd::UNSIGNED_LONG,
    xsd::UNSIGNED_INT,
    xsd::UNSIGNED_SHORT,
    xsd::UNSIGNED_BYTE,
    xsd::FLOAT,
    xsd::DOUBLE,
    xsd::STRING,
    xsd::NORMALIZED_STRING,
    xsd::TOKEN,
    xsd::LANGUAGE,
    xsd::NAME,
    xsd::NC_NAME,
    xsd::NMTOKEN,
    xsd::BOOLEAN,
    xsd::HEX_BINARY,
    xsd::BASE_64_BINARY,
    xsd::ANY_URI,
    xsd::DATE_TIME,
    xsd::DATE_TIME_STAMP,
];

impl Runtime<'_> {
    pub(super) fn validate_datatypes(&self) -> Result<(), Owl2RlRdfError> {
        self.check()?;
        if self.options.datatype_mode == Owl2RlDatatypeMode::Permissive {
            return Ok(());
        }
        for quad in &self.all {
            self.check()?;
            for literal in literals_in_term(&quad.object) {
                self.check()?;
                if !supported(literal.datatype()) {
                    return Err(Owl2RlRdfInputError::UnsupportedDatatype {
                        datatype: literal.datatype().clone(),
                    }
                    .into());
                }
            }
        }
        Ok(())
    }

    pub(super) fn seed_datatypes(&mut self, graph: &GraphName) -> Result<(), Owl2RlRdfError> {
        for datatype in OWL2_RL_DATATYPES {
            self.check()?;
            self.insert(
                oxrdf::Quad::new(datatype.clone(), rdf::TYPE, rdfs::DATATYPE, graph.clone()),
                "dt-type1",
                &[],
            )?;
        }
        Ok(())
    }

    pub(super) fn apply_datatypes(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.checked_collect(self.all.iter())?;
        let mut literals = Vec::<(GraphName, Literal)>::new();
        for quad in &quads {
            self.check()?;
            for literal in literals_in_term(&quad.object) {
                self.check()?;
                if supported(literal.datatype())
                    && !self.checked_any(literals.iter(), |(graph, item)| {
                        graph == &quad.graph_name && item == literal
                    })?
                {
                    literals.push((quad.graph_name.clone(), literal.clone()));
                }
            }
        }
        for (graph, literal) in &literals {
            self.check()?;
            for datatype in OWL2_RL_DATATYPES {
                self.check()?;
                self.touch()?;
                if value_in_datatype(literal, datatype) {
                    self.add_generalized(
                        graph,
                        Term::from(literal.clone()),
                        rdf::TYPE,
                        Term::from(datatype.clone()),
                    )?;
                }
            }
        }
        for (left_graph, left) in &literals {
            self.check()?;
            for (right_graph, right) in &literals {
                self.check()?;
                self.touch()?;
                if left_graph != right_graph {
                    continue;
                }
                match same_value(left, right) {
                    Some(true) => {
                        self.add_equality(
                            left_graph,
                            Term::from(left.clone()),
                            Term::from(right.clone()),
                            "dt-eq",
                            &[],
                        )?;
                    }
                    Some(false) => {
                        self.add_generalized(
                            left_graph,
                            Term::from(left.clone()),
                            DIFFERENT_FROM,
                            Term::from(right.clone()),
                        )?;
                    }
                    None => {}
                }
            }
        }
        for quad in &quads {
            self.check()?;
            for literal in literals_in_term(&quad.object) {
                self.check()?;
                if supported(literal.datatype()) && datatype_value(literal).is_none() {
                    self.contradiction("dt-not-type", &[quad.clone()])?;
                }
            }
        }
        let generalized = self.checked_collect(self.generalized.iter().cloned())?;
        for fact in generalized {
            self.check()?;
            if fact.predicate == rdf::TYPE
                && let (Term::Literal(literal), Term::NamedNode(datatype)) =
                    (&fact.subject, &fact.object)
                && supported(datatype)
                && !value_in_datatype(literal, datatype)
            {
                self.contradiction("dt-not-type", &[])?;
            }
            if fact.predicate == DIFFERENT_FROM
                && self.is_equal(&fact.graph_name, &fact.subject, &fact.object)
            {
                self.contradiction("eq-diff1", &[])?;
            }
        }
        Ok(())
    }
}

fn supported(datatype: &NamedNode) -> bool {
    OWL2_RL_DATATYPES.contains(datatype) || datatype == &rdf::LANG_STRING || {
        #[cfg(feature = "rdf-12")]
        {
            datatype == &rdf::DIR_LANG_STRING
        }
        #[cfg(not(feature = "rdf-12"))]
        {
            false
        }
    }
}

fn literals_in_term(term: &Term) -> Vec<&Literal> {
    let mut output = Vec::new();
    collect_literals(term, &mut output);
    output
}

fn collect_literals<'a>(term: &'a Term, output: &mut Vec<&'a Literal>) {
    match term {
        Term::Literal(literal) => output.push(literal),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => collect_literals(&triple.object, output),
        Term::NamedNode(_) | Term::BlankNode(_) => {}
    }
}

fn value_in_datatype(literal: &Literal, datatype: &NamedNode) -> bool {
    let Some(value) = datatype_value(literal) else {
        return false;
    };
    datatype_contains(&value, datatype)
}

fn same_value(left: &Literal, right: &Literal) -> Option<bool> {
    let left = datatype_value(left)?;
    let right = datatype_value(right)?;
    match (&left, &right) {
        // XML canonicalization is deliberately not approximated. Identical
        // lexical forms are certainly the same value; distinct well-formed
        // forms might canonicalize to the same value, so remain unknown.
        (DatatypeValue::Xml(left), DatatypeValue::Xml(right)) => (left == right).then_some(true),
        _ => Some(left == right),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DatatypeValue {
    Decimal(DecimalValue),
    Float(u32),
    Double(u64),
    Text(TextValue),
    Boolean(bool),
    Hex(Vec<u8>),
    Base64(Vec<u8>),
    AnyUri(String),
    DateTime(DateTimeValue),
    Xml(String),
}

fn datatype_value(literal: &Literal) -> Option<DatatypeValue> {
    let datatype = literal.datatype();
    let value = literal.value();
    if integer_datatype(datatype) {
        let integer = parse_integer(value)?;
        return integer_in_range(&integer, datatype)
            .then(|| DatatypeValue::Decimal(decimal_from_integer(integer)));
    }
    if datatype == &xsd::DECIMAL {
        return Some(DatatypeValue::Decimal(parse_decimal(value)?));
    }
    if datatype == &xsd::FLOAT {
        return Some(DatatypeValue::Float(parse_float(value)?));
    }
    if datatype == &xsd::DOUBLE {
        return Some(DatatypeValue::Double(parse_double(value)?));
    }
    if datatype == &xsd::BOOLEAN {
        return Some(DatatypeValue::Boolean(match value {
            "true" | "1" => true,
            "false" | "0" => false,
            _ => return None,
        }));
    }
    if datatype == &xsd::DATE_TIME || datatype == &xsd::DATE_TIME_STAMP {
        return Some(DatatypeValue::DateTime(parse_date_time(
            value,
            datatype == &xsd::DATE_TIME_STAMP,
        )?));
    }
    if datatype == &xsd::HEX_BINARY {
        return Some(DatatypeValue::Hex(parse_hex(value)?));
    }
    if datatype == &xsd::BASE_64_BINARY {
        return Some(DatatypeValue::Base64(parse_base64(value)?));
    }
    if datatype == &xsd::ANY_URI {
        return xml_chars(value).then(|| DatatypeValue::AnyUri(collapse_whitespace(value)));
    }
    if string_datatype(datatype) || datatype == &PLAIN_LITERAL {
        return Some(DatatypeValue::Text(parse_text(literal)?));
    }
    if datatype == &rdf::LANG_STRING {
        return Some(DatatypeValue::Text(parse_language_text(literal, false)?));
    }
    #[cfg(feature = "rdf-12")]
    if datatype == &rdf::DIR_LANG_STRING {
        return Some(DatatypeValue::Text(parse_language_text(literal, true)?));
    }
    if datatype == &rdf::XML_LITERAL && safe_xml_fragment(value) {
        return Some(DatatypeValue::Xml(value.to_owned()));
    }
    None
}

fn datatype_contains(value: &DatatypeValue, datatype: &NamedNode) -> bool {
    if datatype == &rdfs::LITERAL {
        return true;
    }
    match value {
        DatatypeValue::Decimal(value) => {
            if datatype == &xsd::DECIMAL {
                true
            } else if integer_datatype(datatype) {
                decimal_integer(value).is_some_and(|value| integer_in_range(&value, datatype))
            } else {
                false
            }
        }
        DatatypeValue::Float(_) => datatype == &xsd::FLOAT,
        DatatypeValue::Double(_) => datatype == &xsd::DOUBLE,
        DatatypeValue::Text(value) => text_in_datatype(value, datatype),
        DatatypeValue::Boolean(_) => datatype == &xsd::BOOLEAN,
        DatatypeValue::Hex(_) => datatype == &xsd::HEX_BINARY,
        DatatypeValue::Base64(_) => datatype == &xsd::BASE_64_BINARY,
        DatatypeValue::AnyUri(_) => datatype == &xsd::ANY_URI,
        DatatypeValue::DateTime(value) => {
            datatype == &xsd::DATE_TIME
                || (datatype == &xsd::DATE_TIME_STAMP && value.has_timezone())
        }
        DatatypeValue::Xml(_) => datatype == &rdf::XML_LITERAL,
    }
}
