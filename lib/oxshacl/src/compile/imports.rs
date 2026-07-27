use super::CompileError;
use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::error::Error;

const OWL_IMPORTS: &str = "http://www.w3.org/2002/07/owl#imports";
const OWL_VERSION_IRI: &str = "http://www.w3.org/2002/07/owl#versionIRI";
const OWL_INCOMPATIBLE_WITH: &str = "http://www.w3.org/2002/07/owl#incompatibleWith";

/// An application-controlled source for shapes graphs named by `owl:imports`.
///
/// The compiler never dereferences an IRI itself. Implementations can therefore
/// enforce their own cache, trust, authentication, and network policies.
pub trait ShapesGraphImportResolver {
    /// Error returned by the application resolver.
    type Error: Error + Send + Sync + 'static;

    /// Resolves one import IRI to an owned graph, or `None` if unavailable.
    fn resolve(&self, iri: &NamedNode) -> Result<Option<GraphSnapshot>, Self::Error>;
}

impl<F, E> ShapesGraphImportResolver for F
where
    F: Fn(&NamedNode) -> Result<Option<GraphSnapshot>, E>,
    E: Error + Send + Sync + 'static,
{
    type Error = E;

    fn resolve(&self, iri: &NamedNode) -> Result<Option<GraphSnapshot>, Self::Error> {
        self(iri)
    }
}

#[derive(Clone, Debug)]
struct GraphIdentity {
    series: NamedNode,
    version: Option<NamedNode>,
    incompatible_with: BTreeSet<NamedNode>,
}

impl GraphIdentity {
    fn identifiers(&self) -> impl Iterator<Item = &NamedNode> {
        std::iter::once(&self.series).chain(self.version.as_ref())
    }
}

pub(super) fn reject_unresolved(source: &GraphSnapshot) -> Result<(), CompileError> {
    validate_owl_iri_objects(source)?;
    if let Some(iri) = all_imports(source).into_iter().next() {
        return Err(CompileError::UnresolvedImport { iri });
    }
    validate_compatibility(&root_identities(source)?)?;
    Ok(())
}

pub(super) fn resolve<R: ShapesGraphImportResolver>(
    root: &GraphSnapshot,
    options: &ValidationOptions,
    resolver: &R,
) -> Result<GraphSnapshot, CompileError> {
    let mut budget = Budget::new(options)?;
    validate_owl_iri_objects(root)?;
    let root_count = root.triple_count();
    if root_count > options.limits.max_shape_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::ShapeQuads,
            limit: options.limits.max_shape_quads,
        }
        .into());
    }
    budget.charge_memory(root_count.saturating_mul(128))?;
    let mut dataset = root.isolated_default_dataset();
    let mut identities = root_identities(root)?;
    let mut resolved_ids = identities
        .iter()
        .flat_map(GraphIdentity::identifiers)
        .map(NamedNode::as_str)
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let mut pending = all_imports(root)
        .into_iter()
        .map(|iri| (iri, 1_usize))
        .collect::<VecDeque<_>>();
    let mut queued = pending
        .iter()
        .map(|(iri, _)| iri.as_str().to_owned())
        .collect::<BTreeSet<_>>();
    let mut graph_index = 0_usize;

    while let Some((requested, depth)) = pending.pop_front() {
        budget.check()?;
        queued.remove(requested.as_str());
        if resolved_ids.contains(requested.as_str()) {
            continue;
        }
        if depth > options.limits.max_recursion_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: options.limits.max_recursion_depth,
            }
            .into());
        }
        let source = resolver
            .resolve(&requested)
            .map_err(|source| CompileError::ImportResolution {
                iri: requested.clone(),
                source: Box::new(source),
            })?
            .ok_or_else(|| CompileError::UnresolvedImport {
                iri: requested.clone(),
            })?;
        budget.check()?;
        validate_owl_iri_objects(&source)?;
        let source_count = source.triple_count();
        if dataset.len().saturating_add(source_count) > options.limits.max_shape_quads {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ShapeQuads,
                limit: options.limits.max_shape_quads,
            }
            .into());
        }
        budget.charge_memory(source_count.saturating_mul(128))?;

        let identity = imported_identity(&source, &requested)?;
        let owners = BTreeSet::from([requested.clone(), identity.series.clone()]);
        let imports = imports_from(&source, &owners);
        for identifier in identity.identifiers() {
            resolved_ids.insert(identifier.as_str().to_owned());
        }
        resolved_ids.insert(requested.as_str().to_owned());
        identities.push(identity);
        graph_index = graph_index.saturating_add(1);
        merge_standardized_apart(&mut dataset, &source, graph_index);

        for iri in imports {
            if !resolved_ids.contains(iri.as_str()) && queued.insert(iri.as_str().to_owned()) {
                pending.push_back((iri, depth.saturating_add(1)));
            }
        }
    }
    validate_compatibility(&identities)?;
    Ok(GraphSnapshot::default_graph(dataset))
}

