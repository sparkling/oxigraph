use oxrdf::{
    Literal, NamedNode,
    vocab::{rdf, xsd},
};
use oxsdatatypes::{
    Boolean, Date, DateTime, DayTimeDuration, Decimal, Double, Duration, Float, GDay, GMonth,
    GMonthDay, GYear, GYearMonth, Time, YearMonthDuration,
};
use std::cmp::Ordering;

pub(crate) fn literal_matches_datatype(literal: &Literal, datatype: &NamedNode) -> bool {
    literal.datatype() == datatype && valid_lexical_form(literal)
}

pub(crate) fn language_key(literal: &Literal) -> Option<String> {
    let language = literal.language()?.to_ascii_lowercase();
    #[cfg(feature = "rdf-12")]
    {
        let direction = literal.direction().map_or("", |direction| match direction {
            oxrdf::BaseDirection::Ltr => "ltr",
            oxrdf::BaseDirection::Rtl => "rtl",
        });
        Some(format!("{language}\0{direction}"))
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        Some(language)
    }
}

pub(crate) fn valid_lexical_form(literal: &Literal) -> bool {
    let datatype = literal.datatype();
    let value = literal.value();
    if datatype == &xsd::BOOLEAN {
        return value.parse::<Boolean>().is_ok();
    }
    if datatype == &xsd::DECIMAL {
        return value.parse::<Decimal>().is_ok();
    }
    if datatype == &xsd::FLOAT {
        return value.parse::<Float>().is_ok();
    }
    if datatype == &xsd::DOUBLE {
        return value.parse::<Double>().is_ok();
    }
    if integer_datatype(datatype) {
        return integer_in_range(value, datatype);
    }
    if datatype == &xsd::DATE_TIME || datatype == &xsd::DATE_TIME_STAMP {
        return value.parse::<DateTime>().is_ok_and(|parsed| {
            datatype != &xsd::DATE_TIME_STAMP || parsed.timezone_offset().is_some()
        });
    }
    if datatype == &xsd::DATE {
        return value.parse::<Date>().is_ok();
    }
    if datatype == &xsd::TIME {
        return value.parse::<Time>().is_ok();
    }
    if datatype == &xsd::G_YEAR_MONTH {
        return value.parse::<GYearMonth>().is_ok();
    }
    if datatype == &xsd::G_YEAR {
        return value.parse::<GYear>().is_ok();
    }
    if datatype == &xsd::G_MONTH_DAY {
        return value.parse::<GMonthDay>().is_ok();
    }
    if datatype == &xsd::G_MONTH {
        return value.parse::<GMonth>().is_ok();
    }
    if datatype == &xsd::G_DAY {
        return value.parse::<GDay>().is_ok();
    }
    if datatype == &xsd::DURATION {
        return value.parse::<Duration>().is_ok();
    }
    if datatype == &xsd::YEAR_MONTH_DURATION {
        return value.parse::<YearMonthDuration>().is_ok();
    }
    if datatype == &xsd::DAY_TIME_DURATION {
        return value.parse::<DayTimeDuration>().is_ok();
    }
    if datatype == &xsd::HEX_BINARY {
        return value.len().is_multiple_of(2) && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    }
    if datatype == &xsd::BASE_64_BINARY {
        return valid_base64(value);
    }
    if datatype == &xsd::NORMALIZED_STRING {
        return !value.contains(['\r', '\n', '\t']);
    }
    if datatype == &xsd::TOKEN {
        return !value.contains(['\r', '\n', '\t'])
            && !value.starts_with(' ')
            && !value.ends_with(' ')
            && !value.contains("  ");
    }
    if datatype == &rdf::LANG_STRING {
        return literal.language().is_some();
    }
    true
}

pub(crate) fn compare_literals(left: &Literal, right: &Literal) -> Option<Ordering> {
    let left_type = left.datatype();
    let right_type = right.datatype();
    if date_time_datatype(left_type) && date_time_datatype(right_type) {
        return parsed_compare::<DateTime>(left.value(), right.value());
    }
    if left_type != right_type || left.language() != right.language() {
        return None;
    }
    if left_type == &xsd::DATE {
        return parsed_compare::<Date>(left.value(), right.value());
    }
    if left_type == &xsd::TIME {
        return parsed_compare::<Time>(left.value(), right.value());
    }
    if left_type == &xsd::G_YEAR_MONTH {
        return parsed_compare::<GYearMonth>(left.value(), right.value());
    }
    if left_type == &xsd::G_YEAR {
        return parsed_compare::<GYear>(left.value(), right.value());
    }
    if left_type == &xsd::G_MONTH_DAY {
        return parsed_compare::<GMonthDay>(left.value(), right.value());
    }
    if left_type == &xsd::G_MONTH {
        return parsed_compare::<GMonth>(left.value(), right.value());
    }
    if left_type == &xsd::G_DAY {
        return parsed_compare::<GDay>(left.value(), right.value());
    }
    if string_datatype(left_type) {
        return Some(left.value().cmp(right.value()));
    }
    None
}

fn parsed_compare<T: std::str::FromStr + PartialOrd>(left: &str, right: &str) -> Option<Ordering> {
    left.parse::<T>()
        .ok()?
        .partial_cmp(&right.parse::<T>().ok()?)
}

fn date_time_datatype(datatype: &NamedNode) -> bool {
    datatype == &xsd::DATE_TIME || datatype == &xsd::DATE_TIME_STAMP
}

fn string_datatype(datatype: &NamedNode) -> bool {
    datatype == &xsd::STRING
        || datatype == &xsd::NORMALIZED_STRING
        || datatype == &xsd::TOKEN
        || datatype == &xsd::LANGUAGE
        || datatype == &xsd::NAME
        || datatype == &xsd::NC_NAME
        || datatype == &xsd::NMTOKEN
        || datatype == &rdf::LANG_STRING
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

fn integer_in_range(value: &str, datatype: &NamedNode) -> bool {
    if datatype == &xsd::UNSIGNED_LONG {
        return value.parse::<u64>().is_ok();
    }
    let Ok(value) = value.parse::<i128>() else {
        return false;
    };
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

fn valid_base64(value: &str) -> bool {
    let compact = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if compact.is_empty() {
        return true;
    }
    if !compact.len().is_multiple_of(4) {
        return false;
    }
    let padding = compact
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    padding <= 2
        && compact[..compact.len() - padding]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
        && compact[compact.len() - padding..]
            .iter()
            .all(|byte| *byte == b'=')
}
