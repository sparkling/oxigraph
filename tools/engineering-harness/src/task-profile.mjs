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
export const engineeringTaskProfiles = profiles;
