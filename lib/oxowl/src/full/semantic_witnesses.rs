#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by semantic operator"
)]

use super::{Owl2RlRdfError, Runtime, semantics::witness, subject_term, term_resource};
use crate::vocabulary::{
    ALL_DISJOINT_CLASSES, CLASS, COMPLEMENT_OF, MAX_QUALIFIED_CARDINALITY, MEMBERS,
    MIN_CARDINALITY, OBJECT_PROPERTY, ON_CLASS, ON_PROPERTY, RESTRICTION, UNION_OF,
};
use oxrdf::{
    GraphName, Literal, NamedNode, Quad, Term,
    vocab::{rdf, rdfs, xsd},
};

const INTEGER_DATATYPES: &[NamedNode] = &[
    xsd::INTEGER,
    xsd::NON_NEGATIVE_INTEGER,
    xsd::NON_POSITIVE_INTEGER,
    xsd::POSITIVE_INTEGER,
    xsd::NEGATIVE_INTEGER,
    xsd::LONG,
    xsd::INT,
    xsd::SHORT,
    xsd::BYTE,
    xsd::UNSIGNED_LONG,
    xsd::UNSIGNED_INT,
    xsd::UNSIGNED_SHORT,
    xsd::UNSIGNED_BYTE,
];

impl Runtime<'_> {
    pub(super) fn semantic_complements(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for disjoint in quads {
            self.check()?;
            if disjoint.predicate != crate::vocabulary::DISJOINT_WITH {
                continue;
            }
            let left = subject_term(disjoint);
            for typed in quads {
                self.check()?;
                if typed.graph_name != disjoint.graph_name
                    || typed.predicate != rdf::TYPE
                    || typed.object != left
                {
                    continue;
                }
                self.materialize_complement(
                    &typed.graph_name,
                    typed.subject.clone(),
                    disjoint.object.clone(),
                    &[disjoint.clone(), typed.clone()],
                )?;
            }
        }
        for declaration in quads {
            self.check()?;
            if declaration.predicate != rdf::TYPE || declaration.object != ALL_DISJOINT_CLASSES {
                continue;
            }
            let Some(members) = self.checked_find(quads, |quad| {
                quad.graph_name == declaration.graph_name
                    && quad.subject == declaration.subject
                    && quad.predicate == MEMBERS
            })?
            else {
                continue;
            };
            let classes = self.list(&members.object, &members.graph_name)?;
            for typed in quads {
                self.check()?;
                if typed.graph_name != declaration.graph_name
                    || typed.predicate != rdf::TYPE
                    || !self.checked_any(&classes, |class| *class == &typed.object)?
                {
                    continue;
                }
                for class in &classes {
                    self.check()?;
                    if *class == typed.object {
                        continue;
                    }
                    self.materialize_complement(
                        &typed.graph_name,
                        typed.subject.clone(),
                        class.clone(),
                        &[declaration.clone(), members.clone(), typed.clone()],
                    )?;
                }
            }
        }
        self.qualified_cardinality_complements(quads)
    }

    fn qualified_cardinality_complements(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for maximum in quads {
            self.check()?;
            if maximum.predicate != MAX_QUALIFIED_CARDINALITY
                || !matches!(&maximum.object, Term::Literal(value) if value.value() == "1")
            {
                continue;
            }
            let expression = subject_term(maximum);
            let property = self
                .checked_find(quads, |quad| {
                    quad.graph_name == maximum.graph_name
                        && subject_term(quad) == expression
                        && quad.predicate == ON_PROPERTY
                })?
                .map(|quad| &quad.object);
            let class = self
                .checked_find(quads, |quad| {
                    quad.graph_name == maximum.graph_name
                        && subject_term(quad) == expression
                        && quad.predicate == ON_CLASS
                })?
                .map(|quad| &quad.object);
            let (Some(Term::NamedNode(property)), Some(class)) = (property, class) else {
                continue;
            };
            for owner in quads {
                self.check()?;
                if owner.graph_name != maximum.graph_name
                    || owner.predicate != rdf::TYPE
                    || owner.object != expression
                {
                    continue;
                }
                let mut values = Vec::new();
                for quad in quads {
                    self.check()?;
                    if quad.graph_name == owner.graph_name
                        && quad.subject == owner.subject
                        && quad.predicate == *property
                    {
                        values.push(quad);
                    }
                }
                for candidate in &values {
                    self.check()?;
                    for typed in &values {
                        self.check()?;
                        if self.checked_any(quads, |quad| {
                            quad.graph_name == owner.graph_name
                                && quad.predicate == rdf::TYPE
                                && subject_term(quad) == typed.object
                                && &quad.object == class
                        })? && self.different(
                            &owner.graph_name,
                            &candidate.object,
                            &typed.object,
                            quads,
                        )? {
                            let Some(subject) = term_resource(&candidate.object) else {
                                continue;
                            };
                            self.materialize_complement(
                                &owner.graph_name,
                                subject,
                                class.clone(),
                                &[maximum.clone(), owner.clone(), (*candidate).clone()],
                            )?;
                        }
                    }
                }
            }
        }
        self.check()
    }

    pub(super) fn semantic_datatype_ranges(
        &mut self,
        quads: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        for range in quads {
            self.check()?;
            if range.predicate != rdfs::RANGE {
                continue;
            }
            let mut ranges = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name == range.graph_name
                    && quad.subject == range.subject
                    && quad.predicate == rdfs::RANGE
                    && let Term::NamedNode(datatype) = &quad.object
                    && let Some(bounds) = integer_bounds(datatype)
                {
                    ranges.push(bounds);
                }
            }
            if ranges.is_empty() {
                continue;
            }
            let mut intersection = (i128::MIN, i128::MAX);
            for bounds in &ranges {
                self.check()?;
                intersection.0 = intersection.0.max(bounds.0);
                intersection.1 = intersection.1.min(bounds.1);
            }
            for datatype in INTEGER_DATATYPES {
                self.check()?;
                let Some(bounds) = integer_bounds(datatype) else {
                    continue;
                };
                if bounds.0 <= intersection.0 && bounds.1 >= intersection.1 {
                    self.insert(
                        Quad::new(
                            range.subject.clone(),
                            rdfs::RANGE,
                            datatype.clone(),
                            range.graph_name.clone(),
                        ),
                        "rdf-sem-datatype-range",
                        std::slice::from_ref(range),
                    )?;
                }
            }
        }
        self.check()
    }

    pub(super) fn semantic_expression_witnesses(&mut self) -> Result<(), Owl2RlRdfError> {
        let base = self.checked_collect(self.base.iter())?;
        for declaration in &base {
            self.check()?;
            if declaration.predicate == rdf::TYPE && declaration.object == CLASS {
                let class = subject_term(declaration);
                let expression = witness("union", &declaration.graph_name, &class.to_string());
                let list = self.materialize_list(
                    &declaration.graph_name,
                    "union-list",
                    std::slice::from_ref(&class),
                )?;
                self.insert(
                    Quad::new(
                        expression.clone(),
                        rdf::TYPE,
                        CLASS,
                        declaration.graph_name.clone(),
                    ),
                    "rdf-sem-union-witness",
                    std::slice::from_ref(declaration),
                )?;
                self.insert(
                    Quad::new(expression, UNION_OF, list, declaration.graph_name.clone()),
                    "rdf-sem-union-witness",
                    std::slice::from_ref(declaration),
                )?;
            }
            if declaration.predicate == rdf::TYPE && declaration.object == OBJECT_PROPERTY {
                let property = subject_term(declaration);
                let restriction =
                    witness("min-one", &declaration.graph_name, &property.to_string());
                self.insert(
                    Quad::new(
                        restriction.clone(),
                        rdf::TYPE,
                        RESTRICTION,
                        declaration.graph_name.clone(),
                    ),
                    "rdf-sem-min-cardinality-witness",
                    std::slice::from_ref(declaration),
                )?;
                self.insert(
                    Quad::new(
                        restriction.clone(),
                        ON_PROPERTY,
                        property,
                        declaration.graph_name.clone(),
                    ),
                    "rdf-sem-min-cardinality-witness",
                    std::slice::from_ref(declaration),
                )?;
                self.insert(
                    Quad::new(
                        restriction,
                        MIN_CARDINALITY,
                        Literal::new_typed_literal("1", xsd::INT),
                        declaration.graph_name.clone(),
                    ),
                    "rdf-sem-min-cardinality-witness",
                    std::slice::from_ref(declaration),
                )?;
            }
        }
        self.check()
    }

    fn materialize_complement(
        &mut self,
        graph: &GraphName,
        instance: oxrdf::NamedOrBlankNode,
        excluded: Term,
        evidence: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        let expression = witness("complement", graph, &format!("{instance}|{excluded}"));
        for quad in [
            Quad::new(expression.clone(), rdf::TYPE, CLASS, graph.clone()),
            Quad::new(expression.clone(), COMPLEMENT_OF, excluded, graph.clone()),
            Quad::new(instance, rdf::TYPE, expression, graph.clone()),
        ] {
            self.insert(quad, "rdf-sem-complement-witness", evidence)?;
        }
        self.check()
    }
}

