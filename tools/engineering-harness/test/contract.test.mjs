import assert from "node:assert/strict";
import { test } from "node:test";

import {
  g12ContractPath,
  loadTaskContract,
  resolveTaskContract,
  validateTaskContract,
  verifyTaskContractRepository,
} from "../src/contract.mjs";

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
    assert.throws(() => validateTaskContract(invalid), /invalid G1\.2 task contract/u);
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
      /invalid G1\.2 task contract/u,
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
});
