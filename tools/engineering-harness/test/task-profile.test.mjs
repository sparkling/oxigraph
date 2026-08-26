import assert from "node:assert/strict";
import { join, relative } from "node:path";
import test from "node:test";

import { harnessRoot, repositoryRoot } from "../src/paths.mjs";
import {
  buildEngineeringTaskRegistry,
  engineeringTaskIds,
  engineeringTaskRegistry,
  taskProfile,
  taskProfileBySlug,
} from "../src/task-profile.mjs";

const expected = Object.freeze([
  ["g1.2-rocksdb-serialized-writers", "g1.2"],
  ["g1.3-transaction-capabilities", "g1.3"],
  ["g1.4-bounded-writer-admission", "g1.4"],
  ["g1.5-unified-egress-policy", "g1.5"],
  ["g1.5b-update-cancellation", "g1.5b"],
  ["g1.5c-negotiated-update", "g1.5c"],
  ["g1.6-runtime-derived-service-claims", "g1.6"],
]);

test("ordered task registry binds exact ids, slugs, and canonical contract paths", () => {
  assert.deepEqual(
    engineeringTaskRegistry.map(({ id, slug, contractPath }) => [
      id,
      slug,
      relative(repositoryRoot, contractPath),
    ]),
    expected.map(([id, slug]) => [
      id,
      slug,
      `tools/engineering-harness/tasks/g1/${slug}/contract.json`,
    ]),
  );
  assert.deepEqual(engineeringTaskIds, expected.map(([id]) => id));
  assert.equal(Object.isFrozen(engineeringTaskRegistry), true);
  for (const profile of engineeringTaskRegistry) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(
      profile.contractPath,
      join(harnessRoot, "tasks", "g1", profile.slug, "contract.json"),
    );
    assert.equal(taskProfile(profile.id), profile);
    assert.equal(taskProfileBySlug(profile.slug), profile);
  }
});

test("task registry construction fails before runtime on duplicate or path-like declarations", () => {
  const declarations = engineeringTaskRegistry.map(({ contractPath, ...entry }) => entry);
  assert.throws(
    () => buildEngineeringTaskRegistry([...declarations, declarations[0]]),
    /duplicate engineering task id/u,
  );
  assert.throws(
    () =>
      buildEngineeringTaskRegistry([
        ...declarations,
        { ...declarations[0], id: "g1.7-future", slug: declarations[0].slug },
      ]),
    /duplicate engineering task slug/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry([{ ...declarations[0], slug: "../g1.2" }]),
    /slug must be canonical/u,
  );
  const future = buildEngineeringTaskRegistry([
    { ...declarations[0], id: "g2.1-future-task", slug: "g2.1" },
  ])[0];
  assert.equal(
    future.contractPath,
    join(harnessRoot, "tasks", "g2", "g2.1", "contract.json"),
  );
  assert.throws(() => taskProfile("tasks/g1/g1.2/contract.json"), /unsupported/u);
  assert.throws(() => taskProfileBySlug("../g1.2"), /unsupported/u);
});
