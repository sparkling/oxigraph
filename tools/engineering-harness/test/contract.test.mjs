import assert from "node:assert/strict";
import { test } from "node:test";

import {
  g12ContractPath,
  g13ContractPath,
  g14ContractPath,
  g14aContractPath,
  g14bContractPath,
  g15ContractPath,
  g15bContractPath,
  g15cContractPath,
  g16ContractPath,
  loadTaskContract,
  resolveTaskContract,
  validateTaskContract,
  verifyTaskContractRepository,
} from "../src/contract.mjs";
import {
  g12Profile,
  g13Profile,
  g14Profile,
  g14aProfile,
  g14bProfile,
  g15Profile,
  g15bProfile,
  g15cProfile,
  g16Profile,
  engineeringTaskIds,
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
  const resolution = resolveTaskContract({ taskId: g13Profile.id });

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
  const resolution = resolveTaskContract({ taskId: g14Profile.id });

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

test("loads the evaluator-separated G1.4a Store outcome contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ taskId: g14aProfile.id });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.4a/contract.json",
  );
  assert.equal(resolution.contract.decision, "ADR-0018");
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcCode, "E0432");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 24);
  assert.equal(resolution.contract.success.publicPassed, 7);
  assert.equal(resolution.contract.success.servicePassed, 9);
  assert.equal(resolution.contract.success.compatibilityPassed, 20);
  assert.equal(resolution.contract.success.independentPassed, 3);
  assert.equal(resolution.contract.success.regressionPassed, 2);
  assert.deepEqual(resolution.contract.scope.mutableExact, g14aProfile.mutablePaths);
  assert.equal(
    resolution.contract.evaluator.path,
    "lib/oxigraph/tests/transaction_outcomes.rs",
  );
  assert.deepEqual(resolution.contract.verificationSequence, [
    "format",
    "build",
    "public",
    "service",
    "compatibility",
    "independent",
    "regression",
  ]);
  assert.equal(resolution.contract.commands.service.argv.includes("--skip"), false);
  assert.equal(resolution.contract.commands.compatibility.argv.includes("--skip"), false);
  assert.deepEqual(resolution.contract.commands.build.argv.slice(-4), [
    "--test",
    "transaction_state_model",
    "--test",
    "update_atomicity",
  ]);
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("loads the runtime-red G1.4b outcome fault contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ taskId: g14bProfile.id });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.4b/contract.json",
  );
  assert.equal(resolution.contract.decision, "ADR-0018");
  assert.equal(Object.hasOwn(resolution.contract.initialRed, "kind"), false);
  assert.equal(resolution.contract.initialRed.commandRole, "public");
  assert.equal(resolution.contract.initialRed.exitCode, 101);
  assert.equal(resolution.contract.initialRed.passed, 6);
  assert.equal(resolution.contract.initialRed.failed, 2);
  assert.deepEqual(resolution.contract.scope.mutableExact, [
    "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
  ]);
  assert.equal(
    resolution.contract.evaluator.path,
    "lib/oxigraph/src/store/transaction_outcome_faults.rs",
  );
  assert.equal(resolution.contract.evaluator.changeStatus, "M");
  assert.deepEqual(resolution.contract.verificationSequence, [
    "format",
    "build",
    "public",
    "independent",
    "regression",
  ]);
  assert.deepEqual(resolution.contract.commands.public.argv.slice(-2), [
    "--lib",
    "store::transaction_outcome_faults::",
  ]);
  assert.equal(resolution.contract.success.publicPassed, 8);
  assert.equal(resolution.contract.success.independentPassed, 7);
  assert.equal(resolution.contract.success.regressionPassed, 20);
  assert.equal(
    resolution.repository.baseline.commit,
    "9c13454350b951a24b68b996aaefb50e32997a06",
  );
  assert.equal(
    resolution.repository.evaluator.commit,
    "95440da438da2260b0d5cf1d1d011c9a4574947d",
  );
});

