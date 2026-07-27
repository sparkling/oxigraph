use super::{NodeMode, Parser};
use crate::srl::lexer::TokenKind;
use crate::srl::{
    SrlAnnotation, SrlConstant, SrlError, SrlNode, SrlPathElement, SrlPredicate, SrlProperty,
    SrlTriple,
};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_DECIMAL: &str = "http://www.w3.org/2001/XMLSchema#decimal";
const XSD_DOUBLE: &str = "http://www.w3.org/2001/XMLSchema#double";

impl Parser {
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the delimiter value is retained in syntax diagnostics"
    )]
    pub(super) fn triple_block(
        &mut self,
        mode: NodeMode,
        end: TokenKind,
    ) -> Result<Vec<SrlTriple>, SrlError> {
        self.expect(TokenKind::LeftBrace)?;
        let mut output = Vec::new();
        while !self.take(&end) {
            if self.at_end() {
                return Err(self.expected(format!("`{end:?}`")));
            }
            output.extend(self.triples_same_subject(mode)?);
            if self.take(&TokenKind::Dot) {
                continue;
            }
            if !self.take(&end) {
                return Err(self.expected("`.` or end of triple block"));
            }
            return Ok(output);
        }
        Ok(output)
    }

    pub(super) fn triples_same_subject(
        &mut self,
        mode: NodeMode,
    ) -> Result<Vec<SrlTriple>, SrlError> {
        let subject = self.node(mode, true)?;
        if is_property_end(self.peek_kind()) {
            return match subject {
                SrlNode::PropertyList { id, properties } => Ok(properties
                    .into_iter()
                    .flat_map(|property| {
                        property.objects.into_iter().map({
                            let predicate = property.predicate.clone();
                            move |object| SrlTriple {
                                subject: SrlNode::GeneratedBlankNode(id),
                                predicate: predicate.clone(),
                                object,
                            }
                        })
                    })
                    .collect()),
                SrlNode::Reified { .. } => {
                    self.semantic_extensions
                        .insert("standalone reified-triple assertion".to_owned());
                    Ok(Vec::new())
                }
                SrlNode::Collection { .. } => {
                    self.semantic_extensions
                        .insert("standalone collection expansion".to_owned());
                    Ok(Vec::new())
                }
                _ => Err(self.expected("non-empty property list")),
            };
        }
        let properties = self.property_list(mode)?;
        Ok(properties
            .into_iter()
            .flat_map(|property| {
                property.objects.into_iter().map({
                    let subject = subject.clone();
                    let predicate = property.predicate.clone();
                    move |object| SrlTriple {
                        subject: subject.clone(),
                        predicate: predicate.clone(),
                        object,
                    }
                })
            })
            .collect())
    }

    fn property_list(&mut self, mode: NodeMode) -> Result<Vec<SrlProperty>, SrlError> {
        let mut output = Vec::new();
        loop {
            let predicate = self.predicate(mode)?;
            let mut objects = vec![self.object(mode)?];
            while self.take(&TokenKind::Comma) {
                objects.push(self.object(mode)?);
            }
            output.push(SrlProperty { predicate, objects });
            if !self.take(&TokenKind::Semicolon) {
                break;
            }
            if is_property_end(self.peek_kind()) {
                break;
            }
        }
        Ok(output)
    }

    fn predicate(&mut self, mode: NodeMode) -> Result<SrlPredicate, SrlError> {
        if mode == NodeMode::Pattern {
            if matches!(self.peek_kind(), TokenKind::Variable(_)) {
                return Ok(SrlPredicate::Node(SrlNode::Variable(self.variable()?)));
            }
            return Ok(SrlPredicate::Path(self.path()?));
        }
        if mode == NodeMode::Template && matches!(self.peek_kind(), TokenKind::Variable(_)) {
            return Ok(SrlPredicate::Node(SrlNode::Variable(self.variable()?)));
        }
        let iri = if self.take_keyword("a") {
            RDF_TYPE.to_owned()
        } else {
            self.iri()?
        };
        Ok(SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(iri))))
    }

    fn path(&mut self) -> Result<Vec<SrlPathElement>, SrlError> {
        let mut output = self.path_element()?;
        while self.take(&TokenKind::Slash) {
            output.extend(self.path_element()?);
        }
        Ok(output)
    }

    fn path_element(&mut self) -> Result<Vec<SrlPathElement>, SrlError> {
        let inverse = self.take(&TokenKind::Caret);
        if self.take(&TokenKind::LeftParen) {
            let mut nested = self.path()?;
            self.expect(TokenKind::RightParen)?;
            if inverse {
                nested.reverse();
                for element in &mut nested {
                    element.inverse = !element.inverse;
                }
            }
            return Ok(nested);
        }
        let iri = if self.take_keyword("a") {
            RDF_TYPE.to_owned()
        } else {
            self.iri()?
        };
        Ok(vec![SrlPathElement { inverse, iri }])
    }

    fn object(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        let value = self.node(mode, false)?;
        let mut annotations = Vec::new();
        while self.peek_is(&TokenKind::Tilde) || self.peek_is(&TokenKind::AnnotationStart) {
            let reifier = if self.take(&TokenKind::Tilde) {
                if starts_reifier(self.peek_kind()) {
                    Some(self.reifier(mode)?)
                } else {
                    None
                }
            } else {
                None
            };
            let properties = if self.take(&TokenKind::AnnotationStart) {
                if self.peek_is(&TokenKind::AnnotationEnd) {
                    return Err(self.expected("non-empty annotation property list"));
                }
                let properties = self.property_list(mode)?;
                self.expect(TokenKind::AnnotationEnd)?;
                properties
            } else {
                Vec::new()
            };
            annotations.push(SrlAnnotation {
                reifier,
                properties,
            });
        }
        if annotations.is_empty() {
            Ok(value)
        } else {
            let id = self.next_generated_id();
            Ok(SrlNode::Annotated {
                id,
                value: Box::new(value),
                annotations,
            })
        }
    }

    pub(super) fn node(&mut self, mode: NodeMode, subject: bool) -> Result<SrlNode, SrlError> {
        match self.next_kind() {
            TokenKind::Variable(value) if mode != NodeMode::Data => Ok(SrlNode::Variable(value)),
            TokenKind::IriRef(_) => {
                self.position_back();
                Ok(SrlNode::Constant(SrlConstant::Iri(self.iri()?)))
            }
            TokenKind::Bare(value) if value.contains(':') => {
                self.position_back();
                Ok(SrlNode::Constant(SrlConstant::Iri(self.iri()?)))
            }
            TokenKind::Bare(value)
                if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") =>
            {
                Ok(SrlNode::Constant(SrlConstant::Boolean(
                    value.eq_ignore_ascii_case("true"),
                )))
            }
            TokenKind::String(lexical) | TokenKind::LongString(lexical) => self.literal(lexical),
            TokenKind::Number(lexical) => self.numeric(lexical),
            TokenKind::BlankNode(value) if mode != NodeMode::Expression => {
                Ok(SrlNode::Constant(SrlConstant::BlankNode(value)))
            }
            TokenKind::LeftBracket if mode != NodeMode::Expression => {
                self.blank_property_list(mode)
            }
            TokenKind::LeftParen if mode != NodeMode::Expression => self.collection(mode),
            TokenKind::ReifiedStart if mode != NodeMode::Expression => self.reified(mode),
            TokenKind::TripleStart => self.triple_term(mode),
            token => {
                self.position_back();
                let role = if subject {
                    "subject node"
                } else {
                    "object node"
                };
                Err(self.expected(format!("{role}, found {token:?}")))
            }
        }
    }

    fn literal(&mut self, lexical: String) -> Result<SrlNode, SrlError> {
        let mut language = None;
        let mut direction = None;
        let mut datatype = None;
        if let TokenKind::Lang(tag) = self.peek_kind() {
            let tag = tag.clone();
            self.position_forward();
            let (lang, dir) = tag
                .split_once("--")
                .map_or((tag.as_str(), None), |(lang, dir)| (lang, Some(dir)));
            let mut parts = lang.split('-');
            let primary_language = parts.next().unwrap_or_default();
            if primary_language.is_empty()
                || !primary_language
                    .chars()
                    .all(|value| value.is_ascii_alphabetic())
                || !parts.all(|part| {
                    !part.is_empty() && part.chars().all(|value| value.is_ascii_alphanumeric())
                })
            {
                return Err(self.current_error("invalid language tag"));
            }
            if let Some(dir) = dir {
                if !matches!(dir, "ltr" | "rtl") {
                    return Err(self.current_error("literal direction must be `ltr` or `rtl`"));
                }
                direction = Some(dir.to_owned());
            }
            language = Some(lang.to_ascii_lowercase());
        } else if self.take(&TokenKind::Datatype) {
            datatype = Some(self.iri()?);
        }
        Ok(SrlNode::Constant(SrlConstant::Literal {
            lexical,
            language,
            direction,
            datatype,
        }))
    }

    fn numeric(&self, lexical: String) -> Result<SrlNode, SrlError> {
        let datatype = if is_double(&lexical) {
            XSD_DOUBLE
        } else if is_decimal(&lexical) {
            XSD_DECIMAL
        } else if is_integer(&lexical) {
            XSD_INTEGER
        } else {
            return Err(self.current_error(format!("invalid numeric literal `{lexical}`")));
        };
        Ok(SrlNode::Constant(SrlConstant::Numeric {
            lexical,
            datatype,
        }))
    }

    fn blank_property_list(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        let id = self.next_generated_id();
        if self.take(&TokenKind::RightBracket) {
            return Ok(SrlNode::GeneratedBlankNode(id));
        }
        let properties = self.property_list(mode)?;
        self.expect(TokenKind::RightBracket)?;
        Ok(SrlNode::PropertyList { id, properties })
    }

    fn collection(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        if self.take(&TokenKind::RightParen) {
            return Ok(SrlNode::Constant(SrlConstant::Nil));
        }
        let id = self.next_generated_id();
        let mut values = Vec::new();
        while !self.take(&TokenKind::RightParen) {
            if self.at_end() {
                return Err(self.expected("`)`"));
            }
            values.push(self.node(mode, false)?);
        }
        Ok(SrlNode::Collection { id, values })
    }

    fn reified(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        let id = self.next_generated_id();
        let subject = self.reified_component(mode)?;
        let predicate = self.verb(mode)?;
        let object = self.reified_component(mode)?;
        let reifier = if self.take(&TokenKind::Tilde) {
            starts_reifier(self.peek_kind())
                .then(|| self.reifier(mode))
                .transpose()?
        } else {
            None
        };
        self.expect(TokenKind::ReifiedEnd)?;
        Ok(SrlNode::Reified {
            id,
            triple: Box::new(SrlTriple {
                subject,
                predicate,
                object,
            }),
            reifier: reifier.map(Box::new),
        })
    }

    fn triple_term(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        let subject = self.triple_term_component(mode, false)?;
        let predicate = self.verb(mode)?;
        let object = self.triple_term_component(mode, true)?;
        self.expect(TokenKind::TripleEnd)?;
        Ok(SrlNode::TripleTerm(Box::new(SrlTriple {
            subject,
            predicate,
            object,
        })))
    }

    fn verb(&mut self, mode: NodeMode) -> Result<SrlPredicate, SrlError> {
        if mode != NodeMode::Data && matches!(self.peek_kind(), TokenKind::Variable(_)) {
            return Ok(SrlPredicate::Node(SrlNode::Variable(self.variable()?)));
        }
        let iri = if self.take_keyword("a") {
            RDF_TYPE.to_owned()
        } else {
            self.iri()?
        };
        Ok(SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(iri))))
    }

    fn reifier(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        match self.peek_kind() {
            TokenKind::Variable(_) if mode != NodeMode::Data => {
                Ok(SrlNode::Variable(self.variable()?))
            }
            TokenKind::LeftBracket if self.peek_next_is(&TokenKind::RightBracket) => {
                self.node(mode, false)
            }
            TokenKind::BlankNode(_) | TokenKind::IriRef(_) => self.node(mode, false),
            TokenKind::Bare(value) if value.contains(':') => self.node(mode, false),
            _ => Err(self.expected("IRI, blank node, or variable reifier")),
        }
    }

    fn reified_component(&mut self, mode: NodeMode) -> Result<SrlNode, SrlError> {
        self.restricted_component(mode, true, true)
    }

    fn triple_term_component(&mut self, mode: NodeMode, object: bool) -> Result<SrlNode, SrlError> {
        self.restricted_component(mode, false, object || mode != NodeMode::Expression)
    }

    fn restricted_component(
        &mut self,
        mode: NodeMode,
        allow_reified: bool,
        allow_triple: bool,
    ) -> Result<SrlNode, SrlError> {
        let allowed = match self.peek_kind() {
            TokenKind::Variable(_) => mode != NodeMode::Data,
            TokenKind::IriRef(_)
            | TokenKind::String(_)
            | TokenKind::LongString(_)
            | TokenKind::Number(_) => true,
            TokenKind::Bare(value) => {
                value.contains(':')
                    || value.eq_ignore_ascii_case("true")
                    || value.eq_ignore_ascii_case("false")
            }
            TokenKind::BlankNode(_) => mode != NodeMode::Expression,
            TokenKind::LeftBracket => {
                mode != NodeMode::Expression && self.peek_next_is(&TokenKind::RightBracket)
            }
            TokenKind::ReifiedStart => allow_reified,
            TokenKind::TripleStart => allow_triple,
            _ => false,
        };
        if !allowed {
            return Err(self.expected("RDF term allowed in this embedded triple position"));
        }
        self.node(mode, false)
    }

    fn position_back(&mut self) {
        self.position = self.position.saturating_sub(1);
    }

    fn position_forward(&mut self) {
        self.position += 1;
    }
}

