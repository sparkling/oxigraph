import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGitHome,
  runGit,
  runGitBytesWithProcessRunnerForTesting,
} from "../src/candidate/git.mjs";
import {
  asciiFoldPathBytes,
  createTreeV2PrimitivesForTesting,
  diffTreesV2,
  gitObjectOid,
  loadTreeV2,
  parseRawDiffTreeBytes,
  parseTreeBytes,
  pathBytesToHex,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntriesAtAsciiFold,
  treeEntryAtPath,
} from "../src/candidate/tree-v2.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";

const zeroSha1 = "0".repeat(40);
const oid = (digit) => digit.repeat(40);

function asBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

function treeRecord({
  mode = "100644",
  type = "blob",
  object = oid("a"),
  path,
}) {
  return Buffer.concat([
    Buffer.from(`${mode} ${type} ${object}\t`, "ascii"),
    asBytes(path),
    Buffer.from([0]),
  ]);
}

function diffRecord({
  oldMode,
  newMode = "100644",
  oldOid,
  newOid,
  status,
  path,
}) {
  return Buffer.concat([
    Buffer.from(
      `:${oldMode} ${newMode} ${oldOid} ${newOid} ${status}\0`,
      "ascii",
    ),
    asBytes(path),
    Buffer.from([0]),
  ]);
}

function fault(reason) {
  return (error) => {
    assert.equal(error instanceof TaskV2Failure, true);
    assert.equal(error.code, reason);
    return true;
  };
}

test("tree parser preserves raw non-UTF8, tab, and newline paths without key collisions", () => {
  const invalidFf = Buffer.from([0xff, 0x2e, 0x72, 0x73]);
  const invalidFe = Buffer.from([0xfe, 0x2e, 0x72, 0x73]);
  assert.equal(invalidFf.toString("utf8"), invalidFe.toString("utf8"));

  const output = Buffer.concat([
    treeRecord({ mode: "040000", type: "tree", object: oid("1"), path: "dir" }),
    treeRecord({ object: oid("2"), path: Buffer.from("dir/tab\tname") }),
    treeRecord({ object: oid("3"), path: Buffer.from("line\nname") }),
    treeRecord({ object: oid("4"), path: invalidFf }),
    treeRecord({ object: oid("5"), path: invalidFe }),
    treeRecord({ object: oid("6"), path: "Case.rs" }),
    treeRecord({ object: oid("a"), path: "case.rs" }),
  ]);
  const tree = parseTreeBytes(output);

  assert.equal(tree.schema, "oxigraph.git-tree-map/v2");
  assert.equal(tree.objectFormat, "sha1");
  assert.equal(tree.entryCount, 7);
  assert.equal(tree.treeEntryCount, 1);
  assert.equal(tree.manifestEntryCount, 6);
  assert.deepEqual(treeEntryAtPath(tree, invalidFf).path, invalidFf);
  assert.deepEqual(treeEntryAtPath(tree, invalidFe).path, invalidFe);
  assert.notEqual(pathBytesToHex(invalidFf), pathBytesToHex(invalidFe));
  assert.equal(tree.byPathHex.size, 7);

  const folded = treeEntriesAtAsciiFold(tree, "CASE.rs");
  assert.deepEqual(
    folded.map((entry) => entry.path.toString("utf8")),
    ["Case.rs", "case.rs"],
  );
  assert.equal(
    tree.byFoldedPathHex.get(
      asciiFoldPathBytes(Buffer.from("CASE.rs")).toString("hex"),
    ).length,
    2,
  );

  const retained = treeEntryAtPath(tree, invalidFf);
  const changedCopy = retained.path;
  changedCopy.fill(0);
  assert.deepEqual(retained.path, invalidFf);
  const changedMap = tree.byPathHex;
  changedMap.clear();
  assert.equal(tree.byPathHex.size, 7);
  assert.throws(() => pathBytesToHex("a\0b"), fault("ERR_PATH_INVALID"));
});

