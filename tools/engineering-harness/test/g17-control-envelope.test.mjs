import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chown,
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  statfs,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import nodeTest from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  G17_CONTROL_AUTHORIZATION_NAME,
  G17_CONTROL_ENVELOPE_LIMITS,
  G17_CONTROL_ENVELOPE_REPLAY_SCHEMA,
  G17_CONTROL_ENVELOPE_SEAL_CHECKPOINTS,
  G17_CONTROL_ENVELOPE_SEAL_SCHEMA,
  G17_CONTROL_RECEIPT_NAME,
  createG17ControlEnvelopeOwnerForTesting,
  g17ControlEnvelopesRoot,
  validateG17ControlEnvelopeBudget,
} from "../src/qualification/control-envelope.mjs";
import {
  G17_CONTROL_AUTHORIZATION_SCHEMA,
  G17_FINAL_DECISION_PROTOCOL,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
  loadG17ControlProtocol,
  validateG17FinalDecisionBinding,
  validateG17FinalDecisionSet,
} from "../src/qualification/control-protocol.mjs";
import { G17_BENCHMARK_OWNER_BATCH_NAME } from "../src/qualification/control-receipt-contract.mjs";
import { canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_CONTROL_RECEIPT_FIXTURE_RUN_ID,
  createG17ControlReceiptFixture,
} from "./support/g17-control-receipt-fixture.mjs";

const executeFile = promisify(execFile);
const temporaryFilesystem = await statfs(tmpdir(), { bigint: true }).catch(
  () => null,
);
const physicalHostSupported =
  process.platform === "linux" &&
  typeof process.getuid === "function" &&
  temporaryFilesystem !== null &&
  temporaryFilesystem.type !== 0x0102_1994n &&
  temporaryFilesystem.type !== 0x8584_58f6n;
const test = physicalHostSupported ? nodeTest : nodeTest.skip;
const ENVELOPE_ERROR = /G1\.7 control envelope/u;
const AUTHORITY = Object.freeze({
  controlExecution: false,
  qualificationExecution: false,
  promotion: false,
  publication: false,
  routerQuality: false,
  providerExecution: false,
});
const EXPECTED_NAMES = Object.freeze(
  [
    G17_CONTROL_AUTHORIZATION_NAME,
    G17_BENCHMARK_OWNER_BATCH_NAME,
    G17_CONTROL_RECEIPT_NAME,
  ].sort(),
);
const EXPECTED_SEAL_CHECKPOINTS = Object.freeze([
  "run-created",
  "authorization-created",
  "authorization-written",
  "authorization-synced",
  "authorization-sealed",
  "owner-batch-created",
  "owner-batch-written",
  "owner-batch-synced",
  "owner-batch-sealed",
  "artifacts-directory-synced",
  "before-receipt-create",
  "receipt-created",
  "receipt-written",
  "receipt-synced",
  "receipt-sealed",
  "receipt-directory-synced",
  "directory-sealed",
  "parent-synced",
]);

function literalImportSpecifiers(source) {
  return [
    ...source.matchAll(
      /^\s*import\s+(?:(?:[\w*{},\s]+)\s+from\s+)?["']([^"']+)["']\s*;/gmu,
    ),
    ...source.matchAll(
      /^\s*export\s+(?:[\w*{},\s]+)\s+from\s+["']([^"']+)["']\s*;/gmu,
    ),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]);
}

