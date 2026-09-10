//! ADR-0027 bounded native operator-budget observations. These counters are
//! process-local snapshots taken when the final [`super::WorkloadLease`] owner drops;
//! they do not infer request success, rollback, or later use of independently
//! retained budget clones.
use super::AdmissionPool;
use std::fmt::{self, Write};

/// One of the six fixed native evaluator budget handles.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResourceOperator {
    InnerJoinBuildRows,
    SortBufferRows,
    DistinctBufferRows,
    GroupBufferRows,
    AggregateDistinctRows,
    PathBufferRows,
}

impl ResourceOperator {
    /// Complete bounded operator vocabulary.
    pub const ALL: [Self; 6] = [
        Self::InnerJoinBuildRows,
        Self::SortBufferRows,
        Self::DistinctBufferRows,
        Self::GroupBufferRows,
        Self::AggregateDistinctRows,
        Self::PathBufferRows,
    ];

    pub const fn resource(self) -> &'static str {
        match self {
            Self::InnerJoinBuildRows => "inner_join_build_rows",
            Self::SortBufferRows => "sort_buffer_rows",
            Self::DistinctBufferRows => "distinct_buffer_rows",
            Self::GroupBufferRows => "group_buffer_rows",
            Self::AggregateDistinctRows => "aggregate_distinct_rows",
            Self::PathBufferRows => "path_buffer_rows",
        }
    }

    pub const fn phase(self) -> &'static str {
        match self {
            Self::InnerJoinBuildRows => "join_build",
            Self::SortBufferRows => "sort_buffer",
            Self::DistinctBufferRows => "distinct_buffer",
            Self::GroupBufferRows => "group_buffer",
            Self::AggregateDistinctRows => "aggregate_distinct",
            Self::PathBufferRows => "path_buffer",
        }
    }
}

/// Fixed-cardinality observations of configured resource handles at final
/// workload-lease release. All arithmetic saturates.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ResourceUsageMetrics {
    observations: [[u64; 6]; 2],
    charged_rows: [[u64; 6]; 2],
    exhausted: [[u64; 6]; 2],
    charged_rows_max: [[u64; 6]; 2],
}

impl ResourceUsageMetrics {
    /// Exact number of Prometheus samples written by [`Self::write_prometheus`].
    pub const SAMPLES: usize = 4 * 2 * 6;

    pub const fn observations(&self, pool: AdmissionPool, operator: ResourceOperator) -> u64 {
        self.observations[pool as usize][operator as usize]
    }

    pub const fn charged_rows(&self, pool: AdmissionPool, operator: ResourceOperator) -> u64 {
        self.charged_rows[pool as usize][operator as usize]
    }

    pub const fn exhausted(&self, pool: AdmissionPool, operator: ResourceOperator) -> u64 {
        self.exhausted[pool as usize][operator as usize]
    }

    pub const fn charged_rows_max(&self, pool: AdmissionPool, operator: ResourceOperator) -> u64 {
        self.charged_rows_max[pool as usize][operator as usize]
    }

    pub(super) fn record(
        &mut self,
        pool: AdmissionPool,
        operator: ResourceOperator,
        charged_rows: u64,
        exhausted: bool,
    ) {
        let (pool, operator) = (pool as usize, operator as usize);
        self.observations[pool][operator] = self.observations[pool][operator].saturating_add(1);
        self.charged_rows[pool][operator] =
            self.charged_rows[pool][operator].saturating_add(charged_rows);
        self.exhausted[pool][operator] =
            self.exhausted[pool][operator].saturating_add(u64::from(exhausted));
        self.charged_rows_max[pool][operator] =
            self.charged_rows_max[pool][operator].max(charged_rows);
    }

    /// Writes four bounded-label families with exactly [`Self::SAMPLES`] samples.
    pub fn write_prometheus(&self, output: &mut impl Write) -> fmt::Result {
        self.write_family(
            output,
            "oxigraph_workload_resource_observations_total",
            "counter",
            |s, p, o| s.observations(p, o),
        )?;
        self.write_family(
            output,
            "oxigraph_workload_resource_charged_rows_total",
            "counter",
            |s, p, o| s.charged_rows(p, o),
        )?;
        self.write_family(
            output,
            "oxigraph_workload_resource_exhausted_total",
            "counter",
            |s, p, o| s.exhausted(p, o),
        )?;
        self.write_family(
            output,
            "oxigraph_workload_resource_charged_rows_max",
            "gauge",
            |s, p, o| s.charged_rows_max(p, o),
        )
    }

    fn write_family(
        &self,
        output: &mut impl Write,
        name: &str,
        kind: &str,
        value: impl Fn(&Self, AdmissionPool, ResourceOperator) -> u64,
    ) -> fmt::Result {
        writeln!(output, "# TYPE {name} {kind}")?;
        for pool in AdmissionPool::ALL {
            for operator in ResourceOperator::ALL {
                writeln!(
                    output,
                    "{name}{{pool=\"{}\",resource=\"{}\",phase=\"{}\"}} {}",
                    pool.as_str(),
                    operator.resource(),
                    operator.phase(),
                    value(self, pool, operator)
                )?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{Result, ensure};

    #[test]
    fn fixed_format_and_saturating_observations_are_bounded() -> Result<()> {
        let mut metrics = ResourceUsageMetrics::default();
        metrics.observations[0][0] = u64::MAX;
        metrics.charged_rows[0][0] = u64::MAX;
        metrics.exhausted[0][0] = u64::MAX;
        metrics.charged_rows_max[0][0] = u64::MAX - 1;
        metrics.record(
            AdmissionPool::Data,
            ResourceOperator::InnerJoinBuildRows,
            7,
            true,
        );
        ensure!(
            metrics.observations(AdmissionPool::Data, ResourceOperator::InnerJoinBuildRows)
                == u64::MAX
                && metrics.charged_rows(AdmissionPool::Data, ResourceOperator::InnerJoinBuildRows)
                    == u64::MAX
                && metrics.exhausted(AdmissionPool::Data, ResourceOperator::InnerJoinBuildRows)
                    == u64::MAX
                && metrics
                    .charged_rows_max(AdmissionPool::Data, ResourceOperator::InnerJoinBuildRows)
                    == u64::MAX - 1
        );
        let mut text = String::new();
        metrics.write_prometheus(&mut text)?;
        ensure!(
            text.lines().filter(|line| !line.starts_with('#')).count()
                == ResourceUsageMetrics::SAMPLES
        );
        ensure!(
            text.contains("oxigraph_workload_resource_observations_total{pool=\"data\",resource=\"inner_join_build_rows\",phase=\"join_build\"} 18446744073709551615\n")
                && text.contains("oxigraph_workload_resource_charged_rows_max{pool=\"operator\",resource=\"path_buffer_rows\",phase=\"path_buffer\"} 0\n")
                && !text.contains("class=")
                && !text.contains("policy=")
                && !text.contains("principal=")
        );
        Ok(())
    }
}