test("tree parser rejects incomplete, duplicate, topologically invalid, and mode/type-invalid records", () => {
  const valid = treeRecord({ path: "file.rs" });
  assert.throws(
    () => parseTreeBytes(valid.subarray(0, valid.length - 1)),
    fault("ERR_BASELINE_STATE"),
  );
  assert.throws(
    () => parseTreeBytes(Buffer.concat([valid, valid])),
    fault("ERR_BASELINE_STATE"),
  );
  assert.throws(
    () =>
      parseTreeBytes(
        treeRecord({
          mode: "040000",
          type: "blob",
          object: oid("1"),
          path: "dir",
        }),
      ),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.throws(
    () =>
      parseTreeBytes(
        treeRecord({
          mode: "100644",
          type: "tree",
          object: oid("1"),
          path: "file",
        }),
      ),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.throws(
    () => parseTreeBytes(treeRecord({ path: "missing-parent/file" })),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.throws(
    () =>
      parseTreeBytes(
        Buffer.concat([
          treeRecord({ path: "sha1", object: oid("1") }),
          treeRecord({ path: "sha256", object: "2".repeat(64) }),
        ]),
      ),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.throws(
    () =>
      parseTreeBytes(Buffer.from(`100644 blob ${oid("A")}\tfile\0`, "ascii")),
    fault("ERR_BASELINE_STATE"),
  );
  assert.throws(
    () => parseTreeBytes(treeRecord({ object: zeroSha1, path: "zero" })),
    fault("ERR_OBJECT_TYPE"),
  );
});

test("phase manifests omit tree records, sort raw records, and exclude exact non-tree paths", () => {
  const protectedRecord = treeRecord({
    object: oid("1"),
    path: "src/protected.rs",
  });
  const baseline = parseTreeBytes(
    Buffer.concat([
      treeRecord({
        mode: "040000",
        type: "tree",
        object: oid("2"),
        path: "src",
      }),
      treeRecord({ object: oid("3"), path: "src/present.rs" }),
      protectedRecord,
    ]),
  );
  const candidate = parseTreeBytes(
    Buffer.concat([
      treeRecord({
        mode: "040000",
        type: "tree",
        object: oid("4"),
        path: "src",
      }),
      treeRecord({ object: oid("5"), path: "src/present.rs" }),
      treeRecord({ object: oid("6"), path: "src/created.rs" }),
      protectedRecord,
    ]),
  );

  const baselineProtected = projectTreeManifestV2(baseline, {
    exclude: ["src/present.rs"],
  });
  const candidateProtected = projectTreeManifestV2(candidate, {
    exclude: ["src/present.rs", "src/created.rs"],
  });
  assert.equal(baselineProtected.entries, 1);
  assert.equal(candidateProtected.entries, 1);
  assert.equal(baselineProtected.sha256, candidateProtected.sha256);
  assert.deepEqual(baselineProtected.framed, protectedRecord);

  const fullCandidate = projectTreeManifestV2(candidate);
  const expectedRecords = [
    treeRecord({ object: oid("5"), path: "src/present.rs" }).subarray(0, -1),
    treeRecord({ object: oid("6"), path: "src/created.rs" }).subarray(0, -1),
    protectedRecord.subarray(0, -1),
  ].sort(Buffer.compare);
  const expectedFrame = Buffer.concat(
    expectedRecords.flatMap((record) => [record, Buffer.from([0])]),
  );
  assert.equal(fullCandidate.entries, 3);
  assert.deepEqual(fullCandidate.framed, expectedFrame);
  assert.equal(
    fullCandidate.sha256,
    createHash("sha256").update(expectedFrame).digest("hex"),
  );
  assert.throws(
    () => projectTreeManifestV2(candidate, { exclude: ["src"] }),
    fault("ERR_PROTECTED_MANIFEST"),
  );
  assert.throws(
    () => projectTreeManifestV2(candidate, { exclude: ["absent.rs"] }),
    fault("ERR_PROTECTED_MANIFEST"),
  );
});

test("Git object helper produces exact SHA-1 and SHA-256 object identities", () => {
  const content = Buffer.from([0x00, 0xff, 0x0a]);
  const framed = Buffer.concat([Buffer.from("blob 3\0", "ascii"), content]);
  assert.equal(
    gitObjectOid(content, "sha1"),
    createHash("sha1").update(framed).digest("hex"),
  );
  assert.equal(
    gitObjectOid(content, { algorithm: "sha256", type: "blob" }),
    createHash("sha256").update(framed).digest("hex"),
  );
  assert.throws(
    () => gitObjectOid(content, { algorithm: "md5" }),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.throws(
    () => gitObjectOid(content, { type: "file" }),
    fault("ERR_OBJECT_TYPE"),
  );
});

test("raw diff parser preserves exact paths and admits only canonical A/M transitions", () => {
  const addedPath = Buffer.from([0xff, 0x0a, 0x61]);
  const modifiedPath = Buffer.from("tab\tfile.rs");
  const added = diffRecord({
    oldMode: "000000",
    oldOid: zeroSha1,
    newOid: oid("1"),
    status: "A",
    path: addedPath,
  });
  const modified = diffRecord({
    oldMode: "100644",
    oldOid: oid("2"),
    newOid: oid("3"),
    status: "M",
    path: modifiedPath,
  });
  const diff = parseRawDiffTreeBytes(Buffer.concat([modified, added]));

  assert.equal(diff.objectFormat, "sha1");
  assert.equal(diff.changeCount, 2);
  assert.equal(diff.byPathHex.get(addedPath.toString("hex")).status, "A");
  assert.equal(
    diff.byPathHex.get(modifiedPath.toString("hex")).oldOid,
    oid("2"),
  );
  assert.equal(
    diff.byPathHex.get(modifiedPath.toString("hex")).newOid,
    oid("3"),
  );

  assert.throws(
    () =>
      parseRawDiffTreeBytes(
        diffRecord({
          oldMode: "100644",
          newMode: "000000",
          oldOid: oid("2"),
          newOid: zeroSha1,
          status: "D",
          path: "deleted.rs",
        }),
      ),
    fault("ERR_CANDIDATE_STATUS"),
  );
  assert.throws(
    () =>
      parseRawDiffTreeBytes(
        diffRecord({
          oldMode: "000000",
          newMode: "100755",
          oldOid: zeroSha1,
          newOid: oid("1"),
          status: "A",
          path: "executable.rs",
        }),
      ),
    fault("ERR_CANDIDATE_STATUS"),
  );
  assert.throws(
    () => parseRawDiffTreeBytes(Buffer.concat([added, added])),
    fault("ERR_CANDIDATE_STATUS"),
  );
  assert.throws(
    () => parseRawDiffTreeBytes(added.subarray(0, added.length - 1)),
    fault("ERR_CANDIDATE_STATUS"),
  );
});

test("malformed public inputs terminate inside the typed v2 boundary", async () => {
  const validTree = treeRecord({ path: "file.rs" });
  const validDiff = diffRecord({
    oldMode: "000000",
    oldOid: zeroSha1,
    newOid: oid("1"),
    status: "A",
    path: "file.rs",
  });
  const parsedTree = parseTreeBytes(validTree);
  assert.throws(
    () => parseTreeBytes(validTree, null),
    fault("ERR_BASELINE_STATE"),
  );
  assert.throws(
    () => parseRawDiffTreeBytes(validDiff, null),
    fault("ERR_CANDIDATE_STATUS"),
  );
  assert.throws(
    () => projectTreeManifestV2(parsedTree, null),
    fault("ERR_PROTECTED_MANIFEST"),
  );
  await assert.rejects(() => loadTreeV2(), fault("ERR_INTERNAL_FAIL_CLOSED"));
  await assert.rejects(
    () => readBlobByOid(),
    fault("ERR_INTERNAL_FAIL_CLOSED"),
  );
  await assert.rejects(() => diffTreesV2(), fault("ERR_INTERNAL_FAIL_CLOSED"));
});

test("tree commands validate OIDs and pass only literal bounded Git argv", async () => {
  const tree = oid("1");
  const oldTree = oid("2");
  const newTree = oid("3");
  const blob = Buffer.from("content\n");
  const blobOid = gitObjectOid(blob);
  const calls = [];
  const primitives = createTreeV2PrimitivesForTesting(async (request) => {
    calls.push(request);
    if (request.args[0] === "cat-file" && request.args[1] === "-t") {
      return Buffer.from("tree\n", "ascii");
    }
    if (request.args[0] === "ls-tree") return Buffer.alloc(0);
    if (request.args[0] === "cat-file") return blob;
    if (request.args[0] === "diff-tree") return Buffer.alloc(0);
    throw new Error("unexpected command");
  });

  await primitives.loadTreeV2({
    workspace: "/workspace",
    home: "/git-home",
    tree,
  });
  assert.deepEqual(
    await primitives.readBlobByOid({
      workspace: "/workspace",
      home: "/git-home",
      oid: blobOid,
    }),
    blob,
  );
  await primitives.diffTreesV2({
    workspace: "/workspace",
    home: "/git-home",
    oldTree,
    newTree,
  });

  assert.deepEqual(calls[0].args, ["cat-file", "-t", tree]);
  assert.deepEqual(calls[1].args, [
    "ls-tree",
    "-r",
    "-t",
    "-z",
    "--full-tree",
    tree,
  ]);
  assert.deepEqual(calls[2].args, ["cat-file", "blob", blobOid]);
  assert.deepEqual(calls[3].args, ["cat-file", "-t", oldTree]);
  assert.deepEqual(calls[4].args, ["cat-file", "-t", newTree]);
  assert.deepEqual(calls[5].args, [
    "diff-tree",
    "-r",
    "--raw",
    "-z",
    "--no-renames",
    "--no-commit-id",
    "--no-abbrev",
    oldTree,
    newTree,
  ]);
  assert.equal(
    calls.every((call) => call.cwd === "/workspace"),
    true,
  );
  assert.equal(
    calls.every((call) => !Object.hasOwn(call, "stdin")),
    true,
  );

  const callsBeforeInvalidOid = calls.length;
  await assert.rejects(
    () =>
      primitives.readBlobByOid({
        workspace: "/workspace",
        home: "/git-home",
        oid: "HEAD:--upload-pack=attacker",
      }),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.equal(calls.length, callsBeforeInvalidOid);

  let nonTreeCalls = 0;
  const nonTree = createTreeV2PrimitivesForTesting(async (request) => {
    nonTreeCalls += 1;
    assert.deepEqual(request.args.slice(0, 2), ["cat-file", "-t"]);
    return Buffer.from("commit\n", "ascii");
  });
  await assert.rejects(
    () =>
      nonTree.loadTreeV2({
        workspace: "/workspace",
        home: "/git-home",
        tree,
      }),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.equal(nonTreeCalls, 1);
  await assert.rejects(
    () =>
      nonTree.diffTreesV2({
        workspace: "/workspace",
        home: "/git-home",
        oldTree,
        newTree,
      }),
    fault("ERR_OBJECT_TYPE"),
  );
  assert.equal(nonTreeCalls, 2);

  const failing = createTreeV2PrimitivesForTesting(async () => {
    throw new Error("/private/workspace: secret command output");
  });
  await assert.rejects(
    () =>
      failing.loadTreeV2({ workspace: "/workspace", home: "/git-home", tree }),
    (error) => {
      assert.equal(error instanceof TaskV2Failure, true);
      assert.equal(error.code, "ERR_OBJECT_TYPE");
      assert.doesNotMatch(
        JSON.stringify(error),
        /private|secret|command output/u,
      );
      return true;
    },
  );
});

test("runGitBytes uses the byte supervisor contract without changing literal argv", async () => {
  const stdout = Buffer.from([0x00, 0xff, 0x0a]);
  let captured;
  const result = await runGitBytesWithProcessRunnerForTesting(
    {
      args: ["ls-tree", "--", "literal"],
      cwd: "/workspace",
      home: "/git-home",
      timeoutMs: 123,
      maxOutputBytes: 456,
    },
    async (request) => {
      captured = request;
      return {
        disposition: "completed",
        exitCode: 0,
        captureComplete: true,
        stdout,
        stderr: Buffer.alloc(0),
      };
    },
  );

  assert.deepEqual(result, stdout);
  assert.equal(captured.executable, "/usr/bin/git");
  assert.deepEqual(captured.args, ["ls-tree", "--", "literal"]);
  assert.equal(captured.cwd, "/workspace");
  assert.equal(captured.timeoutMs, 123);
  assert.equal(captured.maxOutputBytes, 456);
  assert.equal(Object.hasOwn(captured, "stdin"), false);
});

test("live Git tree, blob, and diff primitives preserve raw path bytes", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxigraph-tree-v2-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const workspace = join(fixtureRoot, "repo");
  await mkdir(workspace);
  const home = await createGitHome(fixtureRoot);
  await runGit({
    args: ["init", "--initial-branch=main"],
    cwd: workspace,
    home,
  });

  const invalidName = Buffer.from([0xff, 0x2e, 0x72, 0x73]);
  const tabName = Buffer.from("tab\tfile.rs");
  const newlineName = Buffer.from("line\nfile.rs");
  const absoluteRawPath = (name) =>
    Buffer.concat([Buffer.from(workspace), Buffer.from("/"), name]);
  const invalidContent = Buffer.from([0x00, 0xff, 0x0a]);
  await writeFile(absoluteRawPath(invalidName), invalidContent);
  await writeFile(absoluteRawPath(tabName), "before\n");
  await writeFile(absoluteRawPath(newlineName), "stable\n");
  await runGit({ args: ["add", "-A"], cwd: workspace, home });
  const oldTree = (
    await runGit({ args: ["write-tree"], cwd: workspace, home })
  ).trim();

  const loaded = await loadTreeV2({ workspace, home, tree: oldTree });
  assert.deepEqual(treeEntryAtPath(loaded, invalidName).path, invalidName);
  assert.deepEqual(treeEntryAtPath(loaded, tabName).path, tabName);
  assert.deepEqual(treeEntryAtPath(loaded, newlineName).path, newlineName);
  const invalidEntry = treeEntryAtPath(loaded, invalidName);
  assert.deepEqual(
    await readBlobByOid({ workspace, home, oid: invalidEntry.oid }),
    invalidContent,
  );

  const createdName = Buffer.from("created\nfile.rs");
  await writeFile(absoluteRawPath(tabName), "after\n");
  await writeFile(absoluteRawPath(createdName), "created\n");
  await runGit({ args: ["add", "-A"], cwd: workspace, home });
  const newTree = (
    await runGit({ args: ["write-tree"], cwd: workspace, home })
  ).trim();
  const diff = await diffTreesV2({ workspace, home, oldTree, newTree });

  assert.equal(diff.changeCount, 2);
  assert.equal(diff.byPathHex.get(tabName.toString("hex")).status, "M");
  assert.equal(diff.byPathHex.get(createdName.toString("hex")).status, "A");
});
