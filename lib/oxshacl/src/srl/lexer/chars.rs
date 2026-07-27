pub(super) fn is_delimiter(value: char) -> bool {
    is_ws(value)
        || matches!(
            value,
            '#' | '<'
                | '>'
                | '"'
                | '\''
                | '{'
                | '}'
                | '('
                | ')'
                | '['
                | ']'
                | ','
                | ';'
                | '/'
                | '^'
                | '~'
                | '='
                | '!'
                | '|'
                | '&'
                | '+'
                | '*'
                | '@'
        )
}

pub(super) fn is_ws(value: char) -> bool {
    matches!(value, ' ' | '\t' | '\r' | '\n')
}

pub(super) fn is_var_char(value: char) -> bool {
    is_pn_chars_u(value)
        || value.is_ascii_digit()
        || value == '\u{00B7}'
        || matches!(value, '\u{0300}'..='\u{036F}' | '\u{203F}'..='\u{2040}')
}

pub(super) fn is_var_start(value: char) -> bool {
    is_pn_chars_u(value) || value.is_ascii_digit()
}

pub(super) fn is_name_char(value: char) -> bool {
    is_var_char(value) || value == '-' || value == '.'
}

pub(in crate::srl) fn is_pn_chars_base(value: char) -> bool {
    value.is_ascii_alphabetic()
        || matches!(
            value,
            '\u{00C0}'..='\u{00D6}'
                | '\u{00D8}'..='\u{00F6}'
                | '\u{00F8}'..='\u{02FF}'
                | '\u{0370}'..='\u{037D}'
                | '\u{037F}'..='\u{1FFF}'
                | '\u{200C}'..='\u{200D}'
                | '\u{2070}'..='\u{218F}'
                | '\u{2C00}'..='\u{2FEF}'
                | '\u{3001}'..='\u{D7FF}'
                | '\u{F900}'..='\u{FDCF}'
                | '\u{FDF0}'..='\u{FFFD}'
                | '\u{10000}'..='\u{EFFFF}'
        )
}

pub(in crate::srl) fn is_pn_chars_u(value: char) -> bool {
    is_pn_chars_base(value) || value == '_'
}

pub(in crate::srl) fn is_pn_chars(value: char) -> bool {
    is_pn_chars_u(value)
        || value == '-'
        || value.is_ascii_digit()
        || value == '\u{00B7}'
        || matches!(value, '\u{0300}'..='\u{036F}' | '\u{203F}'..='\u{2040}')
}
