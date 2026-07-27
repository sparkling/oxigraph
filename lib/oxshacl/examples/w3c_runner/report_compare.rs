use oxrdf::dataset::CanonicalizationAlgorithm;
use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use oxshacl::ValidationReport;
use std::collections::{BTreeSet, VecDeque};

const SH: &str = "http://www.w3.org/ns/shacl#";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";

pub(super) fn compare(
    wrapper: &Dataset,
    root: &NamedOrBlankNode,
    actual: &ValidationReport,
) -> Result<(), String> {
    let mut expected = extract_report(wrapper, root)?;
    let mut actual = actual
        .canonical()
        .dataset()
        .iter()
        .filter(|quad| quad.predicate.as_str() != sh("conformanceDisallows"))
        .collect::<Dataset>();
    expected
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| format!("failed to canonicalize expected report: {error}"))?;
    actual
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| format!("failed to canonicalize actual report: {error}"))?;
    if expected == actual {
        return Ok(());
    }
    Err(format!(
        "validation report graph mismatch: expected=[{}] actual=[{}]",
        lines(&expected),
        lines(&actual)
    ))
}

fn extract_report(wrapper: &Dataset, root: &NamedOrBlankNode) -> Result<Dataset, String> {
    let mut output = Dataset::new();
    let mut results = VecDeque::new();
    for quad in wrapper.quads_for_subject(root) {
        match quad.predicate.as_str() {
            value if value == sh("conformanceDisallows") => {}
            value if value == sh("result") => {
                let result = as_subject(&quad.object)
                    .ok_or("expected sh:result value is not an RDF node")?;
                results.push_back(result);
                output.insert(default_quad(quad));
            }
            _ => {
                output.insert(default_quad(quad));
            }
        }
    }
    let mut seen_results = BTreeSet::new();
    let mut paths = VecDeque::new();
    let mut source_constraints = VecDeque::new();
    while let Some(result) = results.pop_front() {
        if !seen_results.insert(result.to_string()) {
            continue;
        }
        for quad in wrapper.quads_for_subject(&result) {
            if quad.predicate.as_str() == sh("detail") {
                results.push_back(
                    as_subject(&quad.object)
                        .ok_or("expected sh:detail value is not an RDF node")?,
                );
            } else if quad.predicate.as_str() == sh("resultPath")
                && matches!(quad.object, Term::BlankNode(_))
            {
                paths.push_back(
                    as_subject(&quad.object)
                        .ok_or("expected sh:resultPath value is not an RDF node")?,
                );
            } else if quad.predicate.as_str() == sh("sourceConstraint")
                && matches!(quad.object, Term::BlankNode(_))
            {
                source_constraints.push_back(
                    as_subject(&quad.object)
                        .ok_or("expected sh:sourceConstraint value is not an RDF node")?,
                );
            }
            output.insert(default_quad(quad));
        }
    }
    copy_paths(wrapper, &mut output, paths);
    copy_blank_closures(wrapper, &mut output, source_constraints);
    if output.is_empty() {
        return Err("expected validation report graph is empty".to_owned());
    }
    Ok(output)
}

fn copy_blank_closures(
    wrapper: &Dataset,
    output: &mut Dataset,
    mut pending: VecDeque<NamedOrBlankNode>,
) {
    let mut seen = BTreeSet::new();
    while let Some(node) = pending.pop_front() {
        if !seen.insert(node.to_string()) {
            continue;
        }
        for quad in wrapper.quads_for_subject(&node) {
            if let Term::BlankNode(child) = &quad.object {
                pending.push_back(child.clone().into());
            }
            output.insert(default_quad(quad));
        }
    }
}

fn copy_paths(wrapper: &Dataset, output: &mut Dataset, mut paths: VecDeque<NamedOrBlankNode>) {
    let mut seen = BTreeSet::new();
    while let Some(path) = paths.pop_front() {
        if !seen.insert(path.to_string()) {
            continue;
        }
        for quad in wrapper.quads_for_subject(&path) {
            let predicate = quad.predicate.as_str();
            if is_path_link(predicate)
                && let Some(object) = as_subject(&quad.object)
                && !matches!(&quad.object, Term::NamedNode(node) if node.as_str().ends_with("#nil"))
            {
                paths.push_back(object);
            }
            output.insert(default_quad(quad));
        }
    }
}

fn is_path_link(predicate: &str) -> bool {
    matches!(predicate, RDF_FIRST | RDF_REST)
        || matches!(
            predicate.strip_prefix(SH),
            Some(
                "alternativePath"
                    | "inversePath"
                    | "zeroOrMorePath"
                    | "oneOrMorePath"
                    | "zeroOrOnePath"
            )
        )
}

fn default_quad(quad: Quad) -> Quad {
    Quad::new(
        quad.subject,
        quad.predicate,
        quad.object,
        GraphName::DefaultGraph,
    )
}

fn as_subject(term: &Term) -> Option<NamedOrBlankNode> {
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}

fn sh(local: &str) -> String {
    format!("{SH}{local}")
}

fn lines(dataset: &Dataset) -> String {
    let mut lines = dataset
        .iter()
        .map(|quad| quad.to_string())
        .collect::<Vec<_>>();
    lines.sort();
    lines.into_iter().take(24).collect::<Vec<_>>().join(" ")
}
