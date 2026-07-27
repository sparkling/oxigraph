use crate::vocabulary::{
    EQUIVALENT_CLASS, EQUIVALENT_PROPERTY, INVERSE_OF, SAME_AS, SYMMETRIC_PROPERTY,
    TRANSITIVE_PROPERTY,
};
use oxdatalog::{Atom, PatternTerm, Program, Rule, RuleId, Variable, rdf::quad_atom};
use oxrdf::{
    NamedNode, Term,
    vocab::{rdf, rdfs},
};

const W3C_RULES_SOURCE: &str = "https://www.w3.org/TR/2012/REC-owl2-profiles-20121211/";

/// Stable metadata for one implemented W3C OWL 2 RL/RDF rule.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Owl2RlRule {
    id: &'static str,
    source: &'static str,
}

impl Owl2RlRule {
    pub(crate) const fn metadata(id: &'static str, source: &'static str) -> Self {
        Self { id, source }
    }

    /// The stable W3C rule identifier.
    pub const fn id(self) -> &'static str {
        self.id
    }

    /// The dated W3C Recommendation URL and rule fragment.
    pub const fn source(self) -> &'static str {
        self.source
    }
}

/// The complete rule inventory for the positive seed.
pub const IMPLEMENTED_RULES: &[Owl2RlRule] = &[
    Owl2RlRule {
        id: "eq-sym",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#eq-sym"
        ),
    },
    Owl2RlRule {
        id: "eq-trans",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#eq-trans"
        ),
    },
    Owl2RlRule {
        id: "eq-rep-s",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#eq-rep-s"
        ),
    },
    Owl2RlRule {
        id: "eq-rep-p",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#eq-rep-p"
        ),
    },
    Owl2RlRule {
        id: "eq-rep-o",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#eq-rep-o"
        ),
    },
    Owl2RlRule {
        id: "scm-sco",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#scm-sco"
        ),
    },
    Owl2RlRule {
        id: "scm-spo",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#scm-spo"
        ),
    },
    Owl2RlRule {
        id: "cax-sco",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#cax-sco"
        ),
    },
    Owl2RlRule {
        id: "cax-eqc1",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#cax-eqc1"
        ),
    },
    Owl2RlRule {
        id: "cax-eqc2",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#cax-eqc2"
        ),
    },
    Owl2RlRule {
        id: "prp-spo1",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-spo1"
        ),
    },
    Owl2RlRule {
        id: "prp-eqp1",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-eqp1"
        ),
    },
    Owl2RlRule {
        id: "prp-eqp2",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-eqp2"
        ),
    },
    Owl2RlRule {
        id: "prp-dom",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-dom"
        ),
    },
    Owl2RlRule {
        id: "prp-rng",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-rng"
        ),
    },
    Owl2RlRule {
        id: "prp-trp",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-trp"
        ),
    },
    Owl2RlRule {
        id: "prp-symp",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-symp"
        ),
    },
    Owl2RlRule {
        id: "prp-inv1",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-inv1"
        ),
    },
    Owl2RlRule {
        id: "prp-inv2",
        source: concat!(
            "https://www.w3.org/TR/2012/",
            "REC-owl2-profiles-20121211/#prp-inv2"
        ),
    },
];

pub(crate) fn positive_seed_program() -> Program {
    Program::new(vec![
        eq_sym(),
        eq_trans(),
        eq_rep_s(),
        eq_rep_p(),
        eq_rep_o(),
        scm_sco(),
        scm_spo(),
        cax_sco(),
        cax_eqc1(),
        cax_eqc2(),
        prp_spo1(),
        prp_eqp1(),
        prp_eqp2(),
        prp_dom(),
        prp_rng(),
        prp_trp(),
        prp_symp(),
        prp_inv1(),
        prp_inv2(),
    ])
}

fn eq_sym() -> Rule {
    rule(
        "eq-sym",
        quad(var("y"), node(SAME_AS), var("x"), var("g")),
        vec![quad(var("x"), node(SAME_AS), var("y"), var("g"))],
    )
}

fn eq_trans() -> Rule {
    rule(
        "eq-trans",
        quad(var("x"), node(SAME_AS), var("z"), var("g")),
        vec![
            quad(var("x"), node(SAME_AS), var("y"), var("g")),
            quad(var("y"), node(SAME_AS), var("z"), var("g")),
        ],
    )
}

fn eq_rep_s() -> Rule {
    rule(
        "eq-rep-s",
        quad(var("s2"), var("p"), var("o"), var("g")),
        vec![
            quad(var("s1"), node(SAME_AS), var("s2"), var("g")),
            quad(var("s1"), var("p"), var("o"), var("g")),
        ],
    )
}

fn eq_rep_p() -> Rule {
    rule(
        "eq-rep-p",
        quad(var("s"), var("p2"), var("o"), var("g")),
        vec![
            quad(var("p1"), node(SAME_AS), var("p2"), var("g")),
            quad(var("s"), var("p1"), var("o"), var("g")),
        ],
    )
}

fn eq_rep_o() -> Rule {
    rule(
        "eq-rep-o",
        quad(var("s"), var("p"), var("o2"), var("g")),
        vec![
            quad(var("o1"), node(SAME_AS), var("o2"), var("g")),
            quad(var("s"), var("p"), var("o1"), var("g")),
        ],
    )
}

fn scm_sco() -> Rule {
    rule(
        "scm-sco",
        quad(var("c1"), node(rdfs::SUB_CLASS_OF), var("c3"), var("g")),
        vec![
            quad(var("c1"), node(rdfs::SUB_CLASS_OF), var("c2"), var("g")),
            quad(var("c2"), node(rdfs::SUB_CLASS_OF), var("c3"), var("g")),
        ],
    )
}

