import { isAbsolute, join, relative, resolve } from "node:path";

import { harnessRoot, isContained } from "./paths.mjs";

const TASK_ID = /^g(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)[a-z]?)+-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TASK_SLUG = /^g(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)[a-z]?)+$/u;

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
    if (slugs.has(slug)) throw new Error(`duplicate engineering task slug: ${slug}`);
    if (!id.startsWith(`${slug}-`)) {
      throw new Error(`engineering task id must be prefixed by its slug: ${id}`);
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
      throw new Error(`duplicate engineering task contract path: ${contractPath}`);
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

const profiles = Object.freeze(
  Object.fromEntries(engineeringTaskRegistry.map((entry) => [entry.id, entry])),
);
const profilesBySlug = Object.freeze(
  Object.fromEntries(engineeringTaskRegistry.map((entry) => [entry.slug, entry])),
);

export const engineeringTaskIds = Object.freeze(
  engineeringTaskRegistry.map(({ id }) => id),
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
  if (typeof id !== "string" || !TASK_ID.test(id) || !Object.hasOwn(profiles, id)) {
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
    throw new Error(`unsupported engineering task slug: ${slug ?? "<missing>"}`);
  }
  return profilesBySlug[slug];
}

export const g12Profile = profiles["g1.2-rocksdb-serialized-writers"];
export const g13Profile = profiles["g1.3-transaction-capabilities"];
export const g14Profile = profiles["g1.4-bounded-writer-admission"];
export const g15Profile = profiles["g1.5-unified-egress-policy"];
export const g15bProfile = profiles["g1.5b-update-cancellation"];
export const g15cProfile = profiles["g1.5c-negotiated-update"];
export const g16Profile = profiles["g1.6-runtime-derived-service-claims"];
export const engineeringTaskProfiles = profiles;
