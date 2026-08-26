import assert from "node:assert/strict";
import test from "node:test";
import { findDirectedCycles } from "./ruflo-adr-dry-run.mjs";

test("directed cycle detector rejects a dependency cycle", () => {
  const edges = [
    { from: "ADR-0001", to: "ADR-0002", relation: "depends-on" },
    { from: "ADR-0002", to: "ADR-0003", relation: "depends-on" },
    { from: "ADR-0003", to: "ADR-0001", relation: "depends-on" },
  ];
  assert.deepEqual(findDirectedCycles(edges, "depends-on"), [
    ["ADR-0001", "ADR-0002", "ADR-0003", "ADR-0001"],
  ]);
});