fn scm_spo() -> Rule {
    rule(
        "scm-spo",
        quad(var("p1"), node(rdfs::SUB_PROPERTY_OF), var("p3"), var("g")),
        vec![
            quad(var("p1"), node(rdfs::SUB_PROPERTY_OF), var("p2"), var("g")),
            quad(var("p2"), node(rdfs::SUB_PROPERTY_OF), var("p3"), var("g")),
        ],
    )
}

fn cax_sco() -> Rule {
    rule(
        "cax-sco",
        quad(var("x"), node(rdf::TYPE), var("c2"), var("g")),
        vec![
            quad(var("c1"), node(rdfs::SUB_CLASS_OF), var("c2"), var("g")),
            quad(var("x"), node(rdf::TYPE), var("c1"), var("g")),
        ],
    )
}

fn cax_eqc1() -> Rule {
    rule(
        "cax-eqc1",
        quad(var("x"), node(rdf::TYPE), var("c2"), var("g")),
        vec![
            quad(var("c1"), node(EQUIVALENT_CLASS), var("c2"), var("g")),
            quad(var("x"), node(rdf::TYPE), var("c1"), var("g")),
        ],
    )
}

fn cax_eqc2() -> Rule {
    rule(
        "cax-eqc2",
        quad(var("x"), node(rdf::TYPE), var("c1"), var("g")),
        vec![
            quad(var("c1"), node(EQUIVALENT_CLASS), var("c2"), var("g")),
            quad(var("x"), node(rdf::TYPE), var("c2"), var("g")),
        ],
    )
}

fn prp_spo1() -> Rule {
    rule(
        "prp-spo1",
        quad(var("x"), var("p2"), var("y"), var("g")),
        vec![
            quad(var("p1"), node(rdfs::SUB_PROPERTY_OF), var("p2"), var("g")),
            quad(var("x"), var("p1"), var("y"), var("g")),
        ],
    )
}

fn prp_eqp1() -> Rule {
    rule(
        "prp-eqp1",
        quad(var("x"), var("p2"), var("y"), var("g")),
        vec![
            quad(var("p1"), node(EQUIVALENT_PROPERTY), var("p2"), var("g")),
            quad(var("x"), var("p1"), var("y"), var("g")),
        ],
    )
}

fn prp_eqp2() -> Rule {
    rule(
        "prp-eqp2",
        quad(var("x"), var("p1"), var("y"), var("g")),
        vec![
            quad(var("p1"), node(EQUIVALENT_PROPERTY), var("p2"), var("g")),
            quad(var("x"), var("p2"), var("y"), var("g")),
        ],
    )
}

fn prp_dom() -> Rule {
    rule(
        "prp-dom",
        quad(var("x"), node(rdf::TYPE), var("c"), var("g")),
        vec![
            quad(var("p"), node(rdfs::DOMAIN), var("c"), var("g")),
            quad(var("x"), var("p"), var("y"), var("g")),
        ],
    )
}

fn prp_rng() -> Rule {
    rule(
        "prp-rng",
        quad(var("y"), node(rdf::TYPE), var("c"), var("g")),
        vec![
            quad(var("p"), node(rdfs::RANGE), var("c"), var("g")),
            quad(var("x"), var("p"), var("y"), var("g")),
        ],
    )
}

fn prp_trp() -> Rule {
    rule(
        "prp-trp",
        quad(var("x"), var("p"), var("z"), var("g")),
        vec![
            quad(
                var("p"),
                node(rdf::TYPE),
                node(TRANSITIVE_PROPERTY),
                var("g"),
            ),
            quad(var("x"), var("p"), var("y"), var("g")),
            quad(var("y"), var("p"), var("z"), var("g")),
        ],
    )
}

fn prp_symp() -> Rule {
    rule(
        "prp-symp",
        quad(var("y"), var("p"), var("x"), var("g")),
        vec![
            quad(
                var("p"),
                node(rdf::TYPE),
                node(SYMMETRIC_PROPERTY),
                var("g"),
            ),
            quad(var("x"), var("p"), var("y"), var("g")),
        ],
    )
}

fn prp_inv1() -> Rule {
    rule(
        "prp-inv1",
        quad(var("y"), var("p2"), var("x"), var("g")),
        vec![
            quad(var("p1"), node(INVERSE_OF), var("p2"), var("g")),
            quad(var("x"), var("p1"), var("y"), var("g")),
        ],
    )
}

fn prp_inv2() -> Rule {
    rule(
        "prp-inv2",
        quad(var("y"), var("p1"), var("x"), var("g")),
        vec![
            quad(var("p1"), node(INVERSE_OF), var("p2"), var("g")),
            quad(var("x"), var("p2"), var("y"), var("g")),
        ],
    )
}

fn rule(id: &'static str, head: Atom, body: Vec<Atom>) -> Rule {
    Rule::new(rule_id(id), head, body).with_source(format!("{W3C_RULES_SOURCE}#{id}"))
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
        Err(error) => panic!("invalid built-in OWL rule variable: {error}"),
    }
}

#[expect(
    clippy::panic,
    reason = "fixed non-empty W3C rule identifiers satisfy the identifier invariant"
)]
fn rule_id(id: &'static str) -> RuleId {
    match RuleId::new(id) {
        Ok(id) => id,
        Err(error) => panic!("invalid built-in OWL rule identifier: {error}"),
    }
}
