import { isAbsolute, join, relative, resolve } from "node:path";
import { types as utilTypes } from "node:util";

import { harnessRoot, isContained } from "./paths.mjs";
import { asciiFoldPathV2, validateTaskV2Path } from "./policy/paths-v2.mjs";

const TASK_ID =
  /^g(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)[a-z]?)+-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TASK_SLUG = /^g(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)[a-z]?)+$/u;
const DORMANT_TASK_V2_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const DORMANT_TASK_V2_ID_BYTES_CEILING = 128;
const DORMANT_TASK_V2_PATH_BYTES_CEILING = 4 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const DORMANT_TASK_V2_DECLARATION_KEYS = Object.freeze([
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
]);
const HARNESS_CREATE_EXACT_V2_SOURCE_ALLOWLIST = Object.freeze([
  "lib/oxigraph/tests/engineering_harness_exact_create_v2.rs",
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_created.rs",
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_present.rs",
]);

function exactOwnDataRecord(value, expectedKeys, label) {
  let descriptors;
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      throw new Error(`${label} must be a plain own-data record`);
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${label} must be a plain own-data record`
    ) {
      throw error;
    }
    throw new Error(`${label} must be a plain own-data record`);
  }
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key, index) =>
        typeof key !== "string" ||
        key !== expectedKeys[index] ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new Error(`${label} must be an exact ordered plain own-data record`);
  }
  return Object.fromEntries(
    expectedKeys.map((key) => [key, descriptors[key].value]),
  );
}

function exactOwnDataArray(value, maximum, label) {
  let descriptors;
  try {
    if (
      utilTypes.isProxy(value) ||
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      throw new Error(`${label} must be a bounded plain dense array`);
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${label} must be a bounded plain dense array`
    ) {
      throw error;
    }
    throw new Error(`${label} must be a bounded plain dense array`);
  }
  const lengthDescriptor = descriptors.length;
  const length =
    lengthDescriptor !== undefined && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    throw new Error(`${label} must be a bounded plain dense array`);
  }
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ];
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key, index) => typeof key !== "string" || key !== expectedKeys[index],
    )
  ) {
    throw new Error(`${label} must be a bounded plain dense array`);
  }
  const captured = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error(`${label} must be a bounded plain dense array`);
    }
    captured.push(descriptor.value);
  }
  return captured;
}

function componentRelated(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function exactDormantSourceAllowlist(value) {
  const captured = exactOwnDataArray(value, 256, "sourceAllowlist");
  if (captured.length === 0) {
    throw new Error("sourceAllowlist must not be empty");
  }
  const paths = captured.map((path, index) => {
    if (
      typeof path !== "string" ||
      path.length > DORMANT_TASK_V2_PATH_BYTES_CEILING ||
      Buffer.byteLength(path, "utf8") > DORMANT_TASK_V2_PATH_BYTES_CEILING
    ) {
      throw new Error(`sourceAllowlist[${index}] exceeds its byte ceiling`);
    }
    return validateTaskV2Path(path, `sourceAllowlist[${index}]`);
  });
  for (let index = 1; index < paths.length; index += 1) {
    if (
      Buffer.compare(
        Buffer.from(paths[index - 1], "ascii"),
        Buffer.from(paths[index], "ascii"),
      ) >= 0
    ) {
      throw new Error("sourceAllowlist must use canonical byte order");
    }
  }
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < paths.length;
      rightIndex += 1
    ) {
      if (
        componentRelated(paths[leftIndex], paths[rightIndex]) ||
        componentRelated(
          asciiFoldPathV2(paths[leftIndex]),
          asciiFoldPathV2(paths[rightIndex]),
        )
      ) {
        throw new Error("sourceAllowlist has a portable path collision");
      }
    }
  }
  if (
    paths.length !== HARNESS_CREATE_EXACT_V2_SOURCE_ALLOWLIST.length ||
    paths.some(
      (path, index) => path !== HARNESS_CREATE_EXACT_V2_SOURCE_ALLOWLIST[index],
    )
  ) {
    throw new Error(
      "sourceAllowlist must equal the exact dormant control surface",
    );
  }
  return Object.freeze(paths);
}