async function localImportClosure(entry) {
  const pending = [new URL(entry, import.meta.url)];
  const sources = new Map();
  const specifiers = new Set();
  while (pending.length > 0) {
    const url = pending.pop();
    if (sources.has(url.href)) continue;
    const source = await readFile(url, "utf8");
    sources.set(url.href, source);
    for (const specifier of literalImportSpecifiers(source)) {
      specifiers.add(specifier);
      if (specifier.startsWith(".")) pending.push(new URL(specifier, url));
    }
  }
  return { sources, specifiers };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertExactKeys(value, expected, label) {
  const keys = Reflect.ownKeys(value);
  assert.equal(
    keys.every((key) => typeof key === "string"),
    true,
    `${label} must not contain symbol keys`,
  );
  assert.deepEqual(
    keys.sort(),
    [...expected].sort(),
    `${label} key set drifted`,
  );
}

function assertExactAuthority(value, label) {
  assertExactKeys(value, Object.keys(AUTHORITY), label);
  assert.deepEqual(value, AUTHORITY, label);
}

function assertSealShape(sealed) {
  assertExactKeys(
    sealed,
    [
      "schema",
      "status",
      "runId",
      "inventory",
      "entries",
      "prospectiveFinalDecisionBinding",
      "authority",
      "claims",
    ],
    "physical seal",
  );
  assertExactAuthority(sealed.authority, "physical seal authority");
  assertExactKeys(
    sealed.claims,
    [
      "receiptLastOwnerSequence",
      "orderedFileAndDirectoryFsyncCallsReturned",
      "postSealExactReplayComplete",
      "crashDurability",
      "powerLossDurability",
      "filesystemFlushDurability",
      "sameUidTamperResistance",
    ],
    "physical seal claims",
  );
  for (const entry of sealed.inventory) {
    assertExactKeys(entry, ["name", "bytes", "sha256"], "seal inventory entry");
  }
}

function assertReplayShape(replay, bindingAvailable) {
  assertExactKeys(
    replay,
    [
      "schema",
      "status",
      "outcome",
      "sealedArchiveReplayComplete",
      "receiptCandidateReplayComplete",
      "finalDecisionBindingAvailable",
      "prospectiveFinalDecisionBinding",
      "candidateReplay",
      "storage",
      "authority",
    ],
    "physical replay",
  );
  assert.equal(Object.hasOwn(replay, "binding"), false);
  assert.equal(Object.hasOwn(replay, "finalDecisionEligible"), false);
  assert.equal(replay.finalDecisionBindingAvailable, bindingAvailable);
  assertExactAuthority(replay.authority, "physical replay authority");
  assertExactKeys(
    replay.storage,
    [
      "runId",
      "inventory",
      "entries",
      "filesystemType",
      "directoryMode",
      "fileMode",
      "currentStateStable",
      "nonTmpfs",
      "historicalReceiptLastProvenByReplay",
      "sameUidTamperResistance",
      "crashDurability",
      "powerLossDurability",
      "filesystemFlushDurability",
    ],
    "physical replay storage",
  );
  for (const entry of replay.storage.inventory) {
    assertExactKeys(
      entry,
      ["name", "bytes", "sha256"],
      "replay inventory entry",
    );
  }
  assertExactKeys(
    replay.candidateReplay,
    [
      "schema",
      "status",
      "outcome",
      "receiptCandidateReplayComplete",
      "finalDecisionEligible",
      "receipt",
      "receiptRawSha256",
      "ownerProjection",
      "statistics",
      "negativeControlSignature",
      "binding",
      "authority",
    ],
    "pure candidate replay",
  );
  assert.equal(replay.candidateReplay.binding, null);
  assert.equal(replay.candidateReplay.finalDecisionEligible, false);
  assertExactAuthority(
    replay.candidateReplay.authority,
    "pure candidate replay authority",
  );
  assertExactAuthority(
    replay.candidateReplay.receipt.authority,
    "replayed receipt authority",
  );
  if (bindingAvailable) {
    assertExactKeys(
      replay.prospectiveFinalDecisionBinding,
      [
        "schema",
        "status",
        "runId",
        "rawSha256",
        "receiptSha256",
        "authorizationRawSha256",
        "authorizationContentHash",
        "negativeControlSignatureContentHash",
        "startedAt",
        "completedAt",
        "environmentClass",
      ],
      "prospective final-decision binding",
    );
  } else {
    assert.equal(replay.prospectiveFinalDecisionBinding, null);
  }
}

async function makeWritable(path) {
  const metadata = await lstat(path).catch(() => null);
  if (metadata === null || metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory()) {
    await chmod(path, 0o600).catch(() => {});
    return;
  }
  await chmod(path, 0o700).catch(() => {});
  for (const entry of await readdir(path).catch(() => [])) {
    await makeWritable(join(path, entry));
  }
}

async function temporaryStorage(t, onCheckpoint = undefined) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-control-envelope-"));
  await chmod(root, 0o700);
  t.after(async () => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    owner: createG17ControlEnvelopeOwnerForTesting({
      envelopesRoot: root,
      ...(onCheckpoint === undefined ? {} : { onCheckpoint }),
    }),
  };
}

function sealOptions(fixture) {
  return {
    authorizationBytes: Buffer.from(fixture.authorizationBytes),
    ownerBatchBytes: Buffer.from(fixture.ownerBatchBytes),
    receiptBytes: Buffer.from(fixture.receiptBytes),
  };
}

