//! Explicit, advisory eligibility report for a future analytical join experiment.
//!
//! Nothing here rewrites an expression, selects a plan or grants fallback permission.

use crate::algebra::{GroundTermPattern, NamedNode, NamedNodePattern, QueryExpression, Variable};
use std::collections::HashMap;
use std::error::Error;
use std::fmt;

/// A rejected zero limit. Checked in declaration order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AnalyticalEligibilityLimitsError {
    /// `max_patterns` was zero.
    Patterns,
    /// `max_variables` was zero.
    Variables,
    /// `max_nodes` was zero.
    Nodes,
    /// `max_depth` was zero.
    Depth,
}

impl fmt::Display for AnalyticalEligibilityLimitsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Patterns => "analytical eligibility max_patterns must be positive",
            Self::Variables => "analytical eligibility max_variables must be positive",
            Self::Nodes => "analytical eligibility max_nodes must be positive",
            Self::Depth => "analytical eligibility max_depth must be positive",
        })
    }
}

impl Error for AnalyticalEligibilityLimitsError {}

/// Explicit positive bounds on one examination.
///
/// Depth counts the root as 1. Memory is bounded by `max_nodes + 1` pending nodes,
/// `max_variables` variables and `max_patterns` patterns.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AnalyticalEligibilityLimits {
    max_patterns: usize,
    max_variables: usize,
    max_nodes: usize,
    max_depth: usize,
}

impl AnalyticalEligibilityLimits {
    pub const fn new(
        max_patterns: usize,
        max_variables: usize,
        max_nodes: usize,
        max_depth: usize,
    ) -> Result<Self, AnalyticalEligibilityLimitsError> {
        if max_patterns == 0 {
            return Err(AnalyticalEligibilityLimitsError::Patterns);
        }
        if max_variables == 0 {
            return Err(AnalyticalEligibilityLimitsError::Variables);
        }
        if max_nodes == 0 {
            return Err(AnalyticalEligibilityLimitsError::Nodes);
        }
        if max_depth == 0 {
            return Err(AnalyticalEligibilityLimitsError::Depth);
        }
        Ok(Self {
            max_patterns,
            max_variables,
            max_nodes,
            max_depth,
        })
    }

    pub const fn max_patterns(self) -> usize {
        self.max_patterns
    }

    pub const fn max_variables(self) -> usize {
        self.max_variables
    }

    pub const fn max_nodes(self) -> usize {
        self.max_nodes
    }

    pub const fn max_depth(self) -> usize {
        self.max_depth
    }
}

/// The bound that stopped an examination.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalBudgetKind {
    Patterns,
    Variables,
    Nodes,
    Depth,
}

/// Why the supplied component is outside the first conservative profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalUnsupportedReason {
    /// Fewer than two quad patterns.
    TooFewPatterns,
    /// Patterns split into several variable-connected components.
    Disconnected,
    /// A quad pattern uses a variable graph name.
    VariableGraph,
    /// Patterns use the default graph and a named graph, or different named graphs.
    MixedGraph,
    /// An RDF 1.2 nested triple term is not supported yet.
    #[cfg(feature = "sparql-12")]
    TripleTerm,
    Path,
    GraphWrapper,
    LeftJoin,
    Minus,
    Union,
    #[cfg(feature = "sep-0006")]
    Lateral,
    Filter,
    Extend,
    Values,
    OrderBy,
    Project,
    Distinct,
    Reduced,
    Slice,
    Group,
    Service,
}

/// Advisory result. Neither `Unsupported` nor `BudgetExceeded` says anything about the
/// query's answers, and neither permits a fallback or an empty-result shortcut.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalEligibilityOutcome {
    Eligible,
    Unsupported(AnalyticalUnsupportedReason),
    BudgetExceeded(AnalyticalBudgetKind),
}

/// The single fixed graph of an examined component. The IRI is deliberately not reported.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalGraphScope {
    Default,
    ConstantNamed,
}

