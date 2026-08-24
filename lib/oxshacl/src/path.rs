use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::GraphSnapshot;
use oxrdf::{NamedNode, NamedOrBlankNode, Term};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// Compiled SHACL property path.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum PropertyPath {
    /// One forward predicate step.
    Predicate(NamedNode),
    /// Ordered composition of paths.
    Sequence(Vec<Self>),
    /// Union of alternative paths.
    Alternative(Vec<Self>),
    /// Inverse traversal of a path.
    Inverse(Box<Self>),
    /// Reflexive-transitive closure of a path.
    ZeroOrMore(Box<Self>),
    /// Transitive closure requiring at least one step.
    OneOrMore(Box<Self>),
    /// Zero or one traversal step.
    ZeroOrOne(Box<Self>),
}

/// Structural failure in a property path.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PathError {
    /// A sequence or alternative contains no paths.
    #[error("sequence and alternative paths must not be empty")]
    Empty,
    /// The path nesting depth exceeds the supplied ceiling.
    #[error("property path depth exceeds {0}")]
    Depth(usize),
}

impl PropertyPath {
    /// Checks non-empty composites and enforces the maximum nesting depth.
    pub fn validate(&self, max_depth: usize) -> Result<(), PathError> {
        self.validate_at(0, max_depth)
    }

    fn validate_at(&self, depth: usize, max_depth: usize) -> Result<(), PathError> {
        if depth > max_depth {
            return Err(PathError::Depth(max_depth));
        }
        match self {
            Self::Predicate(_) => Ok(()),
            Self::Sequence(paths) | Self::Alternative(paths) => {
                if paths.is_empty() {
                    return Err(PathError::Empty);
                }
                for path in paths {
                    path.validate_at(depth.saturating_add(1), max_depth)?;
                }
                Ok(())
            }
            Self::Inverse(path)
            | Self::ZeroOrMore(path)
            | Self::OneOrMore(path)
            | Self::ZeroOrOne(path) => path.validate_at(depth.saturating_add(1), max_depth),
        }
    }

    pub(crate) fn evaluate(
        &self,
        graph: &GraphSnapshot,
        starts: impl IntoIterator<Item = Term>,
        budget: &mut Budget<'_>,
        max_depth: usize,
    ) -> Result<Vec<Term>, ValidationError> {
        self.validate(max_depth)
            .map_err(|error| ValidationError::IllFormed(error.to_string()))?;
        let starts = deduplicate(starts);
        self.evaluate_at(graph, &starts, budget, 0, max_depth)
    }

