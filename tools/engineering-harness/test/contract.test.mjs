import assert from "node:assert/strict";
import { test } from "node:test";

import {
  g12ContractPath,
  g13ContractPath,
  g14ContractPath,
  g15ContractPath,
  g15bContractPath,
  g15cContractPath,
  loadTaskContract,
  resolveTaskContract,
  validateTaskContract,
  verifyTaskContractRepository,
} from "../src/contract.mjs";
import {
  g13Profile,
  g14Profile,
  g15Profile,
  g15bProfile,
  g15cProfile,
} from "../src/task-profile.mjs";

function changed(contract, mutate) {
  const clone = structuredClone(contract);
  mutate(clone);
  return clone;
}

test("loads the frozen G1.2 contract and binds it to real Git objects", () => {
  const resolution = resolveTaskContract();

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.2/contract.json",
  );
  assert.match(resolution.contractSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    resolution.repository.baseline.commit,
    "3edfb86a7f9d591f20ba14b2a2c9a7f2b41fade9",
  );
  assert.equal(
    resolution.repository.evaluator.commit,
    "eaf7161c142fb8afecd37dd9dad02463c0efa107",
  );
  assert.equal(resolution.repository.registration, null);
});

test("loads the post-G1.2 compiler-red G1.3 contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ contractPath: g13ContractPath });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.3/contract.json",
  );
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcCode, "E0432");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 1);
  assert.equal(resolution.contract.success.publicPassed, 9);
  assert.deepEqual(g13Profile.sourceAllowlist, [
    "lib/oxigraph/src/store.rs",
    "lib/oxigraph/src/store/transactional.rs",
    "lib/oxigraph/src/storage/mod.rs",
    "lib/oxigraph/tests/transaction_capabilities.rs",
  ]);
  assert.equal(
    resolution.repository.baseline.commit,
    "7eec1f0715e4f28434b2f505e289c9b599991aae",
  );
  assert.equal(
    resolution.repository.evaluator.commit,
    "4ad118a039d6ee57c63b9c45e47368454762e2ee",
  );
});

test("loads the five-path compiler-red G1.4 contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ contractPath: g14ContractPath });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.4/contract.json",
  );
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 5);
  assert.equal(resolution.contract.success.publicPassed, 6);
  assert.deepEqual(resolution.contract.scope.mutableExact, g14Profile.mutablePaths);
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("loads the feature-active compiler-red G1.5 contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ contractPath: g15ContractPath });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.5/contract.json",
  );
  assert.equal(resolution.contract.decision, "ADR-0019");
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 21);
  assert.equal(resolution.contract.success.publicPassed, 12);
  assert.deepEqual(resolution.contract.scope.mutableExact, g15Profile.mutablePaths);
  assert.deepEqual(
    resolution.contract.commands.public.argv.slice(5, 7),
    ["--features", "http-client,rdf-12"],
  );
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("loads the compiler-red G1.5b update-cancellation contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ contractPath: g15bContractPath });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.5b/contract.json",
  );
  assert.equal(resolution.contract.decision, "ADR-0019");
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcCode, "E0599");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 1);
  assert.equal(resolution.contract.success.publicPassed, 6);
  assert.equal(resolution.contract.success.independentPassed, 6);
  assert.equal(resolution.contract.success.regressionPassed, 12);
  assert.deepEqual(resolution.contract.scope.mutableExact, g15bProfile.mutablePaths);
  assert.equal(
    resolution.contract.commands.regression.argv.at(-1),
    "sparql_egress_policy",
  );
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("loads the compiler-red G1.5c negotiated-update contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ contractPath: g15cContractPath });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.5c/contract.json",
  );
  assert.equal(resolution.contract.decision, "ADR-0019");
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcCode, "E0599");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 2);
  assert.equal(resolution.contract.success.publicPassed, 5);
  assert.equal(resolution.contract.success.independentPassed, 9);
  assert.equal(resolution.contract.success.regressionPassed, 3);
  assert.equal(resolution.contract.ceilings.cargoBuildJobs, 1);
  assert.equal(resolution.contract.ceilings.maxResidentBytes, 17_179_869_184);
  assert.equal(resolution.contract.ceilings.maxVerifierDiskBytes, 8_589_934_592);
  assert.ok(
    resolution.contract.ceilings.maxResidentBytes >
      resolution.contract.ceilings.maxVerifierDiskBytes,
  );
  assert.deepEqual(resolution.contract.scope.mutableExact, g15cProfile.mutablePaths);
  assert.deepEqual(
    resolution.contract.commands.independent.argv.slice(-4),
    ["--test", "transaction_capabilities", "--test", "rocksdb_writer_serialization"],
  );
  assert.deepEqual(
    resolution.contract.commands.regression.argv.slice(-6),
    [
      "--test",
      "sparql_update_cancellation",
      "--test",
      "sparql_egress_policy",
      "--test",
      "transactional_dataset",
    ],
  );
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("keeps the containing control commit outside the self-declared contract", () => {
  const { contract } = loadTaskContract();

  assert.equal(Object.hasOwn(contract, "registrationCommit"), false);
  assert.equal(Object.hasOwn(contract, "contractSha256"), false);
  assert.throws(
    () => validateTaskContract({ ...contract, registrationCommit: "0".repeat(40) }),
    /contract keys must be exactly/u,
  );
});

