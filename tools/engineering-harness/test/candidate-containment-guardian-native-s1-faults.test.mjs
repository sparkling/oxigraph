import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1,
  createCandidateContainmentGuardianNativeReceiptV1,
  replayCandidateContainmentGuardianNativeLifecycleV1,
  verifyCandidateContainmentGuardianNativeReceiptV1,
} from "../src/candidate/containment-guardian-native-adapter-v1.mjs";
import { canonicalJsonLine } from "../src/candidate/containment-exact-v2.mjs";
import {
  syntheticCandidateContainmentGuardianNativeLaunchV1,
} from "./support/candidate-containment-guardian-native-s1-fixture.mjs";

const ZERO_SHA256 = "0".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function changed(role, mutate) {
  const launch = structuredClone(
    syntheticCandidateContainmentGuardianNativeLaunchV1(role),
  );
  mutate(launch);
  return launch;
}

function createManager(launch = syntheticCandidateContainmentGuardianNativeLaunchV1("manager")) {
  return createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 0,
    predecessorSha256: ZERO_SHA256,
    launch,
  });
}

function rejects(launch, pattern) {
  assert.throws(() => createManager(launch), pattern);
}

test("pathname execution and every held-file/live-image mismatch fail before receipt creation", () => {
  rejects(changed("manager", (launch) => {
    launch.execution.pathname = "/tmp/substituted-manager";
  }), /execution pathname changed/u);
  for (const field of ["byteLength", "sha256", "device", "inode"]) {
    rejects(changed("manager", (launch) => {
      launch.execution.liveImage[field] = field === "byteLength"
        ? launch.execution.liveImage[field] + 1
        : field === "sha256"
          ? "f".repeat(64)
          : String(BigInt(launch.execution.liveImage[field]) + 1n);
    }), /live image does not equal the held executable/u);
  }
  rejects(changed("manager", (launch) => {
    launch.heldExecutable.sha256 = "f".repeat(64);
    launch.execution.liveImage.sha256 = "f".repeat(64);
  }), /frozen S0 artifact/u);
});

test("wrong launch parent and wrong reap owner fail closed", () => {
  rejects(changed("manager", (launch) => {
    launch.ownerRole = "manager";
  }), /launch owner role changed/u);
  rejects(changed("manager", (launch) => {
    launch.ownerEvidenceClass = "safe-local-runtime-observation";
  }), /launch owner evidence class changed/u);
  rejects(changed("manager", (launch) => {
    launch.supervision.waitOwnerMatchesLaunchOwner = true;
  }), /supervision safe-local wait owner was overclaimed/u);
  rejects(changed("manager", (launch) => {
    launch.supervision.syntheticWaitOwnerMatchesLaunchOwner = false;
  }), /supervision synthetic wait owner changed/u);
});

test("pre-exec trace overrun, unlisted events, missing positive stop, and missing outcome EOF fail closed", () => {
  rejects(changed("manager", (launch) => {
    launch.execution.trace.push("openat");
  }), /execution trace/u);
  rejects(changed("manager", (launch) => {
    launch.execution.traceScope = "whole-child-lifetime";
  }), /execution trace scope changed/u);
  rejects(changed("manager", (launch) => {
    launch.execution.trace[0] = "openat";
  }), /execution trace changed/u);
  rejects(changed("manager", (launch) => {
    launch.execution.events[0] = "PTRACE_EVENT_FORK";
  }), /execution events changed/u);
  rejects(changed("manager", (launch) => {
    launch.execution.events.push("PTRACE_EVENT_EXIT");
  }), /execution events/u);
  rejects(changed("manager", (launch) => {
    launch.execution.positiveExecStop = "EOF";
  }), /execution exec stop changed/u);
  rejects(changed("manager", (launch) => {
    launch.execution.outcomePipeEof = false;
  }), /execution outcome EOF changed/u);
  rejects(changed("manager", (launch) => {
    launch.execution.childStoppedUntilDurableReceipt = true;
  }), /durable receipt stop was overclaimed/u);
});

test("clone flags, evidence class, fallback, and pidfd return disagreement fail closed", () => {
  rejects(changed("manager", (launch) => {
    launch.placement.flags.reverse();
  }), /placement flags changed/u);
  rejects(changed("manager", (launch) => {
    launch.placement.evidenceClass = "safe-local-physical";
  }), /placement evidence class changed/u);
  rejects(changed("manager", (launch) => {
    launch.placement.fallbackUsed = true;
  }), /placement fallback changed/u);
  rejects(changed("manager", (launch) => {
    launch.placement.returnedPidfdToken = "different-pidfd-0001";
  }), /placement pidfd return changed/u);
});

