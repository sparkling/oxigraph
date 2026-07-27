use super::{ShaclcError, ShaclcLimits};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum TokenKind {
    IriRef(String),
    AtPrefixed(String),
    String(String),
    Lang(String),
    Number(String),
    Bare(String),
    LeftBrace,
    RightBrace,
    LeftBracket,
    RightBracket,
    LeftParen,
    RightParen,
    Dot,
    Pipe,
    Slash,
    Caret,
    Question,
    Star,
    Plus,
    Bang,
    Equal,
    Arrow,
    Range,
    At,
    Datatype,
    End,
}

#[derive(Clone, Debug)]
pub(super) struct Token {
    pub kind: TokenKind,
    pub line: usize,
    pub column: usize,
}

pub(super) fn tokenize(source: &str, limits: &ShaclcLimits) -> Result<Vec<Token>, ShaclcError> {
    Lexer::new(source, limits.max_tokens).tokenize()
}

struct Lexer<'a> {
    source: &'a str,
    offset: usize,
    line: usize,
    column: usize,
    max_tokens: usize,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str, max_tokens: usize) -> Self {
        Self {
            source,
            offset: 0,
            line: 1,
            column: 1,
            max_tokens,
        }
    }

    fn tokenize(mut self) -> Result<Vec<Token>, ShaclcError> {
        let mut output = Vec::new();
        loop {
            self.skip_trivia();
            let line = self.line;
            let column = self.column;
            let Some(first) = self.peek() else {
                self.push(&mut output, TokenKind::End, line, column)?;
                return Ok(output);
            };
            let kind = match first {
                '-' if self.starts_with("->") => {
                    self.advance_n(2);
                    TokenKind::Arrow
                }
                '.' if self.starts_with("..") => {
                    self.advance_n(2);
                    TokenKind::Range
                }
                '^' if self.starts_with("^^") => {
                    self.advance_n(2);
                    TokenKind::Datatype
                }
                '<' => TokenKind::IriRef(self.iri_ref()?),
                '\'' | '"' => TokenKind::String(self.string()?),
                '@' => self.at_token()?,
                '+' | '-' | '.' | '0'..='9' if self.number_follows() => {
                    TokenKind::Number(self.number())
                }
                '{' => self.single(TokenKind::LeftBrace),
                '}' => self.single(TokenKind::RightBrace),
                '[' => self.single(TokenKind::LeftBracket),
                ']' => self.single(TokenKind::RightBracket),
                '(' => self.single(TokenKind::LeftParen),
                ')' => self.single(TokenKind::RightParen),
                '.' => self.single(TokenKind::Dot),
                '|' => self.single(TokenKind::Pipe),
                '/' => self.single(TokenKind::Slash),
                '^' => self.single(TokenKind::Caret),
                '?' => self.single(TokenKind::Question),
                '*' => self.single(TokenKind::Star),
                '+' => self.single(TokenKind::Plus),
                '!' => self.single(TokenKind::Bang),
                '=' => self.single(TokenKind::Equal),
                _ if !is_delimiter(first) => TokenKind::Bare(self.bare()?),
                _ => {
                    return Err(self.error(format!("unexpected character U+{:04X}", first as u32)));
                }
            };
            self.push(&mut output, kind, line, column)?;
        }
    }

    fn push(
        &self,
        output: &mut Vec<Token>,
        kind: TokenKind,
        line: usize,
        column: usize,
    ) -> Result<(), ShaclcError> {
        if output.len() >= self.max_tokens {
            return Err(ShaclcError::LimitExceeded {
                kind: "tokens",
                limit: self.max_tokens,
            });
        }
        output.push(Token { kind, line, column });
        Ok(())
    }

    fn skip_trivia(&mut self) {
        loop {
            while self.peek().is_some_and(is_pass) {
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

    fn iri_ref(&mut self) -> Result<String, ShaclcError> {
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
                Some(value)
                    if value <= '\u{20}'
                        || matches!(value, '=' | '<' | '"' | '{' | '}' | '|' | '^' | '`') =>
                {
                    return Err(self.error("forbidden character in IRI reference"));
                }
                Some(value) => {
                    output.push(value);
                    self.advance();
                }
                None => return Err(self.error("unterminated IRI reference")),
            }
        }
    }

    fn string(&mut self) -> Result<String, ShaclcError> {
        let quote = self.peek().ok_or_else(|| self.error("expected quote"))?;
        let marker = quote.to_string().repeat(3);
        let long = self.remaining().starts_with(&marker);
        self.advance_n(if long { 3 } else { 1 });
        let mut output = String::new();
        loop {
            if long && self.remaining().starts_with(&marker) {
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

    fn escape(&mut self) -> Result<char, ShaclcError> {
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

    fn unicode_escape(&mut self) -> Result<char, ShaclcError> {
        let width = match self.peek() {
            Some('u') => 4,
            Some('U') => 8,
            _ => return Err(self.error("expected Unicode escape")),
        };
        self.advance();
        let mut value = 0_u32;
        for _ in 0..width {
            let digit = self
                .peek()
                .and_then(|value| value.to_digit(16))
                .ok_or_else(|| self.error("invalid Unicode escape"))?;
            value = value * 16 + digit;
            self.advance();
        }
        char::from_u32(value).ok_or_else(|| self.error("invalid Unicode scalar value"))
    }

    fn at_token(&mut self) -> Result<TokenKind, ShaclcError> {
        self.advance();
        if self
            .peek()
            .is_none_or(|value| value == '<' || value == '#' || is_pass(value))
        {
            return Ok(TokenKind::At);
        }
        let value = self.bare()?;
        if value.contains(':') {
            Ok(TokenKind::AtPrefixed(value))
        } else if valid_language_tag(&value) {
            Ok(TokenKind::Lang(value))
        } else {
            Err(self.error("invalid language tag or shape reference"))
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
        self.take_digits();
        if self.peek() == Some('.')
            && !self.starts_with("..")
            && self
                .remaining()
                .as_bytes()
                .get(1)
                .is_some_and(|value| value.is_ascii_digit() || matches!(value, b'e' | b'E'))
        {
            self.advance();
            self.take_digits();
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.advance();
            if matches!(self.peek(), Some('+' | '-')) {
                self.advance();
            }
            self.take_digits();
        }
        self.source[start..self.offset].to_owned()
    }

    fn bare(&mut self) -> Result<String, ShaclcError> {
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
        while value.ends_with('.') && !trailing_dot_is_escaped(&value) {
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

    fn take_digits(&mut self) {
        while self.peek().is_some_and(|value| value.is_ascii_digit()) {
            self.advance();
        }
    }

    fn single(&mut self, kind: TokenKind) -> TokenKind {
        self.advance();
        kind
    }

    fn escaped(&mut self, value: char) -> char {
        self.advance();
        value
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

    fn error(&self, message: impl Into<String>) -> ShaclcError {
        ShaclcError::Syntax {
            line: self.line,
            column: self.column,
            message: message.into(),
        }
    }
}

fn is_delimiter(value: char) -> bool {
    is_pass(value)
        || matches!(
            value,
            '#' | '<'
                | '>'
                | '"'
                | '\''
                | '{'
                | '}'
                | '['
                | ']'
                | '('
                | ')'
                | '|'
                | '/'
                | '^'
                | '?'
                | '*'
                | '+'
                | '!'
                | '='
                | '@'
        )
}

fn is_pass(value: char) -> bool {
    matches!(value, ' ' | '\t' | '\r' | '\n')
}

fn valid_language_tag(value: &str) -> bool {
    let mut parts = value.split('-');
    parts.next().is_some_and(|part| {
        !part.is_empty() && part.bytes().all(|value| value.is_ascii_alphabetic())
    }) && parts
        .all(|part| !part.is_empty() && part.bytes().all(|value| value.is_ascii_alphanumeric()))
}

fn trailing_dot_is_escaped(value: &str) -> bool {
    value.strip_suffix('.').is_some_and(|value| {
        value
            .chars()
            .rev()
            .take_while(|value| *value == '\\')
            .count()
            % 2
            == 1
    })
}
