import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { assertOwnerActionIndependent } from "../src/ordinary-coordinator.mjs";

const held = (overrides = {}) => ({ paths: ["src/sibling"], canonicalReads: [],
  resources: ["cargo:sibling"], custodyComplete: true, externalActions: "snapshot-bound", ...overrides });
const action = { paths: ["src/parent"], resources: ["cargo:parent"] };
test("owner admission distinguishes immutable snapshots from live reads and retained external custody", () => {
  assert.doesNotThrow(() => assertOwnerActionIndependent(action, [held()]));
  for (const lane of [held({ paths: ["src"] }), held({ canonicalReads: ["src/parent/api"] }),
    held({ resources: ["cargo:parent"] }), held({ custodyComplete: false }),
    held({ externalActions: "unconfirmed" }), held({ canonicalReads: undefined })]) {
    assert.throws(() => assertOwnerActionIndependent(action, [lane]), /conflict|custody/);
  }
  for (const path of ["../src", "src/../parent", "/src", "src//parent", "src\\parent", "."]) {
    assert.throws(() => assertOwnerActionIndependent({ ...action, paths: [path] }, []), /exact paths/);
  }
  // Failed/cancelled ownership is supplied unchanged until actual external termination.
  assert.throws(() => assertOwnerActionIndependent(action, [held({ externalActions: "cancelled" })]), /custody/);
});

test("owner accepts settled parent and starts accepted-source child before unrelated snapshot sibling ends", async () => {
  const source = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const root = mkdtempSync(join(tmpdir(), "oxigraph-owner-handoff-"));
  cpSync(join(source, "tools"), join(root, "tools"), { recursive: true,
    filter: path => !path.split("/").some(part => ["node_modules", "target", ".runtime", ".git"].includes(part)) });
  symlinkSync(realpathSync(join(source, "tools/engineering-harness/node_modules")),
    join(root, "tools/engineering-harness/node_modules"), "dir");
  writeFileSync(join(root, ".gitignore"), "target/\nnode_modules/\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  git("add", ".");
  const commit = () => git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-m", "fixture accepted source");
  commit();
  const load = name => import(pathToFileURL(join(root, `tools/engineering-harness/src/${name}.mjs`)).href);
  const { createOrdinaryWorkspace } = await load("ordinary-workspace");
  const { runOrdinaryBatch } = await load("ordinary-pool");
  const { assertOwnerActionIndependent: admit } = await load("ordinary-coordinator");
  const path = "tools/engineering-harness/README.md";
  const siblingPath = "tools/engineering-harness/src/delivery.mjs";
  const childPath = "tools/engineering-harness/src/workflow-host.mjs";
  const entry = (id, mutation) => ({ id, host: async () => ({}), resources: [], spec: {
    schema: 1, taskId: `task-${id}`, scope: "harness", goal: "Prove accepted source handoff",
    completionCheck: "Fixture owner accepts source", paths: [mutation],
    checks: [{ completionCheck: "Policy tests pass", argv: ["node", "--test", "--test-reporter=tap",
      "tools/engineering-harness/test/workflow-policy.test.mjs"] }],
  } });
  const parent = createOrdinaryWorkspace(), sibling = createOrdinaryWorkspace();
  const frozenSibling = sibling.observe();
  const original = readFileSync(join(root, path), "utf8");
  const updated = `${original}\nAccepted fixture parent.\n`;
  writeFileSync(join(parent.root, path), updated);
  const slow = Promise.withResolvers(), notified = Promise.withResolvers();
  let siblingRunning = false, candidate;
  const batch = runOrdinaryBatch([entry("parent", path), entry("sibling", siblingPath)],
    { maxConcurrency: 2, onSettled: lane => { if (lane.id === "parent") { candidate = lane; notified.resolve(); } } },
    async spec => {
      if (spec.taskId === "task-sibling") {
        siblingRunning = true;
        await slow.promise;
        assert.deepEqual(sibling.observe(), frozenSibling);
        siblingRunning = false;
        return { candidateRoot: sibling.root };
      }
      return { candidateRoot: parent.root, integration: "pending-owner-acceptance" };
    });
  try {
    await notified.promise;
    assert.equal(siblingRunning, true);
    assert.equal(candidate.integration, "pending-owner-acceptance");
    const custody = [held({ paths: [siblingPath], resources: [] })];
    admit({ paths: [path], resources: [] }, custody);
    // Fixture owner verifies bytes, applies serially, validates and commits. Production
    // checks/review are not replaced by this deterministic owner integration fixture.
    assert.equal(readFileSync(join(root, path), "utf8"), original);
    assert.equal(readFileSync(join(parent.root, path), "utf8"), updated);
    writeFileSync(join(root, path), updated);
    assert.equal(readFileSync(join(root, path), "utf8"), updated);
    git("add", path); commit();
    const acceptedHead = git("rev-parse", "HEAD");
    assert.notEqual(acceptedHead, parent.base.head);
    assert.deepEqual(sibling.observe(), frozenSibling);
    assert.equal(readFileSync(join(sibling.root, path), "utf8"), original);
    admit({ paths: [childPath], resources: [] }, custody);
    const childBatch = await runOrdinaryBatch([entry("child", childPath)], { maxConcurrency: 1 }, async () => {
      assert.equal(siblingRunning, true);
      const child = createOrdinaryWorkspace();
      assert.equal(child.base.head, acceptedHead);
      assert.equal(readFileSync(join(child.root, path), "utf8"), updated);
      return { candidateRoot: child.root };
    });
    assert.equal(childBatch.results[0].status, "fulfilled");
    assert.equal(siblingRunning, true);
  } finally { slow.resolve(); await batch; }
  assert.ok((await batch).results.every(result => result.status === "fulfilled"));
  rmSync(root, { recursive: true, force: true });
});
