use std::borrow::Cow;
use std::io;

pub(super) fn validate_xml_10_characters(value: &str, context: &str) -> io::Result<()> {
    if let Some(character) = value.chars().find(|character| {
        !matches!(
            *character,
            '\u{9}'
                | '\u{A}'
                | '\u{D}'
                | '\u{20}'..='\u{D7FF}'
                | '\u{E000}'..='\u{FFFD}'
                | '\u{10000}'..='\u{10FFFF}'
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "The {context} contains U+{:04X}, which XML 1.0 cannot represent",
                u32::from(character)
            ),
        ));
    }
    Ok(())
}

pub(super) fn escape_xml_text(value: &str) -> Cow<'_, str> {
    let mut escaped = None;
    let mut previous_index = 0;
    let mut push_escape = |replacement: &'static str, character: char, index: usize| {
        let output = escaped.get_or_insert_with(|| String::with_capacity(value.len()));
        output.push_str(&value[previous_index..index]);
        output.push_str(replacement);
        previous_index = index + character.len_utf8();
    };
    for (index, character) in value.char_indices() {
        match character {
            '<' => push_escape("&lt;", character, index),
            '>' => push_escape("&gt;", character, index),
            '\'' => push_escape("&apos;", character, index),
            '&' => push_escape("&amp;", character, index),
            '"' => push_escape("&quot;", character, index),
            // Raw CR is normalized to LF by XML 1.0 processors.
            '\r' => push_escape("&#13;", character, index),
            _ => {}
        }
    }
    if let Some(mut escaped) = escaped {
        escaped.push_str(&value[previous_index..]);
        escaped.into()
    } else {
        value.into()
    }
}