async function sealFixture(t, fixture = createG17ControlReceiptFixture()) {
  const storage = await temporaryStorage(t);
  const sealed = await storage.owner.seal(sealOptions(fixture));
  return {
    ...storage,
    fixture,
    sealed,
    runPath: join(storage.root, fixture.controlRunId),
  };
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

test("physical seal and independent replay derive only a prospective PASS binding", async (t) => {
  const { owner, fixture, sealed, runPath } = await sealFixture(t);
  assert.equal(fixture.replay.status, "CANDIDATE_REPLAYED");
  assert.equal(fixture.replay.finalDecisionEligible, false);
  assert.equal(fixture.replay.binding, null);
  assertExactAuthority(fixture.replay.authority, "fixture replay authority");

  assertSealShape(sealed);
  assert.equal(sealed.schema, G17_CONTROL_ENVELOPE_SEAL_SCHEMA);
  assert.equal(sealed.status, "SEALED");
  assert.equal(sealed.runId, G17_CONTROL_RECEIPT_FIXTURE_RUN_ID);
  assert.equal(sealed.prospectiveFinalDecisionBinding, null);
  assert.deepEqual(sealed.authority, AUTHORITY);
  assert.equal(sealed.claims.receiptLastOwnerSequence, true);
  assert.equal(sealed.claims.postSealExactReplayComplete, true);
  assert.equal(sealed.claims.crashDurability, false);
  assert.deepEqual(sealed.entries, EXPECTED_NAMES);

  assert.equal((await lstat(runPath)).mode & 0o777, 0o500);
  for (const name of EXPECTED_NAMES) {
    const metadata = await lstat(join(runPath, name));
    assert.equal(metadata.isFile(), true, name);
    assert.equal(metadata.mode & 0o777, 0o400, name);
    assert.equal(metadata.nlink, 1, name);
  }
  assert.deepEqual(
    await readFile(join(runPath, G17_CONTROL_AUTHORIZATION_NAME)),
    fixture.authorizationBytes,
  );
  assert.deepEqual(
    await readFile(join(runPath, G17_BENCHMARK_OWNER_BATCH_NAME)),
    fixture.ownerBatchBytes,
  );
  assert.deepEqual(
    await readFile(join(runPath, G17_CONTROL_RECEIPT_NAME)),
    fixture.receiptBytes,
  );

  const replay = await owner.replay({ controlRunId: fixture.controlRunId });
  assertReplayShape(replay, true);
  assert.equal(replay.schema, G17_CONTROL_ENVELOPE_REPLAY_SCHEMA);
  assert.equal(replay.status, "SEALED_ARCHIVE_REPLAYED");
  assert.equal(replay.outcome, "CONTROL_SEALED_PASS");
  assert.equal(replay.sealedArchiveReplayComplete, true);
  assert.equal(replay.receiptCandidateReplayComplete, true);
  assert.equal(replay.finalDecisionBindingAvailable, true);
  assert.deepEqual(replay.authority, AUTHORITY);
  assert.equal(replay.storage.currentStateStable, true);
  assert.equal(replay.storage.nonTmpfs, true);
  assert.equal(replay.storage.historicalReceiptLastProvenByReplay, false);
  assert.equal(replay.storage.crashDurability, false);
  assert.deepEqual(
    replay.storage.inventory.map(({ name }) => name),
    [
      G17_CONTROL_AUTHORIZATION_NAME,
      G17_BENCHMARK_OWNER_BATCH_NAME,
      G17_CONTROL_RECEIPT_NAME,
    ],
  );
  const receiptDocument = JSON.parse(fixture.receiptBytes.toString("utf8"));
  const authorizationDocument = JSON.parse(
    fixture.authorizationBytes.toString("utf8"),
  );
  assert.deepEqual(replay.prospectiveFinalDecisionBinding, {
    schema: "oxigraph.g1.7-control-run-receipt/v1",
    status: "CONTROL_SEALED_PASS",
    runId: fixture.controlRunId,
    rawSha256: sha256(fixture.receiptBytes),
    receiptSha256: receiptDocument.receiptSha256,
    authorizationRawSha256: sha256(fixture.authorizationBytes),
    authorizationContentHash: authorizationDocument.contentHash,
    negativeControlSignatureContentHash:
      receiptDocument.negativeControlSignature.contentHash,
    startedAt: receiptDocument.startedAt,
    completedAt: receiptDocument.completedAt,
    environmentClass: receiptDocument.environmentClass,
  });
  assertDeepFrozen(sealed);
  assertDeepFrozen(replay);
});

test("a new owner instance reopens exact disk bytes without an in-memory candidate", async (t) => {
  const { root, fixture } = await sealFixture(t);
  const reopened = createG17ControlEnvelopeOwnerForTesting({
    envelopesRoot: root,
  });
  const replay = await reopened.replay({
    controlRunId: fixture.controlRunId,
  });
  assert.equal(replay.finalDecisionBindingAvailable, true);
  assert.equal(
    replay.prospectiveFinalDecisionBinding.rawSha256,
    sha256(fixture.receiptBytes),
  );
  assert.equal(replay.candidateReplay.binding, null);
  assert.deepEqual(replay.authority, AUTHORITY);
});

test("seal snapshots exact caller bytes before its first await", async (t) => {
  let release;
  let observed;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const reached = new Promise((resolve) => {
    observed = resolve;
  });
  const { root, owner } = await temporaryStorage(t, async ({ phase }) => {
    if (phase === "run-created") {
      observed();
      await blocked;
    }
  });
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-snapshot-fixture",
  });
  const options = sealOptions(fixture);
  const expected = Object.fromEntries(
    Object.entries(options).map(([key, value]) => [key, Buffer.from(value)]),
  );
  const sealing = owner.seal(options);
  await reached;
  for (const bytes of Object.values(options)) bytes.fill(0x78);
  release();
  await sealing;
  const runPath = join(root, fixture.controlRunId);
  assert.deepEqual(
    await readFile(join(runPath, G17_CONTROL_AUTHORIZATION_NAME)),
    expected.authorizationBytes,
  );
  assert.deepEqual(
    await readFile(join(runPath, G17_BENCHMARK_OWNER_BATCH_NAME)),
    expected.ownerBatchBytes,
  );
  assert.deepEqual(
    await readFile(join(runPath, G17_CONTROL_RECEIPT_NAME)),
    expected.receiptBytes,
  );
});

