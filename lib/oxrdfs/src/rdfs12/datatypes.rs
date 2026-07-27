#![expect(
    clippy::cloned_ref_to_slice_refs,
    reason = "first-derivation evidence is deliberately materialized as owned quads"
)]

use super::{
    Rdfs12Error, Runtime,
    terms::{contains_matching_literal, literal_replacements},
};
use oxrdf::{
    Literal, NamedNode, Quad, Term,
    vocab::{rdf, rdfs, xsd},
};
use oxsdatatypes::{Boolean, Double, Float};

const DIR_LANG_STRING: NamedNode =
    NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");

static MANDATORY_DATATYPES: [NamedNode; 3] = [xsd::STRING, rdf::LANG_STRING, DIR_LANG_STRING];

/// Returns the datatype IRIs that every RDF 1.2 interpretation must recognize.
pub(super) fn mandatory_datatypes() -> &'static [NamedNode] {
    &MANDATORY_DATATYPES
}

/// Builds a sound datatype map from the public options.
///
/// RDF 1.2 Semantics requires the three string datatypes above in every map.
/// Other datatype IRIs are only admitted when this module has a fixed
/// lexical-to-value policy for them.
pub(super) fn normalized_recognized_datatypes(
    requested: &[NamedNode],
) -> Result<Vec<NamedNode>, Rdfs12Error> {
    let mut recognized = mandatory_datatypes().to_vec();
    for datatype in requested {
        if !supported_datatype(datatype) {
            return Err(Rdfs12Error::UnsupportedRecognizedDatatype {
                datatype: datatype.clone(),
            });
        }
        if !recognized.contains(datatype) {
            recognized.push(datatype.clone());
        }
    }
    Ok(recognized)
}

fn supported_datatype(datatype: &NamedNode) -> bool {
    mandatory_datatypes().contains(datatype)
        || datatype == &rdf::XML_LITERAL
        || datatype == &xsd::BOOLEAN
        || datatype == &xsd::DECIMAL
        || datatype == &xsd::FLOAT
        || datatype == &xsd::DOUBLE
        || integer_datatype(datatype)
}

/// One concrete reason the input has no RDFS interpretation recognizing `D`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rdfs12Inconsistency {
    kind: &'static str,
    evidence: Box<[Quad]>,
}

impl Rdfs12Inconsistency {
    /// Returns a stable machine-readable inconsistency category.
    pub const fn kind(&self) -> &'static str {
        self.kind
    }

    /// Returns the quads that witness this inconsistency.
    pub fn evidence(&self) -> &[Quad] {
        &self.evidence
    }
}

/// RDFS satisfiability result for the configured datatype map.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Rdfs12Consistency {
    /// No contradiction was found under the configured datatype map.
    Consistent,
    /// One or more datatype contradictions were found.
    Inconsistent(Box<[Rdfs12Inconsistency]>),
}

impl Runtime<'_> {
    pub(super) fn apply_literal_witnesses(&mut self, quad: &Quad) -> Result<(), Rdfs12Error> {
        let replacements = literal_replacements(&quad.object, &quad.graph_name, |datatype| {
            self.recognizes(datatype)
        });
        for (object, witness, datatype) in replacements {
            self.insert(
                Quad::new(
                    quad.subject.clone(),
                    quad.predicate.clone(),
                    object,
                    quad.graph_name.clone(),
                ),
                "rdfD1",
                std::slice::from_ref(quad),
            )?;
            self.insert(
                Quad::new(witness, rdf::TYPE, datatype, quad.graph_name.clone()),
                "rdfD1",
                std::slice::from_ref(quad),
            )?;
        }
        Ok(())
    }

    pub(super) fn detect_datatype_inconsistency(
        &mut self,
    ) -> Result<Rdfs12Consistency, Rdfs12Error> {
        let mut reasons = Vec::new();
        for quad in &self.base {
            self.check()?;
            if contains_matching_literal(&quad.object, |literal| {
                self.recognizes(literal.datatype()) && !well_typed(literal)
            }) {
                reasons.push(reason("ill-typed-literal", &[quad.clone()]));
            }
        }
        let quads = self.all.iter().collect::<Vec<_>>();
        for range in &quads {
            if range.predicate != rdfs::RANGE {
                continue;
            }
            let Term::NamedNode(datatype) = &range.object else {
                continue;
            };
            if !self.recognizes(datatype) {
                continue;
            }
            for fact in &quads {
                self.touch()?;
                if fact.graph_name == range.graph_name
                    && fact.predicate == range.subject
                    && let Term::Literal(literal) = &fact.object
                    && self.recognizes(literal.datatype())
                    && !literal_value_in(literal, datatype)
                {
                    reasons.push(reason(
                        "datatype-range-clash",
                        &[range.clone(), fact.clone()],
                    ));
                }
            }
        }
        for left in &quads {
            if left.predicate != rdf::TYPE {
                continue;
            }
            let Term::NamedNode(left_type) = &left.object else {
                continue;
            };
            if !self.recognizes(left_type) {
                continue;
            }
            for right in &quads {
                self.touch()?;
                if right.predicate == rdf::TYPE
                    && right.graph_name == left.graph_name
                    && right.subject == left.subject
                    && let Term::NamedNode(right_type) = &right.object
                    && self.recognizes(right_type)
                    && disjoint_datatypes(left_type, right_type)
                {
                    reasons.push(reason(
                        "disjoint-datatype-classes",
                        &[left.clone(), right.clone()],
                    ));
                }
            }
        }
        reasons.sort_by_key(|item| {
            item.evidence
                .first()
                .map_or_else(String::new, ToString::to_string)
        });
        reasons.dedup();
        Ok(if reasons.is_empty() {
            Rdfs12Consistency::Consistent
        } else {
            Rdfs12Consistency::Inconsistent(reasons.into_boxed_slice())
        })
    }

    fn recognizes(&self, datatype: &NamedNode) -> bool {
        self.recognized_datatypes.contains(datatype)
    }
}

