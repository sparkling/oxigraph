#![expect(
    clippy::multiple_inherent_impl,
    reason = "validation graph semantics are split into a bounded private submodule"
)]

use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::expression::ExpressionContext;
use crate::model::{GraphSnapshot, Shape, ShapeId, Target};
use crate::path::deduplicate;
use crate::profile::ConformanceRequest;
use crate::report::{ValidationReport, ValidationResult};
use crate::{Constraint, ShapesGraph};
use oxrdf::{NamedNode, Term};
use std::collections::BTreeMap;

pub(crate) mod evaluate;
mod semantics;

use self::evaluate::{Violation, evaluate_constraint};

/// Reusable validator bound to a compiled shapes graph and processor options.
pub struct Validator<'a> {
    shapes: &'a ShapesGraph,
    options: &'a ValidationOptions,
}

impl<'a> Validator<'a> {
    /// Creates a validator borrowing `shapes` and `options`.
    pub fn new(shapes: &'a ShapesGraph, options: &'a ValidationOptions) -> Self {
        Self { shapes, options }
    }

    /// Validates `data` under an explicit conformance request.
    ///
    /// Unsupported complete-profile requests fail before data evaluation.
    pub fn validate(
        &self,
        data: &GraphSnapshot,
        request: ConformanceRequest,
    ) -> Result<ValidationReport, ValidationError> {
        request.verify()?;
        if self.options.conformance_disallows.is_empty() {
            return Err(ValidationError::UnsupportedFeature(
                "an empty conformance-disallow set cannot be represented in a SHACL report"
                    .to_owned(),
            ));
        }
        let mut budget = Budget::new(self.options)?;
        let data_count = data.triple_count();
        if data_count > self.options.limits.max_data_quads {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::DataQuads,
                limit: self.options.limits.max_data_quads,
            });
        }
        budget.charge_memory(data_count.saturating_mul(128))?;
        let mut context = ValidationContext {
            graph: data,
            shapes: self.shapes,
            max_depth: self.options.limits.max_recursion_depth,
            conformance_disallows: &self.options.conformance_disallows,
            sub_class_of_in_shapes_graph: self.options.sub_class_of_in_shapes_graph,
        };
        let mut results = Vec::new();
        let mut evaluated = 0_usize;
        for shape in self.shapes.shapes() {
            budget.check()?;
            if shape.deactivated {
                continue;
            }
            let focus_nodes = context.target_nodes(shape, &mut budget)?;
            if focus_nodes.is_empty() {
                continue;
            }
            context.evaluate_unique_across_targets(
                shape,
                &focus_nodes,
                &mut results,
                &mut budget,
            )?;
            for focus in focus_nodes {
                budget.focus()?;
                evaluated = evaluated.saturating_add(1);
                results.extend(context.validate_shape(shape, &focus, &mut budget, 0, true)?);
            }
        }
        let conforms = !results.iter().any(|result| {
            self.options
                .conformance_disallows
                .contains(&result.severity)
        });
        Ok(ValidationReport::new(
            self.shapes.profiles().clone(),
            results,
            conforms,
            evaluated,
            budget.estimated_memory(),
            budget.elapsed(),
            self.shapes.source().clone(),
            self.options.conformance_disallows.clone(),
            (self.options.report_shapes_graph_well_formed && self.shapes.well_formedness_checked())
                .then_some(true),
        ))
    }

    /// Evaluates a compiled node expression against `data`.
    pub fn evaluate_expression(
        &self,
        data: &GraphSnapshot,
        expression: &crate::NodeExpression,
        focus: &Term,
        environment: &crate::ExpressionEnvironment,
    ) -> Result<Vec<Term>, ValidationError> {
        let mut budget = Budget::new(self.options)?;
        let mut context = ValidationContext {
            graph: data,
            shapes: self.shapes,
            max_depth: self.options.limits.max_recursion_depth,
            conformance_disallows: &self.options.conformance_disallows,
            sub_class_of_in_shapes_graph: self.options.sub_class_of_in_shapes_graph,
        };
        expression.evaluate(
            data,
            focus,
            environment,
            &mut context,
            &mut budget,
            0,
            self.options.limits.max_recursion_depth,
        )
    }

    /// Returns the focus nodes selected by a single shape against `data`.
    pub fn focus_nodes(
        &self,
        data: &GraphSnapshot,
        shape: &ShapeId,
    ) -> Result<Vec<Term>, ValidationError> {
        let mut budget = Budget::new(self.options)?;
        check_data_size(data, self.options)?;
        let mut context = ValidationContext {
            graph: data,
            shapes: self.shapes,
            max_depth: self.options.limits.max_recursion_depth,
            conformance_disallows: &self.options.conformance_disallows,
            sub_class_of_in_shapes_graph: self.options.sub_class_of_in_shapes_graph,
        };
        let shape = context.shape(shape)?;
        context.target_nodes(&shape, &mut budget)
    }

    /// Tests a single focus node against a single shape without collecting a report.
    pub fn conforms_node(
        &self,
        data: &GraphSnapshot,
        shape: &ShapeId,
        focus: &Term,
    ) -> Result<bool, ValidationError> {
        let mut budget = Budget::new(self.options)?;
        check_data_size(data, self.options)?;
        let mut context = ValidationContext {
            graph: data,
            shapes: self.shapes,
            max_depth: self.options.limits.max_recursion_depth,
            conformance_disallows: &self.options.conformance_disallows,
            sub_class_of_in_shapes_graph: self.options.sub_class_of_in_shapes_graph,
        };
        let shape = context.shape(shape)?;
        Ok(context
            .validate_shape(&shape, focus, &mut budget, 0, false)?
            .is_empty())
    }
}