    fn evaluate_at(
        &self,
        graph: &GraphSnapshot,
        starts: &[Term],
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
    ) -> Result<Vec<Term>, ValidationError> {
        budget.check()?;
        if depth > max_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: max_depth,
            });
        }
        match self {
            Self::Predicate(predicate) => forward(graph, starts, predicate, budget),
            Self::Inverse(path) => {
                if let Self::Predicate(predicate) = path.as_ref() {
                    inverse(graph, starts, predicate, budget)
                } else {
                    let all = all_graph_nodes(graph, budget)?;
                    let starts = term_keys(starts);
                    let mut output = Vec::new();
                    for candidate in all {
                        let values = path.evaluate_at(
                            graph,
                            std::slice::from_ref(&candidate),
                            budget,
                            depth.saturating_add(1),
                            max_depth,
                        )?;
                        if values.iter().any(|value| starts.contains(&term_key(value))) {
                            output.push(candidate);
                        }
                    }
                    Ok(deduplicate(output))
                }
            }
            Self::Sequence(paths) => {
                let mut current = starts.to_vec();
                for path in paths {
                    current = path.evaluate_at(
                        graph,
                        &current,
                        budget,
                        depth.saturating_add(1),
                        max_depth,
                    )?;
                    if current.is_empty() {
                        break;
                    }
                }
                Ok(current)
            }
            Self::Alternative(paths) => {
                let mut output = Vec::new();
                for path in paths {
                    output.extend(path.evaluate_at(
                        graph,
                        starts,
                        budget,
                        depth.saturating_add(1),
                        max_depth,
                    )?);
                }
                Ok(deduplicate(output))
            }
            Self::ZeroOrOne(path) => {
                let mut output = starts.to_vec();
                output.extend(path.evaluate_at(
                    graph,
                    starts,
                    budget,
                    depth.saturating_add(1),
                    max_depth,
                )?);
                Ok(deduplicate(output))
            }
            Self::OneOrMore(path) => transitive(
                path,
                graph,
                starts,
                budget,
                depth.saturating_add(1),
                max_depth,
                false,
            ),
            Self::ZeroOrMore(path) => transitive(
                path,
                graph,
                starts,
                budget,
                depth.saturating_add(1),
                max_depth,
                true,
            ),
        }
    }

    pub(crate) fn canonical(&self) -> String {
        match self {
            Self::Predicate(node) => node.to_string(),
            Self::Sequence(paths) => format!(
                "seq({})",
                paths
                    .iter()
                    .map(Self::canonical)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::Alternative(paths) => format!(
                "alt({})",
                paths
                    .iter()
                    .map(Self::canonical)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::Inverse(path) => format!("inverse({})", path.canonical()),
            Self::ZeroOrMore(path) => format!("zero-or-more({})", path.canonical()),
            Self::OneOrMore(path) => format!("one-or-more({})", path.canonical()),
            Self::ZeroOrOne(path) => format!("zero-or-one({})", path.canonical()),
        }
    }

    #[cfg(feature = "sparql")]
    pub(crate) fn to_sparql(&self) -> String {
        match self {
            Self::Predicate(node) => node.to_string(),
            Self::Sequence(paths) => format!(
                "({})",
                paths
                    .iter()
                    .map(Self::to_sparql)
                    .collect::<Vec<_>>()
                    .join("/")
            ),
            Self::Alternative(paths) => format!(
                "({})",
                paths
                    .iter()
                    .map(Self::to_sparql)
                    .collect::<Vec<_>>()
                    .join("|")
            ),
            Self::Inverse(path) => format!("^({})", path.to_sparql()),
            Self::ZeroOrMore(path) => format!("({})*", path.to_sparql()),
            Self::OneOrMore(path) => format!("({})+", path.to_sparql()),
            Self::ZeroOrOne(path) => format!("({})?", path.to_sparql()),
        }
    }
}

fn forward(
    graph: &GraphSnapshot,
    starts: &[Term],
    predicate: &NamedNode,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    let starts = term_keys(starts);
    let mut output = Vec::new();
    for triple in graph.triples() {
        budget.path_visit()?;
        if &triple.predicate == predicate && starts.contains(&triple.subject.to_string()) {
            output.push(triple.object);
        }
    }
    Ok(deduplicate(output))
}

fn inverse(
    graph: &GraphSnapshot,
    starts: &[Term],
    predicate: &NamedNode,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    let starts = term_keys(starts);
    let mut output = Vec::new();
    for triple in graph.triples() {
        budget.path_visit()?;
        if &triple.predicate == predicate && starts.contains(&term_key(&triple.object)) {
            output.push(Term::from(triple.subject));
        }
    }
    Ok(deduplicate(output))
}

fn transitive(
    path: &PropertyPath,
    graph: &GraphSnapshot,
    starts: &[Term],
    budget: &mut Budget<'_>,
    depth: usize,
    max_depth: usize,
    include_starts: bool,
) -> Result<Vec<Term>, ValidationError> {
    let mut seen = BTreeMap::new();
    let mut queue = VecDeque::new();
    for start in starts {
        queue.push_back(start.clone());
        if include_starts {
            seen.insert(term_key(start), start.clone());
        }
    }
    while let Some(node) = queue.pop_front() {
        let values =
            path.evaluate_at(graph, std::slice::from_ref(&node), budget, depth, max_depth)?;
        for value in values {
            let key = term_key(&value);
            if let std::collections::btree_map::Entry::Vacant(entry) = seen.entry(key) {
                entry.insert(value.clone());
                queue.push_back(value);
            }
        }
    }
    Ok(seen.into_values().collect())
}

pub(crate) fn all_graph_nodes(
    graph: &GraphSnapshot,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    let mut nodes = Vec::new();
    for triple in graph.triples() {
        budget.path_visit()?;
        nodes.push(Term::from(triple.subject));
        nodes.push(triple.object);
    }
    Ok(deduplicate(nodes))
}

fn term_keys(terms: &[Term]) -> BTreeSet<String> {
    terms.iter().map(term_key).collect()
}

pub(crate) fn term_key(term: &Term) -> String {
    term.to_string()
}

pub(crate) fn deduplicate(terms: impl IntoIterator<Item = Term>) -> Vec<Term> {
    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    for term in terms {
        if seen.insert(term_key(&term)) {
            output.push(term);
        }
    }
    output
}

pub(crate) fn as_subject(term: &Term) -> Option<NamedOrBlankNode> {
    #[allow(
        unreachable_patterns,
        reason = "dependency feature unification may expose RDF 1.2 triple terms"
    )]
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        _ => None,
    }
}
