import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, endianness, platform, release, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as statefs from "../src/candidate/containment-guardian-statefs-v1.mjs";
import * as lifetimeOwner from "../src/candidate/containment-guardian-lifetime-v1.mjs";
import * as recoveryOwner from "../src/candidate/containment-guardian-recovery-v1.mjs";
import * as ownerFixtures from "./candidate-containment-guardian-recovery-v1.fixture.mjs";

const HEADER_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-v1.h",
  import.meta.url,
);
const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-v1.c",
  import.meta.url,
);
const ATTESTATION_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs",
  import.meta.url,
);
const ADR_URL = new URL(
  "../../../docs/adr/0037-durable-containment-statefs-and-manager-protocol.md",
  import.meta.url,
);
const STATEFS_SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-statefs-v1.mjs",
  import.meta.url,
);
const STATEFS_EVALUATOR_URL = new URL(
  "./candidate-containment-guardian-statefs-v1.test.mjs",
  import.meta.url,
);
const SYSCALL_EVALUATOR_URL = new URL(
  "./candidate-containment-guardian-statefs-syscalls-v1.test.mjs",
  import.meta.url,
);
const FAULT_EVALUATOR_URL = new URL(
  "./candidate-containment-guardian-statefs-syscalls-v1-faults.test.mjs",
  import.meta.url,
);
const PACKAGE_URL = new URL("../package.json", import.meta.url);
const LOCK_URL = new URL("../package-lock.json", import.meta.url);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const array = (...values) => Object.freeze(values);
const record = (...entries) => {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return Object.freeze(value);
};
const pairs = (...entries) =>
  array(...entries.map(([key, value]) => array(key, value)));

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function canonicalJson(value, ancestors = new WeakSet()) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    assert.equal(Object.is(value, -0), false);
    return JSON.stringify(value);
  }
  assert.equal(typeof value, "object");
  assert.equal(ancestors.has(value), false);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((child) => canonicalJson(child, ancestors)).join(",")}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function countExact(source, needle) {
  assert.equal(typeof source, "string");
  assert.equal(typeof needle, "string");
  assert.notEqual(needle.length, 0);
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function replaceExactly(source, before, after, label) {
  assert.equal(countExact(source, before), 1, label);
  return source.replace(before, after);
}

function removeRangeExactly(source, start, end, label) {
  assert.equal(countExact(source, start), 1, `${label} start`);
  assert.equal(countExact(source, end), 1, `${label} end`);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.equal(endIndex > startIndex, true, `${label} order`);
  return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
}

function reconstructPreR13FPrivateEvaluatorSource(source) {
  let reconstructed = source;
  reconstructed = replaceExactly(
    reconstructed,
    [
      "function reconstructPreR13PrivateEvaluatorSource(source) {",
      "  source = reconstructPreR13FPrivateEvaluatorSource(source);",
      "  let reconstructed = source;",
    ].join("\n"),
    [
      "function reconstructPreR13PrivateEvaluatorSource(source) {",
      "  let reconstructed = source;",
    ].join("\n"),
    "R13F older inverse forwarding",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      '        ["ownerGid", profile.effectiveGid],',
      '        ["statxMask", rootContext.identity.mask],',
      '        ["filesystemMagic", profile.filesystemMagic.toString(10)],',
    ].join("\n"),
    [
      '        ["ownerGid", profile.effectiveGid],',
      '        ["filesystemMagic", profile.filesystemMagic.toString(10)],',
    ].join("\n"),
    "R13F held-root decoded observation inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    '\n\ntest("R13F held-root mask fixture correction inversely reconstructs the exact R13E evaluator", async () => {\n',
    '\n\ntest("R13 private totality correction inversely reconstructs the exact pre-R13 evaluator", async () => {\n',
    "R13F inverse proof",
  );
  return removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR13FPrivateEvaluatorSource(source) {\n",
    "\n\nfunction reconstructPreR13PrivateEvaluatorSource(source) {\n",
    "R13F inverse helper",
  );
}

function reconstructPreR13PrivateEvaluatorSource(source) {
  source = reconstructPreR13FPrivateEvaluatorSource(source);
  let reconstructed = source;
  const pinReplacements = [
    [
      [
        '    label: "ADR-0037",',
        "    url: ADR_URL,",
        "    bytes: 216688,",
        "    lines: 3638,",
        '    sha256: "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",',
        '    blob: "49b0467887646ee05126a593d28e78bebff6f78f",',
      ].join("\n"),
      [
        '    label: "ADR-0037",',
        "    url: ADR_URL,",
        "    bytes: 204827,",
        "    lines: 3458,",
        '    sha256: "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
        '    blob: "d3b0bfebdf336036e6d723ce0ee7ce85d26a4231",',
      ].join("\n"),
      "R13 private ADR pin inverse",
    ],
    [
      [
        '    label: "S2 statefs source",',
        "    url: STATEFS_SOURCE_URL,",
        "    bytes: 189577,",
        "    lines: 6242,",
        '    sha256: "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",',
        '    blob: "c452f04d9b64719dcd6b0392ee019578811aa263",',
      ].join("\n"),
      [
        '    label: "S2 statefs source",',
        "    url: STATEFS_SOURCE_URL,",
        "    bytes: 190954,",
        "    lines: 6299,",
        '    sha256: "240c7f3a34cc609ed65c3d6c4b4f255780f6e1562d4d689bf42b445529dd90f2",',
        '    blob: "a59c48fa21bc31cf8dcb646fb9a298569a1840de",',
      ].join("\n"),
      "R13 private StateFS source pin inverse",
    ],
    [
      [
        '    label: "S2 statefs evaluator",',
        "    url: STATEFS_EVALUATOR_URL,",
        "    bytes: 386695,",
        "    lines: 11305,",
        '    sha256: "7b79d1ab3c28289a2db9a262552c44c3e866e087b408e37d1898365d27b91651",',
        '    blob: "fc45c3975f6c4901bd89ba362a0816b51efb61be",',
      ].join("\n"),
      [
        '    label: "S2 statefs evaluator",',
        "    url: STATEFS_EVALUATOR_URL,",
        "    bytes: 324808,",
        "    lines: 9548,",
        '    sha256: "0170540e8cd68d233b2e6c01df6cbeca3a9be44dabc59570b09c4b9d48a08c8c",',
        '    blob: "6d808b107ed9bda6b2195c035e6a3ad2a6066c9d",',
      ].join("\n"),
      "R13 private StateFS evaluator pin inverse",
    ],
    [
      [
        '    label: "S3 syscall evaluator",',
        "    url: SYSCALL_EVALUATOR_URL,",
        "    bytes: 166676,",
        "    lines: 4955,",
        '    sha256: "4da18be9ae8dcf04288482aa728acccf7281054cd69061f3227353ecc24dd24c",',
        '    blob: "b7eae6e8f5a9724ad6d2b9963785faf9d76ca1b0",',
      ].join("\n"),
      [
        '    label: "S3 syscall evaluator",',
        "    url: SYSCALL_EVALUATOR_URL,",
        "    bytes: 147416,",
        "    lines: 4459,",
        '    sha256: "75b60e1ebfe8322f804e715ca926cd7ed943289acc77834488cd9b019470b909",',
        '    blob: "e07e312de2b0d7102afd9dd9f613bf495ca8cc77",',
      ].join("\n"),
      "R13 private P2 pin inverse",
    ],
    [
      [
        '    label: "S3 fault evaluator",',
        "    url: FAULT_EVALUATOR_URL,",
        "    bytes: 182254,",
        "    lines: 5400,",
        '    sha256: "108dbfe0235ee9fed7d17d0a2352a0184e7eda74a39a77f59d5f5efd8353627a",',
        '    blob: "f09c812da56dd9c45c90ee8a5af38266e9856245",',
      ].join("\n"),
      [
        '    label: "S3 fault evaluator",',
        "    url: FAULT_EVALUATOR_URL,",
        "    bytes: 146152,",
        "    lines: 4406,",
        '    sha256: "b8fa23d4fd6238f175da41a3348ecac592c2777b2fc44df82c0c90d371cc9774",',
        '    blob: "864588a504d506fd1b94a33717797b0b9d72299e",',
      ].join("\n"),
      "R13 private P3 pin inverse",
    ],
  ];
  for (const [before, after, label] of pinReplacements) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }
  for (const [before, after, label] of [
    [
      [
        '["ownerGid", 72], ["statx',
        'Mask", 76], ["filesystemMagic", 80]',
      ].join(""),
      '["ownerGid", 72], ["flags", 76], ["filesystemMagic", 80]',
      "R13 private ABI field inverse",
    ],
    [
      'const EXPECTED_STATEFS_REQUIREMENTS_SHA256 =\n  "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42";',
      'const EXPECTED_STATEFS_REQUIREMENTS_SHA256 =\n  "9edea8e3e4a7e4e9679b338635ec9d9768ac159fde531ba6e4966498c8d025d1";',
      "R13 private requirements inverse",
    ],
    [
      [
        "      assert.equal(",
        "        nameBytes.every(",
        "          (byte) => byte >= 0x01 && byte <= 0x7f && byte !== 0x2f,",
        "        ),",
        "        true,",
        "      );",
      ].join("\n"),
      "      assert.equal(nameBytes.every((byte) => byte >= 0x20 && byte <= 0x7e), true);",
      "R13 private cleanup raw-name inverse",
    ],
    [
      [
        "    observations: Buffer.alloc(observationCapacity * 384, ",
        "0xa5),",
      ].join(""),
      "    observations: Buffer.alloc(observationCapacity * 384),",
      "R13 private observation prefill inverse",
    ],
    [
      [
        "  assert.equal(bytes.readUInt32LE(offset), 384);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 360), 0n);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 368), 0n);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 376), 0n);",
        "  const kind = exactEnumName(",
        "    OBSERVATION_KIND_NAMES,",
        "    bytes.readUInt32LE(offset + 4),",
        '    "observation kind",',
        "  );",
      ].join("\n"),
      [
        "  assert.equal(bytes.readUInt32LE(offset), 384);",
        "  assert.equal(bytes.readUInt32LE(offset + 76), 0);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 360), 0n);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 368), 0n);",
        "  assert.equal(bytes.readBigUInt64LE(offset + 376), 0n);",
      ].join("\n"),
      "R13 private decoder kind ordering inverse",
    ],
    [
      [
        "  assert.equal(",
        "    rawObservedName.every(",
        "      (byte) => byte >= 0x01 && byte <= 0x7f && byte !== 0x2f,",
        "    ),",
        "    true,",
        "  );",
      ].join("\n"),
      [
        "  assert.equal(",
        "    rawObservedName.every((byte) => byte >= 0x20 && byte <= 0x7e),",
        "    true,",
        "  );",
      ].join("\n"),
      "R13 private decoder raw-name inverse",
    ],
    [
      [
        '  const name = nameLength === 0 ? null : rawObservedName.toString("ascii");',
        '  assert.equal(name !== "." && name !== "..", true);',
        "  const statxMask = bytes.readUInt32LE(offset + 76);",
        "  assert.equal(",
        '    kind === "ABSENT" ? statxMask === 0 : (statxMask & 0x17ff) === 0x17ff,',
        "    true,",
        "  );",
        "  const role = exactEnumName(",
      ].join("\n"),
      [
        '  const name = nameLength === 0 ? null : rawObservedName.toString("ascii");',
        "  const kind = exactEnumName(",
        "    OBSERVATION_KIND_NAMES,",
        "    bytes.readUInt32LE(offset + 4),",
        '    "observation kind",',
        "  );",
        "  const role = exactEnumName(",
      ].join("\n"),
      "R13 private decoder mask inverse",
    ],
    [
      '      ["ownerGid", bytes.readUInt32LE(offset + 72)],\n      ["statxMask", statxMask],\n      ["filesystemMagic", bytes.readBigUInt64LE(offset + 80).toString(10)],',
      '      ["ownerGid", bytes.readUInt32LE(offset + 72)],\n      ["filesystemMagic", bytes.readBigUInt64LE(offset + 80).toString(10)],',
      "R13 private decoded observation field inverse",
    ],
    [
      [
        "  assert.equal(outputLength <= buffers.output.length, true);",
        "  assert.equal(",
        "    buffers.observations",
        "      .subarray(observationCount * 384)",
        "      .every((byte) => byte === 0),",
        "    true,",
        "  );",
        "  const observations = array(",
      ].join("\n"),
      [
        "  assert.equal(outputLength <= buffers.output.length, true);",
        "  const observations = array(",
      ].join("\n"),
      "R13 private unpublished tail inverse",
    ],
    [
      '    ["ownerGid", identity.ownerGid],\n    ["statxMask", identity.mask],\n    ["filesystemMagic", filesystemMagic.toString(10)],',
      '    ["ownerGid", identity.ownerGid],\n    ["filesystemMagic", filesystemMagic.toString(10)],',
      "R13 private expected native mask inverse",
    ],
    [
      '    ["ownerGid", 0],\n    ["statxMask", 0],\n    ["filesystemMagic", "0"],',
      '    ["ownerGid", 0],\n    ["filesystemMagic", "0"],',
      "R13 private expected absent mask inverse",
    ],
    [
      [
        "  const currentStatefsSourcePin = [",
        '    \'    label: "S2 statefs source",\',',
        '    "    url: STATEFS_SOURCE_URL,",',
        '    "    bytes: 189577,",',
        '    "    lines: 6242,",',
        '    \'    sha256: "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",\',',
        '    \'    blob: "c452f04d9b64719dcd6b0392ee019578811aa263",\',',
        '  ].join("\\n");',
      ].join("\n"),
      [
        "  const currentStatefsSourcePin = [",
        '    \'    label: "S2 statefs source",\',',
        '    "    url: STATEFS_SOURCE_URL,",',
        '    "    bytes: 190954,",',
        '    "    lines: 6299,",',
        '    \'    sha256: "240c7f3a34cc609ed65c3d6c4b4f255780f6e1562d4d689bf42b445529dd90f2",\',',
        '    \'    blob: "a59c48fa21bc31cf8dcb646fb9a298569a1840de",\',',
        '  ].join("\\n");',
      ].join("\n"),
      "R13 private R11C mutation pin inverse",
    ],
    [
      [
        "  const mutatedStatefsSourcePin = currentStatefsSourcePin.replace(",
        '    "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",',
        '    "0feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",',
        "  );",
      ].join("\n"),
      [
        "  const mutatedStatefsSourcePin = currentStatefsSourcePin.replace(",
        '    "240c7f3a34cc609ed65c3d6c4b4f255780f6e1562d4d689bf42b445529dd90f2",',
        '    "040c7f3a34cc609ed65c3d6c4b4f255780f6e1562d4d689bf42b445529dd90f2",',
        "  );",
      ].join("\n"),
      "R13 private R11C mutation digest inverse",
    ],
    [
      [
        '      error?.message.includes("R13 private StateFS ',
        'source pin inverse"),',
      ].join(""),
      '      error?.message.includes("R11C S2 source pin inverse"),',
      "R13 private R11C mutation assertion inverse",
    ],
    [
      "function reconstructPreR11CPrivateEvaluatorSource(source, proofStart, proofEnd) {\n  source = reconstructPreR13PrivateEvaluatorSource(source);",
      "function reconstructPreR11CPrivateEvaluatorSource(source, proofStart, proofEnd) {",
      "R13 private older inverse forwarding",
    ],
  ]) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }

  reconstructed = replaceExactly(
    reconstructed,
    [
      '  assert.equal(decodeNativeObservation(observation, 0).kind, "ABSENT");',
      '  assert.equal(decodeNativeObservation(observation, 0).statxMask, 0);',
      "  const regularObservation = Buffer.from(observation);",
      "  regularObservation.writeUInt32LE(",
      '    OBSERVATION_KIND_NAMES.indexOf("REGULAR"),',
      "    4,",
      "  );",
      "  regularObservation.writeUInt32LE(0x17ff, 76);",
      "  assert.equal(decodeNativeObservation(regularObservation, 0).statxMask, 0x17ff);",
      "  for (const mask of [0x1000, 0x07ff]) {",
      "    const incompleteMask = Buffer.from(regularObservation);",
      "    incompleteMask.writeUInt32LE(mask, 76);",
      "    assert.throws(() => decodeNativeObservation(incompleteMask, 0));",
      "  }",
      "  const extraMask = Buffer.from(regularObservation);",
      "  extraMask.writeUInt32LE((0x17ff | 0x8000_0000) >>> 0, 76);",
      "  assert.equal(",
      "    decodeNativeObservation(extraMask, 0).statxMask,",
      "    (0x17ff | 0x8000_0000) >>> 0,",
      "  );",
      "  const nonzeroAbsentMask = Buffer.from(observation);",
      "  nonzeroAbsentMask.writeUInt32LE(1, 76);",
      "  assert.throws(() => decodeNativeObservation(nonzeroAbsentMask, 0));",
      "  for (const rawByte of [0x01, 0x1f, 0x7f]) {",
      "    const rawNameObservation = Buffer.from(observation);",
      "    rawNameObservation.writeUInt32LE(1, 12);",
      "    rawNameObservation[104] = rawByte;",
      "    assert.equal(",
      "      decodeNativeObservation(rawNameObservation, 0).name.charCodeAt(0),",
      "      rawByte,",
      "    );",
      "  }",
      "  for (const rawName of [",
      "    Buffer.from([0x00]),",
      "    Buffer.from([0x2f]),",
      '    Buffer.from("."),',
      '    Buffer.from(".."),',
      "    Buffer.from([0x80]),",
      "    Buffer.from([0xff]),",
      "  ]) {",
      "    const invalidRawName = Buffer.from(observation);",
      "    invalidRawName.writeUInt32LE(rawName.length, 12);",
      "    rawName.copy(invalidRawName, 104);",
      "    assert.throws(() => decodeNativeObservation(invalidRawName, 0));",
      "  }",
      "  const overlengthName = Buffer.from(observation);",
      "  overlengthName.writeUInt32LE(256, 12);",
      "  assert.throws(() => decodeNativeObservation(overlengthName, 0));",
      "  const malformedKind = Buffer.from(observation);",
    ].join("\n"),
    [
      '  assert.equal(decodeNativeObservation(observation, 0).kind, "ABSENT");',
      "  const malformedKind = Buffer.from(observation);",
    ].join("\n"),
    "R13 private ABI decoder cases inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  const unpublishedPartialSlot = Buffer.alloc(ABI.observation.size);",
      "  unpublishedPartialSlot[0] = 0xa5;",
      "  assert.throws(() =>",
      "    decodeNativeResult(resultSpecification, {",
      "      ...resultBuffers,",
      "      observations: unpublishedPartialSlot,",
      "    }),",
      "  );",
      "",
      "",
    ].join("\n"),
    "",
    "R13 private ABI unpublished-tail case inverse",
  );

  for (const block of [
    [
      "      preR14Bytes: 160288,",
      "      preR14Lines: 4801,",
      '      preR14Sha256: "6fb8848670dc84fad1fa42fdf8f34bfd31ea7876da40361bcff7ddf5ed95be81",',
      '      preR14Blob: "d95a93e4fe0b3ca6b9da5b55dad7672e09253edd",',
      "      preR14Tests: 13,",
      "      preR14CandidateTests: 8,",
      "",
    ].join("\n"),
    [
      "      preR14Bytes: 177918,",
      "      preR14Lines: 5275,",
      '      preR14Sha256: "b3555e754804ed768771dfb1a0541624554be205b348a250fea248c00dfd28a2",',
      '      preR14Blob: "966c0ef49a1868588b38b7e556bf700353417990",',
      "      preR14Tests: 12,",
      "      preR14CandidateTests: 8,",
      "",
    ].join("\n"),
    [
      "      preR13Bytes: 147416,",
      "      preR13Lines: 4459,",
      '      preR13Sha256: "75b60e1ebfe8322f804e715ca926cd7ed943289acc77834488cd9b019470b909",',
      '      preR13Blob: "e07e312de2b0d7102afd9dd9f613bf495ca8cc77",',
      "",
    ].join("\n"),
    [
      "      preR13Bytes: 146152,",
      "      preR13Lines: 4406,",
      '      preR13Sha256: "b8fa23d4fd6238f175da41a3348ecac592c2777b2fc44df82c0c90d371cc9774",',
      '      preR13Blob: "864588a504d506fd1b94a33717797b0b9d72299e",',
      "",
    ].join("\n"),
  ]) {
    reconstructed = replaceExactly(
      reconstructed,
      block,
      "",
      "R13 private S3 preimage fields inverse",
    );
  }
  reconstructed = replaceExactly(
    reconstructed,
    [
      '    const r8Kind =',
      '      item.url.href === SYSCALL_EVALUATOR_URL.href ? "syscall" : "fault";',
      "    source = item.url.href === SYSCALL_EVALUATOR_URL.href",
      "      ? reconstructPreR14P2SourceForPrivate(source)",
      "      : reconstructPreR14P3SourceForPrivate(source);",
      '    const preR14Bytes = Buffer.from(source, "utf8");',
      "    assert.equal(preR14Bytes.length, item.preR14Bytes);",
      '    assert.equal(countExact(source, "\\n"), item.preR14Lines);',
      "    assert.equal(sha256(preR14Bytes), item.preR14Sha256);",
      "    assert.equal(gitBlobSha1(preR14Bytes), item.preR14Blob);",
      '    assert.equal(countExact(source, \'\\ntest("\'), item.preR14Tests);',
      "    assert.equal(",
      '      countExact(source, "\\ncandidateTest("),',
      "      item.preR14CandidateTests,",
      "    );",
      "    source = item.url.href === SYSCALL_EVALUATOR_URL.href",
      "      ? reconstructPreR13P2SourceForPrivate(source)",
      "      : reconstructPreR13P3SourceForPrivate(source);",
      '    const preR13Bytes = Buffer.from(source, "utf8");',
      "    assert.equal(preR13Bytes.length, item.preR13Bytes);",
      '    assert.equal(countExact(source, "\\n"), item.preR13Lines);',
      "    assert.equal(sha256(preR13Bytes), item.preR13Sha256);",
      "    assert.equal(gitBlobSha1(preR13Bytes), item.preR13Blob);",
      "    source = reconstructPreR8S3EvaluatorSource(",
    ].join("\n"),
    [
      '    const r8Kind =',
      '      item.url.href === SYSCALL_EVALUATOR_URL.href ? "syscall" : "fault";',
      "    source = reconstructPreR8S3EvaluatorSource(",
    ].join("\n"),
    "R13 private S3 forwarding inverse",
  );

  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nconst R13_REQUIRED_STATX_MASK = 0x17ff;\n",
    '\n\ntest("pins ADR, S2, S3, package, lock, and immutable StateFS source identities", async () => {\n',
    "R13 private correction block inverse",
  );
  return removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR13PrivateEvaluatorSource(source) {\n",
    "\n\nfunction reconstructPreR11CPrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "R13 private inverse helper removal",
  );
}

function reconstructPreR11CPrivateEvaluatorSource(source, proofStart, proofEnd) {
  source = reconstructPreR13PrivateEvaluatorSource(source);
  const currentStatefsSourcePin = [
    '    label: "S2 statefs source",',
    "    url: STATEFS_SOURCE_URL,",
    "    bytes: 190954,",
    "    lines: 6299,",
    '    sha256: "240c7f3a34cc609ed65c3d6c4b4f255780f6e1562d4d689bf42b445529dd90f2",',
    '    blob: "a59c48fa21bc31cf8dcb646fb9a298569a1840de",',
  ].join("\n");
  const postR12StatefsSourcePin = [
    '    label: "S2 statefs source",',
    "    url: STATEFS_SOURCE_URL,",
    "    bytes: 190998,",
    "    lines: 6299,",
    '    sha256: "07592b9a817074980ae4d5a2d6097b8c56e440554184e836e3a0094f6d9586c9",',
    '    blob: "61c0927541b3b993ed432921a48baf2e07e1ad1d",',
  ].join("\n");
  const currentStatefsEvaluatorPin = [
    '    label: "S2 statefs evaluator",',
    "    url: STATEFS_EVALUATOR_URL,",
    "    bytes: 324808,",
    "    lines: 9548,",
    '    sha256: "0170540e8cd68d233b2e6c01df6cbeca3a9be44dabc59570b09c4b9d48a08c8c",',
    '    blob: "6d808b107ed9bda6b2195c035e6a3ad2a6066c9d",',
  ].join("\n");
  const postR12StatefsEvaluatorPin = [
    '    label: "S2 statefs evaluator",',
    "    url: STATEFS_EVALUATOR_URL,",
    "    bytes: 312547,",
    "    lines: 9199,",
    '    sha256: "dd23977051b54fbd8b6090d84f779de366a53b570149b8395b3bc8cd33d2253e",',
    '    blob: "2e5d483b1097283f7b699a7de518a9126f80ca7a",',
  ].join("\n");
  const correctedPreR12Entry = [
    "function reconstructPreR12PrivateEvaluatorSource(source, proofStart, proofEnd) {",
    "  source = reconstructPreR11CPrivateEvaluatorSource(",
    "    source,",
    '    \'\\n\\ntest("R11C S2 pins inversely reconstruct the exact post-R12 private evaluator", async () => {\\n\',',
    '    \'\\n\\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\\n\',',
    "  );",
  ].join("\n");
  const postR12PreR12Entry =
    "function reconstructPreR12PrivateEvaluatorSource(source, proofStart, proofEnd) {";
  let reconstructed = replaceExactly(
    source,
    currentStatefsSourcePin,
    postR12StatefsSourcePin,
    "R11C S2 source pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    currentStatefsEvaluatorPin,
    postR12StatefsEvaluatorPin,
    "R11C S2 evaluator pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedPreR12Entry,
    postR12PreR12Entry,
    "R11C R12 inverse-chain entry",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR11CPrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "\n\nfunction reconstructPreR12PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "R11C inverse helper",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "R11C proof inverse",
  );
}

function reconstructPreR12PrivateEvaluatorSource(source, proofStart, proofEnd) {
  source = reconstructPreR11CPrivateEvaluatorSource(
    source,
    '\n\ntest("R11C S2 pins inversely reconstruct the exact post-R12 private evaluator", async () => {\n',
    '\n\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\n',
  );
  const correctedPreR10Entry = [
    "function reconstructPreR10PrivateEvaluatorSource(source, proofStart, proofEnd) {",
    "  source = reconstructPreR12PrivateEvaluatorSource(",
    "    source,",
    '    \'\\n\\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\\n\',',
    '    \'\\n\\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\\n\',',
    "  );",
  ].join("\n");
  const acceptedPreR10Entry =
    "function reconstructPreR10PrivateEvaluatorSource(source, proofStart, proofEnd) {";
  const correctedTerminalTest = [
    'test("reports exactly one candidate-attributed missing-triplet RED before native build or filesystem setup", () => {',
    "  assertTerminalAttestationState(",
    "    attestationImportAttempts,",
    "    attestationImportError,",
    "    attestation,",
    "    evaluatorOwnedRoot,",
    "  );",
    "});",
  ].join("\n");
  const acceptedTerminalTest = [
    'test("reports exactly one candidate-attributed missing-triplet RED before native build or filesystem setup", () => {',
    "  assert.equal(attestationImportAttempts, 1);",
    "  assert.equal(evaluatorOwnedRoot, undefined);",
    "  if (attestationImportError !== null) throw attestationImportError;",
    "  assert.notEqual(attestation, null);",
    "});",
  ].join("\n");
  let reconstructed = replaceExactly(
    source,
    correctedPreR10Entry,
    acceptedPreR10Entry,
    "R12 R10 inverse-chain entry",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedTerminalTest,
    acceptedTerminalTest,
    "R12 terminal attribution inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction assertTerminalAttestationState(\n",
    "\n\nlet evaluatorOwnedRoot;\n",
    "R12 terminal helper inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR12PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "\n\nfunction reconstructPreR10PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "R12 inverse helper",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "R12 proof inverse",
  );
}

function reconstructPreR10PrivateEvaluatorSource(source, proofStart, proofEnd) {
  source = reconstructPreR12PrivateEvaluatorSource(
    source,
    '\n\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\n',
    '\n\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\n',
  );
  const correctedPreR9Entry = [
    "function reconstructPreR9PrivateEvaluatorSource(source, proofStart, proofEnd) {",
    "  source = reconstructPreR10PrivateEvaluatorSource(",
    "    source,",
    '    \'\\n\\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\\n\',',
    '    \'\\n\\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\\n\',',
    "  );",
  ].join("\n");
  const acceptedPreR9Entry =
    "function reconstructPreR9PrivateEvaluatorSource(source, proofStart, proofEnd) {";
  const correctedFaultAssertion = [
    "  assertFaultObservations(",
    "    result.observations,",
    "    expectedFaultObservations(profile, faultCase, fixture),",
    "    fixture.plan.request,",
    "  );",
  ].join("\n");
  const acceptedFaultAssertion = [
    "  assert.deepEqual(",
    "    result.observations,",
    "    expectedFaultObservations(profile, faultCase, fixture),",
    "  );",
  ].join("\n");
  let reconstructed = replaceExactly(
    source,
    correctedPreR9Entry,
    acceptedPreR9Entry,
    "R10 R9 inverse-chain entry",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedFaultAssertion,
    acceptedFaultAssertion,
    "R10 fault-observation assertion inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction rawDirectoryObservationNameKey(observation) {\n",
    "\n\nfunction assertFaultNative(result, faultCase, fixture, profile) {\n",
    "R10 directory observation helpers inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR10PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "\n\nfunction reconstructPreR9PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "R10 inverse helper",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "R10 proof inverse",
  );
}

