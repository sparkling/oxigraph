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
    let fixture_directory = arguments
        .next()
        .ok_or("usage: d1_reference <fixture-directory> <output.tsv>")?;
    let output_path = arguments
        .next()
        .ok_or("usage: d1_reference <fixture-directory> <output.tsv>")?;
    if arguments.next().is_some() {
        return Err("usage: d1_reference <fixture-directory> <output.tsv>".into());
    }

    let directory = Path::new(&fixture_directory);
    let edge = relation("edge")?;
    let banned = relation("banned")?;
    let facts = read_binary(&directory.join("edge.facts"), &edge)?
        .into_iter()
        .chain(read_unary(&directory.join("banned.facts"), &banned)?);
    let result =
        Engine::default().evaluate(&safe_path_program()?, facts, &EvaluationOptions::default())?;
    let path = relation("path")?;
    let rows = result
        .facts()
        .iter()
        .filter(|fact| fact.relation() == &path)
        .map(binary_row)
        .collect::<Result<BTreeSet<_>, _>>()?;
    fs::write(
        output_path,
        format!("{}\n", rows.into_iter().collect::<Vec<_>>().join("\n")),
    )?;
    Ok(())
}

fn safe_path_program() -> Result<Program, Box<dyn Error>> {
    let edge = relation("edge")?;
    let banned = relation("banned")?;
    let safe_edge = relation("safe-edge")?;
    let path = relation("path")?;
    Ok(Program::new(vec![
        Rule::new_stratified(
            RuleId::new("safe-edge")?,
            atom(&safe_edge, &["from", "to"])?,
            vec![atom(&edge, &["from", "to"])?],
            vec![atom(&banned, &["to"])?],
        ),
        Rule::new(
            RuleId::new("path-direct")?,
            atom(&path, &["from", "to"])?,
            vec![atom(&safe_edge, &["from", "to"])?],
        ),
        Rule::new(
            RuleId::new("path-transitive")?,
            atom(&path, &["from", "to"])?,
            vec![
                atom(&path, &["from", "middle"])?,
                atom(&safe_edge, &["middle", "to"])?,
            ],
        ),
    ]))
}

fn relation(name: &str) -> Result<RelationId, Box<dyn Error>> {
    Ok(RelationId::new(format!("urn:test:relation:{name}"))?)
}

fn atom(relation: &RelationId, variables: &[&str]) -> Result<Atom, Box<dyn Error>> {
    Ok(Atom::new(
        relation.clone(),
        variables
            .iter()
            .map(|name| PatternTerm::variable(*name))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

fn read_binary(path: &Path, relation: &RelationId) -> Result<Vec<Fact>, Box<dyn Error>> {
    read_rows(path, 2)?
        .into_iter()
        .map(|row| {
            Ok(Fact::new(
                relation.clone(),
                vec![node_value(&row[0])?, node_value(&row[1])?],
            ))
        })
        .collect()
}

fn read_unary(path: &Path, relation: &RelationId) -> Result<Vec<Fact>, Box<dyn Error>> {
    read_rows(path, 1)?
        .into_iter()
        .map(|row| Ok(Fact::new(relation.clone(), vec![node_value(&row[0])?])))
        .collect()
}

fn read_rows(path: &Path, arity: usize) -> Result<Vec<Vec<String>>, Box<dyn Error>> {
    fs::read_to_string(path)?
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.is_empty() && !line.starts_with('#'))
        .map(|(index, line)| {
            let row = line.split('\t').map(str::to_owned).collect::<Vec<_>>();
            if row.len() != arity {
                return Err(format!(
                    "{}:{}: expected exactly {arity} columns",
                    path.display(),
                    index + 1
                )
                .into());
            }
            for value in &row {
                validate_name(value)?;
            }
            Ok(row)
        })
        .collect()
}

fn node_value(name: &str) -> Result<Value, Box<dyn Error>> {
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

fn binary_row(fact: &Fact) -> Result<String, Box<dyn Error>> {
    let [left, right] = fact.values() else {
        return Err("path result did not have arity two".into());
    };
    Ok(format!("{}\t{}", local_name(left)?, local_name(right)?))
}

fn local_name(value: &Value) -> Result<&str, Box<dyn Error>> {
    let Value::Term(Term::NamedNode(node)) = value else {
        return Err("path result was not a named node".into());
    };
    node.as_str()
        .strip_prefix(NODE_PREFIX)
        .ok_or_else(|| "path result used an unexpected namespace".into())
}
