#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by rule family"
)]

use super::{Owl2RlExecutionPath, Owl2RlGeneralizedTriple, Owl2RlRdfError, Runtime};
use crate::{
    rules::positive_seed_program,
    vocabulary::{
        ALL_VALUES_FROM, CLASS, DATATYPE_PROPERTY, EQUIVALENT_CLASS, EQUIVALENT_PROPERTY,
        FUNCTIONAL_PROPERTY, HAS_VALUE, INVERSE_FUNCTIONAL_PROPERTY, MAX_CARDINALITY,
        MAX_QUALIFIED_CARDINALITY, NOTHING, OBJECT_PROPERTY, ON_CLASS, ON_PROPERTY, SAME_AS,
        SOME_VALUES_FROM, THING,
    },
};
use oxdatalog::{
    Atom, Engine, EvaluationOptions, PatternTerm, Program, Rule, RuleId, Value, Variable,
    rdf::{QUAD_RELATION_IRI, fact_from_quad, quad_atom, quad_from_fact},
};
use oxrdf::{
    GraphName, Literal, NamedNode, Term,
    vocab::{rdf, rdfs, xsd},
};

const SOURCE: &str = "https://www.w3.org/TR/2012/REC-owl2-profiles-20121211/";

pub(super) fn program() -> Program {
    let mut rules = positive_seed_program().rules().to_vec();
    equality(&mut rules);
    properties(&mut rules);
    classes(&mut rules);
    schema(&mut rules);
    Program::new(rules)
}

fn equality(rules: &mut Vec<Rule>) {
    for (suffix, position) in [("s", 0), ("p", 1), ("o", 2)] {
        let terms = [v("s"), v("p"), v("o"), v("g")];
        let selected = terms[position].clone();
        add(
            rules,
            "eq-ref",
            &format!("eq-ref-{suffix}"),
            q(selected.clone(), n(SAME_AS), selected, v("g")),
            vec![q(
                terms[0].clone(),
                terms[1].clone(),
                terms[2].clone(),
                terms[3].clone(),
            )],
        );
    }
}

fn properties(rules: &mut Vec<Rule>) {
    add(
        rules,
        "prp-fp",
        "prp-fp",
        q(v("y1"), n(SAME_AS), v("y2"), v("g")),
        vec![
            q(v("p"), n(rdf::TYPE), n(FUNCTIONAL_PROPERTY), v("g")),
            q(v("x"), v("p"), v("y1"), v("g")),
            q(v("x"), v("p"), v("y2"), v("g")),
        ],
    );
    add(
        rules,
        "prp-ifp",
        "prp-ifp",
        q(v("x1"), n(SAME_AS), v("x2"), v("g")),
        vec![
            q(v("p"), n(rdf::TYPE), n(INVERSE_FUNCTIONAL_PROPERTY), v("g")),
            q(v("x1"), v("p"), v("y"), v("g")),
            q(v("x2"), v("p"), v("y"), v("g")),
        ],
    );
}

fn classes(rules: &mut Vec<Rule>) {
    add(
        rules,
        "cls-svf1",
        "cls-svf1",
        q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
        vec![
            q(v("xx"), n(SOME_VALUES_FROM), v("y1"), v("g")),
            q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
            q(v("x"), v("p"), v("y"), v("g")),
            q(v("y"), n(rdf::TYPE), v("y1"), v("g")),
        ],
    );
    add(
        rules,
        "cls-svf2",
        "cls-svf2",
        q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
        vec![
            q(v("xx"), n(SOME_VALUES_FROM), n(THING), v("g")),
            q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
            q(v("x"), v("p"), v("y"), v("g")),
        ],
    );
    add(
        rules,
        "cls-avf",
        "cls-avf",
        q(v("y"), n(rdf::TYPE), v("y1"), v("g")),
        vec![
            q(v("xx"), n(ALL_VALUES_FROM), v("y1"), v("g")),
            q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
            q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
            q(v("x"), v("p"), v("y"), v("g")),
        ],
    );
    add(
        rules,
        "cls-hv1",
        "cls-hv1",
        q(v("x"), v("p"), v("y"), v("g")),
        vec![
            q(v("xx"), n(HAS_VALUE), v("y"), v("g")),
            q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
            q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
        ],
    );
    add(
        rules,
        "cls-hv2",
        "cls-hv2",
        q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
        vec![
            q(v("xx"), n(HAS_VALUE), v("y"), v("g")),
            q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
            q(v("x"), v("p"), v("y"), v("g")),
        ],
    );
    cardinality(rules, MAX_CARDINALITY, None, "cls-maxc2");
    cardinality(rules, MAX_QUALIFIED_CARDINALITY, Some(false), "cls-maxqc3");
    cardinality(rules, MAX_QUALIFIED_CARDINALITY, Some(true), "cls-maxqc4");
}