function reconstructPreR9PrivateEvaluatorSource(source, proofStart, proofEnd) {
  source = reconstructPreR10PrivateEvaluatorSource(
    source,
    '\n\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\n',
    '\n\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\n',
  );
  const correctedLinkTemplate = [
    "const BRIDGE_LINK_TEMPLATE = array(",
    '  "/usr/bin/cc",',
    '  "-shared",',
    '  "-B/usr/bin/",',
    '  "-Wl,-z,noexecstack",',
    '  "<BRIDGE_OBJECT>",',
    '  "<ATTESTED_CANDIDATE_OBJECT>",',
    '  "-o",',
    '  "<NATIVE_MODULE>",',
    ");",
  ].join("\n");
  const acceptedLinkTemplate = [
    "const BRIDGE_LINK_TEMPLATE = array(",
    '  "/usr/bin/cc",',
    '  "-shared",',
    '  "-Wl,-z,noexecstack",',
    '  "<BRIDGE_OBJECT>",',
    '  "<ATTESTED_CANDIDATE_OBJECT>",',
    '  "-o",',
    '  "<NATIVE_MODULE>",',
    ");",
  ].join("\n");
  const correctedRuntimeLink = [
    "      const linkArgs = [",
    '        "-shared",',
    '        "-B/usr/bin/",',
    '        "-Wl,-z,noexecstack",',
    "        bridgeObject,",
    "        candidateObject,",
    '        "-o",',
    "        modulePath,",
    "      ];",
    "      assertExactBridgeLinkContract(",
    "        BRIDGE_LINK_TEMPLATE,",
    "        linkArgs,",
    "        bridgeObject,",
    "        candidateObject,",
    "        modulePath,",
    "      );",
    "      exactChild(compiler, linkArgs, REPOSITORY_ROOT);",
  ].join("\n");
  const acceptedRuntimeLink = [
    "      exactChild(",
    "        compiler,",
    "        [",
    '          "-shared",',
    '          "-Wl,-z,noexecstack",',
    "          bridgeObject,",
    "          candidateObject,",
    '          "-o",',
    "          modulePath,",
    "        ],",
    "        REPOSITORY_ROOT,",
    "      );",
  ].join("\n");
  const correctedBridgeAssertion = [
    "  assert.deepEqual(BRIDGE_LINK_TEMPLATE.slice(0, 3), [",
    '    "/usr/bin/cc",',
    '    "-shared",',
    '    "-B/usr/bin/",',
    "  ]);",
  ].join("\n");
  const acceptedBridgeAssertion =
    '  assert.deepEqual(BRIDGE_LINK_TEMPLATE.slice(0, 3), ["/usr/bin/cc", "-shared", "-Wl,-z,noexecstack"]);';
  const correctedR8Chain = [
    "function reconstructPreR8PrivateEvaluatorSource(source, proofStart, proofEnd) {",
    "  source = reconstructPreR9PrivateEvaluatorSource(",
    "    source,",
    '    \'\\n\\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\\n\',',
    '    \'\\n\\ntest("R7 persistence observation correction inversely reconstructs accepted R6 private evaluator", async () => {\\n\',',
    "  );",
  ].join("\n");
  const acceptedR8Chain =
    "function reconstructPreR8PrivateEvaluatorSource(source, proofStart, proofEnd) {";
  let reconstructed = replaceExactly(
    source,
    correctedLinkTemplate,
    acceptedLinkTemplate,
    "R9 link template inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedRuntimeLink,
    acceptedRuntimeLink,
    "R9 runtime link inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedBridgeAssertion,
    acceptedBridgeAssertion,
    "R9 bridge assertion inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedR8Chain,
    acceptedR8Chain,
    "R9 R8 inverse-chain entry",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction assertExactBridgeLinkContract(\n",
    "\n\nconst BRIDGE = deepFreeze(\n",
    "R9 link-contract helper inverse",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR9PrivateEvaluatorSource(source, proofStart, proofEnd) {\n",
    "\n\nfunction reconstructPreR8S3EvaluatorSource(source, proofStart, proofEnd) {\n",
    "R9 inverse helper",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "R9 proof inverse",
  );
}

function reconstructPreR8S3EvaluatorSource(source, proofStart, proofEnd) {
  const functionRangeCorrection = [
    "  const functionBodyRanges = [];",
    "  let declarationStart = 0;",
    "  for (",
    '    let open = masked.indexOf("{");',
    "    open !== -1;",
    '    open = masked.indexOf("{", open + 1)',
    "  ) {",
    "    const header = masked.slice(declarationStart, open).trim();",
    "    const functionName =",
    "      /\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\([^;{}]*\\)\\s*$/u.exec(header)?.[1];",
    "    let depth = 1;",
    "    let close = open + 1;",
    "    for (; close < masked.length && depth > 0; close += 1) {",
    '      if (masked[close] === "{") depth += 1;',
    '      if (masked[close] === "}") depth -= 1;',
    "    }",
    '    assert.equal(depth, 0, "unterminated C function body");',
    "    if (",
    "      functionName !== undefined &&",
    '      !new Set(["if", "for", "while", "switch"]).has(functionName)',
    "    ) {",
    "      functionBodyRanges.push([open + 1, close - 1]);",
    "    }",
    "    open = close - 1;",
    "    declarationStart = close;",
    "  }",
    "",
  ].join("\n");
  const correctedDecision = [
    "    const statementStart =",
    "      Math.max(",
    '        masked.lastIndexOf(";", occurrence.index),',
    '        masked.lastIndexOf("{", occurrence.index),',
    '        masked.lastIndexOf("}", occurrence.index),',
    "      ) + 1;",
    '    const statementEnd = masked.indexOf(";", close + 1);',
    "    const isAllowedLocalRegisterBinding =",
    '      occurrence[0] === "__asm__" &&',
    "      qualifier === null &&",
    "      functionBodyRanges.some(",
    "        ([start, end]) => occurrence.index >= start && occurrence.index < end,",
    "      ) &&",
    "      /^\\s*register\\s+long\\s+[a-zA-Z_][a-zA-Z0-9_]*\\s*$/u.test(",
    "        masked.slice(statementStart, occurrence.index),",
    "      ) &&",
    "      new Set(['\"r10\"', '\"r8\"']).has(",
    "        clean.slice(open + 1, close).trim(),",
    "      ) &&",
    "      statementEnd !== -1 &&",
    "      /^\\s*=\\s*[a-zA-Z_][a-zA-Z0-9_]*\\s*;$/u.test(",
    "        masked.slice(close + 1, statementEnd + 1),",
    "      );",
    "    if (isAllowedLocalRegisterBinding) continue;",
    "    const executableTemplate = clean.slice(open + 1, templateEnd).trim();",
    '    if (executableTemplate !== \'"syscall"\') {',
    "      const fixedImmediate =",
    '        /^"movl \\$([0-9]+), %%eax\\\\n\\\\tsyscall"$/u.exec(executableTemplate);',
    '      assert.notEqual(fixedImmediate, null, "inline-assembly-template");',
    "      assert.equal(",
    "        new Set([",
    '          "0",',
    '          "1",',
    '          "3",',
    '          "72",',
    '          "73",',
    '          "74",',
    '          "138",',
    '          "217",',
    '          "257",',
    '          "258",',
    '          "263",',
    '          "316",',
    '          "332",',
    "        ]).has(fixedImmediate[1]),",
    "        true,",
    '        "inline-assembly-syscall-immediate",',
    "      );",
    "    }",
    "    directSyscallAssemblyCount += 1;",
  ].join("\n");
  const acceptedDecision = [
    "    assert.equal(",
    "      clean.slice(open + 1, templateEnd).trim(),",
    "      '\"syscall\"',",
    '      "inline-assembly-template",',
    "    );",
  ].join("\n");
  let reconstructed = replaceExactly(
    source,
    functionRangeCorrection,
    "",
    "S3 R8 function-range inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    "  let directSyscallAssemblyCount = 0;\n",
    "",
    "S3 R8 counter declaration inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    correctedDecision,
    acceptedDecision,
    "S3 R8 assembly decision inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    '  assert.ok(directSyscallAssemblyCount > 0, "direct syscall assembly required");\n',
    "",
    "S3 R8 counter assertion inverse",
  );
  const originalInverseStart =
    "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(\n";
  const originalInverseEnd = "    currentAdrPin,\n";
  assert.equal(countExact(reconstructed, originalInverseStart), 1);
  assert.equal(countExact(reconstructed, originalInverseEnd), 1);
  const originalInverseStartIndex = reconstructed.indexOf(originalInverseStart);
  const originalInverseEndIndex = reconstructed.indexOf(
    originalInverseEnd,
    originalInverseStartIndex + originalInverseStart.length,
  );
  assert.equal(originalInverseEndIndex > originalInverseStartIndex, true);
  reconstructed = `${reconstructed.slice(0, originalInverseStartIndex)}  let acceptedEvaluatorSource = replaceExactly(\n    currentEvaluatorSource,\n${reconstructed.slice(originalInverseEndIndex)}`;
  reconstructed = removeRangeExactly(
    reconstructed,
    [
      "\n\nfunction reconstruct",
      "PreR8EvaluatorSource(source, proofStart, proofEnd) {\n",
    ].join(""),
    "\n\nfunction assertNoFunctionLocalByteArrays(source) {\n",
    "S3 R8 inverse helper",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "S3 R8 proof inverse",
  );
}

function reconstructPreR8PrivateEvaluatorSource(source, proofStart, proofEnd) {
  source = reconstructPreR9PrivateEvaluatorSource(
    source,
    '\n\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\n',
    '\n\ntest("R7 persistence observation correction inversely reconstructs accepted R6 private evaluator", async () => {\n',
  );
  const currentSyscallPin = [
    '    label: "S3 syscall evaluator",',
    "    url: SYSCALL_EVALUATOR_URL,",
    "    bytes: 147416,",
    "    lines: 4459,",
    '    sha256: "75b60e1ebfe8322f804e715ca926cd7ed943289acc77834488cd9b019470b909",',
    '    blob: "e07e312de2b0d7102afd9dd9f613bf495ca8cc77",',
  ].join("\n");
  const acceptedSyscallPin = [
    '    label: "S3 syscall evaluator",',
    "    url: SYSCALL_EVALUATOR_URL,",
    "    bytes: 134818,",
    "    lines: 4121,",
    '    sha256: "3b8d21a57b70f0ccb6669598c851ad0cfb9aaac78bce93421e9b49c135deaf9e",',
    '    blob: "539f331c11edb4c95b0d5df2a854bfd6903ff3b4",',
  ].join("\n");
  const currentFaultPin = [
    '    label: "S3 fault evaluator",',
    "    url: FAULT_EVALUATOR_URL,",
    "    bytes: 146152,",
    "    lines: 4406,",
    '    sha256: "b8fa23d4fd6238f175da41a3348ecac592c2777b2fc44df82c0c90d371cc9774",',
    '    blob: "864588a504d506fd1b94a33717797b0b9d72299e",',
  ].join("\n");
  const acceptedFaultPin = [
    '    label: "S3 fault evaluator",',
    "    url: FAULT_EVALUATOR_URL,",
    "    bytes: 133571,",
    "    lines: 4068,",
    '    sha256: "426d5397c3324b59fd6dc4ae3dd27ee4c42537f10cf84efbcee2742744a2d6f8",',
    '    blob: "cbd0ff0c3951703726fbcb4f4bc074bb5a53c66d",',
  ].join("\n");
  let reconstructed = replaceExactly(
    source,
    currentSyscallPin,
    acceptedSyscallPin,
    "private R8 syscall pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    currentFaultPin,
    acceptedFaultPin,
    "private R8 fault pin inverse",
  );
  const correctedR7Entry = [
    "  let source = reconstructPreR8PrivateEvaluatorSource(",
    '    await readFile(EVALUATOR_PATH, "utf8"),',
    "    [",
    "      '\\n\\ntest(\"R8 S3 evaluator pins and inverse chain ',",
    "      'reconstruct the pre-R8 private evaluator\", async () => {\\n',",
    '    ].join(""),',
    "    '\\n\\ntest(\"count-checked inverses reconstruct both originally accepted S3 evaluators\", async () => {\\n',",
    "  );",
  ].join("\n");
  reconstructed = replaceExactly(
    reconstructed,
    correctedR7Entry,
    '  let source = await readFile(EVALUATOR_PATH, "utf8");',
    "private R8 R7-inverse entry",
  );
  const s3Chain = [
    "    const r8Kind =",
    '      item.url.href === SYSCALL_EVALUATOR_URL.href ? "syscall" : "fault";',
    "    source = reconstructPreR8S3EvaluatorSource(",
    "      source,",
    "      `\\n\\ntest(\"R8 fixed-register and syscall-immediate correction inversely reconstructs the pre-R8 ${r8Kind} evaluator\", async () => {\\n`,",
    "      item.end,",
    "    );",
  ].join("\n");
  reconstructed = replaceExactly(
    reconstructed,
    `${s3Chain}\n`,
    "",
    "private R8 S3 inverse chain",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    [
      "\n\nfunction reconstruct",
      "PreR8S3EvaluatorSource(source, proofStart, proofEnd) {\n",
    ].join(""),
    "\n\nconst PREDECESSOR_PINS = deepFreeze([\n",
    "private R8 inverse helpers",
  );
  return removeRangeExactly(
    reconstructed,
    proofStart,
    proofEnd,
    "private R8 proof inverse",
  );
}

const PREDECESSOR_PINS = deepFreeze([
  {
    label: "ADR-0037",
    url: ADR_URL,
    bytes: 216688,
    lines: 3638,
    sha256: "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",
    blob: "49b0467887646ee05126a593d28e78bebff6f78f",
  },
  {
    label: "S2 statefs source",
    url: STATEFS_SOURCE_URL,
    bytes: 189577,
    lines: 6242,
    sha256: "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",
    blob: "c452f04d9b64719dcd6b0392ee019578811aa263",
  },
  {
    label: "S2 statefs evaluator",
    url: STATEFS_EVALUATOR_URL,
    bytes: 386695,
    lines: 11305,
    sha256: "7b79d1ab3c28289a2db9a262552c44c3e866e087b408e37d1898365d27b91651",
    blob: "fc45c3975f6c4901bd89ba362a0816b51efb61be",
  },
  {
    label: "S3 syscall evaluator",
    url: SYSCALL_EVALUATOR_URL,
    bytes: 166676,
    lines: 4955,
    sha256: "4da18be9ae8dcf04288482aa728acccf7281054cd69061f3227353ecc24dd24c",
    blob: "b7eae6e8f5a9724ad6d2b9963785faf9d76ca1b0",
  },
  {
    label: "S3 fault evaluator",
    url: FAULT_EVALUATOR_URL,
    bytes: 182254,
    lines: 5400,
    sha256: "108dbfe0235ee9fed7d17d0a2352a0184e7eda74a39a77f59d5f5efd8353627a",
    blob: "f09c812da56dd9c45c90ee8a5af38266e9856245",
  },
  {
    label: "engineering package",
    url: PACKAGE_URL,
    bytes: 2790,
    lines: 52,
    sha256: "6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8",
    blob: "b480befac6ce8ba3fd9fa74dbf3963df58048926",
  },
  {
    label: "engineering lock",
    url: LOCK_URL,
    bytes: 24963,
    lines: 742,
    sha256: "5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d",
    blob: "e9d18035fca73a79e538f7b64454b89ef486ead7",
  },
]);

const EXPECTED_AUTHORITY = record(
  ["filesystemExecution", false],
  ["processExecution", false],
  ["cgroupMutation", false],
  ["runtimeRegistration", false],
  ["productExecution", false],
  ["g17Execution", false],
  ["qualification", false],
  ["readiness", false],
  ["promotion", false],
  ["publication", false],
);

const EXPECTED_PHYSICAL_FACTS = record(
  ["stateRootOrigin", null],
  ["stateRootHeld", null],
  ["stateRootLocked", null],
  ["filesystemClassified", null],
  ["inventoryObserved", null],
  ["artifactPersisted", null],
  ["directoryCreated", null],
  ["generationMoved", null],
  ["temporaryRemoved", null],
  ["managerAlive", null],
  ["guardianAlive", null],
  ["actorContinuity", null],
);

const EXPECTED_NONCLAIMS = array(
  "state-root-provenance",
  "service-manager-identity",
  "epoch-randomness",
  "historical-durability",
  "power-loss-durability",
  "remote-filesystem",
  "same-uid-tamper-resistance",
  "process-liveness",
  "cgroup-state",
  "descriptor-origin",
  "post-acquisition-lock-continuity",
  "pidfd-or-wait-authority",
  "application-output",
  "COMMIT",
  "semantic-qualification",
  "product-progress",
  "runtime-registration",
  "production-readiness",
  "promotion",
  "publication",
);

const PRIVATE_REPORT_FIELDS = array(
  "schema",
  "requirementsSha256",
  "platform",
  "architecture",
  "byteOrder",
  "kernelRelease",
  "effectiveUid",
  "effectiveGid",
  "stateRootName",
  "runNonceSha256",
  "stateRootDeviceMajor",
  "stateRootDeviceMinor",
  "stateRootInode",
  "stateRootMountId",
  "filesystemMagic",
  "mountPointByteLength",
  "mountPointRawSha256",
  "mountOptions",
  "cleanupAttempted",
  "cleanupCompleted",
  "cleanupErrno",
  "reportSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
);

const PRIVATE_REPORT_SCHEMA =
  "oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1";
const PROFILE_GOLDEN = deepFreeze(
  record(
    ["platform", "linux"],
    ["architecture", "x86_64"],
    ["byteOrder", "little-endian"],
    ["filesystemMagic", array("0x0000ef53", "0x58465342")],
    ["rootMode", "0700"],
    ["regularMode", "0600"],
    ["ownerSource", "manager-held-root-observation"],
    ["mountInfoSource", "/proc/self/mountinfo"],
    ["requiredMountOptions", array("rw")],
    ["forbiddenMountOptions", array("ro")],
    ["singleMount", true],
    ["remote", false],
    ["overlay", false],
    ["fuse", false],
    ["symlinkRoot", false],
    ["maximumHeldDirectoryDescriptors", 5],
    ["childNonceBytes", 32],
    ["runnerInputFields", array("scratchParent", "runNonceBytes")],
    ["childNamePrefix", ".oxigraph-statefs-v1-"],
    ["childNameGrammar", "^\\.oxigraph-statefs-v1-[0-9a-f]{64}$"],
    ["childNameBytes", 85],
    [
      "setupRules",
      array(
        "copy-nonce-before-path/v1",
        "open-parent-nofollow/v1",
        "mkdirat-once-no-replacement/v1",
        "open-child-nofollow/v1",
        "exact-owner-mode-mount-identity/v1",
        "longest-mountinfo-match/v1",
      ),
    ],
    [
      "recordRules",
      array(
        "minimal-decimal-identities/v1",
        "raw-ascii-kernel-release/v1",
        "sorted-unique-decoded-mount-options/v1",
        "digest-mount-point-bytes/v1",
        "report-valid-after-child-crosscheck/v1",
        "no-partial-report/v1",
        "report-after-cleanup/v1",
      ),
    ],
    [
      "cleanupRules",
      array(
        "close-all-continue-record-first/v1",
        "no-delete-after-close-error/v1",
        "child-rooted-nofollow-depth-first/v1",
        "remove-child-last/v1",
        "stop-path-mutation-on-first-error/v1",
        "close-cleanup-fds-after-error/v1",
        "close-parent-on-every-exit/v1",
        "no-other-path/v1",
        "cleanup-failure-preserves-test-failure/v1",
      ),
    ],
    [
      "errors",
      array(
        "PRIVATE_FS_PROFILE_BOUNDS",
        "PRIVATE_FS_PROFILE_SHAPE",
        "PRIVATE_FS_PROFILE_PATH",
        "PRIVATE_FS_PROFILE_MOUNT",
        "PRIVATE_FS_PROFILE_CLEANUP",
      ),
    ],
    [
      "reportLimits",
      pairs(
        ["kernelReleaseBytes", 256],
        ["mountPointBytes", 4_096],
        ["mountOptionCount", 256],
        ["mountOptionBytes", 255],
      ),
    ],
  ),
);
const PRIVATE_PROFILE_FIELDS = array(
  "platform",
  "architecture",
  "byteOrder",
  "filesystemMagic",
  "rootMode",
  "regularMode",
  "ownerSource",
  "mountInfoSource",
  "requiredMountOptions",
  "forbiddenMountOptions",
  "singleMount",
  "remote",
  "overlay",
  "fuse",
  "symlinkRoot",
  "maximumHeldDirectoryDescriptors",
  "childNonceBytes",
  "runnerInputFields",
  "childNamePrefix",
  "childNameGrammar",
  "childNameBytes",
  "setupRules",
  "recordRules",
  "cleanupRules",
  "errors",
  "reportLimits",
);

const OPERATIONS = pairs(
  ["INVALID", 0],
  ["LOCK_EX_NB", 1],
  ["INVENTORY", 2],
  ["PERSIST_NOREPLACE", 3],
  ["MKDIR_SYNC", 4],
  ["MOVE_NOREPLACE_SYNC", 5],
  ["TEMP_CLEANUP", 6],
  ["MOVE_SYNC_REOBSERVE", 7],
  ["RELEASE_DIRECTORY", 8],
);

const STEPS = pairs(
  ["NONE", 0],
  ["REQUEST_VALIDATED", 1],
  ["FD_A_VALIDATED", 2],
  ["FD_B_VALIDATED", 3],
  ["LOCK_ACQUIRED", 4],
  ["INTERNAL_DESCRIPTOR_OPENED", 5],
  ["DIRECTORY_ENUMERATED", 6],
  ["ENTRY_REOBSERVED", 7],
  ["TEMP_CREATED", 8],
  ["TEMP_WRITTEN", 9],
  ["TEMP_READ_BACK", 10],
  ["TEMP_FILE_SYNCED", 11],
  ["FINAL_INSTALLED", 12],
  ["CHILD_DIRECTORY_CREATED", 13],
  ["CHILD_DIRECTORY_SYNCED", 14],
  ["SOURCE_REOBSERVED", 15],
  ["GENERATION_MOVED", 16],
  ["SOURCE_PARENT_SYNCED", 17],
  ["DESTINATION_PARENT_SYNCED", 18],
  ["TEMP_UNLINKED", 19],
  ["PARENT_SYNCED", 20],
  ["DESTINATION_REOBSERVED", 21],
  ["SOURCE_ABSENCE_REOBSERVED", 22],
  ["TEMP_ABSENCE_REOBSERVED", 23],
  ["INVENTORY_DESCRIPTOR_CLOSED", 24],
  ["TEMP_READ_DESCRIPTOR_OPENED", 25],
  ["TEMP_READ_DESCRIPTOR_CLOSED", 26],
  ["TEMP_WRITE_DESCRIPTOR_CLOSED", 27],
  ["FINAL_READ_DESCRIPTOR_OPENED", 28],
  ["FINAL_READ_DESCRIPTOR_CLOSED", 29],
  ["CHILD_DESCRIPTOR_CLOSED", 30],
  ["PRE_SYNC_DESTINATION_REOBSERVED", 31],
  ["DIRECTORY_HANDLE_TRANSFERRED", 32],
  ["CREATED_METADATA_VALIDATED", 33],
  ["DIRECTORY_RELEASED", 34],
);

const SEQUENCES = deepFreeze(
  record(
    ["LOCK_EX_NB", array(1, 2, 4)],
    ["INVENTORY/DIRECTORY/ROOT", array(1, 2, 5, 6, 24)],
    ["INVENTORY/DIRECTORY/CHILD", array(1, 2, 5, 6, 32)],
    ["INVENTORY/REGULAR_FILE/PRESENT", array(1, 2, 5, 7, 24)],
    ["INVENTORY/REGULAR_FILE/ABSENT", array(1, 2, 7)],
    [
      "PERSIST_NOREPLACE",
      array(1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29),
    ],
    ["MKDIR_SYNC", array(1, 2, 13, 33, 5, 14, 30, 20, 21)],
    ["MOVE_NOREPLACE_SYNC", array(1, 2, 3, 15, 16, 17, 18, 22, 21)],
    ["MOVE_SYNC_REOBSERVE", array(1, 2, 3, 15, 31, 17, 18, 22, 21)],
    ["TEMP_CLEANUP", array(1, 2, 15, 19, 20, 23)],
    ["RELEASE_DIRECTORY", array(1, 2, 34)],
  ),
);

const FAULT_CLASSES = deepFreeze(
  record(
    ["LOCK_EX_NB", record(["before", "DDD"], ["after", "DDU"])],
    ["INVENTORY/DIRECTORY/ROOT", record(["before", "DDDDD"], ["after", "DDDDD"])],
    ["INVENTORY/DIRECTORY/CHILD", record(["before", "DDDDD"], ["after", "DDDDD"])],
    ["INVENTORY/REGULAR_FILE/PRESENT", record(["before", "DDDDD"], ["after", "DDDDD"])],
    ["INVENTORY/REGULAR_FILE/ABSENT", record(["before", "DDD"], ["after", "DDD"])],
    ["PERSIST_NOREPLACE", record(["before", "DDDMMMMMMMMMMMM"], ["after", "DDMMMMMMMMMMMMU"])],
    ["MKDIR_SYNC", record(["before", "DDDMMMMMM"], ["after", "DDMMMMMMU"])],
    ["MOVE_NOREPLACE_SYNC", record(["before", "DDDDDMMMM"], ["after", "DDDDMMMMU"])],
    ["MOVE_SYNC_REOBSERVE", record(["before", "UUUUUUUUU"], ["after", "UUUUUUUUU"])],
    ["TEMP_CLEANUP", record(["before", "DDDDMM"], ["after", "DDDMMU"])],
    ["RELEASE_DIRECTORY", record(["before", "DDD"], ["after", "DDU"])],
  ),
);

const EFFECTS = deepFreeze(
  record(
    ["D", record(["effectClass", "DEFINITE_NO_EFFECT"], ["outcome", "FAILED_DEFINITE_NO_EFFECT"], ["retry", "REPLAN_AFTER_FRESH_INVENTORY"])],
    ["M", record(["effectClass", "MUTATION_OBSERVED_NOT_FULLY_SYNCED"], ["outcome", "FAILED_MUTATION_NOT_FULLY_SYNCED"], ["retry", "NO_RETRY"])],
    ["U", record(["effectClass", "EFFECT_UNCERTAIN"], ["outcome", "FAILED_EFFECT_UNCERTAIN"], ["retry", "NO_RETRY"])],
  ),
);

function expectedFaultCases() {
  const cases = [];
  for (const [operation, sequence] of Object.entries(SEQUENCES)) {
    const classes = FAULT_CLASSES[operation];
    assert.equal(classes.before.length, sequence.length, `${operation} before`);
    assert.equal(classes.after.length, sequence.length, `${operation} after`);
    for (let position = 0; position < sequence.length; position += 1) {
      const step = sequence[position];
      for (const boundary of ["before", "after"]) {
        const includesStep = boundary === "after";
        const completedPrefix = sequence.slice(0, position + Number(includesStep));
        const code = classes[boundary][position];
        const base = EFFECTS[code];
        cases.push(
          deepFreeze(
            record(
              ["operation", operation],
              ["position", position],
              ["step", step],
              ["boundary", boundary],
              ["selector", boundary === "before" ? 2 * step - 1 : 2 * step],
              ["status", "FAULT_INJECTED"],
              ["effectClass", base.effectClass],
              ["errno", 5],
              ["completedPrefix", array(...completedPrefix)],
              ["completedStepCount", completedPrefix.length],
              ["lastCompletedStep", completedPrefix.at(-1) ?? 0],
              ["failedStep", boundary === "before" ? step : 0],
              ["outcome", base.outcome],
              [
                "retryDisposition",
                code === "D" &&
                operation !== "LOCK_EX_NB" &&
                operation !== "RELEASE_DIRECTORY"
                  ? base.retry
                  : "NO_RETRY",
              ],
            ),
          ),
        );
      }
    }
  }
  return array(...cases);
}

const FAULT_CASES = expectedFaultCases();

const ABI = deepFreeze(
  record(
    ["request", record(["alignment", 8], ["size", 192], ["offsets", pairs(["abiVersion", 0], ["structSize", 4], ["operation", 8], ["inventoryKind", 12], ["dirfdA", 16], ["dirfdB", 20], ["dirfdARole", 24], ["dirfdBRole", 28], ["nameALength", 32], ["nameBLength", 36], ["inputLength", 40], ["nameAAddress", 48], ["nameBAddress", 56], ["inputAddress", 64], ["observationsAddress", 72], ["observationCapacity", 80], ["outputCapacity", 84], ["outputAddress", 88], ["testFaultSelector", 96], ["expectedOwnerUid", 100], ["expectedOwnerGid", 104], ["inventoryDirectoryRole", 108], ["expectedMountIdA", 112], ["expectedMountIdB", 120], ["expectedDeviceMajorA", 128], ["expectedDeviceMinorA", 136], ["expectedInodeA", 144], ["expectedFilesystemMagicA", 152], ["expectedDeviceMajorB", 160], ["expectedDeviceMinorB", 168], ["expectedInodeB", 176], ["expectedFilesystemMagicB", 184])])],
    ["observation", record(["alignment", 8], ["size", 384], ["offsets", pairs(["structSize", 0], ["kind", 4], ["role", 8], ["nameLength", 12], ["deviceMajor", 16], ["deviceMinor", 24], ["inode", 32], ["mountId", 40], ["byteLength", 48], ["linkCount", 56], ["mode", 64], ["ownerUid", 68], ["ownerGid", 72], ["statxMask", 76], ["filesystemMagic", 80], ["contentOffset", 88], ["contentLength", 96], ["name", 104], ["reserved0", 360], ["reserved1", 368], ["reserved2", 376])])],
    ["result", record(["alignment", 8], ["size", 64], ["offsets", pairs(["abiVersion", 0], ["structSize", 4], ["operation", 8], ["status", 12], ["effectClass", 16], ["lastCompletedStep", 20], ["failedStep", 24], ["errno", 28], ["observationCount", 32], ["outputLength", 36], ["completedStepCount", 40], ["returnedDirectoryFd", 44], ["bytesConsumed", 48], ["reserved", 56])])],
  ),
);

const BRIDGE_SOURCE = String.raw`#define _GNU_SOURCE 1
#include <node_api.h>

#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <sys/utsname.h>
#include <unistd.h>

#include "containment-guardian-statefs-syscalls-v1.h"

enum bridge_operation {
  BRIDGE_EXECUTE = 1,
  BRIDGE_OPENAT = 2,
  BRIDGE_MKDIRAT = 3,
  BRIDGE_FCNTL = 4,
  BRIDGE_STATX = 5,
  BRIDGE_FSTATFS = 6,
  BRIDGE_CLOSE = 7,
  BRIDGE_GETDENTS64 = 8,
  BRIDGE_UNLINKAT = 9,
  BRIDGE_UMASK = 10,
  BRIDGE_UNAME = 11,
  BRIDGE_READ = 12,
  BRIDGE_WRITE = 13,
  BRIDGE_FSYNC = 14,
  BRIDGE_SYMLINKAT = 15
};

static napi_value bridge_fail(napi_env env, const char *message) {
  napi_throw_error(env, NULL, message);
  return NULL;
}

static int bridge_i32(napi_env env, napi_value value, int32_t *output) {
  return napi_get_value_int32(env, value, output) == napi_ok;
}

static int bridge_u32(napi_env env, napi_value value, uint32_t *output) {
  return napi_get_value_uint32(env, value, output) == napi_ok;
}

static int bridge_buffer(
    napi_env env,
    napi_value value,
    uint8_t **data,
    size_t *length) {
  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) {
    return 0;
  }
  return napi_get_buffer_info(env, value, (void **)data, length) == napi_ok;
}

static int bridge_name(
    napi_env env,
    napi_value value,
    char output[256],
    size_t *length) {
  uint8_t *bytes = NULL;
  size_t byte_length = 0;
  if (!bridge_buffer(env, value, &bytes, &byte_length) || byte_length > 255U) {
    return 0;
  }
  for (size_t index = 0; index < byte_length; index += 1U) {
    if (bytes[index] == 0U) return 0;
    output[index] = (char)bytes[index];
  }
  output[byte_length] = '\0';
  *length = byte_length;
  return 1;
}

static napi_value bridge_result(napi_env env, int64_t return_value, int error) {
  napi_value result;
  napi_value return_number;
  napi_value error_number;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_int64(env, return_value, &return_number) != napi_ok ||
      napi_create_int32(env, error, &error_number) != napi_ok ||
      napi_set_named_property(env, result, "returnValue", return_number) != napi_ok ||
      napi_set_named_property(env, result, "errno", error_number) != napi_ok) {
    return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_NAPI");
  }
  return result;
}

static napi_value bridge_invoke(napi_env env, napi_callback_info info) {
  napi_value argv[8];
  size_t argc = 8U;
  int32_t operation = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok ||
      argc < 1U || !bridge_i32(env, argv[0], &operation)) {
    return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_ARGUMENT");
  }

  if (operation == BRIDGE_EXECUTE) {
    uint8_t *request_bytes = NULL;
    uint8_t *name_a = NULL;
    uint8_t *name_b = NULL;
    uint8_t *input = NULL;
    uint8_t *observations = NULL;
    uint8_t *output = NULL;
    uint8_t *result_bytes = NULL;
    size_t request_length = 0;
    size_t name_a_length = 0;
    size_t name_b_length = 0;
    size_t input_length = 0;
    size_t observations_length = 0;
    size_t output_length = 0;
    size_t result_length = 0;
    if (argc != 8U ||
        !bridge_buffer(env, argv[1], &request_bytes, &request_length) ||
        !bridge_buffer(env, argv[2], &name_a, &name_a_length) ||
        !bridge_buffer(env, argv[3], &name_b, &name_b_length) ||
        !bridge_buffer(env, argv[4], &input, &input_length) ||
        !bridge_buffer(env, argv[5], &observations, &observations_length) ||
        !bridge_buffer(env, argv[6], &output, &output_length) ||
        !bridge_buffer(env, argv[7], &result_bytes, &result_length) ||
        request_length != sizeof(struct oxigraph_containment_statefs_request_v1) ||
        result_length != sizeof(struct oxigraph_containment_statefs_result_v1)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_EXECUTE_BUFFER");
    }
    struct oxigraph_containment_statefs_request_v1 request;
    struct oxigraph_containment_statefs_result_v1 result;
    memcpy(&request, request_bytes, sizeof(request));
    if ((uint64_t)name_a_length != (uint64_t)request.name_a_length ||
        (uint64_t)name_b_length != (uint64_t)request.name_b_length ||
        (uint64_t)input_length != request.input_length ||
        (uint64_t)observations_length !=
            (uint64_t)request.observation_capacity *
                (uint64_t)sizeof(struct oxigraph_containment_statefs_observation_v1) ||
        (uint64_t)output_length != (uint64_t)request.output_capacity) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_EXECUTE_EXTENT");
    }
    request.name_a_address = name_a_length == 0U ? 0U : (uint64_t)(uintptr_t)name_a;
    request.name_b_address = name_b_length == 0U ? 0U : (uint64_t)(uintptr_t)name_b;
    request.input_address = input_length == 0U ? 0U : (uint64_t)(uintptr_t)input;
    request.observations_address = observations_length == 0U
        ? 0U : (uint64_t)(uintptr_t)observations;
    request.output_address = output_length == 0U
        ? 0U : (uint64_t)(uintptr_t)output;
    errno = 0;
    int32_t return_value =
        oxigraph_containment_statefs_execute_v1(&request, &result);
    int saved_errno = errno;
    memcpy(result_bytes, &result, sizeof(result));
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_OPENAT || operation == BRIDGE_MKDIRAT ||
      operation == BRIDGE_UNLINKAT) {
    int32_t dirfd = -1;
    int32_t argument = 0;
    int32_t creation_mode = 0700;
    char name[256];
    size_t name_length = 0;
    if ((operation == BRIDGE_OPENAT ? (argc != 4U && argc != 5U) : argc != 4U) ||
        !bridge_i32(env, argv[1], &dirfd) ||
        !bridge_name(env, argv[2], name, &name_length) ||
        !bridge_i32(env, argv[3], &argument)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_PATH_ARGUMENT");
    }
    if (operation == BRIDGE_OPENAT && argc == 5U &&
        !bridge_i32(env, argv[4], &creation_mode)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_PATH_ARGUMENT");
    }
    (void)name_length;
    errno = 0;
    int return_value;
    if (operation == BRIDGE_OPENAT) {
      return_value = openat(dirfd, name, argument, (mode_t)creation_mode);
    } else if (operation == BRIDGE_MKDIRAT) {
      return_value = mkdirat(dirfd, name, (mode_t)argument);
    } else {
      return_value = unlinkat(dirfd, name, argument);
    }
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_FCNTL) {
    int32_t descriptor = -1;
    int32_t command = 0;
    if (argc != 3U || !bridge_i32(env, argv[1], &descriptor) ||
        !bridge_i32(env, argv[2], &command)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_FCNTL_ARGUMENT");
    }
    errno = 0;
    int return_value = fcntl(descriptor, command);
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_STATX) {
    int32_t descriptor = -1;
    int32_t flags = 0;
    uint32_t mask = 0;
    char name[256];
    size_t name_length = 0;
    uint8_t *output = NULL;
    size_t output_length = 0;
    if (argc != 6U || !bridge_i32(env, argv[1], &descriptor) ||
        !bridge_name(env, argv[2], name, &name_length) ||
        !bridge_i32(env, argv[3], &flags) ||
        !bridge_u32(env, argv[4], &mask) ||
        !bridge_buffer(env, argv[5], &output, &output_length) ||
        output_length != sizeof(struct statx)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_STATX_ARGUMENT");
    }
    (void)name_length;
    memset(output, 0, output_length);
    errno = 0;
    long return_value = syscall(SYS_statx, descriptor, name, flags, mask, output);
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_FSTATFS || operation == BRIDGE_GETDENTS64 ||
      operation == BRIDGE_READ || operation == BRIDGE_WRITE) {
    int32_t descriptor = -1;
    uint8_t *buffer = NULL;
    size_t length = 0;
    if (argc != 3U || !bridge_i32(env, argv[1], &descriptor) ||
        !bridge_buffer(env, argv[2], &buffer, &length)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_BUFFER_ARGUMENT");
    }
    errno = 0;
    int64_t return_value;
    if (operation == BRIDGE_FSTATFS) {
      if (length != sizeof(struct statfs)) {
        return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_FSTATFS_EXTENT");
      }
      memset(buffer, 0, length);
      return_value = (int64_t)fstatfs(descriptor, (struct statfs *)buffer);
    } else if (operation == BRIDGE_GETDENTS64) {
      return_value = (int64_t)syscall(SYS_getdents64, descriptor, buffer, length);
    } else if (operation == BRIDGE_READ) {
      return_value = (int64_t)read(descriptor, buffer, length);
    } else {
      return_value = (int64_t)write(descriptor, buffer, length);
    }
    int saved_errno = errno;
    return bridge_result(env, return_value, saved_errno);
  }

  if (operation == BRIDGE_CLOSE || operation == BRIDGE_FSYNC) {
    int32_t descriptor = -1;
    if (argc != 2U || !bridge_i32(env, argv[1], &descriptor)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_DESCRIPTOR_ARGUMENT");
    }
    errno = 0;
    int return_value = operation == BRIDGE_CLOSE
        ? close(descriptor) : fsync(descriptor);
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_SYMLINKAT) {
    char target[256];
    char name[256];
    size_t target_length = 0;
    size_t name_length = 0;
    int32_t dirfd = -1;
    if (argc != 4U ||
        !bridge_name(env, argv[1], target, &target_length) ||
        !bridge_i32(env, argv[2], &dirfd) ||
        !bridge_name(env, argv[3], name, &name_length)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_SYMLINK_ARGUMENT");
    }
    (void)target_length;
    (void)name_length;
    errno = 0;
    int return_value = symlinkat(target, dirfd, name);
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  if (operation == BRIDGE_UMASK) {
    int32_t mask = 0;
    if (argc != 2U || !bridge_i32(env, argv[1], &mask)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_UMASK_ARGUMENT");
    }
    mode_t previous = umask((mode_t)mask);
    return bridge_result(env, (int64_t)previous, 0);
  }

  if (operation == BRIDGE_UNAME) {
    uint8_t *output = NULL;
    size_t output_length = 0;
    if (argc != 2U || !bridge_buffer(env, argv[1], &output, &output_length) ||
        output_length != sizeof(struct utsname)) {
      return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_UNAME_ARGUMENT");
    }
    memset(output, 0, output_length);
    errno = 0;
    int return_value = uname((struct utsname *)output);
    int saved_errno = errno;
    return bridge_result(env, (int64_t)return_value, saved_errno);
  }

  return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_OPERATION");
}

NAPI_MODULE_INIT() {
  napi_property_descriptor property = {
    "invoke", NULL, bridge_invoke, NULL, NULL, NULL, napi_enumerable, NULL
  };
  if (napi_define_properties(env, exports, 1U, &property) != napi_ok) {
    return bridge_fail(env, "STATEFS_PRIVATE_BRIDGE_EXPORT");
  }
  return exports;
}
`;

const EXPECTED_BRIDGE_SOURCE_BYTES = 11367;
const EXPECTED_BRIDGE_SOURCE_SHA256 =
  "2e0846197145adbd2c0a852202704d02399b060a3aba613fdd2f88840b70a4f2";
const BRIDGE_COMPILE_TEMPLATE = array(
  "/usr/bin/cc",
  "-std=c17",
  "-O2",
  "-fPIC",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-I/usr/include/node",
  "-I<CANDIDATE_SOURCE_DIRECTORY>",
  "-c",
  "<BRIDGE_SOURCE>",
  "-o",
  "<BRIDGE_OBJECT>",
);
const BRIDGE_LINK_TEMPLATE = array(
  "/usr/bin/cc",
  "-shared",
  "-B/usr/bin/",
  "-Wl,-z,noexecstack",
  "<BRIDGE_OBJECT>",
  "<ATTESTED_CANDIDATE_OBJECT>",
  "-o",
  "<NATIVE_MODULE>",
);

function assertExactBridgeLinkContract(
  template,
  argv,
  bridgeObject,
  candidateObject,
  modulePath,
) {
  assert.deepEqual(template, [
    "/usr/bin/cc",
    "-shared",
    "-B/usr/bin/",
    "-Wl,-z,noexecstack",
    "<BRIDGE_OBJECT>",
    "<ATTESTED_CANDIDATE_OBJECT>",
    "-o",
    "<NATIVE_MODULE>",
  ]);
  assert.deepEqual(argv, [
    "-shared",
    "-B/usr/bin/",
    "-Wl,-z,noexecstack",
    bridgeObject,
    candidateObject,
    "-o",
    modulePath,
  ]);
}

const BRIDGE = deepFreeze(
  record(
    ["EXECUTE", 1],
    ["OPENAT", 2],
    ["MKDIRAT", 3],
    ["FCNTL", 4],
    ["STATX", 5],
    ["FSTATFS", 6],
    ["CLOSE", 7],
    ["GETDENTS64", 8],
    ["UNLINKAT", 9],
    ["UMASK", 10],
    ["UNAME", 11],
    ["READ", 12],
    ["WRITE", 13],
    ["FSYNC", 14],
    ["SYMLINKAT", 15],
  ),
);
const BRIDGE_ENVIRONMENT = deepFreeze(
  record(
    ["LC_ALL", "C"],
    ["LANG", "C"],
    ["TZ", "UTC"],
    ["SOURCE_DATE_EPOCH", "0"],
  ),
);
const require = createRequire(import.meta.url);
let nativeRuntimePromise;

function exactChild(executable, args, cwd) {
  assert.equal(isAbsolute(executable), true);
  const child = spawnSync(executable, args, {
    cwd,
    env: { ...BRIDGE_ENVIRONMENT },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr?.toString("utf8"));
  assert.equal(child.stdout.length, 0);
  assert.equal(child.stderr.length, 0);
}

async function ensureNativeRuntime() {
  if (nativeRuntimePromise !== undefined) return nativeRuntimePromise;
  nativeRuntimePromise = (async () => {
    assert.equal(sourceCount, 3);
    evaluatorOwnedRoot = await mkdtemp(
      join(tmpdir(), "oxigraph-statefs-private-evaluator-"),
    );
    await chmod(evaluatorOwnedRoot, 0o700);
    const attestationRoot = join(evaluatorOwnedRoot, "attestation");
    await mkdir(attestationRoot, { mode: 0o700 });
    const report =
      await attestation.attestCandidateContainmentGuardianStatefsSyscallsV1({
        repositoryRoot: REPOSITORY_ROOT,
        privateBuildRoot: attestationRoot,
        buildKind: "FAULT",
      });
    const bridgeRoot = join(evaluatorOwnedRoot, "bridge");
    await mkdir(bridgeRoot, { mode: 0o700 });
    const bridgeSource = join(bridgeRoot, "statefs-private-bridge.c");
    const bridgeObject = join(bridgeRoot, "statefs-private-bridge.o");
    const productionModulePath = join(bridgeRoot, "statefs-production.node");
    const faultModulePath = join(bridgeRoot, "statefs-fault.node");
    await writeFile(bridgeSource, BRIDGE_SOURCE, { encoding: "utf8", mode: 0o600 });
    const compiler = await realpath("/usr/bin/cc");
    assert.equal(compiler, report.compilerRealpath);
    const includeDirectory = dirname(fileURLToPath(HEADER_URL));
    const compileArgs = [
      "-std=c17",
      "-O2",
      "-fPIC",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-I/usr/include/node",
      `-I${includeDirectory}`,
      "-c",
      bridgeSource,
      "-o",
      bridgeObject,
    ];
    exactChild(compiler, compileArgs, REPOSITORY_ROOT);
    const productionObject = join(
      attestationRoot,
      "production-0001",
      "containment-guardian-statefs-syscalls-v1.o",
    );
    const faultObject = join(
      attestationRoot,
      "fault-0001",
      "containment-guardian-statefs-syscalls-v1-fault.o",
    );
    for (const [candidateObject, modulePath] of [
      [productionObject, productionModulePath],
      [faultObject, faultModulePath],
    ]) {
      const linkArgs = [
        "-shared",
        "-B/usr/bin/",
        "-Wl,-z,noexecstack",
        bridgeObject,
        candidateObject,
        "-o",
        modulePath,
      ];
      assertExactBridgeLinkContract(
        BRIDGE_LINK_TEMPLATE,
        linkArgs,
        bridgeObject,
        candidateObject,
        modulePath,
      );
      exactChild(compiler, linkArgs, REPOSITORY_ROOT);
    }
    const production = require(productionModulePath);
    const fault = require(faultModulePath);
    for (const [label, nativeModule] of [
      ["production", production],
      ["fault", fault],
    ]) {
      assert.deepEqual(Reflect.ownKeys(nativeModule), ["invoke"], label);
      const descriptor = Object.getOwnPropertyDescriptor(nativeModule, "invoke");
      assert.equal(typeof descriptor.value, "function", label);
      assert.equal(descriptor.writable, false, label);
      assert.equal(descriptor.enumerable, true, label);
      assert.equal(descriptor.configurable, false, label);
    }
    return deepFreeze(
      record(
        ["report", report],
        ["compiler", compiler],
        ["compileArgs", array(...compileArgs)],
        ["production", production],
        ["fault", fault],
        ["scratchParent", join(evaluatorOwnedRoot, "scratch")],
      ),
    );
  })();
  return nativeRuntimePromise;
}

function invoke(bridge, operation, ...args) {
  const result = bridge.invoke(operation, ...args);
  assert.deepEqual(Object.keys(result), ["returnValue", "errno"]);
  assert.equal(Number.isSafeInteger(result.returnValue), true);
  assert.equal(Number.isSafeInteger(result.errno), true);
  return result;
}

function invokeSuccess(bridge, operation, ...args) {
  const result = invoke(bridge, operation, ...args);
  assert.notEqual(result.returnValue, -1, `bridge errno ${result.errno}`);
  assert.equal(result.errno, 0);
  return result.returnValue;
}

const OPERATION_VARIANTS = array(
  "LOCK_EX_NB",
  "INVENTORY/DIRECTORY/ROOT",
  "INVENTORY/DIRECTORY/CHILD",
  "INVENTORY/REGULAR_FILE/PRESENT",
  "INVENTORY/REGULAR_FILE/ABSENT",
  "PERSIST_NOREPLACE",
  "MKDIR_SYNC",
  "MOVE_NOREPLACE_SYNC",
  "MOVE_SYNC_REOBSERVE",
  "TEMP_CLEANUP",
  "RELEASE_DIRECTORY",
);

const PROFILE_ERRORS = array(
  "PRIVATE_FS_PROFILE_BOUNDS",
  "PRIVATE_FS_PROFILE_SHAPE",
  "PRIVATE_FS_PROFILE_PATH",
  "PRIVATE_FS_PROFILE_MOUNT",
  "PRIVATE_FS_PROFILE_CLEANUP",
);

function profileError(index) {
  throw new Error(PROFILE_ERRORS[index]);
}

function validatePrivateProfileInput(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    profileError(1);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
    const repeatedKeys = Reflect.ownKeys(value);
    if (keys.length > 2 || repeatedKeys.length > 2) profileError(0);
    if (
      keys.length !== 2 ||
      repeatedKeys.length !== 2 ||
      keys[0] !== "scratchParent" ||
      keys[1] !== "runNonceBytes" ||
      repeatedKeys[0] !== keys[0] ||
      repeatedKeys[1] !== keys[1] ||
      Object.getPrototypeOf(value) !== null
    ) {
      profileError(1);
    }
  } catch (error) {
    if (PROFILE_ERRORS.includes(error?.message)) throw error;
    profileError(1);
  }
  const exactDataDescriptor = (key) => {
    let first;
    let second;
    try {
      first = Object.getOwnPropertyDescriptor(value, key);
      second = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      profileError(1);
    }
    if (
      first === undefined ||
      second === undefined ||
      Reflect.ownKeys(first).some((name) => typeof name === "symbol") ||
      first.enumerable !== true ||
      first.configurable !== false ||
      first.writable !== false ||
      !("value" in first) ||
      "get" in first ||
      "set" in first ||
      second.value !== first.value ||
      second.enumerable !== first.enumerable ||
      second.configurable !== first.configurable ||
      second.writable !== first.writable
    ) {
      profileError(1);
    }
    return first;
  };
  const nonceDescriptor = exactDataDescriptor("runNonceBytes");
  const view = nonceDescriptor.value;
  if (Buffer.isBuffer(view) && view.byteLength > 32) profileError(0);
  if (
    !Buffer.isBuffer(view) ||
    Object.getPrototypeOf(view) !== Buffer.prototype ||
    view.length !== 32 ||
    view.byteLength !== 32 ||
    view.byteOffset !== 0 ||
    !(view.buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(view.buffer) !== ArrayBuffer.prototype ||
    view.buffer.byteLength !== 32 ||
    view.buffer.resizable === true ||
    (view.buffer.maxByteLength !== undefined && view.buffer.maxByteLength !== 32)
  ) {
    profileError(1);
  }
  const nonce = Buffer.from(view);
  if (nonce.every((byte) => byte === 0)) profileError(1);
  const scratchParent = exactDataDescriptor("scratchParent").value;
  if (typeof scratchParent !== "string") profileError(1);
  const bytes = Buffer.from(scratchParent, "utf8");
  if (bytes.length < 1 || bytes.length > 4096) profileError(0);
  if (
    bytes.toString("utf8") !== scratchParent ||
    bytes.includes(0) ||
    !isAbsolute(scratchParent) ||
    resolve(scratchParent) !== scratchParent ||
    scratchParent === sep ||
    scratchParent.endsWith(sep) ||
    scratchParent.includes(`${sep}${sep}`) ||
    scratchParent.split(sep).slice(1).some((part) => part === "." || part === "..")
  ) {
    profileError(2);
  }
  const runNonceSha256 = sha256(nonce);
  return deepFreeze(
    record(
      ["scratchParent", scratchParent],
      ["runNonceBytes", nonce],
      ["runNonceSha256", runNonceSha256],
      ["stateRootName", `.oxigraph-statefs-v1-${runNonceSha256}`],
    ),
  );
}

function splitRawBytes(bytes, separator) {
  assert.equal(Buffer.isBuffer(bytes), true);
  assert.equal(Number.isInteger(separator), true);
  const fields = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index === bytes.length || bytes[index] === separator) {
      fields.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  return fields;
}

function exactRawAscii(bytes, minimum, maximum) {
  return (
    bytes.length >= minimum &&
    bytes.length <= maximum &&
    bytes.every((byte) => byte >= 0x20 && byte <= 0x7e)
  );
}

function decodeMountInfoWord(word) {
  const source = Buffer.isBuffer(word) ? word : Buffer.from(word, "utf8");
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== 0x5c) {
      output.push(source[index]);
      continue;
    }
    const escape = source.subarray(index, index + 4).toString("ascii");
    const replacements = new Map([
      ["\\040", 0x20],
      ["\\011", 0x09],
      ["\\012", 0x0a],
      ["\\134", 0x5c],
    ]);
    if (!replacements.has(escape)) profileError(3);
    output.push(replacements.get(escape));
    index += 3;
  }
  return Buffer.from(output);
}

function parseMountInfo(bytes, targetPath) {
  assert.equal(Buffer.isBuffer(bytes), true);
  if (bytes.length === 0 || bytes.includes(0)) profileError(3);
  const target = Buffer.from(targetPath, "utf8");
  const rows = [];
  for (const line of splitRawBytes(bytes, 0x0a)) {
    if (line.length === 0) continue;
    const separatorIndex = line.indexOf(Buffer.from(" - ", "ascii"));
    if (separatorIndex === -1) profileError(3);
    const left = splitRawBytes(line.subarray(0, separatorIndex), 0x20);
    const right = splitRawBytes(line.subarray(separatorIndex + 3), 0x20);
    if (
      left.length < 6 ||
      right.length < 3 ||
      [...left, ...right].some((field) => field.length === 0)
    ) {
      profileError(3);
    }
    const mountPoint = decodeMountInfoWord(left[4]);
    const mountId = left[0].toString("ascii");
    const device = left[2].toString("ascii");
    const filesystemType = right[0].toString("ascii");
    if (
      mountPoint.length < 1 ||
      mountPoint.length > 4096 ||
      mountPoint[0] !== 0x2f ||
      mountPoint.includes(0) ||
      !exactRawAscii(left[0], 1, 20) ||
      !exactRawAscii(left[2], 3, 41) ||
      !exactRawAscii(right[0], 1, 255) ||
      !/^[1-9][0-9]*$/u.test(mountId) ||
      !/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/u.test(device)
    ) {
      profileError(3);
    }
    const matches =
      target.equals(mountPoint) ||
      (mountPoint.length < target.length &&
        target.subarray(0, mountPoint.length).equals(mountPoint) &&
        (mountPoint.equals(Buffer.from("/")) || target[mountPoint.length] === 0x2f));
    if (!matches) continue;
    const options = [
      ...splitRawBytes(left[5], 0x2c),
      ...splitRawBytes(right[2], 0x2c),
    ];
    const decodedOptionBytes = options.map(decodeMountInfoWord);
    const decodedOptions = [...new Set(decodedOptionBytes
      .map((option) => option.toString("ascii")))]
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (
      decodedOptionBytes.some((option) => !exactRawAscii(option, 1, 255)) ||
      decodedOptions.length < 1 ||
      decodedOptions.length > 256 ||
      decodedOptions.some(
        (option) =>
          option.length < 1 ||
          option.length > 255 ||
          !Buffer.from(option, "ascii").every(
            (byte) => byte >= 0x20 && byte <= 0x7e,
          ),
      ) ||
      new Set(decodedOptions).size !== decodedOptions.length
    ) {
      profileError(3);
    }
    rows.push(
      deepFreeze({
        mountId,
        device,
        mountPoint,
        mountOptions: array(...decodedOptions),
        filesystemType,
      }),
    );
  }
  const longest = Math.max(-1, ...rows.map(({ mountPoint }) => mountPoint.length));
  const selected = rows.filter(({ mountPoint }) => mountPoint.length === longest);
  if (selected.length !== 1) profileError(3);
  if (
    !selected[0].mountOptions.includes("rw") ||
    selected[0].mountOptions.includes("ro") ||
    !["ext4", "xfs"].includes(selected[0].filesystemType)
  ) {
    profileError(3);
  }
  return selected[0];
}

function digestPrecedingFields(value, digestField, fields) {
  const entries = [];
  for (const field of fields) {
    if (field === digestField) break;
    entries.push([field, value[field]]);
  }
  return semanticSha256(record(...entries));
}

function expectedFaultResult(faultCase) {
  return deepFreeze(
    record(
      ["status", faultCase.status],
      ["effectClass", faultCase.effectClass],
      ["lastCompletedStep", faultCase.lastCompletedStep],
      ["failedStep", faultCase.failedStep],
      ["errno", faultCase.errno],
      ["completedStepCount", faultCase.completedStepCount],
      ["outcome", faultCase.outcome],
      ["retryDisposition", faultCase.retryDisposition],
    ),
  );
}

const O_RDONLY = 0x00000000;
const O_WRONLY = 0x00000001;
const O_CREAT = 0x00000040;
const O_EXCL = 0x00000080;
const O_DIRECTORY = 0x00010000;
const O_NOFOLLOW = 0x00020000;
const O_CLOEXEC = 0x00080000;
const F_GETFL = 3;
const F_GETFD = 1;
const FD_CLOEXEC = 1;
const EBADF = 9;
const AT_FDCWD = -100;
const AT_SYMLINK_NOFOLLOW = 0x00000100;
const AT_EMPTY_PATH = 0x00001000;
const AT_REMOVEDIR = 0x00000200;
const STATX_BASIC_STATS = 0x000007ff;
const STATX_MNT_ID = 0x00001000;
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const CLEANUP_MAX_OPEN_DIRECTORIES = 5;
const CLEANUP_MAX_DIRECTORY_ENTRIES = 256;
const CLEANUP_MAX_AGGREGATE_ENTRIES = 1_536;
const EXPECTED_STATEFS_REQUIREMENTS_SHA256 =
  "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42";
let profileOrdinal = 0;
let scratchParentPromise;

function rawName(value) {
  assert.equal(typeof value, "string");
  const bytes = Buffer.from(value, "utf8");
  assert.equal(bytes.length <= 255, true);
  assert.equal(bytes.includes(0), false);
  return bytes;
}

function parseStatx(bytes) {
  assert.equal(bytes.length, 256);
  return deepFreeze(
    record(
      ["mask", bytes.readUInt32LE(0)],
      ["linkCount", String(bytes.readUInt32LE(16))],
      ["ownerUid", bytes.readUInt32LE(20)],
      ["ownerGid", bytes.readUInt32LE(24)],
      ["mode", bytes.readUInt16LE(28)],
      ["inode", bytes.readBigUInt64LE(32).toString(10)],
      ["byteLength", bytes.readBigUInt64LE(40).toString(10)],
      ["deviceMajor", String(bytes.readUInt32LE(136))],
      ["deviceMinor", String(bytes.readUInt32LE(140))],
      ["mountId", bytes.readBigUInt64LE(144).toString(10)],
    ),
  );
}

function bridgeStatx(bridge, descriptor, name = "") {
  const output = Buffer.alloc(256);
  invokeSuccess(
    bridge,
    BRIDGE.STATX,
    descriptor,
    rawName(name),
    name === "" ? AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW : AT_SYMLINK_NOFOLLOW,
    STATX_BASIC_STATS | STATX_MNT_ID,
    output,
  );
  const observed = parseStatx(output);
  assert.equal(
    observed.mask & (STATX_BASIC_STATS | STATX_MNT_ID),
    STATX_BASIC_STATS | STATX_MNT_ID,
  );
  return observed;
}

function bridgeFilesystemMagic(bridge, descriptor) {
  const output = Buffer.alloc(120);
  invokeSuccess(bridge, BRIDGE.FSTATFS, descriptor, output);
  return BigInt.asUintN(64, output.readBigInt64LE(0));
}

function bridgeClose(bridge, descriptor) {
  return invoke(bridge, BRIDGE.CLOSE, descriptor);
}

async function ensureScratchParent(runtime) {
  if (scratchParentPromise !== undefined) return scratchParentPromise;
  scratchParentPromise = (async () => {
    await mkdir(runtime.scratchParent, { mode: 0o700 });
    await chmod(runtime.scratchParent, 0o700);
    const status = await lstat(runtime.scratchParent);
    assert.equal(status.isDirectory(), true);
    assert.equal(status.isSymbolicLink(), false);
    assert.equal(status.uid, process.geteuid());
    assert.equal(status.gid, process.getegid());
    assert.equal(status.mode & 0o7777, 0o700);
    assert.equal(await realpath(runtime.scratchParent), runtime.scratchParent);
    return runtime.scratchParent;
  })();
  return scratchParentPromise;
}

function kernelReleaseFromBridge(bridge) {
  const bytes = Buffer.alloc(390);
  invokeSuccess(bridge, BRIDGE.UNAME, bytes);
  const field = bytes.subarray(130, 195);
  const nul = field.indexOf(0);
  assert.notEqual(nul, -1);
  const value = field.subarray(0, nul);
  assert.equal(value.length >= 1 && value.length <= 256, true);
  assert.equal(value.every((byte) => byte >= 0x20 && byte <= 0x7e), true);
  return value.toString("ascii");
}

function openCanonicalParent(bridge, scratchParent) {
  const components = scratchParent.split(sep).slice(1);
  let descriptor = invokeSuccess(
    bridge,
    BRIDGE.OPENAT,
    AT_FDCWD,
    rawName("/"),
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
  );
  try {
    for (const component of components) {
      const next = invokeSuccess(
        bridge,
        BRIDGE.OPENAT,
        descriptor,
        rawName(component),
        O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
      );
      const previous = descriptor;
      descriptor = next;
      const closed = bridgeClose(bridge, previous);
      if (closed.returnValue === -1) {
        throw Object.assign(new Error("parent traversal close"), {
          errno: closed.errno,
        });
      }
    }
    return descriptor;
  } catch (error) {
    let closeErrno = null;
    try {
      const closed = bridgeClose(bridge, descriptor);
      if (closed.returnValue === -1) closeErrno = closed.errno;
    } catch (closeError) {
      closeErrno = nativeErrno(closeError);
    }
    if (
      closeErrno !== null &&
      error !== null &&
      typeof error === "object" &&
      Object.isExtensible(error)
    ) {
      Object.defineProperty(error, "parentTraversalCleanupErrno", {
        configurable: false,
        enumerable: false,
        value: closeErrno,
        writable: false,
      });
    }
    throw error;
  }
}

function parseDirectoryEntries(bytes, byteLength) {
  const entries = [];
  let offset = 0;
  while (offset < byteLength) {
    assert.equal(offset + 19 <= byteLength, true);
    const recordLength = bytes.readUInt16LE(offset + 16);
    assert.equal(recordLength >= 20 && offset + recordLength <= byteLength, true);
    const nameArea = bytes.subarray(offset + 19, offset + recordLength);
    const nul = nameArea.indexOf(0);
    assert.notEqual(nul, -1);
    const nameBytes = Buffer.from(nameArea.subarray(0, nul));
    if (!nameBytes.equals(Buffer.from(".")) && !nameBytes.equals(Buffer.from(".."))) {
      assert.equal(nameBytes.length >= 1 && nameBytes.length <= 255, true);
      assert.equal(
        nameBytes.every(
          (byte) => byte >= 0x01 && byte <= 0x7f && byte !== 0x2f,
        ),
        true,
      );
      entries.push(nameBytes);
    }
    offset += recordLength;
  }
  assert.equal(offset, byteLength);
  entries.sort(Buffer.compare);
  return entries;
}

function cleanupBoundError(label) {
  return Object.assign(new Error(label), { errno: 75 });
}

function cleanupDirectory(
  bridge,
  descriptor,
  cleanupDescriptors,
  cleanupState,
) {
  if (cleanupDescriptors.length >= CLEANUP_MAX_OPEN_DIRECTORIES) {
    throw cleanupBoundError("cleanup directory depth");
  }
  cleanupDescriptors.push(descriptor);
  const entries = [];
  while (true) {
    const bytes = Buffer.alloc(32768);
    const count = invokeSuccess(bridge, BRIDGE.GETDENTS64, descriptor, bytes);
    if (count === 0) break;
    const observed = parseDirectoryEntries(bytes, count);
    if (entries.length + observed.length > CLEANUP_MAX_DIRECTORY_ENTRIES) {
      throw cleanupBoundError("cleanup directory entries");
    }
    cleanupState.aggregateEntries += observed.length;
    if (cleanupState.aggregateEntries > CLEANUP_MAX_AGGREGATE_ENTRIES) {
      throw cleanupBoundError("cleanup aggregate entries");
    }
    entries.push(...observed);
  }
  entries.sort(Buffer.compare);
  for (const nameBytes of entries) {
    const name = nameBytes.toString("ascii");
    const observed = bridgeStatx(bridge, descriptor, name);
    if ((observed.mode & S_IFMT) === S_IFDIR) {
      if (cleanupDescriptors.length >= CLEANUP_MAX_OPEN_DIRECTORIES) {
        throw cleanupBoundError("cleanup directory depth");
      }
      const child = invokeSuccess(
        bridge,
        BRIDGE.OPENAT,
        descriptor,
        nameBytes,
        O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
      );
      cleanupDirectory(bridge, child, cleanupDescriptors, cleanupState);
      cleanupDescriptors.pop();
      const close = bridgeClose(bridge, child);
      if (close.returnValue === -1) throw Object.assign(new Error("cleanup close"), { errno: close.errno });
      const removed = invoke(bridge, BRIDGE.UNLINKAT, descriptor, nameBytes, AT_REMOVEDIR);
      if (removed.returnValue === -1) throw Object.assign(new Error("cleanup rmdir"), { errno: removed.errno });
    } else {
      const removed = invoke(bridge, BRIDGE.UNLINKAT, descriptor, nameBytes, 0);
      if (removed.returnValue === -1) throw Object.assign(new Error("cleanup unlink"), { errno: removed.errno });
    }
  }
}

function profileReport(profile, cleanupCompleted, cleanupErrno) {
  for (const value of [
    profile.identity.deviceMajor,
    profile.identity.deviceMinor,
    profile.identity.inode,
    profile.identity.mountId,
    profile.filesystemMagic.toString(10),
  ]) {
    assert.match(value, /^(?:0|[1-9][0-9]*)$/u);
  }
  assert.notEqual(profile.identity.inode, "0");
  assert.notEqual(profile.identity.mountId, "0");
  assert.equal(
    profile.mount.mountPoint.length >= 1 &&
      profile.mount.mountPoint.length <= 4096,
    true,
  );
  const prefix = record(
    ["schema", PRIVATE_REPORT_SCHEMA],
    ["requirementsSha256", EXPECTED_STATEFS_REQUIREMENTS_SHA256],
    ["platform", "linux"],
    ["architecture", "x86_64"],
    ["byteOrder", "little-endian"],
    ["kernelRelease", profile.kernelRelease],
    ["effectiveUid", profile.effectiveUid],
    ["effectiveGid", profile.effectiveGid],
    ["stateRootName", profile.input.stateRootName],
    ["runNonceSha256", profile.input.runNonceSha256],
    ["stateRootDeviceMajor", profile.identity.deviceMajor],
    ["stateRootDeviceMinor", profile.identity.deviceMinor],
    ["stateRootInode", profile.identity.inode],
    ["stateRootMountId", profile.identity.mountId],
    ["filesystemMagic", profile.filesystemMagic.toString(10)],
    ["mountPointByteLength", profile.mount.mountPoint.length],
    ["mountPointRawSha256", sha256(profile.mount.mountPoint)],
    ["mountOptions", profile.mount.mountOptions],
    ["cleanupAttempted", true],
    ["cleanupCompleted", cleanupCompleted],
    ["cleanupErrno", cleanupErrno],
  );
  return deepFreeze(
    record(
      ...Object.entries(prefix),
      ["reportSha256", semanticSha256(prefix)],
      ["authority", EXPECTED_AUTHORITY],
      ["physicalFacts", EXPECTED_PHYSICAL_FACTS],
      ["nonclaims", EXPECTED_NONCLAIMS],
    ),
  );
}

async function setupPrivateProfile(label) {
  const runtime = await ensureNativeRuntime();
  const scratchParent = await ensureScratchParent(runtime);
  profileOrdinal += 1;
  const nonce = createHash("sha256")
    .update(Buffer.from(`statefs-private:${label}:${profileOrdinal}`, "utf8"))
    .digest();
  const input = validatePrivateProfileInput(
    record(["scratchParent", scratchParent], ["runNonceBytes", nonce]),
  );
  const kernelRelease = kernelReleaseFromBridge(runtime.production);
  const effectiveUid = process.geteuid();
  const effectiveGid = process.getegid();
  const parentFd = openCanonicalParent(runtime.production, input.scratchParent);
  let childFd = -1;
  let childCreated = false;
  try {
    assert.equal(invokeSuccess(runtime.production, BRIDGE.FCNTL, parentFd, F_GETFD), FD_CLOEXEC);
    assert.equal(invokeSuccess(runtime.production, BRIDGE.FCNTL, parentFd, F_GETFL) & 3, O_RDONLY);
    const parentIdentity = bridgeStatx(runtime.production, parentFd);
    const parentMagic = bridgeFilesystemMagic(runtime.production, parentFd);
    assert.equal(parentIdentity.ownerUid, effectiveUid);
    assert.equal(parentIdentity.ownerGid, effectiveGid);
    assert.equal(parentIdentity.mode & S_IFMT, S_IFDIR);
    assert.equal(parentIdentity.mode & 0o7777, 0o700);
    assert.equal(Number(parentIdentity.linkCount) >= 2, true);
    assert.notEqual(parentIdentity.inode, "0");
    assert.notEqual(parentIdentity.mountId, "0");
    const mount = parseMountInfo(
      await readFile("/proc/self/mountinfo"),
      input.scratchParent,
    );
    assert.equal(mount.mountId, parentIdentity.mountId);
    assert.equal(mount.device, `${parentIdentity.deviceMajor}:${parentIdentity.deviceMinor}`);
    assert.equal(
      (mount.filesystemType === "ext4" && parentMagic === 0x0000ef53n) ||
        (mount.filesystemType === "xfs" && parentMagic === 0x58465342n),
      true,
    );
    const previousMask = invokeSuccess(runtime.production, BRIDGE.UMASK, 0o077);
    let created;
    try {
      created = invoke(
        runtime.production,
        BRIDGE.MKDIRAT,
        parentFd,
        rawName(input.stateRootName),
        0o700,
      );
      if (created.returnValue !== -1) childCreated = true;
    } finally {
      invokeSuccess(runtime.production, BRIDGE.UMASK, previousMask);
    }
    if (created.returnValue === -1) {
      throw Object.assign(new Error("PRIVATE_FS_PROFILE_PATH"), { errno: created.errno });
    }
    childFd = invokeSuccess(
      runtime.production,
      BRIDGE.OPENAT,
      parentFd,
      rawName(input.stateRootName),
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
    );
    assert.equal(invokeSuccess(runtime.production, BRIDGE.FCNTL, childFd, F_GETFD), 0);
    assert.equal(invokeSuccess(runtime.production, BRIDGE.FCNTL, childFd, F_GETFL) & 3, O_RDONLY);
    const identity = bridgeStatx(runtime.production, childFd);
    const filesystemMagic = bridgeFilesystemMagic(runtime.production, childFd);
    assert.equal(identity.ownerUid, effectiveUid);
    assert.equal(identity.ownerGid, effectiveGid);
    assert.equal(identity.mode & S_IFMT, S_IFDIR);
    assert.equal(identity.mode & 0o7777, 0o700);
    assert.equal(Number(identity.linkCount) >= 2, true);
    assert.notEqual(identity.inode, "0");
    assert.equal(identity.mountId, parentIdentity.mountId);
    assert.equal(identity.deviceMajor, parentIdentity.deviceMajor);
    assert.equal(identity.deviceMinor, parentIdentity.deviceMinor);
    assert.equal(filesystemMagic, parentMagic);
    return {
      runtime,
      input,
      kernelRelease,
      effectiveUid,
      effectiveGid,
      parentFd,
      childFd,
      identity,
      filesystemMagic,
      mount,
      candidateFds: [childFd],
      candidateCloseErrno: null,
    };
  } catch (error) {
    let firstCleanupErrno = null;
    const rememberCleanupError = (cleanupError) => {
      if (firstCleanupErrno === null) {
        firstCleanupErrno = nativeErrno(cleanupError);
      }
    };
    let childCloseFailed = false;
    if (childFd !== -1) {
      try {
        const childClose = bridgeClose(runtime.production, childFd);
        if (childClose.returnValue === -1) {
          childCloseFailed = true;
          rememberCleanupError(
            Object.assign(new Error("setup child close"), {
              errno: childClose.errno,
            }),
          );
        }
      } catch (cleanupError) {
        childCloseFailed = true;
        rememberCleanupError(cleanupError);
      }
    }
    if (childCreated && !childCloseFailed) {
      try {
        const childRemove = invoke(
          runtime.production,
          BRIDGE.UNLINKAT,
          parentFd,
          rawName(input.stateRootName),
          AT_REMOVEDIR,
        );
        if (childRemove.returnValue === -1) {
          rememberCleanupError(
            Object.assign(new Error("setup child remove"), {
              errno: childRemove.errno,
            }),
          );
        }
      } catch (cleanupError) {
        rememberCleanupError(cleanupError);
      }
    }
    try {
      const parentClose = bridgeClose(runtime.production, parentFd);
      if (parentClose.returnValue === -1) {
        rememberCleanupError(
          Object.assign(new Error("setup parent close"), {
            errno: parentClose.errno,
          }),
        );
      }
    } catch (cleanupError) {
      rememberCleanupError(cleanupError);
    }
    if (
      firstCleanupErrno !== null &&
      error !== null &&
      typeof error === "object" &&
      Object.isExtensible(error)
    ) {
      Object.defineProperty(error, "cleanupErrno", {
        configurable: false,
        enumerable: false,
        value: firstCleanupErrno,
        writable: false,
      });
    }
    throw error;
  }
}

function registerCandidateFd(profile, descriptor) {
  assert.equal(Number.isInteger(descriptor) && descriptor >= 0, true);
  profile.candidateFds.push(descriptor);
}

function retireCandidateFd(profile, descriptor) {
  const index = profile.candidateFds.lastIndexOf(descriptor);
  assert.notEqual(index, -1);
  profile.candidateFds.splice(index, 1);
}

function nativeErrno(error) {
  return Number.isInteger(error?.errno) && error.errno >= 1 && error.errno <= 4095
    ? error.errno
    : 5;
}

function rememberCandidateCloseFailure(profile, error) {
  if (profile.candidateCloseErrno === null) {
    profile.candidateCloseErrno = nativeErrno(error);
  }
}

function cleanupPrivateProfile(profile) {
  let firstErrno = profile.candidateCloseErrno;
  let firstCleanupError = firstErrno === null
    ? null
    : Object.assign(new Error("earlier candidate close"), {
        errno: firstErrno,
      });
  const rememberError = (error) => {
    if (firstErrno === null) {
      firstErrno = nativeErrno(error);
      firstCleanupError = error;
    }
  };
  try {
    const finalIdentity = bridgeStatx(
      profile.runtime.production,
      profile.childFd,
    );
    for (const field of [
      "ownerUid",
      "ownerGid",
      "mode",
      "deviceMajor",
      "deviceMinor",
      "inode",
      "mountId",
    ]) {
      assert.equal(finalIdentity[field], profile.identity[field]);
    }
    assert.equal(Number(finalIdentity.linkCount) >= 2, true);
    assert.equal(
      bridgeFilesystemMagic(profile.runtime.production, profile.childFd),
      profile.filesystemMagic,
    );
  } catch (error) {
    rememberError(error);
  }
  for (const descriptor of [...profile.candidateFds].reverse()) {
    try {
      const closed = bridgeClose(profile.runtime.production, descriptor);
      if (closed.returnValue === -1) {
        rememberError(Object.assign(new Error("candidate close"), {
          errno: closed.errno,
        }));
      }
    } catch (error) {
      rememberError(error);
    }
  }
  profile.candidateFds.length = 0;
  if (firstErrno === null) {
    const cleanupDescriptors = [];
    try {
      const root = invokeSuccess(
        profile.runtime.production,
        BRIDGE.OPENAT,
        profile.parentFd,
        rawName(profile.input.stateRootName),
        O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
      );
      cleanupDirectory(
        profile.runtime.production,
        root,
        cleanupDescriptors,
        { aggregateEntries: 0 },
      );
      cleanupDescriptors.pop();
      const rootClose = bridgeClose(profile.runtime.production, root);
      if (rootClose.returnValue === -1) {
        throw Object.assign(new Error("cleanup root close"), {
          errno: rootClose.errno,
        });
      }
      invokeSuccess(
        profile.runtime.production,
        BRIDGE.UNLINKAT,
        profile.parentFd,
        rawName(profile.input.stateRootName),
        AT_REMOVEDIR,
      );
    } catch (error) {
      rememberError(error);
      for (const descriptor of [...cleanupDescriptors].reverse()) {
        try {
          const closed = bridgeClose(profile.runtime.production, descriptor);
          if (closed.returnValue === -1) {
            rememberError(Object.assign(new Error("cleanup descriptor close"), {
              errno: closed.errno,
            }));
          }
        } catch (closeError) {
          rememberError(closeError);
        }
      }
    }
  }
  try {
    const parentClose = bridgeClose(profile.runtime.production, profile.parentFd);
    if (parentClose.returnValue === -1) {
      rememberError(Object.assign(new Error("scratch parent close"), {
        errno: parentClose.errno,
      }));
    }
  } catch (error) {
    rememberError(error);
  }
  return {
    cleanupError: firstCleanupError,
    report: profileReport(profile, firstErrno === null, firstErrno),
  };
}

async function withPrivateProfile(label, body) {
  const profile = await setupPrivateProfile(label);
  let value;
  let bodyError;
  try {
    value = await body(profile);
  } catch (error) {
    bodyError = error;
  }
  const { cleanupError, report } = cleanupPrivateProfile(profile);
  if (bodyError !== undefined) {
    if (bodyError !== null && typeof bodyError === "object" && Object.isExtensible(bodyError)) {
      Object.defineProperty(bodyError, "privateFilesystemReport", {
        configurable: false,
        enumerable: false,
        value: report,
        writable: false,
      });
    }
    throw bodyError;
  }
  if (!report.cleanupCompleted) {
    const error = new Error("PRIVATE_FS_PROFILE_CLEANUP", {
      cause: cleanupError,
    });
    Object.defineProperty(error, "privateFilesystemReport", {
      configurable: false,
      enumerable: false,
      value: report,
      writable: false,
    });
    throw error;
  }
  return { value, report };
}

const ROLE_NAMES = array(
  "NONE",
  "STATE_ROOT",
  "LIFETIMES",
  "LIFETIME_SEGMENT",
  "STAGING",
  "ACTIVE",
  "CLOSED",
  "RECOVERED",
  "QUARANTINED",
  "GENERATION",
  "NORMAL_JOURNAL",
  "RECOVERY_JOURNAL",
  "RECOVERY_ATTEMPT",
);
const INVENTORY_KIND_NAMES = array("NONE", "DIRECTORY", "REGULAR_FILE");
const OBSERVATION_KIND_NAMES = array(
  "ABSENT",
  "REGULAR",
  "DIRECTORY",
  "SYMLINK",
  "FIFO",
  "BLOCK_DEVICE",
  "CHARACTER_DEVICE",
  "SOCKET",
  "OTHER",
);
const STATUS_NAMES = array(
  "COMPLETE",
  "REJECTED",
  "SYSCALL_FAILED",
  "LIMIT_EXCEEDED",
  "FAULT_INJECTED",
  "VERIFICATION_FAILED",
);
const EFFECT_NAMES = array(
  "NO_EFFECT",
  "DEFINITE_NO_EFFECT",
  "COMPLETE",
  "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
  "EFFECT_UNCERTAIN",
);
const STEP_NAMES = STEPS.map(([name]) => name);
const OPERATION_NAMES = OPERATIONS.map(([name]) => name);
const EXECUTOR_RESULT_FIELDS = array(
  "schema",
  "abiVersion",
  "requestSha256",
  "operation",
  "status",
  "effectClass",
  "lastCompletedStep",
  "failedStep",
  "errno",
  "completedStepCount",
  "bytesConsumed",
  "observations",
  "outputBytes",
  "returnedDirectoryFd",
);
const PLANNER_INPUT_FIELDS = array(
  "kind",
  "managerActorEpochSha256",
  "requestSequence",
  "inventorySetSha256",
  "stateRootObservation",
  "currentInventorySet",
  "unresolvedReceipt",
  "generationManifest",
  "normalJournalBundles",
  "lifetimeReplayArguments",
  "recoveryTarget",
  "recoveryInventory",
  "recoveryReplay",
  "recoveryPlan",
  "recoveryAttempt",
  "recoveryRecord",
  "artifactBytes",
  "inventoryDirectoryRole",
  "directoryRoleA",
  "directoryRoleB",
  "nameA",
  "nameB",
  "expectedOutcome",
);

function numericFor(entries, name) {
  const entry = entries.find(([candidate]) => candidate === name);
  assert.notEqual(entry, undefined, name);
  return entry[1];
}

function exactEnumName(names, index, label) {
  assert.equal(Number.isInteger(index) && index >= 0 && index < names.length, true, label);
  const value = names[index];
  assert.equal(typeof value, "string", label);
  return value;
}

function exactSafeUnsignedNumber(value, label) {
  assert.equal(typeof value, "bigint", label);
  assert.equal(value <= BigInt(Number.MAX_SAFE_INTEGER), true, label);
  return Number(value);
}

function decimal(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^(?:0|[1-9][0-9]*)$/u);
  return BigInt(value);
}

