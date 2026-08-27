import { createHash } from "node:crypto";
import { readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "../routing/features.mjs";
import {
  G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
  verifyG17NativeApplicationEvidence,
} from "./native-application-contract.mjs";
import {
  createG17NativeIsolationInstanceArtifact,
  createG17NativeIsolationPolicyArtifact,
} from "./native-platform-contract.mjs";
import {
  G17NativePlatformFault,
  acquireG17NativePlatform,
  destroyG17NativePlatform,
  verifyG17NativePlatform,
} from "./native-platform.mjs";
import { runQualificationSandboxSession } from "./contained-session.mjs";
import {
  G17NativeWorkspaceFault,
  createG17NativeWorkspace,
  destroyG17NativeWorkspace,
  g17NativeWorkspaceOwnerArtifact,
  g17NativeWorkspaceProjection,
  verifyG17NativeWorkspace,
} from "./native-workspace.mjs";

const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const NAMESPACE_PATHS = Object.freeze({
  user: "user",
  mount: "mnt",
  network: "net",
  pid: "pid",
  ipc: "ipc",
  uts: "uts",
});

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

function exactKeys(value, required, optional, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`G1.7 native application ${label} must be a plain object`);
  }
  const observed = Object.keys(value).sort();
  const requiredSorted = [...required].sort();
  const admitted = new Set([...required, ...optional]);
  if (
    requiredSorted.some((key) => !Object.hasOwn(value, key)) ||
    observed.some((key) => !admitted.has(key))
  ) {
    throw new Error(`G1.7 native application ${label} fields are not exact`);
  }
}

function immutableArtifact(value, expectedName) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.name !== expectedName ||
    !Buffer.isBuffer(value.bytes) ||
    value.bytes.length < 1
  ) {
    throw new Error(`G1.7 native application ${expectedName} is unavailable`);
  }
  const stored = Buffer.from(value.bytes);
  const artifact = {};
  Object.defineProperties(artifact, {
    name: { value: expectedName, enumerable: true },
    bytes: {
      enumerable: true,
      get() {
        return Buffer.from(stored);
      },
    },
  });
  return Object.freeze(artifact);
}

function artifactSet({ platform, workspaceOwner, policy, session, instance }) {
  const candidates = [
    platform.artifact,
    platform.sourcePlan,
    platform.controllerAttestation,
    workspaceOwner.artifact,
    policy.artifact,
    session.artifact,
    instance.artifact,
  ];
  return Object.freeze(candidates.map((artifact, index) =>
    immutableArtifact(artifact, G17_NATIVE_APPLICATION_ARTIFACT_NAMES[index])));
}

async function readControllerNamespaces() {
  const entries = await Promise.all(
    Object.entries(NAMESPACE_PATHS).map(async ([key, namespace]) => [
      key,
      await readlink(`/proc/self/ns/${namespace}`),
    ]),
  );
  return Object.freeze(Object.fromEntries(entries));
}

function nativeRequestedLimits(contract) {
  const value = contract?.compatibility?.nativeSession;
  const requested = {
    totalWallMs: value?.maxTotalWallMs,
    residentBytes: value?.maxResidentBytes,
    diskBytes: value?.maxDiskBytes,
    cargoBuildJobs: value?.cargoBuildJobs,
    tasksMax: value?.tasksMax,
    memorySwapBytes: value?.memorySwapMaxBytes,
  };
  if (
    Object.values(requested).some(
      (item) => !Number.isSafeInteger(item) || item < 0,
    ) ||
    requested.totalWallMs < 1 ||
    requested.residentBytes < 1 ||
    requested.diskBytes < 1 ||
    requested.cargoBuildJobs < 1 ||
    requested.tasksMax < 1
  ) {
    throw new Error("G1.7 native application session limits are invalid");
  }
  return Object.freeze(requested);
}

function cargoProgram(identity) {
  const matches = (identity?.toolchain ?? []).filter(
    (tool) => tool?.program === "cargo",
  );
  if (
    matches.length !== 1 ||
    typeof matches[0].toolchainPath !== "string" ||
    !DIGEST.test(matches[0].toolchainExecutableSha256 ?? "")
  ) {
    throw new Error("G1.7 native application sealed Cargo tool is invalid");
  }
  return matches[0].toolchainPath;
}