test("FAIL and INCONCLUSIVE archives replay honestly without a binding", async (t) => {
  const offset = ({ caseIndex, globalBlock, slot }) =>
    caseIndex * 1_000 + globalBlock * 10 + slot;
  const cases = [
    {
      runId: "g17-envelope-aa-fail",
      elapsedNs: (coordinates) =>
        coordinates.controlName === "negativeControl"
          ? (coordinates.arm === "subject" ? 120_000 : 100_000) +
            offset(coordinates)
          : (coordinates.arm === "subject" ? 130_000 : 100_000) +
            offset(coordinates),
      outcome: "CONTROL_SEALED_FAIL",
      signature: true,
    },
    {
      runId: "g17-envelope-negative-fail",
      elapsedNs: (coordinates) => 100_000 + offset(coordinates),
      outcome: "CONTROL_SEALED_FAIL",
      signature: false,
    },
    {
      runId: "g17-envelope-inconclusive",
      elapsedNs: (coordinates) =>
        ((coordinates.globalBlock + coordinates.slot) % 2 === 0
          ? 65_000
          : 160_000) +
        offset(coordinates) +
        (coordinates.controlName === "negativeControl" &&
        coordinates.arm === "subject"
          ? 20_000
          : 0),
      outcome: "CONTROL_SEALED_INCONCLUSIVE",
      signature: false,
    },
  ];
  for (const expected of cases) {
    const fixture = createG17ControlReceiptFixture({
      controlRunId: expected.runId,
      elapsedNs: expected.elapsedNs,
    });
    const { owner } = await sealFixture(t, fixture);
    const replay = await owner.replay({ controlRunId: expected.runId });
    assertReplayShape(replay, false);
    assert.equal(replay.outcome, expected.outcome);
    assert.equal(
      replay.candidateReplay.negativeControlSignature !== null,
      expected.signature,
    );
    assert.equal(replay.finalDecisionBindingAvailable, false);
    assert.equal(replay.prospectiveFinalDecisionBinding, null);
    assert.deepEqual(replay.authority, AUTHORITY);
  }
});

test("production-shaped APIs reject claimed fields, accessors, symbols, and foreign prototypes", async (t) => {
  const { owner } = await temporaryStorage(t);
  const fixture = createG17ControlReceiptFixture();
  const options = sealOptions(fixture);
  await assert.rejects(
    owner.seal({ ...options, authorizationRawSha256: "0".repeat(64) }),
    /fields are not exact/u,
  );
  let reads = 0;
  const accessor = { ...options };
  Object.defineProperty(accessor, "receiptBytes", {
    enumerable: true,
    get() {
      reads += 1;
      return options.receiptBytes;
    },
  });
  await assert.rejects(owner.seal(accessor), /enumerable data field/u);
  assert.equal(reads, 0);
  const symbol = { ...options, [Symbol("claim")]: true };
  await assert.rejects(owner.seal(symbol), /symbol fields/u);
  await assert.rejects(
    owner.seal(Object.assign(Object.create(null), options)),
    /ordinary object/u,
  );
  await assert.rejects(
    owner.replay({
      controlRunId: fixture.controlRunId,
      binding: {},
    }),
    /fields are not exact/u,
  );
  let replayReads = 0;
  const replayAccessor = {};
  Object.defineProperty(replayAccessor, "controlRunId", {
    enumerable: true,
    get() {
      replayReads += 1;
      return fixture.controlRunId;
    },
  });
  await assert.rejects(owner.replay(replayAccessor), /enumerable data field/u);
  assert.equal(replayReads, 0);
  await assert.rejects(
    owner.replay({
      controlRunId: fixture.controlRunId,
      [Symbol("authority")]: true,
    }),
    /symbol fields/u,
  );
  await assert.rejects(
    owner.replay(
      Object.assign(Object.create(null), {
        controlRunId: fixture.controlRunId,
      }),
    ),
    /ordinary object/u,
  );
});

test("invalid candidate bytes fail before a run directory is created", async (t) => {
  const { root, owner } = await temporaryStorage(t);
  const fixture = createG17ControlReceiptFixture();
  for (const field of [
    "authorizationBytes",
    "ownerBatchBytes",
    "receiptBytes",
  ]) {
    const options = sealOptions(fixture);
    options[field][0] ^= 1;
    await assert.rejects(owner.seal(options), /G1\.7 control receipt/u, field);
    assert.deepEqual(await readdir(root), [], field);
  }
});

test("write-once sealing rejects an existing run without replacing bytes", async (t) => {
  const { owner, fixture, runPath } = await sealFixture(t);
  const before = await readFile(join(runPath, G17_CONTROL_RECEIPT_NAME));
  await assert.rejects(owner.seal(sealOptions(fixture)), /already exists/u);
  assert.deepEqual(
    await readFile(join(runPath, G17_CONTROL_RECEIPT_NAME)),
    before,
  );
});