fn all_imports(source: &GraphSnapshot) -> Vec<NamedNode> {
    let mut imports = source
        .triples()
        .filter(|triple| triple.predicate.as_str() == OWL_IMPORTS)
        .filter_map(|triple| match triple.object {
            Term::NamedNode(iri) => Some(iri),
            _ => None,
        })
        .collect::<Vec<_>>();
    imports.sort();
    imports.dedup();
    imports
}

fn imports_from(source: &GraphSnapshot, owners: &BTreeSet<NamedNode>) -> Vec<NamedNode> {
    let mut imports = source
        .triples()
        .filter(|triple| {
            triple.predicate.as_str() == OWL_IMPORTS
                && matches!(&triple.subject, NamedOrBlankNode::NamedNode(owner) if owners.contains(owner))
        })
        .filter_map(|triple| match triple.object {
            Term::NamedNode(iri) => Some(iri),
            _ => None,
        })
        .collect::<Vec<_>>();
    imports.sort();
    imports.dedup();
    imports
}

fn validate_owl_iri_objects(source: &GraphSnapshot) -> Result<(), ValidationError> {
    for triple in source.triples().filter(|triple| {
        matches!(
            triple.predicate.as_str(),
            OWL_IMPORTS | OWL_VERSION_IRI | OWL_INCOMPATIBLE_WITH
        )
    }) {
        if !matches!(triple.object, Term::NamedNode(_)) {
            return Err(ValidationError::IllFormed(format!(
                "<{}> values must be IRIs",
                triple.predicate
            )));
        }
        if triple.predicate.as_str() != OWL_IMPORTS
            && !matches!(triple.subject, NamedOrBlankNode::NamedNode(_))
        {
            return Err(ValidationError::IllFormed(format!(
                "<{}> subjects must be IRIs",
                triple.predicate
            )));
        }
    }
    Ok(())
}

fn imported_identity(
    source: &GraphSnapshot,
    requested: &NamedNode,
) -> Result<GraphIdentity, ValidationError> {
    let mut inverse_owners = source
        .triples()
        .filter(|triple| {
            triple.predicate.as_str() == OWL_VERSION_IRI
                && matches!(&triple.object, Term::NamedNode(iri) if iri == requested)
        })
        .filter_map(|triple| match triple.subject {
            NamedOrBlankNode::NamedNode(owner) => Some(owner),
            NamedOrBlankNode::BlankNode(_) => None,
        })
        .collect::<Vec<_>>();
    inverse_owners.sort();
    inverse_owners.dedup();
    if inverse_owners.len() > 1 {
        return Err(ValidationError::IllFormed(format!(
            "import <{requested}> is the owl:versionIRI of multiple shapes graphs"
        )));
    }
    let series = inverse_owners.pop().unwrap_or_else(|| requested.clone());
    identity_for_series(source, series, Some(requested))
}

fn root_identities(source: &GraphSnapshot) -> Result<Vec<GraphIdentity>, ValidationError> {
    let mut series = source
        .triples()
        .filter(|triple| {
            matches!(
                triple.predicate.as_str(),
                OWL_IMPORTS | OWL_VERSION_IRI | OWL_INCOMPATIBLE_WITH
            )
        })
        .filter_map(|triple| match triple.subject {
            NamedOrBlankNode::NamedNode(series) => Some(series),
            NamedOrBlankNode::BlankNode(_) => None,
        })
        .collect::<Vec<_>>();
    series.sort();
    series.dedup();
    series
        .into_iter()
        .map(|series| identity_for_series(source, series, None))
        .collect()
}

