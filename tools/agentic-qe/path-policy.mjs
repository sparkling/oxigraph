import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { scrubbedChildEnvironment } from "../child-environment.mjs";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = realpathSync(resolve(toolDir, "../.."));
export const outputRoot = join(repoRoot, "target", "agentic-qe");
export const candidateRoot = join(outputRoot, "candidates");
export const profileRunLeasePath = join(outputRoot, ".profile-run.lock");

export function portablePath(path) {
  return path.split(sep).join("/");
}

export function isContained(root, path, { allowRoot = false } = {}) {
  const child = relative(root, path);
  if (child === "") return allowRoot;
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function canonicalInside(root, path, options = {}) {
  const canonicalRoot = realpathSync(root);
  const canonicalPath = realpathSync(path);
  if (!isContained(canonicalRoot, canonicalPath, options)) {
    throw new Error(`path escapes allowed root: ${path}`);
  }
  return canonicalPath;
}

export function ensureDirectoryInsideRepository(path) {
  const lexicalPath = resolve(path);
  if (!isContained(repoRoot, lexicalPath)) {
    throw new Error(`directory escapes repository: ${path}`);
  }
  let cursor = repoRoot;
  for (const component of relative(repoRoot, lexicalPath).split(sep)) {
    cursor = join(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`directory path contains a symlink: ${cursor}`);
    }
  }
  mkdirSync(lexicalPath, { recursive: true });
  return canonicalInside(repoRoot, lexicalPath);
}

export function profileOutputDirectory(profile) {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(profile)) {
    throw new Error(`invalid profile output name: ${profile}`);
  }
  const root = ensureDirectoryInsideRepository(outputRoot);
  return ensureDirectoryInsideRepository(join(root, profile));
}

function validateProfileName(profile) {
  if (
    typeof profile !== "string" ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(profile)
  ) {
    throw new Error(`invalid profile output name: ${profile}`);
  }
}

function validatedLeasePath(path) {
  if (isAbsolute(path) && !isContained(repoRoot, resolve(path))) {
    throw new Error(`profile run lease escapes repository: ${path}`);
  }
  const lexicalPath = resolve(repoRoot, path);
  const relativePath = portablePath(relative(repoRoot, lexicalPath));
  if (
    !isContained(repoRoot, lexicalPath) ||
    !relativePath.startsWith("target/")
  ) {
    throw new Error(`profile run lease must remain below target/: ${path}`);
  }
  ensureDirectoryInsideRepository(dirname(lexicalPath));
  return lexicalPath;
}

function sameLeaseFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isFile() &&
    right.isFile()
  );
}

function stableLeaseRecord(path) {
  const initial = lstatSync(path);
  if (initial.isSymbolicLink() || !initial.isFile()) {
    throw new Error(`Agentic-QE profile lease is not a regular file: ${path}`);
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    const lexical = lstatSync(path);
    if (
      !sameLeaseFile(initial, opened) ||
      !sameLeaseFile(opened, lexical) ||
      opened.size <= 0 ||
      opened.size > 4096
    ) {
      throw new Error(`Agentic-QE profile lease changed or is unsafe: ${path}`);
    }
    const bytes = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    const current = lstatSync(path);
    if (
      !sameLeaseFile(opened, after) ||
      !sameLeaseFile(after, current) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`Agentic-QE profile lease changed while reading: ${path}`);
    }
    let owner;
    try {
      owner = JSON.parse(bytes);
    } catch {
      throw new Error(`Agentic-QE profile lease is malformed: ${path}`);
    }
    return {
      identity: { dev: opened.dev, ino: opened.ino },
      owner,
    };
  } finally {
    closeSync(descriptor);
  }
}

function unixProcessStartIdentity(pid) {
  try {
    const output = execFileSync(
      "/bin/ps",
      ["-o", "lstart=", "-p", String(pid)],
      {
        encoding: "utf8",
        env: scrubbedChildEnvironment({ LC_ALL: "C" }),
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line.length > 0);
    return lines.length === 1 ? lines[0] : null;
  } catch {
    return null;
  }
}

function currentProcessStartIdentity() {
  if (process.platform === "win32") return null;
  const identity = unixProcessStartIdentity(process.pid);
  if (identity === null) {
    throw new Error(
      "unable to establish the current Unix process identity for the Agentic-QE lease",
    );
  }
  return identity;
}

function staleUnixLease(owner) {
  if (
    process.platform === "win32" ||
    owner?.schemaVersion !== 1 ||
    owner?.platform !== process.platform ||
    !Number.isSafeInteger(owner?.pid) ||
    owner.pid <= 0 ||
    typeof owner?.token !== "string" ||
    owner.token.length === 0 ||
    typeof owner?.processStartIdentity !== "string" ||
    owner.processStartIdentity.length === 0
  ) {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return error?.code === "ESRCH";
  }
  const observed = unixProcessStartIdentity(owner.pid);
  if (observed === null) {
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      return error?.code === "ESRCH";
    }
    return false;
  }
  return observed !== owner.processStartIdentity;
}

function sameLeaseOwner(record, expected) {
  return (
    record.identity.dev === expected.identity.dev &&
    record.identity.ino === expected.identity.ino &&
    record.owner?.token === expected.owner?.token &&
    record.owner?.pid === expected.owner?.pid &&
    record.owner?.processStartIdentity ===
      expected.owner?.processStartIdentity
  );
}

