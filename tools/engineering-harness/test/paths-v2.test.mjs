import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assembleCandidatePatchV2,
  asciiFoldPathV2,
  gitBlobObjectIdV2,
  validateCandidatePatchV2,
  validateTaskV2Path,
  validateTaskV2Scope,
} from "../src/policy/paths-v2.mjs";
import { validateCandidatePatch } from "../src/policy/paths.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";

const EXISTING = "lib/oxigraph/src/existing_v2.rs";
const CREATED = "lib/oxigraph/src/new_v2.rs";

function contract({
  mutableExact = [EXISTING, CREATED],
  createExact = [CREATED],
  mutablePrefixes = [],
  allowCreate = createExact.length > 0,
  objectFormat = "sha1",
  ceilings = {},
} = {}) {
  const width = objectFormat === "sha1" ? 40 : 64;
  return {
    baseline: { tree: "a".repeat(width) },
    evaluator: { tree: "b".repeat(width) },
    scope: {
      mutableExact,
      createExact,
      mutablePrefixes,
      blockedExact: [],
      blockedPrefixes: [],
      allowCreate,
    },
    ceilings: {
      maxPatchBytes: 16_384,
      maxChangedFiles: 8,
      maxChangedLines: 64,
      ...ceilings,
    },
  };
}

function modifiedSection(path = EXISTING) {
  return (
    `diff --git a/${path} b/${path}\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    "@@ -1 +1 @@\n" +
    "-old\n" +
    "+changed\n"
  );
}

function createdSection(
  path = CREATED,
  contentLines = ["pub fn created() {}"],
  objectFormat = "sha1",
) {
  const content = `${contentLines.join("\n")}\n`;
  const width = objectFormat === "sha1" ? 40 : 64;
  const objectId = gitBlobObjectIdV2(content, objectFormat);
  return (
    `diff --git a/${path} b/${path}\n` +
    "new file mode 100644\n" +
    `index ${"0".repeat(width)}..${objectId}\n` +
    "--- /dev/null\n" +
    `+++ b/${path}\n` +
    `@@ -0,0 +1,${contentLines.length} @@\n` +
    `${contentLines.map((line) => `+${line}`).join("\n")}\n`
  );
}

function failureCode(code) {
  return (error) => error instanceof TaskV2Failure && error.code === code;
}

test("v2 paths use only strict ASCII-safe segments and a fixed ASCII fold", () => {
  for (const path of [
    "a",
    "_private",
    "A0/file.name-with_parts.rs",
    "lib/oxigraph/src/new_v2.rs",
  ]) {
    assert.equal(validateTaskV2Path(path), path);
  }
  assert.equal(asciiFoldPathV2("Lib/ASCII_Z.rs"), "lib/ascii_z.rs");

  for (const path of [
    "",
    "/absolute",
    "C:/drive",
    "./relative",
    "../escape",
    "a//b",
    "a/",
    "a/..",
    "a/.hidden",
    "-option",
    ":(glob)src/*",
    "src\\file.rs",
    "src/file name.rs",
    "src/café.rs",
    "src/control\u0001.rs",
  ]) {
    assert.throws(
      () => validateTaskV2Path(path),
      failureCode("ERR_PATH_INVALID"),
    );
  }
});

test("scope validation maps hostile object traps to one typed terminal failure", () => {
  let trapCalls = 0;
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("/private/worktree token=secret");
      },
    },
  );

  assert.throws(() => validateTaskV2Scope(hostile), (error) => {
    assert.equal(error instanceof TaskV2Failure, true);
    assert.equal(error.code, "ERR_CONTRACT_SCHEMA_OR_KEYS");
    assert.equal(error.terminal, true);
    assert.equal(error.retryAllowed, false);
    assert.doesNotMatch(`${error.stack}\n${JSON.stringify(error)}`, /private|secret|token/u);
    return true;
  });
  assert.equal(trapCalls, 0);
});

test("scope validation rejects field and element accessors without invoking them", () => {
  for (const kind of ["field", "element", "evaluator"]) {
    const value = contract({
      mutableExact: [CREATED],
      createExact: [CREATED],
    });
    let getterCalls = 0;
    if (kind === "evaluator") {
      Object.defineProperty(value.evaluator, "path", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return CREATED;
        },
      });
    } else if (kind === "field") {
      Object.defineProperty(value.scope, "mutableExact", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return [CREATED];
        },
      });
    } else {
      const paths = [];
      Object.defineProperty(paths, 0, {
        enumerable: true,
        get() {
          getterCalls += 1;
          return CREATED;
        },
      });
      paths.length = 1;
      value.scope.mutableExact = paths;
    }

    assert.throws(
      () => validateTaskV2Scope(value),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
    assert.equal(getterCalls, 0);
  }
});

test("scope and patch policy keep the evaluator path protected", () => {
  const value = contract({
    mutableExact: [CREATED],
    createExact: [CREATED],
  });
  value.evaluator.path = CREATED;

  assert.throws(
    () => validateTaskV2Scope(value),
    failureCode("ERR_PATH_COLLISION"),
  );
  assert.throws(
    () => validateCandidatePatchV2(createdSection(), value),
    failureCode("ERR_PATH_COLLISION"),
  );
});

test("scope validation rejects exact, ancestor, and portable-fold ambiguity", () => {
  for (const mutableExact of [
    ["src/a.rs", "src/a.rs"],
    ["src/a", "src/a/child.rs"],
  ]) {
    assert.throws(
      () =>
        validateTaskV2Scope(
          contract({ mutableExact, createExact: [], allowCreate: false }),
        ),
      failureCode("ERR_PATH_OVERLAP"),
    );
  }
  for (const mutableExact of [
    ["src/A.rs", "src/a.rs"],
    ["SRC/a", "src/A/child.rs"],
  ]) {
    assert.throws(
      () =>
        validateTaskV2Scope(
          contract({ mutableExact, createExact: [], allowCreate: false }),
        ),
      failureCode("ERR_PATH_COLLISION"),
    );
  }
});

test("createExact is a canonical ordered subset and alone derives creation authority", () => {
  const derived = validateTaskV2Scope(contract());
  assert.deepEqual(derived, {
    mutableExact: [EXISTING, CREATED],
    createExact: [CREATED],
    mutablePrefixes: [],
    allowCreate: true,
  });
  assert.equal(Object.isFrozen(derived), true);
  assert.equal(Object.isFrozen(derived.mutableExact), true);

  const withoutCachedFlag = contract();
  delete withoutCachedFlag.scope.allowCreate;
  assert.equal(validateTaskV2Scope(withoutCachedFlag).allowCreate, true);
  assert.throws(
    () => validateTaskV2Scope(contract({ allowCreate: false })),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.throws(
    () =>
      validateTaskV2Scope(
        contract({
          createExact: ["lib/oxigraph/src/not_mutable.rs"],
        }),
      ),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.throws(
    () =>
      validateTaskV2Scope(
        contract({
          mutableExact: ["src/parent/child.rs"],
          createExact: ["src/parent"],
        }),
      ),
    failureCode("ERR_PATH_OVERLAP"),
  );
  assert.throws(
    () =>
      validateTaskV2Scope(
        contract({
          mutableExact: ["src/case/child.rs"],
          createExact: ["SRC/CASE"],
        }),
      ),
    failureCode("ERR_PATH_COLLISION"),
  );
  assert.throws(
    () =>
      validateTaskV2Scope(
        contract({
          mutableExact: ["src/b.rs", "src/a.rs"],
          createExact: [],
          allowCreate: false,
        }),
      ),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.throws(
    () =>
      validateTaskV2Scope(
        contract({ mutablePrefixes: ["lib/oxigraph/src/generated"] }),
      ),
    failureCode("ERR_PATH_OVERLAP"),
  );
});

test("mixed raw v2 patches preserve ordered M/A and created-blob projections", () => {
  const content = "pub fn created() {}\n";
  const patch = `${modifiedSection()}${createdSection()}`;
  const result = validateCandidatePatchV2(patch, contract());
  assert.deepEqual(result, {
    paths: [EXISTING, CREATED],
    pathStatuses: [
      { path: EXISTING, status: "M" },
      { path: CREATED, status: "A" },
    ],
    createdBlobs: [
      {
        path: CREATED,
        mode: "100644",
        type: "blob",
        objectId: gitBlobObjectIdV2(content, "sha1"),
        contentSha256: createHash("sha256").update(content).digest("hex"),
      },
    ],
    changedLines: 3,
  });
  assert.deepEqual(Object.keys(result), [
    "paths",
    "pathStatuses",
    "createdBlobs",
    "changedLines",
  ]);
  assert.deepEqual(Object.keys(result.createdBlobs[0]), [
    "path",
    "mode",
    "type",
    "objectId",
    "contentSha256",
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.paths), true);
  assert.equal(Object.isFrozen(result.pathStatuses), true);
  assert.equal(Object.isFrozen(result.pathStatuses[0]), true);
  assert.equal(Object.isFrozen(result.createdBlobs), true);
  assert.equal(Object.isFrozen(result.createdBlobs[0]), true);
});

test("status projection uses canonical byte-path order independent of patch order", () => {
  const first = "lib/oxigraph/src/a_status.rs";
  const second = "lib/oxigraph/src/z_status.rs";
  const modifyOnly = contract({
    mutableExact: [first, second],
    createExact: [],
    allowCreate: false,
  });
  const result = validateCandidatePatchV2(
    `${modifiedSection(second)}${modifiedSection(first)}`,
    modifyOnly,
  );
  assert.deepEqual(result.paths, [second, first]);
  assert.deepEqual(result.pathStatuses, [
    { path: first, status: "M" },
    { path: second, status: "M" },
  ]);
});

test("creation recomputes full-width SHA-1 and SHA-256 Git blob identities", () => {
  const content = "alpha\nbeta\n";
  assert.throws(
    () => gitBlobObjectIdV2(content),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  for (const objectFormat of ["sha1", "sha256"]) {
    const expected = createHash(objectFormat)
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    assert.equal(gitBlobObjectIdV2(content, objectFormat), expected);
    const currentContract = contract({ objectFormat });
    const result = validateCandidatePatchV2(
      createdSection(CREATED, ["alpha", "beta"], objectFormat),
      currentContract,
    );
    assert.equal(result.createdBlobs[0].objectId, expected);
    assert.equal(
      result.createdBlobs[0].objectId.length,
      objectFormat === "sha1" ? 40 : 64,
    );
  }

  const sha256Contract = contract({ objectFormat: "sha256" });
  assert.throws(
    () =>
      validateCandidatePatchV2(
        createdSection(CREATED, ["alpha"], "sha1"),
        sha256Contract,
      ),
    failureCode("ERR_PATCH_CANONICAL"),
  );
  assert.throws(
    () =>
      validateCandidatePatchV2(createdSection(), contract(), {
        objectFormat: "sha1",
      }),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  const missingRepositoryIdentity = contract();
  delete missingRepositoryIdentity.baseline;
  assert.throws(
    () => validateCandidatePatchV2(createdSection(), missingRepositoryIdentity),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
});

test("every createExact path is mandatory and creation sections retain declared order", () => {
  assert.throws(
    () => validateCandidatePatchV2(modifiedSection(), contract()),
    failureCode("ERR_CANDIDATE_STATUS"),
  );
  assert.throws(
    () => validateCandidatePatchV2(modifiedSection(CREATED), contract()),
    failureCode("ERR_PATCH_CANONICAL"),
  );

  const first = "lib/oxigraph/src/new_a.rs";
  const second = "lib/oxigraph/src/new_b.rs";
  const orderedContract = contract({
    mutableExact: [first, second],
    createExact: [first, second],
  });
  assert.throws(
    () =>
      validateCandidatePatchV2(
        `${createdSection(second)}${createdSection(first)}`,
        orderedContract,
      ),
    failureCode("ERR_PATCH_CANONICAL"),
  );
  const accepted = validateCandidatePatchV2(
    `${createdSection(first)}${createdSection(second)}`,
    orderedContract,
  );
  assert.deepEqual(
    accepted.createdBlobs.map(({ path }) => path),
    [first, second],
  );
});

test("the six-record creation form rejects every raw canonicality mutation", () => {
  const exact = createdSection();
  const mutations = [
    exact.slice(0, -1),
    exact.replaceAll("\n", "\r\n"),
    exact
      .replace("new file mode 100644\nindex ", "index ")
      .replace("\n--- /dev/null", "\nnew file mode 100644\n--- /dev/null"),
    exact.replace("@@ -0,0 +1,1 @@", "@@ -0 +1 @@"),
    exact.replace("@@ -0,0 +1,1 @@", "@@ -0,0 +1,0 @@"),
    exact.replace("+pub fn created() {}", " pub fn created() {}"),
    exact.replace(
      "+pub fn created() {}\n",
      "+pub fn created() {}\n@@ -0,0 +1,1 @@\n+again\n",
    ),
    exact.replace(
      "+pub fn created() {}\n",
      "+pub fn created() {}\n\\ No newline at end of file\n",
    ),
    exact.replace(/^index 0+/mu, "index 0000000"),
    exact.replace(/\.\.[0-9a-f]+/u, `..${"f".repeat(40)}`),
    `${exact}\n`,
  ];
  for (const patch of mutations) {
    assert.throws(
      () => validateCandidatePatchV2(patch, contract()),
      failureCode("ERR_PATCH_CANONICAL"),
    );
  }
});

test("created content is exact non-empty UTF-8 with one terminal LF", () => {
  const unicode = createdSection(CREATED, ['const LABEL: &str = "Grüße";']);
  assert.equal(
    validateCandidatePatchV2(unicode, contract()).createdBlobs.length,
    1,
  );
  assert.throws(
    () =>
      validateCandidatePatchV2(
        createdSection().replace(
          "@@ -0,0 +1,1 @@\n+pub fn created() {}\n",
          "@@ -0,0 +1,1 @@\n+\ud800\n",
        ),
        contract(),
      ),
    failureCode("ERR_PATCH_CANONICAL"),
  );
  assert.throws(
    () =>
      validateCandidatePatchV2(
        createdSection().replace(
          "@@ -0,0 +1,1 @@\n+pub fn created() {}\n",
          "@@ -0,0 +1,0 @@\n",
        ),
        contract(),
      ),
    failureCode("ERR_PATCH_CANONICAL"),
  );
});

test("modifications retain v1 raw canonical hunk form without canonicalization", () => {
  const modifyOnly = contract({
    mutableExact: [EXISTING],
    createExact: [],
    allowCreate: false,
  });
  assert.deepEqual(
    validateCandidatePatchV2(modifiedSection(), modifyOnly).pathStatuses,
    [{ path: EXISTING, status: "M" }],
  );
  const noNewline = modifiedSection().replace(
    "-old\n+changed\n",
    "-old\n\\ No newline at end of file\n+changed\n\\ No newline at end of file\n",
  );
  assert.equal(validateCandidatePatchV2(noNewline, modifyOnly).changedLines, 2);

  const v1MetadataOrder = modifiedSection().replace(
    `--- a/${EXISTING}\n+++ b/${EXISTING}`,
    `--- a/${EXISTING}\nindex abcdef1..abcdef2\n+++ b/${EXISTING}`,
  );
  assert.deepEqual(validateCandidatePatch(v1MetadataOrder, modifyOnly), [
    EXISTING,
  ]);
  assert.deepEqual(
    validateCandidatePatchV2(v1MetadataOrder, modifyOnly).pathStatuses,
    [{ path: EXISTING, status: "M" }],
  );

  for (const patch of [
    modifiedSection().replace("@@ -1 +1 @@", "@@ -01 +1 @@"),
    modifiedSection().replace("@@ -1 +1 @@", "@@ -1,1 +1,1 @@"),
    modifiedSection().replace("-old", " old"),
    modifiedSection().replace("--- a/", "--- /dev/null\n--- a/"),
  ]) {
    assert.throws(
      () => validateCandidatePatchV2(patch, modifyOnly),
      failureCode("ERR_PATCH_CANONICAL"),
    );
  }
});

test("v2 patch ceilings terminate with the dedicated ceiling reason", () => {
  assert.throws(
    () =>
      validateCandidatePatchV2(
        createdSection(),
        contract({ ceilings: { maxPatchBytes: 16 } }),
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
  assert.throws(
    () =>
      validateCandidatePatchV2(
        createdSection(CREATED, ["one", "two"]),
        contract({ ceilings: { maxChangedLines: 1 } }),
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
  const second = "lib/oxigraph/src/second_v2.rs";
  assert.throws(
    () =>
      validateCandidatePatchV2(
        `${modifiedSection()}${modifiedSection(second)}`,
        contract({
          mutableExact: [EXISTING, second],
          createExact: [],
          allowCreate: false,
          ceilings: { maxChangedFiles: 1 },
        }),
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
});

test("v2 assembly emits canonical create-only SHA-1 and SHA-256 patches", () => {
  assert.equal(assembleCandidatePatchV2.length, 3);
  const content = "alpha\nGrüße\n";
  for (const objectFormat of ["sha1", "sha256"]) {
    const creation = Object.assign(Object.create(null), {
      path: CREATED,
      content,
    });
    const currentContract = contract({ objectFormat });
    const assembled = assembleCandidatePatchV2(currentContract, null, [
      creation,
    ]);
    const expectedPatch = createdSection(
      CREATED,
      ["alpha", "Grüße"],
      objectFormat,
    );

    assert.equal(assembled.patch, expectedPatch);
    assert.deepEqual(
      assembled.projection,
      validateCandidatePatchV2(expectedPatch, currentContract),
    );
    assert.equal(
      assembled.projection.createdBlobs[0].objectId,
      gitBlobObjectIdV2(content, objectFormat),
    );
    assert.deepEqual(Object.keys(assembled), ["patch", "projection"]);
    assert.equal(Object.isFrozen(assembled), true);
    assert.equal(Object.isFrozen(assembled.projection), true);
  }
});

test("v2 assembly preserves every raw modification byte before creations", () => {
  const rawModification = modifiedSection()
    .replace(
      `--- a/${EXISTING}\n+++ b/${EXISTING}`,
      `--- a/${EXISTING}\nindex abcdef1..abcdef2\n+++ b/${EXISTING}`,
    )
    .replace(
      "-old\n+changed\n",
      "-old\n\\ No newline at end of file\n+changed\n",
    );
  const content = "first\n\n+already-prefixed\n";
  const expectedCreation = createdSection(CREATED, [
    "first",
    "",
    "+already-prefixed",
  ]);
  const assembled = assembleCandidatePatchV2(contract(), rawModification, [
    { path: CREATED, content },
  ]);

  assert.equal(assembled.patch, `${rawModification}${expectedCreation}`);
  assert.equal(
    assembled.patch.slice(0, rawModification.length),
    rawModification,
  );
  assert.deepEqual(assembled.projection.paths, [EXISTING, CREATED]);
  assert.deepEqual(assembled.projection.pathStatuses, [
    { path: EXISTING, status: "M" },
    { path: CREATED, status: "A" },
  ]);
});

test("v2 assembly requires exact createExact count, paths, and order", () => {
  const first = "lib/oxigraph/src/new_a.rs";
  const second = "lib/oxigraph/src/new_b.rs";
  const orderedContract = contract({
    mutableExact: [first, second],
    createExact: [first, second],
  });
  const creation = (path) => ({ path, content: `${path}\n` });

  for (const creations of [[], [creation(first)]]) {
    assert.throws(
      () => assembleCandidatePatchV2(orderedContract, null, creations),
      failureCode("ERR_CANDIDATE_STATUS"),
    );
  }
  for (const creations of [
    [creation(second), creation(first)],
    [creation(first), creation("lib/oxigraph/src/new_c.rs")],
  ]) {
    assert.throws(
      () => assembleCandidatePatchV2(orderedContract, null, creations),
      failureCode("ERR_CANDIDATE_STATUS"),
    );
  }
  assert.throws(
    () =>
      assembleCandidatePatchV2(orderedContract, null, [
        creation(first),
        creation("../escape"),
      ]),
    failureCode("ERR_PATH_INVALID"),
  );
  assert.throws(
    () =>
      assembleCandidatePatchV2(
        orderedContract,
        null,
        Array.from({ length: 33 }, () => creation(first)),
      ),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
});

test("v2 assembly rejects noncanonical creation content", () => {
  assert.throws(
    () =>
      assembleCandidatePatchV2(contract(), "", [
        { path: CREATED, content: "created\n" },
      ]),
    failureCode("ERR_PATCH_CANONICAL"),
  );
  for (const content of [
    "",
    "missing terminal LF",
    "NUL\0byte\n",
    "CRLF\r\n",
    "unpaired surrogate \ud800\n",
    Buffer.from("bytes\n"),
  ]) {
    assert.throws(
      () =>
        assembleCandidatePatchV2(contract(), null, [
          { path: CREATED, content },
        ]),
      failureCode("ERR_PATCH_CANONICAL"),
    );
  }
});

test("v2 assembly rejects hidden, symbolic, sparse, and fieldful inputs", () => {
  const valid = { path: CREATED, content: "created\n" };
  const hiddenRecord = { ...valid };
  Object.defineProperty(hiddenRecord, "hidden", { value: true });
  const symbolicRecord = { ...valid, [Symbol("hidden")]: true };
  const hiddenArray = [{ ...valid }];
  Object.defineProperty(hiddenArray, "hidden", { value: true });
  const symbolicArray = [{ ...valid }];
  symbolicArray[Symbol("hidden")] = true;
  const sparseArray = new Array(1);

  for (const creations of [
    [hiddenRecord],
    [symbolicRecord],
    hiddenArray,
    symbolicArray,
    sparseArray,
  ]) {
    assert.throws(
      () => assembleCandidatePatchV2(contract(), null, creations),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
  }
});

test("v2 assembly rejects creation accessors without invoking getters", () => {
  let getterCalls = 0;
  const recordAccessor = { content: "created\n" };
  Object.defineProperty(recordAccessor, "path", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return CREATED;
    },
  });
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { path: CREATED, content: "created\n" };
    },
  });

  for (const creations of [[recordAccessor], arrayAccessor]) {
    assert.throws(
      () => assembleCandidatePatchV2(contract(), null, creations),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
    assert.equal(getterCalls, 0);
  }
});

test("v2 assembly enforces existing byte, file, and line ceilings", () => {
  assert.throws(
    () =>
      assembleCandidatePatchV2(
        contract({ ceilings: { maxPatchBytes: 200 } }),
        null,
        [{ path: CREATED, content: "x\n" }],
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
  assert.throws(
    () =>
      assembleCandidatePatchV2(
        contract({ ceilings: { maxChangedLines: 1 } }),
        null,
        [{ path: CREATED, content: "one\ntwo\n" }],
      ),
    failureCode("ERR_PATCH_CEILING"),
  );

  const first = "lib/oxigraph/src/new_a.rs";
  const second = "lib/oxigraph/src/new_b.rs";
  assert.throws(
    () =>
      assembleCandidatePatchV2(
        contract({
          mutableExact: [first, second],
          createExact: [first, second],
          ceilings: { maxChangedFiles: 1 },
        }),
        null,
        [
          { path: first, content: "first\n" },
          { path: second, content: "second\n" },
        ],
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
  assert.throws(
    () =>
      assembleCandidatePatchV2(
        contract({ ceilings: { maxChangedLines: 2 } }),
        modifiedSection(),
        [{ path: CREATED, content: "created\n" }],
      ),
    failureCode("ERR_PATCH_CEILING"),
  );
});