test("every pre-seal crash state remains forensic, non-reusable, and non-replayable", async (t) => {
  const phases = G17_CONTROL_ENVELOPE_SEAL_CHECKPOINTS.slice(
    0,
    G17_CONTROL_ENVELOPE_SEAL_CHECKPOINTS.indexOf("directory-sealed"),
  );
  for (const [index, stoppedAt] of phases.entries()) {
    const fixture = createG17ControlReceiptFixture({
      controlRunId: `g17-envelope-crash-${index}`,
    });
    const { owner } = await temporaryStorage(t, ({ phase }) => {
      if (phase === stoppedAt) throw new Error(`injected crash at ${phase}`);
    });
    await assert.rejects(
      owner.seal(sealOptions(fixture)),
      /injected crash|G1\.7/u,
    );
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      ENVELOPE_ERROR,
    );
    await assert.rejects(owner.seal(sealOptions(fixture)), /already exists/u);
  }
});

test("the observed receipt-last sequence matches an independent literal contract", async (t) => {
  const trace = [];
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-receipt-last-trace",
  });
  const { owner } = await temporaryStorage(t, ({ phase }) => {
    trace.push(phase);
  });
  assert.deepEqual(
    [...G17_CONTROL_ENVELOPE_SEAL_CHECKPOINTS],
    [...EXPECTED_SEAL_CHECKPOINTS],
  );
  await owner.seal(sealOptions(fixture));
  assert.deepEqual(trace, [...EXPECTED_SEAL_CHECKPOINTS]);
  assert.equal(new Set(trace).size, trace.length);
  assert.ok(
    trace.indexOf("artifacts-directory-synced") <
      trace.indexOf("before-receipt-create"),
  );
  assert.ok(
    trace.indexOf("owner-batch-sealed") <
      trace.indexOf("before-receipt-create"),
  );
  assert.ok(
    trace.indexOf("before-receipt-create") < trace.indexOf("receipt-created"),
  );
});

test("seal reopens and verifies every exact byte after the directory is sealed", async (t) => {
  let mutated = false;
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-post-seal-replay",
  });
  const { owner } = await temporaryStorage(t, async ({ phase, runPath }) => {
    if (phase !== "directory-sealed" || mutated) return;
    mutated = true;
    const path = join(runPath, G17_CONTROL_AUTHORIZATION_NAME);
    const bytes = await readFile(path);
    bytes[0] ^= 1;
    await chmod(runPath, 0o700);
    await chmod(path, 0o600);
    await writeFile(path, bytes);
    await chmod(path, 0o400);
    await chmod(runPath, 0o500);
  });
  await assert.rejects(
    owner.seal(sealOptions(fixture)),
    /post-seal|control authorization|control receipt|sealed control envelope replay/u,
  );
  await assert.rejects(
    owner.replay({ controlRunId: fixture.controlRunId }),
    /control authorization|control receipt/u,
  );
});

test("held-descriptor filesystem classification rejects a tmpfs root", async (t) => {
  const sharedMemoryRoot = "/dev/shm";
  const filesystem = await statfs(sharedMemoryRoot, { bigint: true }).catch(
    () => null,
  );
  if (filesystem?.type !== 0x0102_1994n) {
    t.skip("reviewed tmpfs fixture is unavailable on this host");
    return;
  }
  const root = await mkdtemp(join(sharedMemoryRoot, "oxigraph-g17-envelope-"));
  await chmod(root, 0o700);
  t.after(async () => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  });
  const owner = createG17ControlEnvelopeOwnerForTesting({
    envelopesRoot: root,
  });
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-tmpfs-rejected",
  });
  await assert.rejects(owner.seal(sealOptions(fixture)), /non-tmpfs/u);
  assert.deepEqual(await readdir(root), []);
});

test("root aliases, root modes, and run-directory modes fail closed", async (t) => {
  {
    const { root, owner } = await temporaryStorage(t);
    await chmod(root, 0o755);
    const fixture = createG17ControlReceiptFixture({
      controlRunId: "g17-envelope-root-mode",
    });
    await assert.rejects(
      owner.seal(sealOptions(fixture)),
      /exact owner directory/u,
    );
  }
  {
    const base = await mkdtemp(join(tmpdir(), "oxigraph-g17-root-alias-"));
    const actual = join(base, "actual");
    const alias = join(base, "alias");
    await mkdir(actual, { mode: 0o700 });
    await chmod(actual, 0o700);
    await symlink(actual, alias);
    t.after(async () => {
      await makeWritable(base);
      await rm(base, { recursive: true, force: true });
    });
    const owner = createG17ControlEnvelopeOwnerForTesting({
      envelopesRoot: alias,
    });
    const fixture = createG17ControlReceiptFixture({
      controlRunId: "g17-envelope-root-alias",
    });
    await assert.rejects(
      owner.seal(sealOptions(fixture)),
      /cannot be a symlink/u,
    );
  }
  {
    const { owner, fixture, runPath } = await sealFixture(
      t,
      createG17ControlReceiptFixture({
        controlRunId: "g17-envelope-run-mode",
      }),
    );
    await chmod(runPath, 0o700);
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /exact owner directory/u,
    );
  }
});

test("a root owned by another uid fails closed when the host can create it", async (t) => {
  if (process.getuid() !== 0) {
    t.skip("wrong-uid fixture requires a privileged test host");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-wrong-owner-"));
  await chmod(root, 0o700);
  await chown(root, 65_534, 65_534);
  t.after(async () => {
    await chown(root, 0, 0).catch(() => {});
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  });
  const owner = createG17ControlEnvelopeOwnerForTesting({
    envelopesRoot: root,
  });
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-wrong-owner",
  });
  await assert.rejects(
    owner.seal(sealOptions(fixture)),
    /exact owner directory/u,
  );
});