test("membership drift, surplus members, and cgroup-token substitution fail closed", () => {
  rejects(changed("manager", (launch) => {
    launch.placement.membership.members[0] = "other-child-0001";
  }), /placement membership drifted/u);
  rejects(changed("manager", (launch) => {
    launch.placement.membership.members.push("other-child-0001");
  }), /placement members/u);
  rejects(changed("manager", (launch) => {
    launch.placement.membership.cgroupToken = "other-cgroup-0001";
  }), /placement membership cgroup changed/u);
});

test("pidfd readability, synthetic HUP, waitid type, exclusivity, and terminal disagreement fail closed", () => {
  for (const [field, value, pattern] of [
    ["pidfdReadable", false, /pidfd readable changed/u],
    ["pidfdHup", true, /pidfd HUP was overclaimed/u],
    ["syntheticPidfdHup", false, /synthetic pidfd HUP changed/u],
    ["waitidIdType", "P_PID", /wait id type changed/u],
    ["waitidReaped", false, /supervision reap changed/u],
    ["secondWaitEchild", false, /exclusive wait changed/u],
    ["statusEof", true, /status EOF was overclaimed/u],
    ["syntheticStatusEof", false, /synthetic status EOF changed/u],
  ]) {
    rejects(changed("manager", (launch) => {
      launch.supervision[field] = value;
    }), pattern);
  }
  rejects(changed("manager", (launch) => {
    launch.supervision.termSignal = 9;
  }), /terminal status is not exclusive/u);
});

test("lost or ambiguous parentage may not smuggle pidfd, wait, EOF, exit, or reap claims", () => {
  for (const parentage of ["parentage-lost", "parentage-ambiguous"]) {
    rejects(changed("manager", (launch) => {
      launch.parentage = parentage;
      launch.supervision.evidenceClass = "unresolved-parentage-replay";
    }), /unresolved parentage claimed pidfdReadable/u);
  }
});

test("hostile launch records, extra fields, symbols, proxies, and accessors reject without traps", () => {
  const extra = syntheticCandidateContainmentGuardianNativeLaunchV1("manager");
  extra.extra = true;
  rejects(extra, /launch observation fields/u);

  const symbol = syntheticCandidateContainmentGuardianNativeLaunchV1("manager");
  symbol[Symbol("extra")] = true;
  rejects(symbol, /launch observation fields/u);

  rejects(
    new Proxy(syntheticCandidateContainmentGuardianNativeLaunchV1("manager"), {}),
    /launch observation must be/u,
  );

  let calls = 0;
  const accessor = syntheticCandidateContainmentGuardianNativeLaunchV1("manager");
  Object.defineProperty(accessor, "role", {
    enumerable: true,
    get() {
      calls += 1;
      return "manager";
    },
  });
  rejects(accessor, /launch observation fields/u);
  assert.equal(calls, 0);
});

test("canonical receipt replay rejects authority, physical-fact, binding, readiness, and persistence tamper", () => {
  const receipt = createManager();
  const body = JSON.parse(receipt.bytes.toString("utf8"));
  for (const mutate of [
    (value) => { value.authority.processExecution = true; },
    (value) => { value.physicalFacts.cloneIntoCgroup = true; },
    (value) => { value.binding = "registered"; },
    (value) => { value.readiness.status = "ready"; },
    (value) => { value.persistence.physicalDurability = true; },
    (value) => { value.releasePerformed = true; },
  ]) {
    const changedBody = structuredClone(body);
    mutate(changedBody);
    assert.throws(
      () => verifyCandidateContainmentGuardianNativeReceiptV1(canonicalJsonLine(changedBody)),
      /candidate containment guardian native adapter v1/u,
    );
  }
});

test("receipt framing, bounds, predecessor order, and manager-to-guardian chain are exact", () => {
  const manager = createManager();
  assert.throws(
    () => verifyCandidateContainmentGuardianNativeReceiptV1(Buffer.concat([manager.bytes, Buffer.from("\n")])),
    /framing is invalid/u,
  );
  assert.throws(
    () => verifyCandidateContainmentGuardianNativeReceiptV1(
      Buffer.alloc(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1 + 1, 0x20),
    ),
    /byte bound/u,
  );
  assert.throws(
    () => createCandidateContainmentGuardianNativeReceiptV1({
      sequence: 1,
      predecessorSha256: ZERO_SHA256,
      launch: syntheticCandidateContainmentGuardianNativeLaunchV1("guardian"),
    }),
    /guardian receipt predecessor is absent/u,
  );
  const guardian = createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 1,
    predecessorSha256: "1".repeat(64),
    launch: syntheticCandidateContainmentGuardianNativeLaunchV1("guardian"),
  });
  assert.throws(
    () => replayCandidateContainmentGuardianNativeLifecycleV1({
      managerReceiptBytes: manager.bytes,
      guardianReceiptBytes: guardian.bytes,
    }),
    /manager-to-guardian receipt chain changed/u,
  );
  assert.notEqual(sha256(manager.bytes), "1".repeat(64));
});