export function buildDormantEngineeringTaskV2Registry(declarations) {
  const capturedDeclarations = exactOwnDataArray(
    declarations,
    64,
    "dormant engineering task v2 registry",
  );
  if (capturedDeclarations.length === 0) {
    throw new Error("dormant engineering task v2 registry must not be empty");
  }
  const ids = new Set();
  const slugs = new Set();
  const contractPaths = new Set();
  const registry = capturedDeclarations.map((value) => {
    const declaration = exactOwnDataRecord(
      value,
      DORMANT_TASK_V2_DECLARATION_KEYS,
      "dormant engineering task v2 declaration",
    );
    const { id, slug } = declaration;
    if (
      typeof id !== "string" ||
      id.length > DORMANT_TASK_V2_ID_BYTES_CEILING ||
      !DORMANT_TASK_V2_ID.test(id)
    ) {
      throw new Error("dormant engineering task v2 id must be canonical");
    }
    if (
      typeof slug !== "string" ||
      slug.length > DORMANT_TASK_V2_ID_BYTES_CEILING ||
      !DORMANT_TASK_V2_ID.test(slug)
    ) {
      throw new Error("dormant engineering task v2 slug must be canonical");
    }
    if (!id.startsWith(`${slug}-`)) {
      throw new Error(
        `dormant engineering task v2 id must be prefixed by its slug: ${id}`,
      );
    }
    if (ids.has(id)) {
      throw new Error(`duplicate dormant engineering task v2 id: ${id}`);
    }
    if (slugs.has(slug)) {
      throw new Error(`duplicate dormant engineering task v2 slug: ${slug}`);
    }
    if (
      id !== "harness-create-exact-v2-control" ||
      slug !== "harness-create-exact-v2" ||
      declaration.label !== "HARNESS-CREATE-EXACT V2" ||
      declaration.decision !== "ADR-0034" ||
      declaration.taskClass !== "harness-exact-create-control" ||
      declaration.registrationMode !== "dormant-control" ||
      declaration.taskSchemaVersion !== 2 ||
      declaration.executionGate !== "native-containment-qualification-v1" ||
      declaration.productAuthority !== false
    ) {
      throw new Error("dormant engineering task v2 authority must be exact");
    }
    if (
      typeof declaration.contractRawSha256 !== "string" ||
      !SHA256.test(declaration.contractRawSha256) ||
      declaration.contractRawSha256 !==
        "58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489ad"
    ) {
      throw new Error(
        "dormant engineering task v2 contract digest must be canonical",
      );
    }
    const sourceAllowlist = exactDormantSourceAllowlist(
      declaration.sourceAllowlist,
    );
    const canonicalRelativePath = join("tasks", "v2", slug, "contract.json");
    const contractPath = join(harnessRoot, canonicalRelativePath);
    if (
      !isAbsolute(contractPath) ||
      resolve(contractPath) !== contractPath ||
      !isContained(harnessRoot, contractPath) ||
      relative(harnessRoot, contractPath) !== canonicalRelativePath
    ) {
      throw new Error(
        `dormant engineering task v2 contract path is not canonical: ${id}`,
      );
    }
    if (contractPaths.has(contractPath)) {
      throw new Error(
        `duplicate dormant engineering task v2 contract path: ${contractPath}`,
      );
    }
    ids.add(id);
    slugs.add(slug);
    contractPaths.add(contractPath);
    return Object.freeze({ ...declaration, sourceAllowlist, contractPath });
  });
  return Object.freeze(registry);
}