function nativeContext(descriptor, role, identity, filesystemMagic) {
  return deepFreeze(
    record(
      ["descriptor", descriptor],
      ["role", role],
      ["identity", identity],
      ["filesystemMagic", filesystemMagic],
    ),
  );
}

function operationCapacities(variant) {
  if (variant === "LOCK_EX_NB") return [1, 0];
  if (variant === "INVENTORY/DIRECTORY/ROOT" || variant === "INVENTORY/DIRECTORY/CHILD") return [257, 32768];
  if (variant === "INVENTORY/REGULAR_FILE/PRESENT" || variant === "INVENTORY/REGULAR_FILE/ABSENT") return [1, 98304];
  if (variant === "PERSIST_NOREPLACE") return [1, 98304];
  if (variant === "MKDIR_SYNC") return [1, 0];
  if (variant === "MOVE_NOREPLACE_SYNC" || variant === "MOVE_SYNC_REOBSERVE") return [2, 0];
  if (variant === "TEMP_CLEANUP") return [1, 0];
  if (variant === "RELEASE_DIRECTORY") return [0, 0];
  assert.fail(`unknown variant ${variant}`);
}

function encodeNativeRequest(specification) {
  const request = Buffer.alloc(192);
  const nameA = specification.nameA === null ? Buffer.alloc(0) : rawName(specification.nameA);
  const nameB = specification.nameB === null ? Buffer.alloc(0) : rawName(specification.nameB);
  for (const [label, name] of [["nameA", nameA], ["nameB", nameB]]) {
    assert.equal(
      name.length === 0 || name.every((byte) => byte >= 0x20 && byte <= 0x7e),
      true,
      label,
    );
  }
  const input = specification.input === null ? Buffer.alloc(0) : Buffer.from(specification.input);
  const [observationCapacity, outputCapacity] = operationCapacities(specification.variant);
  const fdA = specification.fdA;
  const fdB = specification.fdB;
  request.writeUInt32LE(1, 0);
  request.writeUInt32LE(192, 4);
  request.writeUInt32LE(numericFor(OPERATIONS, specification.operation), 8);
  const inventoryKind = INVENTORY_KIND_NAMES.indexOf(specification.inventoryKind);
  assert.notEqual(inventoryKind, -1);
  request.writeUInt32LE(inventoryKind, 12);
  request.writeInt32LE(fdA?.descriptor ?? 0, 16);
  request.writeInt32LE(fdB?.descriptor ?? 0, 20);
  const roleA = fdA === null ? 0 : ROLE_NAMES.indexOf(fdA.role);
  const roleB = fdB === null ? 0 : ROLE_NAMES.indexOf(fdB.role);
  assert.notEqual(roleA, -1);
  assert.notEqual(roleB, -1);
  request.writeUInt32LE(roleA, 24);
  request.writeUInt32LE(roleB, 28);
  request.writeUInt32LE(nameA.length, 32);
  request.writeUInt32LE(nameB.length, 36);
  request.writeBigUInt64LE(BigInt(input.length), 40);
  request.writeUInt32LE(observationCapacity, 80);
  request.writeUInt32LE(outputCapacity, 84);
  request.writeUInt32LE(specification.faultSelector, 96);
  request.writeUInt32LE(specification.expectedOwnerUid, 100);
  request.writeUInt32LE(specification.expectedOwnerGid, 104);
  const inventoryDirectoryRole = specification.inventoryDirectoryRole === null
    ? 0
    : ROLE_NAMES.indexOf(specification.inventoryDirectoryRole);
  assert.notEqual(inventoryDirectoryRole, -1);
  request.writeUInt32LE(inventoryDirectoryRole, 108);
  for (const [context, base] of [[fdA, 112], [fdB, 120]]) {
    if (context !== null) request.writeBigUInt64LE(decimal(context.identity.mountId), base);
  }
  if (fdA !== null) {
    request.writeBigUInt64LE(decimal(fdA.identity.deviceMajor), 128);
    request.writeBigUInt64LE(decimal(fdA.identity.deviceMinor), 136);
    request.writeBigUInt64LE(decimal(fdA.identity.inode), 144);
    request.writeBigUInt64LE(fdA.filesystemMagic, 152);
  }
  if (fdB !== null) {
    request.writeBigUInt64LE(decimal(fdB.identity.deviceMajor), 160);
    request.writeBigUInt64LE(decimal(fdB.identity.deviceMinor), 168);
    request.writeBigUInt64LE(decimal(fdB.identity.inode), 176);
    request.writeBigUInt64LE(fdB.filesystemMagic, 184);
  }
  return {
    request,
    nameA,
    nameB,
    input,
    observations: Buffer.alloc(observationCapacity * 384, 0xa5),
    output: Buffer.alloc(outputCapacity),
    result: Buffer.alloc(64),
  };
}

