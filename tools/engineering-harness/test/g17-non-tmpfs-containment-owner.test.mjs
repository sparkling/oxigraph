import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY,
  replayG17ControlAuthorizationDecision,
} from "../src/qualification/control-authorization-gate.mjs";
import {
  G17NonTmpfsContainmentOwnerFault,
  createG17NonTmpfsContainmentCapabilityForTesting,
  createG17NonTmpfsContainmentProductionCapability,
  runG17NonTmpfsContainmentOwner,
} from "../src/qualification/non-tmpfs-containment-owner.mjs";
import { replayG17NonTmpfsContainment } from "../src/qualification/non-tmpfs-containment-contract.mjs";
import {
  createG17ContainmentFakeMechanics,
  createG17ContainmentOwnerClock,
  g17ApprovedControlAuthorizationFixture,
  g17ContainmentOwnerExpected,
  g17ProposedControlAuthorizationFixture,
} from "./support/g17-non-tmpfs-containment-owner-fixture.mjs";

async function testCapability({
  expected = g17ContainmentOwnerExpected(),
  fake = createG17ContainmentFakeMechanics({ expected }),
  clock = createG17ContainmentOwnerClock(),
  signal,
} = {}) {
  const authorization = g17ApprovedControlAuthorizationFixture();
  const capability = await createG17NonTmpfsContainmentCapabilityForTesting({
    ...authorization,
    expected,
    mechanics: fake.mechanics,
    clock,
    signal,
  });
  return { capability, expected, fake };
}

test("the current proposed control decision cannot acquire live containment mechanics", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected });
  await assert.rejects(
    createG17NonTmpfsContainmentProductionCapability({
      expected,
      mechanics: fake.mechanics,
      signal: undefined,
    }),
    /proposed control authorization cannot start controls/u,
  );
  assert.deepEqual(fake.log, []);
});

test("one opaque capability emits one canonical authority-free containment artifact", async () => {
  const { capability, expected, fake } = await testCapability();
  const result = await runG17NonTmpfsContainmentOwner(capability);
  assert.deepEqual(fake.log, [
    "openSession",
    "acquireLease",
    "probeLeaseContender",
    "prepareSession",
    "configureCgroup",
    "observeController:controller-before",
    "runWorker",
    "worker:before",
    "worker:after",
    "observeController:controller-after",
    "quiesce",
    "inventoryState",
    "cleanupState",
    "cleanupCgroup",
    "observePostCleanup",
    "releaseLease",
    "closeSession",
  ]);
  const bytes = result.bytes;
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(bytes.subarray(0, -1).includes(0x0a), false);
  const replayed = replayG17NonTmpfsContainment({
    bytes,
    expected: structuredClone(expected),
  });
  assert.deepEqual(replayed, result.projection);
  assert.equal(replayed.status, "CONTAINMENT_EVIDENCE_REPLAYED");
  assert.equal(
    replayed.bindingsProvenance,
    "CALLER_SUPPLIED_UNSEALED_NONAUTHORITATIVE",
  );
  assert.equal(replayed.lease.contender, "EWOULDBLOCK_EVIDENCE_REPLAYED");
  assert.equal(replayed.lease.controller.pid, expected.controllerPid);
  assert.equal(replayed.lease.holder.pid, expected.holderPid);
  assert.deepEqual(replayed.lease.globalLockLocator, expected.globalLockLocator);
  assert.equal(replayed.containment.cgroupPath, fake.cgroupPath);
  assert.equal(replayed.finalDecisionEligible, false);
  assert.equal(replayed.binding, null);
  assert.equal(replayed.nonclaims.sealedExpectedBindings, false);
  assert.deepEqual(new Set(Object.values(replayed.authority)), new Set([false]));

  bytes.fill(0);
  assert.notEqual(result.bytes[0], 0);
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) =>
      error instanceof G17NonTmpfsContainmentOwnerFault &&
      error.phase === "preflight",
  );
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(Object.freeze({})),
    /capability is not live/u,
  );
});

test("the full acquisition-through-release wall span fails closed", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected });
  const fixture = await testCapability({
    expected,
    fake,
    clock: createG17ContainmentOwnerClock({
      releaseOffsetMs: expected.limits.totalWallMs + 1,
    }),
  });
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(fixture.capability),
    (error) =>
      error instanceof G17NonTmpfsContainmentOwnerFault &&
      error.phase === "timeout",
  );
  assert.deepEqual(fake.log.slice(-2), ["releaseLease", "closeSession"]);
});