test("post-directory-seal failures are replayable current state but do not prove durability", async (t) => {
  for (const stoppedAt of ["directory-sealed", "parent-synced"]) {
    const fixture = createG17ControlReceiptFixture({
      controlRunId: `g17-envelope-lost-response-${stoppedAt}`,
    });
    const { owner } = await temporaryStorage(t, ({ phase }) => {
      if (phase === stoppedAt) throw new Error(`lost response at ${phase}`);
    });
    await assert.rejects(owner.seal(sealOptions(fixture)), /lost response/u);
    const replay = await owner.replay({ controlRunId: fixture.controlRunId });
    assert.equal(replay.finalDecisionBindingAvailable, true);
    assert.equal(replay.storage.currentStateStable, true);
    assert.equal(replay.storage.crashDurability, false);
    assert.equal(replay.storage.filesystemFlushDurability, false);
  }
});

test("sealed replay rejects wrong modes, hardlinks, missing entries, and extras", async (t) => {
  {
    const { owner, fixture, runPath } = await sealFixture(t);
    await chmod(runPath, 0o700);
    await chmod(join(runPath, G17_BENCHMARK_OWNER_BATCH_NAME), 0o600);
    await chmod(runPath, 0o500);
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /exact sealed regular file/u,
    );
  }
  {
    const { root, owner, fixture, runPath } = await sealFixture(t);
    await link(
      join(runPath, G17_CONTROL_RECEIPT_NAME),
      join(root, "receipt-hardlink"),
    );
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /exact sealed regular file/u,
    );
  }
  {
    const { owner, fixture, runPath } = await sealFixture(t);
    await chmod(runPath, 0o700);
    await unlink(join(runPath, G17_CONTROL_RECEIPT_NAME));
    await chmod(runPath, 0o500);
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /inventory is not exact/u,
    );
  }
  {
    const { owner, fixture, runPath } = await sealFixture(t);
    await chmod(runPath, 0o700);
    await writeFile(join(runPath, "unreviewed.json"), Buffer.from("{}\n"), {
      mode: 0o400,
    });
    await chmod(join(runPath, "unreviewed.json"), 0o400);
    await chmod(runPath, 0o500);
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /inventory is not exact/u,
    );
  }
});

test("symlink, directory, and run-path substitution reject without blocking", async (t) => {
  const substitutions = [
    [
      "symlink",
      async (path, runPath) => symlink(G17_CONTROL_RECEIPT_NAME, path),
    ],
    ["directory", async (path) => mkdir(path, { mode: 0o400 })],
  ];
  for (const [kind, substitute] of substitutions) {
    const { owner, fixture, runPath } = await sealFixture(t);
    const authorizationPath = join(runPath, G17_CONTROL_AUTHORIZATION_NAME);
    await chmod(runPath, 0o700);
    await unlink(authorizationPath);
    await substitute(authorizationPath, runPath);
    await chmod(runPath, 0o500);
    const started = Date.now();
    await assert.rejects(
      owner.replay({ controlRunId: fixture.controlRunId }),
      /entry type|cannot be opened safely|exact sealed/u,
      kind,
    );
    assert.ok(Date.now() - started < 1_000, `${kind} rejection blocked`);
  }

  const { root, owner, fixture, runPath } = await sealFixture(t);
  const displaced = `${runPath}.displaced`;
  await rename(runPath, displaced);
  await symlink(displaced, runPath);
  await assert.rejects(
    owner.replay({ controlRunId: fixture.controlRunId }),
    /cannot be a symlink/u,
  );
  assert.equal(dirname(runPath), root);
});

test("FIFO substitution is killed on timeout instead of hanging the test worker", async (t) => {
  const { root, fixture, runPath } = await sealFixture(t);
  const stagedFifo = join(root, "staged-authorization-fifo");
  await executeFile("/usr/bin/mkfifo", [stagedFifo]);
  const moduleUrl = new URL(
    "../src/qualification/control-envelope.mjs",
    import.meta.url,
  ).href;
  const script = `
    import { chmod, rename, unlink } from "node:fs/promises";
    import { join } from "node:path";
    import {
      G17_CONTROL_AUTHORIZATION_NAME,
      createG17ControlEnvelopeOwnerForTesting,
    } from ${JSON.stringify(moduleUrl)};
    const [root, runId, fifo] = process.argv.slice(1);
    let substituted = false;
    const owner = createG17ControlEnvelopeOwnerForTesting({
      envelopesRoot: root,
      onCheckpoint: async ({ phase, runPath }) => {
        if (phase !== "initial-inventory" || substituted) return;
        substituted = true;
        await chmod(runPath, 0o700);
        await unlink(join(runPath, G17_CONTROL_AUTHORIZATION_NAME));
        await rename(fifo, join(runPath, G17_CONTROL_AUTHORIZATION_NAME));
        await chmod(runPath, 0o500);
      },
    });
    try {
      await owner.replay({ controlRunId: runId });
      console.log("UNEXPECTED_REPLAY");
      process.exitCode = 2;
    } catch (error) {
      console.log("REJECTED:" + error.message);
    }
  `;
  const { stdout } = await executeFile(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      script,
      root,
      fixture.controlRunId,
      stagedFifo,
    ],
    { timeout: 1_000, killSignal: "SIGKILL" },
  );
  assert.match(stdout, /^REJECTED:G1\.7 control envelope:/u);
  assert.equal(runPath, join(root, fixture.controlRunId));
});

