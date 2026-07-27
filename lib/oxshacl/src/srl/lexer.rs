pub(super) mod chars;

use super::SrlError;

use self::chars::{is_delimiter, is_name_char, is_var_char, is_var_start, is_ws};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum TokenKind {
    IriRef(String),
    Variable(String),
    BlankNode(String),
    String(String),
    LongString(String),
    Lang(String),
    Number(String),
    Bare(String),
    LeftBrace,
    RightBrace,
    LeftParen,
    RightParen,
    LeftBracket,
    RightBracket,
    AnnotationStart,
    AnnotationEnd,
    ReifiedStart,
    ReifiedEnd,
    TripleStart,
    TripleEnd,
    Dot,
    Comma,
    Semicolon,
    Slash,
    Caret,
    Tilde,
    Datatype,
    Assign,
    Or,
    And,
    Equal,
    NotEqual,
    Less,
    Greater,
    LessOrEqual,
    GreaterOrEqual,
    Plus,
    Minus,
    Star,
    Bang,
    End,
}

#[derive(Clone, Debug)]
pub(super) struct Token {
    pub kind: TokenKind,
    pub line: usize,
    pub column: usize,
}

pub(super) fn tokenize(source: &str) -> Result<Vec<Token>, SrlError> {
    Lexer::new(source).tokenize()
}

