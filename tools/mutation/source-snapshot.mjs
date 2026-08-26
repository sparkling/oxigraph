import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  isInside,
  portable,
  readStableFileBytes,
} from "./path-policy.mjs";

const requiredProtectedRoots = [
  "Cargo.lock",
  "Cargo.toml",
  "lib",
  "tools/mutation",
];
const optionalProtectedRoots = [
  ".cargo",
  "rust-toolchain",
  "rust-toolchain.toml",
  "rustfmt.toml",
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// ECMAScript relational string comparison is defined over UTF-16 code units.
// Keep owner and verifier ordering independent of host locale and separators.
export function comparePortablePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function portableRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every(
      (component) =>
        component.length > 0 && component !== "." && component !== "..",
    )
  );
}

export function executableProvenance(program, versionArguments) {
  const locator = process.platform === "win32" ? "where" : "which";
  const invokedPath = execFileSync(locator, [program], {
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/, 1)[0];
  const path = realpathSync(invokedPath);
  const provenance = {
    program,
    invokedPath,
    path,
    executableSha256: sha256(readFileSync(path)),
    version: execFileSync(program, versionArguments, {
      encoding: "utf8",
    }).trim(),
  };
  if (
    (program === "cargo" || program === "rustc") &&
    /^rustup(?:\.exe)?$/i.test(basename(path))
  ) {
    const toolchainPath = realpathSync(
      execFileSync("rustup", ["which", program], {
        encoding: "utf8",
      }).trim(),
    );
    provenance.toolchainPath = toolchainPath;
    provenance.toolchainExecutableSha256 = sha256(readFileSync(toolchainPath));
  }
  return provenance;
}

export function currentRuntimeProvenance() {
  return [
    executableProvenance("cargo", ["--version", "--verbose"]),
    executableProvenance("cargo-mutants", ["mutants", "--version"]),
    executableProvenance("rustc", ["--version", "--verbose"]),
  ];
}

function inputFiles(path, output) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`protected input must not be a symbolic link: ${path}`);
  }
  if (metadata.isFile()) {
    output.push(path);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`unsupported protected input: ${path}`);
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    comparePortablePaths(a.name, b.name),
  )) {
    inputFiles(join(path, entry.name), output);
  }
}

function protectedRoots(root) {
  const roots = [...requiredProtectedRoots];
  for (const path of optionalProtectedRoots) {
    if (existsSync(join(root, path))) roots.push(path);
  }
  return roots.sort(comparePortablePaths);
}

export function snapshotProtectedInputs(
  root,
  roots = protectedRoots(root),
) {
  const canonicalRoot = realpathSync(root);
  const orderedRoots = [...roots].sort(comparePortablePaths);
  if (
    orderedRoots.length === 0 ||
    orderedRoots.some((input) => !portableRelativePath(input))
  ) {
    throw new Error("protected input roots contain an unsafe path");
  }
  if (new Set(orderedRoots).size !== orderedRoots.length) {
    throw new Error("protected input roots contain duplicates");
  }
  const files = [];
  for (const input of orderedRoots) {
    const lexical = resolve(canonicalRoot, input);
    if (!isInside(canonicalRoot, lexical)) {
      throw new Error(`protected input escapes repository: ${input}`);
    }
    if (!existsSync(lexical)) {
      throw new Error(`protected input is missing: ${input}`);
    }
    inputFiles(lexical, files);
  }
  const records = files.map((path) => {
    const name = portable(relative(canonicalRoot, path));
    const bytes = readStableFileBytes(canonicalRoot, path);
    return { path: name, sha256: sha256(bytes), bytes: bytes.length };
  });
  records.sort((left, right) => comparePortablePaths(left.path, right.path));
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].path === records[index].path) {
      throw new Error(`protected input roots overlap at: ${records[index].path}`);
    }
  }
  return {
    algorithm: "sha256",
    contentHash: sha256(JSON.stringify(records)),
    fileCount: records.length,
    roots: orderedRoots,
    files: records,
  };
}

export function changedInputs(before, after) {
  const left = new Map(before.files.map((item) => [item.path, item.sha256]));
  const right = new Map(after.files.map((item) => [item.path, item.sha256]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => left.get(path) !== right.get(path))
    .sort(comparePortablePaths);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

export function protectedSnapshotValid(snapshot) {
  if (
    !exactKeys(snapshot, [
      "algorithm",
      "contentHash",
      "fileCount",
      "roots",
      "files",
    ]) ||
    snapshot.algorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/.test(snapshot.contentHash ?? "") ||
    !Number.isSafeInteger(snapshot.fileCount) ||
    snapshot.fileCount < 1 ||
    !Array.isArray(snapshot.roots) ||
    snapshot.roots.length < 1 ||
    !Array.isArray(snapshot.files) ||
    snapshot.fileCount !== snapshot.files.length ||
    snapshot.contentHash !== sha256(JSON.stringify(snapshot.files))
  ) {
    return false;
  }
  if (
    snapshot.roots.some((root) => !portableRelativePath(root)) ||
    new Set(snapshot.roots).size !== snapshot.roots.length ||
    new Set(snapshot.files.map((file) => file?.path)).size !==
      snapshot.files.length ||
    JSON.stringify([...snapshot.roots].sort(comparePortablePaths)) !==
      JSON.stringify(snapshot.roots) ||
    JSON.stringify(
      snapshot.files
        .map((file) => file?.path)
        .sort(comparePortablePaths),
    ) !==
      JSON.stringify(snapshot.files.map((file) => file?.path))
  ) {
    return false;
  }
  return snapshot.files.every(
    (file) =>
      exactKeys(file, ["path", "sha256", "bytes"]) &&
      portableRelativePath(file.path) &&
      /^[0-9a-f]{64}$/.test(file.sha256) &&
      Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0,
  );
}

export function assertExactCurrentSnapshots(before, after, current) {
  if (
    !protectedSnapshotValid(before) ||
    !protectedSnapshotValid(after) ||
    !protectedSnapshotValid(current) ||
    JSON.stringify(before) !== JSON.stringify(current) ||
    JSON.stringify(after) !== JSON.stringify(current)
  ) {
    throw new Error("mutation protected snapshots do not equal current source");
  }
}

export function snapshotFile(snapshot, path) {
  const matches = snapshot.files.filter((file) => file.path === path);
  if (matches.length !== 1) {
    throw new Error(`protected snapshot does not contain exactly one ${path}`);
  }
  return matches[0];
}