/// Term-free report. Counts cover the work done before the walk stopped.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub struct AnalyticalEligibilityReport {
    pub outcome: AnalyticalEligibilityOutcome,
    /// Graph fixed by the patterns accepted so far, if any.
    pub graph_scope: Option<AnalyticalGraphScope>,
    /// Quad patterns accepted.
    pub patterns: usize,
    /// Distinct variables, counted once each.
    pub variables: usize,
    /// Variable positions in subject, predicate and object.
    pub variable_occurrences: usize,
    /// Constant subject, predicate and object positions.
    pub constant_positions: usize,
    /// Algebra nodes examined within budget.
    pub nodes: usize,
    /// Deepest node examined, root being 1.
    pub max_depth: usize,
    /// Variable-connected components among accepted patterns.
    pub components: usize,
}

/// Explicitly invoked examiner. The default optimizer and all execution ignore it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AnalyticalEligibility {
    limits: AnalyticalEligibilityLimits,
}

impl AnalyticalEligibility {
    pub const fn new(limits: AnalyticalEligibilityLimits) -> Self {
        Self { limits }
    }

    pub const fn limits(self) -> AnalyticalEligibilityLimits {
        self.limits
    }

    /// Examines the whole supplied expression as one component. It never looks for a
    /// component inside a boundary and never modifies the expression.
    pub fn examine(&self, expression: &QueryExpression) -> AnalyticalEligibilityReport {
        let mut walk = Walk::new(self.limits);
        let outcome = walk.run(expression);
        AnalyticalEligibilityReport {
            outcome,
            graph_scope: walk.graph.map(GraphKey::scope),
            patterns: walk.patterns,
            variables: walk.variables.len(),
            variable_occurrences: walk.variable_occurrences,
            constant_positions: walk.constant_positions,
            nodes: walk.nodes,
            max_depth: walk.max_depth,
            components: walk.components,
        }
    }
}

type Outcome = AnalyticalEligibilityOutcome;
type Reason = AnalyticalUnsupportedReason;

fn unsupported(reason: Reason) -> Option<Outcome> {
    Some(Outcome::Unsupported(reason))
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum GraphKey<'a> {
    Default,
    Named(&'a NamedNode),
}

impl GraphKey<'_> {
    const fn scope(self) -> AnalyticalGraphScope {
        match self {
            Self::Default => AnalyticalGraphScope::Default,
            Self::Named(_) => AnalyticalGraphScope::ConstantNamed,
        }
    }
}

struct Walk<'a> {
    limits: AnalyticalEligibilityLimits,
    nodes: usize,
    max_depth: usize,
    patterns: usize,
    variable_occurrences: usize,
    constant_positions: usize,
    components: usize,
    graph: Option<GraphKey<'a>>,
    // Distinct variable to the first pattern that used it.
    variables: HashMap<&'a Variable, usize>,
    // Union-find over pattern indexes.
    parents: Vec<usize>,
}

impl<'a> Walk<'a> {
    fn new(limits: AnalyticalEligibilityLimits) -> Self {
        Self {
            limits,
            nodes: 0,
            max_depth: 0,
            patterns: 0,
            variable_occurrences: 0,
            constant_positions: 0,
            components: 0,
            graph: None,
            variables: HashMap::new(),
            parents: Vec::new(),
        }
    }

    fn run(&mut self, root: &'a QueryExpression) -> Outcome {
        let mut stack = vec![(root, 1_usize)];
        while let Some((node, depth)) = stack.pop() {
            if self.nodes >= self.limits.max_nodes {
                return Outcome::BudgetExceeded(AnalyticalBudgetKind::Nodes);
            }
            if depth > self.limits.max_depth {
                return Outcome::BudgetExceeded(AnalyticalBudgetKind::Depth);
            }
            self.nodes += 1;
            self.max_depth = self.max_depth.max(depth);
            let stop = match node {
                QueryExpression::Join { left, right, .. } => {
                    let child_depth = depth.saturating_add(1);
                    stack.push((right.as_ref(), child_depth));
                    stack.push((left.as_ref(), child_depth));
                    None
                }
                QueryExpression::QuadPattern {
                    subject,
                    predicate,
                    object,
                    graph_name,
                } => self.pattern(subject, predicate, object, graph_name.as_ref()),
                QueryExpression::Path { .. } => unsupported(Reason::Path),
                QueryExpression::Graph { .. } => unsupported(Reason::GraphWrapper),
                QueryExpression::LeftJoin { .. } => unsupported(Reason::LeftJoin),
                #[cfg(feature = "sep-0006")]
                QueryExpression::Lateral { .. } => unsupported(Reason::Lateral),
                QueryExpression::Filter { .. } => unsupported(Reason::Filter),
                QueryExpression::Union { .. } => unsupported(Reason::Union),
                QueryExpression::Extend { .. } => unsupported(Reason::Extend),
                QueryExpression::Minus { .. } => unsupported(Reason::Minus),
                QueryExpression::Values { .. } => unsupported(Reason::Values),
                QueryExpression::OrderBy { .. } => unsupported(Reason::OrderBy),
                QueryExpression::Project { .. } => unsupported(Reason::Project),
                QueryExpression::Distinct { .. } => unsupported(Reason::Distinct),
                QueryExpression::Reduced { .. } => unsupported(Reason::Reduced),
                QueryExpression::Slice { .. } => unsupported(Reason::Slice),
                QueryExpression::Group { .. } => unsupported(Reason::Group),
                QueryExpression::Service { .. } => unsupported(Reason::Service),
            };
            if let Some(stop) = stop {
                return stop;
            }
        }
        if self.patterns < 2 {
            Outcome::Unsupported(Reason::TooFewPatterns)
        } else if self.components > 1 {
            Outcome::Unsupported(Reason::Disconnected)
        } else {
            Outcome::Eligible
        }
    }

