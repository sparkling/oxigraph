import { join } from "node:path";

import { harnessRoot } from "./paths.mjs";

function profile(value) {
  return Object.freeze({
    ...value,
    contractPath: join(harnessRoot, "tasks", "g1", value.slug, "contract.json"),
  });
}

const profiles = Object.freeze({
  "g1.2-rocksdb-serialized-writers": profile({
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
  }),
  "g1.3-transaction-capabilities": profile({
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
  }),
  "g1.4-bounded-writer-admission": profile({
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
  }),
  "g1.5-unified-egress-policy": profile({
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
  }),
  "g1.5b-update-cancellation": profile({
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
  }),
});

export function taskProfile(value) {
  const id = typeof value === "string" ? value : value?.id;
  const profile = profiles[id];
  if (profile === undefined) {
    throw new Error(`unsupported engineering task: ${id ?? "<missing>"}`);
  }
  return profile;
}

export const g12Profile = profiles["g1.2-rocksdb-serialized-writers"];
export const g13Profile = profiles["g1.3-transaction-capabilities"];
export const g14Profile = profiles["g1.4-bounded-writer-admission"];
export const g15Profile = profiles["g1.5-unified-egress-policy"];
export const g15bProfile = profiles["g1.5b-update-cancellation"];
export const engineeringTaskProfiles = profiles;
