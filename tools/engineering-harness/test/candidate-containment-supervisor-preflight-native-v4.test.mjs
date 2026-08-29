import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { runCandidateContainmentSupervisorPreflightNativeV4 } from "./support/candidate-containment-supervisor-preflight-native-v4-fixture.mjs";

const nativeTest =
  process.platform === "linux" && process.arch === "x64" ? test : test.skip;

nativeTest(
  "native preflight executes the exact cancel-only protocol without minting authority",
  { timeout: 30_000 },
  async () => {
    const result = await runCandidateContainmentSupervisorPreflightNativeV4();

    assert.equal(result.process.exitCode, 124);
    assert.equal(result.process.signal, null);
    assert.equal(result.process.reaped, true);
    assert.equal(result.process.timedOut, false);
    assert.equal(result.process.cleanupTimedOut, false);
    assert.equal(result.process.exitEventCount, 1);
    assert.equal(result.process.closeEventCount, 1);
    assert.equal(result.process.childrenAtReady.length, 0);
    assert.equal(result.process.parentPidAtReady, process.pid);
    assert.match(result.process.startTimeTicksAtReady, /^[1-9][0-9]*$/u);
    assert.equal(result.process.liveExecutableMatched, true);
    assert.equal(
      result.process.liveExecutableIdentitySha256,
      result.process.heldExecutableIdentitySha256,
    );
    assert.equal(
      result.process.intendedExecutableIdentitySha256,
      result.process.heldExecutableIdentitySha256,
    );
    assert.equal(
      result.process.executableBytesSha256,
      result.heldExecutableIdentityAtReady.sha256,
    );
    assert.match(result.process.postReap.status, /^(?:absent|pid-reused)$/u);

    assert.deepEqual(
      result.descriptorsBeforePreflight.map(({ fd }) => fd),
      Array.from({ length: 20 }, (_, fd) => fd),
    );
    assert.deepEqual(result.descriptorsAbove19BeforePreflight, []);
    assert.equal(
      result.executableDescriptorBeforePreflight.device,
      result.heldExecutableIdentityAtReady.device,
    );
    assert.equal(
      result.executableDescriptorBeforePreflight.inode,
      result.heldExecutableIdentityAtReady.inode,
    );
    assert.equal(
      result.sentinelDescriptorBeforePreflight.target,
      result.sentinelPath,
    );

    assert.deepEqual(
      result.descriptorsAtReady.map(({ fd }) => fd),
      Array.from({ length: 18 }, (_, fd) => fd),
    );
    assert.equal(
      result.descriptorsAtReady.every(({ closeOnExec }) => !closeOnExec),
      true,
    );
    assert.equal(
      result.descriptorsAtReady.every(({ pairwiseUnique }) => pairwiseUnique),
      true,
    );
    assert.deepEqual(result.descriptorsAbove17AtReady, []);
    assert.deepEqual(
      result.descriptorsAtReady.map(({ kind, accessMode }) => ({
        kind,
        accessMode,
      })),
      [
        { kind: "fifo", accessMode: 0 },
        { kind: "fifo", accessMode: 1 },
        { kind: "fifo", accessMode: 1 },
        { kind: "directory", accessMode: 0 },
        ...Array.from({ length: 13 }, () => ({
          kind: "regular",
          accessMode: 0,
        })),
        { kind: "regular", accessMode: 2 },
      ],
    );
    assert.equal(result.directoryIsCgroup2, false);

    assert.deepEqual(result.readyBytes, result.expected.readyBytes);
    assert.deepEqual(result.cancelledBytes, result.expected.cancelledBytes);
    assert.deepEqual(result.doneBytes, result.expected.doneBytes);
    assert.equal(result.statusEofObserved, true);
    assert.equal(result.statusEofCount, 1);
    assert.deepEqual(
      result.commandBytes,
      Buffer.concat([
        result.expected.startBytes,
        result.expected.capsuleFrameBytes,
        result.expected.cancelBytes,
      ]),
    );
    assert.deepEqual(
      result.statusBytes,
      Buffer.concat([
        result.expected.readyBytes,
        result.expected.cancelledBytes,
        result.expected.doneBytes,
      ]),
    );
    assert.deepEqual(result.diagnosticsBytes, Buffer.alloc(0));

    const mismatchedRetained = result.retainedContentControls.filter(
      ({ fd }) => fd >= 4 && fd <= 16,
    );
    assert.equal(mismatchedRetained.length, 13);
    assert.equal(
      mismatchedRetained.every(({ contentMatched }) => !contentMatched),
      true,
    );
    assert.equal(
      result.retainedContentControls.find(({ fd }) => fd === 6)
        .physicalMatchedExecutedSupervisor,
      false,
    );

    assert.equal(
      result.replay.preflightReadyObservedFromNativeSupervisor,
      null,
    );
    assert.equal(result.replay.physicalFacts.supervisorExecuted, null);
    assert.equal(result.replay.physicalFacts.supervisorReaped, null);
    assert.equal(result.replay.physicalFacts.directChildPidfdWaitidReap, null);
    assert.equal(
      result.replay.physicalFacts.semanticLaunchCapsuleValidation,
      null,
    );
    assert.equal(result.replay.physicalFacts.retainedFileContentIdentity, null);
    assert.equal(
      result.replay.physicalFacts.executedSupervisorBoundToFd6,
      null,
    );
    assert.equal(result.replay.physicalFacts.cgroupFilesystem, null);
    assert.equal(result.replay.physicalFacts.cgroupConfiguration, null);
    assert.equal(result.replay.physicalFacts.cgroupLimits, null);
    assert.equal(result.replay.physicalFacts.cgroupEmptiness, null);
    assert.equal(result.replay.physicalFacts.cleanupOutcome, null);
    assert.equal(result.replay.decisionDurability, null);
    assert.equal(
      result.replay.descriptorsZeroThroughSeventeenStructurallyChecked,
      null,
    );
    assert.equal(result.replay.statusWriterUniqueInSupervisorTable, null);
    assert.equal(result.replay.childCreated, null);
    assert.equal(result.replay.cleanupSafe, null);
    assert.equal(result.replay.physicalFacts.binding, null);
    assert.equal(result.replay.physicalEligibility, false);
    assert.equal(result.replay.finalDecisionEligible, false);
    assert.equal(
      Object.values(result.replay.nonclaims).every((value) => value === false),
      true,
    );
    assert.equal(
      Object.values(result.replay.authority).every((value) => value === false),
      true,
    );
    assert.equal(result.nativeObservation.supervisorExecuted, true);
    assert.equal(result.nativeObservation.supervisorReaped, true);
    assert.equal(result.nativeObservation.serializedAuthorityGranted, false);
    assert.equal(
      result.implementationCheckpoint.nativeExecutionFixtureImplemented,
      true,
    );
    assert.equal(
      result.implementationCheckpoint.filesystemGuardianImplemented,
      false,
    );
    assert.equal(result.implementationCheckpoint.nativeObservation, null);
    assert.equal(result.implementationCheckpoint.binding, null);
    assert.equal(result.implementationCheckpoint.physicalEligibility, false);
    assert.equal(
      Object.values(result.implementationCheckpoint.authority).every(
        (value) => value === false,
      ),
      true,
    );
    assert.equal(result.productionReadiness.status, "unavailable");
    assert.equal(
      result.productionReadiness.reason,
      "native-adapter-unavailable",
    );
    assert.equal(result.g1_7Touched, false);
    await assert.rejects(access(result.privateRootPath));

    const fixtureSource = await readFile(
      new URL(
        "./support/candidate-containment-supervisor-preflight-native-v4-fixture.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(
      fixtureSource,
      /src\/qualification|\.\.\/qualification|G1\.7|g1\.7/u,
    );
  },
);