fn cardinality(
    rules: &mut Vec<Rule>,
    cardinality_property: NamedNode,
    qualified: Option<bool>,
    id: &'static str,
) {
    let mut body = vec![
        q(
            v("xx"),
            n(cardinality_property),
            t(Literal::new_typed_literal("1", xsd::NON_NEGATIVE_INTEGER).into()),
            v("g"),
        ),
        q(v("xx"), n(ON_PROPERTY), v("p"), v("g")),
        q(v("x"), n(rdf::TYPE), v("xx"), v("g")),
        q(v("x"), v("p"), v("y1"), v("g")),
        q(v("x"), v("p"), v("y2"), v("g")),
    ];
    if let Some(thing) = qualified {
        body.push(q(
            v("xx"),
            n(ON_CLASS),
            if thing { n(THING) } else { v("c") },
            v("g"),
        ));
        if !thing {
            body.push(q(v("y1"), n(rdf::TYPE), v("c"), v("g")));
            body.push(q(v("y2"), n(rdf::TYPE), v("c"), v("g")));
        }
    }
    add(rules, id, id, q(v("y1"), n(SAME_AS), v("y2"), v("g")), body);
}

fn schema(rules: &mut Vec<Rule>) {
    for (suffix, head) in [
        ("sub-self", q(v("c"), n(rdfs::SUB_CLASS_OF), v("c"), v("g"))),
        ("eq-self", q(v("c"), n(EQUIVALENT_CLASS), v("c"), v("g"))),
        ("thing", q(v("c"), n(rdfs::SUB_CLASS_OF), n(THING), v("g"))),
        (
            "nothing",
            q(n(NOTHING), n(rdfs::SUB_CLASS_OF), v("c"), v("g")),
        ),
    ] {
        add(
            rules,
            "scm-cls",
            &format!("scm-cls-{suffix}"),
            head,
            vec![q(v("c"), n(rdf::TYPE), n(CLASS), v("g"))],
        );
    }
    bidirectional(rules, "scm-eqc1", &EQUIVALENT_CLASS, &rdfs::SUB_CLASS_OF);
    add(
        rules,
        "scm-eqc2",
        "scm-eqc2",
        q(v("c1"), n(EQUIVALENT_CLASS), v("c2"), v("g")),
        vec![
            q(v("c1"), n(rdfs::SUB_CLASS_OF), v("c2"), v("g")),
            q(v("c2"), n(rdfs::SUB_CLASS_OF), v("c1"), v("g")),
        ],
    );
    property_schema(rules, &OBJECT_PROPERTY, "scm-op");
    property_schema(rules, &DATATYPE_PROPERTY, "scm-dp");
    bidirectional(
        rules,
        "scm-eqp1",
        &EQUIVALENT_PROPERTY,
        &rdfs::SUB_PROPERTY_OF,
    );
    add(
        rules,
        "scm-eqp2",
        "scm-eqp2",
        q(v("p1"), n(EQUIVALENT_PROPERTY), v("p2"), v("g")),
        vec![
            q(v("p1"), n(rdfs::SUB_PROPERTY_OF), v("p2"), v("g")),
            q(v("p2"), n(rdfs::SUB_PROPERTY_OF), v("p1"), v("g")),
        ],
    );
    domain_range(rules, rdfs::DOMAIN, "scm-dom1", "scm-dom2");
    domain_range(rules, rdfs::RANGE, "scm-rng1", "scm-rng2");
    restriction_schema(rules);
}

fn property_schema(rules: &mut Vec<Rule>, kind: &NamedNode, id: &'static str) {
    for (suffix, predicate) in [("sub", rdfs::SUB_PROPERTY_OF), ("eq", EQUIVALENT_PROPERTY)] {
        add(
            rules,
            id,
            &format!("{id}-{suffix}"),
            q(v("p"), n(predicate), v("p"), v("g")),
            vec![q(v("p"), n(rdf::TYPE), n(kind.clone()), v("g"))],
        );
    }
}