test("stable replay catches inventory churn and same-name inode replacement", async (t) => {
  {
    let changed = false;
    const fixture = createG17ControlReceiptFixture({
      controlRunId: "g17-envelope-inventory-race",
    });
    const storage = await temporaryStorage(t, async ({ phase, runPath }) => {
      if (phase === "receipt-read" && !changed) {
        changed = true;
        await chmod(runPath, 0o700);
        const extra = join(runPath, "raced.json");
        await writeFile(extra, Buffer.from("{}\n"));
        await chmod(extra, 0o400);
        await chmod(runPath, 0o500);
      }
    });
    await storage.owner.seal(sealOptions(fixture));
    changed = false;
    await assert.rejects(
      storage.owner.replay({ controlRunId: fixture.controlRunId }),
      /inventory|directory changed/u,
    );
  }
  {
    let changed = false;
    const fixture = createG17ControlReceiptFixture({
      controlRunId: "g17-envelope-inode-race",
    });
    const storage = await temporaryStorage(t, async ({ phase, runPath }) => {
      if (phase === "receipt-read" && !changed) {
        changed = true;
        const receiptPath = join(runPath, G17_CONTROL_RECEIPT_NAME);
        const displaced = join(storage.root, "displaced-receipt.json");
        const bytes = await readFile(receiptPath);
        await chmod(runPath, 0o700);
        await rename(receiptPath, displaced);
        await writeFile(receiptPath, bytes);
        await chmod(receiptPath, 0o400);
        await chmod(runPath, 0o500);
      }
    });
    await storage.owner.seal(sealOptions(fixture));
    changed = false;
    await assert.rejects(
      storage.owner.replay({ controlRunId: fixture.controlRunId }),
      /pathname changed|root changed|stable read changed/u,
    );
  }
});

test("stable replay catches whole-run pathname replacement after pure replay", async (t) => {
  let changed = false;
  const fixture = createG17ControlReceiptFixture({
    controlRunId: "g17-envelope-run-race",
  });
  const storage = await temporaryStorage(t, async ({ phase, runPath }) => {
    if (phase === "candidate-replayed" && !changed) {
      changed = true;
      await rename(runPath, `${runPath}.displaced`);
      await mkdir(runPath, { mode: 0o500 });
      await chmod(runPath, 0o500);
    }
  });
  await storage.owner.seal(sealOptions(fixture));
  changed = false;
  await assert.rejects(
    storage.owner.replay({ controlRunId: fixture.controlRunId }),
    /pathname changed|inventory|directory changed/u,
  );
});

test("stored byte tampering is rejected even after owner modes are restored", async (t) => {
  const { owner, fixture, runPath } = await sealFixture(t);
  const receiptPath = join(runPath, G17_CONTROL_RECEIPT_NAME);
  const bytes = await readFile(receiptPath);
  bytes[0] ^= 1;
  await chmod(runPath, 0o700);
  await chmod(receiptPath, 0o600);
  await writeFile(receiptPath, bytes);
  await chmod(receiptPath, 0o400);
  await chmod(runPath, 0o500);
  await assert.rejects(
    owner.replay({ controlRunId: fixture.controlRunId }),
    /G1\.7 control receipt/u,
  );
});

test("frozen file, count, and aggregate ceilings fail before allocation", () => {
  assert.equal(G17_CONTROL_ENVELOPE_LIMITS.maxFiles, 128);
  assert.equal(G17_CONTROL_ENVELOPE_LIMITS.maxFileBytes, 67_108_864);
  assert.equal(G17_CONTROL_ENVELOPE_LIMITS.maxAggregateBytes, 268_435_456);
  assert.deepEqual(
    validateG17ControlEnvelopeBudget({
      fileSizes: Array.from({ length: 128 }, () => 1n),
    }),
    { files: 128, aggregateBytes: "128" },
  );
  assert.deepEqual(
    validateG17ControlEnvelopeBudget({
      fileSizes: Array.from({ length: 4 }, () => 67_108_864n),
    }),
    { files: 4, aggregateBytes: "268435456" },
  );
  assert.throws(
    () =>
      validateG17ControlEnvelopeBudget({
        fileSizes: Array.from({ length: 129 }, () => 1n),
      }),
    /file count/u,
  );
  assert.throws(
    () => validateG17ControlEnvelopeBudget({ fileSizes: [67_108_865n] }),
    /file size/u,
  );
  assert.throws(
    () => validateG17ControlEnvelopeBudget({ fileSizes: [0n] }),
    /file size/u,
  );
  assert.throws(
    () =>
      validateG17ControlEnvelopeBudget({
        fileSizes: Array.from({ length: 5 }, () => 53_687_092n),
      }),
    /aggregate bytes/u,
  );
  assert.throws(
    () =>
      validateG17ControlEnvelopeBudget({
        fileSizes: [BigInt(Number.MAX_SAFE_INTEGER) + 1n],
      }),
    /file size/u,
  );
  const sparse = [1n, 2n];
  delete sparse[1];
  assert.throws(
    () => validateG17ControlEnvelopeBudget({ fileSizes: sparse }),
    /file count|dense data fields/u,
  );
  const accessor = [1n];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      throw new Error("array accessor must not execute");
    },
  });
  assert.throws(
    () => validateG17ControlEnvelopeBudget({ fileSizes: accessor }),
    /dense data fields/u,
  );
  const foreign = [1n];
  Object.setPrototypeOf(foreign, null);
  assert.throws(
    () => validateG17ControlEnvelopeBudget({ fileSizes: foreign }),
    /file count/u,
  );
});

