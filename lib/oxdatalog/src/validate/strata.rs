use super::{DependencyGraph, ValidationError};
use crate::RelationId;
use std::collections::BTreeMap;

pub(super) fn compute_strata(
    dependencies: &DependencyGraph,
) -> Result<BTreeMap<RelationId, usize>, ValidationError> {
    let mut strata = dependencies
        .relations()
        .cloned()
        .map(|relation| (relation, 0))
        .collect::<BTreeMap<_, _>>();
    let relation_count = strata.len();
    for _ in 0..=relation_count {
        let mut changed = false;
        for relation in dependencies.relations() {
            let mut required = 0;
            for dependency in dependencies.dependencies(relation) {
                required = required.max(strata.get(dependency).copied().unwrap_or(0));
            }
            for dependency in dependencies.negative_dependencies(relation) {
                required = required.max(closed_stratum(&strata, dependency));
            }
            for dependency in dependencies.closed_dependencies(relation) {
                required = required.max(closed_stratum(&strata, dependency));
            }
            let current = strata.get(relation).copied().unwrap_or(0);
            if required > current {
                strata.insert(relation.clone(), required);
                changed = true;
            }
        }
        if !changed {
            return Ok(strata);
        }
    }
    let relation = dependencies
        .relations()
        .next()
        .cloned()
        .unwrap_or_else(|| RelationId::from_static("urn:oxigraph:datalog:unknown"));
    Err(unstratifiable(dependencies, &relation))
}

fn closed_stratum(strata: &BTreeMap<RelationId, usize>, relation: &RelationId) -> usize {
    strata
        .get(relation)
        .copied()
        .unwrap_or(0_usize)
        .saturating_add(1)
}

fn unstratifiable(dependencies: &DependencyGraph, relation: &RelationId) -> ValidationError {
    if dependencies.closed_dependencies(relation).next().is_some() {
        ValidationError::UnstratifiableClosedDependency {
            relation: relation.clone(),
        }
    } else {
        ValidationError::UnstratifiableNegation {
            relation: relation.clone(),
        }
    }
}
