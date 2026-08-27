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
  ["g1.4a-store-terminal-outcomes", "g1.4a"],
  ["g1.4b-outcome-fault-safety", "g1.4b"],
  ["g1.5-unified-egress-policy", "g1.5"],
  ["g1.5b-update-cancellation", "g1.5b"],
  ["g1.5c-negotiated-update", "g1.5c"],
  ["g1.6-runtime-derived-service-claims", "g1.6"],
]);

test("ordered task registry binds exact ids, slugs, and derived contract paths", () => {
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
  assert.equal(Object.isFrozen(engineeringTaskIds), true);
  for (const profile of engineeringTaskRegistry) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.sourceAllowlist), true);
    assert.equal(
      profile.contractPath,
      join(harnessRoot, "tasks", "g1", profile.slug, "contract.json"),
    );
    assert.equal(taskProfile(profile.id), profile);
    assert.equal(taskProfileBySlug(profile.slug), profile);
  }
  assert.equal(
    taskProfile("g1.6-runtime-derived-service-claims").sourceAllowlist.includes(
      "lib/spareval/src/lib.rs",
    ),
    true,
  );
  const g14b = taskProfile("g1.4b-outcome-fault-safety");
  assert.equal(g14b.evaluatorChangeStatus, "M");
  assert.equal(g14b.mutablePath, "lib/oxigraph/src/storage/rocksdb_wrapper.rs");
  assert.equal(Object.hasOwn(g14b, "mutablePaths"), false);
  assert.equal(
    g14b.sourceAllowlist.includes(
      "lib/oxigraph/src/store/transaction_outcome_faults.rs",
    ),
    true,
  );
});

test("registry construction fails closed on duplicate or caller-derived identity", () => {
  const declarations = engineeringTaskRegistry.map(({ contractPath, ...entry }) => entry);
  assert.throws(
    () => buildEngineeringTaskRegistry(undefined),
    /must be a non-empty array/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry([]),
    /must be a non-empty array/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry([null]),
    /declaration must be an object/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry(["g1.2-task"]),
    /declaration must be an object/u,
  );
  const inheritedIdentity = Object.create({
    id: "g2.1-future-task",
    slug: "g2.1",
  });
  inheritedIdentity.label = "G2.1";
  assert.throws(
    () => buildEngineeringTaskRegistry([inheritedIdentity]),
    /declaration must define enumerable data id and slug/u,
  );
  const nonEnumerableIdentity = { label: "G2.1" };
  Object.defineProperties(nonEnumerableIdentity, {
    id: { value: "g2.1-future-task", enumerable: false },
    slug: { value: "g2.1", enumerable: false },
  });
  assert.throws(
    () => buildEngineeringTaskRegistry([nonEnumerableIdentity]),
    /declaration must define enumerable data id and slug/u,
  );
  let accessorReads = 0;
  const accessorIdentity = { label: "G2.1" };
  Object.defineProperties(accessorIdentity, {
    id: {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "g2.1-future-task";
      },
    },
    slug: {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "g2.1";
      },
    },
  });
  assert.throws(
    () => buildEngineeringTaskRegistry([accessorIdentity]),
    /declaration must define enumerable data id and slug/u,
  );
  assert.equal(accessorReads, 0);
  assert.throws(
    () => buildEngineeringTaskRegistry([...declarations, declarations[0]]),
    /duplicate engineering task id/u,
  );
  assert.throws(
    () =>
      buildEngineeringTaskRegistry([
        ...declarations,
        { ...declarations[0], id: "g1.2-another-task" },
      ]),
    /duplicate engineering task slug/u,
  );
  assert.throws(
    () =>
      buildEngineeringTaskRegistry([
        { ...declarations[0], contractPath: "/tmp/copied-contract.json" },
      ]),
    /contractPath must be derived/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry([{ ...declarations[0], id: "g01.2-task" }]),
    /id must be canonical/u,
  );
  assert.throws(
    () => buildEngineeringTaskRegistry([{ ...declarations[0], slug: "../g1.2" }]),
    /slug must be canonical/u,
  );
  assert.throws(
    () =>
      buildEngineeringTaskRegistry([
        { ...declarations[0], id: "g2.1-future-task", slug: "g2.2" },
      ]),
    /id must be prefixed by its slug/u,
  );
});

test("future canonical tasks derive their group path while lookups reject path-like input", () => {
  const seed = engineeringTaskRegistry[0];
  const { contractPath: ignored, ...declaration } = seed;
  const future = buildEngineeringTaskRegistry([
    { ...declaration, id: "g2.1-future-task", slug: "g2.1" },
  ])[0];
  assert.equal(
    future.contractPath,
    join(harnessRoot, "tasks", "g2", "g2.1", "contract.json"),
  );
  assert.throws(() => taskProfile("tasks/g1/g1.2/contract.json"), /unsupported/u);
  assert.throws(() => taskProfile("g9.9-unregistered"), /unsupported/u);
  assert.throws(() => taskProfile("toString"), /unsupported/u);
  assert.throws(() => taskProfile({ id: "__proto__" }), /unsupported/u);
  assert.throws(
    () => taskProfile(Object.create({ id: expected[0][0] })),
    /unsupported/u,
  );
  assert.throws(() => taskProfileBySlug("../g1.2"), /unsupported/u);
  assert.throws(() => taskProfileBySlug("g9.9"), /unsupported/u);
  assert.throws(() => taskProfileBySlug("toString"), /unsupported/u);
  assert.throws(() => taskProfileBySlug("__proto__"), /unsupported/u);
});
