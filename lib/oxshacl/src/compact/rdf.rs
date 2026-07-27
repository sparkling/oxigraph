use super::model::{
    Constraint, Document, NodeNot, Path, PropertyAtom, PropertyItem, PropertyNot, PropertyShape,
    Shape, Value,
};
use super::{ShaclcError, ShaclcLimits};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};

const RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS: &str = "http://www.w3.org/2000/01/rdf-schema#";
const SH: &str = "http://www.w3.org/ns/shacl#";
const OWL: &str = "http://www.w3.org/2002/07/owl#";
const XSD: &str = "http://www.w3.org/2001/XMLSchema#";

pub(super) fn map_document(
    document: &Document,
    limits: &ShaclcLimits,
) -> Result<Dataset, ShaclcError> {
    let mut builder = Builder::new(limits.max_triples);
    for shape in &document.shapes {
        map_shape(&mut builder, shape)?;
    }
    if let Some(base) = &document.base {
        let ontology = named_subject(base);
        builder.insert(
            &ontology,
            &format!("{RDF}type"),
            named_term(&format!("{OWL}Ontology")),
        )?;
        for import in &document.imports {
            builder.insert(&ontology, &format!("{OWL}imports"), named_term(import))?;
        }
    }
    Ok(builder.dataset)
}

fn map_shape(builder: &mut Builder, shape: &Shape) -> Result<(), ShaclcError> {
    let subject = named_subject(&shape.iri);
    builder.insert(
        &subject,
        &format!("{RDF}type"),
        named_term(&format!("{SH}NodeShape")),
    )?;
    if shape.class {
        builder.insert(
            &subject,
            &format!("{RDF}type"),
            named_term(&format!("{RDFS}Class")),
        )?;
    }
    for target in &shape.targets {
        builder.insert(&subject, &format!("{SH}targetClass"), named_term(target))?;
    }
    map_constraints(builder, &subject, &shape.constraints)
}

fn map_constraints(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    constraints: &[Constraint],
) -> Result<(), ShaclcError> {
    for constraint in constraints {
        match constraint {
            Constraint::NodeOr(values) => map_node_or(builder, subject, values)?,
            Constraint::Property(property) => map_property(builder, subject, property)?,
        }
    }
    Ok(())
}

fn map_node_or(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    values: &[NodeNot],
) -> Result<(), ShaclcError> {
    if let [value] = values {
        return map_node_not(builder, subject, value);
    }
    let branches = values
        .iter()
        .map(|value| {
            let branch = builder.blank_subject();
            map_node_not(builder, &branch, value)?;
            Ok(Term::from(branch))
        })
        .collect::<Result<Vec<_>, ShaclcError>>()?;
    let list = builder.list(&branches)?;
    builder.insert(subject, &format!("{SH}or"), list)
}

fn map_node_not(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    value: &NodeNot,
) -> Result<(), ShaclcError> {
    let target = if value.negated {
        let target = builder.blank_subject();
        builder.insert(subject, &format!("{SH}not"), Term::from(target.clone()))?;
        target
    } else {
        subject.clone()
    };
    map_value(
        builder,
        &target,
        &format!("{SH}{}", value.parameter),
        &value.value,
    )
}

fn map_property(
    builder: &mut Builder,
    shape: &NamedOrBlankNode,
    property: &PropertyShape,
) -> Result<(), ShaclcError> {
    let subject = builder.blank_subject();
    builder.insert(shape, &format!("{SH}property"), Term::from(subject.clone()))?;
    let path = map_path(builder, &property.path)?;
    builder.insert(&subject, &format!("{SH}path"), path)?;
    for item in &property.items {
        match item {
            PropertyItem::Count { minimum, maximum } => {
                if !integer_is_zero(minimum) {
                    builder.insert(&subject, &format!("{SH}minCount"), integer_term(minimum))?;
                }
                if let Some(maximum) = maximum {
                    builder.insert(&subject, &format!("{SH}maxCount"), integer_term(maximum))?;
                }
            }
            PropertyItem::Or(values) => map_property_or(builder, &subject, values)?,
        }
    }
    Ok(())
}

fn map_property_or(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    values: &[PropertyNot],
) -> Result<(), ShaclcError> {
    if let [value] = values {
        return map_property_not(builder, subject, value);
    }
    let branches = values
        .iter()
        .map(|value| {
            let branch = builder.blank_subject();
            map_property_not(builder, &branch, value)?;
            Ok(Term::from(branch))
        })
        .collect::<Result<Vec<_>, ShaclcError>>()?;
    let list = builder.list(&branches)?;
    builder.insert(subject, &format!("{SH}or"), list)
}

fn map_property_not(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    value: &PropertyNot,
) -> Result<(), ShaclcError> {
    let target = if value.negated {
        let target = builder.blank_subject();
        builder.insert(subject, &format!("{SH}not"), Term::from(target.clone()))?;
        target
    } else {
        subject.clone()
    };
    map_property_atom(builder, &target, &value.atom)
}