export function buildEngineeringTaskRegistry(declarations) {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    throw new Error("engineering task registry must be a non-empty array");
  }
  const ids = new Set();
  const slugs = new Set();
  const contractPaths = new Set();
  const registry = declarations.map((declaration) => {
    if (
      declaration === null ||
      typeof declaration !== "object" ||
      Array.isArray(declaration)
    ) {
      throw new Error("engineering task declaration must be an object");
    }
    if (Object.hasOwn(declaration, "contractPath")) {
      throw new Error("engineering task contractPath must be derived");
    }
    const idDescriptor = Object.getOwnPropertyDescriptor(declaration, "id");
    const slugDescriptor = Object.getOwnPropertyDescriptor(declaration, "slug");
    if (
      idDescriptor?.enumerable !== true ||
      !Object.hasOwn(idDescriptor, "value") ||
      slugDescriptor?.enumerable !== true ||
      !Object.hasOwn(slugDescriptor, "value")
    ) {
      throw new Error(
        "engineering task declaration must define enumerable data id and slug",
      );
    }
    const { id, slug } = declaration;
    if (typeof id !== "string" || !TASK_ID.test(id)) {
      throw new Error("engineering task id must be canonical");
    }
    if (typeof slug !== "string" || !TASK_SLUG.test(slug)) {
      throw new Error("engineering task slug must be canonical");
    }
    if (ids.has(id)) throw new Error(`duplicate engineering task id: ${id}`);
    if (slugs.has(slug))
      throw new Error(`duplicate engineering task slug: ${slug}`);
    if (!id.startsWith(`${slug}-`)) {
      throw new Error(
        `engineering task id must be prefixed by its slug: ${id}`,
      );
    }

    const taskGroup = slug.slice(0, slug.indexOf("."));
    const canonicalRelativePath = join(
      "tasks",
      taskGroup,
      slug,
      "contract.json",
    );
    const contractPath = join(harnessRoot, canonicalRelativePath);
    if (
      !isAbsolute(contractPath) ||
      resolve(contractPath) !== contractPath ||
      !isContained(harnessRoot, contractPath) ||
      relative(harnessRoot, contractPath) !== canonicalRelativePath
    ) {
      throw new Error(`engineering task contract path is not canonical: ${id}`);
    }
    if (contractPaths.has(contractPath)) {
      throw new Error(
        `duplicate engineering task contract path: ${contractPath}`,
      );
    }

    ids.add(id);
    slugs.add(slug);
    contractPaths.add(contractPath);
    return Object.freeze({ ...declaration, contractPath });
  });
  return Object.freeze(registry);
}