    fn pattern(
        &mut self,
        subject: &'a GroundTermPattern,
        predicate: &'a NamedNodePattern,
        object: &'a GroundTermPattern,
        graph_name: Option<&'a NamedNodePattern>,
    ) -> Option<Outcome> {
        if self.patterns >= self.limits.max_patterns {
            return Some(Outcome::BudgetExceeded(AnalyticalBudgetKind::Patterns));
        }
        let key = match graph_name {
            None => GraphKey::Default,
            Some(NamedNodePattern::NamedNode(name)) => GraphKey::Named(name),
            Some(NamedNodePattern::Variable(_)) => return unsupported(Reason::VariableGraph),
        };
        if let Some(current) = self.graph {
            if current != key {
                return unsupported(Reason::MixedGraph);
            }
        } else {
            self.graph = Some(key);
        }
        let index = self.patterns;
        self.patterns += 1;
        self.components += 1;
        self.parents.push(index);
        self.term(index, subject)
            .or_else(|| self.predicate(index, predicate))
            .or_else(|| self.term(index, object))
    }

    fn term(&mut self, pattern_index: usize, term: &'a GroundTermPattern) -> Option<Outcome> {
        match term {
            GroundTermPattern::Variable(variable) => self.variable(pattern_index, variable),
            GroundTermPattern::NamedNode(_) | GroundTermPattern::Literal(_) => {
                self.constant_positions += 1;
                None
            }
            #[cfg(feature = "sparql-12")]
            GroundTermPattern::Triple(_) => unsupported(Reason::TripleTerm),
        }
    }

    fn predicate(
        &mut self,
        pattern_index: usize,
        predicate: &'a NamedNodePattern,
    ) -> Option<Outcome> {
        match predicate {
            NamedNodePattern::Variable(variable) => self.variable(pattern_index, variable),
            NamedNodePattern::NamedNode(_) => {
                self.constant_positions += 1;
                None
            }
        }
    }

    fn variable(&mut self, pattern_index: usize, variable: &'a Variable) -> Option<Outcome> {
        if let Some(&owner) = self.variables.get(variable) {
            self.union(pattern_index, owner);
        } else if self.variables.len() >= self.limits.max_variables {
            return Some(Outcome::BudgetExceeded(AnalyticalBudgetKind::Variables));
        } else {
            self.variables.insert(variable, pattern_index);
        }
        self.variable_occurrences += 1;
        None
    }

    fn find(&mut self, mut index: usize) -> usize {
        loop {
            let parent = self.parents.get(index).copied().unwrap_or(index);
            if parent == index {
                return index;
            }
            let grandparent = self.parents.get(parent).copied().unwrap_or(parent);
            if let Some(slot) = self.parents.get_mut(index) {
                *slot = grandparent;
            }
            index = grandparent;
        }
    }

    fn union(&mut self, first: usize, second: usize) {
        let first_root = self.find(first);
        let second_root = self.find(second);
        if first_root != second_root {
            if let Some(parent) = self.parents.get_mut(first_root) {
                *parent = second_root;
            }
            self.components -= 1;
        }
    }
}
