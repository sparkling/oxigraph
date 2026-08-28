import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  G17_CONTROL_AUTHORIZATION_PROTOCOL,
  G17_CONTROL_AUTHORIZATION_SCHEMA,
  G17_CONTROL_RUN_RECEIPT_SCHEMA,
  G17_FINAL_DECISION_PROTOCOL,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
  G17_NEGATIVE_CONTROL_SIGNATURE_V2_SCHEMA,
  loadG17ControlProtocol,
  validateG17ControlAuthorization,
  validateG17ControlExecutionBinding,
  validateG17FinalDecisionBinding,
  validateG17FinalDecisionSet,
  validateG17NegativeControlSignature,
} from "../src/qualification/control-protocol.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17ControlAuthorizationGateError,
  G17ControlExecutionUnavailableError,
  G17QualificationDecisionGateError,
  runG17Controls,
  runG17Qualification,
} from "../src/qualification/runner.mjs";

const AUTH_APPROVED_AT = "2026-08-28T00:00:00.000Z";
const CONTROL_STARTED_AT = "2026-08-28T00:01:00.000Z";
const CONTROL_COMPLETED_AT = "2026-08-28T00:02:00.000Z";
const FINAL_APPROVED_AT = "2026-08-28T00:03:00.000Z";
const QUALIFICATION_STARTED_AT = "2026-08-28T00:04:00.000Z";
const CONTROL_RUN_ID = "g17-control-20260828";
const executeFile = promisify(execFile);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rehash(value) {
  const { contentHash: ignored, ...unsigned } = value;
  value.contentHash = canonicalSha256(unsigned);
  return value;
}

function rawSha256(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
}

function acceptedG14bProjection() {
  const binding = {
    schema: G17_G14B_PREREQUISITE_BINDING_SCHEMA,
    task: {
      id: "g1.4b-outcome-fault-safety:g14b-phase-order-20260828",
      runId: "g14b-phase-order-20260828",
    },
    contract: {
      sha256:
        "926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8",
      evaluatorCommit: "fa832174f3023e035fbaad52721f1b616eb1752e",
      success: {
        publicPassed: 8,
        independentPassed: 7,
        regressionPassed: 20,
      },
    },
    selectedCandidate: {
      commit: "a1ca1eb45dba23c246ce84f70d67740c9bd388ab",
      tree: "ab5b281da2ee40c12122a9598d19d33b699d0b86",
      patchSha256:
        "02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314",
    },
    applicationReceipt: {
      schema: "oxigraph.engineering-application-receipt/v6",
      bytes: 95_990,
      rawSha256:
        "6273c29d7221d820ac6e46bc784deca5867045aa3704470e269f862a459d3205",
      receiptSha256:
        "d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad",
    },
    claim: {
      scope: "simulated-storage-call-pre-and-post-write-faults-only/v1",
      crashDurability: false,
      powerLossDurability: false,
      fsyncDurability: false,
    },
  };
  return {
    schema: G17_G14B_PREREQUISITE_SCHEMA,
    status: "PASS",
    binding,
    bindingSha256: canonicalSha256(binding),
    artifact: {
      name: "g14b-application-receipt.json",
      bytes: 95_990,
      sha256:
        "6273c29d7221d820ac6e46bc784deca5867045aa3704470e269f862a459d3205",
    },
  };
}