fn reason(kind: &'static str, evidence: &[Quad]) -> Rdfs12Inconsistency {
    Rdfs12Inconsistency {
        kind,
        evidence: evidence.to_vec().into_boxed_slice(),
    }
}

fn well_typed(literal: &Literal) -> bool {
    literal_value_in(literal, literal.datatype())
}

fn literal_value_in(literal: &Literal, target: &NamedNode) -> bool {
    let source = literal.datatype();
    if target == source {
        return lexical_valid(literal.value(), source);
    }
    if integer_datatype(source) {
        if !integer_lexical_valid(literal.value(), source) {
            return false;
        }
        if target == &xsd::DECIMAL {
            return true;
        }
        if integer_datatype(target) {
            return integer_lexical_valid(literal.value(), target);
        }
    }
    if source == &xsd::DECIMAL
        && integer_datatype(target)
        && let Some(integer) = decimal_as_integer(literal.value())
    {
        return integer_lexical_valid(&integer, target);
    }
    source == &xsd::STRING && target == &rdfs::LITERAL
}

fn lexical_valid(value: &str, datatype: &NamedNode) -> bool {
    if datatype == &xsd::STRING {
        return xml_11_chars(value);
    }
    if datatype == &rdf::LANG_STRING || datatype == &DIR_LANG_STRING {
        // The RDF abstract syntax prevents ill-typed literals of these types.
        return true;
    }
    if datatype == &rdf::XML_LITERAL {
        return well_formed_xml_fragment(value);
    }
    if integer_datatype(datatype) {
        return integer_lexical_valid(value, datatype);
    }
    if datatype == &xsd::DECIMAL {
        return decimal_lexical_valid(value);
    }
    if datatype == &xsd::BOOLEAN {
        return value.parse::<Boolean>().is_ok();
    }
    if datatype == &xsd::FLOAT {
        return floating_point_lexical_valid(value) && value.parse::<Float>().is_ok();
    }
    if datatype == &xsd::DOUBLE {
        return floating_point_lexical_valid(value) && value.parse::<Double>().is_ok();
    }
    false
}

fn xml_11_chars(value: &str) -> bool {
    value.chars().all(|character| {
        matches!(
            u32::from(character),
            0x1..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10_FFFF
        )
    })
}

fn integer_lexical_valid(value: &str, datatype: &NamedNode) -> bool {
    // The XSD integer and decimal value spaces are arbitrary precision, while
    // the SPARQL-oriented oxsdatatypes representations are intentionally
    // bounded. Validate their lexical spaces without imposing those bounds.
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    if unsigned.is_empty() || !unsigned.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let nonzero = unsigned.bytes().any(|byte| byte != b'0');
    let negative = value.starts_with('-') && nonzero;
    if datatype == &xsd::INTEGER {
        true
    } else if datatype == &xsd::NON_NEGATIVE_INTEGER {
        !negative
    } else if datatype == &xsd::NON_POSITIVE_INTEGER {
        negative || !nonzero
    } else if datatype == &xsd::POSITIVE_INTEGER {
        !negative && nonzero
    } else if datatype == &xsd::NEGATIVE_INTEGER {
        negative
    } else {
        value
            .parse::<i128>()
            .ok()
            .is_some_and(|value| integer_in_range(value, datatype))
    }
}

fn decimal_lexical_valid(value: &str) -> bool {
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    let Some((integer, fraction)) = unsigned.split_once('.') else {
        return !unsigned.is_empty() && unsigned.bytes().all(|byte| byte.is_ascii_digit());
    };
    !integer.contains('.')
        && (!integer.is_empty() || !fraction.is_empty())
        && integer.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
}

