use super::{ProfileSet, SrlError, SrlItem, SrlRuleSet};
use crate::control::{LimitKind, ValidationError, ValidationOptions};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Resolves an explicitly declared SRL import without any implicit I/O.
///
/// Oxshacl never dereferences an import IRI. Applications decide which schemes,
/// locations, caches, signatures, and size limits they trust, parse the returned
/// source into an [`SrlRuleSet`], and return it from this callback.
pub trait SrlImportResolver {
    /// Resolves `import_iri` using exactly the caller-selected profiles.
    ///
    /// Implementations should return a parsed rule set and enforce any
    /// application-specific trust, size, and transport policy.
    fn resolve(&self, import_iri: &str, profiles: &ProfileSet) -> Result<SrlRuleSet, SrlError>;
}

impl<F> SrlImportResolver for F
where
    F: Fn(&str, &ProfileSet) -> Result<SrlRuleSet, SrlError>,
{
    fn resolve(&self, import_iri: &str, profiles: &ProfileSet) -> Result<SrlRuleSet, SrlError> {
        self(import_iri, profiles)
    }
}

pub(super) fn resolve_imports(
    root: &SrlRuleSet,
    resolver: &dyn SrlImportResolver,
    options: &ValidationOptions,
) -> Result<SrlRuleSet, SrlError> {
    let started = Instant::now();
    let mut visited = BTreeSet::new();
    let mut output = without_imports(root);
    visit(root, resolver, options, started, &mut visited, &mut output)?;
    Ok(output)
}

fn visit(
    source: &SrlRuleSet,
    resolver: &dyn SrlImportResolver,
    options: &ValidationOptions,
    started: Instant,
    visited: &mut BTreeSet<String>,
    output: &mut SrlRuleSet,
) -> Result<(), SrlError> {
    for import in &source.imports {
        check_control(options, started)?;
        if !visited.insert(import.clone()) {
            continue;
        }
        if visited.len() > options.limits.max_list_items {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ListItems,
                limit: options.limits.max_list_items,
            }
            .into());
        }
        let imported = resolver.resolve(import, &source.profiles)?;
        if imported.profiles != source.profiles {
            return Err(SrlError::Profile(format!(
                "import `{import}` selected profiles `{}` instead of `{}`",
                imported.profiles.canonical_text(),
                source.profiles.canonical_text()
            )));
        }
        visit(&imported, resolver, options, started, visited, output)?;
        merge(output, &imported);
    }
    Ok(())
}

fn without_imports(source: &SrlRuleSet) -> SrlRuleSet {
    let mut output = source.clone();
    output.imports.clear();
    output
}

fn merge(target: &mut SrlRuleSet, source: &SrlRuleSet) {
    let first_scope = target
        .item_scopes
        .iter()
        .copied()
        .max()
        .map_or(1, |scope| scope.saturating_add(1));
    let mut scope_map = BTreeMap::new();
    for (item, source_scope) in source.items.iter().zip(&source.item_scopes) {
        if matches!(item, SrlItem::Rule(_)) && target.items.contains(item) {
            continue;
        }
        let next_scope = first_scope.saturating_add(scope_map.len());
        let target_scope = *scope_map.entry(*source_scope).or_insert(next_scope);
        target.items.push(item.clone());
        target.item_scopes.push(target_scope);
    }
    for version in &source.versions {
        if !target.versions.contains(version) {
            target.versions.push(version.clone());
        }
    }
    target
        .semantic_extensions
        .extend(source.semantic_extensions.iter().cloned());
}

fn check_control(options: &ValidationOptions, started: Instant) -> Result<(), SrlError> {
    if options.cancellation_token.is_cancelled() {
        return Err(ValidationError::Cancelled.into());
    }
    if let Some(timeout) = options.limits.timeout
        && started.elapsed() >= timeout
    {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: timeout.as_millis().try_into().unwrap_or(usize::MAX),
        }
        .into());
    }
    Ok(())
}