function authorizedFixture() {
  const loaded = loadG17Contract();
  const proposed = loadG17ControlProtocol({ contract: loaded.contract });
  const authorization = structuredClone(proposed.authorization);
  authorization.status = "CONTROL_AUTHORIZED";
  authorization.approval = {
    status: "APPROVED",
    approvedBy: "qualification-review-board",
    approvedAt: AUTH_APPROVED_AT,
  };
  rehash(authorization);
  const authorizationRawSha256 = rawSha256(authorization);

  const signature = {
    schema: G17_NEGATIVE_CONTROL_SIGNATURE_V2_SCHEMA,
    suiteHash: authorization.protocol.suite.taskHash,
    status: "FAIL",
    budgetBreaches: ["on-store-memory"],
    sampleSetSha256: "a".repeat(64),
    authorizationContentHash: authorization.contentHash,
    controlRunId: CONTROL_RUN_ID,
  };
  rehash(signature);

  const prerequisite = acceptedG14bProjection();
  assert.equal(
    canonicalSha256(prerequisite),
    G17_FINAL_DECISION_PROTOCOL.prerequisite.expectedProjectionSha256,
  );
  assert.equal(
    prerequisite.bindingSha256,
    G17_FINAL_DECISION_PROTOCOL.prerequisite.expectedBindingSha256,
  );

  const finalDecisionSet = structuredClone(proposed.finalDecisionSet);
  finalDecisionSet.status = "APPROVED";
  finalDecisionSet.controlAuthorization = {
    schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
    rawSha256: authorizationRawSha256,
    contentHash: authorization.contentHash,
  };
  finalDecisionSet.controlReceipt = {
    schema: G17_CONTROL_RUN_RECEIPT_SCHEMA,
    status: "CONTROL_SEALED_PASS",
    runId: CONTROL_RUN_ID,
    rawSha256: "b".repeat(64),
    receiptSha256: "c".repeat(64),
    authorizationRawSha256,
    authorizationContentHash: authorization.contentHash,
    negativeControlSignatureContentHash: signature.contentHash,
    startedAt: CONTROL_STARTED_AT,
    completedAt: CONTROL_COMPLETED_AT,
    environmentClass: G17_CONTROL_AUTHORIZATION_PROTOCOL.environment.class,
  };
  finalDecisionSet.negativeControlSignature = signature;
  finalDecisionSet.g14bPrerequisite = {
    schema: G17_G14B_PREREQUISITE_SCHEMA,
    status: "PASS",
    projectionSha256: canonicalSha256(prerequisite),
    bindingSha256: prerequisite.bindingSha256,
  };
  finalDecisionSet.approval = {
    status: "APPROVED",
    approvedBy: "qualification-review-board",
    approvedAt: FINAL_APPROVED_AT,
  };
  rehash(finalDecisionSet);
  return {
    authorization,
    authorizationRawSha256,
    finalDecisionSet,
    prerequisite,
    signature,
  };
}

test("v5 freezes v4 bytes and loads a proposed two-phase protocol", async () => {
  const loaded = loadG17Contract();
  const protocol = loadG17ControlProtocol({ contract: loaded.contract });
  assert.equal(
    loaded.contract.schema,
    "oxigraph.g1.7-qualification-contract/v5",
  );
  assert.equal(loaded.generation, "CURRENT_V5");
  assert.equal(protocol.authorization.status, "CONTROL_AUTH_PROPOSED");
  assert.equal(protocol.finalDecisionSet.status, "PROPOSED");
  assert.equal(protocol.authorization.protocol.execution.controlRows, 392);
  assert.equal(
    protocol.authorization.protocol.execution.finalQualificationRows,
    196,
  );
  assert.equal(
    protocol.authorization.protocol.execution.measuredPairsPerCase,
    10,
  );
  assert.deepEqual(protocol.authorization.protocol.execution.controls[1], {
    id: "a-a-noise-control",
    subjectRole: "noiseControl",
    referenceRole: "noiseControl",
    subjectBuildId: "noise-control-a",
    referenceBuildId: "noise-control-b",
    independentBuildOwnersRequired: true,
    purpose: "independently-built-a-a-environmental-control",
  });
  assert.equal(
    protocol.authorization.protocol.thresholds
      .negativeControlNoninferiorityBasisPoints,
    1_000,
  );
  assert.equal(
    protocol.authorization.protocol.thresholds.aaEquivalenceBasisPoints,
    500,
  );
  assert.equal(
    protocol.authorization.protocol.thresholds.maximumMadBasisPoints,
    500,
  );
  assert.deepEqual(protocol.authorization.protocol.darwin.statistics, {
    package: "@metaharness/darwin",
    version: "0.9.3",
    packageIntegrity:
      "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
    api: "security.bootstrapDelta",
    statisticsModuleSha256:
      "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
    samples: 5_000,
    baseSeed: 170_017,
    caseSeedDerivation: "base-plus-case-index",
    minDelta: 0,
    scorePrecisionDecimals: 12,
    decision: "lower95-strictly-positive",
  });
  for (const [name, expected] of [
    [
      "g17-qualification-contract-v4.json",
      "dd97f4a25b9555c1b711d697cdf636d1949690138fd3a78eb2f02a8b7a9b24f0",
    ],
    [
      "qualification/g1.7/decisions/reference.json",
      "45fbb9b98f9dabc7742c254a4b5b3bafc0f25174713445965332176df7af3a84",
    ],
    [
      "qualification/g1.7/decisions/performance-budget.json",
      "b38ae4b929dcf9e5da701808c726ada68a8c8188b7f3700f2fc47d4de6727d12",
    ],
    [
      "qualification/g1.7/decisions/noise-budget.json",
      "72666540abf5196bb65bfeab2eac1b6ae8b0f4ab25621f5eadf998e054deeb01",
    ],
  ]) {
    const bytes = await readFile(new URL(`fixtures/${name}`, import.meta.url));
    assert.equal(sha256(bytes), expected);
  }
});