function recoverStaleLease(path) {
  let candidate;
  try {
    candidate = stableLeaseRecord(path);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (!staleUnixLease(candidate.owner)) return false;

  let current;
  try {
    current = stableLeaseRecord(path);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (!sameLeaseOwner(current, candidate)) return false;
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.dev !== candidate.identity.dev ||
    metadata.ino !== candidate.identity.ino
  ) {
    return false;
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return true;
}

function openLeaseExclusively(path) {
  try {
    return openSync(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
}

export function acquireProfileRunLease(
  profile,
  { leasePath = profileRunLeasePath } = {},
) {
  validateProfileName(profile);
  const path = validatedLeasePath(leasePath);
  const processStartIdentity = currentProcessStartIdentity();
  let descriptor = openLeaseExclusively(path);
  if (descriptor === null && recoverStaleLease(path)) {
    descriptor = openLeaseExclusively(path);
  }
  if (descriptor === null) {
    throw new Error(
      `another Agentic-QE profile run holds the repository lease: ${path}`,
    );
  }

  const token = randomUUID();
  const identity = fstatSync(descriptor);
  const owner = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    profile,
    platform: process.platform,
    processStartIdentity,
    startedAt: new Date().toISOString(),
  };
  const bytes = `${JSON.stringify(owner)}\n`;
  try {
    writeFileSync(descriptor, bytes, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    if (existsSync(path)) {
      const metadata = lstatSync(path);
      if (
        !metadata.isSymbolicLink() &&
        metadata.isFile() &&
        metadata.dev === identity.dev &&
        metadata.ino === identity.ino
      ) {
        unlinkSync(path);
      }
    }
    throw error;
  }

  let released = false;
  return {
    path,
    owner,
    release() {
      if (released) return;
      let valid = false;
      try {
        const current = stableLeaseRecord(path);
        valid =
          current.identity.dev === identity.dev &&
          current.identity.ino === identity.ino &&
          current.owner?.token === token &&
          current.owner?.pid === process.pid &&
          current.owner?.profile === profile &&
          current.owner?.platform === process.platform &&
          current.owner?.processStartIdentity === processStartIdentity;
      } finally {
        closeSync(descriptor);
        released = true;
      }
      if (!valid) {
        throw new Error(
          "refusing to release an Agentic-QE profile lease not owned by this process",
        );
      }
      const current = stableLeaseRecord(path);
      const metadata = lstatSync(path);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.dev !== identity.dev ||
        metadata.ino !== identity.ino ||
        current.identity.dev !== identity.dev ||
        current.identity.ino !== identity.ino ||
        current.owner?.token !== token ||
        current.owner?.pid !== process.pid ||
        current.owner?.processStartIdentity !== processStartIdentity
      ) {
        throw new Error(
          "refusing to unlink a changed Agentic-QE profile lease",
        );
      }
      unlinkSync(path);
    },
  };
}

export function prepareGeneratedOutput(path) {
  if (isAbsolute(path)) {
    throw new Error(`generated output must use a repository-relative path: ${path}`);
  }
  const lexicalPath = resolve(repoRoot, path);
  const relativePath = portablePath(relative(repoRoot, lexicalPath));
  if (
    !isContained(repoRoot, lexicalPath) ||
    (relativePath !== "target" && !relativePath.startsWith("target/"))
  ) {
    throw new Error(`generated output must remain below target/: ${path}`);
  }
  ensureDirectoryInsideRepository(dirname(lexicalPath));
  if (existsSync(lexicalPath)) {
    const metadata = lstatSync(lexicalPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`generated output must be a regular file: ${lexicalPath}`);
    }
    unlinkSync(lexicalPath);
  }
  return lexicalPath;
}

export function regularFileInside(root, path, options = {}) {
  const lexicalPath = resolve(path);
  const metadata = lstatSync(lexicalPath);
  if (!metadata.isFile()) {
    throw new Error(`path must be a regular file: ${path}`);
  }
  return canonicalInside(root, lexicalPath, options);
}

export function resolveRustSource(sourceArg) {
  const lexicalPath = resolve(repoRoot, sourceArg);
  const source = regularFileInside(repoRoot, lexicalPath);
  const sourceRelative = portablePath(relative(repoRoot, source));
  const topLevel = sourceRelative.split("/", 1)[0];
  if (extname(source).toLowerCase() !== ".rs") {
    throw new Error("candidate source must be a Rust .rs file");
  }
  if (topLevel === "target" || topLevel === ".git") {
    throw new Error("candidate source must be repository source, not generated state");
  }
  return { source, sourceRelative };
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function shortSlug(value) {
  const slug = basename(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "rust-source").slice(0, 64);
}

export function uniqueCandidateDestination(sourceRelative) {
  const canonicalCandidates = ensureDirectoryInsideRepository(candidateRoot);
  const prefix = `${shortSlug(sourceRelative)}-${shortHash(sourceRelative)}-`;
  const runDirectory = mkdtempSync(join(canonicalCandidates, prefix));
  return join(runDirectory, "candidate.agentic-qe.json");
}

export function resolveAuditInput(pathArg) {
  if (!pathArg) throw new Error("audit requires an Agentic-QE JSON result");
  if (!lstatSync(candidateRoot).isDirectory()) {
    throw new Error("candidate directory is not a directory");
  }
  const lexicalPath = resolve(repoRoot, pathArg);
  if (extname(lexicalPath).toLowerCase() !== ".json") {
    throw new Error("audit input must have a .json extension");
  }
  return regularFileInside(realpathSync(candidateRoot), lexicalPath);
}

export function auditOutputFor(sourcePath) {
  const auditPath = sourcePath.replace(/\.json$/i, ".audit.json");
  if (auditPath === sourcePath) {
    throw new Error("audit output must not overwrite its input");
  }
  const parent = canonicalInside(realpathSync(candidateRoot), dirname(auditPath), {
    allowRoot: true,
  });
  return join(parent, basename(auditPath));
}
