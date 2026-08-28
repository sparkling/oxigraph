import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { cpus, platform, release, totalmem, userInfo } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import { scrubbedChildEnvironment } from "../../../child-environment.mjs";
import { canonicalSha256 } from "../routing/features.mjs";
import { repositoryRoot } from "../paths.mjs";
import { currentCommittedHarnessIdentity } from "../runtime/control-identity.mjs";

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const TOOL_VERSION_ARGS = Object.freeze({
  cargo: ["--version", "--verbose"],
  rustc: ["--version", "--verbose"],
});
const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
});

function fail(message) {
  throw new Error(`G1.7 identity: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function git(root, args, { buffer = false } = {}) {
  try {
    return execFileSync("/usr/bin/git", args, {
      cwd: root,
      env: gitEnvironment,
      encoding: buffer ? undefined : "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(
      `Git identity probe failed: ${error.stderr?.toString().trim() || error.message}`,
    );
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function verifyEvaluator(root, evaluator, subjectCommit) {
  if (
    evaluator === null ||
    typeof evaluator !== "object" ||
    !GIT_OBJECT.test(evaluator.commit ?? "") ||
    !GIT_OBJECT.test(evaluator.parent ?? "") ||
    !GIT_OBJECT.test(evaluator.tree ?? "") ||
    !Array.isArray(evaluator.paths) ||
    evaluator.paths.length === 0
  ) {
    fail("evaluator contract is malformed");
  }
  const commitType = git(root, ["cat-file", "-t", evaluator.commit]).trim();
  const parent = git(root, ["rev-parse", `${evaluator.commit}^`]).trim();
  const tree = git(root, ["rev-parse", `${evaluator.commit}^{tree}`]).trim();
  if (
    commitType !== "commit" ||
    parent !== evaluator.parent ||
    tree !== evaluator.tree
  ) {
    fail("evaluator commit, parent, or tree does not match Git");
  }
  git(root, ["merge-base", "--is-ancestor", evaluator.commit, subjectCommit]);
  const names = git(root, [
    "diff",
    "--name-status",
    evaluator.parent,
    evaluator.commit,
    "--",
    ...evaluator.paths.map(({ path }) => path),
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [changeStatus, path] = line.split("\t");
      return { changeStatus, path };
    });
  if (
    !isDeepStrictEqual(
      names,
      evaluator.paths.map(({ changeStatus, path }) => ({ changeStatus, path })),
    )
  ) {
    fail("evaluator changed-path inventory does not match Git");
  }
  for (const path of evaluator.paths) {
    const blob = git(root, [
      "rev-parse",
      `${evaluator.commit}:${path.path}`,
    ]).trim();
    const bytes = git(root, ["show", `${evaluator.commit}:${path.path}`], {
      buffer: true,
    });
    if (blob !== path.blob || sha256(bytes) !== path.contentSha256) {
      fail(`evaluator blob does not match Git: ${path.path}`);
    }
  }
  const patch = git(
    root,
    [
      "diff",
      "--binary",
      evaluator.parent,
      evaluator.commit,
      "--",
      ...evaluator.paths.map(({ path }) => path),
    ],
    { buffer: true },
  );
  if (sha256(patch) !== evaluator.patchSha256) {
    fail("evaluator patch does not match Git");
  }
  return Object.freeze({
    commit: evaluator.commit,
    parent: evaluator.parent,
    tree: evaluator.tree,
    patchSha256: evaluator.patchSha256,
    blobSetSha256: canonicalSha256(
      evaluator.paths.map(({ path, blob, contentSha256 }) => ({
        path,
        blob,
        contentSha256,
      })),
    ),
  });
}

function verifySubject(root, subject, evaluator) {
  const product = subject?.product;
  const composition = subject?.evaluator?.composition;
  if (
    subject?.schema !== "oxigraph.g1.7-subject-binding/v1" ||
    subject.evaluator?.commit !== evaluator?.commit ||
    subject.evaluator?.state !== "PRESENT_AS_ANCESTOR" ||
    product === null ||
    typeof product !== "object" ||
    !GIT_OBJECT.test(product.commit ?? "") ||
    !GIT_OBJECT.test(product.tree ?? "") ||
    !GIT_OBJECT.test(product.cargoLockBlob ?? "") ||
    !DIGEST.test(product.cargoLockSha256 ?? "") ||
    composition?.mode !== "ALREADY_PRESENT" ||
    composition.baseManifestBlob !== composition.effectiveManifestBlob ||
    composition.effectiveTree !== product.tree
  ) {
    fail("sealed subject contract is malformed");
  }
  const commitType = git(root, ["cat-file", "-t", product.commit]).trim();
  const tree = git(root, ["rev-parse", `${product.commit}^{tree}`]).trim();
  const lockBlob = git(root, [
    "rev-parse",
    `${product.commit}:Cargo.lock`,
  ]).trim();
  const lockBytes = git(root, ["show", `${product.commit}:Cargo.lock`], {
    buffer: true,
  });
  if (
    commitType !== "commit" ||
    tree !== product.tree ||
    lockBlob !== product.cargoLockBlob ||
    sha256(lockBytes) !== product.cargoLockSha256
  ) {
    fail("sealed subject commit, tree, or Cargo.lock does not match Git");
  }
  for (const path of evaluator.paths) {
    const blob = git(root, [
      "rev-parse",
      `${product.commit}:${path.path}`,
    ]).trim();
    if (blob !== path.blob) {
      fail(`evaluator is not already present in sealed subject: ${path.path}`);
    }
  }
  if (
    composition.baseManifestBlob !== evaluator.paths[0].blob ||
    composition.effectiveManifestSha256 !== evaluator.paths[0].contentSha256
  ) {
    fail("sealed subject evaluator composition does not match its manifest");
  }
  return Object.freeze({ ...product });
}

function verifyControlOnlyDelta(root, subjectCommit, controlCommit) {
  git(root, ["merge-base", "--is-ancestor", subjectCommit, controlCommit]);
  const paths = git(root, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    subjectCommit,
    controlCommit,
    "--",
  ])
    .split("\n")
    .filter(Boolean);
  const invalid = paths.filter(
    (path) =>
      path !== "README.md" &&
      !path.startsWith("docs/") &&
      !path.startsWith("tools/engineering-harness/"),
  );
  if (invalid.length > 0) {
    fail(`product paths changed after sealed subject: ${invalid.join(", ")}`);
  }
  return Object.freeze([...paths]);
}

function trustedToolRoots() {
  const home = realpathSync(userInfo().homedir);
  return [
    realpathSync(join(home, ".cargo", "bin")),
    realpathSync(join(home, ".rustup", "toolchains")),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].map((path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  });
}

function captureTool(program, qualificationRoot) {
  const environment = scrubbedChildEnvironment();
  const located = execFileSync("/usr/bin/which", [program], {
    cwd: qualificationRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split(/\r?\n/u, 1)[0];
  const path = realpathSync(located);
  const metadata = lstatSync(path);
  const uid =
    typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.uid !== 0 && metadata.uid !== uid) ||
    contained(qualificationRoot, path) ||
    path.split(sep).includes("node_modules") ||
    !trustedToolRoots().some((root) => contained(root, path))
  ) {
    fail(`untrusted ${program} executable`);
  }
  const rustup = join(dirname(located), "rustup");
  const toolchainPath = realpathSync(
    execFileSync(rustup, ["which", program], {
      cwd: qualificationRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  );
  if (!trustedToolRoots().some((root) => contained(root, toolchainPath))) {
    fail(`untrusted selected ${program} toolchain executable`);
  }
  const versionStdout = execFileSync(
    toolchainPath,
    TOOL_VERSION_ARGS[program],
    {
      cwd: qualificationRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  return Object.freeze({
    program,
    invokedPath: located,
    path,
    executableSha256: sha256(readFileSync(path)),
    toolchainPath,
    toolchainExecutableSha256: sha256(readFileSync(toolchainPath)),
    versionStdout,
  });
}

function cargoLockIdentity(root, subjectCommit, expected) {
  const blob = git(root, ["rev-parse", `${subjectCommit}:Cargo.lock`]).trim();
  const committedBytes = git(root, ["show", `${subjectCommit}:Cargo.lock`], {
    buffer: true,
  });
  const workingBytes = readFileSync(join(root, "Cargo.lock"));
  if (!workingBytes.equals(committedBytes))
    fail("working Cargo.lock differs from subject");
  const identity = { blob, sha256: sha256(committedBytes) };
  if (
    identity.blob !== expected?.cargoLockBlob ||
    identity.sha256 !== expected?.cargoLockSha256
  ) {
    fail("Cargo.lock differs from sealed subject contract");
  }
  return Object.freeze(identity);
}

export async function currentG17QualificationIdentity({
  contract,
  repoRoot = repositoryRoot,
} = {}) {
  try {
    const root = realpathSync(repoRoot);
    const trackedStatus = git(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
    ]);
    if (trackedStatus.length !== 0)
      fail(`subject tracked worktree is dirty:\n${trackedStatus}`);
    const committed = currentCommittedHarnessIdentity({ repoRoot: root });
    const subject = verifySubject(root, contract?.subject, contract?.evaluator);
    verifyControlOnlyDelta(root, subject.commit, committed.controlCommit);
    const control = {
      ...committed,
      harnessSha256: canonicalSha256({
        schema: "oxigraph.committed-harness-identity/v1",
        ...committed,
      }),
    };
    const evaluator = verifyEvaluator(
      root,
      contract?.evaluator,
      subject.commit,
    );
    const toolchain = [captureTool("cargo", root), captureTool("rustc", root)];
    const rustcHost = /^host: ([a-z0-9_.-]+)$/mu.exec(
      toolchain.find(({ program }) => program === "rustc").versionStdout,
    )?.[1];
    if (!rustcHost) fail("rustc host target is missing");
    const processors = cpus();
    if (processors.length === 0 || typeof processors[0].model !== "string") {
      fail("host CPU identity is unavailable");
    }
    const binding = {
      schema: "oxigraph.g1.7-qualified-subject-identity/v2",
      subject: {
        commit: subject.commit,
        tree: subject.tree,
        trackedClean: true,
      },
      control,
      evaluator,
      cargoLock: cargoLockIdentity(root, subject.commit, subject),
      toolchain,
      host: {
        platform: platform(),
        kernelRelease: release(),
        architecture: process.arch,
        targetTriple: rustcHost,
        cpuModel: processors[0].model,
        cpuCount: processors.length,
        totalMemoryBytes: totalmem(),
      },
    };
    return deepFreeze({
      ...binding,
      identitySha256: canonicalSha256(binding),
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 identity:")) throw error;
    fail(error.message);
  }
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function exactKeys(value, expected, label) {
  if (
    !plainObject(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
}

function boundedString(value, label, maximumBytes = 1024 * 1024) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\0")
  ) {
    fail(`${label} is not bounded text`);
  }
  return value;
}

const qualifiedToolKeys = Object.freeze([
  "program",
  "invokedPath",
  "path",
  "executableSha256",
  "toolchainPath",
  "toolchainExecutableSha256",
  "versionStdout",
]);
function validateQualifiedToolchain(toolchain) {
  if (
    !Array.isArray(toolchain) ||
    toolchain.length !== 2 ||
    !isDeepStrictEqual(
      toolchain.map((tool) => tool?.program),
      ["cargo", "rustc"],
    )
  ) {
    fail("qualified Rust toolchain inventory is not exact");
  }
  return Object.fromEntries(
    toolchain.map((tool) => {
      exactKeys(
        tool,
        qualifiedToolKeys,
        `qualified ${tool?.program ?? "unknown"} tool`,
      );
      for (const key of ["invokedPath", "path", "toolchainPath"]) {
        const path = boundedString(
          tool[key],
          `qualified ${tool.program} ${key}`,
          4096,
        );
        if (!isAbsolute(path) || resolve(path) !== path) {
          fail(
            `qualified ${tool.program} ${key} is not a canonical absolute path`,
          );
        }
      }
      if (
        !DIGEST.test(tool.executableSha256) ||
        !DIGEST.test(tool.toolchainExecutableSha256)
      ) {
        fail(`qualified ${tool.program} executable digest is invalid`);
      }
      const version = boundedString(
        tool.versionStdout,
        `qualified ${tool.program} version output`,
      );
      if (version.trim() !== version) {
        fail(`qualified ${tool.program} version output is not canonical`);
      }
      return [tool.program, { ...tool }];
    }),
  );
}

export function verifyG17QualificationIdentity(identity) {
  exactKeys(
    identity,
    [
      "schema",
      "subject",
      "control",
      "evaluator",
      "cargoLock",
      "toolchain",
      "host",
      "identitySha256",
    ],
    "qualified subject identity",
  );
  exactKeys(
    identity.subject,
    ["commit", "tree", "trackedClean"],
    "qualified subject",
  );
  exactKeys(
    identity.control,
    [
      "controlCommit",
      "harnessTree",
      "harnessManifestSha256",
      "manifestSha256",
      "lockfileSha256",
      "npmrcSha256",
      "dependencies",
      "harnessSha256",
    ],
    "qualified control",
  );
  exactKeys(
    identity.evaluator,
    ["commit", "parent", "tree", "patchSha256", "blobSetSha256"],
    "qualified evaluator",
  );
  exactKeys(identity.cargoLock, ["blob", "sha256"], "qualified Cargo lock");
  exactKeys(
    identity.host,
    [
      "platform",
      "kernelRelease",
      "architecture",
      "targetTriple",
      "cpuModel",
      "cpuCount",
      "totalMemoryBytes",
    ],
    "qualified host",
  );
  if (
    identity.schema !== "oxigraph.g1.7-qualified-subject-identity/v2" ||
    !GIT_OBJECT.test(identity.subject.commit) ||
    !GIT_OBJECT.test(identity.subject.tree) ||
    identity.subject.trackedClean !== true ||
    !GIT_OBJECT.test(identity.control.controlCommit) ||
    !GIT_OBJECT.test(identity.control.harnessTree) ||
    ![
      identity.control.harnessManifestSha256,
      identity.control.manifestSha256,
      identity.control.lockfileSha256,
      identity.control.npmrcSha256,
      identity.control.harnessSha256,
      identity.evaluator.patchSha256,
      identity.evaluator.blobSetSha256,
      identity.cargoLock.sha256,
      identity.identitySha256,
    ].every((value) => DIGEST.test(value)) ||
    !GIT_OBJECT.test(identity.evaluator.commit) ||
    !GIT_OBJECT.test(identity.evaluator.parent) ||
    !GIT_OBJECT.test(identity.evaluator.tree) ||
    !GIT_OBJECT.test(identity.cargoLock.blob)
  ) {
    fail("qualified subject, control, evaluator, or lock binding is malformed");
  }
  if (
    !Array.isArray(identity.control.dependencies) ||
    identity.control.dependencies.length < 1 ||
    identity.control.dependencies.length > 64
  ) {
    fail("qualified dependency inventory is not bounded");
  }
  let previousDependencyName = null;
  for (const dependency of identity.control.dependencies) {
    exactKeys(
      dependency,
      [
        "name",
        "policy",
        "version",
        "resolved",
        "integrity",
        "installedPackageJsonSha256",
      ],
      `qualified dependency ${dependency?.name ?? "unknown"}`,
    );
    for (const key of ["name", "version", "resolved", "integrity"]) {
      boundedString(dependency[key], `qualified dependency ${key}`, 4096);
    }
    if (
      dependency.policy !== "latest" ||
      !DIGEST.test(dependency.installedPackageJsonSha256) ||
      (previousDependencyName !== null &&
        dependency.name <= previousDependencyName)
    ) {
      fail(`qualified dependency ${dependency.name} binding is malformed`);
    }
    previousDependencyName = dependency.name;
  }
  const { harnessSha256: _harnessSha256, ...controlBinding } = identity.control;
  if (
    identity.control.harnessSha256 !==
    canonicalSha256({
      schema: "oxigraph.committed-harness-identity/v1",
      ...controlBinding,
    })
  ) {
    fail("qualified control digest is invalid");
  }
  validateQualifiedToolchain(identity.toolchain);
  for (const key of [
    "platform",
    "kernelRelease",
    "architecture",
    "targetTriple",
    "cpuModel",
  ]) {
    boundedString(identity.host[key], `qualified host ${key}`, 4096);
  }
  if (
    !Number.isSafeInteger(identity.host.cpuCount) ||
    identity.host.cpuCount < 1 ||
    !Number.isSafeInteger(identity.host.totalMemoryBytes) ||
    identity.host.totalMemoryBytes < 1
  ) {
    fail("qualified host capacity is invalid");
  }
  const binding = {
    schema: identity.schema,
    subject: identity.subject,
    control: identity.control,
    evaluator: identity.evaluator,
    cargoLock: identity.cargoLock,
    toolchain: identity.toolchain,
    host: identity.host,
  };
  if (identity.identitySha256 !== canonicalSha256(binding)) {
    fail("qualified subject identity hash is invalid");
  }
  return deepFreeze(structuredClone(identity));
}

export function g17ReceiptIdentity(identity) {
  const verified = verifyG17QualificationIdentity(identity);
  return deepFreeze({
    schema: "oxigraph.g1.7-qualification-identity/v2",
    subjectCommit: verified.subject.commit,
    subjectTree: verified.subject.tree,
    controlCommit: verified.control.controlCommit,
    harnessSha256: verified.control.harnessSha256,
    evaluatorCommit: verified.evaluator.commit,
    evaluatorBlobSha256: verified.evaluator.blobSetSha256,
    identitySha256: verified.identitySha256,
  });
}

export function g17QualificationToolchain(identity) {
  const verified = verifyG17QualificationIdentity(identity);
  return deepFreeze(validateQualifiedToolchain(verified.toolchain));
}

export async function verifyCurrentG17QualificationIdentity(
  identity,
  { contract, repoRoot = repositoryRoot } = {},
) {
  const verified = verifyG17QualificationIdentity(identity);
  const current = await currentG17QualificationIdentity({ contract, repoRoot });
  if (!isDeepStrictEqual(verified, current)) {
    fail(
      "qualified subject identity differs from the current repository and host",
    );
  }
  return current;
}
