import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants as fsConstants, openSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as manager from "../../src/candidate/containment-guardian-manager-attestation-v1.mjs";
import * as guardian from "../../src/candidate/containment-guardian-attestation-v1.mjs";
import * as trampoline from "../../src/candidate/containment-guardian-trampoline-attestation-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS as statefsBuildRequirements,
} from "../../src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs";
import {
  NATIVE_COMPILER_BYTES_V1,
  NATIVE_COMPILER_ENVIRONMENT_V1,
  NATIVE_COMPILER_PATH_V1,
  NATIVE_COMPILER_SHA256_V1,
  NATIVE_COMPILER_VERSION_ARGV_V1,
  NATIVE_COMPILER_VERSION_BYTES_V1,
  NATIVE_COMPILER_VERSION_SHA256_V1,
} from "../../src/candidate/containment-guardian-native-attestation-common-v1.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const candidateDirectory = join(repositoryRoot, "tools/engineering-harness/src/candidate");
const supportDirectory = dirname(fileURLToPath(import.meta.url));
const statefsSource = join(candidateDirectory, "containment-guardian-statefs-syscalls-v1.c");
const statefsHeader = join(candidateDirectory, "containment-guardian-statefs-syscalls-v1.h");
const modules = Object.freeze({ manager, guardian, trampoline });
const productionBuilds = new Map();
let compilerEvidencePromise;
let driverBytesPromise;
let targetBytesPromise;