fn integer_bounds(datatype: &NamedNode) -> Option<(i128, i128)> {
    Some(if datatype == &xsd::INTEGER {
        (i128::MIN, i128::MAX)
    } else if datatype == &xsd::NON_NEGATIVE_INTEGER {
        (0, i128::MAX)
    } else if datatype == &xsd::NON_POSITIVE_INTEGER {
        (i128::MIN, 0)
    } else if datatype == &xsd::POSITIVE_INTEGER {
        (1, i128::MAX)
    } else if datatype == &xsd::NEGATIVE_INTEGER {
        (i128::MIN, -1)
    } else if datatype == &xsd::LONG {
        (i128::from(i64::MIN), i128::from(i64::MAX))
    } else if datatype == &xsd::INT {
        (i128::from(i32::MIN), i128::from(i32::MAX))
    } else if datatype == &xsd::SHORT {
        (i128::from(i16::MIN), i128::from(i16::MAX))
    } else if datatype == &xsd::BYTE {
        (i128::from(i8::MIN), i128::from(i8::MAX))
    } else if datatype == &xsd::UNSIGNED_LONG {
        (0, i128::from(u64::MAX))
    } else if datatype == &xsd::UNSIGNED_INT {
        (0, i128::from(u32::MAX))
    } else if datatype == &xsd::UNSIGNED_SHORT {
        (0, i128::from(u16::MAX))
    } else if datatype == &xsd::UNSIGNED_BYTE {
        (0, i128::from(u8::MAX))
    } else {
        return None;
    })
}
