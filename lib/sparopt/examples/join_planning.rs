//! Local planner-only resource diagnostic, not a corpus or promotion gate.
//! Usage: join_planning LEAVES IRI_PADDING_BYTES REPETITIONS greedy|v1|v2|v3
use spargebra::{Query, SparqlParser};
use sparopt::algebra::QueryExpression;
use sparopt::{BoundedJoinCostModel, BoundedJoinPlanning, Optimizer};
use std::fmt::Write as _;
use std::hint::black_box;
use std::io::Write as _;
use std::time::Instant;

#[expect(
    clippy::use_debug,
    reason = "The diagnostic compares complete synthetic plans and reports"
)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        return Err(
            "usage: join_planning LEAVES IRI_PADDING_BYTES REPETITIONS greedy|v1|v2|v3".into(),
        );
    }
    let leaves: usize = args[0].parse()?;
    let padding: usize = args[1].parse()?;
    let repetitions: usize = args[2].parse()?;
    if !(2..=64).contains(&leaves) || padding > 0x0001_0000 || !(1..=1_000).contains(&repetitions) {
        return Err("require 2..64 leaves, 0..65536 padding bytes, 1..1000 repetitions".into());
    }
    let options = match args[3].as_str() {
        "greedy" => None,
        "v1" => Some(BoundedJoinPlanning::default()),
        "v2" => Some(
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2),
        ),
        "v3" => {
            Some(BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::CorrelatedV3))
        }
        _ => return Err("mode must be greedy, v1, v2 or v3".into()),
    };
    let suffix = "x".repeat(padding);
    let mut body = String::new();
    for i in 0..leaves {
        write!(&mut body, "?s <urn:p{i}{suffix}> ?o{i} .")?;
    }
    let Query::Select(query) =
        SparqlParser::new().parse_query(&format!("SELECT * WHERE {{ {body} }}"))?
    else {
        return Err("expected SELECT".into());
    };
    let input = QueryExpression::from(&query.expression);
    let (expected, report) =
        Optimizer::optimize_query_expression_with_join_planning(input.clone(), None, options);
    if options.is_some() {
        let dp = leaves <= usize::from(BoundedJoinPlanning::MAX_DP_LEAVES);
        if report.dp_components != usize::from(dp)
            || report.greedy_components != usize::from(!dp)
            || report.dp_states > 255
            || report.dp_candidates > 2_048
        {
            return Err("unexpected DP/fallback work report".into());
        }
        if !dp && expected != Optimizer::optimize_query_expression(input.clone()) {
            return Err("fallback differs from default greedy".into());
        }
    }
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    writeln!(
        output,
        "input leaves={leaves} iri_padding_bytes={padding} repetitions={repetitions} mode={} sep_0006={} warmups=1",
        args[3],
        cfg!(feature = "sep-0006")
    )?;
    // Full synthetic plan/report outside timing permits exact parent comparison,
    // not just a potentially colliding process-local hash or a plan score.
    writeln!(output, "plan {expected:?}")?;
    writeln!(output, "report {report:?}")?;
    for round in 0..repetitions {
        let owned = input.clone();
        let started = Instant::now();
        let (actual, actual_report) = Optimizer::optimize_query_expression_with_join_planning(
            black_box(owned),
            None,
            options,
        );
        let elapsed = started.elapsed();
        if actual != expected || actual_report != report {
            return Err("non-deterministic plan or report".into());
        }
        writeln!(output, "sample {round} {}", elapsed.as_nanos())?;
    }
    writeln!(output, "complete {repetitions}")?;
    output.flush()?;
    Ok(())
}