test("proposed control and final artifacts are canonical, self-hashed, and non-authoritative", async () => {
  const loaded = loadG17Contract();
  const protocol = loadG17ControlProtocol({ contract: loaded.contract });
  for (const [descriptor, value] of [
    [loaded.contract.controlAuthorizationDecision, protocol.authorization],
    [loaded.contract.finalDecisionSet, protocol.finalDecisionSet],
  ]) {
    const bytes = await readFile(
      new URL(`../${descriptor.path}`, import.meta.url),
    );
    assert.equal(
      bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")),
      true,
    );
    assert.equal(sha256(bytes), descriptor.sha256);
    assert.equal(value.contentHash, descriptor.contentHash);
  }
  assert.deepEqual(protocol.authorization.protocol.authorizationScope, {
    negativeControlExecution: true,
    aaNoiseControlExecution: true,
    subjectQualificationExecution: false,
    performanceReferenceQualificationExecution: false,
    promotionAuthority: false,
    publicationAuthority: false,
    routerQualityAuthority: false,
    providerExecutionAuthority: false,
  });
  assert.deepEqual(protocol.authorization.protocol.environment, {
    class: "linux-x86_64-cgroup-v2-non-tmpfs-serialized",
    harnessSessionExclusive: true,
    dedicatedHostRequired: false,
    dedicatedCpusetRequired: false,
    nonTmpfsVolumeRequired: true,
    hardVolumeQuotaRequired: false,
    cargoBuildJobs: 4,
    maximumControlToFinalApprovalMs: 86_400_000,
    maximumFinalApprovalToQualificationMs: 86_400_000,
    requireSameClassForQualification: true,
  });
  assert.deepEqual(
    protocol.authorization.protocol.ownerPolicy.controlEnvelope,
    {
      maxFiles: 128,
      maxFileBytes: 67_108_864,
      maxAggregateBytes: 268_435_456,
      regularFilesOnly: true,
      singleLinkOnly: true,
      ownerOnly: true,
      writeOnce: true,
      receiptLast: true,
    },
  );
  assert.equal(
    protocol.finalDecisionSet.protocol.authorizationScope.promotionAuthority,
    false,
  );
});

test("authorized controls remain control-only and require strict prior approval", () => {
  const fixture = authorizedFixture();
  const binding = validateG17ControlExecutionBinding({
    authorization: fixture.authorization,
    authorizationRawSha256: fixture.authorizationRawSha256,
    controlStartedAt: CONTROL_STARTED_AT,
  });
  assert.equal(binding.phase, "CONTROL_AUTHORIZED");
  assert.equal(binding.controlExecutionAuthorized, true);
  assert.equal(binding.qualificationExecutionAuthorized, false);

  const proposed = loadG17ControlProtocol({
    contract: loadG17Contract().contract,
  }).authorization;
  assert.throws(
    () =>
      validateG17ControlExecutionBinding({
        authorization: proposed,
        authorizationRawSha256: rawSha256(proposed),
        controlStartedAt: CONTROL_STARTED_AT,
      }),
    /proposed control authorization/u,
  );
  for (const startedAt of [AUTH_APPROVED_AT, "2026-08-27T23:59:59.999Z"]) {
    assert.throws(
      () =>
        validateG17ControlExecutionBinding({
          authorization: fixture.authorization,
          authorizationRawSha256: fixture.authorizationRawSha256,
          controlStartedAt: startedAt,
        }),
      /approved before control start/u,
    );
  }
});

test("protocol gates reject accessor-backed authorization and final decisions", () => {
  const control = authorizedFixture();
  let controlStatusReads = 0;
  Object.defineProperty(control.authorization, "status", {
    enumerable: true,
    configurable: true,
    get() {
      controlStatusReads += 1;
      return controlStatusReads === 1
        ? "CONTROL_AUTH_PROPOSED"
        : "CONTROL_AUTHORIZED";
    },
  });
  assert.throws(
    () =>
      validateG17ControlExecutionBinding({
        authorization: control.authorization,
        authorizationRawSha256: control.authorizationRawSha256,
        controlStartedAt: CONTROL_STARTED_AT,
      }),
    /contains accessor fields/u,
  );
  assert.equal(controlStatusReads, 0);

  const final = authorizedFixture();
  let finalStatusReads = 0;
  Object.defineProperty(final.finalDecisionSet, "status", {
    enumerable: true,
    configurable: true,
    get() {
      finalStatusReads += 1;
      return finalStatusReads === 1 ? "PROPOSED" : "APPROVED";
    },
  });
  assert.throws(
    () =>
      validateG17FinalDecisionBinding({
        ...final,
        qualificationStartedAt: QUALIFICATION_STARTED_AT,
        g14bPrerequisiteProjection: final.prerequisite,
      }),
    /contains accessor fields/u,
  );
  assert.equal(finalStatusReads, 0);
});

