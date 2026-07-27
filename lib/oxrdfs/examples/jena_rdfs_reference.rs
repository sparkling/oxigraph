use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use oxrdfs::{Rdfs12Finite, Rdfs12Options};
use std::{
    collections::BTreeSet,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};

fn main() -> Result<(), Box<dyn Error>> {
    let [input_path, entailed_path, not_entailed_path, output_path] = env::args_os()
        .skip(1)
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|_: Vec<_>| {
            "usage: jena_rdfs_reference \
                 <input.nt> <entailed.nt> <not-entailed.nt> <output.tsv>"
        })?;
    let input_path = PathBuf::from(input_path);
    let entailed_path = PathBuf::from(entailed_path);
    let not_entailed_path = PathBuf::from(not_entailed_path);
    let output_path = PathBuf::from(output_path);

    let base = read_named_triples(&input_path)?;
    let entailed = read_assertions(&entailed_path)?;
    let not_entailed = read_assertions(&not_entailed_path)?;
    let closure = Rdfs12Finite.evaluate(&base, &Rdfs12Options::default())?;
    let mut rows = BTreeSet::new();
    for assertion in entailed {
        if !closure.entailed().contains(&assertion.quad) {
            return Err(format!("missing expected entailment: {}", assertion.line).into());
        }
        rows.insert(format!("entailed\t{}", assertion.line));
    }
    for assertion in not_entailed {
        if closure.entailed().contains(&assertion.quad) {
            return Err(format!("unexpected entailment: {}", assertion.line).into());
        }
        rows.insert(format!("not-entailed\t{}", assertion.line));
    }
    let mut output = rows.into_iter().collect::<Vec<_>>().join("\n");
    output.push('\n');
    fs::write(output_path, output)?;
    Ok(())
}

struct Assertion {
    line: String,
    quad: Quad,
}

fn read_named_triples(path: &Path) -> Result<Dataset, Box<dyn Error>> {
    Ok(Dataset::from_iter(
        read_assertions(path)?
            .into_iter()
            .map(|assertion| assertion.quad),
    ))
}

fn read_assertions(path: &Path) -> Result<Vec<Assertion>, Box<dyn Error>> {
    fs::read_to_string(path)?
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .map(|(index, line)| {
            let line = line.trim();
            Ok(Assertion {
                line: line.to_owned(),
                quad: parse_named_triple(line)
                    .map_err(|error| format!("{}:{}: {error}", path.display(), index + 1))?,
            })
        })
        .collect()
}

fn parse_named_triple(line: &str) -> Result<Quad, &'static str> {
    let mut rest = line;
    let subject = take_iri(&mut rest)?;
    let predicate = take_iri(&mut rest)?;
    let object = take_iri(&mut rest)?;
    if rest.trim() != "." {
        return Err("expected exactly three named nodes followed by a dot");
    }
    Ok(Quad::new(
        NamedNode::new(subject.to_owned()).map_err(|_| "invalid subject IRI")?,
        NamedNode::new(predicate.to_owned()).map_err(|_| "invalid predicate IRI")?,
        NamedNode::new(object.to_owned()).map_err(|_| "invalid object IRI")?,
        GraphName::DefaultGraph,
    ))
}

fn take_iri<'a>(rest: &mut &'a str) -> Result<&'a str, &'static str> {
    *rest = rest.trim_start();
    let after_open = rest
        .strip_prefix('<')
        .ok_or("expected a named-node opening delimiter")?;
    let end = after_open
        .find('>')
        .ok_or("expected a named-node closing delimiter")?;
    let value = &after_open[..end];
    *rest = &after_open[end + 1..];
    Ok(value)
}
