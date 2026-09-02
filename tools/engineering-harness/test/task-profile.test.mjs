import assert from "node:assert/strict";
import { join, relative } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { harnessRoot, repositoryRoot } from "../src/paths.mjs";
import {
  buildDormantEngineeringTaskV2Registry,
  buildEngineeringTaskRegistry,
  dormantEngineeringTaskV2Ids,
  dormantEngineeringTaskV2Registry,
  engineeringTaskIds,
  engineeringTaskRegistry,
  harnessCreateExactV2Profile,
  taskProfile,
  taskProfileBySlug,
  taskV2Profile,
  taskV2ProfileBySlug,
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
const createdPath =
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_created.rs";
const presentPath =
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_present.rs";

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function dormantDeclaration() {
  const { contractPath, ...declaration } = harnessCreateExactV2Profile;
  return declaration;
}

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
  assert.deepEqual(
    engineeringTaskIds,
    expected.map(([id]) => id),
  );
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
  const declarations = engineeringTaskRegistry.map(
    ({ contractPath, ...entry }) => entry,
  );
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
    () =>
      buildEngineeringTaskRegistry([{ ...declarations[0], id: "g01.2-task" }]),
    /id must be canonical/u,
  );
  assert.throws(
    () =>
      buildEngineeringTaskRegistry([{ ...declarations[0], slug: "../g1.2" }]),
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
  assert.throws(
    () => taskProfile("tasks/g1/g1.2/contract.json"),
    /unsupported/u,
  );
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

test("dormant schema-v2 registry is exact, separate, and non-product", () => {
  assert.equal(engineeringTaskIds.length, 9);
  assert.equal(
    engineeringTaskIds.some((id) => /g2\.2/u.test(id)),
    false,
  );
  assert.deepEqual(dormantEngineeringTaskV2Ids, [
    "harness-create-exact-v2-control",
  ]);
  assert.equal(dormantEngineeringTaskV2Registry.length, 1);
  assert.equal(
    dormantEngineeringTaskV2Registry[0],
    harnessCreateExactV2Profile,
  );
  assert.deepEqual(Reflect.ownKeys(harnessCreateExactV2Profile), [
    "id",
    "slug",
    "label",
    "decision",
    "taskClass",
    "registrationMode",
    "taskSchemaVersion",
    "executionGate",
    "productAuthority",
    "contractRawSha256",
    "sourceAllowlist",
    "contractPath",
  ]);
  assert.deepEqual(
    {
      id: harnessCreateExactV2Profile.id,
      slug: harnessCreateExactV2Profile.slug,
      label: harnessCreateExactV2Profile.label,
      decision: harnessCreateExactV2Profile.decision,
      taskClass: harnessCreateExactV2Profile.taskClass,
      registrationMode: harnessCreateExactV2Profile.registrationMode,
      taskSchemaVersion: harnessCreateExactV2Profile.taskSchemaVersion,
      executionGate: harnessCreateExactV2Profile.executionGate,
      productAuthority: harnessCreateExactV2Profile.productAuthority,
      contractRawSha256: harnessCreateExactV2Profile.contractRawSha256,
      sourceAllowlist: harnessCreateExactV2Profile.sourceAllowlist,
    },
    {
      id: "harness-create-exact-v2-control",
      slug: "harness-create-exact-v2",
      label: "HARNESS-CREATE-EXACT V2",
      decision: "ADR-0034",
      taskClass: "harness-exact-create-control",
      registrationMode: "dormant-control",
      taskSchemaVersion: 2,
      executionGate: "native-containment-qualification-v1",
      productAuthority: false,
      contractRawSha256:
        "58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489ad",
      sourceAllowlist: [
        "lib/oxigraph/tests/engineering_harness_exact_create_v2.rs",
        createdPath,
        presentPath,
      ],
    },
  );
  assert.equal(
    relative(repositoryRoot, harnessCreateExactV2Profile.contractPath),
    "tools/engineering-harness/tasks/v2/harness-create-exact-v2/contract.json",
  );
  assert.equal(
    harnessCreateExactV2Profile.contractPath,
    join(
      harnessRoot,
      "tasks",
      "v2",
      "harness-create-exact-v2",
      "contract.json",
    ),
  );
  assert.equal(
    taskV2Profile(harnessCreateExactV2Profile.id),
    harnessCreateExactV2Profile,
  );
  assert.equal(
    taskV2Profile(harnessCreateExactV2Profile),
    harnessCreateExactV2Profile,
  );
  assert.equal(
    taskV2ProfileBySlug(harnessCreateExactV2Profile.slug),
    harnessCreateExactV2Profile,
  );
  assert.throws(
    () => taskProfile(harnessCreateExactV2Profile.id),
    /unsupported/u,
  );
  assert.throws(
    () => taskProfileBySlug(harnessCreateExactV2Profile.slug),
    /unsupported/u,
  );
  assert.throws(() => taskV2Profile(engineeringTaskIds[0]), /unsupported/u);
  assert.throws(() => taskV2ProfileBySlug("g1.2"), /unsupported/u);
  assert.throws(() => taskV2Profile("g2.2-product"), /unsupported/u);
  assert.throws(() => taskV2ProfileBySlug("g2.2"), /unsupported/u);
  assertDeepFrozen(dormantEngineeringTaskV2Registry);
  assertDeepFrozen(harnessCreateExactV2Profile);
});

test("dormant schema-v2 registry rejects hostile or broadened authority trap-free", () => {
  const valid = dormantDeclaration();
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry(undefined),
    /plain dense array/u,
  );
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([]),
    /must not be empty/u,
  );

  let traps = 0;
  const hostileDeclarations = new Proxy([], {
    get() {
      traps += 1;
      throw new Error("declaration array trap");
    },
    ownKeys() {
      traps += 1;
      throw new Error("declaration array trap");
    },
  });
  const hostileDeclaration = new Proxy(valid, {
    getOwnPropertyDescriptor() {
      traps += 1;
      throw new Error("declaration trap");
    },
    ownKeys() {
      traps += 1;
      throw new Error("declaration trap");
    },
  });
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry(hostileDeclarations),
    /plain dense array/u,
  );
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([hostileDeclaration]),
    /plain own-data record/u,
  );
  assert.equal(traps, 0);

  const sparse = new Array(2);
  sparse[1] = valid;
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry(sparse),
    /plain dense array/u,
  );
  class AuthorityArray extends Array {}
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry(new AuthorityArray(valid)),
    /plain dense array/u,
  );
  const foreignArray = runInNewContext("[null]");
  foreignArray[0] = valid;
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry(foreignArray),
    /plain dense array/u,
  );
  const foreign = Object.assign(Object.create({ inherited: true }), valid);
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([foreign]),
    /plain own-data record/u,
  );
  const foreignRealmDeclaration = runInNewContext("({})");
  Object.assign(foreignRealmDeclaration, valid);
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([foreignRealmDeclaration]),
    /plain own-data record/u,
  );
  const symbol = { ...valid };
  symbol[Symbol("authority")] = true;
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([symbol]),
    /exact ordered/u,
  );
  const hidden = { ...valid };
  Object.defineProperty(hidden, "hiddenAuthority", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([hidden]),
    /exact ordered/u,
  );

  let getterCalls = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "label", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.label;
    },
  });
  const sourceAccessor = [];
  Object.defineProperty(sourceAccessor, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return createdPath;
    },
  });
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([accessor]),
    /plain own-data record/u,
  );
  assert.throws(
    () =>
      buildDormantEngineeringTaskV2Registry([
        { ...valid, sourceAllowlist: sourceAccessor },
      ]),
    /plain dense array/u,
  );
  assert.equal(getterCalls, 0);

  const sourceAllowlistMutants = [
    valid.sourceAllowlist.slice(0, -1),
    [...valid.sourceAllowlist, "lib/oxigraph/tests/z_extra_v2.rs"],
    [...valid.sourceAllowlist].reverse(),
    ["lib/oxigraph/src/store.rs", createdPath, presentPath],
    ["lib/oxigraph/Cargo.toml", createdPath, presentPath],
    [
      "docs/adr/0034-first-class-exact-new-file-admission.md",
      createdPath,
      presentPath,
    ],
    ["a".repeat(5_000)],
  ];
  for (const sourceAllowlist of sourceAllowlistMutants) {
    assert.throws(() =>
      buildDormantEngineeringTaskV2Registry([{ ...valid, sourceAllowlist }]),
    );
  }

  for (const invalid of [
    { ...valid, contractPath: "/tmp/forged-contract.json" },
    { ...valid, productAuthority: true },
    { ...valid, registrationMode: "active" },
    { ...valid, taskSchemaVersion: 1 },
    { ...valid, executionGate: "caller-selected" },
    { ...valid, id: "g2.2-product" },
    { ...valid, slug: "../escape" },
    { ...valid, contractRawSha256: "0".repeat(64) },
    {
      ...valid,
      contractRawSha256:
        "58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489a0",
    },
  ]) {
    assert.throws(() => buildDormantEngineeringTaskV2Registry([invalid]));
  }
  assert.throws(
    () => buildDormantEngineeringTaskV2Registry([valid, valid]),
    /duplicate dormant engineering task v2 id/u,
  );

  const aliasedDeclaration = dormantDeclaration();
  const aliasedSourceAllowlist = [...aliasedDeclaration.sourceAllowlist];
  aliasedDeclaration.sourceAllowlist = aliasedSourceAllowlist;
  const copied = buildDormantEngineeringTaskV2Registry([aliasedDeclaration])[0];
  aliasedDeclaration.label = "mutated after construction";
  aliasedSourceAllowlist[0] = "lib/oxigraph/tests/attacker.rs";
  assert.equal(copied.label, "HARNESS-CREATE-EXACT V2");
  assert.equal(
    copied.sourceAllowlist[0],
    "lib/oxigraph/tests/engineering_harness_exact_create_v2.rs",
  );
  assert.notEqual(copied.sourceAllowlist, aliasedSourceAllowlist);

  const lookupAccessor = {};
  Object.defineProperty(lookupAccessor, "id", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.id;
    },
  });
  const lookupProxy = new Proxy(
    { id: valid.id },
    {
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("lookup descriptor trap");
      },
    },
  );
  assert.throws(() => taskV2Profile(lookupAccessor), /unsupported/u);
  assert.throws(() => taskV2Profile(lookupProxy), /unsupported/u);
  assert.throws(
    () => taskV2Profile(Object.create({ id: valid.id })),
    /unsupported/u,
  );
  assert.equal(getterCalls, 0);
  assert.equal(traps, 0);

  const oversizedIdentifier = "a".repeat(1_000_000);
  for (const lookup of [
    () => taskV2Profile(oversizedIdentifier),
    () => taskV2ProfileBySlug(oversizedIdentifier),
  ]) {
    let error;
    try {
      lookup();
    } catch (value) {
      error = value;
    }
    assert.equal(error instanceof Error, true);
    assert.equal(error.message.length < 128, true);
    assert.equal(
      error.message.includes(oversizedIdentifier.slice(0, 256)),
      false,
    );
  }
});
