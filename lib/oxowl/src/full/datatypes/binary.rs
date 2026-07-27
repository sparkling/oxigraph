pub(super) fn parse_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let [first, second] = pair else {
                return None;
            };
            hex_value(*first)?
                .checked_mul(16)?
                .checked_add(hex_value(*second)?)
        })
        .collect()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(super) fn parse_base64(value: &str) -> Option<Vec<u8>> {
    let compact = value
        .bytes()
        .filter(|byte| !matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
        .collect::<Vec<_>>();
    if !compact.len().is_multiple_of(4) {
        return None;
    }
    let mut output = Vec::with_capacity(compact.len() / 4 * 3);
    for (index, chunk) in compact.chunks_exact(4).enumerate() {
        let [first, second, third, fourth] = chunk else {
            return None;
        };
        let final_chunk = index + 1 == compact.len() / 4;
        let a = base64_value(*first)?;
        let b = base64_value(*second)?;
        let c = (*third != b'=').then(|| base64_value(*third)).flatten();
        let d = (*fourth != b'=').then(|| base64_value(*fourth)).flatten();
        if !final_chunk && (c.is_none() || d.is_none()) {
            return None;
        }
        output.push((a << 2) | (b >> 4));
        match (c, d) {
            (None, None) if b.trailing_zeros() >= 4 => {}
            (Some(c), None) if c.trailing_zeros() >= 2 => output.push((b << 4) | (c >> 2)),
            (Some(c), Some(d)) => {
                output.push((b << 4) | (c >> 2));
                output.push((c << 6) | d);
            }
            _ => return None,
        }
    }
    Some(output)
}

fn base64_value(value: u8) -> Option<u8> {
    match value {
        b'A'..=b'Z' => Some(value - b'A'),
        b'a'..=b'z' => Some(value - b'a' + 26),
        b'0'..=b'9' => Some(value - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}
