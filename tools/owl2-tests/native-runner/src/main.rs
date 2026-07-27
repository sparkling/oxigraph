use oxowl::{Owl2RlConsistency, Owl2RlDatatypeMode, Owl2RlRdf, Owl2RlRdfOptions};
use oxrdf::{BlankNode, Dataset, NamedOrBlankNode, Quad, Term};
use oxrdfio::{RdfFormat, RdfParser};
use std::{
    collections::HashMap,
    env,
    error::Error,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::Path,
};

fn main() -> Result<(), Box<dyn Error>> {
    let manifest = env::args().nth(1).ok_or("missing TSV manifest path")?;
    for line in BufReader::new(File::open(manifest)?).lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 5 {
            return Err(format!("invalid manifest row: {line}").into());
        }
        let result = run(
            fields[1],
            Path::new(fields[2]),
            Path::new(fields[3]),
            fields[4],
        );
        match result {
            Ok(value) => println!(
                "{{\"id\":\"{}\",\"mode\":\"{}\",\"passed\":{value}}}",
                json(fields[0]),
                json(fields[1])
            ),
            Err(error) => println!(
                "{{\"id\":\"{}\",\"mode\":\"{}\",\"passed\":false,\"error\":\"{}\"}}",
                json(fields[0]),
                json(fields[1]),
                json(&error.to_string())
            ),
        }
    }
    Ok(())
}

fn run(
    mode: &str,
    premise: &Path,
    conclusion: &Path,
    import: &str,
) -> Result<bool, Box<dyn Error>> {
    let mut base = parse(premise)?;
    if import != "-" {
        for quad in &parse(Path::new(import))? {
            base.insert(quad);
        }
    }
    let mut options = Owl2RlRdfOptions {
        datatype_mode: Owl2RlDatatypeMode::Permissive,
        ..Owl2RlRdfOptions::default()
    };
    options.evaluation.limits.max_facts = 2_000_000;
    options.evaluation.limits.max_intermediate_rows = 20_000_000;
    options.evaluation.limits.max_iterations = 1_000;
    options.evaluation.limits.max_memory_bytes = 1024 * 1024 * 1024;
    let closure = Owl2RlRdf.evaluate(&base, &options)?;
    let inconsistent = matches!(closure.consistency(), Owl2RlConsistency::Inconsistent(_));
    Ok(match mode {
        "consistency" => !inconsistent,
        "inconsistency" => inconsistent,
        "positive" => inconsistent || entails(closure.entailed(), &parse(conclusion)?),
        "negative" => !inconsistent && !entails(closure.entailed(), &parse(conclusion)?),
        _ => return Err(format!("unknown mode: {mode}").into()),
    })
}

fn parse(path: &Path) -> Result<Dataset, Box<dyn Error>> {
    if fs::metadata(path)?.len() == 0 {
        return Ok(Dataset::new());
    }
    let format = if path.extension().is_some_and(|extension| extension == "nt") {
        RdfFormat::NTriples
    } else {
        RdfFormat::RdfXml
    };
    let parser = RdfParser::from_format(format).for_reader(File::open(path)?);
    Ok(parser.collect::<Result<Dataset, _>>()?)
}

fn entails(actual: &Dataset, expected: &Dataset) -> bool {
    let expected = expected.iter().collect::<Vec<_>>();
    let actual = actual.iter().collect::<Vec<_>>();
    match_quads(&expected, &actual, 0, &mut HashMap::new())
}

fn match_quads(
    expected: &[Quad],
    actual: &[Quad],
    index: usize,
    mapping: &mut HashMap<BlankNode, Term>,
) -> bool {
    if index == expected.len() {
        return true;
    }
    let pattern = &expected[index];
    for candidate in actual {
        if pattern.predicate != candidate.predicate || pattern.graph_name != candidate.graph_name {
            continue;
        }
        let mut next = mapping.clone();
        if match_resource(&pattern.subject, &candidate.subject, &mut next)
            && match_term(&pattern.object, &candidate.object, &mut next)
            && match_quads(expected, actual, index + 1, &mut next)
        {
            *mapping = next;
            return true;
        }
    }
    false
}

fn match_resource(
    expected: &NamedOrBlankNode,
    actual: &NamedOrBlankNode,
    mapping: &mut HashMap<BlankNode, Term>,
) -> bool {
    match expected {
        NamedOrBlankNode::NamedNode(node) => actual == node,
        NamedOrBlankNode::BlankNode(blank) => bind(blank, Term::from(actual.clone()), mapping),
    }
}

fn match_term(expected: &Term, actual: &Term, mapping: &mut HashMap<BlankNode, Term>) -> bool {
    match expected {
        Term::BlankNode(blank) => bind(blank, actual.clone(), mapping),
        _ => expected == actual,
    }
}

fn bind(blank: &BlankNode, value: Term, mapping: &mut HashMap<BlankNode, Term>) -> bool {
    if let Some(bound) = mapping.get(blank) {
        bound == &value
    } else {
        mapping.insert(blank.clone(), value);
        true
    }
}

fn json(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
