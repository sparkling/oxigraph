export const nodeTestPlan = /^1\.\.(\d+)$/u;
export const nodeTestSummary =
  /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/u;
export const nodeTestDuration = /^# duration_ms (\d+(?:\.\d+)?)$/u;
export const nodeSummaryFields = Object.freeze([
  "tests",
  "suites",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo",
]);

export function normalizeNodeTestSummary(scan) {
  const value = (values) => (values.length === 1 ? values[0] : null);
  const result = {
    plan: value(scan.plans),
    durationMs: value(scan.durations),
    duplicateOrMissing: scan.plans.length !== 1 || scan.durations.length !== 1,
  };
  for (const field of nodeSummaryFields) {
    result[field] = value(scan.values[field]);
    if (scan.values[field].length !== 1) result.duplicateOrMissing = true;
  }
  const terminal = scan.lastNonemptyLines ?? [];
  const expectedTerminal = [
    `1..${result.plan}`,
    `# tests ${result.tests}`,
    `# suites ${result.suites}`,
    `# pass ${result.pass}`,
    `# fail ${result.fail}`,
    `# cancelled ${result.cancelled}`,
    `# skipped ${result.skipped}`,
    `# todo ${result.todo}`,
    `# duration_ms ${result.durationMs}`,
  ];
  result.terminal =
    terminal.length === expectedTerminal.length &&
    terminal.every((line, index) => line === expectedTerminal[index]);
  result.summaryBlockCount =
    result.terminal && !result.duplicateOrMissing ? 1 : 0;
  result.conserved =
    result.tests ===
    result.pass + result.fail + result.cancelled + result.skipped + result.todo;
  return result;
}

export function parseNodeTestSummary(output) {
  const scan = {
    plans: [],
    durations: [],
    lastNonemptyLines: [],
    values: Object.fromEntries(nodeSummaryFields.map((field) => [field, []])),
  };
  for (const line of boundedTestOutputLines(output)) {
    if (line.length > 0) {
      scan.lastNonemptyLines.push(line);
      if (scan.lastNonemptyLines.length > 9) {
        scan.lastNonemptyLines.shift();
      }
    }
    const plan = nodeTestPlan.exec(line);
    if (plan) {
      assertBoundedObservationCount(
        scan.plans.length + 1,
        MAX_NODE_MARKERS_PER_FIELD,
        "Node TAP plans",
      );
      scan.plans.push(Number.parseInt(plan[1], 10));
      continue;
    }
    const summary = nodeTestSummary.exec(line);
    if (summary) {
      assertBoundedObservationCount(
        scan.values[summary[1]].length + 1,
        MAX_NODE_MARKERS_PER_FIELD,
        `Node TAP ${summary[1]} summaries`,
      );
      scan.values[summary[1]].push(Number.parseInt(summary[2], 10));
      continue;
    }
    const duration = nodeTestDuration.exec(line);
    if (duration) {
      assertBoundedObservationCount(
        scan.durations.length + 1,
        MAX_NODE_MARKERS_PER_FIELD,
        "Node TAP durations",
      );
      scan.durations.push(Number.parseFloat(duration[1]));
    }
  }
  return normalizeNodeTestSummary(scan);
}
import {
  assertBoundedObservationCount,
  boundedTestOutputLines,
} from "./bounded-lines.mjs";

const MAX_NODE_MARKERS_PER_FIELD = 2;