test("final binding remains non-authoritative until control receipt replay exists", () => {
  const fixture = authorizedFixture();
  const binding = validateG17FinalDecisionBinding({
    ...fixture,
    qualificationStartedAt: QUALIFICATION_STARTED_AT,
    g14bPrerequisiteProjection: fixture.prerequisite,
  });
  assert.equal(binding.phase, "FINAL_SET_APPROVED");
  assert.equal(binding.controlRunId, CONTROL_RUN_ID);
  assert.equal(binding.ownerGatePassed, true);
  assert.equal(binding.executionOwnerAvailable, false);
  assert.equal(binding.g14bPrerequisiteBound, true);
  assert.equal(binding.controlReceiptReplayAvailable, false);
  assert.equal(binding.qualificationExecutionAuthorized, false);
  assert.equal(binding.promotionAuthority, false);
  assert.equal(binding.publicationAuthority, false);
});

test("contract and protocol readers reject FIFOs without blocking", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX FIFO semantics are unavailable on Windows");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-protocol-fifo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contractFifo = join(root, "contract.fifo");
  const authorizationFifo = join(
    root,
    "qualification",
    "g1.7",
    "decisions",
    "control-authorization.json",
  );
  await mkdir(join(root, "qualification", "g1.7", "decisions"), {
    recursive: true,
  });
  await executeFile("/usr/bin/mkfifo", [contractFifo]);
  await executeFile("/usr/bin/mkfifo", [authorizationFifo]);
  const contractModule = new URL(
    "../src/qualification/contract.mjs",
    import.meta.url,
  ).href;
  const protocolModule = new URL(
    "../src/qualification/control-protocol.mjs",
    import.meta.url,
  ).href;
  const script = `
    const { loadG17Contract } = await import(${JSON.stringify(contractModule)});
    const { loadG17ControlProtocol } = await import(${JSON.stringify(protocolModule)});
    try {
      loadG17Contract({ contractPath: ${JSON.stringify(contractFifo)} });
      throw new Error("contract FIFO unexpectedly accepted");
    } catch (error) {
      if (!error.message.includes("bounded regular file")) throw error;
      process.stdout.write("CONTRACT_FIFO_REJECTED\\n");
    }
    const loaded = loadG17Contract();
    try {
      loadG17ControlProtocol({ contract: loaded.contract, root: ${JSON.stringify(root)} });
      throw new Error("protocol FIFO unexpectedly accepted");
    } catch (error) {
      if (!error.message.includes("bounded regular file")) throw error;
      process.stdout.write("PROTOCOL_FIFO_REJECTED\\n");
    }
  `;
  const { stdout } = await executeFile(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { timeout: 1_000, killSignal: "SIGKILL" },
  );
  assert.equal(stdout, "CONTRACT_FIFO_REJECTED\nPROTOCOL_FIFO_REJECTED\n");
});

