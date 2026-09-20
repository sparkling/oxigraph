use super::head::HeadBuilder;
use super::native::{ESTIMATED_QUAD_BYTES, ExecutionGuard};
use crate::srl::{SrlError, SrlItem, SrlRuleSet};
use oxrdf::Dataset;

pub(super) struct InlineData {
    graph: Dataset,
    heads: HeadBuilder,
    inference_count: usize,
}

impl InlineData {
    pub(super) fn into_parts(self) -> (Dataset, HeadBuilder, usize) {
        (self.graph, self.heads, self.inference_count)
    }
}

pub(super) fn inline_data(
    rule_set: &SrlRuleSet,
    external: &Dataset,
    guard: &mut ExecutionGuard<'_>,
) -> Result<InlineData, SrlError> {
    let mut heads = HeadBuilder::new(external);
    let mut graph = Dataset::new();
    let mut additional = 0_usize;
    for (item, document_scope) in rule_set.items.iter().zip(&rule_set.item_scopes) {
        if let SrlItem::Data(triples) = item {
            for triple in triples {
                heads.materialize_data(*document_scope, triple, guard, &mut |quad, guard| {
                    guard.check()?;
                    let outside_base = !external.contains(&quad);
                    if !graph.contains(&quad) {
                        let next = additional.saturating_add(usize::from(outside_base));
                        guard.data_quads(external.len().saturating_add(next))?;
                        guard.derived(next)?;
                        guard.memory(ESTIMATED_QUAD_BYTES)?;
                        graph.insert(quad);
                        additional = next;
                    }
                    Ok(())
                })?;
            }
        }
    }
    Ok(InlineData {
        graph,
        heads,
        inference_count: additional,
    })
}