test("the controller, flock holder, contender, and worker are pairwise distinct", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected });
  const probe = fake.mechanics.probeLeaseContender;
  fake.mechanics.probeLeaseContender = async (input) => ({
    ...await probe(input),
    pid: expected.holderPid,
  });
  const { capability } = await testCapability({ expected, fake });
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) =>
      error instanceof G17NonTmpfsContainmentOwnerFault &&
      error.phase === "lease",
  );
  assert.deepEqual(fake.log, [
    "openSession",
    "acquireLease",
    "probeLeaseContender",
    "releaseLease",
    "closeSession",
  ]);
});

test("trusted controller, holder, and worker identities must already be distinct", async () => {
  const expected = g17ContainmentOwnerExpected({
    holderPid: "4242",
  });
  const fake = createG17ContainmentFakeMechanics({ expected });
  await assert.rejects(
    testCapability({ expected, fake }),
    (error) =>
      error instanceof G17NonTmpfsContainmentOwnerFault &&
      error.phase === "preflight" &&
      /expected process identities are not pairwise distinct/u.test(
        error.message,
      ),
  );
  assert.deepEqual(fake.log, []);
});

test("the live owner rejects coherent holder and private-lock substitutions", async () => {
  for (const mutation of ["holder", "private-lock"]) {
    const expected = g17ContainmentOwnerExpected();
    const fake = createG17ContainmentFakeMechanics({ expected });
    const acquire = fake.mechanics.acquireLease;
    fake.mechanics.acquireLease = async (input) => {
      const result = await acquire(input);
      if (mutation === "holder") {
        result.holder = {
          pid: "4244",
          generation: "holder-generation-2",
        };
      } else {
        result.lockLocator.rootPath =
          "/var/lib/oxigraph-engineering-harness/g1.7/private-run";
      }
      return result;
    };
    const { capability } = await testCapability({ expected, fake });
    await assert.rejects(
      runG17NonTmpfsContainmentOwner(capability),
      (error) =>
        error instanceof G17NonTmpfsContainmentOwnerFault &&
        error.phase === "lease",
      mutation,
    );
    assert.deepEqual(fake.log, [
      "openSession",
      "acquireLease",
      "releaseLease",
      "closeSession",
    ]);
  }
});

test("caller-chosen expected and mechanics cannot relocate the global lock", async () => {
  const base = g17ContainmentOwnerExpected();
  const expected = g17ContainmentOwnerExpected({
    globalLockLocator: {
      ...base.globalLockLocator,
      rootPath: "/var/lib/oxigraph-engineering-harness/private-run",
    },
  });
  const fake = createG17ContainmentFakeMechanics({ expected });
  await assert.rejects(
    testCapability({ expected, fake }),
    (error) =>
      error instanceof G17NonTmpfsContainmentOwnerFault &&
      error.phase === "preflight" &&
      /canonical reviewed locator/u.test(error.message),
  );
  assert.deepEqual(fake.log, []);
});

test("the live wall deadline aborts a cooperative hung worker before cleanup", async () => {
  const base = g17ContainmentOwnerExpected();
  const expected = g17ContainmentOwnerExpected({
    limits: { ...base.limits, totalWallMs: 1_000 },
  });
  const fake = createG17ContainmentFakeMechanics({
    expected,
    hangAt: "runWorker",
  });
  const { capability } = await testCapability({ expected, fake });
  const started = performance.now();
  let observed;
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) => {
      observed = error;
      return (
        error instanceof G17NonTmpfsContainmentOwnerFault &&
        error.phase === "timeout"
      );
    },
  );
  assert.ok(performance.now() - started < 2_500);
  assert.deepEqual(fake.log.slice(-2), ["cancelWorker", "quiesce"]);
  assert.equal(fake.log.includes("cleanupState"), false);
  assert.equal(fake.log.includes("cleanupCgroup"), false);
  assert.equal(fake.log.includes("releaseLease"), false);
  assert.equal(fake.log.includes("closeSession"), false);
  assert.match(observed.cleanupErrors.at(-1), /retained without cleanup/u);
});

test("worker failure retains the session when direct close/reap is unproved", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected, failAt: "runWorker" });
  const { capability } = await testCapability({ expected, fake });
  let observed;
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) => {
      observed = error;
      return /synthetic runWorker failure/u.test(error.message);
    },
  );
  assert.deepEqual(fake.log.slice(-2), ["cancelWorker", "quiesce"]);
  assert.equal(fake.log.includes("cleanupState"), false);
  assert.equal(fake.log.includes("cleanupCgroup"), false);
  assert.equal(fake.log.includes("releaseLease"), false);
  assert.equal(fake.log.includes("closeSession"), false);
  assert.match(observed.cleanupErrors.at(-1), /retained without cleanup/u);
});