function decodeNativeObservation(bytes, offset) {
  assert.equal(bytes.readUInt32LE(offset), 384);
  assert.equal(bytes.readBigUInt64LE(offset + 360), 0n);
  assert.equal(bytes.readBigUInt64LE(offset + 368), 0n);
  assert.equal(bytes.readBigUInt64LE(offset + 376), 0n);
  const kind = exactEnumName(
    OBSERVATION_KIND_NAMES,
    bytes.readUInt32LE(offset + 4),
    "observation kind",
  );
  const nameLength = bytes.readUInt32LE(offset + 12);
  assert.equal(nameLength <= 255, true);
  const nameArea = bytes.subarray(offset + 104, offset + 360);
  assert.equal(nameArea.subarray(nameLength).every((byte) => byte === 0), true);
  const rawObservedName = nameArea.subarray(0, nameLength);
  assert.equal(
    rawObservedName.every(
      (byte) => byte >= 0x01 && byte <= 0x7f && byte !== 0x2f,
    ),
    true,
  );
  const name = nameLength === 0 ? null : rawObservedName.toString("ascii");
  assert.equal(name !== "." && name !== "..", true);
  const statxMask = bytes.readUInt32LE(offset + 76);
  assert.equal(
    kind === "ABSENT" ? statxMask === 0 : (statxMask & 0x17ff) === 0x17ff,
    true,
  );
  const role = exactEnumName(
    ROLE_NAMES,
    bytes.readUInt32LE(offset + 8),
    "observation role",
  );
  return deepFreeze(
    record(
      ["kind", kind],
      ["role", role],
      ["name", name],
      ["deviceMajor", bytes.readBigUInt64LE(offset + 16).toString(10)],
      ["deviceMinor", bytes.readBigUInt64LE(offset + 24).toString(10)],
      ["inode", bytes.readBigUInt64LE(offset + 32).toString(10)],
      ["mountId", bytes.readBigUInt64LE(offset + 40).toString(10)],
      ["byteLength", bytes.readBigUInt64LE(offset + 48).toString(10)],
      ["linkCount", bytes.readBigUInt64LE(offset + 56).toString(10)],
      ["mode", bytes.readUInt32LE(offset + 64)],
      ["ownerUid", bytes.readUInt32LE(offset + 68)],
      ["ownerGid", bytes.readUInt32LE(offset + 72)],
      ["statxMask", statxMask],
      ["filesystemMagic", bytes.readBigUInt64LE(offset + 80).toString(10)],
      ["contentOffset", exactSafeUnsignedNumber(bytes.readBigUInt64LE(offset + 88), "contentOffset")],
      ["contentLength", exactSafeUnsignedNumber(bytes.readBigUInt64LE(offset + 96), "contentLength")],
    ),
  );
}

function decodeNativeResult(specification, buffers) {
  const bytes = buffers.result;
  assert.equal(bytes.readUInt32LE(0), 1);
  assert.equal(bytes.readUInt32LE(4), 64);
  assert.equal(bytes.readBigUInt64LE(56), 0n);
  const operation = exactEnumName(OPERATION_NAMES, bytes.readUInt32LE(8), "result operation");
  const status = exactEnumName(STATUS_NAMES, bytes.readUInt32LE(12), "result status");
  const effectClass = exactEnumName(EFFECT_NAMES, bytes.readUInt32LE(16), "result effect");
  const lastCompletedStep = exactEnumName(
    STEP_NAMES,
    bytes.readUInt32LE(20),
    "result last step",
  );
  const failedStep = exactEnumName(
    STEP_NAMES,
    bytes.readUInt32LE(24),
    "result failed step",
  );
  assert.equal(operation, specification.operation);
  const observationCount = bytes.readUInt32LE(32);
  const outputLength = bytes.readUInt32LE(36);
  assert.equal(observationCount * 384 <= buffers.observations.length, true);
  assert.equal(outputLength <= buffers.output.length, true);
  assert.equal(
    buffers.observations
      .subarray(observationCount * 384)
      .every((byte) => byte === 0),
    true,
  );
  const observations = array(
    ...Array.from({ length: observationCount }, (_, index) =>
      decodeNativeObservation(buffers.observations, index * 384),
    ),
  );
  for (const observation of observations) {
    assert.equal(
      observation.contentOffset + observation.contentLength <= outputLength,
      true,
    );
  }
  const values = {
    schema: "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: specification.requestSha256,
    operation,
    status,
    effectClass,
    lastCompletedStep,
    failedStep,
    errno: bytes.readInt32LE(28),
    completedStepCount: bytes.readUInt32LE(40),
    bytesConsumed: exactSafeUnsignedNumber(bytes.readBigUInt64LE(48), "bytesConsumed"),
    observations,
    outputBytes:
      specification.inventoryKind === "REGULAR_FILE"
        ? Buffer.from(buffers.output.subarray(0, outputLength))
        : outputLength === 0
          ? null
          : Buffer.from(buffers.output.subarray(0, outputLength)),
    returnedDirectoryFd: bytes.readInt32LE(44),
  };
  return record(...EXECUTOR_RESULT_FIELDS.map((field) => [field, values[field]]));
}

function executeNative(
  bridge,
  specification,
  { onReturnedDirectoryFd = null } = {},
) {
  const buffers = encodeNativeRequest(specification);
  buffers.result.writeInt32LE(-1, 44);
  const immutable = [buffers.request, buffers.nameA, buffers.nameB, buffers.input].map((bytes) => Buffer.from(bytes));
  const call = invoke(
    bridge,
    BRIDGE.EXECUTE,
    buffers.request,
    buffers.nameA,
    buffers.nameB,
    buffers.input,
    buffers.observations,
    buffers.output,
    buffers.result,
  );
  const rawReturnedDirectoryFd = buffers.result.readInt32LE(44);
  if (rawReturnedDirectoryFd >= 0) {
    if (onReturnedDirectoryFd === null) {
      const closed = bridgeClose(bridge, rawReturnedDirectoryFd);
      assert.equal(
        closed.returnValue,
        0,
        `untracked returned fd close errno ${closed.errno}`,
      );
      assert.fail("untracked returned directory fd");
    }
    onReturnedDirectoryFd(rawReturnedDirectoryFd);
  }
  assert.equal(call.returnValue, 0);
  const result = decodeNativeResult(specification, buffers);
  assert.equal(result.returnedDirectoryFd, rawReturnedDirectoryFd);
  for (const [index, bytes] of [buffers.request, buffers.nameA, buffers.nameB, buffers.input].entries()) {
    assert.equal(bytes.equals(immutable[index]), true, `immutable native input ${index}`);
  }
  return result;
}

function heldDirectoryPrefix(context, role, closeOnExec) {
  const mode = context.identity.mode & 0o7777;
  assert.equal(mode, 0o700);
  assert.equal(context.identity.mode & S_IFMT, S_IFDIR);
  assert.equal(context.identity.ownerUid, process.geteuid());
  assert.equal(context.identity.ownerGid, process.getegid());
  assert.equal(Number(context.identity.linkCount) >= 2, true);
  return record(
    ["schema", "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1"],
    ["role", role],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", closeOnExec],
    ["fileType", "DIRECTORY"],
    ["ownerUid", context.identity.ownerUid],
    ["ownerGid", context.identity.ownerGid],
    ["mode", mode.toString(8).padStart(4, "0")],
    ["linkCount", context.identity.linkCount],
    ["deviceMajor", context.identity.deviceMajor],
    ["deviceMinor", context.identity.deviceMinor],
    ["inode", context.identity.inode],
    ["mountId", context.identity.mountId],
    ["filesystemMagic", context.filesystemMagic.toString(10)],
  );
}

function heldDirectoryObservation(context, role, closeOnExec) {
  const prefix = heldDirectoryPrefix(context, role, closeOnExec);
  return record(
    ...Object.entries(prefix),
    ["identitySha256", semanticSha256(prefix)],
    ["authority", EXPECTED_AUTHORITY],
    ["physicalFacts", EXPECTED_PHYSICAL_FACTS],
    ["nonclaims", EXPECTED_NONCLAIMS],
  );
}

function managerDigest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function plannerInput(overrides = {}) {
  const values = {
    kind: "LOCK_EX_NB",
    managerActorEpochSha256: managerDigest("private-statefs-manager-epoch"),
    requestSequence: 0,
    inventorySetSha256: null,
    stateRootObservation: null,
    currentInventorySet: null,
    unresolvedReceipt: null,
    generationManifest: null,
    normalJournalBundles: null,
    lifetimeReplayArguments: null,
    recoveryTarget: null,
    recoveryInventory: null,
    recoveryReplay: null,
    recoveryPlan: null,
    recoveryAttempt: null,
    recoveryRecord: null,
    artifactBytes: null,
    inventoryDirectoryRole: null,
    directoryRoleA: null,
    directoryRoleB: null,
    nameA: null,
    nameB: null,
    expectedOutcome: "LOCK_HELD",
    ...overrides,
  };
  return record(...PLANNER_INPUT_FIELDS.map((field) => [field, values[field]]));
}

function ownerArtifact(value) {
  return record(["name", value.name], ["bytes", value.bytes]);
}

function ownerLifetimeReplayArguments(
  owner,
  recordCount = owner.records.length,
) {
  const records = owner.records.slice(0, recordCount);
  const latest = records.at(-1) ?? null;
  return record(
    [
      "segments",
      recordCount === 0
        ? array()
        : array(
            record(
              ["lifetimeIdentity", owner.identity],
              ["records", array(...records.map(ownerArtifact))],
            ),
          ),
    ],
    ["expectedStateRootIdentitySha256", owner.root.identitySha256],
    [
      "expectedLatestLifetimeEpochSha256",
      latest === null ? null : owner.identity.lifetimeEpochSha256,
    ],
    ["expectedLatestRecordSequence", latest?.sequence ?? null],
    ["expectedLatestRecordRawSha256", latest?.rawSha256 ?? null],
  );
}

function createPrivateLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journal = null,
}) {
  const zeroReplay = lifetimeOwner.replayCandidateContainmentGuardianLifetimeV1(
    {
      segments: [],
      expectedStateRootIdentitySha256: root.identitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    },
  );
  const identity =
    lifetimeOwner.createCandidateContainmentGuardianLifetimeIdentityV1({
      lifetimeKind: "NORMAL",
      stateRootIdentitySha256: root.identitySha256,
      managerActorEpochSha256,
      bootIdSha256: journal?.bootIdSha256 ?? managerDigest(`${label}:boot`),
      delegatedRootIdentitySha256:
        journal?.delegatedRootIdentitySha256 ??
        managerDigest(`${label}:delegated-root`),
      lifetimeEpochSha256:
        journal?.birthGuardianEpochSha256 ??
        managerDigest(`${label}:lifetime-epoch`),
      limitsSha256: managerDigest(`${label}:lifetime-limits`),
      guardianExecutableIdentitySha256: managerDigest(
        `${label}:guardian-executable`,
      ),
      guardianControlRequirementsSha256: managerDigest(
        `${label}:guardian-control-requirements`,
      ),
      previousLifetimeReplay: zeroReplay,
    });
  const owner = {
    identity,
    records: [],
    replay: zeroReplay,
    root,
  };
  owner.append = (
    recordType,
    {
      writerKind = "SERVICE_MANAGER",
      writerActorEpochSha256 = managerActorEpochSha256,
      targetSha256 = null,
      operation = ownerFixtures.opaque(`${label}:${recordType}:operation`),
      evidence = ownerFixtures.opaque(`${label}:${recordType}:evidence`),
    } = {},
  ) => {
    const created =
      lifetimeOwner.createCandidateContainmentGuardianLifetimeRecordV1({
        previousLifetimeReplay: owner.replay,
        lifetimeIdentity: identity,
        writerKind,
        writerActorEpochSha256,
        targetSha256,
        recordType,
        operationBytes: Buffer.from(`${canonicalJson(operation)}\n`, "utf8"),
        evidenceBytes: Buffer.from(`${canonicalJson(evidence)}\n`, "utf8"),
      });
    owner.records.push(created);
    owner.replay = lifetimeOwner.replayCandidateContainmentGuardianLifetimeV1({
      segments: [
        {
          lifetimeIdentity: identity,
          records: owner.records.map((entry) => ({
            name: entry.name,
            bytes: entry.bytes,
          })),
        },
      ],
      expectedStateRootIdentitySha256: root.identitySha256,
      expectedLatestLifetimeEpochSha256: identity.lifetimeEpochSha256,
      expectedLatestRecordSequence: created.sequence,
      expectedLatestRecordRawSha256: created.rawSha256,
    });
    return created;
  };
  return owner;
}

function createPrivateAdoptedLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journal,
}) {
  const owner = createPrivateLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
    journal,
  });
  owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  owner.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
  const contextPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.lifetimeContext],
    ["lifetimeIdentitySha256", owner.identity.identitySha256],
    ["stateRootIdentitySha256", root.identitySha256],
    ["bootIdSha256", journal.bootIdSha256],
    ["delegatedRootIdentitySha256", journal.delegatedRootIdentitySha256],
    ["lifetimeCgroupIdentitySha256", managerDigest(`${label}:lifetime-cgroup`)],
  );
  owner.lifetimeContext = record(...Object.entries(contextPrefix), [
    "contextSha256",
    semanticSha256(contextPrefix),
  ]);
  owner.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
    evidence: owner.lifetimeContext,
  });
  owner.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  owner.append("GUARDIAN_PIDFD_OBSERVED");
  owner.append("GUARDIAN_EXEC_OBSERVED");
  owner.append("GUARDIAN_MEMBERSHIP_OBSERVED");
  owner.append("GUARDIAN_INITIALIZATION_ADOPTED", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
  });
  return owner;
}

function ownerJournalArtifacts(
  journal,
  count = journal.normalJournalBundles.length,
) {
  return array(
    ...journal.normalJournalBundles.slice(0, count).map(ownerArtifact),
  );
}

function buildPrivateCloseDecision(owner, journal, location) {
  const { target: independentTarget, projection } =
    ownerFixtures.independentlyDeriveRecoveryTargetFromFixtureArtifacts(
      journal,
    );
  const genesisInventoryPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisInventory],
    ["targetSha256", projection.targetSha256],
    ["reportedRecoveryDirectoryPresent", true],
    ["reportedRecoveryDirectoryEntryCount", 0],
    ["reportedExistingLifetimeTargetHead", false],
  );
  const targetGenesisInventory = record(
    ...Object.entries(genesisInventoryPrefix),
    ["inventorySha256", semanticSha256(genesisInventoryPrefix)],
  );
  const eventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisEvent],
    ["recoveryTargetProjection", projection],
    ["targetGenesisInventory", targetGenesisInventory],
    ["provedRebootTransitions", array()],
  );
  const event = record(...Object.entries(eventPrefix), [
    "eventSha256",
    semanticSha256(eventPrefix),
  ]);
  const genesisHead = ownerFixtures.recoveryExternalHead({
    targetSha256: projection.targetSha256,
    result: "NO_RECOVERY_ATTEMPT",
    recoveryActorEpochSha256: null,
    attemptDirectoryName: null,
    lifetimeAttemptAnchorRawSha256: null,
    latestRecoveryRecordSequence: null,
    latestRecoveryRecordRawSha256: ownerFixtures.ZERO_SHA256,
  });
  owner.append("GENERATION_RECOVERY_HEAD_DURABLE", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
    targetSha256: projection.targetSha256,
    operation: event,
    evidence: genesisHead,
  });
  const lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  const recoveryTarget =
    recoveryOwner.createCandidateContainmentRecoveryTargetV1({
      generationManifest: ownerArtifact(journal.generationManifest),
      normalJournalBundles: ownerJournalArtifacts(journal),
      lifetimeTargetSelection,
    });
  assert.equal(canonicalJson(recoveryTarget), canonicalJson(independentTarget));
  const expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  const recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  const recoveryInventory =
    recoveryOwner.createCandidateContainmentRecoveryInventoryObservationV1({
      generationIdentitySha256: journal.generationIdentity.identitySha256,
      stagingPresent: location === "staging",
      activePresent: location === "active",
      closedPresent: location === "closed",
      recoveredPresent: location === "recovered",
      quarantinedPresent: location === "quarantined",
      unsafeEntriesPresent: false,
    });
  const context = owner.lifetimeContext;
  const recoveryPlan = recoveryOwner.planCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    lifecycleInventoryObservation: recoveryInventory,
    previousRecoveryReplay: recoveryReplay,
    normalCloseDurabilityReceipt: null,
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedCurrentBootIdSha256: context.bootIdSha256,
    expectedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    expectedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    proposedActorKind: null,
    reportedCurrentBootIdSha256: context.bootIdSha256,
    reportedStateRootIdentitySha256: owner.root.identitySha256,
    reportedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    reportedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    reportedCommandDescriptorHeld: false,
    reportedStatusDescriptorHeld: false,
    reportedSupervisorPidfdHeld: false,
    reportedDirectChildWaitAuthority: false,
    reportedCgroupInventorySafe: true,
    reportedControlCgroupPresent: false,
    reportedJobCgroupPresent: false,
    reportedStateFilesystemInterfaceAvailable: true,
    reportedRecoveryInterfaceAvailable: true,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
  });
  assert.equal(recoveryPlan.status, "CLOSE_MOVE_REQUIRED");
  return {
    recoveryInventory,
    recoveryPlan,
    recoveryReplay,
    recoveryTarget,
  };
}

function privateAutoInput({
  label,
  managerActorEpochSha256,
  sequence,
  token,
  lifetimeReplayArguments,
  generationManifest = null,
  normalJournalBundles = null,
  recoveryTarget = null,
  recoveryInventory = null,
  recoveryReplay = null,
  recoveryPlan = null,
  artifactBytes = null,
}) {
  return plannerInput({
    kind: "AUTO",
    managerActorEpochSha256,
    requestSequence: sequence,
    inventorySetSha256: token.inventorySetSha256,
    currentInventorySet: token,
    lifetimeReplayArguments,
    generationManifest,
    normalJournalBundles,
    recoveryTarget,
    recoveryInventory,
    recoveryReplay,
    recoveryPlan,
    artifactBytes,
    expectedOutcome: null,
  });
}

function variantForRequest(request, observedPresence = null) {
  if (request.operation !== "INVENTORY") return request.operation;
  if (request.inventoryKind === "DIRECTORY") {
    return request.inventoryDirectoryRole === "STATE_ROOT"
      ? "INVENTORY/DIRECTORY/ROOT"
      : "INVENTORY/DIRECTORY/CHILD";
  }
  return observedPresence === false
    ? "INVENTORY/REGULAR_FILE/ABSENT"
    : "INVENTORY/REGULAR_FILE/PRESENT";
}

function nativeSpecificationForRequest(profile, request, handles, faultSelector = 0, observedPresence = null) {
  const fdA = request.directoryHandleSha256A === null
    ? null
    : handles.get(request.directoryHandleSha256A);
  const fdB = request.directoryHandleSha256B === null
    ? null
    : handles.get(request.directoryHandleSha256B);
  assert.equal(request.directoryHandleSha256A === null || fdA !== undefined, true);
  assert.equal(request.directoryHandleSha256B === null || fdB !== undefined, true);
  return {
    variant: variantForRequest(request, observedPresence),
    requestSha256: request.requestSha256,
    operation: request.operation,
    inventoryKind: request.inventoryKind,
    inventoryDirectoryRole: request.inventoryDirectoryRole,
    fdA: fdA ?? null,
    fdB: fdB ?? null,
    nameA: request.nameA,
    nameB: request.nameB,
    input: request.bytes === null ? null : Buffer.from(request.bytes),
    faultSelector,
    expectedOwnerUid: profile.effectiveUid,
    expectedOwnerGid: profile.effectiveGid,
  };
}

function dispatchAndExecute(
  profile,
  module,
  plan,
  handles,
  {
    fault = false,
    faultSelector = 0,
    observedPresence = null,
    verifierCounter = null,
  } = {},
) {
  const ownerContext = module.assertCandidateContainmentGuardianStatefsPlanV1(plan);
  assert.equal(ownerContext, plan.ownerContext);
  assert.equal(module.assertCandidateContainmentGuardianStatefsRequestV1(plan.request), true);
  let trackedDirectoryFd = -1;
  try {
    const result = executeNative(
      fault ? profile.runtime.fault : profile.runtime.production,
      nativeSpecificationForRequest(profile, plan.request, handles, faultSelector, observedPresence),
      {
        onReturnedDirectoryFd(descriptor) {
          trackedDirectoryFd = descriptor;
          registerCandidateFd(profile, descriptor);
        },
      },
    );
    if (trackedDirectoryFd >= 0) {
      assert.equal(
        invokeSuccess(
          profile.runtime.production,
          BRIDGE.FCNTL,
          trackedDirectoryFd,
          F_GETFD,
        ),
        FD_CLOEXEC,
      );
    }
    if (verifierCounter !== null) verifierCounter.count += 1;
    const receipt = module.verifyCandidateContainmentGuardianStatefsResultV1({
      request: plan.request,
      executorResult: result,
    });
    let returnedContext = null;
    if (trackedDirectoryFd >= 0) {
      returnedContext = nativeContext(
        trackedDirectoryFd,
        plan.request.inventoryDirectoryRole,
        bridgeStatx(profile.runtime.production, trackedDirectoryFd),
        bridgeFilesystemMagic(profile.runtime.production, trackedDirectoryFd),
      );
      assert.equal(result.observations.length >= 1, true);
      assert.deepEqual(
        result.observations[0],
        expectedNativeObservation({
          kind: "DIRECTORY",
          role: plan.request.inventoryDirectoryRole,
          name: null,
          identity: returnedContext.identity,
          filesystemMagic: returnedContext.filesystemMagic,
        }),
      );
      if (receipt.inventories.length === 1) {
        const inventory = receipt.inventories[0];
        assert.equal(inventory.directory.role, plan.request.inventoryDirectoryRole);
        handles.set(inventory.directoryHandleSha256, returnedContext);
      }
    }
    return { request: plan.request, result, receipt, returnedContext };
  } catch (error) {
    if (trackedDirectoryFd >= 0) {
      let closeErrno = null;
      try {
        const closed = bridgeClose(
          profile.runtime.production,
          trackedDirectoryFd,
        );
        if (closed.returnValue === -1) closeErrno = closed.errno;
      } catch (closeError) {
        closeErrno = nativeErrno(closeError);
      } finally {
        retireCandidateFd(profile, trackedDirectoryFd);
      }
      if (closeErrno !== null) {
        rememberCandidateCloseFailure(
          profile,
          Object.assign(new Error("returned directory close"), {
            errno: closeErrno,
          }),
        );
      }
      if (
        closeErrno !== null &&
        error !== null &&
        typeof error === "object" &&
        Object.isExtensible(error)
      ) {
        Object.defineProperty(error, "returnedDirectoryCloseErrno", {
          configurable: false,
          enumerable: false,
          value: closeErrno,
          writable: false,
        });
      }
    }
    throw error;
  }
}

function rawSpecification(
  profile,
  variant,
  {
    fdA,
    fdB = null,
    nameA = null,
    nameB = null,
    input = null,
    faultSelector = 0,
    expectedOwnerUid = profile.effectiveUid,
    expectedOwnerGid = profile.effectiveGid,
  },
) {
  const operation = variant.split("/")[0];
  const inventoryKind = variant.includes("/DIRECTORY/")
    ? "DIRECTORY"
    : variant.includes("/REGULAR_FILE/")
      ? "REGULAR_FILE"
      : "NONE";
  const inventoryDirectoryRole = variant === "INVENTORY/DIRECTORY/ROOT"
    ? "STATE_ROOT"
    : variant === "INVENTORY/DIRECTORY/CHILD"
      ? "LIFETIMES"
      : null;
  return {
    variant,
    requestSha256: managerDigest(`raw-request:${variant}:${nameA}:${nameB}:${faultSelector}`),
    operation,
    inventoryKind,
    inventoryDirectoryRole,
    fdA,
    fdB,
    nameA,
    nameB,
    input,
    faultSelector,
    expectedOwnerUid,
    expectedOwnerGid,
  };
}

function assertCompleteNative(result, variant, { bytesConsumed = 0 } = {}) {
  const sequence = SEQUENCES[variant];
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.effectClass, "COMPLETE");
  assert.equal(result.lastCompletedStep, STEP_NAMES[sequence.at(-1)]);
  assert.equal(result.failedStep, "NONE");
  assert.equal(result.errno, 0);
  assert.equal(result.completedStepCount, sequence.length);
  assert.equal(result.bytesConsumed, bytesConsumed);
}

function rawDirectoryObservationNameKey(observation) {
  assert.equal(observation !== null && typeof observation === "object", true);
  assert.equal(typeof observation.name, "string");
  const nameBytes = Buffer.from(observation.name, "ascii");
  assert.equal(nameBytes.length >= 1 && nameBytes.length <= 255, true);
  assert.equal(nameBytes.toString("ascii"), observation.name);
  return nameBytes.toString("hex");
}

function assertFaultObservations(actual, expected, request) {
  const directoryInventory =
    request.operation === "INVENTORY" && request.inventoryKind === "DIRECTORY";
  if (!directoryInventory) {
    assert.deepEqual(actual, expected);
    return;
  }

  assert.equal(actual.length, expected.length);
  if (actual.length === 0) return;
  assert.deepEqual(actual[0], expected[0]);

  const expectedByRawName = new Map();
  for (const observation of expected.slice(1)) {
    const rawName = rawDirectoryObservationNameKey(observation);
    assert.equal(expectedByRawName.has(rawName), false);
    expectedByRawName.set(rawName, observation);
  }

  const actualRawNames = new Set();
  for (const observation of actual.slice(1)) {
    const rawName = rawDirectoryObservationNameKey(observation);
    assert.equal(actualRawNames.has(rawName), false);
    assert.equal(expectedByRawName.has(rawName), true);
    assert.deepEqual(observation, expectedByRawName.get(rawName));
    actualRawNames.add(rawName);
  }
  assert.equal(actualRawNames.size, expectedByRawName.size);
}

function assertFaultNative(result, faultCase, fixture, profile) {
  const expected = expectedFaultResult(faultCase);
  assert.equal(result.requestSha256, fixture.plan.request.requestSha256);
  assert.equal(result.operation, fixture.plan.request.operation);
  assert.equal(result.status, expected.status, `${faultCase.operation}:${faultCase.selector}:status`);
  assert.equal(result.effectClass, expected.effectClass, `${faultCase.operation}:${faultCase.selector}:effect`);
  assert.equal(result.lastCompletedStep, STEP_NAMES[expected.lastCompletedStep]);
  assert.equal(result.failedStep, STEP_NAMES[expected.failedStep]);
  assert.equal(result.errno, expected.errno);
  assert.equal(result.completedStepCount, expected.completedStepCount);
  const regularInventory =
    fixture.plan.request.operation === "INVENTORY" &&
    fixture.plan.request.inventoryKind === "REGULAR_FILE";
  if (regularInventory) {
    const present = fixture.observedPresence === true;
    const observed = faultCase.completedPrefix.includes(7);
    const expectedOutput = present && observed
      ? fixture.topology.inventoryRecordBytes
      : Buffer.alloc(0);
    assert.deepEqual(result.outputBytes, expectedOutput);
    assert.equal(result.bytesConsumed, expectedOutput.length);
  } else {
    assert.equal(result.outputBytes, null);
    assert.equal(
      result.bytesConsumed,
      fixture.plan.request.operation === "PERSIST_NOREPLACE" &&
        faultCase.completedPrefix.includes(9)
        ? fixture.plan.request.inputByteLength
        : 0,
    );
  }
  const returnedDirectory =
    faultCase.operation === "INVENTORY/DIRECTORY/CHILD" &&
    faultCase.completedPrefix.includes(32);
  assert.equal(
    returnedDirectory
      ? result.returnedDirectoryFd >= 0
      : result.returnedDirectoryFd === -1,
    true,
  );
  assertFaultObservations(
    result.observations,
    expectedFaultObservations(profile, faultCase, fixture),
    fixture.plan.request,
  );
}

function fixtureDirectory(profile, name, role, { closeOnExec = true } = {}) {
  invokeSuccess(
    profile.runtime.production,
    BRIDGE.MKDIRAT,
    profile.childFd,
    rawName(name),
    0o700,
  );
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    profile.childFd,
    rawName(name),
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | (closeOnExec ? O_CLOEXEC : 0),
  );
  registerCandidateFd(profile, descriptor);
  assert.equal(
    invokeSuccess(profile.runtime.production, BRIDGE.FCNTL, descriptor, F_GETFD),
    closeOnExec ? FD_CLOEXEC : 0,
  );
  return nativeContext(
    descriptor,
    role,
    bridgeStatx(profile.runtime.production, descriptor),
    bridgeFilesystemMagic(profile.runtime.production, descriptor),
  );
}

function closeFixtureDirectory(profile, context, { alreadyClosed = false } = {}) {
  if (alreadyClosed) {
    retireCandidateFd(profile, context.descriptor);
  } else {
    closeTrackedDirectory(profile, context);
  }
}

function createFixtureFile(profile, context, name, bytes, mode = 0o600) {
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    context.descriptor,
    rawName(name),
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    mode,
  );
  registerCandidateFd(profile, descriptor);
  let offset = 0;
  let bodyError;
  try {
    while (offset < bytes.length) {
      const count = invokeSuccess(
        profile.runtime.production,
        BRIDGE.WRITE,
        descriptor,
        bytes.subarray(offset),
      );
      assert.equal(count > 0, true);
      offset += count;
    }
    invokeSuccess(profile.runtime.production, BRIDGE.FSYNC, descriptor);
  } catch (error) {
    bodyError = error;
  }
  let closeError;
  try {
    closeRegisteredDescriptor(profile, descriptor, "fixture file");
  } catch (error) {
    closeError = error;
  }
  if (bodyError !== undefined) {
    if (
      closeError !== undefined &&
      bodyError !== null &&
      typeof bodyError === "object" &&
      Object.isExtensible(bodyError)
    ) {
      Object.defineProperty(bodyError, "fixtureFileCloseErrno", {
        configurable: false,
        enumerable: false,
        value: nativeErrno(closeError),
        writable: false,
      });
    }
    throw bodyError;
  }
  if (closeError !== undefined) throw closeError;
}

function statxOutcome(bridge, descriptor, name) {
  const output = Buffer.alloc(256);
  const result = invoke(
    bridge,
    BRIDGE.STATX,
    descriptor,
    rawName(name),
    AT_SYMLINK_NOFOLLOW,
    STATX_BASIC_STATS | STATX_MNT_ID,
    output,
  );
  return {
    result,
    observation: result.returnValue === -1 ? null : parseStatx(output),
  };
}

function operationName(index, label) {
  return managerDigest(`${label}:${index}`);
}

function validRecordName(index, label) {
  return `${String(index + 1).padStart(16, "0")}-${operationName(index, label)}.jsonl`;
}

function validTemporaryName(index, label) {
  const finalName = validRecordName(index, label);
  return `.${finalName}.tmp-${operationName(index, `${label}:temporary`)}`;
}

const PRIVATE_ROOT_CHILDREN = array(
  array("lifetimes", "LIFETIMES"),
  array("staging", "STAGING"),
  array("active", "ACTIVE"),
  array("closed", "CLOSED"),
  array("recovered", "RECOVERED"),
  array("quarantined", "QUARANTINED"),
);

function assertLocalDirectoryIdentity(profile, identity) {
  assert.equal(identity.ownerUid, profile.effectiveUid);
  assert.equal(identity.ownerGid, profile.effectiveGid);
  assert.equal(identity.mode & S_IFMT, S_IFDIR);
  assert.equal(identity.mode & 0o7777, 0o700);
  assert.equal(Number(identity.linkCount) >= 2, true);
  assert.equal(identity.deviceMajor, profile.identity.deviceMajor);
  assert.equal(identity.deviceMinor, profile.identity.deviceMinor);
  assert.equal(identity.mountId, profile.identity.mountId);
  assert.notEqual(identity.inode, "0");
}

