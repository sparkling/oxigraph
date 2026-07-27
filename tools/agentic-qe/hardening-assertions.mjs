import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createDurableDirectory } from "./atomic-json.mjs";
import {
  assertDirectorySnapshot,
  captureDirectorySnapshot,
} from "./file-safety.mjs";
import { repoRoot } from "./path-policy.mjs";
import { readAgenticFileBytes } from "./publication.mjs";

export function assertAtomicDirectoryHardening(directory) {
  const runs = join(directory, "durable-runs");
  mkdirSync(runs);
  const run = join(runs, randomUUID());
  assert.equal(createDurableDirectory(run), realpathSync(run));
  assert.throws(
    () => createDurableDirectory(run),
    /refusing to replace immutable publication directory/,
  );

  const watched = join(directory, "watched-parent");
  const original = join(directory, "watched-parent-original");
  mkdirSync(watched);
  const snapshot = captureDirectorySnapshot(watched, {
    repositoryRoot: repoRoot,
    expectedEntries: [],
    label: "test publication parent",
  });
  renameSync(watched, original);
  mkdirSync(watched);
  try {
    assert.throws(
      () =>
        assertDirectorySnapshot(snapshot, {
          repositoryRoot: repoRoot,
          expectedEntries: [],
          label: "test publication parent",
        }),
      /changed during use/,
    );
  } finally {
    rmSync(watched, { recursive: true });
    renameSync(original, watched);
  }
}

export function assertPublicationHardening(
  receipt,
  publicationDirectory,
  validatePublication,
) {
  const unexpected = join(publicationDirectory, "unexpected.json");
  writeFileSync(unexpected, "{}\n");
  try {
    assert.throws(
      () => validatePublication(receipt),
      /contains unexpected files/,
    );
  } finally {
    unlinkSync(unexpected);
  }

  const oracle = join(publicationDirectory, "oracle.json");
  const alias = join(
    dirname(publicationDirectory),
    `.oracle-hardlink-${randomUUID()}`,
  );
  linkSync(oracle, alias);
  try {
    assert.throws(
      () => validatePublication(receipt),
      /not a regular file with one stable path/,
    );
  } finally {
    unlinkSync(alias);
  }
}

export function assertArchiveHardening(receipt, validateArchive) {
  const root = join(repoRoot, receipt.artifacts.archive.root);
  const first = receipt.artifacts.archive.files[0];
  const bytes = readAgenticFileBytes(first.path);
  assert.equal(bytes.length, first.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), first.sha256);
  const unexpected = join(root, "unexpected.bin");
  writeFileSync(unexpected, "unexpected\n");
  try {
    assert.throws(
      () => validateArchive(receipt),
      /contains unexpected files/,
    );
  } finally {
    unlinkSync(unexpected);
  }

  const artifact = join(repoRoot, receipt.artifacts.archive.files[0].path);
  const alias = join(dirname(root), `.artifact-hardlink-${randomUUID()}`);
  linkSync(artifact, alias);
  try {
    assert.throws(
      () => validateArchive(receipt),
      /not a regular file with one stable path/,
    );
  } finally {
    unlinkSync(alias);
  }
}
