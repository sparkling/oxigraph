use oxrdf::{NamedNode, vocab::xsd};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DecimalValue {
    negative: bool,
    integer: String,
    fraction: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct IntegerValue {
    negative: bool,
    digits: String,
}

impl DecimalValue {
    pub(super) const fn is_negative(&self) -> bool {
        self.negative
    }

    pub(super) fn integer_digits(&self) -> &str {
        &self.integer
    }

    pub(super) fn is_zero(&self) -> bool {
        self.integer == "0" && self.fraction.is_empty()
    }
}

impl IntegerValue {
    pub(super) fn digits(&self) -> &str {
        &self.digits
    }

    pub(super) fn is_zero(&self) -> bool {
        self.digits == "0"
    }

    pub(super) fn increment_excluding_zero(&mut self) {
        if self.negative {
            if self.digits == "1" {
                self.negative = false;
            } else {
                self.digits = subtract_one(&self.digits);
            }
        } else {
            self.digits = add_one(&self.digits);
        }
    }
}

pub(super) fn parse_integer(value: &str) -> Option<IntegerValue> {
    let (negative, unsigned) = match value.as_bytes().first() {
        Some(b'+') => (false, &value[1..]),
        Some(b'-') => (true, &value[1..]),
        _ => (false, value),
    };
    if unsigned.is_empty() || !unsigned.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let digits = unsigned.trim_start_matches('0');
    Some(IntegerValue {
        negative: negative && !digits.is_empty(),
        digits: if digits.is_empty() { "0" } else { digits }.to_owned(),
    })
}

pub(super) fn parse_decimal(value: &str) -> Option<DecimalValue> {
    let value = value.strip_prefix('+').unwrap_or(value);
    let negative = value.starts_with('-');
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let mut parts = unsigned.split('.');
    let integer = parts.next()?;
    let fraction = parts.next();
    let has_decimal_point = fraction.is_some();
    let fraction = fraction.unwrap_or("");
    if parts.next().is_some()
        || (integer.is_empty() && (!has_decimal_point || fraction.is_empty()))
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let integer = integer.trim_start_matches('0');
    let fraction = fraction.trim_end_matches('0');
    let integer = if integer.is_empty() { "0" } else { integer };
    Some(DecimalValue {
        negative: negative && (integer != "0" || !fraction.is_empty()),
        integer: integer.to_owned(),
        fraction: fraction.to_owned(),
    })
}

pub(super) fn decimal_from_integer(value: IntegerValue) -> DecimalValue {
    DecimalValue {
        negative: value.negative,
        integer: value.digits,
        fraction: String::new(),
    }
}

pub(super) fn decimal_integer(value: &DecimalValue) -> Option<IntegerValue> {
    value.fraction.is_empty().then(|| IntegerValue {
        negative: value.negative,
        digits: value.integer.clone(),
    })
}

pub(super) fn integer_datatype(datatype: &NamedNode) -> bool {
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

pub(super) fn integer_in_range(value: &IntegerValue, datatype: &NamedNode) -> bool {
    if datatype == &xsd::NON_NEGATIVE_INTEGER {
        !value.negative
    } else if datatype == &xsd::NON_POSITIVE_INTEGER {
        value.negative || value.digits == "0"
    } else if datatype == &xsd::POSITIVE_INTEGER {
        !value.negative && value.digits != "0"
    } else if datatype == &xsd::NEGATIVE_INTEGER {
        value.negative
    } else if datatype == &xsd::LONG {
        integer_between(value, "-9223372036854775808", "9223372036854775807")
    } else if datatype == &xsd::INT {
        integer_between(value, "-2147483648", "2147483647")
    } else if datatype == &xsd::SHORT {
        integer_between(value, "-32768", "32767")
    } else if datatype == &xsd::BYTE {
        integer_between(value, "-128", "127")
    } else if datatype == &xsd::UNSIGNED_LONG {
        integer_between(value, "0", "18446744073709551615")
    } else if datatype == &xsd::UNSIGNED_INT {
        integer_between(value, "0", "4294967295")
    } else if datatype == &xsd::UNSIGNED_SHORT {
        integer_between(value, "0", "65535")
    } else if datatype == &xsd::UNSIGNED_BYTE {
        integer_between(value, "0", "255")
    } else {
        datatype == &xsd::INTEGER
    }
}

fn integer_between(value: &IntegerValue, minimum: &str, maximum: &str) -> bool {
    let (Some(minimum), Some(maximum)) = (parse_integer(minimum), parse_integer(maximum)) else {
        return false;
    };
    compare_integer(value, &minimum).is_ge() && compare_integer(value, &maximum).is_le()
}

fn compare_integer(left: &IntegerValue, right: &IntegerValue) -> std::cmp::Ordering {
    if left.negative != right.negative {
        return if left.negative {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        };
    }
    let magnitude = left
        .digits
        .len()
        .cmp(&right.digits.len())
        .then_with(|| left.digits.cmp(&right.digits));
    if left.negative {
        magnitude.reverse()
    } else {
        magnitude
    }
}

pub(super) fn parse_float(value: &str) -> Option<u32> {
    parse_floating_lexical(value)?;
    Some(
        match value {
            "INF" => f32::INFINITY,
            "-INF" => f32::NEG_INFINITY,
            "NaN" => f32::NAN,
            _ => value
                .parse::<f32>()
                .unwrap_or_else(|_| floating_extreme_f32(value)),
        }
        .to_bits(),
    )
}

pub(super) fn parse_double(value: &str) -> Option<u64> {
    parse_floating_lexical(value)?;
    Some(
        match value {
            "INF" => f64::INFINITY,
            "-INF" => f64::NEG_INFINITY,
            "NaN" => f64::NAN,
            _ => value
                .parse::<f64>()
                .unwrap_or_else(|_| floating_extreme_f64(value)),
        }
        .to_bits(),
    )
}

fn parse_floating_lexical(value: &str) -> Option<()> {
    if matches!(value, "INF" | "-INF" | "NaN") {
        return Some(());
    }
    let mut parts = value.split(['e', 'E']);
    parse_decimal(parts.next()?)?;
    if let Some(exponent) = parts.next() {
        parse_integer(exponent)?;
    }
    parts.next().is_none().then_some(())
}

fn floating_extreme_f32(value: &str) -> f32 {
    let (negative, underflow) = floating_extreme_kind(value);
    if underflow {
        if negative { -0.0 } else { 0.0 }
    } else if negative {
        f32::NEG_INFINITY
    } else {
        f32::INFINITY
    }
}

fn floating_extreme_f64(value: &str) -> f64 {
    let (negative, underflow) = floating_extreme_kind(value);
    if underflow {
        if negative { -0.0 } else { 0.0 }
    } else if negative {
        f64::NEG_INFINITY
    } else {
        f64::INFINITY
    }
}

fn floating_extreme_kind(value: &str) -> (bool, bool) {
    let negative = value.starts_with('-');
    let mantissa = value.split(['e', 'E']).next().unwrap_or(value);
    let zero = parse_decimal(mantissa)
        .is_some_and(|value| value.integer == "0" && value.fraction.is_empty());
    let negative_exponent = value
        .split(['e', 'E'])
        .nth(1)
        .is_some_and(|value| value.starts_with('-'));
    (negative, zero || negative_exponent)
}

fn add_one(value: &str) -> String {
    let mut output = value.as_bytes().to_vec();
    for digit in output.iter_mut().rev() {
        if *digit < b'9' {
            *digit += 1;
            return ascii_string(output);
        }
        *digit = b'0';
    }
    output.insert(0, b'1');
    ascii_string(output)
}

fn subtract_one(value: &str) -> String {
    let mut output = value.as_bytes().to_vec();
    for digit in output.iter_mut().rev() {
        if *digit > b'0' {
            *digit -= 1;
            break;
        }
        *digit = b'9';
    }
    let first_nonzero = output
        .iter()
        .position(|digit| *digit != b'0')
        .unwrap_or(output.len() - 1);
    ascii_string(output.split_off(first_nonzero))
}

fn ascii_string(value: Vec<u8>) -> String {
    value.into_iter().map(char::from).collect()
}