function createFixtureDirectoryAt(profile, parent, name) {
  invokeSuccess(
    profile.runtime.production,
    BRIDGE.MKDIRAT,
    parent.descriptor,
    rawName(name),
    0o700,
  );
  const identity = bridgeStatx(profile.runtime.production, parent.descriptor, name);
  assertLocalDirectoryIdentity(profile, identity);
  return identity;
}

function openFixtureDirectoryAt(
  profile,
  parent,
  name,
  role,
  { closeOnExec = true } = {},
) {
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    parent.descriptor,
    rawName(name),
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | (closeOnExec ? O_CLOEXEC : 0),
  );
  registerCandidateFd(profile, descriptor);
  assert.equal(
    invokeSuccess(profile.runtime.production, BRIDGE.FCNTL, descriptor, F_GETFD),
    closeOnExec ? FD_CLOEXEC : 0,
  );
  const identity = bridgeStatx(profile.runtime.production, descriptor);
  assertLocalDirectoryIdentity(profile, identity);
  return nativeContext(
    descriptor,
    role,
    identity,
    bridgeFilesystemMagic(profile.runtime.production, descriptor),
  );
}

function closeRegisteredDescriptor(profile, descriptor, label) {
  let closed;
  try {
    closed = bridgeClose(profile.runtime.production, descriptor);
  } catch (error) {
    rememberCandidateCloseFailure(profile, error);
    throw error;
  } finally {
    retireCandidateFd(profile, descriptor);
  }
  if (closed.returnValue === -1) {
    const error = Object.assign(new Error(`${label} close(${descriptor})`), {
      errno: closed.errno,
    });
    rememberCandidateCloseFailure(profile, error);
    throw error;
  }
  assert.equal(closed.returnValue, 0, `close(${descriptor}) errno ${closed.errno}`);
  assert.equal(closed.errno, 0);
}

function closeRegisteredAfterBody(
  profile,
  descriptor,
  label,
  bodyError,
) {
  let closeError;
  try {
    closeRegisteredDescriptor(profile, descriptor, label);
  } catch (error) {
    closeError = error;
  }
  if (bodyError !== undefined) {
    if (
      closeError !== undefined &&
      bodyError !== null &&
      typeof bodyError === "object" &&
      Object.isExtensible(bodyError)
    ) {
      Object.defineProperty(bodyError, "registeredDescriptorCloseErrno", {
        configurable: false,
        enumerable: false,
        value: nativeErrno(closeError),
        writable: false,
      });
    }
    throw bodyError;
  }
  if (closeError !== undefined) throw closeError;
}

function closeTrackedDirectory(profile, context) {
  closeRegisteredDescriptor(
    profile,
    context.descriptor,
    `candidate ${context.role} directory`,
  );
}

function retireProvedReleasedDirectory(profile, context, label) {
  const observed = invoke(
    profile.runtime.production,
    BRIDGE.FCNTL,
    context.descriptor,
    F_GETFD,
  );
  assert.deepEqual(
    [observed.returnValue, observed.errno],
    [-1, EBADF],
    `${label}: release must close descriptor exactly once`,
  );
  retireCandidateFd(profile, context.descriptor);
}

function withFixtureDirectory(profile, parent, name, role, body) {
  const context = openFixtureDirectoryAt(profile, parent, name, role);
  let value;
  let bodyError;
  try {
    value = body(context);
  } catch (error) {
    bodyError = error;
  }
  let closeError;
  try {
    closeTrackedDirectory(profile, context);
  } catch (error) {
    closeError = error;
  }
  if (bodyError !== undefined) {
    if (
      closeError !== undefined &&
      bodyError !== null &&
      typeof bodyError === "object" &&
      Object.isExtensible(bodyError)
    ) {
      Object.defineProperty(bodyError, "fixtureDirectoryCloseErrno", {
        configurable: false,
        enumerable: false,
        value: nativeErrno(closeError),
        writable: false,
      });
    }
    throw bodyError;
  }
  if (closeError !== undefined) throw closeError;
  return value;
}

function refreshedContext(profile, context, role = context.role) {
  const identity = bridgeStatx(profile.runtime.production, context.descriptor);
  assertLocalDirectoryIdentity(profile, identity);
  return nativeContext(
    context.descriptor,
    role,
    identity,
    bridgeFilesystemMagic(profile.runtime.production, context.descriptor),
  );
}

function deterministicTemporaryName(
  managerActorEpochSha256,
  authorizationRawSha256,
  name,
  bytes,
) {
  const identity = semanticSha256(
    record(
      ["managerActorEpochSha256", managerActorEpochSha256],
      ["authorizationRawSha256", authorizationRawSha256],
      ["operation", "PERSIST_NOREPLACE"],
      ["nameB", name],
      ["inputRawSha256", sha256(bytes)],
    ),
  );
  return `.${name}.tmp-${identity}`;
}

function buildPhysicalCaseTopology(profile, faultCase, index) {
  const label = `private-fault-${String(index).padStart(3, "0")}`;
  const managerActorEpochSha256 = managerDigest(`${label}:manager-actor-epoch`);
  let root = nativeContext(
    profile.childFd,
    "STATE_ROOT",
    profile.identity,
    profile.filesystemMagic,
  );
  for (const [name] of PRIVATE_ROOT_CHILDREN) {
    createFixtureDirectoryAt(profile, root, name);
  }

  let journal = null;
  let owner = null;
  let lifetimeRecord = null;
  let segmentName = null;
  let inventoryRecordName = null;
  let inventoryRecordBytes = null;
  let generationName = null;
  let generationIdentity = null;
  let temporaryName = null;

  const preliminaryRoot = refreshedContext(profile, root, "STATE_ROOT");
  const preliminaryRootIdentitySha256 = semanticSha256(
    heldDirectoryPrefix(preliminaryRoot, "STATE_ROOT", false),
  );

  if (
    faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/") ||
    faultCase.operation === "PERSIST_NOREPLACE"
  ) {
    if (faultCase.operation === "PERSIST_NOREPLACE") {
      owner = createPrivateLifetimeOwner({
        label,
        root: record(["identitySha256", preliminaryRootIdentitySha256]),
        managerActorEpochSha256,
      });
      segmentName = owner.identity.identitySha256;
    } else {
      segmentName = managerDigest(`${label}:inventory-segment`);
      inventoryRecordName = validRecordName(index, `${label}:inventory`);
      inventoryRecordBytes = Buffer.from(
        `${canonicalJson(record(["case", index], ["kind", "inventory"]))}\n`,
        "utf8",
      );
    }
    withFixtureDirectory(profile, root, "lifetimes", "LIFETIMES", (lifetimes) => {
      createFixtureDirectoryAt(profile, lifetimes, segmentName);
      if (faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/")) {
        withFixtureDirectory(
          profile,
          lifetimes,
          segmentName,
          "LIFETIME_SEGMENT",
          (segment) => {
            if (faultCase.operation.endsWith("/PRESENT")) {
              createFixtureFile(
                profile,
                segment,
                inventoryRecordName,
                inventoryRecordBytes,
              );
            }
          },
        );
      }
    });
  }

  if (
    faultCase.operation === "MOVE_NOREPLACE_SYNC" ||
    faultCase.operation === "MOVE_SYNC_REOBSERVE" ||
    faultCase.operation === "TEMP_CLEANUP"
  ) {
    journal = ownerFixtures.createJournalStack(label, 18);
    generationName = journal.generationIdentity.identitySha256;
  }

  if (
    faultCase.operation === "MOVE_NOREPLACE_SYNC" ||
    faultCase.operation === "MOVE_SYNC_REOBSERVE"
  ) {
    const location = faultCase.operation === "MOVE_NOREPLACE_SYNC"
      ? "active"
      : "closed";
    withFixtureDirectory(
      profile,
      root,
      location,
      location === "active" ? "ACTIVE" : "CLOSED",
      (parent) => {
        generationIdentity = createFixtureDirectoryAt(
          profile,
          parent,
          generationName,
        );
      },
    );
  }

  if (faultCase.operation === "TEMP_CLEANUP") {
    const finalBundle = journal.normalJournalBundles[17];
    temporaryName = deterministicTemporaryName(
      managerActorEpochSha256,
      finalBundle.previousBundleRawSha256,
      finalBundle.name,
      finalBundle.bytes,
    );
    withFixtureDirectory(profile, root, "active", "ACTIVE", (active) => {
      generationIdentity = createFixtureDirectoryAt(
        profile,
        active,
        generationName,
      );
      withFixtureDirectory(
        profile,
        active,
        generationName,
        "GENERATION",
        (generation) => {
          createFixtureFile(
            profile,
            generation,
            "generation.jsonl",
            journal.generationManifest.bytes,
          );
          createFixtureDirectoryAt(profile, generation, "normal");
          createFixtureDirectoryAt(profile, generation, "recovery");
          withFixtureDirectory(
            profile,
            generation,
            "normal",
            "NORMAL_JOURNAL",
            (normal) => {
              for (const bundle of journal.normalJournalBundles) {
                createFixtureFile(profile, normal, bundle.name, bundle.bytes);
              }
              createFixtureFile(
                profile,
                normal,
                temporaryName,
                finalBundle.bytes,
              );
            },
          );
        },
      );
    });
  }

  const rootChildIdentities = record(
    ...PRIVATE_ROOT_CHILDREN.map(([name]) => [
      name,
      bridgeStatx(profile.runtime.production, root.descriptor, name),
    ]),
  );
  root = refreshedContext(profile, root, "STATE_ROOT");
  const heldRoot = heldDirectoryObservation(root, "STATE_ROOT", false);
  assert.equal(heldRoot.identitySha256, preliminaryRootIdentitySha256);

  if (faultCase.operation === "PERSIST_NOREPLACE") {
    owner.root = heldRoot;
    lifetimeRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  } else if (faultCase.operation === "MKDIR_SYNC") {
    owner = createPrivateLifetimeOwner({
      label,
      root: heldRoot,
      managerActorEpochSha256,
    });
    lifetimeRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  } else if (
    faultCase.operation === "MOVE_NOREPLACE_SYNC" ||
    faultCase.operation === "MOVE_SYNC_REOBSERVE" ||
    faultCase.operation === "TEMP_CLEANUP"
  ) {
    owner = createPrivateAdoptedLifetimeOwner({
      label,
      root: heldRoot,
      managerActorEpochSha256,
      journal,
    });
  }

  return {
    generationIdentity,
    generationName,
    heldRoot,
    inventoryRecordBytes,
    inventoryRecordName,
    journal,
    label,
    lifetimeRecord,
    managerActorEpochSha256,
    owner,
    root,
    rootChildIdentities,
    segmentName,
    temporaryName,
  };
}

async function freshPrivateStatefs(label) {
  return import(
    `${STATEFS_SOURCE_URL.href}?private-statefs-fault=${encodeURIComponent(label)}`
  );
}

function privateInventoryInput({
  managerActorEpochSha256,
  sequence,
  token,
  inventoryDirectoryRole,
  directoryRoleA,
  nameA,
}) {
  return plannerInput({
    kind: "INVENTORY",
    managerActorEpochSha256,
    requestSequence: sequence,
    inventorySetSha256: token.inventorySetSha256,
    currentInventorySet: token,
    inventoryDirectoryRole,
    directoryRoleA,
    nameA,
    expectedOutcome: "INVENTORY_OBSERVED",
  });
}

function planPrivateInventory(module, options) {
  return module.planCandidateContainmentGuardianStatefsOperationV1(
    privateInventoryInput(options),
  );
}

function completePrivatePrerequisite(
  profile,
  module,
  plan,
  handles,
  contexts,
  { observedPresence = null } = {},
) {
  const dispatched = dispatchAndExecute(profile, module, plan, handles, {
    observedPresence,
  });
  assert.equal(dispatched.receipt.outcome, plan.request.expectedOutcome);
  assert.equal(dispatched.receipt.retryDisposition, "NO_RETRY");
  assert.notEqual(dispatched.receipt.inventorySet, null);
  if (dispatched.returnedContext !== null) {
    contexts.push(dispatched.returnedContext);
  }
  return dispatched.receipt.inventorySet;
}

async function faultFixture(profile, faultCase, index) {
  const topology = buildPhysicalCaseTopology(profile, faultCase, index);
  const module = await freshPrivateStatefs(`${topology.label}:${faultCase.selector}`);
  const contexts = [];
  const handles = new Map();
  let sequence = 0;

  const lockPlan = module.planCandidateContainmentGuardianStatefsOperationV1(
    plannerInput({
      managerActorEpochSha256: topology.managerActorEpochSha256,
      requestSequence: sequence,
      stateRootObservation: topology.heldRoot,
    }),
  );
  handles.set(lockPlan.request.directoryHandleSha256A, topology.root);
  if (faultCase.operation === "LOCK_EX_NB") {
    return { contexts, handles, module, observedPresence: null, plan: lockPlan, topology };
  }
  let token = completePrivatePrerequisite(
    profile,
    module,
    lockPlan,
    handles,
    contexts,
  );
  sequence += 1;

  const rootPlan = planPrivateInventory(module, {
    managerActorEpochSha256: topology.managerActorEpochSha256,
    sequence,
    token,
    inventoryDirectoryRole: "STATE_ROOT",
    directoryRoleA: "STATE_ROOT",
    nameA: null,
  });
  if (faultCase.operation === "INVENTORY/DIRECTORY/ROOT") {
    return { contexts, handles, module, observedPresence: null, plan: rootPlan, topology };
  }
  token = completePrivatePrerequisite(
    profile,
    module,
    rootPlan,
    handles,
    contexts,
  );
  sequence += 1;

  const completeChild = (role, parentRole, name) => {
    const plan = planPrivateInventory(module, {
      managerActorEpochSha256: topology.managerActorEpochSha256,
      sequence,
      token,
      inventoryDirectoryRole: role,
      directoryRoleA: parentRole,
      nameA: name,
    });
    token = completePrivatePrerequisite(
      profile,
      module,
      plan,
      handles,
      contexts,
    );
    sequence += 1;
    return plan;
  };

  if (faultCase.operation === "INVENTORY/DIRECTORY/CHILD") {
    const plan = planPrivateInventory(module, {
      managerActorEpochSha256: topology.managerActorEpochSha256,
      sequence,
      token,
      inventoryDirectoryRole: "LIFETIMES",
      directoryRoleA: "STATE_ROOT",
      nameA: "lifetimes",
    });
    return { contexts, handles, module, observedPresence: null, plan, topology };
  }

  if (
    faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/") ||
    faultCase.operation === "PERSIST_NOREPLACE" ||
    faultCase.operation === "MKDIR_SYNC" ||
    faultCase.operation === "RELEASE_DIRECTORY"
  ) {
    completeChild("LIFETIMES", "STATE_ROOT", "lifetimes");
  }

  if (faultCase.operation === "MKDIR_SYNC") {
    assert.equal(sequence, 3);
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      privateAutoInput({
        label: topology.label,
        managerActorEpochSha256: topology.managerActorEpochSha256,
        sequence,
        token,
        lifetimeReplayArguments: ownerLifetimeReplayArguments(topology.owner, 0),
        artifactBytes: topology.lifetimeRecord.bytes,
      }),
    );
    return { contexts, handles, module, observedPresence: null, plan, topology };
  }

  if (faultCase.operation === "RELEASE_DIRECTORY") {
    assert.equal(sequence, 3);
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({
        kind: "RELEASE_DIRECTORY",
        managerActorEpochSha256: topology.managerActorEpochSha256,
        requestSequence: sequence,
        inventorySetSha256: token.inventorySetSha256,
        currentInventorySet: token,
        directoryRoleA: "LIFETIMES",
        expectedOutcome: "DIRECTORY_RELEASED",
      }),
    );
    return { contexts, handles, module, observedPresence: null, plan, topology };
  }

  if (
    faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/") ||
    faultCase.operation === "PERSIST_NOREPLACE"
  ) {
    completeChild(
      "LIFETIME_SEGMENT",
      "LIFETIMES",
      topology.segmentName,
    );
    const present = faultCase.operation.endsWith("/PRESENT");
    const regularPlan = planPrivateInventory(module, {
      managerActorEpochSha256: topology.managerActorEpochSha256,
      sequence,
      token,
      inventoryDirectoryRole: null,
      directoryRoleA: "LIFETIME_SEGMENT",
      nameA:
        faultCase.operation === "PERSIST_NOREPLACE"
          ? topology.lifetimeRecord.name
          : topology.inventoryRecordName,
    });
    if (faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/")) {
      assert.equal(sequence, 4);
      return { contexts, handles, module, observedPresence: present, plan: regularPlan, topology };
    }
    token = completePrivatePrerequisite(
      profile,
      module,
      regularPlan,
      handles,
      contexts,
      { observedPresence: false },
    );
    sequence += 1;
    assert.equal(sequence, 5);
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      privateAutoInput({
        label: topology.label,
        managerActorEpochSha256: topology.managerActorEpochSha256,
        sequence,
        token,
        lifetimeReplayArguments: ownerLifetimeReplayArguments(topology.owner, 0),
        artifactBytes: topology.lifetimeRecord.bytes,
      }),
    );
    return { contexts, handles, module, observedPresence: null, plan, topology };
  }

  if (
    faultCase.operation === "MOVE_NOREPLACE_SYNC" ||
    faultCase.operation === "MOVE_SYNC_REOBSERVE"
  ) {
    completeChild("ACTIVE", "STATE_ROOT", "active");
    completeChild("CLOSED", "STATE_ROOT", "closed");
    assert.equal(sequence, 4);
    const closeDecision = buildPrivateCloseDecision(
      topology.owner,
      topology.journal,
      faultCase.operation === "MOVE_NOREPLACE_SYNC" ? "active" : "closed",
    );
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      privateAutoInput({
        label: topology.label,
        managerActorEpochSha256: topology.managerActorEpochSha256,
        sequence,
        token,
        lifetimeReplayArguments: ownerLifetimeReplayArguments(topology.owner),
        generationManifest: ownerArtifact(topology.journal.generationManifest),
        normalJournalBundles: ownerJournalArtifacts(topology.journal),
        recoveryTarget: closeDecision.recoveryTarget,
        recoveryInventory: closeDecision.recoveryInventory,
        recoveryReplay: closeDecision.recoveryReplay,
        recoveryPlan: closeDecision.recoveryPlan,
      }),
    );
    return { contexts, handles, module, observedPresence: null, plan, topology };
  }

  assert.equal(faultCase.operation, "TEMP_CLEANUP");
  completeChild("ACTIVE", "STATE_ROOT", "active");
  completeChild("GENERATION", "ACTIVE", topology.generationName);
  completeChild("NORMAL_JOURNAL", "GENERATION", "normal");
  const temporaryInventory = planPrivateInventory(module, {
    managerActorEpochSha256: topology.managerActorEpochSha256,
    sequence,
    token,
    inventoryDirectoryRole: null,
    directoryRoleA: "NORMAL_JOURNAL",
    nameA: topology.temporaryName,
  });
  token = completePrivatePrerequisite(
    profile,
    module,
    temporaryInventory,
    handles,
    contexts,
    { observedPresence: true },
  );
  sequence += 1;
  assert.equal(sequence, 6);
  const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
    privateAutoInput({
      label: topology.label,
      managerActorEpochSha256: topology.managerActorEpochSha256,
      sequence,
      token,
      lifetimeReplayArguments: ownerLifetimeReplayArguments(topology.owner),
      generationManifest: ownerArtifact(topology.journal.generationManifest),
      normalJournalBundles: ownerJournalArtifacts(topology.journal),
    }),
  );
  assert.equal(plan.request.nameA, topology.temporaryName);
  return { contexts, handles, module, observedPresence: null, plan, topology };
}

function assertNamedPresence(bridge, context, name, expectedPresent, label) {
  const observed = statxOutcome(bridge, context.descriptor, name);
  if (expectedPresent) {
    assert.equal(observed.result.returnValue, 0, label);
    assert.notEqual(observed.observation, null, label);
  } else {
    assert.equal(observed.result.returnValue, -1, label);
    assert.equal(observed.result.errno, 2, label);
    assert.equal(observed.observation, null, label);
  }
}

function observedDirectoryNames(profile, context) {
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    context.descriptor,
    rawName("."),
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
  );
  registerCandidateFd(profile, descriptor);
  const names = [];
  let bodyError;
  try {
    while (true) {
      const bytes = Buffer.alloc(32768);
      const count = invokeSuccess(
        profile.runtime.production,
        BRIDGE.GETDENTS64,
        descriptor,
        bytes,
      );
      if (count === 0) break;
      names.push(...parseDirectoryEntries(bytes, count).map((name) => name.toString("ascii")));
    }
  } catch (error) {
    bodyError = error;
  }
  closeRegisteredAfterBody(
    profile,
    descriptor,
    "allowlist observation",
    bodyError,
  );
  return names.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii")),
  );
}

function assertDirectoryAllowlist(profile, context, expectedNames, label) {
  const expected = [...expectedNames].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii")),
  );
  assert.deepEqual(observedDirectoryNames(profile, context), expected, label);
}

function withObservedChildDirectory(profile, parent, name, role, body) {
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    parent.descriptor,
    rawName(name),
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
  );
  registerCandidateFd(profile, descriptor);
  const context = nativeContext(
    descriptor,
    role,
    bridgeStatx(profile.runtime.production, descriptor),
    bridgeFilesystemMagic(profile.runtime.production, descriptor),
  );
  let value;
  let bodyError;
  try {
    value = body(context);
  } catch (error) {
    bodyError = error;
  }
  closeRegisteredAfterBody(
    profile,
    descriptor,
    `observed ${role} directory`,
    bodyError,
  );
  return value;
}

function assertExactDirectoryAt(
  profile,
  parent,
  name,
  label,
  originalIdentity = null,
) {
  const identity = bridgeStatx(profile.runtime.production, parent.descriptor, name);
  assertLocalDirectoryIdentity(profile, identity);
  if (originalIdentity !== null) {
    for (const field of [
      "ownerUid",
      "ownerGid",
      "mode",
      "deviceMajor",
      "deviceMinor",
      "inode",
      "mountId",
    ]) {
      assert.equal(identity[field], originalIdentity[field], `${label}.${field}`);
    }
  }
  return identity;
}

function assertExactRegularFileAt(
  profile,
  parent,
  name,
  expectedBytes,
  label,
  expectedMode = 0o600,
) {
  const descriptor = invokeSuccess(
    profile.runtime.production,
    BRIDGE.OPENAT,
    parent.descriptor,
    rawName(name),
    O_RDONLY | O_CLOEXEC | O_NOFOLLOW,
  );
  registerCandidateFd(profile, descriptor);
  let observed;
  let bodyError;
  try {
    const identity = bridgeStatx(profile.runtime.production, descriptor);
    assert.equal(identity.mode & S_IFMT, S_IFREG, `${label}.type`);
    assert.equal(identity.mode & 0o7777, expectedMode, `${label}.mode`);
    assert.equal(identity.ownerUid, profile.effectiveUid, `${label}.uid`);
    assert.equal(identity.ownerGid, profile.effectiveGid, `${label}.gid`);
    assert.equal(identity.linkCount, "1", `${label}.links`);
    assert.equal(identity.byteLength, String(expectedBytes.length), `${label}.size`);
    assert.equal(identity.deviceMajor, parent.identity.deviceMajor, `${label}.major`);
    assert.equal(identity.deviceMinor, parent.identity.deviceMinor, `${label}.minor`);
    assert.equal(identity.mountId, parent.identity.mountId, `${label}.mount`);
    assert.equal(
      bridgeFilesystemMagic(profile.runtime.production, descriptor),
      parent.filesystemMagic,
      `${label}.magic`,
    );
    const chunks = [];
    let total = 0;
    while (true) {
      const bytes = Buffer.alloc(Math.min(65536, expectedBytes.length + 1 - total));
      const count = invokeSuccess(
        profile.runtime.production,
        BRIDGE.READ,
        descriptor,
        bytes,
      );
      if (count === 0) break;
      chunks.push(Buffer.from(bytes.subarray(0, count)));
      total += count;
      assert.equal(total <= expectedBytes.length, true, `${label}.bounded read`);
    }
    observed = Buffer.concat(chunks);
  } catch (error) {
    bodyError = error;
  }
  closeRegisteredAfterBody(
    profile,
    descriptor,
    "regular observation",
    bodyError,
  );
  assert.deepEqual(observed, expectedBytes, `${label}.bytes`);
}

function expectedNativeObservation({
  kind,
  role,
  name,
  identity,
  filesystemMagic,
  contentLength = 0,
}) {
  return record(
    ["kind", kind],
    ["role", role],
    ["name", name],
    ["deviceMajor", identity.deviceMajor],
    ["deviceMinor", identity.deviceMinor],
    ["inode", identity.inode],
    ["mountId", identity.mountId],
    ["byteLength", identity.byteLength],
    ["linkCount", identity.linkCount],
    ["mode", identity.mode],
    ["ownerUid", identity.ownerUid],
    ["ownerGid", identity.ownerGid],
    ["statxMask", identity.mask],
    ["filesystemMagic", filesystemMagic.toString(10)],
    ["contentOffset", 0],
    ["contentLength", contentLength],
  );
}

function expectedAbsentObservation(role, name) {
  return record(
    ["kind", "ABSENT"],
    ["role", role],
    ["name", name],
    ["deviceMajor", "0"],
    ["deviceMinor", "0"],
    ["inode", "0"],
    ["mountId", "0"],
    ["byteLength", "0"],
    ["linkCount", "0"],
    ["mode", 0],
    ["ownerUid", 0],
    ["ownerGid", 0],
    ["statxMask", 0],
    ["filesystemMagic", "0"],
    ["contentOffset", 0],
    ["contentLength", 0],
  );
}

function expectedEntryObservation(profile, parent, name, role = "NONE") {
  const observed = statxOutcome(profile.runtime.production, parent.descriptor, name);
  assert.equal(observed.result.returnValue, 0);
  const identity = observed.observation;
  const type = identity.mode & S_IFMT;
  assert.equal(type === S_IFDIR || type === S_IFREG, true);
  return expectedNativeObservation({
    kind: type === S_IFDIR ? "DIRECTORY" : "REGULAR",
    role,
    name,
    identity,
    filesystemMagic: parent.filesystemMagic,
  });
}

function expectedDirectoryInventoryObservations(profile, target, role) {
  const currentTarget = refreshedContext(profile, target, role);
  const targetObservation = expectedNativeObservation({
    kind: "DIRECTORY",
    role,
    name: null,
    identity: currentTarget.identity,
    filesystemMagic: currentTarget.filesystemMagic,
  });
  const entries = observedDirectoryNames(profile, currentTarget).map((name) =>
    expectedEntryObservation(profile, currentTarget, name),
  );
  return array(targetObservation, ...entries);
}

function withFaultDirectoryTarget(profile, fixture, body) {
  if (fixture.plan.request.inventoryDirectoryRole === "STATE_ROOT") {
    return body(fixture.topology.root);
  }
  return withObservedChildDirectory(
    profile,
    fixture.specification.fdA,
    fixture.plan.request.nameA,
    fixture.plan.request.inventoryDirectoryRole,
    body,
  );
}

function expectedFaultObservations(profile, faultCase, fixture) {
  const completed = faultCase.completedPrefix;
  const request = fixture.plan.request;
  if (request.operation === "LOCK_EX_NB") {
    if (!completed.includes(2)) return array();
    const root = refreshedContext(profile, fixture.topology.root, "STATE_ROOT");
    return array(
      expectedNativeObservation({
        kind: "DIRECTORY",
        role: "STATE_ROOT",
        name: null,
        identity: root.identity,
        filesystemMagic: root.filesystemMagic,
      }),
    );
  }
  if (request.operation === "INVENTORY" && request.inventoryKind === "DIRECTORY") {
    if (!completed.includes(5)) return array();
    return withFaultDirectoryTarget(profile, fixture, (target) => {
      const observations = expectedDirectoryInventoryObservations(
        profile,
        target,
        request.inventoryDirectoryRole,
      );
      return completed.includes(6) ? observations : array(observations[0]);
    });
  }
  if (request.operation === "INVENTORY") {
    if (!completed.includes(7)) return array();
    if (fixture.observedPresence === false) {
      return array(expectedAbsentObservation(request.directoryRoleA, request.nameA));
    }
    return array(
      expectedEntryObservation(
        profile,
        fixture.specification.fdA,
        request.nameA,
        request.directoryRoleA,
      ),
    ).map((observation) =>
      record(
        ...Object.entries(observation).filter(([key]) => key !== "contentLength"),
        ["contentLength", fixture.topology.inventoryRecordBytes.length],
      ),
    );
  }
  if (request.operation === "PERSIST_NOREPLACE" && completed.includes(21)) {
    return array(
      expectedEntryObservation(
        profile,
        fixture.specification.fdA,
        request.nameB,
        request.directoryRoleA,
      ),
    ).map((observation) =>
      record(
        ...Object.entries(observation).filter(([key]) => key !== "contentLength"),
        ["contentLength", 0],
      ),
    );
  }
  if (request.operation === "MKDIR_SYNC" && completed.includes(21)) {
    return array(
      expectedEntryObservation(
        profile,
        fixture.specification.fdA,
        request.nameA,
        "LIFETIME_SEGMENT",
      ),
    );
  }
  if (
    (request.operation === "MOVE_NOREPLACE_SYNC" ||
      request.operation === "MOVE_SYNC_REOBSERVE") &&
    completed.includes(22)
  ) {
    const observations = [
      expectedAbsentObservation(request.directoryRoleA, request.nameA),
    ];
    if (completed.includes(21)) {
      observations.push(
        expectedEntryObservation(
          profile,
          fixture.specification.fdB,
          request.nameB,
          request.directoryRoleB,
        ),
      );
    }
    return array(...observations);
  }
  if (request.operation === "TEMP_CLEANUP" && completed.includes(23)) {
    return array(expectedAbsentObservation(request.directoryRoleA, request.nameA));
  }
  return array();
}

function assertFaultResidue(profile, faultCase, fixture) {
  const completed = faultCase.completedPrefix;
  const { specification, topology } = fixture;
  assertDirectoryAllowlist(
    profile,
    topology.root,
    PRIVATE_ROOT_CHILDREN.map(([name]) => name),
    `${faultCase.operation}:${faultCase.selector}:root allowlist`,
  );
  for (const [name] of PRIVATE_ROOT_CHILDREN) {
    const baseline = topology.rootChildIdentities[name];
    const observed = assertExactDirectoryAt(
      profile,
      topology.root,
      name,
      `${faultCase.operation}:${faultCase.selector}:root/${name}`,
      baseline,
    );
    let expectedLinkDelta = 0;
    if (
      faultCase.operation === "MKDIR_SYNC" &&
      completed.includes(13) &&
      name === "lifetimes"
    ) {
      expectedLinkDelta = 1;
    }
    if (
      faultCase.operation === "MOVE_NOREPLACE_SYNC" &&
      completed.includes(16)
    ) {
      if (name === "active") expectedLinkDelta = -1;
      if (name === "closed") expectedLinkDelta = 1;
    }
    assert.equal(
      Number(observed.linkCount),
      Number(baseline.linkCount) + expectedLinkDelta,
      `${faultCase.operation}:${faultCase.selector}:root/${name}.linkCount`,
    );
    if (expectedLinkDelta === 0) {
      assert.equal(
        observed.byteLength,
        baseline.byteLength,
        `${faultCase.operation}:${faultCase.selector}:root/${name}.byteLength`,
      );
    }
  }
  if (
    faultCase.operation.startsWith("INVENTORY/REGULAR_FILE/") ||
    faultCase.operation === "PERSIST_NOREPLACE"
  ) {
    withObservedChildDirectory(
      profile,
      topology.root,
      "lifetimes",
      "LIFETIMES",
      (lifetimes) => {
        assertDirectoryAllowlist(
          profile,
          lifetimes,
          [topology.segmentName],
          `${faultCase.operation}:${faultCase.selector}:lifetimes allowlist`,
        );
        assertExactDirectoryAt(
          profile,
          lifetimes,
          topology.segmentName,
          `${faultCase.operation}:${faultCase.selector}:segment metadata`,
        );
      },
    );
  }
  if (faultCase.operation === "PERSIST_NOREPLACE") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      completed.includes(8) && !completed.includes(12),
      `${faultCase.operation}:${faultCase.selector}:temporary`,
    );
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameB,
      completed.includes(12),
      `${faultCase.operation}:${faultCase.selector}:final`,
    );
    const temporaryPresent = completed.includes(8) && !completed.includes(12);
    const finalPresent = completed.includes(12);
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      temporaryPresent
        ? [specification.nameA]
        : finalPresent
          ? [specification.nameB]
          : [],
      `${faultCase.operation}:${faultCase.selector}:segment allowlist`,
    );
    if (temporaryPresent) {
      assertExactRegularFileAt(
        profile,
        specification.fdA,
        specification.nameA,
        completed.includes(9) ? specification.input : Buffer.alloc(0),
        `${faultCase.operation}:${faultCase.selector}:temporary`,
      );
    }
    if (finalPresent) {
      assertExactRegularFileAt(
        profile,
        specification.fdA,
        specification.nameB,
        specification.input,
        `${faultCase.operation}:${faultCase.selector}:final`,
      );
    }
  } else if (faultCase.operation === "MKDIR_SYNC") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      completed.includes(13),
      `${faultCase.operation}:${faultCase.selector}:child`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      completed.includes(13) ? [specification.nameA] : [],
      `${faultCase.operation}:${faultCase.selector}:lifetimes allowlist`,
    );
    if (completed.includes(13)) {
      assertExactDirectoryAt(
        profile,
        specification.fdA,
        specification.nameA,
        `${faultCase.operation}:${faultCase.selector}:child metadata`,
      );
    }
  } else if (faultCase.operation === "MOVE_NOREPLACE_SYNC") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      !completed.includes(16),
      `${faultCase.operation}:${faultCase.selector}:source`,
    );
    assertNamedPresence(
      profile.runtime.production,
      specification.fdB,
      specification.nameB,
      completed.includes(16),
      `${faultCase.operation}:${faultCase.selector}:destination`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      completed.includes(16) ? [] : [specification.nameA],
      `${faultCase.operation}:${faultCase.selector}:source allowlist`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdB,
      completed.includes(16) ? [specification.nameB] : [],
      `${faultCase.operation}:${faultCase.selector}:destination allowlist`,
    );
    assertExactDirectoryAt(
      profile,
      completed.includes(16) ? specification.fdB : specification.fdA,
      completed.includes(16) ? specification.nameB : specification.nameA,
      `${faultCase.operation}:${faultCase.selector}:generation identity`,
      topology.generationIdentity,
    );
  } else if (faultCase.operation === "MOVE_SYNC_REOBSERVE") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      false,
      `${faultCase.operation}:${faultCase.selector}:source`,
    );
    assertNamedPresence(
      profile.runtime.production,
      specification.fdB,
      specification.nameB,
      true,
      `${faultCase.operation}:${faultCase.selector}:destination`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      [],
      `${faultCase.operation}:${faultCase.selector}:source allowlist`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdB,
      [specification.nameB],
      `${faultCase.operation}:${faultCase.selector}:destination allowlist`,
    );
    assertExactDirectoryAt(
      profile,
      specification.fdB,
      specification.nameB,
      `${faultCase.operation}:${faultCase.selector}:generation identity`,
      topology.generationIdentity,
    );
  } else if (faultCase.operation === "TEMP_CLEANUP") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      !completed.includes(19),
      `${faultCase.operation}:${faultCase.selector}:temporary`,
    );
    const finalBundles = topology.journal.normalJournalBundles;
    const expectedNames = finalBundles.map(({ name }) => name);
    if (!completed.includes(19)) expectedNames.push(specification.nameA);
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      expectedNames,
      `${faultCase.operation}:${faultCase.selector}:normal journal allowlist`,
    );
    for (const bundle of finalBundles) {
      assertExactRegularFileAt(
        profile,
        specification.fdA,
        bundle.name,
        bundle.bytes,
        `${faultCase.operation}:${faultCase.selector}:${bundle.name}`,
      );
    }
    if (!completed.includes(19)) {
      assertExactRegularFileAt(
        profile,
        specification.fdA,
        specification.nameA,
        finalBundles[17].bytes,
        `${faultCase.operation}:${faultCase.selector}:temporary bytes`,
      );
    }
    withObservedChildDirectory(
      profile,
      topology.root,
      "active",
      "ACTIVE",
      (active) => {
        assertDirectoryAllowlist(
          profile,
          active,
          [topology.generationName],
          `${faultCase.operation}:${faultCase.selector}:active allowlist`,
        );
        assertExactDirectoryAt(
          profile,
          active,
          topology.generationName,
          `${faultCase.operation}:${faultCase.selector}:generation metadata`,
          topology.generationIdentity,
        );
        withObservedChildDirectory(
          profile,
          active,
          topology.generationName,
          "GENERATION",
          (generation) => {
            assertDirectoryAllowlist(
              profile,
              generation,
              ["generation.jsonl", "normal", "recovery"],
              `${faultCase.operation}:${faultCase.selector}:generation allowlist`,
            );
            assertExactRegularFileAt(
              profile,
              generation,
              "generation.jsonl",
              topology.journal.generationManifest.bytes,
              `${faultCase.operation}:${faultCase.selector}:manifest`,
            );
            withObservedChildDirectory(
              profile,
              generation,
              "recovery",
              "RECOVERY_JOURNAL",
              (recovery) => {
                assertDirectoryAllowlist(
                  profile,
                  recovery,
                  [],
                  `${faultCase.operation}:${faultCase.selector}:recovery allowlist`,
                );
              },
            );
          },
        );
      },
    );
  } else if (faultCase.operation === "INVENTORY/REGULAR_FILE/PRESENT") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      true,
      `${faultCase.operation}:${faultCase.selector}:immutable fixture`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      [specification.nameA],
      `${faultCase.operation}:${faultCase.selector}:segment allowlist`,
    );
    assertExactRegularFileAt(
      profile,
      specification.fdA,
      specification.nameA,
      topology.inventoryRecordBytes,
      `${faultCase.operation}:${faultCase.selector}:inventory fixture`,
    );
  } else if (faultCase.operation === "INVENTORY/REGULAR_FILE/ABSENT") {
    assertNamedPresence(
      profile.runtime.production,
      specification.fdA,
      specification.nameA,
      false,
      `${faultCase.operation}:${faultCase.selector}:absent fixture`,
    );
    assertDirectoryAllowlist(
      profile,
      specification.fdA,
      [],
      `${faultCase.operation}:${faultCase.selector}:segment allowlist`,
    );
  } else if (faultCase.operation === "INVENTORY/DIRECTORY/CHILD") {
    withObservedChildDirectory(
      profile,
      topology.root,
      "lifetimes",
      "LIFETIMES",
      (lifetimes) => {
        assertDirectoryAllowlist(
          profile,
          lifetimes,
          [],
          `${faultCase.operation}:${faultCase.selector}:lifetimes allowlist`,
        );
      },
    );
  } else if (faultCase.operation === "RELEASE_DIRECTORY") {
    withObservedChildDirectory(
      profile,
      topology.root,
      "lifetimes",
      "LIFETIMES",
      (lifetimes) => {
        assertDirectoryAllowlist(
          profile,
          lifetimes,
          [],
          `${faultCase.operation}:${faultCase.selector}:lifetimes allowlist`,
        );
      },
    );
  }
}

