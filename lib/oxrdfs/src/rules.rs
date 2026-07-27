use oxdatalog::{Atom, PatternTerm, Program, Rule, RuleId, Variable, rdf::quad_atom};
use oxrdf::{
    NamedNode, Term,
    vocab::{rdf, rdfs},
};

const W3C_SOURCE: &str = "https://www.w3.org/TR/2026/CR-rdf12-semantics-20260407/";

/// Stable metadata for one RDF 1.2 RDFS entailment pattern.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RdfsRule {
    id: &'static str,
    source: &'static str,
}

impl RdfsRule {
    /// The W3C pattern identifier.
    pub const fn id(self) -> &'static str {
        self.id
    }

    /// The dated W3C Candidate Recommendation URL and pattern fragment.
    pub const fn source(self) -> &'static str {
        self.source
    }
}

macro_rules! metadata {
    ($id:literal) => {
        RdfsRule {
            id: $id,
            source: concat!(
                "https://www.w3.org/TR/2026/",
                "CR-rdf12-semantics-20260407/#",
                $id
            ),
        }
    };
}

/// The complete rule inventory for `rdfs-d0`.
pub const IMPLEMENTED_RULES: &[RdfsRule] = &[
    metadata!("rdfs2"),
    metadata!("rdfs3"),
    metadata!("rdfs5"),
    metadata!("rdfs6"),
    metadata!("rdfs7"),
    metadata!("rdfs8"),
    metadata!("rdfs9"),
    metadata!("rdfs10"),
    metadata!("rdfs11"),
    metadata!("rdfs12"),
    metadata!("rdfs13"),
];

/// RDFS patterns deliberately omitted from `rdfs-d0`.
pub const OMITTED_PATTERNS: &[RdfsRule] = &[
    metadata!("rdfs1"),
    metadata!("rdfs4"),
    metadata!("rdfs14"),
    metadata!("rdfs14a"),
];

pub(crate) fn rdfs_d0_program() -> Program {
    Program::new(vec![
        rdfs2(),
        rdfs3(),
        rdfs5(),
        rdfs6(),
        rdfs7(),
        rdfs8(),
        rdfs9(),
        rdfs10(),
        rdfs11(),
        rdfs12(),
        rdfs13(),
    ])
}

fn rdfs2() -> Rule {
    rule(
        "rdfs2",
        quad(var("y"), node(rdf::TYPE), var("x"), var("g")),
        vec![
            quad(var("a"), node(rdfs::DOMAIN), var("x"), var("g")),
            quad(var("y"), var("a"), var("z"), var("g")),
        ],
    )
}

fn rdfs3() -> Rule {
    rule(
        "rdfs3",
        quad(var("z"), node(rdf::TYPE), var("x"), var("g")),
        vec![
            quad(var("a"), node(rdfs::RANGE), var("x"), var("g")),
            quad(var("y"), var("a"), var("z"), var("g")),
        ],
    )
}

fn rdfs5() -> Rule {
    rule(
        "rdfs5",
        quad(var("x"), node(rdfs::SUB_PROPERTY_OF), var("z"), var("g")),
        vec![
            quad(var("x"), node(rdfs::SUB_PROPERTY_OF), var("y"), var("g")),
            quad(var("y"), node(rdfs::SUB_PROPERTY_OF), var("z"), var("g")),
        ],
    )
}

fn rdfs6() -> Rule {
    rule(
        "rdfs6",
        quad(var("x"), node(rdfs::SUB_PROPERTY_OF), var("x"), var("g")),
        vec![quad(
            var("x"),
            node(rdf::TYPE),
            node(rdf::PROPERTY),
            var("g"),
        )],
    )
}

fn rdfs7() -> Rule {
    rule(
        "rdfs7",
        quad(var("x"), var("b"), var("y"), var("g")),
        vec![
            quad(var("a"), node(rdfs::SUB_PROPERTY_OF), var("b"), var("g")),
            quad(var("x"), var("a"), var("y"), var("g")),
        ],
    )
}

fn rdfs8() -> Rule {
    rule(
        "rdfs8",
        quad(
            var("x"),
            node(rdfs::SUB_CLASS_OF),
            node(rdfs::RESOURCE),
            var("g"),
        ),
        vec![quad(var("x"), node(rdf::TYPE), node(rdfs::CLASS), var("g"))],
    )
}

fn rdfs9() -> Rule {
    rule(
        "rdfs9",
        quad(var("z"), node(rdf::TYPE), var("y"), var("g")),
        vec![
            quad(var("x"), node(rdfs::SUB_CLASS_OF), var("y"), var("g")),
            quad(var("z"), node(rdf::TYPE), var("x"), var("g")),
        ],
    )
}

fn rdfs10() -> Rule {
    rule(
        "rdfs10",
        quad(var("x"), node(rdfs::SUB_CLASS_OF), var("x"), var("g")),
        vec![quad(var("x"), node(rdf::TYPE), node(rdfs::CLASS), var("g"))],
    )
}

fn rdfs11() -> Rule {
    rule(
        "rdfs11",
        quad(var("x"), node(rdfs::SUB_CLASS_OF), var("z"), var("g")),
        vec![
            quad(var("x"), node(rdfs::SUB_CLASS_OF), var("y"), var("g")),
            quad(var("y"), node(rdfs::SUB_CLASS_OF), var("z"), var("g")),
        ],
    )
}

fn rdfs12() -> Rule {
    rule(
        "rdfs12",
        quad(
            var("x"),
            node(rdfs::SUB_PROPERTY_OF),
            node(rdfs::MEMBER),
            var("g"),
        ),
        vec![quad(
            var("x"),
            node(rdf::TYPE),
            node(rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
            var("g"),
        )],
    )
}

fn rdfs13() -> Rule {
    rule(
        "rdfs13",
        quad(
            var("x"),
            node(rdfs::SUB_CLASS_OF),
            node(rdfs::LITERAL),
            var("g"),
        ),
        vec![quad(
            var("x"),
            node(rdf::TYPE),
            node(rdfs::DATATYPE),
            var("g"),
        )],
    )
}

fn rule(id: &'static str, head: Atom, body: Vec<Atom>) -> Rule {
    Rule::new(rule_id(id), head, body).with_source(format!("{W3C_SOURCE}#{id}"))
}

fn quad(
    subject: PatternTerm,
    predicate: PatternTerm,
    object: PatternTerm,
    graph_name: PatternTerm,
) -> Atom {
    quad_atom(subject, predicate, object, graph_name)
}

fn node(node: NamedNode) -> PatternTerm {
    PatternTerm::from(Term::NamedNode(node))
}

fn var(name: &'static str) -> PatternTerm {
    PatternTerm::from(variable(name))
}

#[expect(
    clippy::panic,
    reason = "fixed non-empty built-in variable names satisfy the identifier invariant"
)]
fn variable(name: &'static str) -> Variable {
    match Variable::new(name) {
        Ok(variable) => variable,
        Err(error) => panic!("invalid built-in RDFS rule variable: {error}"),
    }
}

#[expect(
    clippy::panic,
    reason = "fixed non-empty W3C rule identifiers satisfy the identifier invariant"
)]
fn rule_id(id: &'static str) -> RuleId {
    match RuleId::new(id) {
        Ok(id) => id,
        Err(error) => panic!("invalid built-in RDFS rule identifier: {error}"),
    }
}
