import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  decodeReviewedG17V4Contract,
} from "./contract-identity.mjs";
import {
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_INSTANCE_SCHEMA,
  G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
  verifyG17NativeIsolationInstanceArtifact,
  verifyG17NativeIsolationPolicyArtifact,
  verifyG17NativePlatformBundle,
} from "./native-platform-contract.mjs";
import {
  G17_NATIVE_SESSION_ARTIFACT_NAME,
  G17_NATIVE_SESSION_MAX_BYTES,
  G17_NATIVE_SESSION_PROJECTION_SCHEMA,
  createG17NativeSessionConfiguration,
  verifyG17NativeSessionArtifact,
} from "./native-session-contract.mjs";
import {
  G17_NATIVE_WORKSPACE_ARTIFACT_NAME,
  G17_NATIVE_WORKSPACE_OWNER_MAX_BYTES,
  G17_NATIVE_WORKSPACE_OWNER_SCHEMA,
  G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA,
  verifyG17NativeWorkspaceOwnerArtifact,
} from "./native-workspace-contract.mjs";

export const G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA =
  "oxigraph.g1.7-native-compatibility-projection/v2";

export const G17_NATIVE_APPLICATION_ARTIFACT_NAMES = Object.freeze([
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_WORKSPACE_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NATIVE_SESSION_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
]);

const REPLAY_BOUNDARY = "sealed-seven-artifact-pure-replay/v1";
const IDENTITY_SCHEMA = "oxigraph.g1.7-qualified-subject-identity/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const artifactByteCeilings = Object.freeze(new Map([
  [G17_NATIVE_PLATFORM_ARTIFACT_NAME, 64 * 1024 * 1024],
  [G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME, 4 * 1024 * 1024],
  [G17_NATIVE_CONTROLLER_ARTIFACT_NAME, 64 * 1024 * 1024],
  [G17_NATIVE_WORKSPACE_ARTIFACT_NAME, G17_NATIVE_WORKSPACE_OWNER_MAX_BYTES],
  [G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME, 1024 * 1024],
  [G17_NATIVE_SESSION_ARTIFACT_NAME, G17_NATIVE_SESSION_MAX_BYTES],
  [G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME, 16 * 1024 * 1024],
]));

const productionDependencies = Object.freeze({
  verifyPlatformBundle: verifyG17NativePlatformBundle,
  verifyWorkspaceOwnerArtifact: verifyG17NativeWorkspaceOwnerArtifact,
  verifyPolicyArtifact: verifyG17NativeIsolationPolicyArtifact,
  createSessionConfiguration: createG17NativeSessionConfiguration,
  verifySessionArtifact: verifyG17NativeSessionArtifact,
  verifyInstanceArtifact: verifyG17NativeIsolationInstanceArtifact,
});

