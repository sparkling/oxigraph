use super::{
    CompileError, RdfView, ShapesGraph, ShapesGraphImportResolver, compile_shape, conformance,
    imports, reject_unsupported_shape_properties, well_formed,
};
use crate::ShapeId;
use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::model::{GraphSnapshot, Shape, ShapeMap, shape_key};
use crate::profile::ProfileSet;
use std::collections::BTreeSet;

impl ShapesGraph {
    /// Compiles the supported shape surface without certifying complete Core syntax.
    ///
    /// Use [`Self::compile_checked`] when the caller needs a
    /// well-formedness-certified source graph.
    pub fn compile(
        source: &GraphSnapshot,
        profiles: ProfileSet,
        options: &ValidationOptions,
    ) -> Result<Self, CompileError> {
        Self::compile_internal(source, profiles, options, None)
    }

    /// Compiles only after checking the complete Core syntax surface.
    ///
    /// Imports are never dereferenced implicitly. If `source` contains an
    /// `owl:imports` statement this method returns [`CompileError::UnresolvedImport`].
    pub fn compile_checked(
        source: &GraphSnapshot,
        profiles: ProfileSet,
        options: &ValidationOptions,
    ) -> Result<Self, CompileError> {
        // Syntax checking and compilation share the caller's total timeout;
        // a second Budget must not restart the original duration.
        let budget = Budget::new(options)?;
        imports::reject_unresolved(source)?;
        let mut remaining = options.clone();
        remaining.limits.timeout = budget.remaining_timeout();
        let checked_shapes = well_formed::check(source, &profiles, &remaining)?;
        budget.check()?;
        remaining.limits.timeout = budget.remaining_timeout();
        let compiled = Self::compile_internal(source, profiles, &remaining, Some(checked_shapes))?;
        budget.check()?;
        Ok(compiled)
    }

    /// Resolves the import closure through an application-supplied resolver,
    /// checks Core syntax and OWL import compatibility, and then compiles it.
    pub fn compile_checked_with_imports<R: ShapesGraphImportResolver>(
        source: &GraphSnapshot,
        profiles: ProfileSet,
        options: &ValidationOptions,
        resolver: &R,
    ) -> Result<Self, CompileError> {
        let closure = imports::resolve(source, options, resolver)?;
        let checked_shapes = well_formed::check(&closure, &profiles, options)?;
        Self::compile_internal(&closure, profiles, options, Some(checked_shapes))
    }

    fn compile_internal(
        source: &GraphSnapshot,
        profiles: ProfileSet,
        options: &ValidationOptions,
        checked_shapes: Option<BTreeSet<String>>,
    ) -> Result<Self, CompileError> {
        let mut budget = Budget::new(options)?;
        let count = source.triple_count();
        if count > options.limits.max_shape_quads {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ShapeQuads,
                limit: options.limits.max_shape_quads,
            }
            .into());
        }
        budget.charge_memory(count.saturating_mul(128))?;
        conformance::reject_unsupported_entailment(source)?;
        let view = RdfView::new(source);
        let mut subjects = view.shape_subjects();
        if let Some(expected) = &checked_shapes {
            subjects.extend(expected.iter().cloned());
        }
        if subjects.len() > options.limits.max_shapes {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::Shapes,
                limit: options.limits.max_shapes,
            }
            .into());
        }
        let mut shapes = Vec::new();
        for key in subjects {
            budget.check()?;
            let id = view.find_subject(&key).ok_or_else(|| {
                ValidationError::IllFormed(format!("shape subject `{key}` is unavailable"))
            })?;
            reject_unsupported_shape_properties(source, &id)?;
            shapes.push(compile_shape(&view, id, &mut budget)?);
        }
        let checked = checked_shapes.is_some();
        let compiled = Self::from_parts(source.clone(), profiles, shapes, options, checked)?;
        if let Some(expected) = checked_shapes {
            let actual = compiled.shapes.keys().cloned().collect::<BTreeSet<_>>();
            if let Some(missing) = expected.difference(&actual).next() {
                return Err(ValidationError::UnsupportedFeature(format!(
                    "well-formed shape `{missing}` is not representable by the compiler"
                ))
                .into());
            }
        }
        Ok(compiled)
    }

    /// Builds a shapes graph from already typed shapes.
    ///
    /// This constructor validates profile compatibility, dependency references,
    /// path depth, uniqueness, and configured shape/constraint limits. It does
    /// not certify that the shapes originated from a well-formed RDF shapes graph.
    pub fn from_shapes(
        profiles: ProfileSet,
        shapes: impl IntoIterator<Item = Shape>,
        options: &ValidationOptions,
    ) -> Result<Self, CompileError> {
        Self::from_parts(
            GraphSnapshot::default_graph(oxrdf::Dataset::new()),
            profiles,
            shapes,
            options,
            false,
        )
        .map_err(Into::into)
    }

    fn from_parts(
        source: GraphSnapshot,
        profiles: ProfileSet,
        shapes: impl IntoIterator<Item = Shape>,
        options: &ValidationOptions,
        well_formedness_checked: bool,
    ) -> Result<Self, ValidationError> {
        let mut map = ShapeMap::new();
        let mut constraints = 0_usize;
        for shape in shapes {
            if map.len() >= options.limits.max_shapes {
                return Err(ValidationError::LimitExceeded {
                    kind: LimitKind::Shapes,
                    limit: options.limits.max_shapes,
                });
            }
            if let Some(path) = &shape.path {
                path.validate(options.limits.max_recursion_depth)
                    .map_err(|error| ValidationError::IllFormed(error.to_string()))?;
            }
            constraints = constraints.saturating_add(shape.constraints.len());
            if constraints > options.limits.max_constraints {
                return Err(ValidationError::LimitExceeded {
                    kind: LimitKind::Constraints,
                    limit: options.limits.max_constraints,
                });
            }
            super::validate_profile_features(&profiles, &shape)?;
            let key = shape_key(&shape.id);
            if map.insert(key.clone(), shape).is_some() {
                return Err(ValidationError::IllFormed(format!(
                    "duplicate shape `{key}`"
                )));
            }
        }
        super::validate_dependencies(&map)?;
        let compiled = Self {
            source,
            profiles,
            shapes: map,
            well_formedness_checked,
        };
        #[cfg(feature = "sparql")]
        super::custom::validate_parameter_shapes(&compiled, options)?;
        Ok(compiled)
    }

    /// Returns the owned source snapshot used during compilation.
    pub fn source(&self) -> &GraphSnapshot {
        &self.source
    }

    /// Returns the exact dated implementation profiles selected at compilation.
    pub fn profiles(&self) -> &ProfileSet {
        &self.profiles
    }

    /// Whether the graph passed the certifying Core syntax/import path.
    pub fn well_formedness_checked(&self) -> bool {
        self.well_formedness_checked
    }

    /// Iterates over compiled shapes in deterministic identifier order.
    pub fn shapes(&self) -> impl Iterator<Item = &Shape> {
        self.shapes.values()
    }

    /// Looks up a compiled shape by identifier.
    pub fn shape(&self, id: &ShapeId) -> Option<&Shape> {
        self.shapes.get(&shape_key(id))
    }
}