fn starts_reifier(token: &TokenKind) -> bool {
    matches!(
        token,
        TokenKind::Variable(_)
            | TokenKind::BlankNode(_)
            | TokenKind::LeftBracket
            | TokenKind::IriRef(_)
            | TokenKind::Bare(_)
    )
}

fn is_property_end(token: &TokenKind) -> bool {
    matches!(
        token,
        TokenKind::Dot
            | TokenKind::RightBrace
            | TokenKind::RightBracket
            | TokenKind::RightParen
            | TokenKind::AnnotationEnd
            | TokenKind::ReifiedEnd
            | TokenKind::TripleEnd
            | TokenKind::End
    )
}

fn is_integer(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    !value.is_empty() && value.bytes().all(|value| value.is_ascii_digit())
}

fn is_decimal(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    let Some((integer, fraction)) = value.split_once('.') else {
        return false;
    };
    !fraction.is_empty()
        && integer.bytes().all(|value| value.is_ascii_digit())
        && fraction.bytes().all(|value| value.is_ascii_digit())
}

fn is_double(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    let Some((mantissa, exponent)) = value.split_once(['e', 'E']) else {
        return false;
    };
    let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
    !exponent.is_empty()
        && exponent.bytes().all(|value| value.is_ascii_digit())
        && (is_integer(mantissa)
            || is_decimal(mantissa)
            || mantissa
                .strip_suffix('.')
                .is_some_and(|value| !value.is_empty() && is_integer(value)))
}
