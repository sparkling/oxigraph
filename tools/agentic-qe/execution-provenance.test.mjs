import assert from "node:assert/strict";
import test from "node:test";
import {
  commandAuthority,
  parseCargoTestIds,
  runtimeProgramPlan,
  validateCargoTestIds,
} from "./execution-provenance.mjs";
import { commands, profiles } from "./profile-definitions.mjs";

test("Cargo inventory parser accepts only complete libtest inventory lines", () => {
  const ids = parseCargoTestIds(
    [
      "alpha::works: test",
      "attacker alpha::spoof: test suffix",
      "beta::also_works: test",
      "  gamma::indented: test",
      "delta::bench: benchmark",
    ].join("\n"),
  );
  assert.deepEqual(ids, ["alpha::works", "beta::also_works"]);
  assert.doesNotThrow(() =>
    validateCargoTestIds("sentinels", ids, {
      expectedPassedTests: 2,
      requiredTestIds: ["beta::also_works"],
    }),
  );
  assert.throws(
    () =>
      validateCargoTestIds("sentinels", ids, {
        expectedPassedTests: 2,
        requiredTestIds: ["missing"],
      }),
    /omit required sentinels: missing/,
  );

  assert.deepEqual(
    runtimeProgramPlan(
      ["datalogJena", "datalogSouffle", "owlW3c", "shaclW3c", "shaclJena", "jenaParity"],
      commands,
    ),
    {
      host: [
        "bash",
        "cargo",
        "git",
        "java",
        "mise",
        "mvn",
        "node",
        "rustc",
        "souffle",
      ],
      jenaParityMise: ["cargo", "java", "mvn", "rustc"],
    },
  );
  assert.equal(
    commandAuthority("shaclJena", "node"),
    "Apache Jena differential oracle",
  );
  assert.deepEqual(commands.normativeControlAudit[2], {
    timeoutMs: 300_000,
    evidencePaths: [
      "docs/research/normative-requirements.json",
      "docs/research/standards-registry.json",
      "tools/w3c-tests",
    ],
    outputPaths: ["target/w3c/normative-control/audit.json"],
  });
  for (const profile of ["w3c", "metaharness-semantic-gate", "parity"]) {
    assert.equal(
      profiles[profile].filter((id) => id === "normativeControlAudit").length,
      1,
    );
  }
  for (const profile of ["w3c", "metaharness-semantic-gate", "parity"]) {
    assert.equal(
      profiles[profile].filter((id) => id === "normativeClauseInventory")
        .length,
      1,
    );
  }
  assert.equal(profiles["metaharness-semantic-gate"].length, 41);
  assert.equal(profiles.parity.length, 47);
});
