//! Shared parser implementation for N-Triples and N-Quads.

use crate::MIN_BUFFER_SIZE;
use crate::lexer::{N3Lexer, N3LexerMode, N3LexerOptions, N3Token, to_lowercase};
use crate::serialization::NTriplesMediaType;
use crate::toolkit::{Lexer, Parser, RuleRecognizer, RuleRecognizerError, TokenOrLineJump};
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, OxString, Quad, Term};

pub struct NQuadsRecognizer {
    stack: Vec<NQuadsState>,
    subjects: Vec<NamedOrBlankNode>,
    predicates: Vec<NamedNode>,
    objects: Vec<Term>,
    #[cfg(feature = "rdf-12")]
    version_directive_state: VersionDirectiveState,
}

pub struct NQuadsRecognizerContext {
    with_graph_name: bool,
    lexer_options: N3LexerOptions,
}

#[derive(Clone, Copy)]
pub(crate) enum DocumentPosition {
    Start,
    Continuation,
}

#[cfg(feature = "rdf-12")]
#[derive(Clone, Copy, Eq, PartialEq)]
enum VersionDirectiveState {
    Allowed,
    Seen,
    Past,
}

enum NQuadsState {
    ExpectSubject,
    #[cfg(feature = "rdf-12")]
    ExpectVersionSpecifier,
    #[cfg(feature = "rdf-12")]
    ExpectVersionLineJump,
    ExpectPredicate,
    ExpectedObject,
    ExpectPossibleGraphOrEndOfQuotedTriple,
    ExpectDot,
    ExpectLiteralAnnotationOrGraphNameOrDot {
        value: OxString,
    },
    ExpectLiteralDatatype {
        value: OxString,
    },
    ExpectLineJump,
    RecoverToLineJump,
    #[cfg(feature = "rdf-12")]
    AfterQuotedTriple,
}

impl RuleRecognizer for NQuadsRecognizer {
    type TokenRecognizer = N3Lexer;
    type Output = Quad;
    type Context = NQuadsRecognizerContext;

    fn set_error_recovery_state(&mut self) {
        #[cfg(feature = "rdf-12")]
        if self.version_directive_state == VersionDirectiveState::Allowed {
            self.version_directive_state = VersionDirectiveState::Past;
        }
        self.stack.clear();
        self.stack.push(NQuadsState::RecoverToLineJump);
        self.subjects.clear();
        self.predicates.clear();
        self.objects.clear();
    }

