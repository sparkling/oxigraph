#![expect(
    clippy::multiple_inherent_impl,
    reason = "the recursive-descent parser is split to keep each source file auditable"
)]

mod path;
mod shape;
mod value;

use super::lexer::{Token, TokenKind, tokenize};
use super::model::Document;
use super::{ShaclcError, ShaclcLimits};
use oxiri::{Iri, IriRef};
use std::collections::BTreeMap;

pub(super) fn parse(
    source: &str,
    base: Option<String>,
    limits: &ShaclcLimits,
) -> Result<oxrdf::Dataset, ShaclcError> {
    let tokens = tokenize(source, limits)?;
    let mut prefixes = BTreeMap::new();
    prefixes.insert(
        "rdf".to_owned(),
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#".to_owned(),
    );
    prefixes.insert(
        "rdfs".to_owned(),
        "http://www.w3.org/2000/01/rdf-schema#".to_owned(),
    );
    prefixes.insert("sh".to_owned(), "http://www.w3.org/ns/shacl#".to_owned());
    prefixes.insert(
        "xsd".to_owned(),
        "http://www.w3.org/2001/XMLSchema#".to_owned(),
    );
    let document = Parser {
        tokens,
        position: 0,
        base,
        prefixes,
        imports: Vec::new(),
        limits,
    }
    .document()?;
    super::rdf::map_document(&document, limits)
}

pub(super) struct Parser<'a> {
    tokens: Vec<Token>,
    position: usize,
    base: Option<String>,
    prefixes: BTreeMap<String, String>,
    imports: Vec<String>,
    limits: &'a ShaclcLimits,
}

impl Parser<'_> {
    fn document(mut self) -> Result<Document, ShaclcError> {
        while self.directive()? {}
        let mut shapes = Vec::new();
        while !self.at_end() {
            if shapes.len() >= self.limits.max_shapes {
                return Err(ShaclcError::LimitExceeded {
                    kind: "shapes",
                    limit: self.limits.max_shapes,
                });
            }
            shapes.push(self.shape(0)?);
        }
        if self.base.is_none() && !self.imports.is_empty() {
            return Err(ShaclcError::ImportsWithoutBase);
        }
        Ok(Document {
            base: self.base,
            imports: self.imports,
            shapes,
        })
    }

    fn directive(&mut self) -> Result<bool, ShaclcError> {
        if self.take_keyword("BASE") {
            let value = self.iri_ref_token()?;
            self.base = Some(self.resolve_iri_ref(&value)?);
            return Ok(true);
        }
        if self.take_keyword("IMPORTS") {
            let value = self.iri_ref_token()?;
            let value = self.resolve_iri_ref(&value)?;
            self.imports.push(value);
            return Ok(true);
        }
        if self.take_keyword("PREFIX") {
            let TokenKind::Bare(value) = self.next_kind() else {
                return Err(self.expected("prefix name"));
            };
            let Some(prefix) = value.strip_suffix(':') else {
                return Err(self.current_error("prefix name must end in `:`"));
            };
            if !valid_prefix_name(prefix) {
                return Err(self.current_error("invalid prefix name"));
            }
            let namespace = self.iri_ref_token()?;
            let namespace = self.resolve_iri_ref(&namespace)?;
            self.prefixes.insert(prefix.to_owned(), namespace);
            return Ok(true);
        }
        Ok(false)
    }

    pub(super) fn iri(&mut self) -> Result<String, ShaclcError> {
        match self.next_kind() {
            TokenKind::IriRef(value) => self.resolve_iri_ref(&value),
            TokenKind::Bare(value) if value.contains(':') => self.prefixed_name(&value),
            _ => Err(self.expected("IRI or prefixed name")),
        }
    }

    pub(super) fn shape_reference(&mut self) -> Result<String, ShaclcError> {
        match self.next_kind() {
            TokenKind::AtPrefixed(value) => self.prefixed_name(&value),
            TokenKind::At => match self.peek_kind().clone() {
                TokenKind::IriRef(value) => {
                    self.next_kind();
                    self.resolve_iri_ref(&value)
                }
                _ => Err(self.expected("IRI reference after `@`")),
            },
            _ => Err(self.expected("shape reference")),
        }
    }

    fn prefixed_name(&self, value: &str) -> Result<String, ShaclcError> {
        let Some((prefix, local)) = value.split_once(':') else {
            return Err(self.current_error("prefixed name has no colon"));
        };
        if !valid_prefix_name(prefix) || !valid_local_name(local) {
            return Err(self.current_error("invalid prefixed name"));
        }
        let namespace = self
            .prefixes
            .get(prefix)
            .ok_or_else(|| self.current_error(format!("undefined prefix `{prefix}:`")))?;
        let iri = format!("{namespace}{}", unescape_local(local)?);
        Iri::parse(iri.clone())
            .map(|_| iri)
            .map_err(|error| self.current_error(format!("invalid prefixed IRI: {error}")))
    }

    fn resolve_iri_ref(&self, value: &str) -> Result<String, ShaclcError> {
        let reference = IriRef::parse(value.to_owned())
            .map_err(|error| self.current_error(format!("invalid IRI reference: {error}")))?;
        if reference.is_absolute() {
            return Ok(reference.into_inner());
        }
        let base = self
            .base
            .as_ref()
            .ok_or_else(|| self.current_error("relative IRI has no base"))?;
        let base = Iri::parse(base.clone())
            .map_err(|error| self.current_error(format!("invalid base IRI: {error}")))?;
        let mut output = String::new();
        base.resolve_into(&reference, &mut output)
            .map_err(|error| self.current_error(format!("IRI resolution failed: {error}")))?;
        Ok(output)
    }

    fn iri_ref_token(&mut self) -> Result<String, ShaclcError> {
        match self.next_kind() {
            TokenKind::IriRef(value) => Ok(value),
            _ => Err(self.expected("IRI reference")),
        }
    }

    pub(super) fn check_depth(&self, depth: usize) -> Result<(), ShaclcError> {
        if depth > self.limits.max_nesting_depth {
            Err(ShaclcError::LimitExceeded {
                kind: "nesting depth",
                limit: self.limits.max_nesting_depth,
            })
        } else {
            Ok(())
        }
    }

    pub(super) fn check_list(&self, count: usize) -> Result<(), ShaclcError> {
        if count > self.limits.max_list_items {
            Err(ShaclcError::LimitExceeded {
                kind: "list items",
                limit: self.limits.max_list_items,
            })
        } else {
            Ok(())
        }
    }

    pub(super) fn take_keyword(&mut self, keyword: &str) -> bool {
        if matches!(self.peek_kind(), TokenKind::Bare(value) if value == keyword) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    pub(super) fn take(&mut self, expected: &TokenKind) -> bool {
        if self.peek_is(expected) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    #[expect(
        clippy::needless_pass_by_value,
        reason = "call sites use token values and diagnostics retain the expected token"
    )]
    pub(super) fn expect(&mut self, expected: TokenKind) -> Result<(), ShaclcError> {
        if self.take(&expected) {
            Ok(())
        } else {
            Err(self.expected(format!("`{expected:?}`")))
        }
    }

    pub(super) fn peek_is(&self, expected: &TokenKind) -> bool {
        std::mem::discriminant(self.peek_kind()) == std::mem::discriminant(expected)
    }

    pub(super) fn peek_kind(&self) -> &TokenKind {
        &self.tokens[self.position].kind
    }

    pub(super) fn next_kind(&mut self) -> TokenKind {
        let value = self.peek_kind().clone();
        if !matches!(value, TokenKind::End) {
            self.position += 1;
        }
        value
    }

    pub(super) fn at_end(&self) -> bool {
        matches!(self.peek_kind(), TokenKind::End)
    }

    pub(super) fn expected(&self, expected: impl Into<String>) -> ShaclcError {
        self.current_error(format!(
            "expected {}, found {:?}",
            expected.into(),
            self.peek_kind()
        ))
    }

    pub(super) fn current_error(&self, message: impl Into<String>) -> ShaclcError {
        let token = &self.tokens[self.position];
        ShaclcError::Syntax {
            line: token.line,
            column: token.column,
            message: message.into(),
        }
    }
}