export const engineeringTaskRegistry = buildEngineeringTaskRegistry([
  {
    id: "g1.2-rocksdb-serialized-writers",
    slug: "g1.2",
    label: "G1.2",
    decision: "ADR-0018",
    taskClass: "transaction-concurrency",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/tests/transaction_concurrency.rs",
    ]),
  },
  {
    id: "g1.3-transaction-capabilities",
    slug: "g1.3",
    label: "G1.3",
    decision: "ADR-0018",
    taskClass: "transaction-capabilities",
    evaluatorChangeStatus: "M",
    mutablePath: "lib/oxigraph/src/store.rs",
    guidance:
      "Keep the legacy WritableDataset and TransactionalDataset traits byte-identical. Add the capability and outcome vocabulary in store.rs, negotiate every requirement before opening a backend transaction, advertise conservative constructor-specific Store profiles, and do not implement OutcomeAwareWritableDataset for Store because its current storage error cannot prove a non-commit versus an indeterminate commit.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/store/transactional.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/tests/transaction_capabilities.rs",
    ]),
  },
  {
    id: "g1.4-bounded-writer-admission",
    slug: "g1.4",
    label: "G1.4",
    decision: "ADR-0018",
    taskClass: "writer-admission",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/store.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/storage/memory.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    ]),
    guidance:
      "Preserve the legacy transaction path and the conservative cancellation capability claim. Add typed timeout/cancellation only to transaction admission, observe controls while queued, acquire before snapshot creation, and hold the existing per-instance writer permit through commit, rollback, or drop.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/storage/memory.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
      "lib/oxigraph/tests/rocksdb_writer_serialization.rs",
      "lib/oxigraph/tests/transaction_concurrency.rs",
    ]),
  },
  {
    id: "g1.4a-store-terminal-outcomes",
    slug: "g1.4a",
    label: "G1.4a",
    decision: "ADR-0018",
    taskClass: "transaction-terminal-outcomes",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/store.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/storage/memory.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    ]),
    guidance:
      "Preserve every legacy transaction signature and impose outcome-ledger cost only on the explicit caller-keyed path. Add non-exhaustive public terminal outcome and non-commit reason types, stable TransactionKey byte access, and an additive OutcomeAwareTransactionalDataset extension whose keyed transaction type implements OutcomeAwareWritableDataset without forcing the legacy unkeyed Transaction to manufacture a recovery key. Use the same in-process state oracle for memory without claiming durability; only read-write RocksDB advertises DurableByTransactionKey, while read-only RocksDB may resolve existing keys. Reserve each key as Staging under the existing writer gate, reject reuse before a second attempt, durably record exactly one CommitAttempted transition, and atomically publish RDF changes with Committed in one synchronous final batch. Explicit rollback and ordinary drop resolve as ProvenAbsent(RolledBack); unseen, staging, and commit-attempted keys resolve as Indeterminate. Store versioned ledger records under a reserved prefix in the existing default column family, fail closed on unknown encodings, never replay effects to discover an outcome, and leave receipts, outbox delivery, and retention to ADR-0020.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/storage/memory.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
      "lib/oxigraph/tests/transaction_outcomes.rs",
      "lib/oxigraph/tests/transaction_capabilities.rs",
      "lib/oxigraph/tests/transaction_compatibility.rs",
      "lib/oxigraph/tests/transaction_state_model.rs",
      "lib/oxigraph/tests/update_atomicity.rs",
    ]),
  },
  {
    id: "g1.4b-outcome-fault-safety",
    slug: "g1.4b",
    label: "G1.4b",
    decision: "ADR-0018",
    taskClass: "transaction-outcome-fault-safety",
    evaluatorChangeStatus: "M",
    mutablePath: "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    guidance:
      "Preserve the durable transaction-outcome encoding and change only fault-phase monotonicity. Once commit attempt begins, advance the in-memory phase to CommitAttempted before the durable marker call so pre- and post-write marker errors can never let Drop append RolledBack; keep Staging and CommitAttempted lookup Indeterminate, publish Committed atomically with effects, and maintain exactly one attempt plus one final batch without claiming crash, power-loss, or fsync proof.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/src/storage/rocksdb.rs",
      "lib/oxigraph/src/store/transaction_outcome_faults.rs",
      "lib/oxigraph/tests/transaction_outcomes.rs",
      "lib/oxigraph/tests/transaction_compatibility.rs",
    ]),
  },
  {
    id: "g1.5-unified-egress-policy",
    slug: "g1.5",
    label: "G1.5",
    decision: "ADR-0019",
    taskClass: "egress-policy",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/http.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/http.rs",
      "lib/oxigraph/src/io/loader.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/sparql/http.rs",
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/Cargo.toml",
    ]),
    guidance:
      "Implement one shared, deny-by-default policy for SERVICE, LOAD, and nested document retrieval. The first qualified profile accepts literal-IP HTTP origins only, requires a separately allowed IP, rejects credentials and redirects before secondary connections, bounds encoded and decoded bodies plus concurrent requests, preserves typed causes, and observes cancellation before connection and throughout LOAD staging without weakening update atomicity.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/http.rs",
      "lib/oxigraph/src/io/loader.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/sparql/http.rs",
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/Cargo.toml",
      "lib/oxigraph/tests/sparql_egress_policy.rs",
      "lib/oxigraph/tests/sparql_service_http.rs",
      "lib/oxigraph/tests/sparql_update_load_http.rs",
    ]),
  },
  {
    id: "g1.5b-update-cancellation",
    slug: "g1.5b",
    label: "G1.5b",
    decision: "ADR-0019",
    taskClass: "update-cancellation",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/sparql/update.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/src/sparql/error.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/storage/mod.rs",
    ]),
    guidance:
      "Expose one typed UpdateEvaluationError::Cancelled outcome and carry the existing CancellationToken through local SPARQL UPDATE execution. Observe cancellation before validation and transaction admission, while queued at the serialized RocksDB writer gate, and throughout each mutation phase. Roll back staged work, perform no mutation after cancellation is observed, and preserve the qualified writer-admission and egress-policy contracts.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/src/sparql/error.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/storage/mod.rs",
      "lib/oxigraph/tests/sparql_update_cancellation.rs",
      "lib/oxigraph/tests/rocksdb_writer_serialization.rs",
      "lib/oxigraph/tests/sparql_egress_policy.rs",
    ]),
  },
  {
    id: "g1.5c-negotiated-update",
    slug: "g1.5c",
    label: "G1.5c",
    decision: "ADR-0019",
    taskClass: "negotiated-update-admission",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/sparql/update.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/store.rs",
    ]),
    guidance:
      "Add a backend-neutral negotiated SPARQL UPDATE binding without changing the minimal TransactionalDataset or WritableDataset traits. Carry the caller's exact TransactionRequest and evaluator CancellationToken through NegotiatedTransactionalDataset::start_transaction_with_control, reject unmet requirements before opening a transaction, preserve typed start errors, and commit or explicitly roll back the complete owned update. Keep the legacy on_dataset binding compatible and preserve Store writer admission, update cancellation, and unified egress behavior.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/sparql/update.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/oxigraph/src/store.rs",
      "lib/oxigraph/tests/sparql_negotiated_update.rs",
      "lib/oxigraph/tests/transaction_capabilities.rs",
      "lib/oxigraph/tests/rocksdb_writer_serialization.rs",
      "lib/oxigraph/tests/sparql_update_cancellation.rs",
      "lib/oxigraph/tests/sparql_egress_policy.rs",
      "lib/oxigraph/tests/transactional_dataset.rs",
    ]),
  },
  {
    id: "g1.6-runtime-derived-service-claims",
    slug: "g1.6",
    label: "G1.6",
    decision: "ADR-0019",
    taskClass: "runtime-service-capabilities",
    evaluatorChangeStatus: "A",
    mutablePath: "lib/oxigraph/src/http.rs",
    mutablePaths: Object.freeze([
      "lib/oxigraph/src/http.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "cli/src/service_description.rs",
      "cli/src/main.rs",
    ]),
    guidance:
      "Expose a deterministic immutable snapshot of effective runtime remote capabilities. Derive explicit custom default SERVICE support directly from QueryEvaluator::has_default_service_handler(). Do not shadow that authority in SparqlEvaluator state. Treat named-only handlers as insufficient. Derive built-in SERVICE and LOAD from the owning oxigraph/http-client feature and the effective egress policy: the legacy absent policy remains permissive, while an explicit policy enables remote capability only when it contains a matching literal origin/IP pair supported by the compiled transport. Service-description claims must not mirror CLI TLS cfg values: derive BasicFederatedQuery and input formats only from the passed evaluator snapshot, and disclose UnionDefaultGraph for query and update endpoints only when union-default evaluation is enabled. Construct the server evaluator unconditionally with the always-available deny-all wrapper, whose implementation is keyed to the owning library feature, and reuse that evaluator for query, update, and service descriptions; keep standalone CLI query/update permissive, preserve base/version/cancellation, and perform no DNS or network probe.",
    sourceAllowlist: Object.freeze([
      "lib/oxigraph/src/http.rs",
      "lib/oxigraph/src/sparql/mod.rs",
      "lib/spareval/src/lib.rs",
      "cli/src/service_description.rs",
      "cli/src/main.rs",
      "cli/src/service_description/tests.rs",
      "lib/oxigraph/tests/sparql_effective_capabilities.rs",
      "lib/oxigraph/tests/sparql_version.rs",
      "lib/oxigraph/tests/sparql_egress_policy.rs",
    ]),
  },
]);