function failureClassification(error, cleanupFailed) {
  if (cleanupFailed) return "FAIL";
  if (
    (error instanceof G17NativePlatformFault ||
      error instanceof G17NativeWorkspaceFault) &&
    ["FAIL", "MISSING", "STALE"].includes(error.classification)
  ) {
    return error.classification;
  }
  return "MISSING";
}

function failureReason(error, cleanupFailed) {
  if (cleanupFailed) return "native-cleanup-unconfirmed";
  if (error instanceof G17NativePlatformFault) {
    return `native-platform-${error.phase}-${error.classification}`.toLowerCase();
  }
  if (error instanceof G17NativeWorkspaceFault) {
    return `native-workspace-${error.phase}-${error.classification}`.toLowerCase();
  }
  return "native-application-infrastructure";
}

function verificationFailure(results) {
  const rank = { MISSING: 1, STALE: 2, FAIL: 3 };
  let selected;
  let selectedRank = 0;
  for (const result of results) {
    if (result.status !== "rejected") continue;
    const error = result.reason;
    const classification =
      error instanceof G17NativePlatformFault ||
      error instanceof G17NativeWorkspaceFault
        ? error.classification
        : "MISSING";
    const currentRank = rank[classification] ?? rank.MISSING;
    if (selected === undefined || currentRank > selectedRank) {
      selected = error;
      selectedRank = currentRank;
    }
  }
  return selected;
}

function incompleteResult({ status, reason, runId, identity, sessionProjection = null }) {
  const projection = deepFreeze({
    schema: G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
    status,
    replayBoundary: "no-current-seven-artifact-pass/v1",
    runId,
    subjectIdentitySha256:
      DIGEST.test(identity?.identitySha256 ?? "") ? identity.identitySha256 : null,
    artifacts: Object.freeze([]),
    ownerArtifact: null,
    lanes: Object.freeze([...(sessionProjection?.lanes ?? [])]),
    totalPassedTests: sessionProjection?.totalPassedTests ?? 0,
    reason,
  });
  return Object.freeze({
    status,
    projection,
    sha256: canonicalSha256(projection),
    artifacts: Object.freeze([]),
    reasons: Object.freeze([reason]),
  });
}

const productionDependencies = Object.freeze({
  temporaryParent: tmpdir,
  acquirePlatform: acquireG17NativePlatform,
  verifyPlatform: verifyG17NativePlatform,
  destroyPlatform: destroyG17NativePlatform,
  createWorkspace: createG17NativeWorkspace,
  workspaceProjection: g17NativeWorkspaceProjection,
  verifyWorkspace: verifyG17NativeWorkspace,
  workspaceOwnerArtifact: g17NativeWorkspaceOwnerArtifact,
  destroyWorkspace: destroyG17NativeWorkspace,
  createPolicyArtifact: createG17NativeIsolationPolicyArtifact,
  runSession: runQualificationSandboxSession,
  createInstanceArtifact: createG17NativeIsolationInstanceArtifact,
  verifyApplication: verifyG17NativeApplicationEvidence,
  readControllerNamespaces,
});

