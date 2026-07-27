use super::expression::ExpressionRuntime;
use super::head::HeadBuilder;
use super::matching::match_pattern;
use crate::control::{LimitKind, ValidationError, ValidationOptions};
use crate::srl::{
    SrlBodyElement, SrlError, SrlNode, SrlPredicate, SrlRule, SrlRuleSet, SrlStratification,
    SrlTriple, rules,
};
use oxrdf::{Dataset, Term};
use std::collections::BTreeMap;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

pub(super) type Solution = BTreeMap<String, Term>;

pub(super) struct NativeResult {
    inference: Dataset,
    iterations: usize,
    estimated_memory_bytes: usize,
}

impl NativeResult {
    pub(super) fn into_parts(self) -> (Dataset, usize, usize) {
        (self.inference, self.iterations, self.estimated_memory_bytes)
    }
}

pub(super) fn required(rule_set: &SrlRuleSet) -> bool {
    rules(rule_set)
        .any(|rule| rule.body.iter().any(rich_body_element) || rule.head.iter().any(rich_triple))
}

pub(super) fn evaluate(
    rule_set: &SrlRuleSet,
    base: &Dataset,
    inline: &Dataset,
    stratification: &SrlStratification,
    options: &ValidationOptions,
) -> Result<NativeResult, SrlError> {
    let mut working = base.clone();
    working.extend(inline.iter());
    let mut inference = inline
        .iter()
        .filter(|quad| !base.contains(quad))
        .collect::<Dataset>();
    let mut guard = ExecutionGuard::new(options, &working)?;
    guard.derived(inference.len())?;
    let expressions = ExpressionRuntime::new();
    let source_rules = rules(rule_set).collect::<Vec<_>>();
    let mut heads = HeadBuilder::new(&working);
    let mut iterations = 0;
    for stratum in &stratification.strata {
        if !stratum.once.is_empty() {
            guard.iteration(&mut iterations)?;
        }
        for index in &stratum.once {
            apply_rule(
                *index,
                source_rules[*index],
                &mut working,
                &mut inference,
                &mut heads,
                &expressions,
                &mut guard,
            )?;
        }
        if stratum.general.is_empty() {
            continue;
        }
        loop {
            guard.iteration(&mut iterations)?;
            let mut changed = false;
            for index in &stratum.general {
                changed |= apply_rule(
                    *index,
                    source_rules[*index],
                    &mut working,
                    &mut inference,
                    &mut heads,
                    &expressions,
                    &mut guard,
                )?;
            }
            if !changed {
                break;
            }
        }
    }
    Ok(NativeResult {
        inference,
        iterations,
        estimated_memory_bytes: guard.estimated_memory,
    })
}

pub(super) fn query(
    goal: &SrlTriple,
    graph: &Dataset,
    options: &ValidationOptions,
) -> Result<bool, SrlError> {
    let mut guard = ExecutionGuard::new(options, graph)?;
    Ok(!match_pattern(goal, graph, &[Solution::new()], "query-goal", &mut guard)?.is_empty())
}

fn apply_rule(
    rule_index: usize,
    rule: &SrlRule,
    working: &mut Dataset,
    inference: &mut Dataset,
    heads: &mut HeadBuilder,
    expressions: &ExpressionRuntime,
    guard: &mut ExecutionGuard<'_>,
) -> Result<bool, SrlError> {
    let solutions = evaluate_elements(
        &rule.body,
        vec![Solution::new()],
        working,
        expressions,
        guard,
        &format!("r{rule_index}"),
    )?;
    let mut changed = false;
    for (solution_index, solution) in solutions.iter().enumerate() {
        for quad in heads.instantiate(rule_index, solution_index, &rule.head, solution)? {
            guard.check()?;
            if working.insert(quad.clone()) {
                inference.insert(quad);
                guard.derived(inference.len())?;
                changed = true;
            }
        }
    }
    Ok(changed)
}