export const dormantEngineeringTaskV2Registry =
  buildDormantEngineeringTaskV2Registry([
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
        "lib/oxigraph/tests/engineering_harness_exact_create_v2_created.rs",
        "lib/oxigraph/tests/engineering_harness_exact_create_v2_present.rs",
      ],
    },
  ]);

const profiles = Object.freeze(
  Object.fromEntries(engineeringTaskRegistry.map((entry) => [entry.id, entry])),
);
const profilesBySlug = Object.freeze(
  Object.fromEntries(
    engineeringTaskRegistry.map((entry) => [entry.slug, entry]),
  ),
);
const dormantProfilesV2 = new Map(
  dormantEngineeringTaskV2Registry.map((entry) => [entry.id, entry]),
);
const dormantProfilesV2BySlug = new Map(
  dormantEngineeringTaskV2Registry.map((entry) => [entry.slug, entry]),
);

export const engineeringTaskIds = Object.freeze(
  engineeringTaskRegistry.map(({ id }) => id),
);
export const dormantEngineeringTaskV2Ids = Object.freeze(
  dormantEngineeringTaskV2Registry.map(({ id }) => id),
);

export function taskProfile(value) {
  const id =
    typeof value === "string"
      ? value
      : value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.hasOwn(value, "id")
        ? value.id
        : undefined;
  if (
    typeof id !== "string" ||
    !TASK_ID.test(id) ||
    !Object.hasOwn(profiles, id)
  ) {
    throw new Error(`unsupported engineering task: ${id ?? "<missing>"}`);
  }
  return profiles[id];
}

