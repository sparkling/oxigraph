use oxdatalog::{
    Atom, Engine, EvaluationOptions, Fact, PatternTerm, Program, RelationId, Rule, RuleId, Value,
};
use oxrdf::{NamedNode, Term};
use std::collections::BTreeSet;
use std::env;
use std::error::Error;
use std::fs;
use std::path::Path;

const NODE_PREFIX: &str = "urn:test:node:";

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input_path = arguments
        .next()
        .ok_or("usage: d0_reference <input.tsv> <output.tsv>")?;
    let output_path = arguments
        .next()
        .ok_or("usage: d0_reference <input.tsv> <output.tsv>")?;
    if arguments.next().is_some() {
        return Err("usage: d0_reference <input.tsv> <output.tsv>".into());
    }

    let edge = relation("edge")?;
    let facts = read_edges(Path::new(&input_path), &edge)?;
    let result =
        Engine::default().evaluate(&ancestor_program()?, facts, &EvaluationOptions::default())?;
    let rows = result
        .derived_facts()
        .iter()
        .map(ancestor_row)
        .collect::<Result<BTreeSet<_>, _>>()?;
    let mut output = rows.into_iter().collect::<Vec<_>>().join("\n");
    output.push('\n');
    fs::write(output_path, output)?;
    Ok(())
}

fn relation(name: &str) -> Result<RelationId, Box<dyn Error>> {
    Ok(RelationId::new(format!("urn:test:relation:{name}"))?)
}

fn variable(name: &str) -> Result<PatternTerm, Box<dyn Error>> {
    Ok(PatternTerm::variable(name)?)
}

fn atom(relation: &RelationId, variables: &[&str]) -> Result<Atom, Box<dyn Error>> {
    Ok(Atom::new(
        relation.clone(),
        variables
            .iter()
            .map(|name| variable(name))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

fn ancestor_program() -> Result<Program, Box<dyn Error>> {
    let edge = relation("edge")?;
    let ancestor = relation("ancestor")?;
    Ok(Program::new(vec![
        Rule::new(
            RuleId::new("ancestor-direct")?,
            atom(&ancestor, &["subject", "object"])?,
            vec![atom(&edge, &["subject", "object"])?],
        ),
        Rule::new(
            RuleId::new("ancestor-transitive")?,
            atom(&ancestor, &["subject", "descendant"])?,
            vec![
                atom(&ancestor, &["subject", "middle"])?,
                atom(&edge, &["middle", "descendant"])?,
            ],
        ),
    ]))
}

fn read_edges(path: &Path, edge: &RelationId) -> Result<Vec<Fact>, Box<dyn Error>> {
    let input = fs::read_to_string(path)?;
    input
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.is_empty() && !line.starts_with('#'))
        .map(|(index, line)| {
            let Some((subject, object)) = line.split_once('\t') else {
                return Err(format!(
                    "{}:{}: expected two tab-separated names",
                    path.display(),
                    index + 1
                )
                .into());
            };
            if object.contains('\t') {
                return Err(format!(
                    "{}:{}: expected exactly two columns",
                    path.display(),
                    index + 1
                )
                .into());
            }
            Ok(Fact::new(
                edge.clone(),
                vec![node_value(subject)?, node_value(object)?],
            ))
        })
        .collect()
}

fn node_value(name: &str) -> Result<Value, Box<dyn Error>> {
    validate_name(name)?;
    Ok(Value::Term(
        NamedNode::new(format!("{NODE_PREFIX}{name}"))?.into(),
    ))
}

fn validate_name(name: &str) -> Result<(), Box<dyn Error>> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("invalid fixture name {name:?}").into());
    }
    Ok(())
}

fn ancestor_row(fact: &Fact) -> Result<String, Box<dyn Error>> {
    let [subject, object] = fact.values() else {
        return Err("ancestor result did not have arity two".into());
    };
    Ok(format!("{}\t{}", local_name(subject)?, local_name(object)?))
}

fn local_name(value: &Value) -> Result<&str, Box<dyn Error>> {
    let Value::Term(Term::NamedNode(node)) = value else {
        return Err("ancestor result was not a named node".into());
    };
    node.as_str()
        .strip_prefix(NODE_PREFIX)
        .ok_or_else(|| "ancestor result used an unexpected namespace".into())
}