    fn recognize_next(
        &mut self,
        token: TokenOrLineJump<N3Token<'_>>,
        context: &mut NQuadsRecognizerContext,
        results: &mut Vec<Quad>,
        errors: &mut Vec<RuleRecognizerError>,
    ) {
        match self.stack.pop().unwrap_or(NQuadsState::ExpectSubject) {
            NQuadsState::ExpectSubject => match token {
                TokenOrLineJump::Token(token) => {
                    #[cfg(feature = "rdf-12")]
                    let is_document_root = self.stack.is_empty();
                    #[cfg(feature = "rdf-12")]
                    if is_document_root
                        && !matches!(&token, N3Token::PlainKeyword("VERSION"))
                        && self.version_directive_state == VersionDirectiveState::Allowed
                    {
                        self.version_directive_state = VersionDirectiveState::Past;
                    }
                    match token {
                        #[cfg(feature = "rdf-12")]
                        N3Token::PlainKeyword("VERSION") if is_document_root => {
                            match self.version_directive_state {
                                VersionDirectiveState::Allowed => {
                                    self.version_directive_state = VersionDirectiveState::Seen;
                                    self.stack.push(NQuadsState::ExpectVersionSpecifier);
                                }
                                VersionDirectiveState::Seen => self.error(
                                    context,
                                    results,
                                    errors,
                                    TokenOrLineJump::Token(token),
                                    "Only one VERSION directive is allowed",
                                ),
                                VersionDirectiveState::Past => self.error(
                                    context,
                                    results,
                                    errors,
                                    TokenOrLineJump::Token(token),
                                    "The VERSION directive must precede all triples and quads",
                                ),
                            }
                        }
                        N3Token::IriRef(s) => {
                            self.subjects.push(NamedNode::new_unchecked(s).into());
                            self.stack.push(NQuadsState::ExpectPredicate);
                        }
                        N3Token::BlankNodeLabel(s) => {
                            self.subjects
                                .push(BlankNode::new_unchecked(OxString::new_owned(s)).into());
                            self.stack.push(NQuadsState::ExpectPredicate);
                        }
                        _ => self.error(
                            context,
                            results,
                            errors,
                            TokenOrLineJump::Token(token),
                            "The subject of a triple must be an IRI or a blank node",
                        ),
                    }
                }
                TokenOrLineJump::LineJump => {
                    if !self.stack.is_empty() {
                        self.error(
                            context,
                            results,
                            errors,
                            token,
                            "line jumps are not allowed inside of quoted triples",
                        )
                    }
                }
            },
            #[cfg(feature = "rdf-12")]
            NQuadsState::ExpectVersionSpecifier => match token {
                TokenOrLineJump::Token(N3Token::String(_)) => {
                    self.stack.push(NQuadsState::ExpectVersionLineJump);
                }
                _ => self.error(
                    context,
                    results,
                    errors,
                    token,
                    "The VERSION keyword must be followed by a double-quoted version string",
                ),
            },
            #[cfg(feature = "rdf-12")]
            NQuadsState::ExpectVersionLineJump => match token {
                TokenOrLineJump::LineJump => {}
                TokenOrLineJump::Token(_) => self.error(
                    context,
                    results,
                    errors,
                    token,
                    "The VERSION directive must be the only statement on its line",
                ),
            },
            NQuadsState::ExpectPredicate => match token {
                TokenOrLineJump::Token(token) => match token {
                    N3Token::IriRef(p) => {
                        self.predicates.push(NamedNode::new_unchecked(p));
                        self.stack.push(NQuadsState::ExpectedObject);
                    }
                    _ => self.error(
                        context,
                        results,
                        errors,
                        TokenOrLineJump::Token(token),
                        "The predicate of a triple must be an IRI",
                    ),
                },
                TokenOrLineJump::LineJump => self.error(
                    context,
                    results,
                    errors,
                    token,
                    "line jumps are not allowed in the middle of triples",
                ),
            },
            NQuadsState::ExpectedObject => match token {
                TokenOrLineJump::Token(token) => match token {
                    N3Token::IriRef(o) => {
                        self.objects.push(NamedNode::new_unchecked(o).into());
                        self.stack
                            .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                    }
                    N3Token::BlankNodeLabel(o) => {
                        self.objects
                            .push(BlankNode::new_unchecked(OxString::new_owned(o)).into());
                        self.stack
                            .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                    }
                    N3Token::String(value) => {
                        self.stack
                            .push(NQuadsState::ExpectLiteralAnnotationOrGraphNameOrDot { value });
                    }
                    #[cfg(feature = "rdf-12")]
                    N3Token::Punctuation("<<(") => {
                        self.stack.push(NQuadsState::AfterQuotedTriple);
                        self.stack.push(NQuadsState::ExpectSubject);
                    }
                    _ => self.error(
                        context,
                        results,
                        errors,
                        TokenOrLineJump::Token(token),
                        "The object of a triple must be an IRI, a blank node or a literal",
                    ),
                },
                TokenOrLineJump::LineJump => self.error(
                    context,
                    results,
                    errors,
                    token,
                    "line jumps are not allowed in the middle of triples",
                ),
            },
            NQuadsState::ExpectLiteralAnnotationOrGraphNameOrDot { value } => match token {
                #[cfg(feature = "rdf-12")]
                TokenOrLineJump::Token(N3Token::LangTag {
                    language,
                    direction,
                }) => {
                    self.objects.push(
                        if let Some(direction) = direction {
                            Literal::new_directional_language_tagged_literal_unchecked(
                                value,
                                to_lowercase(language),
                                direction,
                            )
                        } else {
                            Literal::new_language_tagged_literal_unchecked(
                                value,
                                to_lowercase(language),
                            )
                        }
                        .into(),
                    );
                    self.stack
                        .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                }
                #[cfg(not(feature = "rdf-12"))]
                TokenOrLineJump::Token(N3Token::LangTag { language }) => {
                    self.objects.push(
                        Literal::new_language_tagged_literal_unchecked(
                            value,
                            to_lowercase(language),
                        )
                        .into(),
                    );
                    self.stack
                        .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                }
                TokenOrLineJump::Token(N3Token::Punctuation("^^")) => {
                    self.stack
                        .push(NQuadsState::ExpectLiteralDatatype { value });
                }
                _ => {
                    self.objects.push(Literal::new_simple_literal(value).into());
                    self.stack
                        .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                    self.recognize_next(token, context, results, errors)
                }
            },
            NQuadsState::ExpectLiteralDatatype { value } => match token {
                TokenOrLineJump::Token(token) => match token {
                    N3Token::IriRef(d) => {
                        match Literal::try_new_typed_literal(value, NamedNode::new_unchecked(d)) {
                            Ok(literal) => {
                                self.objects.push(literal.into());
                                self.stack
                                    .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                            }
                            Err(error) => {
                                errors.push(error.to_string().into());
                                self.set_error_recovery_state();
                            }
                        }
                    }
                    _ => self.error(
                        context,
                        results,
                        errors,
                        TokenOrLineJump::Token(token),
                        "A literal datatype must be an IRI",
                    ),
                },
                TokenOrLineJump::LineJump => self.error(
                    context,
                    results,
                    errors,
                    token,
                    "line jumps are not allowed in the middle of triples",
                ),
            },
            NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple => {
                if self.stack.is_empty() {
                    match token {
                        TokenOrLineJump::Token(N3Token::IriRef(g)) if context.with_graph_name => {
                            self.emit_quad(results, NamedNode::new_unchecked(g).into());
                            self.stack.push(NQuadsState::ExpectDot);
                        }
                        TokenOrLineJump::Token(N3Token::BlankNodeLabel(g))
                            if context.with_graph_name =>
                        {
                            self.emit_quad(
                                results,
                                BlankNode::new_unchecked(OxString::new_owned(g)).into(),
                            );
                            self.stack.push(NQuadsState::ExpectDot);
                        }
                        _ => {
                            self.emit_quad(results, GraphName::DefaultGraph);
                            self.stack.push(NQuadsState::ExpectDot);
                            self.recognize_next(token, context, results, errors)
                        }
                    }
                } else if token != TokenOrLineJump::Token(N3Token::Punctuation(")>>")) {
                    self.error(
                        context,
                        results,
                        errors,
                        token,
                        "Expecting the end of a quoted triple ')>>'",
                    )
                }
            }
            NQuadsState::ExpectDot => match token {
                TokenOrLineJump::Token(token) => {
                    if let N3Token::Punctuation(".") = token {
                        self.stack.push(NQuadsState::ExpectLineJump);
                    } else {
                        errors.push("Quads must be followed by a dot".into());
                        self.recognize_next(TokenOrLineJump::Token(token), context, results, errors)
                    }
                }
                TokenOrLineJump::LineJump => {
                    self.error(
                        context,
                        results,
                        errors,
                        token,
                        "Quads must be followed by a dot",
                    );
                    self.recognize_next(TokenOrLineJump::LineJump, context, results, errors);
                }
            },
            NQuadsState::ExpectLineJump => match token {
                TokenOrLineJump::Token(token) => {
                    errors.push(
                        format!(
                            "Only a single triple or quad can be written in a line, found {token:?}"
                        )
                        .into(),
                    );
                    self.recognize_next(TokenOrLineJump::Token(token), context, results, errors)
                }
                TokenOrLineJump::LineJump => (),
            },
            #[cfg(feature = "rdf-12")]
            NQuadsState::AfterQuotedTriple => {
                let triple = Triple {
                    subject: self.subjects.pop().unwrap(),
                    predicate: self.predicates.pop().unwrap(),
                    object: self.objects.pop().unwrap(),
                };
                self.objects.push(triple.into());
                self.stack
                    .push(NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple);
                self.recognize_next(token, context, results, errors)
            }
            NQuadsState::RecoverToLineJump => {
                if token != TokenOrLineJump::LineJump {
                    self.stack.push(NQuadsState::RecoverToLineJump);
                }
            }
        }
    }

