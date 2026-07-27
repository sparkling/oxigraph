use super::Parser;
use crate::compact::ShaclcError;
use crate::compact::lexer::TokenKind;
use crate::compact::model::{
    Constraint, NodeNot, PropertyAtom, PropertyItem, PropertyNot, PropertyShape, Shape,
};

impl Parser<'_> {
    pub(super) fn shape(&mut self, depth: usize) -> Result<Shape, ShaclcError> {
        self.check_depth(depth)?;
        let class = if self.take_keyword("shapeClass") {
            true
        } else if self.take_keyword("shape") {
            false
        } else {
            return Err(self.expected("`shape` or `shapeClass`"));
        };
        let iri = self.iri()?;
        let mut targets = Vec::new();
        if !class && self.take(&TokenKind::Arrow) {
            if !self.starts_iri() {
                return Err(self.expected("target class IRI"));
            }
            while self.starts_iri() {
                targets.push(self.iri()?);
                self.check_list(targets.len())?;
            }
        }
        let constraints = self.node_shape_body(depth + 1)?;
        Ok(Shape {
            iri,
            class,
            targets,
            constraints,
        })
    }

    pub(super) fn node_shape_body(&mut self, depth: usize) -> Result<Vec<Constraint>, ShaclcError> {
        self.check_depth(depth)?;
        self.expect(TokenKind::LeftBrace)?;
        let mut output = Vec::new();
        while !self.take(&TokenKind::RightBrace) {
            if self.at_end() {
                return Err(self.expected("`}`"));
            }
            output.extend(self.constraint(depth + 1)?);
            self.check_list(output.len())?;
            self.expect(TokenKind::Dot)?;
        }
        Ok(output)
    }

    fn constraint(&mut self, depth: usize) -> Result<Vec<Constraint>, ShaclcError> {
        if self.starts_node_constraint() {
            let mut output = Vec::new();
            while self.starts_node_constraint() {
                output.push(Constraint::NodeOr(self.node_or(depth)?));
                self.check_list(output.len())?;
            }
            Ok(output)
        } else {
            Ok(vec![Constraint::Property(self.property_shape(depth)?)])
        }
    }

    fn node_or(&mut self, depth: usize) -> Result<Vec<NodeNot>, ShaclcError> {
        let mut output = vec![self.node_not(depth)?];
        while self.take(&TokenKind::Pipe) {
            output.push(self.node_not(depth)?);
            self.check_list(output.len())?;
        }
        Ok(output)
    }

    fn node_not(&mut self, depth: usize) -> Result<NodeNot, ShaclcError> {
        let negated = self.take(&TokenKind::Bang);
        let parameter = match self.next_kind() {
            TokenKind::Bare(value) if is_node_parameter(&value) => value,
            _ => return Err(self.expected("node constraint parameter")),
        };
        self.expect(TokenKind::Equal)?;
        let value = self.value(depth + 1)?;
        Ok(NodeNot {
            negated,
            parameter,
            value,
        })
    }

    fn property_shape(&mut self, depth: usize) -> Result<PropertyShape, ShaclcError> {
        let path = self.path(depth + 1)?;
        let mut items = Vec::new();
        while !self.peek_is(&TokenKind::Dot) {
            if self.peek_is(&TokenKind::LeftBracket) {
                items.push(self.property_count()?);
            } else {
                items.push(PropertyItem::Or(self.property_or(depth + 1)?));
            }
            self.check_list(items.len())?;
        }
        Ok(PropertyShape { path, items })
    }

    fn property_count(&mut self) -> Result<PropertyItem, ShaclcError> {
        self.expect(TokenKind::LeftBracket)?;
        let minimum = match self.next_kind() {
            TokenKind::Number(value) if is_integer(&value) => value,
            _ => return Err(self.expected("integer minimum count")),
        };
        self.expect(TokenKind::Range)?;
        let maximum = if self.take(&TokenKind::Star) {
            None
        } else {
            match self.next_kind() {
                TokenKind::Number(value) if is_integer(&value) => Some(value),
                _ => return Err(self.expected("integer or `*` maximum count")),
            }
        };
        self.expect(TokenKind::RightBracket)?;
        Ok(PropertyItem::Count { minimum, maximum })
    }

    fn property_or(&mut self, depth: usize) -> Result<Vec<PropertyNot>, ShaclcError> {
        let mut output = vec![self.property_not(depth)?];
        while self.take(&TokenKind::Pipe) {
            output.push(self.property_not(depth)?);
            self.check_list(output.len())?;
        }
        Ok(output)
    }

    fn property_not(&mut self, depth: usize) -> Result<PropertyNot, ShaclcError> {
        let negated = self.take(&TokenKind::Bang);
        let atom = self.property_atom(depth + 1)?;
        Ok(PropertyNot { negated, atom })
    }

    fn property_atom(&mut self, depth: usize) -> Result<PropertyAtom, ShaclcError> {
        self.check_depth(depth)?;
        if self.peek_is(&TokenKind::LeftBrace) {
            return Ok(PropertyAtom::Nested(self.node_shape_body(depth + 1)?));
        }
        if matches!(self.peek_kind(), TokenKind::At | TokenKind::AtPrefixed(_)) {
            return Ok(PropertyAtom::ShapeRef(self.shape_reference()?));
        }
        if let TokenKind::Bare(value) = self.peek_kind() {
            if is_node_kind(value) {
                let TokenKind::Bare(value) = self.next_kind() else {
                    unreachable!();
                };
                return Ok(PropertyAtom::NodeKind(value));
            }
            if is_property_parameter(value) {
                let TokenKind::Bare(parameter) = self.next_kind() else {
                    unreachable!();
                };
                self.expect(TokenKind::Equal)?;
                let value = self.value(depth + 1)?;
                return Ok(PropertyAtom::Value { parameter, value });
            }
        }
        Ok(PropertyAtom::Type(self.iri()?))
    }

    fn starts_iri(&self) -> bool {
        match self.peek_kind() {
            TokenKind::IriRef(_) => true,
            TokenKind::Bare(value) => value.contains(':'),
            _ => false,
        }
    }

    fn starts_node_constraint(&self) -> bool {
        self.peek_is(&TokenKind::Bang)
            || matches!(self.peek_kind(), TokenKind::Bare(value) if is_node_parameter(value))
    }
}

