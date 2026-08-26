import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { cpus, platform, release, totalmem, userInfo } from "node:os";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { scrubbedChildEnvironment } from "../../../child-environment.mjs";
import { canonicalSha256 } from "../routing/features.mjs";
import { repositoryRoot } from "../paths.mjs";
import { currentCommittedHarnessIdentity } from "../runtime/control-identity.mjs";

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
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
    fail(`Git identity probe failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function verifyEvaluator(root, evaluator) {
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
  if (commitType !== "commit" || parent !== evaluator.parent || tree !== evaluator.tree) {
    fail("evaluator commit, parent, or tree does not match Git");
  }
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
    const blob = git(root, ["rev-parse", `${evaluator.commit}:${path.path}`]).trim();
    const bytes = git(
      root,
      ["show", `${evaluator.commit}:${path.path}`],
      { buffer: true },
    );
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

function captureTool(program) {
  const environment = scrubbedChildEnvironment();
  const located = execFileSync("/usr/bin/which", [program], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split(/\r?\n/u, 1)[0];
  const path = realpathSync(located);
  const metadata = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o022) !== 0 ||
    (metadata.uid !== 0 && metadata.uid !== uid) ||
    contained(repositoryRoot, path) ||
    path.split(sep).includes("node_modules") ||
    !trustedToolRoots().some((root) => contained(root, path))
  ) {
    fail(`untrusted ${program} executable`);
  }
  const versionStdout = execFileSync(located, TOOL_VERSION_ARGS[program], {
    env: environment,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const rustup = join(dirname(located), "rustup");
  const toolchainPath = realpathSync(
    execFileSync(rustup, ["which", program], {
      env: environment,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  );
  if (!trustedToolRoots().some((root) => contained(root, toolchainPath))) {
    fail(`untrusted selected ${program} toolchain executable`);
  }
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

function cargoLockIdentity(root, subjectCommit) {
  const blob = git(root, ["rev-parse", `${subjectCommit}:Cargo.lock`]).trim();
  const committedBytes = git(root, ["show", `${subjectCommit}:Cargo.lock`], {
    buffer: true,
  });
  const workingBytes = readFileSync(join(root, "Cargo.lock"));
  if (!workingBytes.equals(committedBytes)) fail("working Cargo.lock differs from subject");
  return Object.freeze({ blob, sha256: sha256(committedBytes) });
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
    if (trackedStatus.length !== 0) fail(`subject tracked worktree is dirty:\n${trackedStatus}`);
    const subjectCommit = git(root, ["rev-parse", "HEAD"]).trim();
    const subjectTree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
    const committed = currentCommittedHarnessIdentity({ repoRoot: root });
    if (committed.controlCommit !== subjectCommit) {
      fail("harness control commit differs from subject commit");
    }
    const control = {
      ...committed,
      harnessSha256: canonicalSha256({
        schema: "oxigraph.committed-harness-identity/v1",
        ...committed,
      }),
    };
    const evaluator = verifyEvaluator(root, contract?.evaluator);
    const toolchain = [captureTool("cargo"), captureTool("rustc")];
    const rustcHost = /^host: ([a-z0-9_.-]+)$/mu.exec(
      toolchain.find(({ program }) => program === "rustc").versionStdout,
    )?.[1];
    if (!rustcHost) fail("rustc host target is missing");
    const processors = cpus();
    if (processors.length === 0 || typeof processors[0].model !== "string") {
      fail("host CPU identity is unavailable");
    }
    const binding = {
      schema: "oxigraph.g1.7-qualified-subject-identity/v1",
      subject: {
        commit: subjectCommit,
        tree: subjectTree,
        trackedClean: true,
      },
      control,
      evaluator,
      cargoLock: cargoLockIdentity(root, subjectCommit),
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

export function g17ReceiptIdentity(identity) {
  if (
    identity?.schema !== "oxigraph.g1.7-qualified-subject-identity/v1" ||
    identity.identitySha256 !==
      canonicalSha256({
        schema: identity.schema,
        subject: identity.subject,
        control: identity.control,
        evaluator: identity.evaluator,
        cargoLock: identity.cargoLock,
        toolchain: identity.toolchain,
        host: identity.host,
      })
  ) {
    fail("qualified subject identity hash is invalid");
  }
  return deepFreeze({
    schema: "oxigraph.g1.7-qualification-identity/v1",
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    harnessSha256: identity.control.harnessSha256,
    evaluatorCommit: identity.evaluator.commit,
    evaluatorBlobSha256: identity.evaluator.blobSetSha256,
    identitySha256: identity.identitySha256,
  });
}
