import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localNodeModulesRoot } from "../dependency-policy.mjs";
import {
  commandAuthority,
  parseCargoTestIds,
  runtimeProgramPlan,
  validateCargoTestIds,
} from "./execution-provenance.mjs";
import { commands, profiles } from "./profile-definitions.mjs";
import {
  AGENTIC_QE_VERSION_POLICY,
  agenticQeDependencyResolution,
  validateAgenticQeLockPolicy,
} from "./version-policy.mjs";

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
});

test("runtime planning binds latest Agentic-QE and semantic authorities", () => {
  const fixtureManifest = { dependencies: { "agentic-qe": "latest" } };
  const fixtureLock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "agentic-qe": "latest" } },
      "node_modules/agentic-qe": {
        version: "1.2.3",
        resolved:
          "https://registry.npmjs.org/agentic-qe/-/agentic-qe-1.2.3.tgz",
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
    },
  };
  assert.equal(
    validateAgenticQeLockPolicy(fixtureManifest, fixtureLock).version,
    "1.2.3",
  );
  for (const invalid of [
    [{ dependencies: { "agentic-qe": "1.2.3" } }, fixtureLock],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/agentic-qe/-/agentic-qe-1.2.3.tgz",
            integrity: "sha512-not-canonical",
          },
        },
      },
    ],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            ...fixtureLock.packages["node_modules/agentic-qe"],
            version: "latest",
          },
        },
      },
    ],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            ...fixtureLock.packages["node_modules/agentic-qe"],
            resolved: "file:../../attacker.tgz",
          },
        },
      },
    ],
    [fixtureManifest, { ...fixtureLock, lockfileVersion: 2 }],
  ]) {
    assert.throws(() => validateAgenticQeLockPolicy(...invalid));
  }

  const dependency = agenticQeDependencyResolution();
  assert.equal(dependency.name, "agentic-qe");
  assert.equal(dependency.policy, AGENTIC_QE_VERSION_POLICY);
  assert.match(dependency.version, /^\d+\.\d+\.\d+/);
  assert.match(dependency.integrity, /^sha512-/);
  assert.match(dependency.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.lockfileSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.npmrcSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.installedPackageJsonSha256, /^[0-9a-f]{64}$/);
  for (const required of [
    "tools/child-environment.mjs",
    "tools/dependency-policy.mjs",
  ]) {
    assert.ok(commands.agenticAdapter[2].evidencePaths.includes(required));
  }
  const root = mkdtempSync(join(tmpdir(), "dependency-policy-test-"));
  try {
    const adapter = join(root, "adapter");
    const outside = join(root, "outside");
    mkdirSync(adapter);
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(adapter, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => localNodeModulesRoot(adapter, "fixture adapter"),
      /real local directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