fn map_property_atom(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    atom: &PropertyAtom,
) -> Result<(), ShaclcError> {
    match atom {
        PropertyAtom::Type(iri) => {
            let predicate = if is_datatype(iri) {
                format!("{SH}datatype")
            } else {
                format!("{SH}class")
            };
            builder.insert(subject, &predicate, named_term(iri))
        }
        PropertyAtom::NodeKind(kind) => builder.insert(
            subject,
            &format!("{SH}nodeKind"),
            named_term(&format!("{SH}{kind}")),
        ),
        PropertyAtom::ShapeRef(iri) => {
            builder.insert(subject, &format!("{SH}node"), named_term(iri))
        }
        PropertyAtom::Value { parameter, value } => {
            map_value(builder, subject, &format!("{SH}{parameter}"), value)
        }
        PropertyAtom::Nested(constraints) => {
            let nested = builder.blank_subject();
            builder.insert(subject, &format!("{SH}node"), Term::from(nested.clone()))?;
            map_constraints(builder, &nested, constraints)
        }
    }
}

fn map_value(
    builder: &mut Builder,
    subject: &NamedOrBlankNode,
    predicate: &str,
    value: &Value,
) -> Result<(), ShaclcError> {
    let value = match value {
        Value::Term(value) => value.clone(),
        Value::List(values) => builder.list(values)?,
    };
    builder.insert(subject, predicate, value)
}

fn map_path(builder: &mut Builder, path: &Path) -> Result<Term, ShaclcError> {
    match path {
        Path::Iri(iri) => Ok(named_term(iri)),
        Path::Alternative(paths) => {
            let members = paths
                .iter()
                .map(|path| map_path(builder, path))
                .collect::<Result<Vec<_>, _>>()?;
            let list = builder.list(&members)?;
            builder.single_blank_property(&format!("{SH}alternativePath"), list)
        }
        Path::Sequence(paths) => {
            let members = paths
                .iter()
                .map(|path| map_path(builder, path))
                .collect::<Result<Vec<_>, _>>()?;
            builder.list(&members)
        }
        Path::Inverse(path) => {
            let path = map_path(builder, path)?;
            builder.single_blank_property(&format!("{SH}inversePath"), path)
        }
        Path::ZeroOrOne(path) => {
            let path = map_path(builder, path)?;
            builder.single_blank_property(&format!("{SH}zeroOrOnePath"), path)
        }
        Path::ZeroOrMore(path) => {
            let path = map_path(builder, path)?;
            builder.single_blank_property(&format!("{SH}zeroOrMorePath"), path)
        }
        Path::OneOrMore(path) => {
            let path = map_path(builder, path)?;
            builder.single_blank_property(&format!("{SH}oneOrMorePath"), path)
        }
    }
}

struct Builder {
    dataset: Dataset,
    next_blank: usize,
    max_triples: usize,
}

impl Builder {
    fn new(max_triples: usize) -> Self {
        Self {
            dataset: Dataset::new(),
            next_blank: 0,
            max_triples,
        }
    }

    fn blank_subject(&mut self) -> NamedOrBlankNode {
        let value = BlankNode::new_unchecked(format!("oxshacl-shaclc-{}", self.next_blank));
        self.next_blank += 1;
        value.into()
    }

    fn insert(
        &mut self,
        subject: &NamedOrBlankNode,
        predicate: &str,
        object: Term,
    ) -> Result<(), ShaclcError> {
        self.dataset.insert(Quad::new(
            subject.clone(),
            NamedNode::new_unchecked(predicate.to_owned()),
            object,
            GraphName::DefaultGraph,
        ));
        if self.dataset.len() > self.max_triples {
            return Err(ShaclcError::LimitExceeded {
                kind: "mapped triples",
                limit: self.max_triples,
            });
        }
        Ok(())
    }

    fn list(&mut self, values: &[Term]) -> Result<Term, ShaclcError> {
        if values.is_empty() {
            return Ok(named_term(&format!("{RDF}nil")));
        }
        let cells = values
            .iter()
            .map(|_| self.blank_subject())
            .collect::<Vec<_>>();
        for (index, value) in values.iter().enumerate() {
            self.insert(&cells[index], &format!("{RDF}first"), value.clone())?;
            let rest = cells
                .get(index + 1)
                .cloned()
                .map_or_else(|| named_term(&format!("{RDF}nil")), Term::from);
            self.insert(&cells[index], &format!("{RDF}rest"), rest)?;
        }
        Ok(Term::from(cells[0].clone()))
    }

    fn single_blank_property(
        &mut self,
        predicate: &str,
        object: Term,
    ) -> Result<Term, ShaclcError> {
        let subject = self.blank_subject();
        self.insert(&subject, predicate, object)?;
        Ok(Term::from(subject))
    }
}

fn named_subject(value: &str) -> NamedOrBlankNode {
    NamedNode::new_unchecked(value.to_owned()).into()
}

fn named_term(value: &str) -> Term {
    NamedNode::new_unchecked(value.to_owned()).into()
}

fn integer_term(value: &str) -> Term {
    oxrdf::Literal::new_typed_literal(
        value.to_owned(),
        NamedNode::new_unchecked(format!("{XSD}integer")),
    )
    .into()
}

fn integer_is_zero(value: &str) -> bool {
    value == "0"
}

fn is_datatype(iri: &str) -> bool {
    iri == "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
        || iri.strip_prefix(XSD).is_some_and(|local| {
            matches!(
                local,
                "integer"
                    | "decimal"
                    | "float"
                    | "double"
                    | "string"
                    | "boolean"
                    | "dateTime"
                    | "nonPositiveInteger"
                    | "negativeInteger"
                    | "long"
                    | "int"
                    | "short"
                    | "byte"
                    | "nonNegativeInteger"
                    | "unsignedLong"
                    | "unsignedInt"
                    | "unsignedShort"
                    | "unsignedByte"
                    | "positiveInteger"
            )
        })
}
