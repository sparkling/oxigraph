use crate::{GraphSnapshot, ProfileSet, PropertyPath, ShapeId};
use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::Duration;

/// One SHACL validation result, including nested result details.
#[derive(Clone, Debug)]
pub struct ValidationResult {
    /// Focus node for which the constraint failed.
    pub focus_node: Term,
    /// Value node associated with the failure, if applicable.
    pub value: Option<Term>,
    /// Result path identifying the value location, if applicable.
    pub result_path: Option<PropertyPath>,
    /// Shape that produced this result.
    pub source_shape: ShapeId,
    /// Constraint node that produced this result, if available.
    pub source_constraint: Option<Term>,
    /// SHACL constraint-component IRI.
    pub source_constraint_component: NamedNode,
    /// Severity IRI assigned to the result.
    pub severity: NamedNode,
    /// Human-readable result messages.
    pub messages: Vec<Literal>,
    /// Additional result-property and value pairs.
    pub annotations: Vec<(NamedNode, Term)>,
    /// Results providing structured detail for this result.
    pub details: Vec<ValidationResult>,
}

impl ValidationResult {
    pub(crate) fn canonical_key(&self) -> String {
        let details = self
            .details
            .iter()
            .map(Self::canonical_key)
            .collect::<Vec<_>>()
            .join(";");
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            self.focus_node,
            self.value
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_default(),
            self.result_path
                .as_ref()
                .map(PropertyPath::canonical)
                .unwrap_or_default(),
            self.source_shape,
            self.source_constraint
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_default(),
            self.source_constraint_component,
            self.severity,
            self.messages
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(";"),
            {
                let mut annotations = self
                    .annotations
                    .iter()
                    .map(|(property, value)| format!("{property}={value}"))
                    .collect::<Vec<_>>();
                annotations.sort();
                annotations.join(";")
            },
            details
        )
    }
}

/// The outcome and execution metadata of one validation operation.
#[derive(Clone, Debug)]
pub struct ValidationReport {
    profiles: ProfileSet,
    conforms: bool,
    results: Vec<ValidationResult>,
    evaluated_focus_nodes: usize,
    estimated_memory_bytes: usize,
    elapsed: Duration,
    shapes_graph: GraphSnapshot,
    conformance_disallows: Vec<NamedNode>,
    shapes_graph_well_formed: Option<bool>,
}

impl ValidationReport {
    pub(crate) fn new(
        profiles: ProfileSet,
        mut results: Vec<ValidationResult>,
        conforms: bool,
        evaluated_focus_nodes: usize,
        estimated_memory_bytes: usize,
        elapsed: Duration,
        shapes_graph: GraphSnapshot,
        mut conformance_disallows: Vec<NamedNode>,
        shapes_graph_well_formed: Option<bool>,
    ) -> Self {
        results.sort_by_key(ValidationResult::canonical_key);
        conformance_disallows.sort();
        conformance_disallows.dedup();
        Self {
            profiles,
            conforms,
            results,
            evaluated_focus_nodes,
            estimated_memory_bytes,
            elapsed,
            shapes_graph,
            conformance_disallows,
            shapes_graph_well_formed,
        }
    }

    /// Returns the dated implementation profiles used for validation.
    pub fn profiles(&self) -> &ProfileSet {
        &self.profiles
    }

    /// Returns whether the data graph conforms under the selected policy.
    pub fn conforms(&self) -> bool {
        self.conforms
    }

    /// Returns validation results in deterministic canonical order.
    pub fn results(&self) -> &[ValidationResult] {
        &self.results
    }

    /// Returns the number of focus nodes evaluated.
    pub fn evaluated_focus_nodes(&self) -> usize {
        self.evaluated_focus_nodes
    }

    /// Returns the deterministic memory estimate charged by the validation budget.
    pub fn estimated_memory_bytes(&self) -> usize {
        self.estimated_memory_bytes
    }

    /// Returns wall-clock time spent constructing this report.
    pub fn elapsed(&self) -> Duration {
        self.elapsed
    }

    /// Returns severities that the selected conformance policy treats as failures.
    pub fn conformance_disallows(&self) -> &[NamedNode] {
        &self.conformance_disallows
    }

    /// The optional SHACL 1.2 processor assertion about the shapes graph.
    pub fn shapes_graph_well_formed(&self) -> Option<bool> {
        self.shapes_graph_well_formed
    }

    /// Materializes this report as a deterministically labeled RDF dataset.
    pub fn canonical(&self) -> CanonicalReport {
        CanonicalReport::from_report(self)
    }

    /// Builds a compact deterministic receipt for caching or evidence capture.
    pub fn receipt(&self) -> ValidationReceipt {
        let canonical = self.canonical();
        ValidationReceipt {
            profiles: self.profiles.canonical_text(),
            conforms: self.conforms,
            result_count: self.results.len(),
            evaluated_focus_nodes: self.evaluated_focus_nodes,
            estimated_memory_bytes: self.estimated_memory_bytes,
            canonical_report_nquads: canonical.canonical_nquads(),
        }
    }
}