fn bidirectional(
    rules: &mut Vec<Rule>,
    id: &'static str,
    premise: &NamedNode,
    conclusion: &NamedNode,
) {
    for (suffix, left, right) in [("fwd", "x1", "x2"), ("rev", "x2", "x1")] {
        add(
            rules,
            id,
            &format!("{id}-{suffix}"),
            q(v(left), n(conclusion.clone()), v(right), v("g")),
            vec![q(v("x1"), n(premise.clone()), v("x2"), v("g"))],
        );
    }
}

fn domain_range(
    rules: &mut Vec<Rule>,
    predicate: NamedNode,
    class_id: &'static str,
    property_id: &'static str,
) {
    add(
        rules,
        class_id,
        class_id,
        q(v("p"), n(predicate.clone()), v("c2"), v("g")),
        vec![
            q(v("p"), n(predicate.clone()), v("c1"), v("g")),
            q(v("c1"), n(rdfs::SUB_CLASS_OF), v("c2"), v("g")),
        ],
    );
    add(
        rules,
        property_id,
        property_id,
        q(v("p1"), n(predicate.clone()), v("c"), v("g")),
        vec![
            q(v("p1"), n(rdfs::SUB_PROPERTY_OF), v("p2"), v("g")),
            q(v("p2"), n(predicate), v("c"), v("g")),
        ],
    );
}

fn restriction_schema(rules: &mut Vec<Rule>) {
    let cases = [
        ("scm-hv", HAS_VALUE, "p1", "p2", false),
        ("scm-svf1", SOME_VALUES_FROM, "p", "p", true),
        ("scm-svf2", SOME_VALUES_FROM, "p1", "p2", false),
        ("scm-avf1", ALL_VALUES_FROM, "p", "p", true),
        ("scm-avf2", ALL_VALUES_FROM, "p2", "p1", false),
    ];
    for (id, facet, p1, p2, filler_subclass) in cases {
        let mut body = vec![
            q(v("x1"), n(ON_PROPERTY), v(p1), v("g")),
            q(v("x1"), n(facet.clone()), v("y1"), v("g")),
            q(v("x2"), n(ON_PROPERTY), v(p2), v("g")),
            q(v("x2"), n(facet), v("y2"), v("g")),
        ];
        if filler_subclass {
            body.push(q(v("y1"), n(rdfs::SUB_CLASS_OF), v("y2"), v("g")));
        } else if id == "scm-hv" {
            body.push(q(v("p1"), n(rdfs::SUB_PROPERTY_OF), v("p2"), v("g")));
            body.push(q(v("y1"), n(SAME_AS), v("y2"), v("g")));
        } else {
            body.push(q(v(p1), n(rdfs::SUB_PROPERTY_OF), v(p2), v("g")));
            body.push(q(v("y1"), n(SAME_AS), v("y2"), v("g")));
        }
        add(
            rules,
            id,
            id,
            q(v("x1"), n(rdfs::SUB_CLASS_OF), v("x2"), v("g")),
            body,
        );
    }
}

