#![allow(
    clippy::multiple_inherent_impl,
    reason = "bounded node-expression compiler roles are split into auditable submodules"
)]

use super::rdf::{RdfView, as_literal, as_named, rdf, shnex, to_shape_id};
use crate::NodeExpression;
use crate::constraint::literal_bool;
use crate::control::{Budget, LimitKind, ValidationError};
use crate::expression::CustomNodeExpression;
use oxrdf::Term;
use std::cell::RefCell;
use std::collections::BTreeSet;

mod custom;
#[cfg(feature = "sparql")]
mod sparql_expression;
mod syntax;

use self::syntax::{
    active_predicates, non_negative_integer, validate_properties, validate_signature, variable_name,
};

impl RdfView<'_> {
    pub(super) fn expression(
        &self,
        term: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
    ) -> Result<NodeExpression, ValidationError> {
        let registry = custom::Registry::new(self, budget)?;
        self.expression_scoped(
            term,
            budget,
            depth,
            max_depth,
            max_items,
            &registry,
            None,
            &RefCell::new(BTreeSet::new()),
        )
    }

    fn expression_scoped(
        &self,
        term: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
        registry: &custom::Registry,
        scope: Option<&custom::Scope>,
        active_functions: &RefCell<BTreeSet<String>>,
    ) -> Result<NodeExpression, ValidationError> {
        if depth > max_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: max_depth,
            });
        }
        if !matches!(term, Term::BlankNode(_)) {
            return Ok(NodeExpression::Constant(term.clone()));
        }
        let node = to_shape_id(term).ok_or_else(|| {
            ValidationError::IllFormed("blank node expression is not addressable".to_owned())
        })?;
        #[cfg(feature = "sparql")]
        if let Some(expression) = self.select_expression(&node)? {
            return Ok(expression);
        }
        let next = depth.saturating_add(1);
        #[cfg(feature = "sparql")]
        if let Some((expression, terms)) = self.sparql_function_call(&node, budget, max_items)? {
            let arguments = terms
                .iter()
                .map(|term| {
                    self.expression_scoped(
                        term,
                        budget,
                        next,
                        max_depth,
                        max_items,
                        registry,
                        scope,
                        active_functions,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(NodeExpression::SparqlFunction {
                expression,
                arguments,
            });
        }
        if self.is_list_node(term) {
            validate_properties(
                self,
                &node,
                "list expression",
                &[rdf("first").to_owned(), rdf("rest").to_owned()],
                &[rdf("first").to_owned(), rdf("rest").to_owned()],
            )?;
            let members = self.list(term, budget, max_items)?;
            if members
                .iter()
                .any(|member| !matches!(member, Term::NamedNode(_) | Term::Literal(_)))
            {
                return Err(ValidationError::IllFormed(
                    "list expression members must be IRIs or literals".to_owned(),
                ));
            }
            return Ok(NodeExpression::List(
                members.into_iter().map(NodeExpression::Constant).collect(),
            ));
        }
        if let Some(argument) = custom::argument(self, &node, scope)? {
            return Ok(argument);
        }
        let functions = [
            "var",
            "pathValues",
            "count",
            "distinct",
            "exists",
            "min",
            "max",
            "sum",
            "intersection",
            "concat",
            "remove",
            "filterShape",
            "limit",
            "offset",
            "flatMap",
            "orderBy",
            "instancesOf",
            "nodesMatching",
            "conformsToShape",
            "findFirst",
            "matchAll",
            "if",
        ]
        .into_iter()
        .filter_map(|local| {
            self.optional_one(&node, &shnex(local))
                .transpose()
                .map(|value| value.map(|value| (local, value)))
        })
        .collect::<Result<Vec<_>, _>>()?;
        if functions.is_empty() {
            if let Some(call) = registry.call(self, &node)? {
                return self.build_custom_expression(
                    call,
                    budget,
                    next,
                    max_depth,
                    max_items,
                    registry,
                    scope,
                    active_functions,
                );
            }
            if active_predicates(self, &node).is_empty() {
                return Ok(NodeExpression::Empty);
            }
            return Err(ValidationError::UnsupportedFeature(format!(
                "node expression `{node}` uses an unknown function"
            )));
        }
        if functions.len() != 1 {
            return Err(ValidationError::IllFormed(format!(
                "node expression `{node}` has multiple primary functions"
            )));
        }
        let (function, value) = &functions[0];
        self.build_expression(
            &node,
            function,
            value,
            budget,
            next,
            max_depth,
            max_items,
            registry,
            scope,
            active_functions,
        )
    }

    #[expect(clippy::too_many_arguments, reason = "explicit bounded compiler state")]
    fn build_expression(
        &self,
        node: &crate::ShapeId,
        function: &str,
        value: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
        registry: &custom::Registry,
        scope: Option<&custom::Scope>,
        active_functions: &RefCell<BTreeSet<String>>,
    ) -> Result<NodeExpression, ValidationError> {
        let parse = |term: &Term, budget: &mut Budget<'_>| {
            self.expression_scoped(
                term,
                budget,
                depth,
                max_depth,
                max_items,
                registry,
                scope,
                active_functions,
            )
        };
        validate_signature(self, node, function)?;
        let input = |budget: &mut Budget<'_>, focus_default: bool| {
            let value = self
                .optional_one(node, &shnex("nodes"))?
                .map(|term| parse(&term, budget))
                .transpose()?;
            match value {
                Some(value) => Ok(value),
                None if focus_default => Ok(NodeExpression::Focus),
                None => Err(ValidationError::IllFormed(format!(
                    "`{node}` requires shnex:nodes"
                ))),
            }
        };
        Ok(match function {
            "var" => NodeExpression::Variable(variable_name(value.clone())?),
            "pathValues" => {
                let path = self.path(value, budget, depth, max_depth, max_items)?;
                let nodes = self.optional_one(node, &shnex("focusNode"))?;
                NodeExpression::PathValues {
                    nodes: Box::new(match nodes {
                        Some(nodes) => parse(&nodes, budget)?,
                        None => NodeExpression::Focus,
                    }),
                    path,
                }
            }
            "count" => NodeExpression::Count(Box::new(parse(value, budget)?)),
            "distinct" => NodeExpression::Distinct(Box::new(parse(value, budget)?)),
            "exists" => NodeExpression::Exists(Box::new(parse(value, budget)?)),
            "min" => NodeExpression::Min(Box::new(parse(value, budget)?)),
            "max" => NodeExpression::Max(Box::new(parse(value, budget)?)),
            "sum" => NodeExpression::Sum(Box::new(parse(value, budget)?)),
            "intersection" => NodeExpression::Intersection(self.expression_list(
                value,
                budget,
                depth,
                max_depth,
                max_items,
                registry,
                scope,
                active_functions,
            )?),
            "concat" => NodeExpression::Concat(self.expression_list(
                value,
                budget,
                depth,
                max_depth,
                max_items,
                registry,
                scope,
                active_functions,
            )?),
            "remove" => NodeExpression::Remove {
                input: Box::new(input(budget, false)?),
                remove: Box::new(parse(value, budget)?),
            },
            "filterShape" => NodeExpression::FilterShape {
                input: Box::new(input(budget, false)?),
                shape: to_shape_id(value).ok_or_else(|| {
                    ValidationError::IllFormed("shnex:filterShape requires a shape node".to_owned())
                })?,
            },
            "limit" => NodeExpression::Limit {
                input: Box::new(input(budget, false)?),
                count: non_negative_integer(value.clone(), "limit")?,
            },
            "offset" => NodeExpression::Offset {
                input: Box::new(input(budget, false)?),
                count: non_negative_integer(value.clone(), "offset")?,
            },
            "flatMap" => NodeExpression::FlatMap {
                input: Box::new(input(budget, true)?),
                variable: "focusNode".to_owned(),
                expression: Box::new(parse(value, budget)?),
            },
            "orderBy" => {
                let descending = self
                    .optional_one(node, &shnex("desc"))?
                    .map(|term| {
                        let literal = as_literal(term, &shnex("desc"))?;
                        literal_bool(&literal).ok_or_else(|| {
                            ValidationError::IllFormed(
                                "shnex:desc must be an xsd:boolean".to_owned(),
                            )
                        })
                    })
                    .transpose()?
                    .unwrap_or(false);
                NodeExpression::OrderBy {
                    input: Box::new(input(budget, false)?),
                    key: Box::new(parse(value, budget)?),
                    descending,
                }
            }
            "instancesOf" => {
                NodeExpression::InstancesOf(as_named(value.clone(), &shnex("instancesOf"))?)
            }
            "nodesMatching" => {
                NodeExpression::NodesMatching(to_shape_id(value).ok_or_else(|| {
                    ValidationError::IllFormed("shnex:nodesMatching requires a shape".to_owned())
                })?)
            }
            "conformsToShape" => {
                let arguments = self.list(value, budget, max_items)?;
                let [nodes, shape] = arguments.as_slice() else {
                    return Err(ValidationError::IllFormed(
                        "shnex:conformsToShape requires two arguments".to_owned(),
                    ));
                };
                NodeExpression::ConformsToShape {
                    node: Box::new(parse(nodes, budget)?),
                    shape: Box::new(parse(shape, budget)?),
                }
            }
            "findFirst" => NodeExpression::FindFirst {
                input: Box::new(input(budget, true)?),
                shape: to_shape_id(value).ok_or_else(|| {
                    ValidationError::IllFormed("shnex:findFirst requires a shape node".to_owned())
                })?,
            },
            "matchAll" => NodeExpression::MatchAll {
                input: Box::new(input(budget, true)?),
                shape: to_shape_id(value).ok_or_else(|| {
                    ValidationError::IllFormed("shnex:matchAll requires a shape node".to_owned())
                })?,
            },
            "if" => NodeExpression::If {
                condition: Box::new(parse(value, budget)?),
                then_expression: Box::new(
                    self.optional_one(node, &shnex("then"))?
                        .map(|term| parse(&term, budget))
                        .transpose()?
                        .unwrap_or(NodeExpression::Empty),
                ),
                else_expression: Box::new(
                    self.optional_one(node, &shnex("else"))?
                        .map(|term| parse(&term, budget))
                        .transpose()?
                        .unwrap_or(NodeExpression::Empty),
                ),
            },
            _ => unreachable!(),
        })
    }

    fn expression_list(
        &self,
        head: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
        registry: &custom::Registry,
        scope: Option<&custom::Scope>,
        active_functions: &RefCell<BTreeSet<String>>,
    ) -> Result<Vec<NodeExpression>, ValidationError> {
        self.list(head, budget, max_items)?
            .iter()
            .map(|term| {
                self.expression_scoped(
                    term,
                    budget,
                    depth,
                    max_depth,
                    max_items,
                    registry,
                    scope,
                    active_functions,
                )
            })
            .collect()
    }

    fn build_custom_expression(
        &self,
        call: custom::Call,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
        registry: &custom::Registry,
        scope: Option<&custom::Scope>,
        active_functions: &RefCell<BTreeSet<String>>,
    ) -> Result<NodeExpression, ValidationError> {
        let (definition, source_arguments) = match call {
            custom::Call::Named {
                definition,
                arguments,
            } => (definition, arguments),
            custom::Call::List { definition, object } => {
                let terms = if self.is_list_node(&object) {
                    self.list(&object, budget, max_items)?
                } else {
                    vec![object]
                };
                let arguments = terms
                    .into_iter()
                    .enumerate()
                    .map(|(index, term)| Ok((custom::list_index(index)?, term)))
                    .collect::<Result<Vec<_>, ValidationError>>()?;
                (definition, arguments)
            }
        };
        let mut arguments = Vec::with_capacity(source_arguments.len());
        for (key, term) in source_arguments {
            arguments.push((
                key,
                self.expression_scoped(
                    &term,
                    budget,
                    depth,
                    max_depth,
                    max_items,
                    registry,
                    scope,
                    active_functions,
                )?,
            ));
        }
        let function = definition.function.as_str().to_owned();
        if !active_functions.borrow_mut().insert(function.clone()) {
            return Err(ValidationError::IllFormed(format!(
                "recursive custom node-expression function <{function}>"
            )));
        }
        let body_scope = definition.scope();
        let body = self.expression_scoped(
            &definition.body,
            budget,
            depth,
            max_depth,
            max_items,
            registry,
            Some(&body_scope),
            active_functions,
        );
        active_functions.borrow_mut().remove(&function);
        Ok(NodeExpression::Custom(CustomNodeExpression::new(
            definition.function,
            definition.kind,
            arguments,
            body?,
        )))
    }
}