/// Deterministic summary and RDF serialization of a validation report.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationReceipt {
    /// Canonical comma-separated implementation-profile identifiers.
    pub profiles: String,
    /// Whether the validated data graph conforms.
    pub conforms: bool,
    /// Number of top-level validation results.
    pub result_count: usize,
    /// Number of focus nodes evaluated.
    pub evaluated_focus_nodes: usize,
    /// Deterministic memory estimate charged during validation.
    pub estimated_memory_bytes: usize,
    /// Deterministically ordered N-Quads representation of the report.
    pub canonical_report_nquads: String,
}

impl ValidationReceipt {
    /// Serializes the receipt to its stable line-oriented text representation.
    pub fn canonical_text(&self) -> String {
        format!(
            "profiles={}\nconforms={}\nresults={}\nfocus-nodes={}\nestimated-memory-bytes={}\n---\n{}",
            self.profiles,
            self.conforms,
            self.result_count,
            self.evaluated_focus_nodes,
            self.estimated_memory_bytes,
            self.canonical_report_nquads
        )
    }
}

/// RDF dataset representation of a validation report.
///
/// Generated blank-node labels and iteration order are deterministic for a
/// fixed report.
#[derive(Clone, Debug)]
pub struct CanonicalReport {
    dataset: Dataset,
}

impl CanonicalReport {
    fn from_report(report: &ValidationReport) -> Self {
        let mut dataset = Dataset::new();
        let report_node = BlankNode::new_unchecked("oxshacl-report");
        insert_type(&mut dataset, report_node.clone(), sh("ValidationReport"));
        insert(
            &mut dataset,
            report_node.clone(),
            sh("conforms"),
            Literal::from(report.conforms),
        );
        if let Some(well_formed) = report.shapes_graph_well_formed {
            insert(
                &mut dataset,
                report_node.clone(),
                sh("shapesGraphWellFormed"),
                Literal::from(well_formed),
            );
        }
        for severity in &report.conformance_disallows {
            insert(
                &mut dataset,
                report_node.clone(),
                sh("conformanceDisallows"),
                severity.clone(),
            );
        }
        let mut source_nodes = BTreeMap::new();
        let mut copied_source_nodes = BTreeSet::new();
        for (index, result) in report.results.iter().enumerate() {
            let result_node = BlankNode::new_unchecked(format!("oxshacl-result-{index:08}"));
            insert(
                &mut dataset,
                report_node.clone(),
                sh("result"),
                result_node.clone(),
            );
            write_result(
                &mut dataset,
                &result_node,
                result,
                index,
                &mut 0,
                &report.shapes_graph,
                &mut source_nodes,
                &mut copied_source_nodes,
            );
        }
        Self { dataset }
    }

    /// Returns the RDF dataset backing this report representation.
    pub fn dataset(&self) -> &Dataset {
        &self.dataset
    }

    /// Serializes the report as lexically sorted N-Quads.
    pub fn canonical_nquads(&self) -> String {
        let mut lines = self
            .dataset
            .iter()
            .map(|quad| quad.to_string())
            .collect::<Vec<_>>();
        lines.sort();
        if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        }
    }
}

fn write_result(
    dataset: &mut Dataset,
    node: &BlankNode,
    result: &ValidationResult,
    result_index: usize,
    serial: &mut usize,
    shapes_graph: &GraphSnapshot,
    source_nodes: &mut BTreeMap<String, BlankNode>,
    copied_source_nodes: &mut BTreeSet<String>,
) {
    insert_type(dataset, node.clone(), sh("ValidationResult"));
    insert(
        dataset,
        node.clone(),
        sh("focusNode"),
        result.focus_node.clone(),
    );
    if let Some(value) = &result.value {
        insert(dataset, node.clone(), sh("value"), value.clone());
    }
    if let Some(path) = &result.result_path {
        let path_term = write_path(dataset, path, result_index, serial);
        insert(dataset, node.clone(), sh("resultPath"), path_term);
    }
    insert(
        dataset,
        node.clone(),
        sh("sourceShape"),
        result.source_shape.clone(),
    );
    if let Some(source) = &result.source_constraint {
        let source = deep_copy_source_constraint(
            dataset,
            source,
            shapes_graph,
            source_nodes,
            copied_source_nodes,
        );
        insert(dataset, node.clone(), sh("sourceConstraint"), source);
    }
    insert(
        dataset,
        node.clone(),
        sh("sourceConstraintComponent"),
        result.source_constraint_component.clone(),
    );
    insert(
        dataset,
        node.clone(),
        sh("resultSeverity"),
        result.severity.clone(),
    );
    for message in &result.messages {
        insert(dataset, node.clone(), sh("resultMessage"), message.clone());
    }
    for (property, value) in &result.annotations {
        insert(dataset, node.clone(), property.clone(), value.clone());
    }
    for detail in &result.details {
        let detail_node = path_node(result_index, serial);
        insert(dataset, node.clone(), sh("detail"), detail_node.clone());
        write_result(
            dataset,
            &detail_node,
            detail,
            result_index,
            serial,
            shapes_graph,
            source_nodes,
            copied_source_nodes,
        );
    }
}