fn decimal_as_integer(value: &str) -> Option<String> {
    if !decimal_lexical_valid(value) {
        return None;
    }
    let (sign, unsigned) = value.strip_prefix('-').map_or_else(
        || ("", value.strip_prefix('+').unwrap_or(value)),
        |rest| ("-", rest),
    );
    let (integer, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if fraction.bytes().any(|byte| byte != b'0') {
        return None;
    }
    Some(format!(
        "{sign}{}",
        if integer.is_empty() { "0" } else { integer }
    ))
}

fn floating_point_lexical_valid(value: &str) -> bool {
    if matches!(value, "INF" | "-INF" | "NaN") {
        return true;
    }
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    let exponent = unsigned.find(['e', 'E']);
    let (mantissa, exponent) = exponent.map_or((unsigned, None), |index| {
        (&unsigned[..index], Some(&unsigned[index + 1..]))
    });
    if mantissa.contains(['e', 'E']) || !decimal_lexical_valid(mantissa) {
        return false;
    }
    exponent.is_none_or(|exponent| {
        let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
        !exponent.is_empty() && exponent.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn well_formed_xml_fragment(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut stack = Vec::<&str>::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'&' {
            let Some(end) = value[index + 1..].find(';') else {
                return false;
            };
            let entity = &value[index + 1..index + 1 + end];
            if !matches!(entity, "amp" | "lt" | "gt" | "apos" | "quot") && !entity.starts_with('#')
            {
                return false;
            }
            index += end + 2;
            continue;
        }
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }
        let tail = &value[index..];
        if tail.starts_with("<!--") {
            let Some(end) = tail.find("-->") else {
                return false;
            };
            index += end + 3;
            continue;
        }
        if tail.starts_with("<![CDATA[") {
            let Some(end) = tail.find("]]>") else {
                return false;
            };
            index += end + 3;
            continue;
        }
        if tail.starts_with("<?") {
            let Some(end) = tail.find("?>") else {
                return false;
            };
            index += end + 2;
            continue;
        }
        let Some(end) = xml_tag_end(tail) else {
            return false;
        };
        let content = tail[1..end].trim();
        if let Some(closing) = content.strip_prefix('/') {
            let name = closing.trim();
            if name.is_empty() || stack.pop() != Some(name) {
                return false;
            }
        } else if !content.ends_with('/') {
            let name_end = content.find(char::is_whitespace).unwrap_or(content.len());
            let name = &content[..name_end];
            if name.is_empty() || name.starts_with('!') {
                return false;
            }
            stack.push(name);
        }
        index += end + 1;
    }
    stack.is_empty()
}

fn xml_tag_end(value: &str) -> Option<usize> {
    let mut quote = None;
    for (index, character) in value.char_indices().skip(1) {
        if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            }
        } else if character == '>' && quote.is_none() {
            return Some(index);
        }
    }
    None
}

fn disjoint_datatypes(left: &NamedNode, right: &NamedNode) -> bool {
    if left == right {
        return false;
    }
    if integer_datatype(left) && (integer_datatype(right) || right == &xsd::DECIMAL) {
        return false;
    }
    if integer_datatype(right) && left == &xsd::DECIMAL {
        return false;
    }
    true
}

fn integer_datatype(datatype: &NamedNode) -> bool {
    [
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
    ]
    .contains(datatype)
}

fn integer_in_range(value: i128, datatype: &NamedNode) -> bool {
    if datatype == &xsd::NON_NEGATIVE_INTEGER {
        value >= 0
    } else if datatype == &xsd::NON_POSITIVE_INTEGER {
        value <= 0
    } else if datatype == &xsd::POSITIVE_INTEGER {
        value > 0
    } else if datatype == &xsd::NEGATIVE_INTEGER {
        value < 0
    } else if datatype == &xsd::LONG {
        i64::try_from(value).is_ok()
    } else if datatype == &xsd::INT {
        i32::try_from(value).is_ok()
    } else if datatype == &xsd::SHORT {
        i16::try_from(value).is_ok()
    } else if datatype == &xsd::BYTE {
        i8::try_from(value).is_ok()
    } else if datatype == &xsd::UNSIGNED_LONG {
        u64::try_from(value).is_ok()
    } else if datatype == &xsd::UNSIGNED_INT {
        u32::try_from(value).is_ok()
    } else if datatype == &xsd::UNSIGNED_SHORT {
        u16::try_from(value).is_ok()
    } else if datatype == &xsd::UNSIGNED_BYTE {
        u8::try_from(value).is_ok()
    } else {
        datatype == &xsd::INTEGER
    }
}