test("fails closed on authority, native routing, scope, commands, ceilings, and red signature", () => {
  const { contract } = loadTaskContract();
  const cases = [
    changed(contract, (value) => {
      value.localOnly = false;
    }),
    changed(contract, (value) => {
      value.promotionAuthority = true;
    }),
    changed(contract, (value) => {
      value.routing.providers[0].transport = "openrouter";
    }),
    changed(contract, (value) => {
      value.routing.providers[1].model = "";
    }),
    changed(contract, (value) => {
      value.scope.mutableExact = [];
      value.scope.mutablePrefixes = ["lib/oxigraph/src/storage"];
    }),
    changed(contract, (value) => {
      value.scope.allowCreate = true;
    }),
    changed(contract, (value) => {
      value.commands.public.argv.push("--ignored");
    }),
    changed(contract, (value) => {
      value.verificationSequence = [
        "format",
        "public",
        "build",
        "independent",
        "regression",
      ];
    }),
    changed(contract, (value) => {
      value.ceilings.maxChangedFiles = 2;
    }),
    changed(contract, (value) => {
      value.ceilings.networkDuringVerification = true;
    }),
    changed(contract, (value) => {
      value.initialRed.requiredSubstrings.pop();
    }),
  ];

  for (const invalid of cases) {
    assert.throws(
      () => validateTaskContract(invalid),
      /invalid engineering task contract/u,
    );
  }
});

test("fails closed when frozen repository claims are altered", () => {
  const { contract } = loadTaskContract();
  const cases = [
    changed(contract, (value) => {
      value.baseline.tree = "1".repeat(40);
    }),
    changed(contract, (value) => {
      value.evaluator.parent = value.evaluator.commit;
    }),
    changed(contract, (value) => {
      value.evaluator.patchSha256 = "1".repeat(64);
    }),
    changed(contract, (value) => {
      value.protectedInputs.baselineManifest.protectedSha256 = "1".repeat(64);
    }),
  ];

  for (const invalid of cases) {
    assert.throws(
      () => verifyTaskContractRepository(invalid),
      /invalid engineering task contract/u,
    );
  }
});

test("rejects contract paths outside the harness", () => {
  assert.throws(
    () =>
      loadTaskContract({
        contractPath: new URL("../../../README.md", import.meta.url).pathname,
      }),
    /contract path escapes the engineering harness/u,
  );
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g12ContractPath }));
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g13ContractPath }));
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g14ContractPath }));
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g15ContractPath }));
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g15bContractPath }));
  assert.doesNotThrow(() => loadTaskContract({ contractPath: g15cContractPath }));
});
