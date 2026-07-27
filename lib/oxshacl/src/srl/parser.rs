#![expect(
    clippy::multiple_inherent_impl,
    reason = "the recursive-descent parser is split to keep each source file auditable"
)]

mod builtins;
mod nodes;
mod state;

use super::lexer::{Token, TokenKind, tokenize};
use super::{
    ProfileSet, SrlBinaryOperator, SrlBodyElement, SrlError, SrlExpression, SrlItem, SrlRule,
    SrlRuleSet, SrlUnaryOperator,
};
use std::collections::BTreeMap;

use self::builtins::{is_builtin, valid_builtin_arity, valid_prefix_name};

const SUPPORTED_VERSION_LABEL: &str = "1.2";

pub(super) fn parse(
    source: &str,
    base_iri: Option<&str>,
    profiles: ProfileSet,
) -> Result<SrlRuleSet, SrlError> {
    let tokens = tokenize(source)?;
    Parser {
        tokens,
        position: 0,
        prefixes: BTreeMap::new(),
        base_iri: base_iri.map(ToOwned::to_owned),
        generated_id: 0,
        profiles,
        items: Vec::new(),
        imports: Vec::new(),
        versions: Vec::new(),
        semantic_extensions: std::collections::BTreeSet::new(),
    }
    .rule_set()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NodeMode {
    Data,
    Template,
    Pattern,
    Expression,
}

pub(super) struct Parser {
    tokens: Vec<Token>,
    position: usize,
    prefixes: BTreeMap<String, String>,
    base_iri: Option<String>,
    generated_id: u64,
    profiles: ProfileSet,
    items: Vec<SrlItem>,
    imports: Vec<String>,
    versions: Vec<String>,
    semantic_extensions: std::collections::BTreeSet<String>,
}

impl Parser {
    fn rule_set(mut self) -> Result<SrlRuleSet, SrlError> {
        loop {
            while self.prologue()? {}
            if self.at_end() {
                break;
            }
            if self.take_keyword("DATA") {
                let triples = self.triple_block(NodeMode::Data, TokenKind::RightBrace)?;
                self.items.push(SrlItem::Data(triples));
            } else if self.take_keyword("RULE") {
                let rule = self.rule_one()?;
                self.items.push(SrlItem::Rule(rule));
            } else if self.take_keyword("IF") {
                let rule = self.rule_two()?;
                self.items.push(SrlItem::Rule(rule));
            } else {
                return Err(self.expected("RULE, IF, DATA, or a prologue declaration"));
            }
        }
        let item_scopes = vec![0; self.items.len()];
        Ok(SrlRuleSet {
            profiles: self.profiles,
            items: self.items,
            item_scopes,
            imports: self.imports,
            versions: self.versions,
            semantic_extensions: self.semantic_extensions,
        })
    }

    fn prologue(&mut self) -> Result<bool, SrlError> {
        if self.take_keyword("BASE") {
            let value = self.take_iri_ref()?;
            self.base_iri = Some(self.resolve_iri_ref(&value)?);
            return Ok(true);
        }
        if self.take_keyword("PREFIX") {
            let prefix = match self.next_kind() {
                TokenKind::Bare(value) if value.ends_with(':') => {
                    value.strip_suffix(':').unwrap_or_default().to_owned()
                }
                _ => return Err(self.expected("prefix name ending in `:`")),
            };
            if !valid_prefix_name(&prefix) {
                return Err(self.current_error("invalid prefix name"));
            }
            let value = self.take_iri_ref()?;
            let iri = self.resolve_iri_ref(&value)?;
            self.prefixes.insert(prefix, iri);
            return Ok(true);
        }
        if self.take_keyword("VERSION") {
            let TokenKind::String(value) = self.next_kind() else {
                return Err(self.expected("version string"));
            };
            if value != SUPPORTED_VERSION_LABEL {
                return Err(SrlError::Profile(format!(
                    "version label `{value}` is not supported by the dated SHACL 1.2 Rules subset"
                )));
            }
            self.versions.push(value);
            return Ok(true);
        }
        if self.take_keyword("IMPORTS") {
            let iri = self.iri()?;
            self.imports.push(iri);
            return Ok(true);
        }
        Ok(false)
    }

    fn rule_one(&mut self) -> Result<SrlRule, SrlError> {
        let id = if self.peek_is(&TokenKind::LeftBrace) {
            None
        } else {
            Some(self.iri()?)
        };
        let head = self.triple_block(NodeMode::Template, TokenKind::RightBrace)?;
        let for_clause = self.for_clause()?;
        self.expect_keyword("WHERE")?;
        let data_only = self.take_keyword("DATA");
        let body = self.body()?;
        Ok(SrlRule {
            id,
            head,
            body,
            for_clause,
            data_only,
        })
    }

    fn rule_two(&mut self) -> Result<SrlRule, SrlError> {
        let id = if self.peek_is(&TokenKind::LeftBrace)
            || self.peek_keyword("FOR")
            || self.peek_keyword("DATA")
        {
            None
        } else {
            Some(self.iri()?)
        };
        let for_clause = self.for_clause()?;
        let data_only = self.take_keyword("DATA");
        let body = self.body()?;
        self.expect_keyword("THEN")?;
        let head = self.triple_block(NodeMode::Template, TokenKind::RightBrace)?;
        Ok(SrlRule {
            id,
            head,
            body,
            for_clause,
            data_only,
        })
    }

    fn for_clause(&mut self) -> Result<Option<(String, String)>, SrlError> {
        if !self.take_keyword("FOR") {
            return Ok(None);
        }
        let variable = self.variable()?;
        self.expect_keyword("IN")?;
        Ok(Some((variable, self.iri()?)))
    }

    fn body(&mut self) -> Result<Vec<SrlBodyElement>, SrlError> {
        self.expect(TokenKind::LeftBrace)?;
        let mut output = Vec::new();
        while !self.take(&TokenKind::RightBrace) {
            if self.at_end() {
                return Err(self.expected("`}`"));
            }
            if self.take_keyword("FILTER") {
                output.push(SrlBodyElement::Filter(self.constraint()?));
            } else if self.take_keyword("NOT") {
                let data_only = self.take_keyword("DATA");
                output.push(SrlBodyElement::Negation {
                    data_only,
                    body: self.basic_body()?,
                });
            } else if self.take_keyword("SET") {
                self.expect(TokenKind::LeftParen)?;
                let variable = self.variable()?;
                self.expect(TokenKind::Assign)?;
                let expression = self.expression(0)?;
                self.expect(TokenKind::RightParen)?;
                output.push(SrlBodyElement::Assignment {
                    variable,
                    expression,
                });
            } else {
                let triples = self.triples_same_subject(NodeMode::Pattern)?;
                output.extend(triples.into_iter().map(SrlBodyElement::Triple));
                if !self.peek_is(&TokenKind::Dot)
                    && !self.peek_is(&TokenKind::RightBrace)
                    && !self.peek_keyword("FILTER")
                    && !self.peek_keyword("NOT")
                    && !self.peek_keyword("SET")
                {
                    return Err(self.expected("`.` or a non-triple body element"));
                }
            }
            self.take(&TokenKind::Dot);
        }
        Ok(output)
    }

    fn basic_body(&mut self) -> Result<Vec<SrlBodyElement>, SrlError> {
        self.expect(TokenKind::LeftBrace)?;
        let mut output = Vec::new();
        while !self.take(&TokenKind::RightBrace) {
            if self.at_end() {
                return Err(self.expected("`}`"));
            }
            if self.take_keyword("FILTER") {
                output.push(SrlBodyElement::Filter(self.constraint()?));
            } else if self.peek_keyword("NOT") || self.peek_keyword("SET") {
                return Err(self.expected("triple pattern or FILTER inside NOT"));
            } else {
                output.extend(
                    self.triples_same_subject(NodeMode::Pattern)?
                        .into_iter()
                        .map(SrlBodyElement::Triple),
                );
                if !self.peek_is(&TokenKind::Dot)
                    && !self.peek_is(&TokenKind::RightBrace)
                    && !self.peek_keyword("FILTER")
                {
                    return Err(self.expected("`.` or FILTER inside NOT"));
                }
            }
            self.take(&TokenKind::Dot);
        }
        Ok(output)
    }

    fn constraint(&mut self) -> Result<SrlExpression, SrlError> {
        if self.peek_is(&TokenKind::LeftParen) {
            return self.expression(0);
        }
        let saved = self.position;
        self.function_name()?;
        if !self.peek_is(&TokenKind::LeftParen) {
            return Err(self.expected("argument list in FILTER constraint"));
        }
        self.position = saved;
        self.expression(0)
    }

    fn expression(&mut self, minimum_precedence: u8) -> Result<SrlExpression, SrlError> {
        let mut left = if self.take(&TokenKind::Bang) {
            SrlExpression::Unary {
                operator: SrlUnaryOperator::Not,
                operand: Box::new(self.primary_expression()?),
            }
        } else if self.take(&TokenKind::Plus) {
            SrlExpression::Unary {
                operator: SrlUnaryOperator::Plus,
                operand: Box::new(self.primary_expression()?),
            }
        } else if self.take(&TokenKind::Minus) {
            SrlExpression::Unary {
                operator: SrlUnaryOperator::Minus,
                operand: Box::new(self.primary_expression()?),
            }
        } else {
            self.primary_expression()?
        };
        let mut relational_complete = false;
        loop {
            if minimum_precedence <= 4
                && matches!(
                    self.peek_kind(),
                    TokenKind::Number(value)
                        if value.starts_with('+') || value.starts_with('-')
                )
            {
                if relational_complete {
                    return Err(self.expected("logical operator after relational expression"));
                }
                let right = self.expression(5)?;
                left = SrlExpression::Binary {
                    operator: SrlBinaryOperator::Add,
                    left: Box::new(left),
                    right: Box::new(right),
                };
                continue;
            }
            if self.peek_keyword("IN") || self.peek_keyword("NOT") {
                if minimum_precedence > 3 {
                    break;
                }
                if relational_complete {
                    return Err(self.expected("only one relational operator"));
                }
                let negated = self.take_keyword("NOT");
                self.expect_keyword("IN")?;
                let values = self.expression_list()?;
                left = SrlExpression::In {
                    value: Box::new(left),
                    values,
                    negated,
                };
                relational_complete = true;
                continue;
            }
            let Some((operator, precedence)) = self.binary_operator() else {
                break;
            };
            if precedence < minimum_precedence {
                break;
            }
            if relational_complete && precedence >= 3 {
                return Err(self.expected("logical operator after relational expression"));
            }
            self.position += 1;
            let right = self.expression(precedence + 1)?;
            left = SrlExpression::Binary {
                operator,
                left: Box::new(left),
                right: Box::new(right),
            };
            relational_complete |= precedence == 3;
        }
        Ok(left)
    }

    fn primary_expression(&mut self) -> Result<SrlExpression, SrlError> {
        if self.take(&TokenKind::LeftParen) {
            let value = self.expression(0)?;
            self.expect(TokenKind::RightParen)?;
            return Ok(value);
        }
        if matches!(self.peek_kind(), TokenKind::Bare(_) | TokenKind::IriRef(_)) {
            let saved = self.position;
            if let Ok(function) = self.function_name() {
                if self.peek_is(&TokenKind::LeftParen) {
                    let arguments = self.expression_list()?;
                    if is_builtin(&function) && !valid_builtin_arity(&function, arguments.len()) {
                        return Err(self.current_error(format!(
                            "invalid argument count {} for built-in `{function}`",
                            arguments.len()
                        )));
                    }
                    return Ok(SrlExpression::Call {
                        function,
                        arguments,
                    });
                }
            }
            self.position = saved;
        }
        Ok(SrlExpression::Node(self.node(NodeMode::Expression, false)?))
    }

    fn expression_list(&mut self) -> Result<Vec<SrlExpression>, SrlError> {
        self.expect(TokenKind::LeftParen)?;
        if self.take(&TokenKind::RightParen) {
            return Ok(Vec::new());
        }
        let mut output = vec![self.expression(0)?];
        while self.take(&TokenKind::Comma) {
            output.push(self.expression(0)?);
        }
        self.expect(TokenKind::RightParen)?;
        Ok(output)
    }

    fn function_name(&mut self) -> Result<String, SrlError> {
        match self.peek_kind() {
            TokenKind::Bare(value) if !value.contains(':') && is_builtin(value) => {
                let value = value.clone();
                self.position += 1;
                Ok(value)
            }
            _ => self.iri(),
        }
    }

    fn binary_operator(&self) -> Option<(SrlBinaryOperator, u8)> {
        Some(match self.peek_kind() {
            TokenKind::Or => (SrlBinaryOperator::Or, 1),
            TokenKind::And => (SrlBinaryOperator::And, 2),
            TokenKind::Equal => (SrlBinaryOperator::Equal, 3),
            TokenKind::NotEqual => (SrlBinaryOperator::NotEqual, 3),
            TokenKind::Less => (SrlBinaryOperator::Less, 3),
            TokenKind::Greater => (SrlBinaryOperator::Greater, 3),
            TokenKind::LessOrEqual => (SrlBinaryOperator::LessOrEqual, 3),
            TokenKind::GreaterOrEqual => (SrlBinaryOperator::GreaterOrEqual, 3),
            TokenKind::Plus => (SrlBinaryOperator::Add, 4),
            TokenKind::Minus => (SrlBinaryOperator::Subtract, 4),
            TokenKind::Star => (SrlBinaryOperator::Multiply, 5),
            TokenKind::Slash => (SrlBinaryOperator::Divide, 5),
            _ => return None,
        })
    }
}