test("a resolved worker without exact close/reap proof is retained", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected });
  const originalRunWorker = fake.mechanics.runWorker;
  fake.mechanics.runWorker = async (input) => ({
    ...(await originalRunWorker(input)),
    closeObserved: false,
    captureComplete: false,
  });
  const { capability } = await testCapability({ expected, fake });
  let observed;
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) => {
      observed = error;
      return /did not prove exact child close, reap, and capture/u.test(
        error.message,
      );
    },
  );
  assert.deepEqual(fake.log.slice(-2), ["cancelWorker", "quiesce"]);
  assert.equal(fake.log.includes("cleanupState"), false);
  assert.equal(fake.log.includes("cleanupCgroup"), false);
  assert.equal(fake.log.includes("releaseLease"), false);
  assert.equal(fake.log.includes("closeSession"), false);
  assert.match(observed.cleanupErrors.at(-1), /retained without cleanup/u);
});

test("failed quiescence retains a returned worker session without destructive cleanup", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({
    expected,
    failAt: "observeController:controller-after",
  });
  const originalQuiesce = fake.mechanics.quiesce;
  fake.mechanics.quiesce = async (input) => {
    await originalQuiesce(input);
    return {
      cgroupPopulated: true,
      pidsCurrent: 1,
      processesRemaining: 1,
    };
  };
  const { capability } = await testCapability({ expected, fake });
  let observed;
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) => {
      observed = error;
      return /synthetic observeController:controller-after failure/u.test(
        error.message,
      );
    },
  );
  assert.equal(fake.log.at(-1), "quiesce");
  assert.equal(fake.log.includes("cleanupState"), false);
  assert.equal(fake.log.includes("cleanupCgroup"), false);
  assert.equal(fake.log.includes("releaseLease"), false);
  assert.equal(fake.log.includes("closeSession"), false);
  assert.match(observed.cleanupErrors.at(-1), /retained without cleanup/u);
});

test("state cleanup failure still attempts cgroup cleanup, lease release, and close", async () => {
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected, failAt: "cleanupState" });
  const { capability } = await testCapability({ expected, fake });
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    /synthetic cleanupState failure/u,
  );
  assert.deepEqual(fake.log.slice(-4), [
    "cleanupState",
    "cleanupCgroup",
    "releaseLease",
    "closeSession",
  ]);
  assert.equal(fake.log.includes("observePostCleanup"), false);
});

test("cancellation during the worker retains unproved process state", async () => {
  const expected = g17ContainmentOwnerExpected();
  const abortController = new AbortController();
  const fake = createG17ContainmentFakeMechanics({ expected, abortController });
  const { capability } = await testCapability({
    expected,
    fake,
    signal: abortController.signal,
  });
  let observed;
  await assert.rejects(
    runG17NonTmpfsContainmentOwner(capability),
    (error) => {
      observed = error;
      return (
        error instanceof G17NonTmpfsContainmentOwnerFault &&
        error.phase === "cancel" &&
        error.cause?.message === "synthetic worker cancellation"
      );
    },
  );
  assert.equal(abortController.signal.aborted, true);
  assert.deepEqual(fake.log.slice(-2), ["cancelWorker", "quiesce"]);
  assert.equal(fake.log.includes("cleanupState"), false);
  assert.equal(fake.log.includes("cleanupCgroup"), false);
  assert.equal(fake.log.includes("releaseLease"), false);
  assert.equal(fake.log.includes("closeSession"), false);
  assert.match(observed.cleanupErrors.at(-1), /retained without cleanup/u);
});

test("test-only acquisition still requires an approved control binding", async () => {
  const authorization = g17ProposedControlAuthorizationFixture();
  const expected = g17ContainmentOwnerExpected();
  const fake = createG17ContainmentFakeMechanics({ expected });
  await assert.rejects(
    createG17NonTmpfsContainmentCapabilityForTesting({
      ...authorization,
      expected,
      mechanics: fake.mechanics,
      clock: createG17ContainmentOwnerClock(),
      signal: undefined,
    }),
    /proposed control authorization cannot start controls/u,
  );
  assert.deepEqual(fake.log, []);
});