async function filePresence(url) {
  try {
    const status = await lstat(url);
    return Object.freeze({ present: true, regular: status.isFile() });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return Object.freeze({ present: false, regular: false });
  }
}

function exactMissingAttestationError(error, sourcePresence) {
  const expectedMessage = `Cannot find module '${fileURLToPath(
    ATTESTATION_URL,
  )}' imported from ${EVALUATOR_PATH}`;
  if (
    sourcePresence.some(({ present }) => present) ||
    error === null ||
    typeof error !== "object" ||
    error.code !== "ERR_MODULE_NOT_FOUND"
  ) {
    return false;
  }
  if (error.message !== expectedMessage) return false;
  return error.url === undefined || error.url === ATTESTATION_URL.href;
}

const sourceTriplet = await Promise.all(
  [HEADER_URL, SOURCE_URL, ATTESTATION_URL].map(filePresence),
);
const sourceCount = sourceTriplet.filter(({ present }) => present).length;
if (sourceCount !== 0 && sourceCount !== 3) {
  throw new Error("STATEFS_PRIVATE_EVALUATOR_PARTIAL_SOURCE_TRIPLET");
}
if (sourceCount === 3) {
  assert.deepEqual(sourceTriplet.map(({ regular }) => regular), [true, true, true]);
}

let attestation = null;
let attestationImportError = null;
let attestationImportAttempts = 0;
try {
  attestationImportAttempts += 1;
  attestation = await import(ATTESTATION_URL.href);
} catch (error) {
  if (!exactMissingAttestationError(error, sourceTriplet)) throw error;
  attestationImportError = error;
}

function candidateTest(name, body) {
  test(
    name,
    { skip: attestation === null ? "candidate source triplet absent" : false },
    body,
  );
}

function assertTerminalAttestationState(
  importAttempts,
  importError,
  importedAttestation,
  ownedRoot,
) {
  assert.equal(importAttempts, 1);
  if (importError !== null) {
    assert.equal(importedAttestation, null);
    assert.equal(ownedRoot, undefined);
    throw importError;
  }
  assert.notEqual(importedAttestation, null);
}

let evaluatorOwnedRoot;
test.after(async () => {
  if (evaluatorOwnedRoot !== undefined) {
    await rm(evaluatorOwnedRoot, { force: true, recursive: true });
  }
});

const R13_REQUIRED_STATX_MASK = 0x17ff;
const R13_EXTRA_STATX_MASK = 0x8000_0000;
const R13_CLEANUP_CLOSE_ERRNO = 13;
const R13_PRIVATE_MASK_LOCATIONS = deepFreeze([
  ["fd-a", "LOCK_EX_NB", 1, "REJECTED", "NO_EFFECT", "REQUEST_VALIDATED", "FD_A_VALIDATED", 1, "zero"],
  ["fd-b", "MOVE_NOREPLACE_SYNC", 2, "REJECTED", "NO_EFFECT", "FD_A_VALIDATED", "FD_B_VALIDATED", 2, "zero"],
  ["directory-target", "INVENTORY/DIRECTORY/ROOT", 2, "REJECTED", "NO_EFFECT", "FD_A_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 2, "zero"],
  ["directory-entry", "INVENTORY/DIRECTORY/ROOT", 3, "REJECTED", "NO_EFFECT", "INTERNAL_DESCRIPTOR_OPENED", "DIRECTORY_ENUMERATED", 3, "target-only"],
  ["regular-initial", "INVENTORY/REGULAR_FILE/PRESENT", 2, "REJECTED", "NO_EFFECT", "FD_A_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 2, "zero"],
  ["regular-repeat", "INVENTORY/REGULAR_FILE/PRESENT", 3, "REJECTED", "NO_EFFECT", "INTERNAL_DESCRIPTOR_OPENED", "ENTRY_REOBSERVED", 3, "zero"],
  ["persist-metadata", "PERSIST_NOREPLACE", 2, "VERIFICATION_FAILED", "MUTATION_OBSERVED_NOT_FULLY_SYNCED", "TEMP_CREATED", "CREATED_METADATA_VALIDATED", 3, "zero"],
  ["mkdir-metadata", "MKDIR_SYNC", 2, "VERIFICATION_FAILED", "MUTATION_OBSERVED_NOT_FULLY_SYNCED", "CHILD_DIRECTORY_CREATED", "CREATED_METADATA_VALIDATED", 3, "zero"],
  ["move-source", "MOVE_NOREPLACE_SYNC", 3, "REJECTED", "NO_EFFECT", "FD_B_VALIDATED", "SOURCE_REOBSERVED", 3, "zero"],
  ["move-destination-final", "MOVE_NOREPLACE_SYNC", 6, "VERIFICATION_FAILED", "EFFECT_UNCERTAIN", "SOURCE_ABSENCE_REOBSERVED", "DESTINATION_REOBSERVED", 8, "source-absent-only"],
]);
const R13_PRIVATE_LIVENESS_LOCATIONS = deepFreeze([
  ["directory-root-step-5", "INVENTORY/DIRECTORY/ROOT", 2, "DEFINITE_NO_EFFECT", "EFFECT_UNCERTAIN", "FD_A_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 2],
  ["directory-child-step-5", "INVENTORY/DIRECTORY/CHILD", 2, "DEFINITE_NO_EFFECT", "EFFECT_UNCERTAIN", "FD_A_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 2],
  ["mkdir-step-5", "MKDIR_SYNC", 3, "MUTATION_OBSERVED_NOT_FULLY_SYNCED", "EFFECT_UNCERTAIN", "CREATED_METADATA_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 4],
  ["regular-initial-step-5", "INVENTORY/REGULAR_FILE/PRESENT", 2, "DEFINITE_NO_EFFECT", "DEFINITE_NO_EFFECT", "FD_A_VALIDATED", "INTERNAL_DESCRIPTOR_OPENED", 2],
  ["mkdir-step-33", "MKDIR_SYNC", 2, "MUTATION_OBSERVED_NOT_FULLY_SYNCED", "MUTATION_OBSERVED_NOT_FULLY_SYNCED", "CHILD_DIRECTORY_CREATED", "CREATED_METADATA_VALIDATED", 3],
]);
const R13_PRIVATE_RAW_CASES = deepFreeze([
  ["0x01", 0x01, null, true],
  ["0x1f", 0x1f, null, true],
  ["0x7f", 0x7f, null, true],
  ["0x80", 0x80, null, false],
  ["0xff", 0xff, null, false],
  ["overlength", null, "overlength", false],
  ["embedded-slash", null, "embedded-slash", false],
  ["malformed-record", null, "malformed-record", false],
  ["unterminated-record", null, "unterminated-record", false],
]);

function r13MutatedNativeSource(
  source,
  {
    statxCall = 0,
    maskAnd = 0xffff_ffff,
    maskOr = 0,
    statxErrno = 0,
    failClose = false,
    closeErrno = R13_CLEANUP_CLOSE_ERRNO,
    directoryEntryMutation = null,
  },
) {
  let transformed = source;
  if (statxCall !== 0) {
    assert.equal(Number.isInteger(statxCall) && statxCall >= 1, true);
    assert.equal(Number.isInteger(statxErrno) && statxErrno >= 0, true);
    const statxAnchor = [
      "STATEFS_ALWAYS_INLINE long statefs_linux_statx(long directory, long name, long flags,",
      "                                                long mask, long output) {",
    ].join("\n");
    transformed = replaceExactly(
      transformed,
      statxAnchor,
      [
        "static uint32_t statefs_r13_private_statx_call_count_v1;",
        "",
        statxAnchor,
      ].join("\n"),
      "R13 private statx declaration mutation",
    );
    const statxReturnAnchor = [
      '                     : "rcx", "r11", "memory");',
      "    return value;",
      "}",
      "",
      "STATEFS_ALWAYS_INLINE int statefs_raw_error(long value) {",
    ].join("\n");
    const hexadecimal = (value) => `0x${(value >>> 0).toString(16)}U`;
    transformed = replaceExactly(
      transformed,
      statxReturnAnchor,
      [
        '                     : "rcx", "r11", "memory");',
        "    statefs_r13_private_statx_call_count_v1 += 1U;",
        `    if (statefs_r13_private_statx_call_count_v1 == ${statxCall}U) {`,
        ...(statxErrno === 0
          ? [
              "        if (value == 0L) {",
              "            struct statefs_kernel_statx_v1 *mutated =",
              "                (struct statefs_kernel_statx_v1 *)(uintptr_t)output;",
              `            mutated->mask = (mutated->mask & (uint32_t)${hexadecimal(maskAnd)}) |`,
              `                            (uint32_t)${hexadecimal(maskOr)};`,
              "        }",
            ]
          : [`        return -(long)${statxErrno};`]),
        "    }",
        "    return value;",
        "}",
        "",
        "STATEFS_ALWAYS_INLINE int statefs_raw_error(long value) {",
      ].join("\n"),
      "R13 private statx result mutation",
    );
  }
  if (directoryEntryMutation !== null) {
    assert.equal(
      [
        "overlength",
        "embedded-slash",
        "malformed-record",
        "unterminated-record",
      ].includes(directoryEntryMutation),
      true,
    );
    const getdentsAnchor =
      "STATEFS_ALWAYS_INLINE long statefs_linux_getdents64(long descriptor, long output, long length) {";
    transformed = replaceExactly(
      transformed,
      getdentsAnchor,
      [
        "static uint32_t statefs_r13_private_getdents_call_count_v1;",
        "",
        getdentsAnchor,
      ].join("\n"),
      "R13 private getdents declaration mutation",
    );
    const getdentsReturnAnchor = [
      '                     : "rcx", "r11", "memory");',
      "    return value;",
      "}",
      "",
      "STATEFS_ALWAYS_INLINE long statefs_linux_openat(long directory, long name, long flags, long mode) {",
    ].join("\n");
    const mutationLines = {
      overlength: [
        "        bytes[16] = 0x14U;",
        "        bytes[17] = 0x01U;",
        "        for (index = 19L; index < 275L; index += 1L) bytes[index] = (uint8_t)'a';",
        "        bytes[275] = 0U;",
        "        value = 276L;",
      ],
      "embedded-slash": [
        "        bytes[16] = 22U;",
        "        bytes[19] = (uint8_t)'a';",
        "        bytes[20] = (uint8_t)'/';",
        "        bytes[21] = 0U;",
        "        value = 22L;",
      ],
      "malformed-record": [
        "        bytes[16] = 18U;",
        "        value = 18L;",
      ],
      "unterminated-record": [
        "        bytes[16] = 20U;",
        "        bytes[19] = (uint8_t)'a';",
        "        value = 20L;",
      ],
    }[directoryEntryMutation];
    transformed = replaceExactly(
      transformed,
      getdentsReturnAnchor,
      [
        '                     : "rcx", "r11", "memory");',
        "    statefs_r13_private_getdents_call_count_v1 += 1U;",
        "    if (statefs_r13_private_getdents_call_count_v1 == 1U) {",
        "        uint8_t *bytes = (uint8_t *)(uintptr_t)output;",
        "        long index;",
        "        for (index = 0L; index < length; index += 1L) bytes[index] = 0U;",
        ...mutationLines,
        "    }",
        "    return value;",
        "}",
        "",
        "STATEFS_ALWAYS_INLINE long statefs_linux_openat(long directory, long name, long flags, long mode) {",
      ].join("\n"),
      "R13 private getdents result mutation",
    );
  }
  if (failClose) {
    assert.equal(Number.isInteger(closeErrno) && closeErrno > 0, true);
    const closeAnchor =
      "STATEFS_ALWAYS_INLINE long statefs_linux_close(long descriptor) {";
    transformed = replaceExactly(
      transformed,
      closeAnchor,
      [
        "static uint32_t statefs_r13_private_close_call_count_v1;",
        "",
        closeAnchor,
      ].join("\n"),
      "R13 private close declaration mutation",
    );
    const closeReturnAnchor = [
      '                     : "rcx", "r11", "memory");',
      "    return value;",
      "}",
      "",
      "STATEFS_ALWAYS_INLINE long statefs_linux_fcntl(long descriptor, long command, long argument) {",
    ].join("\n");
    transformed = replaceExactly(
      transformed,
      closeReturnAnchor,
      [
        '                     : "rcx", "r11", "memory");',
        "    statefs_r13_private_close_call_count_v1 += 1U;",
        "    if (statefs_r13_private_close_call_count_v1 == 1U)",
        `        return -(long)${closeErrno};`,
        "    return value;",
        "}",
        "",
        "STATEFS_ALWAYS_INLINE long statefs_linux_fcntl(long descriptor, long command, long argument) {",
      ].join("\n"),
      "R13 private cleanup-close result mutation",
    );
  }
  for (const selectorNeedle of [
    "test_fault_selector",
    "statefs_fault_selector_is_valid",
    "statefs_fault_selector_is_pending",
  ]) {
    assert.equal(
      countExact(transformed, selectorNeedle),
      countExact(source, selectorNeedle),
      `${selectorNeedle} R13 mutation neutrality`,
    );
  }
  return transformed;
}

async function buildR13PrivateNativeMutant(runtime, label, mutation) {
  const root = await mkdtemp(join(tmpdir(), `oxigraph-statefs-private-r13-${label}-`));
  try {
    const sourcePath = join(root, "containment-guardian-statefs-syscalls-v1.c");
    const bridgeSource = join(root, "statefs-private-r13-bridge.c");
    const bridgeObject = join(root, "statefs-private-r13-bridge.o");
    const candidateObject = join(root, "statefs-private-r13-candidate.o");
    const modulePath = join(root, "statefs-private-r13.node");
    const source = await readFile(SOURCE_URL, "utf8");
    await Promise.all([
      writeFile(sourcePath, r13MutatedNativeSource(source, mutation), {
        encoding: "utf8",
        mode: 0o600,
      }),
      writeFile(bridgeSource, BRIDGE_SOURCE, { encoding: "utf8", mode: 0o600 }),
    ]);
    const includeDirectory = dirname(fileURLToPath(HEADER_URL));
    exactChild(
      runtime.compiler,
      [
        "-std=c17",
        "-O2",
        "-fPIC",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I/usr/include/node",
        `-I${includeDirectory}`,
        "-c",
        bridgeSource,
        "-o",
        bridgeObject,
      ],
      REPOSITORY_ROOT,
    );
    exactChild(
      runtime.compiler,
      [
        "-std=c17",
        "-O2",
        "-fPIC",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1",
        `-I${includeDirectory}`,
        "-c",
        sourcePath,
        "-o",
        candidateObject,
      ],
      REPOSITORY_ROOT,
    );
    const linkArgs = [
      "-shared",
      "-B/usr/bin/",
      "-Wl,-z,noexecstack",
      bridgeObject,
      candidateObject,
      "-o",
      modulePath,
    ];
    assertExactBridgeLinkContract(
      BRIDGE_LINK_TEMPLATE,
      linkArgs,
      bridgeObject,
      candidateObject,
      modulePath,
    );
    exactChild(runtime.compiler, linkArgs, REPOSITORY_ROOT);
    const bridge = require(modulePath);
    assert.deepEqual(Reflect.ownKeys(bridge), ["invoke"]);
    return Object.freeze({ bridge, root });
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

function dispatchR13PrivateMutant(profile, fixture, bridge) {
  const ownerContext =
    fixture.module.assertCandidateContainmentGuardianStatefsPlanV1(fixture.plan);
  assert.equal(ownerContext, fixture.plan.ownerContext);
  assert.equal(
    fixture.module.assertCandidateContainmentGuardianStatefsRequestV1(
      fixture.plan.request,
    ),
    true,
  );
  const result = executeNative(
    bridge,
    nativeSpecificationForRequest(
      profile,
      fixture.plan.request,
      fixture.handles,
      0,
      fixture.observedPresence,
    ),
  );
  const receipt = fixture.module.verifyCandidateContainmentGuardianStatefsResultV1({
    request: fixture.plan.request,
    executorResult: result,
  });
  return Object.freeze({ receipt, result });
}

async function runR13PrivateFixture(label, operation, index, mutation, prepare = null) {
  const { value, report } = await withPrivateProfile(label, async (profile) => {
    const fixture = await faultFixture(
      profile,
      { operation, selector: 0 },
      10_000 + index,
    );
    const fixtureCleanup = prepare === null
      ? null
      : await prepare(profile, fixture);
    try {
      const build = await buildR13PrivateNativeMutant(
        profile.runtime,
        `${String(index).padStart(3, "0")}-${label}`,
        mutation,
      );
      try {
        return dispatchR13PrivateMutant(profile, fixture, build.bridge);
      } finally {
        await rm(build.root, { force: true, recursive: true });
      }
    } finally {
      if (fixtureCleanup !== null) await fixtureCleanup();
    }
  });
  assert.equal(report.cleanupCompleted, true);
  return value;
}

function assertR13PrivateResult(
  { result, receipt },
  {
    status,
    effectClass,
    lastCompletedStep,
    failedStep,
    completedStepCount,
    observationPrefix,
    errno = 0,
  },
) {
  assert.equal(result.status, status);
  assert.equal(result.effectClass, effectClass);
  assert.equal(result.lastCompletedStep, lastCompletedStep);
  assert.equal(result.failedStep, failedStep);
  assert.equal(result.errno, errno);
  assert.equal(result.completedStepCount, completedStepCount);
  assert.equal(result.bytesConsumed, 0);
  assert.equal(result.returnedDirectoryFd, -1);
  assert.equal(result.outputBytes === null || result.outputBytes.length === 0, true);
  if (observationPrefix === "zero") {
    assert.deepEqual(result.observations, []);
  } else if (observationPrefix === "target-only") {
    assert.equal(result.observations.length, 1);
    assert.notEqual(result.observations[0].kind, "ABSENT");
    assert.equal(
      (result.observations[0].statxMask & R13_REQUIRED_STATX_MASK) >>> 0,
      R13_REQUIRED_STATX_MASK,
    );
  } else {
    assert.equal(observationPrefix, "source-absent-only");
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].kind, "ABSENT");
    assert.equal(result.observations[0].statxMask, 0);
  }
  for (const field of [
    "status",
    "effectClass",
    "lastCompletedStep",
    "failedStep",
    "errno",
    "completedStepCount",
    "bytesConsumed",
  ]) {
    assert.equal(receipt[field], result[field], field);
  }
  assert.equal(receipt.retryDisposition, effectClass === "DEFINITE_NO_EFFECT"
    ? "REPLAN_AFTER_FRESH_INVENTORY"
    : "NO_RETRY");
  assert.deepEqual(receipt.inventories, []);
  if (effectClass === "DEFINITE_NO_EFFECT") {
    assert.equal(receipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.notEqual(receipt.inventorySet, null);
    assert.notEqual(receipt.inventorySetSha256, null);
  } else {
    assert.equal(
      receipt.outcome,
      effectClass === "EFFECT_UNCERTAIN"
        ? "FAILED_EFFECT_UNCERTAIN"
        : effectClass === "MUTATION_OBSERVED_NOT_FULLY_SYNCED"
          ? "FAILED_MUTATION_NOT_FULLY_SYNCED"
          : "REJECTED",
    );
    assert.equal(receipt.inventorySet, null);
    assert.equal(receipt.inventorySetSha256, null);
  }
}

async function assertR13ImpossibleUncertainRejected(
  label,
  operation,
  index,
  executorResult,
) {
  const { report } = await withPrivateProfile(label, async (profile) => {
    const fixture = await faultFixture(
      profile,
      { operation, selector: 0 },
      20_000 + index,
    );
    fixture.module.assertCandidateContainmentGuardianStatefsPlanV1(fixture.plan);
    fixture.module.assertCandidateContainmentGuardianStatefsRequestV1(
      fixture.plan.request,
    );
    const impossibleUncertain = Object.freeze({
      ...executorResult,
      requestSha256: fixture.plan.request.requestSha256,
      effectClass: "EFFECT_UNCERTAIN",
    });
    for (const expectedMessage of ["STATEFS_RESULT", "STATEFS_BINDING"]) {
      assert.throws(
        () =>
          fixture.module.verifyCandidateContainmentGuardianStatefsResultV1({
            request: fixture.plan.request,
            executorResult: impossibleUncertain,
          }),
        (error) => error?.message === expectedMessage,
      );
    }
  });
  assert.equal(report.cleanupCompleted, true);
}

function reconstructPreR14P2SourceForPrivate(source) {
  const currentAdrPin = [
    "    ADR_URL,",
    "    216688,",
    '    "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",',
  ].join("\n");
  const predecessorAdrPin = [
    "    ADR_URL,",
    "    216620,",
    '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
  ].join("\n");
  const reversals = [
    [
      [
        "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
        "    reconstructPreR14D1P2AdrRepinSource(currentEvaluatorSource),",
        "  );",
      ].join("\n"),
      [
        "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
        "    currentEvaluatorSource,",
        "  );",
      ].join("\n"),
      "R14 P2 accepted inverse forwarding",
    ],
    [
      [
        "  const reconstructedSource = reconstructPreR13S3SyscallEvaluatorSource(",
        "    reconstructPreR14D1P2AdrRepinSource(currentSource),",
        "  );",
      ].join("\n"),
      [
        "  const reconstructedSource = reconstructPreR13S3SyscallEvaluatorSource(",
        "    currentSource,",
        "  );",
      ].join("\n"),
      "R14 P2 R13 inverse forwarding",
    ],
    [
      [
        "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(",
        "    reconstructPreR14D1P2AdrRepinSource(currentSource),",
        "  );",
      ].join("\n"),
      "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(currentSource);",
      "R14 P2 R8 inverse forwarding",
    ],
  ];
  let reconstructed = replaceExactly(
    source,
    currentAdrPin,
    predecessorAdrPin,
    "R14 P2 ADR pin inverse",
  );
  for (const [before, after, label] of reversals) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }
  return removeRangeExactly(
    reconstructed,
    "\n\nfunction reconstructPreR14D1P2AdrRepinSource(source) {\n",
    "\n\nfunction reconstructPreR8EvaluatorSource(source, proofStart, proofEnd) {\n",
    "R14 P2 correction inverse",
  );
}

function reconstructPreR13P2SourceForPrivate(source) {
  const currentAdrPin = [
    "    ADR_URL,",
    "    216620,",
    '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
  ].join("\n");
  const preR13AdrPin = [
    "    ADR_URL,",
    "    204827,",
    '    "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
  ].join("\n");
  let reconstructed = removeRangeExactly(
    source,
    "\n\nconst EXPECTED_STATX_OBSERVATION_CONTRACT = deepFreeze(\n",
    [
      '\n\ntest("R8 fixed-register and syscall-immediate correction ',
      'inversely reconstructs the pre-R8 syscall evaluator", async () => {\n',
    ].join(""),
    "R13 P2 correction inverse",
  );
  for (const [before, after, label] of [
    [currentAdrPin, preR13AdrPin, "R13 P2 ADR pin inverse"],
    [
      '["statx_mask", "uint32_t", 76]',
      '["flags", "uint32_t", 76]',
      "R13 P2 observation field inverse",
    ],
    [
      '"fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70"',
      '"16756669b08e3898380065d27a8e3e0ad6e4eaaaf7a3a9d445f9506385a9ac23"',
      "R13 P2 requirements inverse",
    ],
    [
      '"651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0"',
      '"f69c11d17c0264b2af3eaee0e092bb27ce149207425f8239879d85f1ca589ffd"',
      "R13 P2 ABI inverse",
    ],
    [
      [
        "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
        "    currentEvaluatorSource,",
        "  );",
        "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
        "    preR13EvaluatorSource,",
      ].join("\n"),
      [
        "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
        "    currentEvaluatorSource,",
      ].join("\n"),
      "R13 P2 accepted inverse entry",
    ],
    [
      [
        '  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);',
        "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(currentSource);",
        "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
        "    preR13Source,",
      ].join("\n"),
      [
        '  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);',
        "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
        "    currentSource,",
      ].join("\n"),
      "R13 P2 R8 inverse entry",
    ],
  ]) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }
  return reconstructed;
}

function reconstructPreR14P3SourceForPrivate(source) {
  const currentAdrPin = [
    "    ADR_URL,",
    "    216688,",
    '    "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",',
  ].join("\n");
  const predecessorAdrPin = [
    "    ADR_URL,",
    "    216620,",
    '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
  ].join("\n");
  let reconstructed = replaceExactly(
    source,
    currentAdrPin,
    predecessorAdrPin,
    "R14 P3 ADR pin inverse",
  );
  for (const [before, after, label] of [
    [
      [
        "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
        "    reconstructPreR13EvaluatorSource(",
        "      reconstructPreR14AdrRepinEvaluatorSource(currentEvaluatorSource),",
        "    ),",
      ].join("\n"),
      [
        "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
        "    reconstructPreR13EvaluatorSource(currentEvaluatorSource),",
      ].join("\n"),
      "R14 P3 accepted inverse forwarding",
    ],
    [
      [
        "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
        "    reconstructPreR13EvaluatorSource(",
        "      reconstructPreR14AdrRepinEvaluatorSource(currentSource),",
        "    ),",
      ].join("\n"),
      [
        "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
        "    reconstructPreR13EvaluatorSource(currentSource),",
      ].join("\n"),
      "R14 P3 R8 inverse forwarding",
    ],
    [
      [
        "  const reconstructedSource = reconstructPreR13EvaluatorSource(",
        "    reconstructPreR14AdrRepinEvaluatorSource(currentSource),",
        "  );",
      ].join("\n"),
      "  const reconstructedSource = reconstructPreR13EvaluatorSource(currentSource);",
      "R14 P3 R13 inverse forwarding",
    ],
  ]) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }
  return removeRangeExactly(
    reconstructed,
    [
      "\n\nfunction reconstructPreR14AdrRepinEvaluator",
      "Source(source) {\n",
    ].join(""),
    [
      '\n\ntest("ADR pin correction inversely reconstructs ',
      'accepted S3 fault evaluator", async () => {\n',
    ].join(""),
    "R14 P3 correction inverse",
  );
}

function reconstructPreR13P3SourceForPrivate(source) {
  let reconstructed = source;
  for (const [before, after, label] of [
    [
      "  lstat,\n  mkdir,\n  mkdtemp,",
      "  lstat,\n  mkdtemp,",
      "R13 P3 mkdir import inverse",
    ],
    [
      '  rm,\n  writeFile,\n} from "node:fs/promises";',
      '  rm,\n} from "node:fs/promises";',
      "R13 P3 writeFile import inverse",
    ],
    [
      'test("pins amended ADR-0037 and unchanged harness package bytes", async () => {\n  for (const [url, byteLength, expectedSha256] of PREDECESSOR_BYTE_PINS) {',
      'test("pins the accepted S0 ADR and unchanged harness package bytes", async () => {\n  for (const [url, byteLength, expectedSha256] of PREDECESSOR_BYTE_PINS) {',
      "R13 P3 pin test name inverse",
    ],
    [
      [
        "  [",
        '    "cleanup-close",',
        '    "reverse-open-once/no-step/no-errno-replacement/N-or-D-or-M-to-U-only-if-live",',
        "  ],",
      ].join("\n"),
      [
        "  [",
        '    "cleanup-close",',
        '    "reverse-open-once/no-step/no-errno-replacement/D-or-M-to-U",',
        "  ],",
      ].join("\n"),
      "R13 P3 close rule inverse",
    ],
    [
      [
        "    [",
        '      "specialRules",',
        '      "55057314d875c12d91553d35dd8562a9863c90029a6407d377278114daef5092",',
        "    ],",
      ].join("\n"),
      [
        "    [",
        '      "specialRules",',
        '      "360083e614f4535031365141bdd592d8a812ecd32952d045f4858711f7421cd9",',
        "    ],",
      ].join("\n"),
      "R13 P3 special rule inverse",
    ],
    [
      [
        "    ADR_URL,",
        "    216620,",
        '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
      ].join("\n"),
      [
        "    ADR_URL,",
        "    204827,",
        '    "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
      ].join("\n"),
      "R13 P3 ADR pin inverse",
    ],
    [
      'const EXPECTED_REQUIREMENTS_SHA256 =\n  "fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70";',
      'const EXPECTED_REQUIREMENTS_SHA256 =\n  "16756669b08e3898380065d27a8e3e0ad6e4eaaaf7a3a9d445f9506385a9ac23";',
      "R13 P3 requirements inverse",
    ],
    [
      'const EXPECTED_ABI_LAYOUT_SHA256 =\n  "651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0";',
      'const EXPECTED_ABI_LAYOUT_SHA256 =\n  "f69c11d17c0264b2af3eaee0e092bb27ce149207425f8239879d85f1ca589ffd";',
      "R13 P3 ABI inverse",
    ],
    [
      "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(\n    reconstructPreR13EvaluatorSource(currentEvaluatorSource),",
      "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(\n    currentEvaluatorSource,",
      "R13 P3 accepted inverse entry",
    ],
    [
      "  const reconstructedSource = reconstructPreR8EvaluatorSource(\n    reconstructPreR13EvaluatorSource(currentSource),",
      "  const reconstructedSource = reconstructPreR8EvaluatorSource(\n    currentSource,",
      "R13 P3 R8 inverse entry",
    ],
  ]) {
    reconstructed = replaceExactly(reconstructed, before, after, label);
  }
  return removeRangeExactly(
    reconstructed,
    "\n\nconst R13_SUBSTEP_MUTATION_CASES = deepFreeze([\n",
    '\n\ntest("freezes all 144 numeric-step before/after selector results", () => {\n',
    "R13 P3 correction inverse",
  );
}

test("R13 private native matrix is exhaustive without extending the 144 selector surface", () => {
  assert.equal(FAULT_CASES.length, 144);
  assert.deepEqual(
    R13_PRIVATE_MASK_LOCATIONS.map(([label]) => label),
    [
      "fd-a",
      "fd-b",
      "directory-target",
      "directory-entry",
      "regular-initial",
      "regular-repeat",
      "persist-metadata",
      "mkdir-metadata",
      "move-source",
      "move-destination-final",
    ],
  );
  assert.deepEqual(
    R13_PRIVATE_LIVENESS_LOCATIONS.map(([label]) => label),
    [
      "directory-root-step-5",
      "directory-child-step-5",
      "mkdir-step-5",
      "regular-initial-step-5",
      "mkdir-step-33",
    ],
  );
  assert.deepEqual(
    R13_PRIVATE_RAW_CASES.map(([label]) => label),
    [
      "0x01",
      "0x1f",
      "0x7f",
      "0x80",
      "0xff",
      "overlength",
      "embedded-slash",
      "malformed-record",
      "unterminated-record",
    ],
  );
  assert.equal(
    new Set(FAULT_CASES.map(({ selector }) => selector)).size,
    68,
  );
  assert.equal(
    new Set(
      FAULT_CASES.map(({ operation, selector }) => `${operation}:${selector}`),
    ).size,
    144,
  );
  assert.equal(R13_CLEANUP_CLOSE_ERRNO, 13);
  assert.notEqual(R13_CLEANUP_CLOSE_ERRNO, 5);
});

candidateTest(
  "R13 private native mask failures cover every statx location and publish only complete prefixes",
  async () => {
    let executionCount = 0;
    for (const [locationIndex, location] of R13_PRIVATE_MASK_LOCATIONS.entries()) {
      const [
        locationLabel,
        operation,
        statxCall,
        status,
        effectClass,
        lastCompletedStep,
        failedStep,
        completedStepCount,
        observationPrefix,
      ] = location;
      for (const [maskLabel, clearedMask] of [
        ["basic-stats", 0x07ff],
        ["mount-id", 0x1000],
      ]) {
        const dispatched = await runR13PrivateFixture(
          `r13-mask-${locationLabel}-${maskLabel}`,
          operation,
          locationIndex * 2 + executionCount,
          {
            statxCall,
            maskAnd: (~clearedMask) >>> 0,
          },
        );
        assertR13PrivateResult(dispatched, {
          status,
          effectClass,
          lastCompletedStep,
          failedStep,
          completedStepCount,
          observationPrefix,
        });
        executionCount += 1;
      }
    }
    assert.equal(executionCount, 20);
  },
);

candidateTest(
  "R13 private native cleanup-close upgrades require an actually acquired live descriptor",
  async () => {
    let executionCount = 0;
    for (const [locationIndex, location] of R13_PRIVATE_LIVENESS_LOCATIONS.entries()) {
      const [
        locationLabel,
        operation,
        statxCall,
        closeSuccessEffect,
        closeFailureEffect,
        lastCompletedStep,
        failedStep,
        completedStepCount,
      ] = location;
      const observedEffects = [];
      let impossibleExecutorResult = null;
      for (const failClose of [false, true]) {
        const effectClass = failClose
          ? closeFailureEffect
          : closeSuccessEffect;
        const dispatched = await runR13PrivateFixture(
          `r13-liveness-${locationLabel}-${failClose ? "close-failed" : "close-succeeded"}`,
          operation,
          100 + locationIndex * 2 + Number(failClose),
          { statxCall, statxErrno: 5, failClose },
        );
        assertR13PrivateResult(dispatched, {
          status: "SYSCALL_FAILED",
          effectClass,
          lastCompletedStep,
          failedStep,
          completedStepCount,
          observationPrefix: "zero",
          errno: 5,
        });
        observedEffects.push(dispatched.result.effectClass);
        if (failClose) impossibleExecutorResult = dispatched.result;
        executionCount += 1;
      }
      assert.deepEqual(observedEffects, [closeSuccessEffect, closeFailureEffect]);
      if (closeSuccessEffect === closeFailureEffect) {
        assert.notEqual(impossibleExecutorResult, null);
        await assertR13ImpossibleUncertainRejected(
          `r13-liveness-${locationLabel}-impossible-uncertain`,
          operation,
          locationIndex,
          impossibleExecutorResult,
        );
      }
    }
    assert.equal(executionCount, 10);
  },
);

candidateTest(
  "R13 private native raw-name bytes cross the ABI exactly or terminate without partial publication",
  async () => {
    let executionCount = 0;
    for (const [caseIndex, [label, byte, directoryEntryMutation, representable]] of
      R13_PRIVATE_RAW_CASES.entries()) {
      const dispatched = await runR13PrivateFixture(
        `r13-raw-${label}`,
        "INVENTORY/DIRECTORY/ROOT",
        200 + caseIndex,
        directoryEntryMutation === null ? {} : { directoryEntryMutation },
        byte === null
          ? null
          : async (profile) => {
              const rootPath = Buffer.from(
                join(
                  profile.input.scratchParent,
                  profile.input.stateRootName,
                ),
                "utf8",
              );
              const rawPath = Buffer.concat([
                rootPath,
                Buffer.from([0x2f, byte]),
              ]);
              await writeFile(
                rawPath,
                Buffer.from("x", "utf8"),
                { mode: 0o600 },
              );
              return () => rm(rawPath, { force: true });
            },
      );
      if (!representable) {
        assertR13PrivateResult(dispatched, {
          status: "REJECTED",
          effectClass: "NO_EFFECT",
          lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
          failedStep: "DIRECTORY_ENUMERATED",
          completedStepCount: 3,
          observationPrefix: "target-only",
        });
      } else {
        const { receipt, result } = dispatched;
        assert.equal(result.status, "COMPLETE");
        assert.equal(result.effectClass, "COMPLETE");
        assert.equal(result.lastCompletedStep, "INVENTORY_DESCRIPTOR_CLOSED");
        assert.equal(result.failedStep, "NONE");
        assert.equal(result.errno, 0);
        assert.equal(result.completedStepCount, 5);
        assert.equal(result.bytesConsumed, 0);
        assert.equal(result.outputBytes, null);
        assert.equal(result.returnedDirectoryFd, -1);
        const rawObservations = result.observations.filter(
          ({ name }) => name !== null && name.length === 1 && name.charCodeAt(0) === byte,
        );
        assert.equal(rawObservations.length, 1);
        assert.equal(
          result.observations.some(({ name }) => name === "." || name === ".."),
          false,
        );
        assert.equal(
          result.observations.every(
            ({ statxMask }) =>
              (statxMask & R13_REQUIRED_STATX_MASK) ===
              R13_REQUIRED_STATX_MASK,
          ),
          true,
        );
        assert.equal(receipt.status, "REJECTED");
        assert.equal(receipt.effectClass, "DEFINITE_NO_EFFECT");
        assert.equal(receipt.outcome, "REJECTED");
        assert.equal(receipt.retryDisposition, "NO_RETRY");
        assert.equal(receipt.inventories.length, 1);
        assert.equal(
          receipt.inventories[0].entries.some(
            ({ name }) => name.length === 1 && name.charCodeAt(0) === byte,
          ),
          true,
        );
        assert.equal(receipt.inventorySet, null);
        assert.equal(receipt.inventorySetSha256, null);
      }
      executionCount += 1;
    }
    assert.equal(executionCount, 9);
  },
);

candidateTest(
  "R13 private native statxMask retains additional unsigned bits without public projection drift",
  async () => {
    const dispatched = await runR13PrivateFixture(
      "r13-mask-extra-bit",
      "INVENTORY/DIRECTORY/ROOT",
      300,
      { statxCall: 2, maskOr: R13_EXTRA_STATX_MASK },
    );
    const { receipt, result } = dispatched;
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.effectClass, "COMPLETE");
    assert.equal(result.failedStep, "NONE");
    assert.equal(result.observations.length >= 1, true);
    assert.equal(
      (result.observations[0].statxMask & R13_EXTRA_STATX_MASK) >>> 0,
      R13_EXTRA_STATX_MASK,
    );
    assert.equal(receipt.outcome, "INVENTORY_OBSERVED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.notEqual(receipt.inventorySet, null);
    assert.notEqual(receipt.inventorySetSha256, null);
    assert.equal(Object.hasOwn(receipt, "statxMask"), false);
    assert.equal(
      Object.hasOwn(receipt.inventories[0].directory, "statxMask"),
      false,
    );
    assert.equal(
      receipt.inventories[0].entries.some((entry) =>
        Object.hasOwn(entry, "statxMask")),
      false,
    );
    assert.equal(canonicalJson(receipt).includes('"statxMask"'), false);
  },
);

test("R13F held-root mask fixture correction inversely reconstructs the exact R13E evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource =
    reconstructPreR13FPrivateEvaluatorSource(currentSource);
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 292811);
  assert.equal(countExact(reconstructedSource, "\n"), 8680);
  assert.equal(
    sha256(reconstructedBytes),
    "6c1b4baab039767dfb758bf7a63b903d3a0f9b28e80fa41a64ee4d53791c356b",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "8a51f2517d8547fc1e3511ce5ad25792638c5b28",
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)test\(\s*"([^"\n]+)"/gu)]
      .length,
    22,
  );
  assert.equal(
    [
      ...reconstructedSource.matchAll(
        /(?:^|\n)candidateTest\(\s*"([^"\n]+)"/gu,
      ),
    ].length,
    9,
  );
});

