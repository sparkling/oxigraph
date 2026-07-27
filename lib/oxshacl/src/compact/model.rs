use oxrdf::Term;

#[derive(Clone, Debug)]
pub(super) struct Document {
    pub base: Option<String>,
    pub imports: Vec<String>,
    pub shapes: Vec<Shape>,
}

#[derive(Clone, Debug)]
pub(super) struct Shape {
    pub iri: String,
    pub class: bool,
    pub targets: Vec<String>,
    pub constraints: Vec<Constraint>,
}

#[derive(Clone, Debug)]
pub(super) enum Constraint {
    NodeOr(Vec<NodeNot>),
    Property(PropertyShape),
}

#[derive(Clone, Debug)]
pub(super) struct NodeNot {
    pub negated: bool,
    pub parameter: String,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub(super) struct PropertyShape {
    pub path: Path,
    pub items: Vec<PropertyItem>,
}

#[derive(Clone, Debug)]
pub(super) enum PropertyItem {
    Count {
        minimum: String,
        maximum: Option<String>,
    },
    Or(Vec<PropertyNot>),
}

#[derive(Clone, Debug)]
pub(super) struct PropertyNot {
    pub negated: bool,
    pub atom: PropertyAtom,
}

#[derive(Clone, Debug)]
pub(super) enum PropertyAtom {
    Type(String),
    NodeKind(String),
    ShapeRef(String),
    Value { parameter: String, value: Value },
    Nested(Vec<Constraint>),
}

#[derive(Clone, Debug)]
pub(super) enum Value {
    Term(Term),
    List(Vec<Term>),
}

#[derive(Clone, Debug)]
pub(super) enum Path {
    Iri(String),
    Alternative(Vec<Path>),
    Sequence(Vec<Path>),
    Inverse(Box<Path>),
    ZeroOrOne(Box<Path>),
    ZeroOrMore(Box<Path>),
    OneOrMore(Box<Path>),
}