fn is_integer(value: &str) -> bool {
    let value = value.strip_prefix(['+', '-']).unwrap_or(value);
    !value.is_empty() && value.bytes().all(|value| value.is_ascii_digit())
}

fn is_node_kind(value: &str) -> bool {
    matches!(
        value,
        "BlankNode" | "IRI" | "Literal" | "BlankNodeOrIRI" | "BlankNodeOrLiteral" | "IRIOrLiteral"
    )
}

fn is_node_parameter(value: &str) -> bool {
    is_common_parameter(value)
        || matches!(value, "targetNode" | "targetObjectsOf" | "targetSubjectsOf")
}

fn is_common_parameter(value: &str) -> bool {
    matches!(
        value,
        "deactivated"
            | "severity"
            | "message"
            | "class"
            | "datatype"
            | "nodeKind"
            | "minExclusive"
            | "minInclusive"
            | "maxExclusive"
            | "maxInclusive"
            | "minLength"
            | "maxLength"
            | "pattern"
            | "flags"
            | "languageIn"
            | "equals"
            | "disjoint"
            | "closed"
            | "ignoredProperties"
            | "hasValue"
            | "in"
    )
}

fn is_property_parameter(value: &str) -> bool {
    is_common_parameter(value)
        || matches!(
            value,
            "uniqueLang"
                | "lessThan"
                | "lessThanOrEquals"
                | "qualifiedValueShape"
                | "qualifiedMinCount"
                | "qualifiedMaxCount"
                | "qualifiedValueShapesDisjoint"
        )
}