const commonCompileFlags = Object.freeze([
  "-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", "-Wconversion",
  "-Wsign-conversion", "-Wshadow", "-Wformat=2", "-Wundef", "-Wvla",
  "-ffreestanding", "-fno-builtin", "-fno-pie", "-no-pie",
  "-fno-stack-protector", "-fno-asynchronous-unwind-tables",
  "-fno-unwind-tables", "-fno-ident", "-fvisibility=hidden",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runExact(executable, argv, options = {}) {
  const child = spawnSync(executable, argv, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? NATIVE_COMPILER_ENVIRONMENT_V1,
    encoding: "buffer",
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    shell: false,
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
  });
  if (
    child.error !== undefined ||
    child.status !== (options.status ?? 0) ||
    child.signal !== null ||
    (!options.allowOutput && (child.stdout.length !== 0 || child.stderr.length !== 0))
  ) {
    throw new Error(
      `ADR38_NATIVE_FIXTURE_CHILD:${executable}:${child.status}:${child.stderr.toString("utf8")}`,
    );
  }
  return child;
}

async function compilerEvidence() {
  compilerEvidencePromise ??= (async () => {
    const resolved = await realpath(NATIVE_COMPILER_PATH_V1);
    if (resolved !== NATIVE_COMPILER_PATH_V1) throw new Error("ADR38_NATIVE_FIXTURE_COMPILER_PATH");
    const compilerBytes = await readFile(resolved);
    const version = runExact(
      NATIVE_COMPILER_VERSION_ARGV_V1[0],
      NATIVE_COMPILER_VERSION_ARGV_V1.slice(1),
      { allowOutput: true },
    ).stdout;
    if (
      compilerBytes.length !== NATIVE_COMPILER_BYTES_V1 ||
      sha256(compilerBytes) !== NATIVE_COMPILER_SHA256_V1 ||
      version.length !== NATIVE_COMPILER_VERSION_BYTES_V1 ||
      sha256(version) !== NATIVE_COMPILER_VERSION_SHA256_V1
    ) {
      throw new Error("ADR38_NATIVE_FIXTURE_COMPILER_IDENTITY");
    }
    return Object.freeze({ compilerBytes, compilerVersionBytes: version });
  })();
  return compilerEvidencePromise;
}

function expandRecipe(argv, replacements) {
  return argv.map((argument) => replacements.get(argument) ?? argument);
}

function statefsCompileArgv(output) {
  return expandRecipe(statefsBuildRequirements.productionArgv.slice(1), new Map([
    ["-ffile-prefix-map=REQ_ROOT=.", `-ffile-prefix-map=${repositoryRoot}=.`],
    ["-fdebug-prefix-map=REQ_ROOT=.", `-fdebug-prefix-map=${repositoryRoot}=.`],
    ["OUTPUT_OBJECT", output],
  ]));
}

function staticLinkFlags(entry) {
  return [
    "-nostdlib", "-nostartfiles", "-nodefaultlibs", "-static", "-no-pie",
    "-Wl,--build-id=none", "-Wl,--fatal-warnings",
    "-Wl,-z,noexecstack,-z,separate-code,-z,relro,-z,now",
    `-Wl,-e,${entry}`,
  ];
}

async function compileOnce(kind, faultStep = 0) {
  const buildRoot = await mkdtemp(join(tmpdir(), `oxigraph-adr38-${kind}-`));
  try {
    const source = join(candidateDirectory, modules[kind].SOURCE_LOGICAL_NAME_V1);
    const executable = join(buildRoot, kind);
    let statefsObjectBytes = null;
    if (kind === "manager") {
      const managerObject = join(buildRoot, "manager.o");
      const statefsObject = join(buildRoot, "statefs.o");
      runExact(
        NATIVE_COMPILER_PATH_V1,
        expandRecipe(manager.COMPILE_ARGV_V1.slice(1), new Map([
          ["CANDIDATE_DIR", candidateDirectory],
          ["SOURCE", source],
          ["OUTPUT_OBJECT", managerObject],
        ])),
      );
      runExact(
        NATIVE_COMPILER_PATH_V1,
        statefsCompileArgv(statefsObject),
        { env: Object.fromEntries(statefsBuildRequirements.environment) },
      );
      statefsObjectBytes = await readFile(statefsObject);
      if (
        statefsObjectBytes.length !== 33_048 ||
        sha256(statefsObjectBytes) !== manager.STATEFS_OBJECT_SHA256_V1
      ) {
        throw new Error("ADR38_NATIVE_FIXTURE_STATEFS_OBJECT");
      }
      runExact(
        NATIVE_COMPILER_PATH_V1,
        expandRecipe(manager.LINK_ARGV_V1.slice(1), new Map([
          ["MANAGER_OBJECT", managerObject],
          ["STATEFS_OBJECT", statefsObject],
          ["OUTPUT_ELF", executable],
        ])),
      );
    } else {
      const recipe = expandRecipe(modules[kind].COMPILE_ARGV_V1.slice(1), new Map([
        ["SOURCE", source],
        ["OUTPUT_ELF", executable],
      ]));
      if (kind === "trampoline" && faultStep !== 0) {
        recipe.splice(
          recipe.indexOf("-nostdlib"),
          0,
          `-DOXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP=${faultStep}`,
        );
      }
      runExact(NATIVE_COMPILER_PATH_V1, recipe);
    }
    const bytes = await readFile(executable);
    const nm = runExact("/usr/bin/nm", ["-a", executable], { allowOutput: true }).stdout.toString("utf8");
    return Object.freeze({
      bytes,
      statefsObjectBytes,
      statefsEntrypointCount: (nm.match(/\boxigraph_containment_statefs_execute_v1\b/gu) ?? []).length,
      alternateStatefsEntrypointCount: (nm.match(/\boxigraph_containment_statefs_(?!execute_v1\b)[A-Za-z0-9_]+/gu) ?? []).length,
    });
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

export async function buildNativeArtifactV1(kind, { faultStep = 0 } = {}) {
  if (!Object.hasOwn(modules, kind)) throw new Error("ADR38_NATIVE_FIXTURE_KIND");
  if (faultStep !== 0) return compileOnce(kind, faultStep);
  if (!productionBuilds.has(kind)) productionBuilds.set(kind, compileOnce(kind));
  return productionBuilds.get(kind);
}

function elfInspection(bytes) {
  if (
    bytes.length < 64 || bytes[0] !== 0x7f ||
    bytes.subarray(1, 4).toString("ascii") !== "ELF" ||
    bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(16) !== 2 ||
    bytes.readUInt16LE(18) !== 62
  ) {
    throw new Error("ADR38_NATIVE_FIXTURE_ELF");
  }
  const offset = Number(bytes.readBigUInt64LE(32));
  const size = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  let interpreter = 0;
  let dynamic = 0;
  let writeExecutableLoad = false;
  let gnuStackExecutable = false;
  for (let index = 0; index < count; index += 1) {
    const cursor = offset + index * size;
    const type = bytes.readUInt32LE(cursor);
    const flags = bytes.readUInt32LE(cursor + 4);
    if (type === 3) interpreter += 1;
    if (type === 2) dynamic += 1;
    if (type === 1 && (flags & 3) === 3) writeExecutableLoad = true;
    if (type === 0x6474e551 && (flags & 1) !== 0) gnuStackExecutable = true;
  }
  return { interpreter, dynamic, writeExecutableLoad, gnuStackExecutable };
}

async function objdumpSyscalls(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "oxigraph-adr38-inspect-"));
  const pathname = join(directory, "artifact");
  try {
    await writeFile(pathname, bytes, { mode: 0o700 });
    const output = runExact("/usr/bin/objdump", ["-d", "-M", "intel", pathname], {
      allowOutput: true,
      maxBuffer: 32 * 1024 * 1024,
    }).stdout.toString("utf8");
    const lines = output.split("\n");
    const numbers = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      if (!/\bsyscall\b/u.test(lines[index])) continue;
      for (let prior = index - 1; prior >= Math.max(0, index - 10); prior -= 1) {
        if (/\bsyscall\b/u.test(lines[prior])) break;
        const match = /\bmov\s+eax,0x([0-9a-f]+)\b/iu.exec(lines[prior]);
        if (match !== null) {
          numbers.add(Number.parseInt(match[1], 16));
          break;
        }
      }
    }
    return [...numbers].sort((left, right) => left - right);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectNativeArtifactV1(kind, bytes, _path = null) {
  const module = modules[kind];
  const elf = elfInspection(bytes);
  const selfDescriptionOccurrences = bytes.toString("latin1").split(module.SELF_DESCRIPTION_JSONL_V1).length - 1;
  return Object.freeze({
    staticElf: elf.interpreter === 0 && elf.dynamic === 0,
    interpreter: elf.interpreter === 0 ? null : elf.interpreter,
    dynamicSegment: elf.dynamic !== 0,
    writeExecutableLoad: elf.writeExecutableLoad,
    gnuStackExecutable: elf.gnuStackExecutable,
    selfDescriptionOccurrences,
    directSyscallNumbers: await objdumpSyscalls(bytes),
  });
}

export async function buildAndAttestNativeArtifactV1(kind) {
  const module = modules[kind];
  const [first, second, compiler, sourceBytes] = await Promise.all([
    compileOnce(kind),
    compileOnce(kind),
    compilerEvidence(),
    readFile(join(candidateDirectory, module.SOURCE_LOGICAL_NAME_V1)),
  ]);
  const input = {
    sourceBytes,
    compilerBytes: compiler.compilerBytes,
    compilerVersionBytes: compiler.compilerVersionBytes,
    firstExecutableBytes: first.bytes,
    secondExecutableBytes: second.bytes,
  };
  if (kind === "manager") {
    input.statefsHeaderBytes = await readFile(statefsHeader);
    input.statefsSourceBytes = await readFile(statefsSource);
    input.statefsObjectBytes = first.statefsObjectBytes;
  }
  const report = module.attestV1(input);
  return Object.freeze({
    report,
    attestationInput: input,
    firstBytes: first.bytes,
    secondBytes: second.bytes,
    firstSha256: sha256(first.bytes),
    secondSha256: sha256(second.bytes),
    statefsObjectSha256: first.statefsObjectBytes === null ? null : sha256(first.statefsObjectBytes),
    statefsObjectByteLength: first.statefsObjectBytes?.length ?? null,
    statefsEntrypointCount: first.statefsEntrypointCount,
    alternateStatefsEntrypointCount: first.alternateStatefsEntrypointCount,
    inspection: await inspectNativeArtifactV1(kind, first.bytes),
  });
}

async function compileTestSupport(name, entry = null) {
  const source = join(supportDirectory, name);
  const directory = await mkdtemp(join(tmpdir(), "oxigraph-adr38-support-"));
  try {
    const executable = join(directory, "support");
    const argv = entry === null
      ? ["-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", source, "-o", executable]
      : [
          ...commonCompileFlags,
          ...staticLinkFlags(entry),
          source,
          "-o", executable,
        ];
    runExact(NATIVE_COMPILER_PATH_V1, argv);
    return await readFile(executable);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function materialize(bytes, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const pathname = join(directory, "artifact");
  await writeFile(pathname, bytes, { mode: 0o700 });
  await chmod(pathname, 0o700);
  return { directory, pathname };
}

export async function runGuardianNativeScenarioV1(scenario) {
  driverBytesPromise ??= compileTestSupport("candidate-containment-guardian-native-v1-driver.c");
  const [guardianArtifact, driverBytes] = await Promise.all([
    buildNativeArtifactV1("guardian"),
    driverBytesPromise,
  ]);
  const [guardianFile, driverFile] = await Promise.all([
    materialize(guardianArtifact.bytes, "oxigraph-adr38-guardian-run-"),
    materialize(driverBytes, "oxigraph-adr38-driver-run-"),
  ]);
  try {
    const child = spawnSync(driverFile.pathname, [guardianFile.pathname, scenario], {
      cwd: guardianFile.directory,
      env: {},
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    });
    if (child.error !== undefined) throw child.error;
    return Object.freeze({
      exitCode: child.status,
      signal: child.signal,
      status: child.stdout,
      diagnostics: child.stderr,
      statusEof: true,
      guardianReaped: child.status !== null,
      provisionalChildAbsent: child.status !== 124,
    });
  } finally {
    await Promise.all([
      rm(guardianFile.directory, { recursive: true, force: true }),
      rm(driverFile.directory, { recursive: true, force: true }),
    ]);
  }
}

export async function runManagerNativeScenarioV1() {
  const artifact = await buildNativeArtifactV1("manager");
  const managerFile = await materialize(
    artifact.bytes,
    "oxigraph-adr38-manager-run-",
  );
  try {
    const child = spawnSync(managerFile.pathname, [], {
      cwd: managerFile.directory,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: 4096,
      shell: false,
      timeout: 10_000,
      windowsHide: true,
    });
    if (child.error !== undefined) throw child.error;
    return Object.freeze({
      exitCode: child.status,
      signal: child.signal,
      stdout: child.stdout,
      stderr: child.stderr,
    });
  } finally {
    await rm(managerFile.directory, { recursive: true, force: true });
  }
}

function collectStream(stream) {
  if (stream === null) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    stream.on("data", (chunk) => {
      length += chunk.length;
      if (length > 64 * 1024) {
        reject(new Error("ADR38_NATIVE_FIXTURE_STREAM_BOUND"));
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function runTrampolineNativeScenarioV1({ faultStep = 0 } = {}) {
  targetBytesPromise ??= compileTestSupport(
    "candidate-containment-guardian-trampoline-target-v1.c",
    "oxigraph_containment_trampoline_target_entry",
  );
  const [trampolineArtifact, targetBytes] = await Promise.all([
    faultStep === 0
      ? buildNativeArtifactV1("trampoline")
      : buildNativeArtifactV1("trampoline", { faultStep }),
    targetBytesPromise,
  ]);
  const [trampolineFile, targetFile] = await Promise.all([
    materialize(trampolineArtifact.bytes, "oxigraph-adr38-trampoline-run-"),
    materialize(targetBytes, "oxigraph-adr38-target-run-"),
  ]);
  const targetDescriptor = openSync(targetFile.pathname, fsConstants.O_RDONLY);
  const nullDescriptor = openSync("/dev/null", fsConstants.O_RDONLY);
  try {
    const stdio = Array.from({ length: 50 }, () => "ignore");
    stdio[18] = targetDescriptor;
    for (let descriptor = 32; descriptor <= 49; descriptor += 1) {
      stdio[descriptor] = nullDescriptor;
    }
    stdio[33] = "pipe";
    stdio[34] = "pipe";
    const child = spawn(trampolineFile.pathname, [], {
      cwd: repositoryRoot,
      env: {},
      stdio,
      windowsHide: true,
    });
    const stdout = collectStream(child.stdio[33]);
    const stderr = collectStream(child.stdio[34]);
    const closed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ADR38_NATIVE_FIXTURE_TRAMPOLINE_TIMEOUT"));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    const [result, stdoutBytes, stderrBytes] = await Promise.all([closed, stdout, stderr]);
    return Object.freeze({
      exitCode: result.code,
      signal: result.signal,
      stdout: stdoutBytes.toString("utf8"),
      stderr: stderrBytes.toString("utf8"),
    });
  } finally {
    closeSync(targetDescriptor);
    closeSync(nullDescriptor);
    await Promise.all([
      rm(trampolineFile.directory, { recursive: true, force: true }),
      rm(targetFile.directory, { recursive: true, force: true }),
    ]);
  }
}
