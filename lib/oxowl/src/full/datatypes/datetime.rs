use super::numeric::{DecimalValue, IntegerValue, parse_decimal, parse_integer};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DateTimeValue {
    year: IntegerValue,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: DecimalValue,
    timezone_minutes: Option<i16>,
}

impl DateTimeValue {
    pub(super) const fn has_timezone(&self) -> bool {
        self.timezone_minutes.is_some()
    }
}

pub(super) fn parse_date_time(value: &str, timezone_required: bool) -> Option<DateTimeValue> {
    let (date, time) = value.split_once('T')?;
    if time.contains('T') {
        return None;
    }
    let (mut year, mut month, mut day) = parse_date(date)?;
    let (time, timezone_minutes) = parse_timezone(time)?;
    if timezone_required && timezone_minutes.is_none() {
        return None;
    }
    let mut fields = time.split(':');
    let hour = parse_two_digits(fields.next()?)?;
    let minute = parse_two_digits(fields.next()?)?;
    let seconds = fields.next()?;
    if fields.next().is_some() || minute > 59 {
        return None;
    }
    let (seconds_integer, _) = seconds.split_once('.').unwrap_or((seconds, ""));
    if seconds_integer.len() != 2 {
        return None;
    }
    let second = parse_decimal(seconds)?;
    if second.is_negative()
        || second
            .integer_digits()
            .parse::<u8>()
            .ok()
            .is_none_or(|value| value > 59)
    {
        return None;
    }
    if hour > 24 || (hour == 24 && (minute != 0 || !second.is_zero())) {
        return None;
    }
    let hour = if hour == 24 {
        increment_date(&mut year, &mut month, &mut day);
        0
    } else {
        hour
    };
    Some(DateTimeValue {
        year,
        month,
        day,
        hour,
        minute,
        second,
        timezone_minutes,
    })
}

fn parse_date(value: &str) -> Option<(IntegerValue, u8, u8)> {
    let day_separator = value.rfind('-')?;
    let day = parse_two_digits(value.get(day_separator + 1..)?)?;
    let before_day = value.get(..day_separator)?;
    let month_separator = before_day.rfind('-')?;
    let month = parse_two_digits(before_day.get(month_separator + 1..)?)?;
    let year_lexical = before_day.get(..month_separator)?;
    let year_unsigned = year_lexical.strip_prefix('-').unwrap_or(year_lexical);
    if year_unsigned.len() < 4
        || (year_unsigned.len() > 4 && year_unsigned.starts_with('0'))
        || !year_unsigned.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let year = parse_integer(year_lexical)?;
    if year.is_zero() || !(1..=12).contains(&month) {
        return None;
    }
    (1..=days_in_month(&year, month))
        .contains(&day)
        .then_some((year, month, day))
}

fn parse_two_digits(value: &str) -> Option<u8> {
    (value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

fn parse_timezone(value: &str) -> Option<(&str, Option<i16>)> {
    if let Some(time) = value.strip_suffix('Z') {
        return Some((time, Some(0)));
    }
    if value.len() >= 6 {
        let start = value.len() - 6;
        let suffix = value.get(start..)?;
        let bytes = suffix.as_bytes();
        if matches!(bytes.first(), Some(b'+' | b'-')) && bytes.get(3) == Some(&b':') {
            let hour = parse_two_digits(suffix.get(1..3)?)?;
            let minute = parse_two_digits(suffix.get(4..6)?)?;
            if hour > 14 || minute > 59 || (hour == 14 && minute != 0) {
                return None;
            }
            let sign = if bytes[0] == b'-' { -1 } else { 1 };
            let offset = sign * (i16::from(hour) * 60 + i16::from(minute));
            return Some((value.get(..start)?, Some(offset)));
        }
    }
    Some((value, None))
}

fn days_in_month(year: &IntegerValue, month: u8) -> u8 {
    match month {
        2 if leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn leap_year(year: &IntegerValue) -> bool {
    decimal_mod(year.digits(), 4) == 0
        && (decimal_mod(year.digits(), 100) != 0 || decimal_mod(year.digits(), 400) == 0)
}

fn decimal_mod(value: &str, modulus: u16) -> u16 {
    value.bytes().fold(0, |remainder, byte| {
        (remainder * 10 + u16::from(byte - b'0')) % modulus
    })
}

fn increment_date(year: &mut IntegerValue, month: &mut u8, day: &mut u8) {
    if *day < days_in_month(year, *month) {
        *day += 1;
    } else if *month < 12 {
        *month += 1;
        *day = 1;
    } else {
        *month = 1;
        *day = 1;
        year.increment_excluding_zero();
    }
}