fn check_data_size(
    data: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<(), ValidationError> {
    if data.triple_count() > options.limits.max_data_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: options.limits.max_data_quads,
        });
    }
    Ok(())
}

/// Validates a data graph using the crate's dated implemented feature set.
pub fn validate(
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    options: &ValidationOptions,
) -> Result<ValidationReport, ValidationError> {
    Validator::new(shapes, options).validate(data, ConformanceRequest::ImplementedFeatureSet)
}

/// Evaluates a compiled node expression using the supplied shapes and options.
pub fn evaluate_expression(
    expression: &crate::NodeExpression,
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    focus: &Term,
    environment: &crate::ExpressionEnvironment,
    options: &ValidationOptions,
) -> Result<Vec<Term>, ValidationError> {
    let mut budget = Budget::new(options)?;
    if data.triple_count() > options.limits.max_data_quads {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: options.limits.max_data_quads,
        });
    }
    let mut context = ValidationContext {
        graph: data,
        shapes,
        max_depth: options.limits.max_recursion_depth,
        conformance_disallows: &options.conformance_disallows,
        sub_class_of_in_shapes_graph: options.sub_class_of_in_shapes_graph,
    };
    expression.evaluate(
        data,
        focus,
        environment,
        &mut context,
        &mut budget,
        0,
        options.limits.max_recursion_depth,
    )
}

pub(super) struct ValidationContext<'a> {
    graph: &'a GraphSnapshot,
    shapes: &'a ShapesGraph,
    max_depth: usize,
    conformance_disallows: &'a [NamedNode],
    sub_class_of_in_shapes_graph: bool,
}