test("the narrow gate pins the exact current proposed authorization bytes", () => {
  const current = g17ProposedControlAuthorizationFixture();
  const replayed = replayG17ControlAuthorizationDecision({
    bytes: current.authorizationBytes,
  });
  assert.equal(replayed.bytes, G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY.bytes);
  assert.equal(
    replayed.rawSha256,
    G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY.rawSha256,
  );
  assert.equal(
    replayed.contentHash,
    G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY.contentHash,
  );
  assert.equal(replayed.authorization.status, "CONTROL_AUTH_PROPOSED");
  assert.deepEqual(replayed.authorization.approval, {
    approvedAt: null,
    approvedBy: null,
    status: "UNAPPROVED",
  });
  assert.throws(
    () =>
      replayG17ControlAuthorizationDecision({
        bytes: Buffer.concat([
          current.authorizationBytes.subarray(0, -1),
          Buffer.from(" \n", "utf8"),
        ]),
      }),
    /canonical JSON plus one LF/u,
  );

  const protocolDrift = JSON.parse(
    current.authorizationBytes.toString("utf8"),
  );
  protocolDrift.protocol.environment.class =
    "linux-x86_64-cgroup-v2-private-lock";
  assert.throws(
    () =>
      replayG17ControlAuthorizationDecision({
        bytes: Buffer.from(`${JSON.stringify(protocolDrift)}\n`, "utf8"),
      }),
    /frozen protocol drifted/u,
  );

  const partialApproval = JSON.parse(
    current.authorizationBytes.toString("utf8"),
  );
  partialApproval.approval = {
    approvedAt: "2026-08-28T00:00:00.000Z",
    approvedBy: "untrusted-caller",
    status: "APPROVED",
  };
  assert.throws(
    () =>
      replayG17ControlAuthorizationDecision({
        bytes: Buffer.from(`${JSON.stringify(partialApproval)}\n`, "utf8"),
      }),
    /proposed decision carries approval authority/u,
  );

  assert.throws(
    () =>
      replayG17ControlAuthorizationDecision({
        bytes: Buffer.alloc(128 * 1024 + 1),
      }),
    /not a bounded Buffer/u,
  );
  const accessor = {};
  Object.defineProperty(accessor, "bytes", {
    enumerable: true,
    get() {
      throw new Error("authorization accessor executed");
    },
  });
  assert.throws(
    () => replayG17ControlAuthorizationDecision(accessor),
    /must be an enumerable data field/u,
  );
});

async function recursiveImportClosure(entry) {
  const pending = [entry];
  const sources = new Map();
  const builtins = new Set();
  while (pending.length > 0) {
    const url = pending.pop();
    if (sources.has(url.href)) continue;
    const source = await readFile(url, "utf8");
    sources.set(url.href, source);
    const dynamicSpecifiers = Array.from(
      source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
      (match) => match[1],
    );
    assert.equal(
      Array.from(source.matchAll(/\bimport\s*\(/gu)).length,
      dynamicSpecifiers.length,
      `${url.pathname} contains a non-literal dynamic import`,
    );
    const specifiers = [
      ...Array.from(
        source.matchAll(
          /(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']\s*;?/gu,
        ),
        (match) => match[1],
      ),
      ...dynamicSpecifiers,
    ];
    for (const specifier of new Set(specifiers)) {
      if (specifier.startsWith("node:")) {
        builtins.add(specifier);
      } else if (specifier.startsWith(".")) {
        pending.push(new URL(specifier, url));
      } else {
        builtins.add(specifier);
      }
    }
  }
  return { sources, builtins };
}

test("the recursive static and dynamic owner import closure is narrow", async () => {
  const entry = new URL(
    "../src/qualification/non-tmpfs-containment-owner.mjs",
    import.meta.url,
  );
  const closure = await recursiveImportClosure(entry);
  assert.deepEqual(
    [...closure.sources.keys()].map((href) => new URL(href).pathname.split("/").at(-1)).sort(),
    [
      "control-authorization-gate.mjs",
      "non-tmpfs-containment-contract.mjs",
      "non-tmpfs-containment-owner.mjs",
    ],
  );
  assert.deepEqual([...closure.builtins].sort(), [
    "node:crypto",
    "node:fs/promises",
    "node:util",
  ]);
  const source = [...closure.sources.values()].join("\n");
  assert.doesNotMatch(
    source,
    /node:(?:child_process|net|http)|native\/process|contained-session|(?:from\s+|import\s*\()\s*["'][^"']*(?:benchmark|darwin|provider|systemd|bwrap)|["']\.\/contract\.mjs["']|["']\.\/control-protocol\.mjs["']/iu,
  );
});