test("timestamp equality fails at every phase boundary", () => {
  const base = authorizedFixture();
  const mutations = [
    (fixture) => {
      fixture.authorization.approval.approvedAt = CONTROL_STARTED_AT;
      rehash(fixture.authorization);
      fixture.authorizationRawSha256 = rawSha256(fixture.authorization);
      fixture.finalDecisionSet.controlAuthorization.rawSha256 =
        fixture.authorizationRawSha256;
      fixture.finalDecisionSet.controlAuthorization.contentHash =
        fixture.authorization.contentHash;
      fixture.finalDecisionSet.controlReceipt.authorizationRawSha256 =
        fixture.authorizationRawSha256;
      fixture.finalDecisionSet.controlReceipt.authorizationContentHash =
        fixture.authorization.contentHash;
      fixture.finalDecisionSet.negativeControlSignature.authorizationContentHash =
        fixture.authorization.contentHash;
      rehash(fixture.finalDecisionSet.negativeControlSignature);
      fixture.finalDecisionSet.controlReceipt.negativeControlSignatureContentHash =
        fixture.finalDecisionSet.negativeControlSignature.contentHash;
      rehash(fixture.finalDecisionSet);
    },
    (fixture) => {
      fixture.finalDecisionSet.controlReceipt.completedAt = FINAL_APPROVED_AT;
      rehash(fixture.finalDecisionSet);
    },
  ];
  for (const mutate of mutations) {
    const fixture = structuredClone(base);
    mutate(fixture);
    assert.throws(
      () =>
        validateG17FinalDecisionBinding({
          ...fixture,
          qualificationStartedAt: QUALIFICATION_STARTED_AT,
          g14bPrerequisiteProjection: fixture.prerequisite,
        }),
      /must be approved before control start|completion must precede final approval/u,
    );
  }
  assert.throws(
    () =>
      validateG17FinalDecisionBinding({
        ...base,
        qualificationStartedAt: FINAL_APPROVED_AT,
        g14bPrerequisiteProjection: base.prerequisite,
      }),
    /final approval must precede qualification start/u,
  );
});

test("partial approval and post-result tuning fail closed", () => {
  const current = loadG17ControlProtocol({
    contract: loadG17Contract().contract,
  });
  const mixedAuthorization = structuredClone(current.authorization);
  mixedAuthorization.status = "CONTROL_AUTHORIZED";
  rehash(mixedAuthorization);
  assert.throws(
    () => validateG17ControlAuthorization(mixedAuthorization),
    /lacks one named approver/u,
  );

  const mixedFinal = structuredClone(current.finalDecisionSet);
  mixedFinal.status = "APPROVED";
  rehash(mixedFinal);
  assert.throws(
    () => validateG17FinalDecisionSet(mixedFinal),
    /lacks one named approver/u,
  );

  const prematureEvidence = structuredClone(current.finalDecisionSet);
  prematureEvidence.controlReceipt = {};
  rehash(prematureEvidence);
  assert.throws(
    () => validateG17FinalDecisionSet(prematureEvidence),
    /post-control evidence/u,
  );

  const tunedAuthorization = structuredClone(current.authorization);
  tunedAuthorization.protocol.thresholds.aaEquivalenceBasisPoints = 501;
  rehash(tunedAuthorization);
  assert.throws(
    () => validateG17ControlAuthorization(tunedAuthorization),
    /frozen policy drifted/u,
  );

  const tunedFinal = structuredClone(current.finalDecisionSet);
  tunedFinal.protocol.qualification.maximumSlowdownBasisPoints = 1_001;
  rehash(tunedFinal);
  assert.throws(
    () => validateG17FinalDecisionSet(tunedFinal),
    /pre-control policy drifted/u,
  );
});

test("unknown fields and authority injection fail even with recomputed self-hashes", () => {
  const current = loadG17ControlProtocol({
    contract: loadG17Contract().contract,
  });
  const unknown = structuredClone(current.authorization);
  unknown.execute = true;
  rehash(unknown);
  assert.throws(
    () => validateG17ControlAuthorization(unknown),
    /fields are not exact/u,
  );

  const controlAuthority = structuredClone(current.authorization);
  controlAuthority.protocol.authorizationScope.promotionAuthority = true;
  rehash(controlAuthority);
  assert.throws(
    () => validateG17ControlAuthorization(controlAuthority),
    /frozen policy drifted/u,
  );

  const finalAuthority = structuredClone(current.finalDecisionSet);
  finalAuthority.protocol.authorizationScope.publicationAuthority = true;
  rehash(finalAuthority);
  assert.throws(
    () => validateG17FinalDecisionSet(finalAuthority),
    /pre-control policy drifted/u,
  );

  const envelopeDrift = structuredClone(current.authorization);
  envelopeDrift.protocol.ownerPolicy.controlEnvelope.maxAggregateBytes -= 1;
  rehash(envelopeDrift);
  assert.throws(
    () => validateG17ControlAuthorization(envelopeDrift),
    /frozen policy drifted/u,
  );
});