test("loads the feature-active compiler-red G1.5 contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ taskId: g15Profile.id });

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
  const resolution = resolveTaskContract({ taskId: g15bProfile.id });

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
  const resolution = resolveTaskContract({ taskId: g15cProfile.id });

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
  assert.equal(resolution.contract.ceilings.maxVerifierDiskBytes, 12_884_901_888);
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

test("loads the two-change compiler-red G1.6 service-claims contract and binds it to Git", () => {
  const resolution = resolveTaskContract({ taskId: g16Profile.id });

  assert.equal(
    resolution.contractPath,
    "tools/engineering-harness/tasks/g1/g1.6/contract.json",
  );
  assert.equal(resolution.contract.id, "g1.6-runtime-derived-service-claims");
  assert.equal(resolution.contract.decision, "ADR-0019");
  assert.equal(resolution.contract.initialRed.kind, "compiler");
  assert.equal(resolution.contract.initialRed.rustcCode, "E0599");
  assert.equal(resolution.contract.initialRed.rustcErrorCount, 1);
  assert.deepEqual(resolution.contract.initialRed.requiredExports, [
    "effective_capabilities",
  ]);
  assert.equal(resolution.contract.success.publicPassed, 4);
  assert.equal(resolution.contract.success.servicePassed, 17);
  assert.equal(resolution.contract.success.compatibilityPassed, 1);
  assert.equal(resolution.contract.success.independentPassed, 1);
  assert.equal(resolution.contract.success.regressionPassed, 12);
  assert.equal(resolution.contract.ceilings.cargoBuildJobs, 1);
  assert.equal(resolution.contract.ceilings.maxResidentBytes, 17_179_869_184);
  assert.equal(resolution.contract.ceilings.maxVerifierDiskBytes, 12_884_901_888);
  assert.deepEqual(resolution.contract.protectedInputs.submodules.at(-1), {
    path: "cli/templates/yasgui",
    commit: "05a7ac428edeab35e40f66cafe0589ac9d224ee6",
    tree: "84c72c5bced4d33c566a915aa7bb126d9220fe84",
  });
  assert.deepEqual(resolution.contract.scope.mutableExact, g16Profile.mutablePaths);
  assert.equal(g16Profile.taskClass, "runtime-service-capabilities");
  assert.deepEqual(g16Profile.sourceAllowlist, [
    "lib/oxigraph/src/http.rs",
    "lib/oxigraph/src/sparql/mod.rs",
    "lib/spareval/src/lib.rs",
    "cli/src/service_description.rs",
    "cli/src/main.rs",
    "cli/src/service_description/tests.rs",
    "lib/oxigraph/tests/sparql_effective_capabilities.rs",
    "lib/oxigraph/tests/sparql_version.rs",
    "lib/oxigraph/tests/sparql_egress_policy.rs",
  ]);
  assert.match(g16Profile.guidance, /QueryEvaluator::has_default_service_handler/u);
  assert.match(g16Profile.guidance, /Do not shadow that authority/u);
  assert.match(g16Profile.guidance, /must not mirror CLI TLS cfg values/u);
  assert.match(g16Profile.guidance, /legacy absent policy remains permissive/u);
  assert.match(g16Profile.guidance, /owning oxigraph\/http-client feature/u);
  assert.match(g16Profile.guidance, /UnionDefaultGraph for query and update endpoints/u);
  assert.match(g16Profile.guidance, /always-available deny-all wrapper/u);
  assert.ok(g16Profile.sourceAllowlist.includes(resolution.contract.evaluator.path));
  assert.equal(Object.hasOwn(resolution.contract.evaluator, "changes"), false);
  assert.equal(Object.hasOwn(resolution.contract, "evaluatorChanges"), false);
  assert.deepEqual(resolution.contract.verificationSequence, [
    "format",
    "build",
    "public",
    "service",
    "compatibility",
    "independent",
    "regression",
  ]);
  assert.deepEqual(resolution.contract.commands.public.argv.slice(-3), [
    "http-client-native-tls,rdf-12",
    "--test",
    "sparql_effective_capabilities",
  ]);
  assert.deepEqual(resolution.contract.commands.service.argv.slice(-3), [
    "--bin",
    "oxigraph",
    "service_description::tests::",
  ]);
  assert.equal(resolution.contract.commands.service.timeoutMs, 300_000);
  assert.deepEqual(resolution.contract.commands.compatibility.argv, [
    "cargo",
    "test",
    "--locked",
    "-p",
    "oxigraph-cli",
    "--no-default-features",
    "--features",
    "oxigraph/http-client-native-tls,rdfs,geosparql,owl2-rl",
    "--bin",
    "oxigraph",
    "service_description::tests::dependency_qualified_library_tls_is_enforced_without_cli_tls",
    "--",
    "--exact",
    "--ignored",
  ]);
  assert.equal(resolution.contract.commands.compatibility.timeoutMs, 300_000);
  assert.deepEqual(resolution.contract.commands.build.argv.slice(-7), [
    "--test",
    "sparql_version",
    "--test",
    "sparql_egress_policy",
    "--bin",
    "oxigraph",
    "--no-run",
  ]);
  assert.equal(
    resolution.contract.commands.build.argv.includes(
      "sparql_effective_capabilities",
    ),
    false,
  );
  assert.equal(
    resolution.contract.commands.independent.argv[
      resolution.contract.commands.independent.argv.indexOf("--features") + 1
    ],
    "rdf-12",
  );
  assert.equal(
    resolution.contract.commands.regression.argv[
      resolution.contract.commands.regression.argv.indexOf("--features") + 1
    ],
    "http-client,rdf-12",
  );
  assert.equal(resolution.contract.commands.independent.timeoutMs, 2_700_000);
  assert.equal(resolution.contract.commands.regression.timeoutMs, 2_700_000);
  assert.equal(resolution.contract.commands.build.timeoutMs, 2_700_000);
  assert.equal(resolution.contract.ceilings.maxTotalVerifierWallMs, 7_200_000);
  assert.equal(resolution.repository.baseline.commit, resolution.contract.baseline.commit);
  assert.equal(resolution.repository.evaluator.commit, resolution.contract.evaluator.commit);
});

test("G1.6 exposes its frozen independent and regression oracle sources", () => {
  assert.deepEqual(g16Profile.sourceAllowlist.slice(-2), [
    "lib/oxigraph/tests/sparql_version.rs",
    "lib/oxigraph/tests/sparql_egress_policy.rs",
  ]);
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

test("selects only registered task ids and rejects contractPath before filesystem access", () => {
  assert.throws(
    () =>
      loadTaskContract({
        contractPath: new URL("../../../README.md", import.meta.url).pathname,
      }),
    /contractPath selection is forbidden/u,
  );
  assert.throws(
    () => loadTaskContract({ contractPath: undefined }),
    /contractPath selection is forbidden/u,
  );
  assert.throws(
    () => loadTaskContract({ taskId: "g9.9-unregistered" }),
    /unsupported engineering task/u,
  );
  for (const profile of [
    g12Profile,
    g13Profile,
    g14Profile,
    g14aProfile,
    g15Profile,
    g15bProfile,
    g15cProfile,
    g16Profile,
  ]) {
    assert.doesNotThrow(() => loadTaskContract({ taskId: profile.id }));
  }
});

test("legacy contract-path constants remain exact compatibility shims", () => {
  assert.deepEqual(
    [
      g12ContractPath,
      g13ContractPath,
      g14ContractPath,
      g14aContractPath,
      g14bContractPath,
      g15ContractPath,
      g15bContractPath,
      g15cContractPath,
      g16ContractPath,
    ],
    [
      g12Profile,
      g13Profile,
      g14Profile,
      g14aProfile,
      g14bProfile,
      g15Profile,
      g15bProfile,
      g15cProfile,
      g16Profile,
    ].map(({ contractPath }) => contractPath),
  );
});

test("the ordered registry is backed by the exact frozen contract set", () => {
  assert.deepEqual(
    engineeringTaskIds.map(
      (taskId) => loadTaskContract({ taskId }).contract.id,
    ),
    engineeringTaskIds,
  );
});