fn deep_copy_source_constraint(
    dataset: &mut Dataset,
    source: &Term,
    shapes_graph: &GraphSnapshot,
    source_nodes: &mut BTreeMap<String, BlankNode>,
    copied_source_nodes: &mut BTreeSet<String>,
) -> Term {
    let Term::BlankNode(root) = source else {
        return source.clone();
    };
    let mut pending = VecDeque::from([root.clone()]);
    while let Some(node) = pending.pop_front() {
        let source_key = node.as_str().to_owned();
        let target = copied_blank_node(source_nodes, &source_key);
        if !copied_source_nodes.insert(source_key.clone()) {
            continue;
        }
        for triple in shapes_graph
            .triples()
            .filter(|triple| triple.subject == node)
        {
            let object = match triple.object {
                Term::BlankNode(child) => {
                    let child_key = child.as_str().to_owned();
                    let target = copied_blank_node(source_nodes, &child_key);
                    pending.push_back(child);
                    Term::from(target)
                }
                object => object,
            };
            insert(dataset, target.clone(), triple.predicate, object);
        }
    }
    Term::from(copied_blank_node(source_nodes, root.as_str()))
}

fn copied_blank_node(source_nodes: &mut BTreeMap<String, BlankNode>, source: &str) -> BlankNode {
    let next = source_nodes.len();
    source_nodes
        .entry(source.to_owned())
        .or_insert_with(|| BlankNode::new_unchecked(format!("oxshacl-source-{next:08}")))
        .clone()
}

#[cfg(feature = "sparql")]
impl<'a> spareval::QueryableDataset<'a> for &'a CanonicalReport {
    type InternalTerm = Term;
    type Error = std::convert::Infallible;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Term>,
        predicate: Option<&Term>,
        object: Option<&Term>,
        graph_name: Option<Option<&Term>>,
    ) -> impl Iterator<Item = Result<spareval::InternalQuad<Term>, Self::Error>> + use<'a> {
        let dataset: &'a Dataset = &self.dataset;
        spareval::QueryableDataset::internal_quads_for_pattern(
            &dataset, subject, predicate, object, graph_name,
        )
    }

    fn internalize_term(&self, term: Term) -> Result<Term, Self::Error> {
        Ok(term)
    }

    fn externalize_term(&self, term: Term) -> Result<Term, Self::Error> {
        Ok(term)
    }
}

fn write_path(
    dataset: &mut Dataset,
    path: &PropertyPath,
    result: usize,
    serial: &mut usize,
) -> Term {
    if let PropertyPath::Predicate(predicate) = path {
        return predicate.clone().into();
    }
    let node = path_node(result, serial);
    match path {
        PropertyPath::Alternative(paths) => {
            let list = write_path_list(dataset, paths, result, serial);
            insert(dataset, node.clone(), sh("alternativePath"), list);
        }
        PropertyPath::Inverse(path) => {
            let value = write_path(dataset, path, result, serial);
            insert(dataset, node.clone(), sh("inversePath"), value);
        }
        PropertyPath::ZeroOrMore(path) => {
            let value = write_path(dataset, path, result, serial);
            insert(dataset, node.clone(), sh("zeroOrMorePath"), value);
        }
        PropertyPath::OneOrMore(path) => {
            let value = write_path(dataset, path, result, serial);
            insert(dataset, node.clone(), sh("oneOrMorePath"), value);
        }
        PropertyPath::ZeroOrOne(path) => {
            let value = write_path(dataset, path, result, serial);
            insert(dataset, node.clone(), sh("zeroOrOnePath"), value);
        }
        PropertyPath::Sequence(paths) => {
            return write_path_list(dataset, paths, result, serial);
        }
        PropertyPath::Predicate(_) => unreachable!(),
    }
    Term::from(node)
}

fn write_path_list(
    dataset: &mut Dataset,
    paths: &[PropertyPath],
    result: usize,
    serial: &mut usize,
) -> Term {
    let mut tail = Term::from(rdf("nil"));
    for path in paths.iter().rev() {
        let node = path_node(result, serial);
        let value = write_path(dataset, path, result, serial);
        insert(dataset, node.clone(), rdf("first"), value);
        insert(dataset, node.clone(), rdf("rest"), tail);
        tail = Term::from(node);
    }
    tail
}

fn path_node(result: usize, serial: &mut usize) -> BlankNode {
    let node = BlankNode::new_unchecked(format!("oxshacl-path-{result:08}-{serial:08}"));
    *serial = serial.saturating_add(1);
    node
}

fn insert_type(dataset: &mut Dataset, subject: impl Into<NamedOrBlankNode>, object: NamedNode) {
    insert(dataset, subject, rdf("type"), object);
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: NamedNode,
    object: impl Into<Term>,
) {
    dataset.insert(Quad::new(
        subject,
        predicate,
        object,
        GraphName::DefaultGraph,
    ));
}

fn sh(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("http://www.w3.org/ns/shacl#{local}"))
}

fn rdf(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#{local}"
    ))
}

#[cfg(test)]
mod tests;