fn unescape_local(value: &str) -> Result<String, ShaclcError> {
    let mut output = String::new();
    let mut chars = value.chars();
    while let Some(value) = chars.next() {
        if value == '\\' {
            output.push(chars.next().ok_or_else(|| ShaclcError::Syntax {
                line: 0,
                column: 0,
                message: "trailing prefixed-name escape".to_owned(),
            })?);
        } else {
            output.push(value);
        }
    }
    Ok(output)
}

fn valid_prefix_name(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let mut chars = value.chars();
    chars.next().is_some_and(is_pn_chars_base)
        && !value.ends_with('.')
        && chars.all(|value| is_pn_chars(value) || value == '.')
}

fn valid_local_name(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let chars = value.chars().collect::<Vec<_>>();
    if !(is_pn_chars_u(chars[0])
        || chars[0].is_ascii_digit()
        || matches!(chars[0], ':' | '%' | '\\'))
        || local_ends_with_unescaped_dot(value)
    {
        return false;
    }
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            '%' if index + 2 < chars.len()
                && chars[index + 1].is_ascii_hexdigit()
                && chars[index + 2].is_ascii_hexdigit() =>
            {
                index += 3;
            }
            '\\' if index + 1 < chars.len() && is_local_escape(chars[index + 1]) => index += 2,
            value if is_pn_chars(value) || matches!(value, ':' | '.') => index += 1,
            _ => return false,
        }
    }
    true
}

fn local_ends_with_unescaped_dot(value: &str) -> bool {
    value.strip_suffix('.').is_some_and(|value| {
        value
            .chars()
            .rev()
            .take_while(|value| *value == '\\')
            .count()
            % 2
            == 0
    })
}

fn is_pn_chars_base(value: char) -> bool {
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
        )
}

fn is_pn_chars_u(value: char) -> bool {
    is_pn_chars_base(value) || value == '_'
}

fn is_pn_chars(value: char) -> bool {
    is_pn_chars_u(value)
        || value == '-'
        || value.is_ascii_digit()
        || value == '\u{00B7}'
        || matches!(value, '\u{0300}'..='\u{036F}' | '\u{203F}'..='\u{2040}')
}

fn is_local_escape(value: char) -> bool {
    matches!(
        value,
        '_' | '~'
            | '.'
            | '-'
            | '!'
            | '$'
            | '&'
            | '\''
            | '('
            | ')'
            | '*'
            | '+'
            | ','
            | ';'
            | '='
            | '/'
            | '?'
            | '#'
            | '@'
            | '%'
    )
}
