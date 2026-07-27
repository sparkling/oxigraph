use super::Parser;
use crate::compact::ShaclcError;
use crate::compact::lexer::TokenKind;
use crate::compact::model::Path;

impl Parser<'_> {
    pub(super) fn path(&mut self, depth: usize) -> Result<Path, ShaclcError> {
        self.check_depth(depth)?;
        let mut alternatives = vec![self.path_sequence(depth + 1)?];
        while self.take(&TokenKind::Pipe) {
            alternatives.push(self.path_sequence(depth + 1)?);
            self.check_list(alternatives.len())?;
        }
        if alternatives.len() == 1 {
            alternatives
                .pop()
                .ok_or_else(|| self.current_error("path alternative is empty"))
        } else {
            Ok(Path::Alternative(alternatives))
        }
    }

    fn path_sequence(&mut self, depth: usize) -> Result<Path, ShaclcError> {
        self.check_depth(depth)?;
        let mut sequence = vec![self.path_element_or_inverse(depth + 1)?];
        while self.take(&TokenKind::Slash) {
            sequence.push(self.path_element_or_inverse(depth + 1)?);
            self.check_list(sequence.len())?;
        }
        if sequence.len() == 1 {
            sequence
                .pop()
                .ok_or_else(|| self.current_error("path sequence is empty"))
        } else {
            Ok(Path::Sequence(sequence))
        }
    }

    fn path_element_or_inverse(&mut self, depth: usize) -> Result<Path, ShaclcError> {
        let inverse = self.take(&TokenKind::Caret);
        let path = self.path_element(depth + 1)?;
        if inverse {
            Ok(Path::Inverse(Box::new(path)))
        } else {
            Ok(path)
        }
    }

    fn path_element(&mut self, depth: usize) -> Result<Path, ShaclcError> {
        self.check_depth(depth)?;
        let primary = if self.take(&TokenKind::LeftParen) {
            let path = self.path(depth + 1)?;
            self.expect(TokenKind::RightParen)?;
            path
        } else {
            Path::Iri(self.iri()?)
        };
        if self.take(&TokenKind::Question) {
            Ok(Path::ZeroOrOne(Box::new(primary)))
        } else if self.take(&TokenKind::Star) {
            Ok(Path::ZeroOrMore(Box::new(primary)))
        } else if self.take(&TokenKind::Plus) {
            Ok(Path::OneOrMore(Box::new(primary)))
        } else {
            Ok(primary)
        }
    }
}