impl Runtime<'_> {
    pub(super) fn apply_datalog_core(&mut self) -> Result<(), Owl2RlRdfError> {
        self.check()?;
        let options = self.datalog_options();
        let result = Engine::default()
            .evaluate(
                &self.datalog_program,
                self.all.iter().map(fact_from_quad),
                &options,
            )
            .map_err(oxdatalog::rdf::RdfEvaluationError::from)?;
        self.datalog_executions = self.datalog_executions.saturating_add(1);
        self.datalog_iterations = self.datalog_iterations.saturating_add(result.iterations());
        let combined_memory = self
            .runtime_memory_estimate()
            .saturating_add(result.peak_estimated_working_set_bytes());
        if combined_memory > self.options.evaluation.limits.max_memory_bytes {
            return Err(super::limit(
                oxdatalog::LimitKind::Memory,
                self.options.evaluation.limits.max_memory_bytes,
            ));
        }
        self.peak_memory = self.peak_memory.max(combined_memory);
        for fact in result.derived_facts() {
            let Some(derivation) = result
                .provenance()
                .and_then(|provenance| provenance.derivation(fact))
            else {
                continue;
            };
            let canonical = canonical_rule_id(derivation.rule_id().as_str());
            let premises = derivation
                .premises()
                .iter()
                .filter_map(|premise| quad_from_fact(premise).ok())
                .collect::<Vec<_>>();
            if let Ok(quad) = quad_from_fact(fact) {
                self.insert_with_path(quad, canonical, &premises, Owl2RlExecutionPath::Datalog)?;
            } else if let Some(generalized) = generalized_from_fact(fact) {
                self.generalized.insert(generalized.clone());
                if generalized.predicate == SAME_AS {
                    self.equalities.insert((
                        generalized.graph_name,
                        generalized.subject,
                        generalized.object,
                    ));
                }
            }
        }
        self.observe_memory()
    }

    fn datalog_options(&self) -> EvaluationOptions {
        let mut options = self.options.evaluation.clone();
        options.track_provenance = true;
        options.limits.max_memory_bytes = options
            .limits
            .max_memory_bytes
            .saturating_sub(self.runtime_memory_estimate());
        if let Some(timeout) = options.limits.timeout {
            options.limits.timeout = Some(timeout.saturating_sub(self.started.elapsed()));
        }
        options
    }
}

fn generalized_from_fact(fact: &oxdatalog::Fact) -> Option<Owl2RlGeneralizedTriple> {
    if fact.relation().as_str() != QUAD_RELATION_IRI {
        return None;
    }
    let [
        Value::Term(subject),
        Value::Term(predicate),
        Value::Term(object),
        graph,
    ] = fact.values()
    else {
        return None;
    };
    let graph_name = match graph {
        Value::DefaultGraph => GraphName::DefaultGraph,
        Value::Term(Term::NamedNode(node)) => node.clone().into(),
        Value::Term(Term::BlankNode(node)) => node.clone().into(),
        Value::Term(_) => return None,
    };
    Some(Owl2RlGeneralizedTriple {
        graph_name,
        subject: subject.clone(),
        predicate: predicate.clone(),
        object: object.clone(),
    })
}

fn canonical_rule_id(id: &str) -> &'static str {
    crate::full_rules::DATALOG_RULE_IDS
        .iter()
        .copied()
        .find(|canonical| id == *canonical || id.starts_with(&format!("{canonical}-")))
        .unwrap_or("owl2-rl-datalog")
}

fn add(rules: &mut Vec<Rule>, canonical: &'static str, variant: &str, head: Atom, body: Vec<Atom>) {
    rules
        .push(Rule::new(rule_id(variant), head, body).with_source(format!("{SOURCE}#{canonical}")));
}

fn q(s: PatternTerm, p: PatternTerm, o: PatternTerm, g: PatternTerm) -> Atom {
    quad_atom(s, p, o, g)
}

fn n(node: NamedNode) -> PatternTerm {
    t(node.into())
}

fn t(term: Term) -> PatternTerm {
    PatternTerm::from(term)
}

#[expect(
    clippy::expect_used,
    reason = "fixed built-in OWL rule variables satisfy identifier validation"
)]
fn v(name: &str) -> PatternTerm {
    PatternTerm::from(Variable::new(name).expect("built-in variables are valid"))
}

#[expect(
    clippy::expect_used,
    reason = "fixed built-in OWL rule identifiers satisfy identifier validation"
)]
fn rule_id(id: &str) -> RuleId {
    RuleId::new(id).expect("built-in rule identifiers are valid")
}

#[cfg(test)]
mod tests {
    use super::program;
    use crate::full_rules::{DATALOG_RULE_IDS, SPECIALIZED_RULE_IDS};
    use std::collections::HashSet;

    #[test]
    fn program_sources_cover_exactly_the_datalog_partition() {
        let program = program();
        let compiled = program
            .rules()
            .iter()
            .filter_map(|rule| rule.source()?.rsplit_once('#').map(|(_, id)| id))
            .collect::<HashSet<_>>();
        let expected = DATALOG_RULE_IDS.iter().copied().collect::<HashSet<_>>();
        let specialized = SPECIALIZED_RULE_IDS.iter().copied().collect::<HashSet<_>>();
        assert_eq!(compiled, expected);
        assert!(compiled.is_disjoint(&specialized));
        assert!(program.rules().iter().all(oxdatalog::Rule::is_positive));
    }
}