test("R13 private totality correction inversely reconstructs the exact pre-R13 evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR13PrivateEvaluatorSource(currentSource);
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 233922);
  assert.equal(countExact(reconstructedSource, "\n"), 7040);
  assert.equal(
    sha256(reconstructedBytes),
    "305d64498746725bf6274f67fa39a5698939e51299e8410c5d02023a11c3e39a",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "2db49b46bd31c43a69cdbf2d669ca2577c33cca7",
  );
  const directTests = [
    ...reconstructedSource.matchAll(
      /(?:^|\n)test\(\s*"([^"\n]+)"/gu,
    ),
  ];
  const candidateTests = [
    ...reconstructedSource.matchAll(
      /(?:^|\n)candidateTest\(\s*"([^"\n]+)"/gu,
    ),
  ];
  assert.equal(directTests.length, 20);
  assert.equal(candidateTests.length, 5);
  assert.equal(directTests.length + candidateTests.length, 25);
});

test("pins ADR, S2, S3, package, lock, and immutable StateFS source identities", async () => {
  for (const pin of PREDECESSOR_PINS) {
    const bytes = await readFile(pin.url);
    assert.equal(bytes.length, pin.bytes, `${pin.label} bytes`);
    assert.equal(countExact(bytes.toString("utf8"), "\n"), pin.lines, `${pin.label} lines`);
    assert.equal(sha256(bytes), pin.sha256, `${pin.label} sha256`);
    assert.equal(gitBlobSha1(bytes), pin.blob, `${pin.label} git blob`);
  }
});

test("R11C S2 pins inversely reconstruct the exact post-R12 private evaluator", async () => {
  const proofStart =
    '\n\ntest("R11C S2 pins inversely reconstruct the exact post-R12 private evaluator", async () => {\n';
  const proofEnd =
    '\n\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR11CPrivateEvaluatorSource(
    currentSource,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 228785);
  assert.equal(countExact(reconstructedSource, "\n"), 6904);
  assert.equal(
    sha256(reconstructedBytes),
    "8f4c60149a0e4e99603df2ce11c8ed10a561ace82f4b8185a08a04bb004f8332",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "d88f134288fb5096cbd752ef22f590a142eefe3f",
  );

  const currentStatefsSourcePin = [
    '    label: "S2 statefs source",',
    "    url: STATEFS_SOURCE_URL,",
    "    bytes: 189577,",
    "    lines: 6242,",
    '    sha256: "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",',
    '    blob: "c452f04d9b64719dcd6b0392ee019578811aa263",',
  ].join("\n");
  const mutatedStatefsSourcePin = currentStatefsSourcePin.replace(
    "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",
    "0feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",
  );
  const mutatedSource = replaceExactly(
    currentSource,
    currentStatefsSourcePin,
    mutatedStatefsSourcePin,
    "R11C mutation fixture",
  );
  assert.throws(
    () =>
      reconstructPreR11CPrivateEvaluatorSource(
        mutatedSource,
        proofStart,
        proofEnd,
      ),
    (error) =>
      error?.code === "ERR_ASSERTION" &&
      error?.message.includes("R13 private StateFS source pin inverse"),
  );
});

test("R12 terminal attribution distinguishes absent and present source triplets", () => {
  const importedAttestation = Object.freeze({ attest: true });
  assert.doesNotThrow(() =>
    assertTerminalAttestationState(
      1,
      null,
      importedAttestation,
      "/private/evaluator-root",
    ),
  );
  assert.doesNotThrow(() =>
    assertTerminalAttestationState(1, null, importedAttestation, undefined),
  );

  const missing = Object.assign(new Error("candidate attestation absent"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
  assert.throws(
    () => assertTerminalAttestationState(1, missing, null, undefined),
    (error) => error === missing,
  );
  assert.throws(
    () =>
      assertTerminalAttestationState(1, missing, null, "/unexpected/root"),
    (error) => error !== missing && error?.code === "ERR_ASSERTION",
  );
  assert.throws(
    () =>
      assertTerminalAttestationState(
        1,
        missing,
        importedAttestation,
        undefined,
      ),
    (error) => error !== missing && error?.code === "ERR_ASSERTION",
  );
  assert.throws(() =>
    assertTerminalAttestationState(0, null, importedAttestation, undefined),
  );
  assert.throws(() =>
    assertTerminalAttestationState(2, null, importedAttestation, undefined),
  );
  assert.throws(() =>
    assertTerminalAttestationState(1, null, null, undefined),
  );
});

test("R12 terminal attribution inversely reconstructs the exact R10 evaluator", async () => {
  const proofStart =
    '\n\ntest("R12 terminal attribution distinguishes absent and present source triplets", () => {\n';
  const proofEnd =
    '\n\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR12PrivateEvaluatorSource(
    currentSource,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 223181);
  assert.equal(countExact(reconstructedSource, "\n"), 6737);
  assert.equal(
    sha256(reconstructedBytes),
    "54d93ae0ebc3a3f8c34d4bfde86c2456b0fc919d0513b54574097a24a3933050",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "ec3ef5fce310b61525e3157c6368eac6367b41f6",
  );
  assert.equal(
    countExact(reconstructedSource, "function assertTerminalAttestationState("),
    0,
  );
  assert.equal(
    countExact(
      reconstructedSource,
      "  assert.equal(evaluatorOwnedRoot, undefined);\n",
    ),
    1,
  );
});

test("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {
  const directoryRequest = record(
    ["operation", "INVENTORY"],
    ["inventoryKind", "DIRECTORY"],
  );
  const regularRequest = record(
    ["operation", "INVENTORY"],
    ["inventoryKind", "REGULAR_FILE"],
  );
  const target = record(
    ["kind", "DIRECTORY"],
    ["role", "STATE_ROOT"],
    ["name", null],
    ["inode", "100"],
  );
  const children = array(
    record(["kind", "DIRECTORY"], ["role", "NONE"], ["name", "zeta"], ["inode", "103"]),
    record(["kind", "DIRECTORY"], ["role", "NONE"], ["name", "alpha"], ["inode", "101"]),
    record(["kind", "REGULAR"], ["role", "NONE"], ["name", "middle"], ["inode", "102"]),
  );
  const expected = array(target, ...children);
  const permutations = (values) =>
    values.length === 0
      ? [[]]
      : values.flatMap((value, index) =>
          permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
            (suffix) => [value, ...suffix],
          ),
        );
  const childPermutations = permutations([...children]);
  assert.equal(childPermutations.length, 6);
  for (const permutation of childPermutations) {
    assert.doesNotThrow(() =>
      assertFaultObservations(array(target, ...permutation), expected, directoryRequest),
    );
  }
  assert.doesNotThrow(() =>
    assertFaultObservations(array(), array(), directoryRequest),
  );
  assert.doesNotThrow(() =>
    assertFaultObservations(array(target), array(target), directoryRequest),
  );

  const extra = record(
    ["kind", "DIRECTORY"],
    ["role", "NONE"],
    ["name", "extra"],
    ["inode", "104"],
  );
  const mutated = record(
    ...Object.entries(children[1]).map(([key, value]) => [
      key,
      key === "inode" ? "999" : value,
    ]),
  );
  const renamed = record(
    ...Object.entries(children[2]).map(([key, value]) => [
      key,
      key === "name" ? "renamed" : value,
    ]),
  );
  const changedTarget = record(
    ...Object.entries(target).map(([key, value]) => [
      key,
      key === "inode" ? "999" : value,
    ]),
  );
  const rejected = [
    array(children[0], target, children[1], children[2]),
    array(target, children[0], children[1]),
    array(target, ...children, extra),
    array(target, children[0], children[1], children[1]),
    array(target, children[0], mutated, children[2]),
    array(target, children[0], children[1], renamed),
    array(changedTarget, ...children),
  ];
  for (const observations of rejected) {
    assert.throws(() =>
      assertFaultObservations(observations, expected, directoryRequest),
    );
  }
  assert.throws(() =>
    assertFaultObservations(
      array(target, children[1], children[0], children[2]),
      expected,
      regularRequest,
    ),
  );
});

test("R10 directory-inventory fault oracle inversely reconstructs the exact R9 evaluator", async () => {
  const proofStart =
    '\n\ntest("R10 directory-inventory fault oracle accepts every child permutation and rejects set mutations", () => {\n';
  const proofEnd =
    '\n\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR10PrivateEvaluatorSource(
    currentSource,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 215032);
  assert.equal(countExact(reconstructedSource, "\n"), 6504);
  assert.equal(
    sha256(reconstructedBytes),
    "c8b2b5f155c5b2fcd479de7c5d7bf7f29c42be3265729514dabd77e765b1519a",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "4ca4ecda35fcc3b70f10178c53c248982a06ce0f",
  );
  assert.equal(
    countExact(reconstructedSource, "function assertFaultObservations("),
    0,
  );
  assert.equal(
    countExact(
      reconstructedSource,
      [
        "  assert.deepEqual(",
        "    result.observations,",
        "    expectedFaultObservations(profile, faultCase, fixture),",
        "  );",
      ].join("\n"),
    ),
    1,
  );
});

test("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {
  const bridgeObject = "/private/bridge.o";
  const candidateObject = "/private/candidate.o";
  const modulePath = "/private/statefs.node";
  const expectedTemplate = [
    "/usr/bin/cc",
    "-shared",
    "-B/usr/bin/",
    "-Wl,-z,noexecstack",
    "<BRIDGE_OBJECT>",
    "<ATTESTED_CANDIDATE_OBJECT>",
    "-o",
    "<NATIVE_MODULE>",
  ];
  const expectedArgs = [
    "-shared",
    "-B/usr/bin/",
    "-Wl,-z,noexecstack",
    bridgeObject,
    candidateObject,
    "-o",
    modulePath,
  ];
  assertExactBridgeLinkContract(
    BRIDGE_LINK_TEMPLATE,
    expectedArgs,
    bridgeObject,
    candidateObject,
    modulePath,
  );
  assert.deepEqual(BRIDGE_LINK_TEMPLATE, expectedTemplate);

  const mutations = (values, prefixIndex) => {
    const missing = [
      ...values.slice(0, prefixIndex),
      ...values.slice(prefixIndex + 1),
    ];
    const relative = [...values];
    relative[prefixIndex] = "-Busr/bin/";
    const alternate = [...values];
    alternate[prefixIndex] = "-B/usr/lib/";
    const noTrailingSeparator = [...values];
    noTrailingSeparator[prefixIndex] = "-B/usr/bin";
    const duplicated = [
      ...values.slice(0, prefixIndex + 1),
      "-B/usr/bin/",
      ...values.slice(prefixIndex + 1),
    ];
    const reordered = [...values];
    [reordered[prefixIndex], reordered[prefixIndex + 1]] = [
      reordered[prefixIndex + 1],
      reordered[prefixIndex],
    ];
    return [
      missing,
      relative,
      alternate,
      noTrailingSeparator,
      duplicated,
      reordered,
    ];
  };
  for (const template of mutations(expectedTemplate, 2)) {
    assert.throws(() =>
      assertExactBridgeLinkContract(
        template,
        expectedArgs,
        bridgeObject,
        candidateObject,
        modulePath,
      ),
    );
  }
  for (const argv of mutations(expectedArgs, 1)) {
    assert.throws(() =>
      assertExactBridgeLinkContract(
        expectedTemplate,
        argv,
        bridgeObject,
        candidateObject,
        modulePath,
      ),
    );
  }

  const source = await readFile(EVALUATOR_PATH, "utf8");
  const runtimeLink = [
    "      const linkArgs = [",
    '        "-shared",',
    '        "-B/usr/bin/",',
    '        "-Wl,-z,noexecstack",',
    "        bridgeObject,",
    "        candidateObject,",
    '        "-o",',
    "        modulePath,",
    "      ];",
    "      assertExactBridgeLinkContract(",
    "        BRIDGE_LINK_TEMPLATE,",
    "        linkArgs,",
    "        bridgeObject,",
    "        candidateObject,",
    "        modulePath,",
    "      );",
    "      exactChild(compiler, linkArgs, REPOSITORY_ROOT);",
  ].join("\n");
  assert.equal(countExact(source, runtimeLink), 1);
  assert.equal(Object.hasOwn(BRIDGE_ENVIRONMENT, "PATH"), false);
});

test("R9 bridge linker bootstrap inversely reconstructs the exact R8-integrated private evaluator", async () => {
  const proofStart =
    '\n\ntest("R9 bridge linker bootstrap rejects noncanonical prefixes and ordering", async () => {\n';
  const proofEnd =
    '\n\ntest("R7 persistence observation correction inversely reconstructs accepted R6 private evaluator", async () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR9PrivateEvaluatorSource(
    currentSource,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 206309);
  assert.equal(countExact(reconstructedSource, "\n"), 6205);
  assert.equal(
    sha256(reconstructedBytes),
    "3ffb9215e03271d49f7f5f4c74706a54047a5153a94bbdcc7678f614fb3d6808",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "3046fd45c829047d7de588b484f7b2bedcaa3118",
  );
  assert.equal(countExact(reconstructedSource, '  "-B/usr/bin/",\n'), 0);
});

test("R7 persistence observation correction inversely reconstructs accepted R6 private evaluator", async () => {
  const correctedFaultExpectation = [
    "        [",
    '"contentLength"',
    ", 0],",
  ].join("");
  const acceptedFaultExpectation = [
    "        [",
    '"contentLength"',
    ", request.inputByteLength],",
  ].join("");
  const correctedSuccessExpectation = [
    "    assert.equal(persist.observations[0].",
    "contentLength, 0);",
    "\n",
    "    assert.equal(persist.outputBytes, null);",
  ].join("");
  const acceptedSuccessExpectation = [
    "    assert.equal(persist.observations[0].",
    "contentLength, input.length);",
  ].join("");
  let source = reconstructPreR8PrivateEvaluatorSource(
    await readFile(EVALUATOR_PATH, "utf8"),
    [
      '\n\ntest("R8 S3 evaluator pins and inverse chain ',
      'reconstruct the pre-R8 private evaluator", async () => {\n',
    ].join(""),
    '\n\ntest("count-checked inverses reconstruct both originally accepted S3 evaluators", async () => {\n',
  );
  const faultStart = [
    "  if (request.operation === ",
    '"PERSIST_NOREPLACE"',
    " && completed.includes(21)) {",
  ].join("");
  const faultEnd = [
    "\n  if (request.operation === ",
    '"MKDIR_SYNC"',
    " && completed.includes(21)) {",
  ].join("");
  assert.equal(countExact(source, faultStart), 1);
  const faultStartIndex = source.indexOf(faultStart);
  const faultEndIndex = source.indexOf(faultEnd, faultStartIndex);
  assert.equal(faultEndIndex > faultStartIndex, true);
  const correctedFaultBlock = source.slice(faultStartIndex, faultEndIndex);
  assert.equal(countExact(correctedFaultBlock, correctedFaultExpectation), 1);
  const acceptedFaultBlock = correctedFaultBlock.replace(
    correctedFaultExpectation,
    acceptedFaultExpectation,
  );
  source = `${source.slice(0, faultStartIndex)}${acceptedFaultBlock}${source.slice(faultEndIndex)}`;
  source = replaceExactly(
    source,
    correctedSuccessExpectation,
    acceptedSuccessExpectation,
    "R7 success observation inverse",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest("R7 persistence observation correction inversely reconstructs accepted R6 private evaluator", async () => {\n',
    '\n\ntest("count-checked inverses reconstruct both originally accepted S3 evaluators", async () => {\n',
    "R7 correction inverse",
  );
  const bytes = Buffer.from(source, "utf8");
  assert.equal(bytes.length, 193631);
  assert.equal(countExact(source, "\n"), 5860);
  assert.equal(
    sha256(bytes),
    "32b84acb2423f47482560a5c04d497bdc2fc5be659bbdffc63a0037c857a21a5",
  );
  assert.equal(gitBlobSha1(bytes), "d45ba9249c83d8aff4ccefa12cf9a631ced5107d");
  assert.equal(countExact(source, correctedSuccessExpectation), 0);
  assert.equal(countExact(source, acceptedSuccessExpectation), 1);
});

test("R8 S3 evaluator pins and inverse chain reconstruct the pre-R8 private evaluator", async () => {
  const proofStart = [
    '\n\ntest("R8 S3 evaluator pins and inverse chain ',
    'reconstruct the pre-R8 private evaluator", async () => {\n',
  ].join("");
  const proofEnd =
    '\n\ntest("count-checked inverses reconstruct both originally accepted S3 evaluators", async () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR8PrivateEvaluatorSource(
    currentSource,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 196168);
  assert.equal(countExact(reconstructedSource, "\n"), 5928);
  assert.equal(
    sha256(reconstructedBytes),
    "a2615605ca9b565a25b9782ee24df4c8e1c7fd2fca08d862ad2598a708a6dc1c",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "ffcfe3aca242997af16196c490ad5ceffd465d90",
  );
});

test("count-checked inverses reconstruct both originally accepted S3 evaluators", async () => {
  const currentAdrPin = [
    "    ADR_URL,",
    "    204827,",
    '    "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
  ].join("\n");
  const acceptedAdrPin = [
    "    ADR_URL,",
    "    202635,",
    '    "35a9d8990a67f4a9c332d6a32d47314d19ea73c474610efab240a2cf80b7f97d",',
  ].join("\n");
  const correctedAssignmentMatcher = [
    "function assertAssignedSuffix(assignments, suffix, expected, category = null) {",
    "  const candidates = assignments.filter(",
    "    ([identifier]) =>",
    "      (identifier === suffix ||",
    "        (category === null",
    "          ? identifier.endsWith(`_${suffix}`)",
    "          : identifier.endsWith(`_${category}_${suffix}`))),",
    "  );",
    "  assert.deepEqual(",
    "    candidates,",
    "    [[candidates[0]?.[0], expected]],",
    "    `${category ?? \"literal\"}:${suffix}=${expected}`,",
    "  );",
    "}",
  ].join("\n");
  const acceptedAssignmentMatcher = [
    "function assertAssignedSuffix(assignments, suffix, expected, category = null) {",
    "  const candidates = assignments.filter(",
    "    ([identifier]) =>",
    "      (identifier === suffix || identifier.endsWith(`_${suffix}`)) &&",
    "      (category === null || identifier.includes(category)),",
    "  );",
    "  assert.deepEqual(",
    "    candidates,",
    "    [[candidates[0]?.[0], expected]],",
    "    `${category ?? \"literal\"}:${suffix}=${expected}`,",
    "  );",
    "}",
  ].join("\n");
  const cases = [
    {
      url: SYSCALL_EVALUATOR_URL,
      start: '\n\ntest("ADR pin correction inversely reconstructs accepted S3 syscall evaluator", async () => {\n',
      end: '\n\ncandidateTest("exports only the three frozen attestation identities", () => {\n',
      preR14Bytes: 160288,
      preR14Lines: 4801,
      preR14Sha256: "6fb8848670dc84fad1fa42fdf8f34bfd31ea7876da40361bcff7ddf5ed95be81",
      preR14Blob: "d95a93e4fe0b3ca6b9da5b55dad7672e09253edd",
      preR14Tests: 13,
      preR14CandidateTests: 8,
      preR13Bytes: 147416,
      preR13Lines: 4459,
      preR13Sha256: "75b60e1ebfe8322f804e715ca926cd7ed943289acc77834488cd9b019470b909",
      preR13Blob: "e07e312de2b0d7102afd9dd9f613bf495ca8cc77",
      bytes: 128349,
      lines: 3966,
      sha256: "75e137eb8c4882479687ec2ce9319b7f074b64f965b14db6d28fd0d136701a34",
      blob: "6dd49c0ae1a9cfeafeb941f2b22b9d5b4ab97a0f",
      tests: [
        "literal build, ABI, UAPI, syscall, and authority oracle is internally closed",
        "pins the accepted S0 ADR and unchanged harness package bytes",
        "exports only the three frozen attestation identities",
        "freezes the complete build requirements and ABI digest independently",
        "freezes all eight operations and ten exact request-shape variants",
        "header fixes all three layouts, enum values, UAPI literals, and entrypoint",
        "C source is one direct-syscall translation unit with no ambient authority",
        "production attestation binds deterministic objects, ELF, ABI, and source bytes",
        "build contract enforces BOUNDS before SHAPE before PATH and rejects caller overrides",
        "attestation source declares the exact error vocabulary and contains no ambient effects",
        "literal oracle fixes production nullability and report digest boundaries",
        "local byte-array audit rejects fixed and variable stack scratch without rejecting ABI members",
        "instruction audit follows reachable stack paths and rejects unmodelled stack writes",
        "missing-module attribution rejects wrong code, URL, message, and present source",
        "reports only the exact source-absent attestation import RED",
      ],
    },
    {
      url: FAULT_EVALUATOR_URL,
      start: '\n\ntest("ADR pin correction inversely reconstructs accepted S3 fault evaluator", async () => {\n',
      end: '\n\ntest("freezes all 144 numeric-step before/after selector results", () => {\n',
      preR14Bytes: 177918,
      preR14Lines: 5275,
      preR14Sha256: "b3555e754804ed768771dfb1a0541624554be205b348a250fea248c00dfd28a2",
      preR14Blob: "966c0ef49a1868588b38b7e556bf700353417990",
      preR14Tests: 12,
      preR14CandidateTests: 8,
      preR13Bytes: 146152,
      preR13Lines: 4406,
      preR13Sha256: "b8fa23d4fd6238f175da41a3348ecac592c2777b2fc44df82c0c90d371cc9774",
      preR13Blob: "864588a504d506fd1b94a33717797b0b9d72299e",
      bytes: 129214,
      lines: 3966,
      sha256: "c10fa45bd1e48e4814d1e9a61ba9519da4cd9e5f98d0ac77e531dfb4ff79ebfd",
      blob: "fdbd549e22616374b6bcb140594bb1e48eafda70",
      tests: [
        "independently freezes every numeric operation step and dense sequence",
        "pins the accepted S0 ADR and unchanged harness package bytes",
        "freezes all 144 numeric-step before/after selector results",
        "fault matrices retain final-failure, transferred-FD, close, and cleanup edges",
        "errno partition, retry limit, and zero-I/O verifier edges are literal",
        "instruction audit follows reachable stack and syscall-number paths",
        "fault source keeps active production and fault macro partitions distinct",
        "FAULT attestation keeps production objects selector-free and isolates fault ELF",
        "fault build retains exact exports, requirements binding, and no authority",
        "attestation binds conflicting BOUNDS, SHAPE, and PATH precedence without authority",
        "fault import attribution rejects wrong code, URL, message, and present source",
        "reports only the exact source-absent fault-attestation import RED",
      ],
    },
  ];
  for (const item of cases) {
    let source = await readFile(item.url, "utf8");
    const r8Kind =
      item.url.href === SYSCALL_EVALUATOR_URL.href ? "syscall" : "fault";
    source = item.url.href === SYSCALL_EVALUATOR_URL.href
      ? reconstructPreR14P2SourceForPrivate(source)
      : reconstructPreR14P3SourceForPrivate(source);
    const preR14Bytes = Buffer.from(source, "utf8");
    assert.equal(preR14Bytes.length, item.preR14Bytes);
    assert.equal(countExact(source, "\n"), item.preR14Lines);
    assert.equal(sha256(preR14Bytes), item.preR14Sha256);
    assert.equal(gitBlobSha1(preR14Bytes), item.preR14Blob);
    assert.equal(countExact(source, '\ntest("'), item.preR14Tests);
    assert.equal(
      countExact(source, "\ncandidateTest("),
      item.preR14CandidateTests,
    );
    source = item.url.href === SYSCALL_EVALUATOR_URL.href
      ? reconstructPreR13P2SourceForPrivate(source)
      : reconstructPreR13P3SourceForPrivate(source);
    const preR13Bytes = Buffer.from(source, "utf8");
    assert.equal(preR13Bytes.length, item.preR13Bytes);
    assert.equal(countExact(source, "\n"), item.preR13Lines);
    assert.equal(sha256(preR13Bytes), item.preR13Sha256);
    assert.equal(gitBlobSha1(preR13Bytes), item.preR13Blob);
    source = reconstructPreR8S3EvaluatorSource(
      source,
      `\n\ntest("R8 fixed-register and syscall-immediate correction inversely reconstructs the pre-R8 ${r8Kind} evaluator", async () => {\n`,
      item.end,
    );
    source = replaceExactly(source, currentAdrPin, acceptedAdrPin, "ADR inverse");
    if (item.url.href === SYSCALL_EVALUATOR_URL.href) {
      source = replaceExactly(
        source,
        correctedAssignmentMatcher,
        acceptedAssignmentMatcher,
        "effect assignment matcher inverse",
      );
    }
    source = removeRangeExactly(source, item.start, item.end, "correction inverse");
    const bytes = Buffer.from(source, "utf8");
    assert.equal(bytes.length, item.bytes);
    assert.equal(countExact(source, "\n"), item.lines);
    assert.equal(sha256(bytes), item.sha256);
    assert.equal(gitBlobSha1(bytes), item.blob);
    assert.equal(countExact(source, currentAdrPin), 0);
    assert.equal(countExact(source, acceptedAdrPin), 1);
    assert.deepEqual(
      [
        ...source.matchAll(
          /(?:^|\n)(?:test|candidateTest)\(\s*"([^"\n]+)"/gu,
        ),
      ].map((match) => match[1]),
      item.tests,
    );
  }
});

test("private report schema, digest boundary, false authority, null facts, and nonclaims are exact", () => {
  assert.deepEqual(Object.keys(PROFILE_GOLDEN), PRIVATE_PROFILE_FIELDS);
  assert.equal(
    statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
    EXPECTED_STATEFS_REQUIREMENTS_SHA256,
  );
  assert.deepEqual(
    statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS
      .privateFilesystemProfile,
    pairs(...Object.entries(PROFILE_GOLDEN)),
  );
  assert.equal(PRIVATE_REPORT_SCHEMA, "oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1");
  assert.deepEqual(PROFILE_GOLDEN.requiredMountOptions, ["rw"]);
  assert.deepEqual(PROFILE_GOLDEN.forbiddenMountOptions, ["ro"]);
  assert.deepEqual(PROFILE_GOLDEN.reportLimits, [
    ["kernelReleaseBytes", 256],
    ["mountPointBytes", 4_096],
    ["mountOptionCount", 256],
    ["mountOptionBytes", 255],
  ]);
  assert.deepEqual(Object.values(EXPECTED_AUTHORITY), Array(10).fill(false));
  assert.deepEqual(Object.values(EXPECTED_PHYSICAL_FACTS), Array(12).fill(null));
  assert.equal(EXPECTED_NONCLAIMS.length, 20);
  const report = record(
    ...PRIVATE_REPORT_FIELDS.map((field) => [field, field === "reportSha256" ? null : field]),
  );
  assert.equal(digestPrecedingFields(report, "reportSha256", PRIVATE_REPORT_FIELDS), semanticSha256(record(...PRIVATE_REPORT_FIELDS.slice(0, 21).map((field) => [field, field]))));
});

test("two-field input copies the intrinsic nonce before path access and freezes bounds-shape-path precedence", () => {
  const nonce = Buffer.alloc(32, 0x5a);
  const input = record(
    ["scratchParent", "/tmp/private-statefs-profile"],
    ["runNonceBytes", nonce],
  );
  const validated = validatePrivateProfileInput(input);
  nonce.fill(0);
  assert.equal(validated.runNonceSha256, sha256(Buffer.alloc(32, 0x5a)));
  assert.equal(validated.stateRootName.length, 85);
  assert.equal(validated.runNonceBytes.every((byte) => byte === 0x5a), true);
  assert.throws(
    () => validatePrivateProfileInput(record(["scratchParent", `/${"x".repeat(4097)}`], ["runNonceBytes", Buffer.alloc(33, 1)], ["extra", true])),
    { message: "PRIVATE_FS_PROFILE_BOUNDS" },
  );
  assert.throws(
    () => validatePrivateProfileInput(record(["scratchParent", "/tmp"], ["runNonceBytes", Buffer.alloc(32)])),
    { message: "PRIVATE_FS_PROFILE_SHAPE" },
  );
  assert.throws(
    () => validatePrivateProfileInput(record(["scratchParent", "/tmp/../tmp"], ["runNonceBytes", Buffer.alloc(32, 1)])),
    { message: "PRIVATE_FS_PROFILE_PATH" },
  );
  let pathReads = 0;
  const accessor = Object.create(null);
  Object.defineProperties(accessor, {
    scratchParent: {
      enumerable: true,
      configurable: false,
      get() {
        pathReads += 1;
        return "/tmp/private-statefs-profile";
      },
    },
    runNonceBytes: {
      enumerable: true,
      configurable: false,
      writable: false,
      value: Buffer.alloc(32, 1),
    },
  });
  assert.throws(() => validatePrivateProfileInput(accessor), {
    message: "PRIVATE_FS_PROFILE_SHAPE",
  });
  assert.equal(pathReads, 0);

  const stableNonce = Buffer.alloc(32, 0x7b);
  const stableTarget = record(
    ["scratchParent", "/tmp/private-statefs-profile"],
    ["runNonceBytes", stableNonce],
  );
  const descriptorOrder = [];
  const stableProxy = new Proxy(stableTarget, {
    getOwnPropertyDescriptor(target, key) {
      descriptorOrder.push(key);
      if (key === "scratchParent") stableNonce.fill(0);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const proxied = validatePrivateProfileInput(stableProxy);
  assert.deepEqual(descriptorOrder, [
    "runNonceBytes",
    "runNonceBytes",
    "scratchParent",
    "scratchParent",
  ]);
  assert.equal(proxied.runNonceSha256, sha256(Buffer.alloc(32, 0x7b)));
  assert.equal(proxied.runNonceBytes.every((byte) => byte === 0x7b), true);

  let ownKeysCalls = 0;
  const unstableProxy = new Proxy(stableTarget, {
    ownKeys(target) {
      ownKeysCalls += 1;
      const targetKeys = Reflect.ownKeys(target);
      return ownKeysCalls === 1 ? targetKeys : targetKeys.reverse();
    },
  });
  assert.throws(
    () => validatePrivateProfileInput(unstableProxy),
    { message: "PRIVATE_FS_PROFILE_SHAPE" },
  );
});

test("mountinfo oracle selects one decoded longest local ext4 or XFS rw mount", () => {
  const selected = parseMountInfo(
    Buffer.from(
      "10 1 8:1 / / rw,relatime - ext4 /dev/root rw,errors=remount-ro\n" +
        "11 10 8:1 /scratch /tmp/private\\040state rw,nosuid - xfs /dev/test rw,noatime\n",
      "ascii",
    ),
    "/tmp/private state/child",
  );
  assert.equal(selected.mountId, "11");
  assert.equal(selected.mountPoint.toString("utf8"), "/tmp/private state");
  assert.deepEqual(selected.mountOptions, ["noatime", "nosuid", "rw"]);
  const utf8Selected = parseMountInfo(
    Buffer.from(
      "12 10 8:1 /scratch /tmp/privé\\040state rw,nosuid - ext4 /dev/test rw,noatime\n",
      "utf8",
    ),
    "/tmp/privé state/child",
  );
  assert.equal(utf8Selected.mountPoint.toString("utf8"), "/tmp/privé state");
  assert.equal(
    sha256(utf8Selected.mountPoint),
    sha256(Buffer.from("/tmp/privé state", "utf8")),
  );
  assert.throws(
    () => parseMountInfo(Buffer.from("10 1 0:1 / / rw - overlay overlay rw\n"), "/x"),
    { message: "PRIVATE_FS_PROFILE_MOUNT" },
  );
  assert.throws(
    () => parseMountInfo(Buffer.from("10 1 8:1 / / rw - ext4 /dev/root rw\\777\n"), "/x"),
    { message: "PRIVATE_FS_PROFILE_MOUNT" },
  );
});

test("all operation variants and the complete 144-selector before-after oracle are independently fixed", () => {
  assert.deepEqual(Object.keys(SEQUENCES), OPERATION_VARIANTS);
  assert.deepEqual(OPERATIONS.map(([, value]) => value), Array.from({ length: 9 }, (_, index) => index));
  assert.deepEqual(STEPS.map(([, value]) => value), Array.from({ length: 35 }, (_, index) => index));
  assert.equal(FAULT_CASES.length, 144);
  assert.equal(new Set(FAULT_CASES.map(({ operation, selector }) => `${operation}:${selector}`)).size, 144);
  for (const faultCase of FAULT_CASES) {
    const expected = expectedFaultResult(faultCase);
    assert.equal(expected.status, "FAULT_INJECTED");
    assert.equal(expected.errno, 5);
    assert.equal(expected.completedStepCount, faultCase.completedPrefix.length);
    assert.equal(expected.lastCompletedStep, faultCase.completedPrefix.at(-1) ?? 0);
    assert.equal(expected.failedStep, faultCase.boundary === "before" ? faultCase.step : 0);
    if (faultCase.boundary === "after" && faultCase.position === SEQUENCES[faultCase.operation].length - 1) {
      assert.notEqual(expected.status, "COMPLETE");
    }
  }
});

test("independent lifetime, recovery, and deterministic-temporary owner fixtures are internally valid", () => {
  const label = "private-statefs-owner-self-check";
  const root = record(["identitySha256", managerDigest(`${label}:root`)]);
  const managerActorEpochSha256 = managerDigest(`${label}:manager`);
  const lifetime = createPrivateLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
  });
  const before = ownerLifetimeReplayArguments(lifetime, 0);
  const recordValue = lifetime.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  assert.equal(before.expectedLatestRecordSequence, null);
  assert.equal(recordValue.sequence, "0000000000000001");
  assert.equal(recordValue.previousRecordRawSha256, ownerFixtures.ZERO_SHA256);

  const journal = ownerFixtures.createJournalStack(label, 18);
  const adopted = createPrivateAdoptedLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
    journal,
  });
  const close = buildPrivateCloseDecision(adopted, journal, "active");
  assert.equal(close.recoveryPlan.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(
    close.recoveryTarget.targetSha256,
    close.recoveryPlan.targetSha256,
  );
  const finalBundle = journal.normalJournalBundles[17];
  const temporaryName = deterministicTemporaryName(
    managerActorEpochSha256,
    finalBundle.previousBundleRawSha256,
    finalBundle.name,
    finalBundle.bytes,
  );
  assert.match(
    temporaryName,
    /^\.[0-9]{16}-[0-9a-f]{64}\.jsonl\.tmp-[0-9a-f]{64}$/u,
  );
});