fn identity_for_series(
    source: &GraphSnapshot,
    series: NamedNode,
    requested: Option<&NamedNode>,
) -> Result<GraphIdentity, ValidationError> {
    let mut versions = source
        .triples()
        .filter(|triple| {
            triple.predicate.as_str() == OWL_VERSION_IRI
                && matches!(
                    &triple.subject,
                    NamedOrBlankNode::NamedNode(owner) if owner == &series
                )
        })
        .filter_map(|triple| match triple.object {
            Term::NamedNode(version) => Some(version),
            _ => None,
        })
        .collect::<Vec<_>>();
    versions.sort();
    versions.dedup();
    if versions.len() > 1 {
        return Err(ValidationError::IllFormed(format!(
            "shapes graph <{series}> has multiple owl:versionIRI values"
        )));
    }
    let version = versions
        .pop()
        .or_else(|| requested.cloned().filter(|iri| iri != &series));
    let incompatible_with = source
        .triples()
        .filter(|triple| {
            triple.predicate.as_str() == OWL_INCOMPATIBLE_WITH
                && matches!(
                    &triple.subject,
                    NamedOrBlankNode::NamedNode(owner) if owner == &series
                )
        })
        .filter_map(|triple| match triple.object {
            Term::NamedNode(iri) => Some(iri),
            _ => None,
        })
        .collect();
    Ok(GraphIdentity {
        series,
        version,
        incompatible_with,
    })
}

fn validate_compatibility(identities: &[GraphIdentity]) -> Result<(), ValidationError> {
    for (index, left) in identities.iter().enumerate() {
        for right in identities.iter().skip(index.saturating_add(1)) {
            if left.series == right.series
                && left.version.is_some()
                && right.version.is_some()
                && left.version != right.version
            {
                return Err(ValidationError::IllFormed(format!(
                    "import closure contains incompatible versions of <{}>",
                    left.series
                )));
            }
            if left
                .incompatible_with
                .iter()
                .any(|iri| right.identifiers().any(|candidate| iri == candidate))
                || right
                    .incompatible_with
                    .iter()
                    .any(|iri| left.identifiers().any(|candidate| iri == candidate))
            {
                return Err(ValidationError::IllFormed(format!(
                    "import closure contains owl:incompatibleWith shapes graphs <{}> and <{}>",
                    left.series, right.series
                )));
            }
        }
    }
    Ok(())
}

fn merge_standardized_apart(target: &mut Dataset, source: &GraphSnapshot, graph_index: usize) {
    let mut occupied = BTreeSet::new();
    for quad in target.iter() {
        collect_subject_blank(&quad.subject, &mut occupied);
        collect_term_blanks(&quad.object, &mut occupied);
    }
    let mut blank_nodes = BTreeSet::new();
    for triple in source.triples() {
        collect_subject_blank(&triple.subject, &mut blank_nodes);
        collect_term_blanks(&triple.object, &mut blank_nodes);
    }
    let mut serial = 0_usize;
    let mut mapping = BTreeMap::new();
    for source in blank_nodes {
        let target = loop {
            let candidate = format!("oxshacl_import_{graph_index}_{serial}");
            serial = serial.saturating_add(1);
            if occupied.insert(candidate.clone()) {
                break BlankNode::new_unchecked(candidate);
            }
        };
        mapping.insert(source, target);
    }
    for triple in source.triples() {
        target.insert(Quad::new(
            rename_subject(triple.subject, &mapping),
            triple.predicate,
            rename_term(triple.object, &mapping),
            GraphName::DefaultGraph,
        ));
    }
}

fn collect_subject_blank(subject: &NamedOrBlankNode, output: &mut BTreeSet<String>) {
    if let NamedOrBlankNode::BlankNode(node) = subject {
        output.insert(node.as_str().to_owned());
    }
}

fn collect_term_blanks(term: &Term, output: &mut BTreeSet<String>) {
    if let Term::BlankNode(node) = term {
        output.insert(node.as_str().to_owned());
    }
    #[cfg(feature = "rdf-12")]
    if let Term::Triple(triple) = term {
        collect_subject_blank(&triple.subject, output);
        collect_term_blanks(&triple.object, output);
    }
}

fn rename_subject(
    subject: NamedOrBlankNode,
    mapping: &BTreeMap<String, BlankNode>,
) -> NamedOrBlankNode {
    match subject {
        NamedOrBlankNode::NamedNode(node) => node.into(),
        NamedOrBlankNode::BlankNode(node) => mapping[node.as_str()].clone().into(),
    }
}

fn rename_term(term: Term, mapping: &BTreeMap<String, BlankNode>) -> Term {
    match term {
        Term::NamedNode(node) => node.into(),
        Term::BlankNode(node) => mapping[node.as_str()].clone().into(),
        Term::Literal(literal) => literal.into(),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => Term::Triple(Box::new(Triple::new(
            rename_subject(triple.subject, mapping),
            triple.predicate,
            rename_term(triple.object, mapping),
        ))),
    }
}
