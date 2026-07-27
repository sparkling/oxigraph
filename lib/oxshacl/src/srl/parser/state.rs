use super::Parser;
use super::builtins::{unescape_local, valid_local_name, valid_prefix_name};
use crate::srl::SrlError;
use crate::srl::lexer::TokenKind;
use oxiri::{Iri, IriRef};

impl Parser {
    pub(super) fn iri(&mut self) -> Result<String, SrlError> {
        match self.next_kind() {
            TokenKind::IriRef(value) => self.resolve_iri_ref(&value),
            TokenKind::Bare(value) if value.contains(':') => {
                let Some((prefix, local)) = value.split_once(':') else {
                    return Err(self.current_error("prefixed name has no colon"));
                };
                if !valid_prefix_name(prefix) || !valid_local_name(local) {
                    return Err(self.current_error("invalid prefixed name"));
                }
                let Some(base) = self.prefixes.get(prefix) else {
                    return Err(self.current_error(format!("undefined prefix `{prefix}:`")));
                };
                let iri = format!("{base}{}", unescape_local(local)?);
                Iri::parse(iri.clone())
                    .map(|_| iri)
                    .map_err(|error| self.current_error(format!("invalid prefixed IRI: {error}")))
            }
            _ => Err(self.expected("IRI or prefixed name")),
        }
    }

    pub(super) fn resolve_iri_ref(&self, value: &str) -> Result<String, SrlError> {
        let reference = IriRef::parse(value.to_owned())
            .map_err(|error| self.current_error(format!("invalid IRI reference: {error}")))?;
        if reference.is_absolute() {
            return Ok(reference.into_inner());
        }
        let Some(base) = &self.base_iri else {
            return Err(self.current_error(format!("relative IRI `{value}` has no in-scope base")));
        };
        let base = Iri::parse(base.clone())
            .map_err(|error| self.current_error(format!("invalid base IRI: {error}")))?;
        let mut output = String::new();
        base.resolve_into(&reference, &mut output)
            .map_err(|error| self.current_error(format!("IRI resolution failed: {error}")))?;
        Ok(output)
    }

    pub(super) fn take_iri_ref(&mut self) -> Result<String, SrlError> {
        match self.next_kind() {
            TokenKind::IriRef(value) => Ok(value),
            _ => Err(self.expected("IRI reference")),
        }
    }

    pub(super) fn variable(&mut self) -> Result<String, SrlError> {
        match self.next_kind() {
            TokenKind::Variable(value) => Ok(value),
            _ => Err(self.expected("variable")),
        }
    }

    pub(super) fn next_generated_id(&mut self) -> u64 {
        self.generated_id += 1;
        self.generated_id
    }

    pub(super) fn take_keyword(&mut self, keyword: &str) -> bool {
        if self.peek_keyword(keyword) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    pub(super) fn expect_keyword(&mut self, keyword: &str) -> Result<(), SrlError> {
        if self.take_keyword(keyword) {
            Ok(())
        } else {
            Err(self.expected(format!("`{keyword}`")))
        }
    }

    pub(super) fn peek_keyword(&self, keyword: &str) -> bool {
        matches!(
            self.peek_kind(),
            TokenKind::Bare(value)
                if if keyword == "a" {
                    value == keyword
                } else {
                    value.eq_ignore_ascii_case(keyword)
                }
        )
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
        reason = "parser call sites use token values and the value is included in diagnostics"
    )]
    pub(super) fn expect(&mut self, expected: TokenKind) -> Result<(), SrlError> {
        if self.take(&expected) {
            Ok(())
        } else {
            Err(self.expected(format!("`{expected:?}`")))
        }
    }

    pub(super) fn peek_is(&self, expected: &TokenKind) -> bool {
        std::mem::discriminant(self.peek_kind()) == std::mem::discriminant(expected)
    }

    pub(super) fn peek_next_is(&self, expected: &TokenKind) -> bool {
        self.tokens.get(self.position + 1).is_some_and(|token| {
            std::mem::discriminant(&token.kind) == std::mem::discriminant(expected)
        })
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

    pub(super) fn expected(&self, expected: impl Into<String>) -> SrlError {
        self.current_error(format!(
            "expected {}, found {:?}",
            expected.into(),
            self.peek_kind()
        ))
    }

    pub(super) fn current_error(&self, message: impl Into<String>) -> SrlError {
        let token = &self.tokens[self.position];
        SrlError::Syntax {
            line: token.line,
            column: token.column,
            message: message.into(),
        }
    }
}