fn evaluate_elements(
    elements: &[SrlBodyElement],
    mut solutions: Vec<Solution>,
    graph: &Dataset,
    expressions: &ExpressionRuntime,
    guard: &mut ExecutionGuard<'_>,
    scope: &str,
) -> Result<Vec<Solution>, SrlError> {
    for (index, element) in elements.iter().enumerate() {
        guard.check()?;
        match element {
            SrlBodyElement::Triple(pattern) => {
                solutions = match_pattern(
                    pattern,
                    graph,
                    &solutions,
                    &format!("{scope}:e{index}"),
                    guard,
                )?;
            }
            SrlBodyElement::Filter(expression) => {
                let mut next = Vec::new();
                for solution in solutions {
                    if expressions.ebv(expression, &solution, guard)? == Some(true) {
                        guard.row(&solution)?;
                        next.push(solution);
                    }
                }
                solutions = next;
            }
            SrlBodyElement::Assignment {
                variable,
                expression,
            } => {
                let mut next = Vec::new();
                for mut solution in solutions {
                    if let Some(value) = expressions.term(expression, &solution, guard)? {
                        solution.insert(variable.clone(), value);
                        guard.row(&solution)?;
                        next.push(solution);
                    }
                }
                solutions = next;
            }
            SrlBodyElement::Negation {
                data_only: false,
                body,
            } => {
                let mut next = Vec::new();
                for solution in solutions {
                    let nested = evaluate_elements(
                        body,
                        vec![solution.clone()],
                        graph,
                        expressions,
                        guard,
                        &format!("{scope}:n{index}"),
                    )?;
                    if nested.is_empty() {
                        guard.row(&solution)?;
                        next.push(solution);
                    }
                }
                solutions = next;
            }
            SrlBodyElement::Negation {
                data_only: true, ..
            } => {
                return Err(SrlError::Unsupported(
                    "NOT DATA matching remains draft issue #960".to_owned(),
                ));
            }
        }
        if solutions.is_empty() {
            break;
        }
    }
    Ok(solutions)
}

fn rich_body_element(element: &SrlBodyElement) -> bool {
    match element {
        // The generic Datalog bridge stratifies at RDF-predicate relation
        // granularity. SRL dependency analysis is term-sensitive, so two
        // patterns with the same predicate but conflicting constants do not
        // necessarily form a dependency. Keep negation on the native path to
        // preserve that distinction.
        SrlBodyElement::Filter(_)
        | SrlBodyElement::Assignment { .. }
        | SrlBodyElement::Negation { .. } => true,
        SrlBodyElement::Triple(triple) => rich_triple(triple),
    }
}

fn rich_triple(triple: &SrlTriple) -> bool {
    rich_node(&triple.subject)
        || rich_node(&triple.object)
        || match &triple.predicate {
            SrlPredicate::Node(node) => rich_node(node),
            SrlPredicate::Path(_) => false,
        }
}

fn rich_node(node: &SrlNode) -> bool {
    !matches!(
        node,
        SrlNode::Variable(_)
            | SrlNode::Constant(
                crate::srl::SrlConstant::Iri(_)
                    | crate::srl::SrlConstant::Literal { .. }
                    | crate::srl::SrlConstant::Boolean(_)
                    | crate::srl::SrlConstant::Numeric { .. }
                    | crate::srl::SrlConstant::Nil
            )
    )
}

pub(super) struct ExecutionGuard<'a> {
    options: &'a ValidationOptions,
    started: Instant,
    estimated_memory: usize,
}

impl<'a> ExecutionGuard<'a> {
    fn new(options: &'a ValidationOptions, graph: &Dataset) -> Result<Self, SrlError> {
        let mut output = Self {
            options,
            started: Instant::now(),
            estimated_memory: graph.len().saturating_mul(160),
        };
        output.memory(0)?;
        output.check()?;
        Ok(output)
    }

    pub(super) fn check(&self) -> Result<(), SrlError> {
        if self.options.cancellation_token.is_cancelled() {
            return Err(ValidationError::Cancelled.into());
        }
        if let Some(timeout) = self.options.limits.timeout
            && self.started.elapsed() >= timeout
        {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: timeout.as_millis().try_into().unwrap_or(usize::MAX),
            }
            .into());
        }
        Ok(())
    }

    pub(super) fn row(&mut self, solution: &Solution) -> Result<(), SrlError> {
        let bytes = solution
            .iter()
            .map(|(name, value)| name.len().saturating_add(value.to_string().len() + 64))
            .sum();
        self.memory(bytes)
    }

    #[cfg(feature = "sparql")]
    pub(super) fn query(&mut self, source: &str) -> Result<(), SrlError> {
        self.check()?;
        if source.len() > self.options.limits.max_query_bytes {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::QueryBytes,
                limit: self.options.limits.max_query_bytes,
            }
            .into());
        }
        self.memory(source.len())
    }

    fn memory(&mut self, bytes: usize) -> Result<(), SrlError> {
        self.estimated_memory = self.estimated_memory.saturating_add(bytes);
        if self.estimated_memory > self.options.limits.max_estimated_memory_bytes {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::EstimatedMemory,
                limit: self.options.limits.max_estimated_memory_bytes,
            }
            .into());
        }
        Ok(())
    }

    fn iteration(&self, iterations: &mut usize) -> Result<(), SrlError> {
        *iterations = iterations.saturating_add(1);
        if *iterations > self.options.limits.max_rule_iterations {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RuleIterations,
                limit: self.options.limits.max_rule_iterations,
            }
            .into());
        }
        self.check()
    }

    fn derived(&self, count: usize) -> Result<(), SrlError> {
        if count > self.options.limits.max_derived_triples {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::DerivedTriples,
                limit: self.options.limits.max_derived_triples,
            }
            .into());
        }
        Ok(())
    }
}