export function taskProfileBySlug(slug) {
  if (
    typeof slug !== "string" ||
    !TASK_SLUG.test(slug) ||
    !Object.hasOwn(profilesBySlug, slug)
  ) {
    throw new Error(
      `unsupported engineering task slug: ${slug ?? "<missing>"}`,
    );
  }
  return profilesBySlug[slug];
}

function dormantTaskV2LookupId(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return undefined;
  try {
    if (
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

export function taskV2Profile(value) {
  const id = dormantTaskV2LookupId(value);
  if (
    typeof id !== "string" ||
    id.length > DORMANT_TASK_V2_ID_BYTES_CEILING ||
    !DORMANT_TASK_V2_ID.test(id) ||
    !dormantProfilesV2.has(id)
  ) {
    throw new Error("unsupported dormant engineering task v2");
  }
  return dormantProfilesV2.get(id);
}

export function taskV2ProfileBySlug(slug) {
  if (
    typeof slug !== "string" ||
    slug.length > DORMANT_TASK_V2_ID_BYTES_CEILING ||
    !DORMANT_TASK_V2_ID.test(slug) ||
    !dormantProfilesV2BySlug.has(slug)
  ) {
    throw new Error("unsupported dormant engineering task v2 slug");
  }
  return dormantProfilesV2BySlug.get(slug);
}

export const g12Profile = profiles["g1.2-rocksdb-serialized-writers"];
export const g13Profile = profiles["g1.3-transaction-capabilities"];
export const g14Profile = profiles["g1.4-bounded-writer-admission"];
export const g14aProfile = profiles["g1.4a-store-terminal-outcomes"];
export const g14bProfile = profiles["g1.4b-outcome-fault-safety"];
export const g15Profile = profiles["g1.5-unified-egress-policy"];
export const g15bProfile = profiles["g1.5b-update-cancellation"];
export const g15cProfile = profiles["g1.5c-negotiated-update"];
export const g16Profile = profiles["g1.6-runtime-derived-service-claims"];
export const harnessCreateExactV2Profile = dormantProfilesV2.get(
  "harness-create-exact-v2-control",
);
export const engineeringTaskProfiles = profiles;