test("ABI sizes and every request, observation, and result offset are independent literals", () => {
  assert.deepEqual([ABI.request.size, ABI.observation.size, ABI.result.size], [192, 384, 64]);
  assert.deepEqual([ABI.request.alignment, ABI.observation.alignment, ABI.result.alignment], [8, 8, 8]);
  assert.equal(ABI.request.offsets.length, 32);
  assert.equal(ABI.observation.offsets.length, 21);
  assert.equal(ABI.result.offsets.length, 14);
  for (const layout of Object.values(ABI)) {
    const offsets = layout.offsets.map(([, offset]) => offset);
    assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
    assert.equal(new Set(offsets).size, offsets.length);
    assert.ok(offsets.at(-1) < layout.size);
  }

  const resultBytes = Buffer.alloc(ABI.result.size);
  resultBytes.writeUInt32LE(1, 0);
  resultBytes.writeUInt32LE(ABI.result.size, 4);
  resultBytes.writeUInt32LE(numericFor(OPERATIONS, "LOCK_EX_NB"), 8);
  resultBytes.writeInt32LE(-1, 44);
  const resultBuffers = {
    observations: Buffer.alloc(ABI.observation.size),
    output: Buffer.alloc(0),
    result: resultBytes,
  };
  const resultSpecification = {
    inventoryKind: "NONE",
    operation: "LOCK_EX_NB",
    requestSha256: managerDigest("abi-decoder-self-check"),
  };
  assert.equal(
    decodeNativeResult(resultSpecification, resultBuffers).returnedDirectoryFd,
    -1,
  );
  const malformedOperation = Buffer.from(resultBytes);
  malformedOperation.writeUInt32LE(OPERATION_NAMES.length, 8);
  assert.throws(() =>
    decodeNativeResult(resultSpecification, {
      ...resultBuffers,
      result: malformedOperation,
    }),
  );
  const unsafeBytesConsumed = Buffer.from(resultBytes);
  unsafeBytesConsumed.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 48);
  assert.throws(() =>
    decodeNativeResult(resultSpecification, {
      ...resultBuffers,
      result: unsafeBytesConsumed,
    }),
  );

  const observation = Buffer.alloc(ABI.observation.size);
  observation.writeUInt32LE(ABI.observation.size, 0);
  assert.equal(decodeNativeObservation(observation, 0).kind, "ABSENT");
  assert.equal(decodeNativeObservation(observation, 0).statxMask, 0);
  const regularObservation = Buffer.from(observation);
  regularObservation.writeUInt32LE(
    OBSERVATION_KIND_NAMES.indexOf("REGULAR"),
    4,
  );
  regularObservation.writeUInt32LE(0x17ff, 76);
  assert.equal(decodeNativeObservation(regularObservation, 0).statxMask, 0x17ff);
  for (const mask of [0x1000, 0x07ff]) {
    const incompleteMask = Buffer.from(regularObservation);
    incompleteMask.writeUInt32LE(mask, 76);
    assert.throws(() => decodeNativeObservation(incompleteMask, 0));
  }
  const extraMask = Buffer.from(regularObservation);
  extraMask.writeUInt32LE((0x17ff | 0x8000_0000) >>> 0, 76);
  assert.equal(
    decodeNativeObservation(extraMask, 0).statxMask,
    (0x17ff | 0x8000_0000) >>> 0,
  );
  const nonzeroAbsentMask = Buffer.from(observation);
  nonzeroAbsentMask.writeUInt32LE(1, 76);
  assert.throws(() => decodeNativeObservation(nonzeroAbsentMask, 0));
  for (const rawByte of [0x01, 0x1f, 0x7f]) {
    const rawNameObservation = Buffer.from(observation);
    rawNameObservation.writeUInt32LE(1, 12);
    rawNameObservation[104] = rawByte;
    assert.equal(
      decodeNativeObservation(rawNameObservation, 0).name.charCodeAt(0),
      rawByte,
    );
  }
  for (const rawName of [
    Buffer.from([0x00]),
    Buffer.from([0x2f]),
    Buffer.from("."),
    Buffer.from(".."),
    Buffer.from([0x80]),
    Buffer.from([0xff]),
  ]) {
    const invalidRawName = Buffer.from(observation);
    invalidRawName.writeUInt32LE(rawName.length, 12);
    rawName.copy(invalidRawName, 104);
    assert.throws(() => decodeNativeObservation(invalidRawName, 0));
  }
  const overlengthName = Buffer.from(observation);
  overlengthName.writeUInt32LE(256, 12);
  assert.throws(() => decodeNativeObservation(overlengthName, 0));
  const malformedKind = Buffer.from(observation);
  malformedKind.writeUInt32LE(OBSERVATION_KIND_NAMES.length, 4);
  assert.throws(() => decodeNativeObservation(malformedKind, 0));
  const malformedName = Buffer.from(observation);
  malformedName.writeUInt32LE(1, 12);
  malformedName[104] = 0xff;
  assert.throws(() => decodeNativeObservation(malformedName, 0));
  const unsafeContentOffset = Buffer.from(observation);
  unsafeContentOffset.writeBigUInt64LE(
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    88,
  );
  assert.throws(() => decodeNativeObservation(unsafeContentOffset, 0));

  const unpublishedPartialSlot = Buffer.alloc(ABI.observation.size);
  unpublishedPartialSlot[0] = 0xa5;
  assert.throws(() =>
    decodeNativeResult(resultSpecification, {
      ...resultBuffers,
      observations: unpublishedPartialSlot,
    }),
  );

  const absentRegular = decodeNativeResult(
    { ...resultSpecification, inventoryKind: "REGULAR_FILE" },
    resultBuffers,
  );
  assert.equal(Buffer.isBuffer(absentRegular.outputBytes), true);
  assert.equal(absentRegular.outputBytes.length, 0);
});

test("the pinned N-API bridge is a single raw transport with fixed compiler and link commands", () => {
  const bytes = Buffer.from(BRIDGE_SOURCE, "utf8");
  assert.equal(bytes.length, EXPECTED_BRIDGE_SOURCE_BYTES);
  assert.equal(sha256(bytes), EXPECTED_BRIDGE_SOURCE_SHA256);
  assert.equal(countExact(BRIDGE_SOURCE, "NAPI_MODULE_INIT()"), 1);
  assert.equal(countExact(BRIDGE_SOURCE, '"invoke"'), 1);
  assert.equal(countExact(BRIDGE_SOURCE, "oxigraph_containment_statefs_execute_v1("), 1);
  assert.equal(countExact(BRIDGE_SOURCE, "napi_create_function"), 0);
  assert.doesNotMatch(
    BRIDGE_SOURCE,
    /\b(?:system|popen|fork|execve|socket|connect|getenv|dlopen|pthread_create|napi_call_function)\s*\(/u,
  );
  assert.deepEqual(Object.values(BRIDGE), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(BRIDGE_COMPILE_TEMPLATE.slice(0, 2), ["/usr/bin/cc", "-std=c17"]);
  assert.deepEqual(BRIDGE_LINK_TEMPLATE.slice(0, 3), [
    "/usr/bin/cc",
    "-shared",
    "-B/usr/bin/",
  ]);
  assert.deepEqual(Object.keys(BRIDGE_ENVIRONMENT), ["LC_ALL", "LANG", "TZ", "SOURCE_DATE_EPOCH"]);
  assert.equal(Object.hasOwn(BRIDGE_ENVIRONMENT, "PATH"), false);

  const closedProfile = {
    candidateFds: [73],
    runtime: {
      production: {
        invoke(operation, descriptor, command) {
          assert.deepEqual([operation, descriptor, command], [BRIDGE.FCNTL, 73, F_GETFD]);
          return { returnValue: -1, errno: EBADF };
        },
      },
    },
  };
  retireProvedReleasedDirectory(
    closedProfile,
    { descriptor: 73 },
    "release self-check",
  );
  assert.deepEqual(closedProfile.candidateFds, []);

  const openProfile = {
    candidateFds: [79],
    runtime: {
      production: {
        invoke() {
          return { returnValue: 0, errno: 0 };
        },
      },
    },
  };
  assert.throws(
    () =>
      retireProvedReleasedDirectory(
        openProfile,
        { descriptor: 79 },
        "release self-check",
      ),
  );
  assert.deepEqual(openProfile.candidateFds, [79]);
});

candidateTest("complete triplet attests production and fault objects before the private executor bridge is built", async () => {
  assert.deepEqual(Object.keys(attestation).sort(), [
    "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS",
    "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256",
    "attestCandidateContainmentGuardianStatefsSyscallsV1",
  ].sort());
  assert.equal(attestation.attestCandidateContainmentGuardianStatefsSyscallsV1.length, 1);
  const runtime = await ensureNativeRuntime();
  assert.equal(runtime.report.buildKind, "FAULT");
  assert.equal(runtime.report.repeatedObjectBytesEqual, true);
  assert.equal(runtime.report.faultSelectorPresent, false);
  assert.equal(runtime.report.faultInspection.faultSelectorPresent, true);
  assert.deepEqual(runtime.report.authority, EXPECTED_AUTHORITY);
  assert.deepEqual(runtime.report.physicalFacts, EXPECTED_PHYSICAL_FACTS);
  assert.deepEqual(runtime.report.nonclaims, EXPECTED_NONCLAIMS);
  assert.equal(sha256(Buffer.from(BRIDGE_SOURCE)), EXPECTED_BRIDGE_SOURCE_SHA256);
  assert.deepEqual(runtime.compileArgs.slice(0, 8), [
    "-std=c17",
    "-O2",
    "-fPIC",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-I/usr/include/node",
    `-I${dirname(fileURLToPath(HEADER_URL))}`,
  ]);
});

candidateTest("held root, nonblocking lock contention, depth-first inventory, child transfer, and reverse release use physical descriptors", async () => {
  assert.equal(platform(), "linux");
  assert.equal(arch(), "x64");
  assert.equal(endianness(), "LE");
  assert.match(release(), /^[\x20-\x7e]{1,256}$/u);
  const { value, report } = await withPrivateProfile("lock-inventory-release", async (profile) => {
    for (const [name] of PRIVATE_ROOT_CHILDREN) {
      createFixtureDirectoryAt(
        profile,
        nativeContext(
          profile.childFd,
          "STATE_ROOT",
          profile.identity,
          profile.filesystemMagic,
        ),
        name,
      );
    }
    const rootContext = refreshedContext(
      profile,
      nativeContext(
        profile.childFd,
        "STATE_ROOT",
        bridgeStatx(profile.runtime.production, profile.childFd),
        profile.filesystemMagic,
      ),
      "STATE_ROOT",
    );
    const root = heldDirectoryObservation(rootContext, "STATE_ROOT", false);
    const handles = new Map();
    const managerActorEpochSha256 = managerDigest("physical-lock-inventory-manager");
    const lockPlan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({
        managerActorEpochSha256,
        stateRootObservation: root,
      }),
    );
    handles.set(lockPlan.request.directoryHandleSha256A, rootContext);
    const lock = dispatchAndExecute(profile, statefs, lockPlan, handles);
    assert.equal(lock.receipt.outcome, "LOCK_HELD");
    assert.equal(lock.result.observations.length, 1);
    assert.deepEqual(
      lock.result.observations[0],
      record(
        ["kind", "DIRECTORY"],
        ["role", "STATE_ROOT"],
        ["name", null],
        ["deviceMajor", rootContext.identity.deviceMajor],
        ["deviceMinor", rootContext.identity.deviceMinor],
        ["inode", rootContext.identity.inode],
        ["mountId", rootContext.identity.mountId],
        ["byteLength", rootContext.identity.byteLength],
        ["linkCount", rootContext.identity.linkCount],
        ["mode", rootContext.identity.mode],
        ["ownerUid", profile.effectiveUid],
        ["ownerGid", profile.effectiveGid],
        ["statxMask", rootContext.identity.mask],
        ["filesystemMagic", profile.filesystemMagic.toString(10)],
        ["contentOffset", 0],
        ["contentLength", 0],
      ),
    );

    const secondFd = invokeSuccess(
      profile.runtime.production,
      BRIDGE.OPENAT,
      profile.parentFd,
      rawName(profile.input.stateRootName),
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
    );
    registerCandidateFd(profile, secondFd);
    const secondContext = nativeContext(
      secondFd,
      "STATE_ROOT",
      bridgeStatx(profile.runtime.production, secondFd),
      bridgeFilesystemMagic(profile.runtime.production, secondFd),
    );
    const contenderModule = await import(
      `${STATEFS_SOURCE_URL.href}?private-lock-contender=${profile.input.runNonceSha256}`
    );
    const contenderPlan = contenderModule.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({
        managerActorEpochSha256: managerDigest("physical-lock-contender-manager"),
        stateRootObservation: root,
      }),
    );
    const contenderHandles = new Map([
      [contenderPlan.request.directoryHandleSha256A, secondContext],
    ]);
    const contender = dispatchAndExecute(
      profile,
      contenderModule,
      contenderPlan,
      contenderHandles,
    );
    assert.equal(contender.result.status, "SYSCALL_FAILED");
    assert.equal(contender.result.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(contender.result.errno, 11);
    assert.equal(contender.receipt.outcome, "LOCK_CONTENDED");
    assert.equal(contender.receipt.retryDisposition, "NO_RETRY");

    const rootChildren = PRIVATE_ROOT_CHILDREN;
    let sequence = 1;
    const rootInventoryPlan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({
        kind: "INVENTORY",
        managerActorEpochSha256,
        requestSequence: sequence,
        inventorySetSha256: lock.receipt.inventorySetSha256,
        currentInventorySet: lock.receipt.inventorySet,
        inventoryDirectoryRole: "STATE_ROOT",
        directoryRoleA: "STATE_ROOT",
        expectedOutcome: "INVENTORY_OBSERVED",
      }),
    );
    const rootInventory = dispatchAndExecute(
      profile,
      statefs,
      rootInventoryPlan,
      handles,
    );
    assert.equal(rootInventory.receipt.outcome, "INVENTORY_OBSERVED");
    assert.equal(rootInventory.result.returnedDirectoryFd, -1);
    const expectedRootNames = rootChildren
      .map(([name]) => name)
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      );
    const rawRootNames = rootInventory.result.observations
      .slice(1)
      .map(({ name }) => name);
    assert.deepEqual(
      [...rawRootNames].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
      expectedRootNames,
    );
    assert.deepEqual(
      rootInventory.receipt.inventories[0].entries.map(({ name }) => name),
      expectedRootNames,
    );
    let token = rootInventory.receipt.inventorySet;
    for (const [name, role] of rootChildren) {
      sequence += 1;
      const inventoryPlan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
        plannerInput({
          kind: "INVENTORY",
          managerActorEpochSha256,
          requestSequence: sequence,
          inventorySetSha256: token.inventorySetSha256,
          currentInventorySet: token,
          inventoryDirectoryRole: role,
          directoryRoleA: "STATE_ROOT",
          nameA: name,
          expectedOutcome: "INVENTORY_OBSERVED",
        }),
      );
      const inventory = dispatchAndExecute(
        profile,
        statefs,
        inventoryPlan,
        handles,
      );
      assert.equal(inventory.result.returnedDirectoryFd >= 0, true);
      assert.notEqual(inventory.returnedContext, null);
      const directoryHandleSha256 = inventory.receipt.inventories[0].directoryHandleSha256;
      assert.equal(
        handles.get(directoryHandleSha256),
        inventory.returnedContext,
      );
      token = inventory.receipt.inventorySet;
      sequence += 1;
      const releasePlan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
        plannerInput({
          kind: "RELEASE_DIRECTORY",
          managerActorEpochSha256,
          requestSequence: sequence,
          inventorySetSha256: token.inventorySetSha256,
          currentInventorySet: token,
          directoryRoleA: role,
          expectedOutcome: "DIRECTORY_RELEASED",
        }),
      );
      const releaseResult = dispatchAndExecute(
        profile,
        statefs,
        releasePlan,
        handles,
      );
      retireProvedReleasedDirectory(
        profile,
        inventory.returnedContext,
        `successful ${role} release`,
      );
      handles.delete(directoryHandleSha256);
      assert.equal(releaseResult.receipt.outcome, "DIRECTORY_RELEASED");
      token = releaseResult.receipt.inventorySet;
    }
    assert.equal(handles.size, 1);
    return { root, token, operationCount: sequence + 1 };
  });
  assert.equal(value.operationCount, 14);
  assert.deepEqual(Object.keys(report), PRIVATE_REPORT_FIELDS);
  assert.equal(
    report.reportSha256,
    digestPrecedingFields(report, "reportSha256", PRIVATE_REPORT_FIELDS),
  );
  assert.equal(report.cleanupAttempted, true);
  assert.equal(report.cleanupCompleted, true);
  assert.equal(report.cleanupErrno, null);
});

candidateTest("persist and mkdir exercise immutable bytes, no-replace collisions, metadata rejection, sync, reobservation, and honest residue", async () => {
  assert.equal(PROFILE_GOLDEN.regularMode, "0600");
  assert.equal(PROFILE_GOLDEN.rootMode, "0700");
  const { value, report } = await withPrivateProfile("persist-mkdir", async (profile) => {
    const generation = fixtureDirectory(profile, "persist-generation", "GENERATION");
    const input = Buffer.from('{"durable":"candidate"}\n', "utf8");
    const finalName = "generation.jsonl";
    const temporaryName = `.generation.jsonl.tmp-${operationName(0, "persist-success")}`;
    const persist = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "PERSIST_NOREPLACE", {
        fdA: generation,
        nameA: temporaryName,
        nameB: finalName,
        input,
      }),
    );
    assertCompleteNative(persist, "PERSIST_NOREPLACE", { bytesConsumed: input.length });
    assert.equal(persist.observations.length, 1);
    assert.equal(persist.observations[0].name, finalName);
    assert.equal(persist.observations[0].contentLength, 0);
    assert.equal(persist.outputBytes, null);
    assertDirectoryAllowlist(
      profile,
      generation,
      [finalName],
      "persist success allowlist",
    );
    assertExactRegularFileAt(
      profile,
      generation,
      finalName,
      input,
      "persist success final",
    );

    const inventory = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "INVENTORY/REGULAR_FILE/PRESENT", {
        fdA: generation,
        nameA: finalName,
      }),
    );
    assertCompleteNative(inventory, "INVENTORY/REGULAR_FILE/PRESENT", {
      bytesConsumed: input.length,
    });
    assert.equal(inventory.outputBytes.equals(input), true);

    const collisionTemporary = `.generation.jsonl.tmp-${operationName(1, "persist-collision")}`;
    const collision = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "PERSIST_NOREPLACE", {
        fdA: generation,
        nameA: collisionTemporary,
        nameB: finalName,
        input,
      }),
    );
    assert.equal(collision.status, "SYSCALL_FAILED");
    assert.equal(collision.effectClass, "MUTATION_OBSERVED_NOT_FULLY_SYNCED");
    assert.equal(collision.errno, 17);
    assert.equal(collision.failedStep, "FINAL_INSTALLED");
    assert.equal(statxOutcome(profile.runtime.production, generation.descriptor, collisionTemporary).result.returnValue, 0);
    assert.equal(statxOutcome(profile.runtime.production, generation.descriptor, finalName).result.returnValue, 0);
    assertDirectoryAllowlist(
      profile,
      generation,
      [collisionTemporary, finalName],
      "persist collision allowlist",
    );
    assertExactRegularFileAt(
      profile,
      generation,
      collisionTemporary,
      input,
      "persist collision temporary",
    );
    assertExactRegularFileAt(
      profile,
      generation,
      finalName,
      input,
      "persist collision final",
    );

    const preexistingTemporary = `.generation.jsonl.tmp-${operationName(2, "persist-temporary-collision")}`;
    const preexistingBytes = Buffer.from("preexisting-temporary\n", "utf8");
    createFixtureFile(
      profile,
      generation,
      preexistingTemporary,
      preexistingBytes,
    );
    const temporaryCollision = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "PERSIST_NOREPLACE", {
        fdA: generation,
        nameA: preexistingTemporary,
        nameB: validRecordName(2, "persist-temporary-collision-final"),
        input,
      }),
    );
    assert.equal(temporaryCollision.status, "SYSCALL_FAILED");
    assert.equal(temporaryCollision.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(temporaryCollision.errno, 17);
    assert.equal(temporaryCollision.failedStep, "TEMP_CREATED");
    assertDirectoryAllowlist(
      profile,
      generation,
      [collisionTemporary, finalName, preexistingTemporary],
      "temporary collision allowlist",
    );
    assertExactRegularFileAt(
      profile,
      generation,
      preexistingTemporary,
      preexistingBytes,
      "temporary collision preserved bytes",
    );

    const staging = fixtureDirectory(profile, "mkdir-staging", "STAGING");
    const childName = operationName(0, "mkdir-success");
    const made = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MKDIR_SYNC", {
        fdA: staging,
        nameA: childName,
      }),
    );
    assertCompleteNative(made, "MKDIR_SYNC");
    assert.equal(made.observations.length, 1);
    assert.equal(made.observations[0].name, childName);
    const madeIdentity = assertExactDirectoryAt(
      profile,
      staging,
      childName,
      "mkdir success child",
    );
    assertDirectoryAllowlist(
      profile,
      staging,
      [childName],
      "mkdir success allowlist",
    );
    const collisionDirectory = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MKDIR_SYNC", {
        fdA: staging,
        nameA: childName,
      }),
    );
    assert.equal(collisionDirectory.status, "SYSCALL_FAILED");
    assert.equal(collisionDirectory.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(collisionDirectory.errno, 17);
    assert.equal(collisionDirectory.failedStep, "CHILD_DIRECTORY_CREATED");
    assertDirectoryAllowlist(
      profile,
      staging,
      [childName],
      "mkdir collision allowlist",
    );
    assertExactDirectoryAt(
      profile,
      staging,
      childName,
      "mkdir collision preserved child",
      madeIdentity,
    );

    const unsafeName = validRecordName(7, "unsafe-mode");
    createFixtureFile(
      profile,
      generation,
      unsafeName,
      Buffer.from("unsafe\n"),
      0o644,
    );
    const unsafe = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "INVENTORY/REGULAR_FILE/PRESENT", {
        fdA: generation,
        nameA: unsafeName,
      }),
    );
    assert.equal(unsafe.status, "REJECTED");
    assert.equal(unsafe.effectClass, "NO_EFFECT");
    assert.equal(unsafe.errno, 0);
    assertExactRegularFileAt(
      profile,
      generation,
      unsafeName,
      Buffer.from("unsafe\n"),
      "unsafe-mode fixture",
      0o644,
    );
    assertDirectoryAllowlist(
      profile,
      generation,
      [collisionTemporary, finalName, preexistingTemporary, unsafeName],
      "unsafe inventory allowlist",
    );

    const symlinkName = validRecordName(8, "unsafe-symlink");
    invokeSuccess(
      profile.runtime.production,
      BRIDGE.SYMLINKAT,
      rawName(finalName),
      generation.descriptor,
      rawName(symlinkName),
    );
    const symlinkInventory = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "INVENTORY/REGULAR_FILE/PRESENT", {
        fdA: generation,
        nameA: symlinkName,
      }),
    );
    assert.equal(symlinkInventory.status, "REJECTED");
    assert.equal(symlinkInventory.effectClass, "NO_EFFECT");
    assert.equal(symlinkInventory.errno, 0);
    const symlinkIdentity = bridgeStatx(
      profile.runtime.production,
      generation.descriptor,
      symlinkName,
    );
    assert.equal(symlinkIdentity.mode & S_IFMT, S_IFLNK);
    assert.equal(symlinkIdentity.ownerUid, profile.effectiveUid);
    assert.equal(symlinkIdentity.ownerGid, profile.effectiveGid);
    assertDirectoryAllowlist(
      profile,
      generation,
      [
        collisionTemporary,
        finalName,
        preexistingTemporary,
        symlinkName,
        unsafeName,
      ],
      "nofollow inventory allowlist",
    );

    const driftedOwner = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MKDIR_SYNC", {
        fdA: staging,
        nameA: operationName(8, "owner-drift"),
        expectedOwnerUid: (profile.effectiveUid + 1) >>> 0,
      }),
    );
    assert.equal(driftedOwner.status, "REJECTED");
    assert.equal(driftedOwner.effectClass, "NO_EFFECT");
    assert.equal(driftedOwner.failedStep, "FD_A_VALIDATED");
    assert.equal(driftedOwner.errno, 0);
    assertNamedPresence(
      profile.runtime.production,
      staging,
      operationName(8, "owner-drift"),
      false,
      "owner drift child absent",
    );
    assertDirectoryAllowlist(
      profile,
      staging,
      [childName],
      "owner drift leaves staging unchanged",
    );
    closeFixtureDirectory(profile, staging);
    closeFixtureDirectory(profile, generation);
    return { persist, inventory, collision, made, collisionDirectory, unsafe, symlinkInventory, driftedOwner };
  });
  assert.equal(value.inventory.outputBytes.toString("utf8"), '{"durable":"candidate"}\n');
  assert.equal(report.cleanupCompleted, true);
  assert.deepEqual(report.authority, EXPECTED_AUTHORITY);
});

candidateTest("both move operations and temporary cleanup preserve first-error, no-overwrite, no-follow, and postorder cleanup semantics", async () => {
  assert.equal(SEQUENCES.MOVE_NOREPLACE_SYNC.includes(16), true);
  assert.equal(SEQUENCES.MOVE_SYNC_REOBSERVE.includes(31), true);
  assert.equal(SEQUENCES.TEMP_CLEANUP.includes(19), true);
  const { value, report } = await withPrivateProfile("move-cleanup", async (profile) => {
    const source = fixtureDirectory(profile, "move-source", "STAGING");
    const destination = fixtureDirectory(profile, "move-destination", "ACTIVE");
    const generationName = operationName(0, "generation-move");
    invokeSuccess(
      profile.runtime.production,
      BRIDGE.MKDIRAT,
      source.descriptor,
      rawName(generationName),
      0o700,
    );
    const original = bridgeStatx(profile.runtime.production, source.descriptor, generationName);
    assertDirectoryAllowlist(
      profile,
      source,
      [generationName],
      "move source precondition",
    );
    assertDirectoryAllowlist(profile, destination, [], "move destination precondition");
    const moved = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MOVE_NOREPLACE_SYNC", {
        fdA: source,
        fdB: destination,
        nameA: generationName,
        nameB: generationName,
      }),
    );
    assertCompleteNative(moved, "MOVE_NOREPLACE_SYNC");
    assert.equal(statxOutcome(profile.runtime.production, source.descriptor, generationName).result.errno, 2);
    assert.equal(
      bridgeStatx(profile.runtime.production, destination.descriptor, generationName).inode,
      original.inode,
    );
    assertDirectoryAllowlist(profile, source, [], "move source residue");
    assertDirectoryAllowlist(
      profile,
      destination,
      [generationName],
      "move destination residue",
    );
    assertExactDirectoryAt(
      profile,
      destination,
      generationName,
      "move destination identity",
      original,
    );

    const syncOnly = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MOVE_SYNC_REOBSERVE", {
        fdA: source,
        fdB: destination,
        nameA: generationName,
        nameB: generationName,
      }),
    );
    assertCompleteNative(syncOnly, "MOVE_SYNC_REOBSERVE");
    assert.equal(syncOnly.observations.length, 2);
    assert.equal(syncOnly.observations[0].kind, "ABSENT");
    assert.equal(syncOnly.observations[1].inode, original.inode);
    assertDirectoryAllowlist(profile, source, [], "sync-only source residue");
    assertDirectoryAllowlist(
      profile,
      destination,
      [generationName],
      "sync-only destination residue",
    );
    assertExactDirectoryAt(
      profile,
      destination,
      generationName,
      "sync-only destination identity",
      original,
    );

    invokeSuccess(
      profile.runtime.production,
      BRIDGE.MKDIRAT,
      source.descriptor,
      rawName(generationName),
      0o700,
    );
    const collidingSource = bridgeStatx(
      profile.runtime.production,
      source.descriptor,
      generationName,
    );
    assertDirectoryAllowlist(
      profile,
      source,
      [generationName],
      "move collision source precondition",
    );
    const collision = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "MOVE_NOREPLACE_SYNC", {
        fdA: source,
        fdB: destination,
        nameA: generationName,
        nameB: generationName,
      }),
    );
    assert.equal(collision.status, "SYSCALL_FAILED");
    assert.equal(collision.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(collision.errno, 17);
    assert.equal(collision.failedStep, "GENERATION_MOVED");
    assert.equal(
      bridgeStatx(profile.runtime.production, source.descriptor, generationName).inode,
      collidingSource.inode,
    );
    assert.equal(
      bridgeStatx(profile.runtime.production, destination.descriptor, generationName).inode,
      original.inode,
    );
    assertDirectoryAllowlist(
      profile,
      source,
      [generationName],
      "move collision source residue",
    );
    assertDirectoryAllowlist(
      profile,
      destination,
      [generationName],
      "move collision destination residue",
    );
    assertExactDirectoryAt(
      profile,
      source,
      generationName,
      "move collision preserved source",
      collidingSource,
    );
    assertExactDirectoryAt(
      profile,
      destination,
      generationName,
      "move collision preserved destination",
      original,
    );

    const journal = fixtureDirectory(profile, "cleanup-journal", "NORMAL_JOURNAL");
    const temporaryName = validTemporaryName(0, "cleanup-success");
    const temporaryBytes = Buffer.from("cleanup-residue\n");
    createFixtureFile(profile, journal, temporaryName, temporaryBytes);
    assertDirectoryAllowlist(
      profile,
      journal,
      [temporaryName],
      "cleanup precondition allowlist",
    );
    assertExactRegularFileAt(
      profile,
      journal,
      temporaryName,
      temporaryBytes,
      "cleanup precondition temporary",
    );
    const cleanup = executeNative(
      profile.runtime.production,
      rawSpecification(profile, "TEMP_CLEANUP", {
        fdA: journal,
        nameA: temporaryName,
      }),
    );
    assertCompleteNative(cleanup, "TEMP_CLEANUP");
    assert.equal(
      statxOutcome(profile.runtime.production, journal.descriptor, temporaryName).result.errno,
      2,
    );
    assertDirectoryAllowlist(profile, journal, [], "cleanup residue allowlist");
    closeFixtureDirectory(profile, journal);
    closeFixtureDirectory(profile, destination);
    closeFixtureDirectory(profile, source);
    return { moved, syncOnly, collision, cleanup };
  });
  assert.equal(value.moved.operation, "MOVE_NOREPLACE_SYNC");
  assert.equal(value.syncOnly.operation, "MOVE_SYNC_REOBSERVE");
  assert.equal(value.cleanup.operation, "TEMP_CLEANUP");
  assert.equal(report.cleanupCompleted, true);
});

candidateTest("all 144 independently observed fault executions are fed once into the frozen StateFS verifier oracle", async () => {
  assert.equal(FAULT_CASES.length, 144);
  assert.equal(typeof statefs.assertCandidateContainmentGuardianStatefsRequestV1, "function");
  assert.equal(typeof statefs.verifyCandidateContainmentGuardianStatefsResultV1, "function");
  const observed = [];
  const reports = [];
  for (const [index, faultCase] of FAULT_CASES.entries()) {
    const { value, report } = await withPrivateProfile(
      `fault-${String(index).padStart(3, "0")}`,
      async (profile) => {
        const fixture = await faultFixture(profile, faultCase, index);
        fixture.specification = nativeSpecificationForRequest(
          profile,
          fixture.plan.request,
          fixture.handles,
          faultCase.selector,
          fixture.observedPresence,
        );
        assert.equal(
          variantForRequest(fixture.plan.request, fixture.observedPresence),
          faultCase.operation,
        );
        const verifierCounter = { count: 0 };
        let bodyValue;
        let bodyError;
        try {
          const dispatched = dispatchAndExecute(
            profile,
            fixture.module,
            fixture.plan,
            fixture.handles,
            {
              fault: true,
              faultSelector: faultCase.selector,
              observedPresence: fixture.observedPresence,
              verifierCounter,
            },
          );
          if (dispatched.returnedContext !== null) {
            fixture.contexts.push(dispatched.returnedContext);
          }
          assert.equal(verifierCounter.count, 1);
          assertFaultNative(dispatched.result, faultCase, fixture, profile);
          assert.equal(dispatched.receipt.outcome, faultCase.outcome);
          assert.equal(
            dispatched.receipt.retryDisposition,
            faultCase.retryDisposition,
          );
          assertFaultResidue(profile, faultCase, fixture);
          bodyValue = record(
            ["operation", faultCase.operation],
            ["selector", faultCase.selector],
            ["requestSha256", fixture.plan.request.requestSha256],
            ["receiptSha256", dispatched.receipt.receiptSha256],
          );
        } catch (error) {
          bodyError = error;
        }

        const releasedDescriptor =
          faultCase.operation === "RELEASE_DIRECTORY" &&
          faultCase.completedPrefix.includes(34)
            ? fixture.plan.request.directoryHandleSha256A
            : null;
        const releasedContext =
          releasedDescriptor === null
            ? null
            : fixture.handles.get(releasedDescriptor);
        let teardownError;
        for (const context of [...fixture.contexts].reverse()) {
          if (!profile.candidateFds.includes(context.descriptor)) continue;
          try {
            if (context === releasedContext) {
              retireProvedReleasedDirectory(
                profile,
                context,
                `${faultCase.operation}:${faultCase.selector}`,
              );
            } else {
              closeTrackedDirectory(profile, context);
            }
          } catch (error) {
            if (teardownError === undefined) teardownError = error;
          }
        }

        if (bodyError !== undefined) {
          if (
            teardownError !== undefined &&
            bodyError !== null &&
            typeof bodyError === "object" &&
            Object.isExtensible(bodyError)
          ) {
            Object.defineProperty(bodyError, "faultTeardownError", {
              configurable: false,
              enumerable: false,
              value: teardownError,
              writable: false,
            });
          }
          throw bodyError;
        }
        if (teardownError !== undefined) throw teardownError;
        return bodyValue;
      },
    );
    observed.push(value);
    reports.push(report);
  }
  assert.equal(observed.length, 144);
  assert.deepEqual(
    observed.map(({ operation, selector }) => `${operation}:${selector}`),
    FAULT_CASES.map(({ operation, selector }) => `${operation}:${selector}`),
  );
  assert.equal(reports.length, 144);
  assert.equal(reports.every(({ cleanupCompleted }) => cleanupCompleted), true);
});

test("source-triplet attribution rejects partial, wrong-code, wrong-URL, wrong-message, and present-source shapes", () => {
  const shape = {
    code: "ERR_MODULE_NOT_FOUND",
    url: ATTESTATION_URL.href,
    message: `Cannot find module '${fileURLToPath(ATTESTATION_URL)}' imported from ${EVALUATOR_PATH}`,
  };
  const absent = [
    { present: false },
    { present: false },
    { present: false },
  ];
  assert.equal(exactMissingAttestationError(shape, absent), true);
  assert.equal(exactMissingAttestationError({ ...shape, code: "ENOENT" }, absent), false);
  assert.equal(exactMissingAttestationError({ ...shape, url: `${shape.url}.other` }, absent), false);
  assert.equal(exactMissingAttestationError({ ...shape, message: `${shape.message}.other` }, absent), false);
  const { url: _url, ...nodeTwentyShape } = shape;
  assert.equal(exactMissingAttestationError(nodeTwentyShape, absent), true);
  assert.equal(exactMissingAttestationError({ ...nodeTwentyShape, message: `${shape.message}.other` }, absent), false);
  assert.equal(exactMissingAttestationError(shape, [{ present: true }, ...absent.slice(1)]), false);
});

test("reports exactly one candidate-attributed missing-triplet RED before native build or filesystem setup", () => {
  assertTerminalAttestationState(
    attestationImportAttempts,
    attestationImportError,
    attestation,
    evaluatorOwnedRoot,
  );
});