impl ValidationContext<'_> {
    fn target_nodes(
        &mut self,
        shape: &Shape,
        budget: &mut Budget<'_>,
    ) -> Result<Vec<Term>, ValidationError> {
        let mut nodes = Vec::new();
        for target in &shape.targets {
            budget.check()?;
            match target {
                Target::Node(node) => nodes.push(node.clone()),
                Target::Expression(expression) => {
                    let focus = Term::from(shape.id.clone());
                    let graph = self.graph;
                    nodes.extend(expression.evaluate(
                        graph,
                        &focus,
                        &crate::ExpressionEnvironment::default(),
                        self,
                        budget,
                        0,
                        self.max_depth,
                    )?);
                }
                Target::Where(where_shape) => {
                    let where_shape = self.shape(where_shape)?;
                    for node in self.all_nodes(budget)? {
                        if self
                            .validate_shape(&where_shape, &node, budget, 0, false)?
                            .is_empty()
                        {
                            nodes.push(node);
                        }
                    }
                }
                Target::Class(class) => nodes.extend(self.instances_of(class, budget)?),
                Target::SubjectsOf(predicate) => {
                    for triple in self.graph.triples() {
                        budget.path_visit()?;
                        if &triple.predicate == predicate {
                            nodes.push(Term::from(triple.subject));
                        }
                    }
                }
                Target::ObjectsOf(predicate) => {
                    for triple in self.graph.triples() {
                        budget.path_visit()?;
                        if &triple.predicate == predicate {
                            nodes.push(triple.object);
                        }
                    }
                }
            }
        }
        let shape_id = shape.id.to_string();
        for triple in self.graph.triples() {
            budget.path_visit()?;
            if triple.predicate.as_str() == "http://www.w3.org/ns/shacl#shape"
                && triple.object.to_string() == shape_id
            {
                nodes.push(Term::from(triple.subject));
            }
        }
        Ok(deduplicate(nodes))
    }

    pub(super) fn validate_shape(
        &mut self,
        shape: &Shape,
        focus: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        collect: bool,
    ) -> Result<Vec<ValidationResult>, ValidationError> {
        budget.check()?;
        if depth > self.max_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: self.max_depth,
            });
        }
        if shape.deactivated {
            return Ok(Vec::new());
        }
        let graph = self.graph;
        let environment = crate::ExpressionEnvironment::default();
        let mut values = if let Some(expression) = &shape.values {
            expression.evaluate(
                graph,
                focus,
                &environment,
                self,
                budget,
                depth.saturating_add(1),
                self.max_depth,
            )?
        } else if let Some(path) = &shape.path {
            path.evaluate(self.graph, [focus.clone()], budget, self.max_depth)?
        } else {
            vec![focus.clone()]
        };
        if values.is_empty()
            && let Some(expression) = &shape.default_value
        {
            values = expression.evaluate(
                graph,
                focus,
                &environment,
                self,
                budget,
                depth.saturating_add(1),
                self.max_depth,
            )?;
        }
        let mut results = Vec::new();
        for (index, constraint) in shape.constraints.clone().into_iter().enumerate() {
            if matches!(constraint, Constraint::UniqueValuesFor(_)) {
                continue;
            }
            if let Constraint::Property(property) = &constraint {
                let property = self.shape(property)?;
                let mut nested = Vec::new();
                for value in &values {
                    nested.extend(self.validate_shape(
                        &property,
                        value,
                        budget,
                        depth.saturating_add(1),
                        collect,
                    )?);
                }
                if collect {
                    results.extend(nested);
                    continue;
                }
                if let Some(result) = nested.into_iter().next() {
                    return Ok(vec![result]);
                }
                continue;
            }
            let violations = evaluate_constraint(
                self,
                shape,
                focus,
                &values,
                &constraint,
                budget,
                depth.saturating_add(1),
            )?
            .into_iter()
            .map(|mut violation| {
                if let Some(annotation) = shape.constraint_annotations.get(index) {
                    if violation.severity.is_none() {
                        violation.severity.clone_from(&annotation.severity);
                    }
                    if violation.messages.is_empty() && !annotation.messages.is_empty() {
                        violation.messages.clone_from(&annotation.messages);
                    }
                }
                violation
            })
            .collect::<Vec<_>>();
            if collect {
                for violation in violations {
                    budget.result()?;
                    results.push(Self::result(shape, focus, &constraint, violation));
                }
            } else if let Some(violation) = violations.into_iter().find(|violation| {
                self.conformance_disallows
                    .contains(violation.severity.as_ref().unwrap_or(&shape.severity))
            }) {
                return Ok(vec![Self::result(shape, focus, &constraint, violation)]);
            }
        }
        Ok(results)
    }

    pub(super) fn result(
        shape: &Shape,
        focus: &Term,
        constraint: &Constraint,
        violation: Violation,
    ) -> ValidationResult {
        ValidationResult {
            focus_node: focus.clone(),
            value: violation.value,
            result_path: violation.path.or_else(|| {
                let path = shape.path.as_ref()?;
                match path {
                    crate::PropertyPath::Predicate(predicate)
                        if predicate
                            .as_str()
                            .starts_with("http://www.w3.org/ns/shacl#") =>
                    {
                        None
                    }
                    _ => Some(path.clone()),
                }
            }),
            source_shape: shape.id.clone(),
            source_constraint: violation.source_constraint,
            source_constraint_component: violation
                .source_constraint_component
                .unwrap_or_else(|| NamedNode::new_unchecked(constraint.component_iri().to_owned())),
            severity: violation.severity.unwrap_or_else(|| shape.severity.clone()),
            messages: if violation.messages.is_empty() {
                shape.messages.clone()
            } else {
                violation.messages
            },
            annotations: violation.annotations,
            details: violation.details,
        }
    }

    fn evaluate_unique_across_targets(
        &mut self,
        shape: &Shape,
        focus_nodes: &[Term],
        results: &mut Vec<ValidationResult>,
        budget: &mut Budget<'_>,
    ) -> Result<(), ValidationError> {
        for constraint in &shape.constraints {
            let Constraint::UniqueValuesFor(properties) = constraint else {
                continue;
            };
            let mut owners = BTreeMap::<String, Vec<Term>>::new();
            for focus in focus_nodes {
                let mut signature = String::new();
                let mut has_value = false;
                for property in properties {
                    let values = crate::PropertyPath::Predicate(property.clone()).evaluate(
                        self.graph,
                        [focus.clone()],
                        budget,
                        self.max_depth,
                    )?;
                    has_value |= !values.is_empty();
                    signature.push_str(property.as_str());
                    signature.push('=');
                    for value in values {
                        signature.push_str(&value.to_string());
                        signature.push('\u{1f}');
                    }
                    signature.push('\u{1e}');
                }
                if has_value {
                    owners.entry(signature).or_default().push(focus.clone());
                }
            }
            for focuses in owners.into_values().filter(|owners| owners.len() > 1) {
                for focus in focuses {
                    budget.result()?;
                    results.push(Self::result(
                        shape,
                        &focus,
                        constraint,
                        Violation::empty_value(),
                    ));
                }
            }
        }
        Ok(())
    }
}