struct Lexer<'a> {
    source: &'a str,
    offset: usize,
    line: usize,
    column: usize,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            offset: 0,
            line: 1,
            column: 1,
        }
    }

    fn tokenize(mut self) -> Result<Vec<Token>, SrlError> {
        let mut output = Vec::new();
        loop {
            self.skip_trivia();
            let line = self.line;
            let column = self.column;
            let Some(first) = self.peek() else {
                output.push(Token {
                    kind: TokenKind::End,
                    line,
                    column,
                });
                return Ok(output);
            };
            let kind = match first {
                '<' if self.starts_with("<<(") => {
                    self.advance_n(3);
                    TokenKind::TripleStart
                }
                '<' if self.starts_with("<<") => {
                    self.advance_n(2);
                    TokenKind::ReifiedStart
                }
                ')' if self.starts_with(")>>") => {
                    self.advance_n(3);
                    TokenKind::TripleEnd
                }
                '>' if self.starts_with(">>") => {
                    self.advance_n(2);
                    TokenKind::ReifiedEnd
                }
                '{' if self.starts_with("{|") => {
                    self.advance_n(2);
                    TokenKind::AnnotationStart
                }
                '|' if self.starts_with("|}") => {
                    self.advance_n(2);
                    TokenKind::AnnotationEnd
                }
                '^' if self.starts_with("^^") => {
                    self.advance_n(2);
                    TokenKind::Datatype
                }
                ':' if self.starts_with(":=") => {
                    self.advance_n(2);
                    TokenKind::Assign
                }
                '|' if self.starts_with("||") => {
                    self.advance_n(2);
                    TokenKind::Or
                }
                '&' if self.starts_with("&&") => {
                    self.advance_n(2);
                    TokenKind::And
                }
                '!' if self.starts_with("!=") => {
                    self.advance_n(2);
                    TokenKind::NotEqual
                }
                '<' if self.iri_ref_follows() => TokenKind::IriRef(self.iri_ref()?),
                '<' if self.starts_with("<=") => {
                    self.advance_n(2);
                    TokenKind::LessOrEqual
                }
                '>' if self.starts_with(">=") => {
                    self.advance_n(2);
                    TokenKind::GreaterOrEqual
                }
                '\'' | '"' => {
                    let long = self.remaining().starts_with(&first.to_string().repeat(3));
                    let value = self.string()?;
                    if long {
                        TokenKind::LongString(value)
                    } else {
                        TokenKind::String(value)
                    }
                }
                '?' | '$' => TokenKind::Variable(self.variable()?),
                '_' if self.starts_with("_:") => TokenKind::BlankNode(self.blank_node()?),
                '@' => TokenKind::Lang(self.language_tag()?),
                '+' | '-' | '.' | '0'..='9' if self.number_follows() => {
                    TokenKind::Number(self.number())
                }
                '{' => self.single(TokenKind::LeftBrace),
                '}' => self.single(TokenKind::RightBrace),
                '(' => self.single(TokenKind::LeftParen),
                ')' => self.single(TokenKind::RightParen),
                '[' => self.single(TokenKind::LeftBracket),
                ']' => self.single(TokenKind::RightBracket),
                '.' => self.single(TokenKind::Dot),
                ',' => self.single(TokenKind::Comma),
                ';' => self.single(TokenKind::Semicolon),
                '/' => self.single(TokenKind::Slash),
                '^' => self.single(TokenKind::Caret),
                '~' => self.single(TokenKind::Tilde),
                '=' => self.single(TokenKind::Equal),
                '<' => self.single(TokenKind::Less),
                '>' => self.single(TokenKind::Greater),
                '+' => self.single(TokenKind::Plus),
                '-' => self.single(TokenKind::Minus),
                '*' => self.single(TokenKind::Star),
                '!' => self.single(TokenKind::Bang),
                _ if !is_delimiter(first) => TokenKind::Bare(self.bare()?),
                _ => {
                    return Err(self.error(format!("unexpected character U+{:04X}", first as u32)));
                }
            };
            output.push(Token { kind, line, column });
        }
    }

    fn skip_trivia(&mut self) {
        loop {
            while self.peek().is_some_and(is_ws) {
                self.advance();
            }
            if self.peek() != Some('#') {
                return;
            }
            while let Some(value) = self.peek() {
                self.advance();
                if value == '\n' || value == '\r' {
                    break;
                }
            }
        }
    }

    fn single(&mut self, token: TokenKind) -> TokenKind {
        self.advance();
        token
    }

    fn iri_ref_follows(&self) -> bool {
        let mut chars = self.remaining()[1..].chars();
        while let Some(value) = chars.next() {
            match value {
                '>' => return true,
                candidate
                    if is_ws(candidate)
                        || candidate.is_control()
                        || matches!(candidate, '<' | '"' | '{' | '}' | '|' | '^' | '`') =>
                {
                    return false;
                }
                '\\' => {
                    let width = match chars.next() {
                        Some('u') => 4,
                        Some('U') => 8,
                        _ => return false,
                    };
                    if !(0..width)
                        .all(|_| chars.next().is_some_and(|value| value.is_ascii_hexdigit()))
                    {
                        return false;
                    }
                }
                _ => {}
            }
        }
        false
    }

    fn iri_ref(&mut self) -> Result<String, SrlError> {
        self.advance();
        let mut output = String::new();
        loop {
            match self.peek() {
                Some('>') => {
                    self.advance();
                    return Ok(output);
                }
                Some('\\') => {
                    self.advance();
                    output.push(self.unicode_escape()?);
                }
                Some(value) => {
                    output.push(value);
                    self.advance();
                }
                None => return Err(self.error("unterminated IRI reference")),
            }
        }
    }

    fn string(&mut self) -> Result<String, SrlError> {
        let Some(quote) = self.peek() else {
            return Err(self.error("expected string quote"));
        };
        let long = self.remaining().starts_with(&quote.to_string().repeat(3));
        self.advance_n(if long { 3 } else { 1 });
        let mut output = String::new();
        loop {
            if long && self.remaining().starts_with(&quote.to_string().repeat(3)) {
                self.advance_n(3);
                return Ok(output);
            }
            match self.peek() {
                Some(value) if !long && value == quote => {
                    self.advance();
                    return Ok(output);
                }
                Some('\n' | '\r') if !long => {
                    return Err(self.error("line break in short string literal"));
                }
                Some('\\') => {
                    self.advance();
                    output.push(self.escape()?);
                }
                Some(value) => {
                    output.push(value);
                    self.advance();
                }
                None => return Err(self.error("unterminated string literal")),
            }
        }
    }

    fn escape(&mut self) -> Result<char, SrlError> {
        match self.peek() {
            Some('t') => Ok(self.escaped('\t')),
            Some('b') => Ok(self.escaped('\u{0008}')),
            Some('n') => Ok(self.escaped('\n')),
            Some('r') => Ok(self.escaped('\r')),
            Some('f') => Ok(self.escaped('\u{000C}')),
            Some('"') => Ok(self.escaped('"')),
            Some('\'') => Ok(self.escaped('\'')),
            Some('\\') => Ok(self.escaped('\\')),
            Some('u' | 'U') => self.unicode_escape(),
            _ => Err(self.error("invalid string escape")),
        }
    }

    fn escaped(&mut self, value: char) -> char {
        self.advance();
        value
    }

    fn unicode_escape(&mut self) -> Result<char, SrlError> {
        let width = match self.peek() {
            Some('u') => 4,
            Some('U') => 8,
            _ => return Err(self.error("expected Unicode escape")),
        };
        self.advance();
        let mut value = 0_u32;
        for _ in 0..width {
            let Some(digit) = self.peek().and_then(|value| value.to_digit(16)) else {
                return Err(self.error("invalid Unicode escape"));
            };
            value = value * 16 + digit;
            self.advance();
        }
        char::from_u32(value).ok_or_else(|| self.error("invalid Unicode scalar value"))
    }

    fn variable(&mut self) -> Result<String, SrlError> {
        self.advance();
        if !self.peek().is_some_and(is_var_start) {
            return Err(self.error("variable name is empty or has an invalid first character"));
        }
        let value = self.take_while(is_var_char);
        Ok(value)
    }

    fn blank_node(&mut self) -> Result<String, SrlError> {
        self.advance_n(2);
        if !self.peek().is_some_and(is_var_start) {
            return Err(self.error("blank node label has an invalid first character"));
        }
        let mut value = self.take_while(is_name_char);
        while value.ends_with('.') {
            value.pop();
            self.offset -= 1;
            self.column -= 1;
        }
        if value.is_empty() {
            Err(self.error("blank node label is empty"))
        } else {
            Ok(value)
        }
    }

    fn language_tag(&mut self) -> Result<String, SrlError> {
        self.advance();
        let value = self.take_while(|value| value.is_ascii_alphanumeric() || value == '-');
        if value.is_empty() {
            Err(self.error("language tag is empty"))
        } else {
            Ok(value)
        }
    }

    fn number_follows(&self) -> bool {
        let bytes = self.remaining().as_bytes();
        match bytes {
            [b'+' | b'-', next, ..] => next.is_ascii_digit() || *next == b'.',
            [b'.', next, ..] => next.is_ascii_digit(),
            [first, ..] => first.is_ascii_digit(),
            _ => false,
        }
    }

    fn number(&mut self) -> String {
        let start = self.offset;
        if matches!(self.peek(), Some('+' | '-')) {
            self.advance();
        }
        let integer_start = self.offset;
        self.take_while(|value| value.is_ascii_digit());
        let has_integer = self.offset > integer_start;
        if self.peek() == Some('.')
            && self.remaining().as_bytes().get(1).is_some_and(|value| {
                value.is_ascii_digit() || (has_integer && matches!(value, b'e' | b'E'))
            })
        {
            self.advance();
            self.take_while(|value| value.is_ascii_digit());
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.advance();
            if matches!(self.peek(), Some('+' | '-')) {
                self.advance();
            }
            self.take_while(|value| value.is_ascii_digit());
        }
        self.source[start..self.offset].to_owned()
    }

    fn bare(&mut self) -> Result<String, SrlError> {
        let start = self.offset;
        while let Some(value) = self.peek() {
            if value == '\\' {
                self.advance();
                if self.peek().is_some() {
                    self.advance();
                }
            } else if is_delimiter(value) {
                break;
            } else {
                self.advance();
            }
        }
        let mut value = self.source[start..self.offset].to_owned();
        while value.ends_with('.')
            && !value
                .strip_suffix('.')
                .is_some_and(|prefix| prefix.ends_with('\\'))
        {
            value.pop();
            self.offset -= 1;
            self.column -= 1;
        }
        if value.is_empty() {
            Err(self.error("empty name"))
        } else {
            Ok(value)
        }
    }

    fn take_while(&mut self, predicate: impl Fn(char) -> bool) -> String {
        let start = self.offset;
        while self.peek().is_some_and(&predicate) {
            self.advance();
        }
        self.source[start..self.offset].to_owned()
    }

    fn starts_with(&self, value: &str) -> bool {
        self.remaining().starts_with(value)
    }

    fn remaining(&self) -> &str {
        &self.source[self.offset..]
    }

    fn peek(&self) -> Option<char> {
        self.remaining().chars().next()
    }

    fn advance_n(&mut self, count: usize) {
        for _ in 0..count {
            self.advance();
        }
    }

    fn advance(&mut self) {
        let Some(value) = self.peek() else {
            return;
        };
        self.offset += value.len_utf8();
        if value == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
    }

    fn error(&self, message: impl Into<String>) -> SrlError {
        SrlError::Syntax {
            line: self.line,
            column: self.column,
            message: message.into(),
        }
    }
}