async function runNativeApplication(input, dependencies) {
  exactKeys(
    input,
    ["contract", "contractBytes", "contractSha256", "identity", "runId", "repoRoot"],
    ["signal"],
    "input",
  );
  if (
    !SAFE_RUN_ID.test(input.runId ?? "") ||
    !Buffer.isBuffer(input.contractBytes) ||
    input.contractBytes.length < 1 ||
    input.contractBytes.length > 1024 * 1024 ||
    !DIGEST.test(input.contractSha256 ?? "") ||
    sha256(input.contractBytes) !== input.contractSha256 ||
    typeof input.repoRoot !== "string" ||
    (input.signal !== undefined && !(input.signal instanceof AbortSignal))
  ) {
    throw new Error("G1.7 native application input binding is invalid");
  }

  let platform;
  let workspace;
  let candidate;
  let failure;
  const cleanupErrors = [];
  let sessionProjection = null;
  try {
    platform = await dependencies.acquirePlatform({
      runId: input.runId,
      temporaryParent: dependencies.temporaryParent(),
      identity: input.identity,
      signal: input.signal,
    });
    workspace = await dependencies.createWorkspace({
      runId: input.runId,
      repoRoot: input.repoRoot,
      identity: input.identity,
      cargoProgram: cargoProgram(input.identity),
      platform,
      signal: input.signal,
    });
    const workspaceProjection = dependencies.workspaceProjection(workspace);
    const policy = dependencies.createPolicyArtifact();
    const before = await dependencies.readControllerNamespaces();
    const session = await dependencies.runSession({
      runId: input.runId,
      contractBytes: input.contractBytes,
      contractSha256: input.contractSha256,
      platform: platform.closure,
      policy: policy.policy,
      workspaceProjectionSha256: workspaceProjection.sha256,
      requestedLimits: nativeRequestedLimits(input.contract),
      sourceDirectory: workspace.sourceDirectory,
      cargoHomeDirectory: workspace.cargoHomeDirectory,
      toolchainDirectory: platform.toolchainDirectory,
      platformDirectory: platform.platformDirectory,
      signal: input.signal,
    });
    const after = await dependencies.readControllerNamespaces();
    sessionProjection = session.projection;
    if (session.projection.status !== "PASS") {
      const status = session.projection.status === "FAIL" ? "FAIL" : "MISSING";
      candidate = incompleteResult({
        status,
        reason: `native-session-${session.projection.status.toLowerCase()}`,
        runId: input.runId,
        identity: input.identity,
        sessionProjection: session.projection,
      });
    } else {
      const verificationResults = await Promise.allSettled([
        Promise.resolve().then(() =>
          dependencies.verifyWorkspace(workspace, "after-native")),
        Promise.resolve().then(() =>
          dependencies.verifyPlatform(platform, "after-native")),
      ]);
      const postSessionFailure = verificationFailure(verificationResults);
      if (postSessionFailure !== undefined) throw postSessionFailure;
      const workspaceVerification = verificationResults[0].value;
      const workspaceOwner = dependencies.workspaceOwnerArtifact(
        workspace,
        workspaceVerification,
      );
      const controllerNamespaces = Object.freeze({ before, after });
      const instance = dependencies.createInstanceArtifact({
        runId: input.runId,
        policy: policy.policy,
        platform: platform.closure,
        controllerBytes: platform.controllerAttestation.bytes,
        workspaceProjectionSha256: workspaceProjection.sha256,
        controllerNamespaces,
        sessionBytes: session.artifact.bytes,
        contractBytes: input.contractBytes,
        contractSha256: input.contractSha256,
      });
      const artifacts = artifactSet({
        platform,
        workspaceOwner,
        policy,
        session,
        instance,
      });
      const projection = dependencies.verifyApplication({
        artifacts,
        identity: input.identity,
        contractBytes: input.contractBytes,
        contractSha256: input.contractSha256,
        runId: input.runId,
      });
      if (
        projection.status !== "PASS" ||
        projection.schema !== G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA ||
        !isDeepStrictEqual(
          projection.artifacts.map(({ name }) => name),
          G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
        )
      ) {
        throw new Error("G1.7 native application pure replay did not return current PASS");
      }
      candidate = Object.freeze({
        status: "PASS",
        projection,
        sha256: canonicalSha256(projection),
        artifacts,
        reasons: Object.freeze([]),
      });
    }
  } catch (error) {
    failure = error;
  } finally {
    if (workspace !== undefined) {
      try {
        await dependencies.destroyWorkspace(workspace);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (platform !== undefined) {
      try {
        await dependencies.destroyPlatform(platform);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  if (failure !== undefined || cleanupErrors.length > 0) {
    return incompleteResult({
      status: failureClassification(failure, cleanupErrors.length > 0),
      reason: failureReason(failure, cleanupErrors.length > 0),
      runId: input.runId,
      identity: input.identity,
      sessionProjection,
    });
  }
  if (candidate === undefined) {
    throw new Error("G1.7 native application produced no bounded result");
  }
  return candidate;
}

export function runG17NativeApplication(input) {
  return runNativeApplication(input, productionDependencies);
}

export function createG17NativeApplicationForTesting(dependencies) {
  exactKeys(
    dependencies,
    [
      "temporaryParent",
      "acquirePlatform",
      "verifyPlatform",
      "destroyPlatform",
      "createWorkspace",
      "workspaceProjection",
      "verifyWorkspace",
      "workspaceOwnerArtifact",
      "destroyWorkspace",
      "createPolicyArtifact",
      "runSession",
      "createInstanceArtifact",
      "verifyApplication",
      "readControllerNamespaces",
    ],
    [],
    "test dependencies",
  );
  if (Object.values(dependencies).some((dependency) => typeof dependency !== "function")) {
    throw new Error("G1.7 native application test dependencies must be functions");
  }
  const frozen = Object.freeze({ ...dependencies });
  return (input) => runNativeApplication(input, frozen);
}