test("prospective physical binding matches the v3 final-decision shape without authorizing qualification", async (t) => {
  const { owner, fixture } = await sealFixture(t);
  const physical = await owner.replay({
    controlRunId: fixture.controlRunId,
  });
  const prerequisite = acceptedG14bProjection();
  assert.equal(
    canonicalSha256(prerequisite),
    G17_FINAL_DECISION_PROTOCOL.prerequisite.expectedProjectionSha256,
  );
  const proposed = loadG17ControlProtocol({
    contract: loadG17Contract().contract,
  });
  const finalDecisionSet = structuredClone(proposed.finalDecisionSet);
  finalDecisionSet.status = "APPROVED";
  finalDecisionSet.controlAuthorization = {
    schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
    rawSha256: physical.prospectiveFinalDecisionBinding.authorizationRawSha256,
    contentHash:
      physical.prospectiveFinalDecisionBinding.authorizationContentHash,
  };
  finalDecisionSet.controlReceipt = structuredClone(
    physical.prospectiveFinalDecisionBinding,
  );
  finalDecisionSet.negativeControlSignature = structuredClone(
    physical.candidateReplay.negativeControlSignature,
  );
  finalDecisionSet.g14bPrerequisite = {
    schema: G17_G14B_PREREQUISITE_SCHEMA,
    status: "PASS",
    projectionSha256: canonicalSha256(prerequisite),
    bindingSha256: prerequisite.bindingSha256,
  };
  finalDecisionSet.approval = {
    status: "APPROVED",
    approvedBy: "synthetic-schema-compatibility-fixture",
    approvedAt: "2026-08-28T08:03:00.000Z",
  };
  const { contentHash: ignored, ...unsigned } = finalDecisionSet;
  finalDecisionSet.contentHash = canonicalSha256(unsigned);
  assert.equal(
    validateG17FinalDecisionSet(finalDecisionSet).status,
    "APPROVED",
  );
  const gate = validateG17FinalDecisionBinding({
    authorization: fixture.authorization,
    authorizationRawSha256: sha256(fixture.authorizationBytes),
    finalDecisionSet,
    qualificationStartedAt: "2026-08-28T08:04:00.000Z",
    g14bPrerequisiteProjection: prerequisite,
  });
  assert.equal(gate.controlReceiptReplayAvailable, false);
  assert.equal(gate.qualificationExecutionAuthorized, false);
  assert.equal(gate.promotionAuthority, false);
  assert.equal(gate.publicationAuthority, false);
});

test("physical dependency remains one-way and imports no execution owner", async () => {
  const closure = await localImportClosure(
    "../src/qualification/control-envelope.mjs",
  );
  const physical = closure.sources.get(
    new URL("../src/qualification/control-envelope.mjs", import.meta.url).href,
  );
  const pure = await readFile(
    new URL(
      "../src/qualification/control-receipt-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(physical, /from "\.\/control-receipt-contract\.mjs"/u);
  for (const forbidden of [
    "node:child_process",
    "/runtime/control-identity.mjs",
    "/runtime/storage.mjs",
    "/native/",
    "/qualification/runner.mjs",
    "/qualification/benchmark.mjs",
    "native-application.mjs",
    "native-workspace.mjs",
    "provider",
    "@metaharness/darwin",
  ]) {
    assert.equal(
      [...closure.specifiers].some((specifier) =>
        specifier.includes(forbidden),
      ),
      false,
      `physical import closure reached forbidden owner dependency: ${forbidden}`,
    );
  }
  for (const [url, source] of closure.sources) {
    assert.doesNotMatch(
      source,
      /\bimport\s*\(\s*(?!["'])/u,
      `physical import closure contains a computed dynamic import: ${url}`,
    );
  }
  await executeFile(
    "/usr/bin/git",
    ["check-ignore", "--quiet", "--no-index", "--", g17ControlEnvelopesRoot],
    { cwd: new URL("../../../", import.meta.url) },
  );
  assert.doesNotMatch(pure, /control-envelope\.mjs/u);
  assert.match(pure, /binding: null/u);
  assert.match(pure, /finalDecisionEligible: false/u);
});