    fn recognize_end(
        mut self,
        _context: &mut NQuadsRecognizerContext,
        results: &mut Vec<Quad>,
        errors: &mut Vec<RuleRecognizerError>,
    ) {
        match &*self.stack {
            [NQuadsState::ExpectSubject | NQuadsState::ExpectLineJump] | [] => {}
            #[cfg(feature = "rdf-12")]
            [NQuadsState::ExpectVersionLineJump] => {}
            [NQuadsState::ExpectDot] => errors.push("Triples must be followed by a dot".into()),
            [NQuadsState::ExpectPossibleGraphOrEndOfQuotedTriple] => {
                self.emit_quad(results, GraphName::DefaultGraph);
                errors.push("Triples must be followed by a dot".into())
            }
            [NQuadsState::ExpectLiteralAnnotationOrGraphNameOrDot { value }] => {
                self.objects
                    .push(Literal::new_simple_literal(value.clone()).into());
                self.emit_quad(results, GraphName::DefaultGraph);
                errors.push("Triples must be followed by a dot".into())
            }
            _ => errors.push("Unexpected end".into()), // TODO
        }
    }

    fn lexer_options(context: &NQuadsRecognizerContext) -> &N3LexerOptions {
        &context.lexer_options
    }
}

impl NQuadsRecognizer {
    pub fn new_parser<B>(
        data: B,
        is_ending: bool,
        with_graph_name: bool,
        lenient: bool,
        max_buffer_size: usize,
        media_type: NTriplesMediaType,
        document_position: DocumentPosition,
    ) -> Parser<B, Self> {
        #[cfg(not(feature = "rdf-12"))]
        let _: DocumentPosition = document_position;
        Parser::new(
            Lexer::new(
                N3Lexer::new(N3LexerMode::NTriples, lenient),
                data,
                is_ending,
                MIN_BUFFER_SIZE,
                max_buffer_size,
                Some(b"#"),
            )
            .with_ascii_only(media_type == NTriplesMediaType::TextPlain),
            Self {
                stack: vec![NQuadsState::ExpectSubject],
                subjects: Vec::new(),
                predicates: Vec::new(),
                objects: Vec::new(),
                #[cfg(feature = "rdf-12")]
                version_directive_state: match document_position {
                    DocumentPosition::Start => VersionDirectiveState::Allowed,
                    DocumentPosition::Continuation => VersionDirectiveState::Past,
                },
            },
            NQuadsRecognizerContext {
                with_graph_name,
                lexer_options: N3LexerOptions::default(),
            },
        )
    }

    fn error(
        &mut self,
        context: &mut NQuadsRecognizerContext,
        results: &mut Vec<Quad>,
        errors: &mut Vec<RuleRecognizerError>,
        token: TokenOrLineJump<N3Token<'_>>,
        msg: impl Into<RuleRecognizerError>,
    ) {
        errors.push(msg.into());
        self.set_error_recovery_state();
        match token {
            TokenOrLineJump::Token(_) => (),
            TokenOrLineJump::LineJump => self.recognize_next(token, context, results, errors), /* We immediately recover */
        }
    }

    fn emit_quad(&mut self, results: &mut Vec<Quad>, graph_name: GraphName) {
        results.push(Quad {
            subject: self.subjects.pop().unwrap(),
            predicate: self.predicates.pop().unwrap(),
            object: self.objects.pop().unwrap(),
            graph_name,
        })
    }
}