test("signature and control-receipt mismatches fail closed", () => {
  const fixture = authorizedFixture();
  const mismatchedRun = structuredClone(fixture);
  mismatchedRun.finalDecisionSet.controlReceipt.runId = "another-control-run";
  rehash(mismatchedRun.finalDecisionSet);
  assert.throws(
    () =>
      validateG17FinalDecisionBinding({
        ...mismatchedRun,
        qualificationStartedAt: QUALIFICATION_STARTED_AT,
        g14bPrerequisiteProjection: mismatchedRun.prerequisite,
      }),
    /signature does not match/u,
  );

  const mismatchedSignatureHash = structuredClone(fixture);
  mismatchedSignatureHash.finalDecisionSet.controlReceipt.negativeControlSignatureContentHash =
    "f".repeat(64);
  rehash(mismatchedSignatureHash.finalDecisionSet);
  assert.throws(
    () =>
      validateG17FinalDecisionBinding({
        ...mismatchedSignatureHash,
        qualificationStartedAt: QUALIFICATION_STARTED_AT,
        g14bPrerequisiteProjection: mismatchedSignatureHash.prerequisite,
      }),
    /signature does not match/u,
  );

  const invalidSignature = structuredClone(fixture.signature);
  invalidSignature.budgetBreaches = [];
  rehash(invalidSignature);
  assert.throws(
    () => validateG17NegativeControlSignature(invalidSignature),
    /signature is invalid/u,
  );
});

test("current run gates execute before owners and create no receipts", async () => {
  await assert.rejects(
    runG17Controls({
      clock: () => new Date(CONTROL_STARTED_AT),
    }),
    (error) => {
      assert.ok(error instanceof G17ControlAuthorizationGateError);
      assert.equal(error.code, "G17_CONTROL_AUTHORIZATION_UNAPPROVED");
      assert.equal(error.result.phase, "CONTROL_AUTH_PROPOSED");
      return true;
    },
  );
  await assert.rejects(
    runG17Qualification({
      clock: () => new Date(QUALIFICATION_STARTED_AT),
    }),
    (error) => {
      assert.ok(error instanceof G17QualificationDecisionGateError);
      assert.equal(error.code, "G17_DECISIONS_UNAPPROVED");
      assert.equal(error.result.phase, "CONTROL_AUTH_PROPOSED");
      return true;
    },
  );

  const fixture = authorizedFixture();
  const proposed = loadG17ControlProtocol({
    contract: loadG17Contract().contract,
  });
  for (const [authorization, finalDecisionSet, phase] of [
    [proposed.authorization, fixture.finalDecisionSet, "CONTROL_AUTH_PROPOSED"],
    [fixture.authorization, proposed.finalDecisionSet, "CONTROL_AUTHORIZED"],
  ]) {
    await assert.rejects(
      runG17Qualification({
        contractLoader: () => loadG17Contract(),
        protocolLoader: () => ({ authorization, finalDecisionSet }),
        clock: () => new Date(QUALIFICATION_STARTED_AT),
      }),
      (error) => {
        assert.ok(error instanceof G17QualificationDecisionGateError);
        assert.equal(error.result.phase, phase);
        assert.ok(error.result.final.reasons.includes("reference-proposed"));
        return true;
      },
    );
  }

  await assert.rejects(
    runG17Controls({
      contractLoader: () => loadG17Contract(),
      protocolLoader: () => ({
        authorization: fixture.authorization,
        finalDecisionSet: fixture.finalDecisionSet,
        artifacts: {
          authorization: {
            rawSha256: fixture.authorizationRawSha256,
            byteLength: 1,
          },
        },
      }),
      clock: () => new Date(CONTROL_STARTED_AT),
    }),
    (error) => {
      assert.ok(error instanceof G17ControlExecutionUnavailableError);
      assert.equal(error.code, "G17_CONTROL_EXECUTION_OWNER_UNIMPLEMENTED");
      return true;
    },
  );
});

test("qualification runner rejects cross-bound approved artifacts before owner reachability", async () => {
  const fixture = authorizedFixture();
  const mismatched = structuredClone(fixture.finalDecisionSet);
  mismatched.controlAuthorization.contentHash = "e".repeat(64);
  rehash(mismatched);
  await assert.rejects(
    runG17Qualification({
      contractLoader: () => loadG17Contract(),
      protocolLoader: () => ({
        authorization: fixture.authorization,
        finalDecisionSet: mismatched,
        artifacts: {
          authorization: {
            rawSha256: fixture.authorizationRawSha256,
            byteLength: 1,
          },
          finalDecisionSet: { rawSha256: rawSha256(mismatched), byteLength: 1 },
        },
      }),
      clock: () => new Date(QUALIFICATION_STARTED_AT),
    }),
    (error) => {
      assert.notEqual(error.code, "G17_EXECUTION_OWNER_UNIMPLEMENTED");
      assert.match(
        error.message,
        /does not bind the authorized control policy/u,
      );
      return true;
    },
  );
});