function fail(message) {
  throw new Error(`G1.7 native application contract: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Buffer.isBuffer(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function canonicalClone(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (error) {
    fail(`${label} is not canonical JSON data: ${error.message}`);
  }
}

function boundedString(value, label, maximumBytes = 1024 * 1024) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\0")
  ) {
    fail(`${label} is not bounded text`);
  }
  return value;
}

function canonicalAbsolutePath(value, label) {
  const path = boundedString(value, label, 4_096);
  if (!isAbsolute(path) || resolve(path) !== path) {
    fail(`${label} is not a canonical absolute path`);
  }
  return path;
}

function validateIdentity(identity) {
  exactKeys(
    identity,
    [
      "schema",
      "subject",
      "control",
      "evaluator",
      "cargoLock",
      "toolchain",
      "host",
      "identitySha256",
    ],
    "sealed identity",
  );
  exactKeys(identity.subject, ["commit", "tree", "trackedClean"], "sealed subject");
  exactKeys(
    identity.control,
    [
      "controlCommit",
      "harnessTree",
      "harnessManifestSha256",
      "manifestSha256",
      "lockfileSha256",
      "npmrcSha256",
      "dependencies",
      "harnessSha256",
    ],
    "sealed control",
  );
  exactKeys(
    identity.evaluator,
    ["commit", "parent", "tree", "patchSha256", "blobSetSha256"],
    "sealed evaluator",
  );
  exactKeys(identity.cargoLock, ["blob", "sha256"], "sealed Cargo.lock");
  exactKeys(
    identity.host,
    [
      "platform",
      "kernelRelease",
      "architecture",
      "targetTriple",
      "cpuModel",
      "cpuCount",
      "totalMemoryBytes",
    ],
    "sealed host",
  );
  if (
    identity.schema !== IDENTITY_SCHEMA ||
    identity.subject.trackedClean !== true ||
    !GIT_OBJECT.test(identity.subject.commit ?? "") ||
    !GIT_OBJECT.test(identity.subject.tree ?? "") ||
    identity.control.controlCommit !== identity.subject.commit ||
    !GIT_OBJECT.test(identity.control.controlCommit ?? "") ||
    !GIT_OBJECT.test(identity.control.harnessTree ?? "") ||
    ![
      identity.control.harnessManifestSha256,
      identity.control.manifestSha256,
      identity.control.lockfileSha256,
      identity.control.npmrcSha256,
      identity.control.harnessSha256,
      identity.evaluator.patchSha256,
      identity.evaluator.blobSetSha256,
      identity.cargoLock.sha256,
      identity.identitySha256,
    ].every((value) => DIGEST.test(value ?? "")) ||
    !GIT_OBJECT.test(identity.evaluator.commit ?? "") ||
    !GIT_OBJECT.test(identity.evaluator.parent ?? "") ||
    !GIT_OBJECT.test(identity.evaluator.tree ?? "") ||
    !GIT_OBJECT.test(identity.cargoLock.blob ?? "") ||
    !DIGEST.test(identity.cargoLock.sha256 ?? "")
  ) {
    fail("sealed subject, control, evaluator, or Cargo.lock binding is invalid");
  }
  if (
    !Array.isArray(identity.control.dependencies) ||
    identity.control.dependencies.length < 1 ||
    identity.control.dependencies.length > 64
  ) {
    fail("sealed dependency inventory is not bounded");
  }
  let previousDependencyName = null;
  for (const dependency of identity.control.dependencies) {
    exactKeys(
      dependency,
      ["name", "policy", "version", "resolved", "integrity", "installedPackageJsonSha256"],
      `sealed dependency ${dependency?.name ?? "unknown"}`,
    );
    for (const key of ["name", "version", "resolved", "integrity"]) {
      boundedString(dependency[key], `sealed dependency ${key}`, 4_096);
    }
    if (
      dependency.policy !== "latest" ||
      !DIGEST.test(dependency.installedPackageJsonSha256 ?? "") ||
      (previousDependencyName !== null && dependency.name <= previousDependencyName)
    ) {
      fail(`sealed dependency ${dependency.name} binding is invalid`);
    }
    previousDependencyName = dependency.name;
  }
  const { harnessSha256: ignoredHarnessSha256, ...controlBinding } = identity.control;
  if (
    identity.control.harnessSha256 !== canonicalSha256({
      schema: "oxigraph.committed-harness-identity/v1",
      ...controlBinding,
    })
  ) {
    fail("sealed control digest does not replay");
  }
  if (
    !Array.isArray(identity.toolchain) ||
    identity.toolchain.length !== 2 ||
    !isDeepStrictEqual(identity.toolchain.map(({ program }) => program), ["cargo", "rustc"])
  ) {
    fail("sealed identity toolchain inventory is not exact");
  }
  const tools = {};
  for (const tool of identity.toolchain) {
    exactKeys(
      tool,
      [
        "program",
        "invokedPath",
        "path",
        "executableSha256",
        "toolchainPath",
        "toolchainExecutableSha256",
        "versionStdout",
      ],
      `sealed ${tool?.program ?? "unknown"} tool`,
    );
    for (const key of ["invokedPath", "path", "toolchainPath"]) {
      canonicalAbsolutePath(tool[key], `sealed ${tool.program} ${key}`);
    }
    if (
      !DIGEST.test(tool.executableSha256 ?? "") ||
      !DIGEST.test(tool.toolchainExecutableSha256 ?? "") ||
      boundedString(
        tool.versionStdout,
        `sealed ${tool.program} version output`,
      ).trim() !== tool.versionStdout
    ) {
      fail(`sealed ${tool.program} tool binding is invalid`);
    }
    tools[tool.program] = tool;
  }
  for (const key of ["platform", "kernelRelease", "architecture", "targetTriple", "cpuModel"]) {
    boundedString(identity.host[key], `sealed host ${key}`, 4_096);
  }
  if (
    !Number.isSafeInteger(identity.host.cpuCount) ||
    identity.host.cpuCount < 1 ||
    !Number.isSafeInteger(identity.host.totalMemoryBytes) ||
    identity.host.totalMemoryBytes < 1
  ) {
    fail("sealed host capacity is invalid");
  }
  const { identitySha256, ...binding } = identity;
  if (identitySha256 !== canonicalSha256(binding)) {
    fail("sealed identity digest does not replay");
  }
  return tools;
}

function streamBytes(stream, label) {
  exactKeys(stream, ["bytes", "sha256", "base64"], label);
  if (
    !Number.isSafeInteger(stream.bytes) ||
    stream.bytes < 0 ||
    stream.bytes > 65_536 ||
    !DIGEST.test(stream.sha256 ?? "") ||
    typeof stream.base64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      stream.base64,
    )
  ) {
    fail(`${label} is not a bounded canonical stream`);
  }
  const bytes = Buffer.from(stream.base64, "base64");
  if (
    bytes.toString("base64") !== stream.base64 ||
    bytes.length !== stream.bytes ||
    sha256(bytes) !== stream.sha256
  ) {
    fail(`${label} bytes differ from their digest`);
  }
  return bytes;
}

function reviewedEvaluator(contractBytes, contractSha256) {
  const contract = decodeReviewedG17V4Contract({
    contractBytes,
    contractSha256,
  });
  const evaluator = contract?.evaluator;
  exactKeys(
    evaluator,
    ["commit", "parent", "tree", "paths", "patchSha256"],
    "reviewed evaluator",
  );
  if (
    !GIT_OBJECT.test(evaluator.commit ?? "") ||
    !GIT_OBJECT.test(evaluator.parent ?? "") ||
    !GIT_OBJECT.test(evaluator.tree ?? "") ||
    !DIGEST.test(evaluator.patchSha256 ?? "") ||
    !Array.isArray(evaluator.paths) ||
    evaluator.paths.length < 1 ||
    evaluator.paths.length > 64
  ) {
    fail("reviewed evaluator binding is invalid");
  }
  const paths = evaluator.paths.map((entry, index) => {
    exactKeys(
      entry,
      ["path", "changeStatus", "blob", "contentSha256"],
      `reviewed evaluator path ${index}`,
    );
    if (
      !["A", "M"].includes(entry.changeStatus) ||
      !GIT_OBJECT.test(entry.blob ?? "") ||
      !DIGEST.test(entry.contentSha256 ?? "")
    ) {
      fail(`reviewed evaluator path ${index} binding is invalid`);
    }
    return {
      path: boundedString(entry.path, `reviewed evaluator path ${index}`, 4_096),
      blob: entry.blob,
      contentSha256: entry.contentSha256,
    };
  });
  return Object.freeze({
    commit: evaluator.commit,
    parent: evaluator.parent,
    tree: evaluator.tree,
    patchSha256: evaluator.patchSha256,
    blobSetSha256: canonicalSha256(paths),
  });
}

function deriveWorkspaceExpected(identity, tools, platform) {
  if (
    platform.subjectIdentitySha256 !== identity.identitySha256 ||
    !DIGEST.test(platform.manifestSha256 ?? "") ||
    !DIGEST.test(platform.toolchainRootSha256 ?? "")
  ) {
    fail("verified platform generation differs from the sealed identity");
  }
  const expectedTools = {};
  for (const [program, probeId] of [
    ["cargo", "cargo-version"],
    ["rustc", "rust-version"],
  ]) {
    const tool = tools[program];
    const role = platform.roles?.[program];
    const logicalPath = `/toolchain/bin/${program}`;
    if (
      role?.root !== "toolchain" ||
      role.path !== `bin/${program}` ||
      role.kind !== "file" ||
      role.sha256 !== tool.toolchainExecutableSha256
    ) {
      fail(`verified platform ${program} role differs from the sealed identity`);
    }
    const probes = (platform.probes ?? []).filter(({ id }) => id === probeId);
    if (probes.length !== 1 || probes[0].program !== logicalPath) {
      fail(`verified platform ${program} version probe is not exact`);
    }
    const stdout = streamBytes(probes[0].stdout, `${program} version stdout`);
    const stderr = streamBytes(probes[0].stderr, `${program} version stderr`);
    if (
      !stdout.equals(Buffer.from(`${tool.versionStdout}\n`, "utf8")) ||
      stderr.length !== 0
    ) {
      fail(`verified platform ${program} version differs from the sealed identity`);
    }
    expectedTools[program] = {
      executableSha256: tool.toolchainExecutableSha256,
      versionSha256: sha256(Buffer.from(tool.versionStdout, "utf8")),
    };
  }
  return {
    subjectIdentitySha256: identity.identitySha256,
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    cargoLockBlob: identity.cargoLock.blob,
    cargoLockSha256: identity.cargoLock.sha256,
    platformManifestSha256: platform.manifestSha256,
    toolchainRootSha256: platform.toolchainRootSha256,
    toolchain: expectedTools,
  };
}

function artifactInventory(artifacts) {
  const length = artifacts?.length;
  if (
    !Array.isArray(artifacts) ||
    length !== G17_NATIVE_APPLICATION_ARTIFACT_NAMES.length
  ) {
    fail("seven-artifact inventory is not exact");
  }
  const candidates = [];
  for (let index = 0; index < length; index += 1) {
    candidates.push(artifacts[index]);
  }
  return candidates.map((artifact, index) => {
    exactKeys(artifact, ["name", "bytes"], `application artifact ${index}`);
    const name = artifact.name;
    const suppliedBytes = artifact.bytes;
    const expectedName = G17_NATIVE_APPLICATION_ARTIFACT_NAMES[index];
    const ceiling = artifactByteCeilings.get(expectedName);
    if (
      name !== expectedName ||
      !Buffer.isBuffer(suppliedBytes) ||
      suppliedBytes.length < 1 ||
      suppliedBytes.length > ceiling
    ) {
      fail(`application artifact ${index} is not the exact ${expectedName}`);
    }
    const bytes = Buffer.from(suppliedBytes);
    return Object.freeze({
      name: expectedName,
      bytes,
      record: Object.freeze({
        name: expectedName,
        bytes: bytes.length,
        sha256: sha256(bytes),
      }),
    });
  });
}

function currentWorkspaceOwner(bytes) {
  let value;
  try {
    value = JSON.parse(utf8.decode(bytes));
  } catch (error) {
    fail(`workspace owner artifact is invalid JSON or UTF-8: ${error.message}`);
  }
  if (value?.schema !== G17_NATIVE_WORKSPACE_OWNER_SCHEMA) {
    fail("workspace owner is not the current v2 owner schema");
  }
}

function requestedLimits(sessionBytes) {
  let value;
  try {
    value = JSON.parse(utf8.decode(sessionBytes));
  } catch (error) {
    fail(`native session artifact is invalid JSON or UTF-8: ${error.message}`);
  }
  if (value?.configuration?.requestedLimits === undefined) {
    fail("native session artifact does not claim requested limits");
  }
  return value.configuration.requestedLimits;
}

function verifyWorkspaceReplay(replay, artifact) {
  if (
    replay?.projection?.schema !== G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA ||
    !DIGEST.test(replay.projection.sha256 ?? "") ||
    replay.artifact?.name !== artifact.name ||
    replay.artifact?.sha256 !== artifact.record.sha256 ||
    !Buffer.isBuffer(replay.artifact?.bytes) ||
    !replay.artifact.bytes.equals(artifact.bytes)
  ) {
    fail("workspace owner replay does not identify its supplied artifact");
  }
}

function verifyApplication(input, dependencies) {
  exactKeys(
    input,
    ["artifacts", "identity", "contractBytes", "contractSha256", "runId"],
    "native application verification input",
  );
  const suppliedArtifacts = input.artifacts;
  const suppliedIdentity = input.identity;
  const suppliedContractBytes = input.contractBytes;
  const contractSha256 = input.contractSha256;
  const runId = input.runId;
  if (
    !SAFE_RUN_ID.test(runId ?? "") ||
    !Buffer.isBuffer(suppliedContractBytes) ||
    suppliedContractBytes.length < 1 ||
    suppliedContractBytes.length > 1024 * 1024 ||
    !DIGEST.test(contractSha256 ?? "")
  ) {
    fail("run or sealed contract binding is invalid");
  }
  const contractBytes = Buffer.from(suppliedContractBytes);
  if (sha256(contractBytes) !== contractSha256) {
    fail("run or sealed contract binding is invalid");
  }
  const identity = canonicalClone(suppliedIdentity, "sealed identity");
  const tools = validateIdentity(identity);
  const evaluator = reviewedEvaluator(contractBytes, contractSha256);
  if (!isDeepStrictEqual(identity.evaluator, evaluator)) {
    fail("sealed evaluator differs from the reviewed contract");
  }
  const inventory = artifactInventory(suppliedArtifacts);
  const [platformArtifact, sourcePlanArtifact, controllerArtifact,
    workspaceArtifact, policyArtifact, sessionArtifact, instanceArtifact] = inventory;

  const platformReplay = dependencies.verifyPlatformBundle({
    platformBytes: platformArtifact.bytes,
    sourcePlanBytes: sourcePlanArtifact.bytes,
    controllerBytes: controllerArtifact.bytes,
  });
  const workspaceExpected = deriveWorkspaceExpected(
    identity,
    tools,
    platformReplay.platform,
  );
  currentWorkspaceOwner(workspaceArtifact.bytes);
  const workspaceReplay = dependencies.verifyWorkspaceOwnerArtifact({
    bytes: workspaceArtifact.bytes,
    expected: workspaceExpected,
  });
  verifyWorkspaceReplay(workspaceReplay, workspaceArtifact);

  const policy = dependencies.verifyPolicyArtifact(policyArtifact.bytes);
  const expectedConfiguration = dependencies.createSessionConfiguration({
    runId,
    contractBytes,
    contractSha256,
    platform: platformReplay.platform,
    policy,
    workspaceProjectionSha256: workspaceReplay.projection.sha256,
    requestedLimits: requestedLimits(sessionArtifact.bytes),
  });
  const sessionProjection = dependencies.verifySessionArtifact({
    bytes: sessionArtifact.bytes,
    expectedConfiguration,
    contractBytes,
    contractSha256,
  });
  if (
    sessionProjection?.schema !== G17_NATIVE_SESSION_PROJECTION_SCHEMA ||
    sessionProjection.status !== "PASS" ||
    sessionProjection.runId !== runId ||
    sessionProjection.bindings?.contractSha256 !== contractSha256 ||
    sessionProjection.bindings?.platformManifestSha256 !==
      platformReplay.platform.manifestSha256 ||
    sessionProjection.bindings?.policySha256 !== policy.sha256 ||
    sessionProjection.bindings?.workspaceProjectionSha256 !==
      workspaceReplay.projection.sha256 ||
    sessionProjection.artifact?.name !== sessionArtifact.name ||
    sessionProjection.artifact?.bytes !== sessionArtifact.record.bytes ||
    sessionProjection.artifact?.sha256 !== sessionArtifact.record.sha256
  ) {
    fail("native session replay is not a current PASS bound to the composite");
  }

  const instance = dependencies.verifyInstanceArtifact({
    bytes: instanceArtifact.bytes,
    policy,
    platform: platformReplay.platform,
    controllerBytes: controllerArtifact.bytes,
    workspaceProjectionSha256: workspaceReplay.projection.sha256,
    sessionBytes: sessionArtifact.bytes,
    contractBytes,
    contractSha256,
  });
  if (
    instance?.schema !== G17_NATIVE_ISOLATION_INSTANCE_SCHEMA ||
    instance.runId !== runId ||
    instance.policySha256 !== policy.sha256 ||
    instance.platformManifestSha256 !== platformReplay.platform.manifestSha256 ||
    instance.workspaceProjectionSha256 !== workspaceReplay.projection.sha256 ||
    instance.sessionProjectionSha256 !== canonicalSha256(sessionProjection) ||
    instance.sessionArtifact?.name !== sessionArtifact.name ||
    instance.sessionArtifact?.bytes !== sessionArtifact.record.bytes ||
    instance.sessionArtifact?.sha256 !== sessionArtifact.record.sha256 ||
    instance.sha256 !== canonicalSha256(
      Object.fromEntries(Object.entries(instance).filter(([key]) => key !== "sha256")),
    )
  ) {
    fail("isolation instance replay is not bound to the composite generation");
  }

  return deepFreeze(canonicalClone({
    schema: G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
    status: "PASS",
    replayBoundary: REPLAY_BOUNDARY,
    runId,
    subjectIdentitySha256: identity.identitySha256,
    contractSha256,
    artifacts: inventory.map(({ record }) => record),
    ownerArtifact: workspaceArtifact.record,
    platform: {
      schema: platformReplay.platform.schema,
      profile: platformReplay.platform.profile,
      manifestSha256: platformReplay.platform.manifestSha256,
      toolchainRootSha256: platformReplay.platform.toolchainRootSha256,
      platformRootSha256: platformReplay.platform.platformRootSha256,
      sourcePlanProjectionSha256: platformReplay.sourcePlanProjectionSha256,
      controllerSha256: controllerArtifact.record.sha256,
    },
    toolchain: workspaceReplay.projection.binding.toolchain,
    workspace: workspaceReplay.projection,
    policy: {
      schema: policy.schema,
      sha256: policy.sha256,
    },
    lanes: sessionProjection.lanes,
    totalPassedTests: sessionProjection.totalPassedTests,
    session: {
      schema: sessionProjection.schema,
      status: sessionProjection.status,
      bindings: sessionProjection.bindings,
      artifact: sessionProjection.artifact,
      commandsObserved: sessionProjection.commandsObserved,
      lanes: sessionProjection.lanes,
      totalPassedTests: sessionProjection.totalPassedTests,
      stateBytes: sessionProjection.stateBytes,
      durationMs: sessionProjection.durationMs,
      reason: sessionProjection.reason,
      finalDescendantsObserved: sessionProjection.finalDescendantsObserved,
    },
    isolation: {
      schema: instance.schema,
      sha256: instance.sha256,
      sessionProjectionSha256: instance.sessionProjectionSha256,
      effectiveObservations: instance.effectiveObservations,
    },
  }, "native compatibility projection"));
}

export function verifyG17NativeApplicationEvidence(input) {
  try {
    return verifyApplication(input, productionDependencies);
  } catch (error) {
    if (error?.message?.startsWith("G1.7 native application contract:")) throw error;
    fail(error?.message ?? String(error));
  }
}

export function createG17NativeApplicationVerifierForTesting(dependencies) {
  exactKeys(
    dependencies,
    [
      "verifyPlatformBundle",
      "verifyWorkspaceOwnerArtifact",
      "verifyPolicyArtifact",
      "createSessionConfiguration",
      "verifySessionArtifact",
      "verifyInstanceArtifact",
    ],
    "native application test dependencies",
  );
  if (Object.values(dependencies).some((dependency) => typeof dependency !== "function")) {
    fail("native application test dependencies must be functions");
  }
  const frozenDependencies = Object.freeze({ ...dependencies });
  return (input) => {
    try {
      return verifyApplication(input, frozenDependencies);
    } catch (error) {
      if (error?.message?.startsWith("G1.7 native application contract:")) throw error;
      fail(error?.message ?? String(error));
    }
  };
}
