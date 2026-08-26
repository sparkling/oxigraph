import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { atomicJson, directoryFsyncSupported } from "./atomic-json.mjs";
import {
  assertArchiveHardening,
  assertAtomicDirectoryHardening,
  assertPublicationHardening,
} from "./hardening-assertions.mjs";
import {
  agenticReceiptContentHash,
  agenticReceiptExecutionHash,
  agenticReceiptBytes,
  archiveOutputArtifacts,
  implementationManifestsEqual,
  outputArtifacts,
  validateAgenticArtifactArchive,
  validateAgenticPublication,
  validateAgenticReceipt,
  validateAgenticOracle,
} from "./evidence.mjs";
import { validateAgenticDependencyEvidence } from "./receipt-contract.mjs";
import {
  createImplementationManifest,
  implementationContentHash,
} from "./implementation-manifest.mjs";
import { commands } from "./profile-definitions.mjs";
import {
  acquireProfileRunLease,
  canonicalInside,
  ensureDirectoryInsideRepository,
  prepareGeneratedOutput,
  profileOutputDirectory,
  repoRoot,
} from "./path-policy.mjs";
test("profile output names accept version segments but reject traversal", () => {
  assert.equal(
    relative(repoRoot, profileOutputDirectory("shacl-1.2")),
    "target/agentic-qe/shacl-1.2",
  );
  for (const invalid of ["../escape", ".hidden", "trailing.", "slash/name"]) {
    assert.throws(
      () => profileOutputDirectory(invalid),
      /invalid profile output name/,
    );
  }
});
test("output directory creation rejects a symlink component", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const localRoot = mkdtempSync(join(repoRoot, "target", "aqe-path-test-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "aqe-path-test-"));
  try {
    symlinkSync(externalRoot, join(localRoot, "escape"), "dir");
    assert.throws(
      () =>
        ensureDirectoryInsideRepository(
          join(localRoot, "escape", "would-be-output"),
        ),
      /contains a symlink/,
    );
  } finally {
    rmSync(localRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});
test("canonical evidence paths cannot escape through a file symlink", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const localRoot = mkdtempSync(join(repoRoot, "target", "aqe-path-test-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "aqe-path-test-"));
  try {
    const externalFile = join(externalRoot, "evidence.json");
    writeFileSync(externalFile, "{}\n");
    mkdirSync(join(localRoot, "nested"));
    const lexical = join(localRoot, "nested", "evidence.json");
    symlinkSync(externalFile, lexical, "file");
    assert.throws(() => canonicalInside(repoRoot, lexical), /escapes allowed root/);
  } finally {
    rmSync(localRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});
test("generated artifacts are cleared only below a canonical target directory", () => {
  const directory = mkdtempSync(join(repoRoot, "target", "aqe-path-test-"));
  try {
    const output = join(directory, "receipt.json");
    writeFileSync(output, "stale\n");
    assert.equal(prepareGeneratedOutput(relative(repoRoot, output)), output);
    assert.throws(() => readFileSync(output), /ENOENT/);
    assert.throws(
      () => prepareGeneratedOutput("Cargo.toml"),
      /must remain below target/,
    );
    assert.deepEqual(commands.jenaParity[2].outputPaths, [
      "target/jena-parity/parity-receipt.json",
      "target/jena-parity/resolved-inventory.json",
      "target/jena-parity/jena-observations.json",
    ]);
    for (const path of commands.jenaParity[2].outputPaths) {
      assert.match(path, /^target\//);
    }
    const atomicOutput = join(directory, "atomic.json");
    assert.equal(directoryFsyncSupported("win32"), false);
    const publication = atomicJson(atomicOutput, { schemaVersion: 1 });
    assert.equal(
      publication.sha256,
      createHash("sha256").update(publication.bytes).digest("hex"),
    );
    assert.deepEqual(JSON.parse(readFileSync(atomicOutput)), {
      schemaVersion: 1,
    });
    assert.throws(
      () => atomicJson(atomicOutput, {}, { replace: false }),
      /refusing to replace immutable publication/,
    );
    assertAtomicDirectoryHardening(directory);
    const leasePath = join(directory, "profile-run.lock");
    const first = acquireProfileRunLease("test-profile", { leasePath });
    try {
      assert.throws(
        () => acquireProfileRunLease("other-profile", { leasePath }),
        /holds the repository lease/,
      );
    } finally {
      first.release();
    }
    const second = acquireProfileRunLease("other-profile", { leasePath });
    second.release();
    if (process.platform !== "win32") {
      const moduleUrl = new URL("./path-policy.mjs", import.meta.url).href;
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const { acquireProfileRunLease } = await import(${JSON.stringify(moduleUrl)}); acquireProfileRunLease("crashed-profile", { leasePath: process.argv[1] });`,
          leasePath,
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(
        child.status,
        0,
        `crashed lease child failed: ${child.stderr}`,
      );
      const crashedOwner = JSON.parse(readFileSync(leasePath, "utf8"));
      assert.notEqual(crashedOwner.pid, process.pid);
      const recovered = acquireProfileRunLease("recovered-profile", {
        leasePath,
      });
      assert.notEqual(recovered.owner.token, crashedOwner.token);
      recovered.release();
    }
    const guarded = acquireProfileRunLease("guarded-profile", { leasePath });
    writeFileSync(
      leasePath,
      '{"schemaVersion":1,"token":"replacement","pid":0}\n',
    );
    assert.throws(
      () => guarded.release(),
      /not owned by this process/,
    );
    assert.equal(readFileSync(leasePath, "utf8").includes("replacement"), true);
    rmSync(leasePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("generated artifact evidence rejects a post-command symlink", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const directory = mkdtempSync(join(repoRoot, "target", "aqe-path-test-"));
  const profile = `archive-test-${process.pid}`;
  const profileDirectory = join(repoRoot, "target", "agentic-qe", profile);
  try {
    const source = join(directory, "source.json");
    const output = join(directory, "receipt.json");
    writeFileSync(source, "{}\n");
    writeFileSync(output, '{"passed":true}\n');
    const commandMap = {
      probe: [
        "node",
        [],
        { outputPaths: [relative(repoRoot, output)] },
      ],
    };
    const artifact = outputArtifacts(["probe"], commandMap);
    assert.equal(artifact.complete, true);
    const archive = archiveOutputArtifacts(profile, artifact);
    assert.deepEqual(archiveOutputArtifacts(profile, artifact), archive);
    const archivedReceipt = {
      profile,
      artifacts: { ...artifact, archive },
    };
    assert.doesNotThrow(() =>
      validateAgenticArtifactArchive(archivedReceipt),
    );
    assertArchiveHardening(archivedReceipt, validateAgenticArtifactArchive);
    writeFileSync(output, '{"passed":false}\n');
    assert.doesNotThrow(() =>
      validateAgenticArtifactArchive(archivedReceipt),
    );
    writeFileSync(join(repoRoot, archive.files[0].path), "tampered\n");
    assert.throws(
      () => validateAgenticArtifactArchive(archivedReceipt),
      /bytes changed or are invalid/,
    );

    unlinkSync(output);
    symlinkSync(source, output, "file");
    const invalid = outputArtifacts(
      ["probe"],
      commandMap,
    );
    assert.equal(invalid.complete, false);
    assert.deepEqual(invalid.invalidPaths, [relative(repoRoot, output)]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(profileDirectory, { recursive: true, force: true });
  }
});
test("receipt verification recomputes content and execution hashes", () => {
  const emptyManifestHash = createHash("sha256").update("[]").digest("hex");
  const implementationFiles = [
    {
      path: "Cargo.lock",
      bytes: 1,
      sha256: "1".repeat(64),
    },
    {
      path: "Cargo.toml",
      bytes: 2,
      sha256: "2".repeat(64),
    },
  ];
  const implementationManifest =
    createImplementationManifest(implementationFiles);
  const runId = "00000000-0000-4000-8000-000000000000";
  const publicationRoot = `target/agentic-qe/test-profile/runs/${runId}`;
  const receipt = {
    schemaVersion: 4,
    runId,
    adapter: "oxigraph-agentic-qe",
    agenticQeVersion: "1.2.3",
    profile: "test-profile",
    generatedAt: new Date().toISOString(),
    repository: {
      gitHead: "a".repeat(40),
      worktreeDirty: true,
      rdfTestsCommit: "b".repeat(40),
      rdfCanonTestsCommit: "c".repeat(40),
    },
    implementation: {
      ...implementationManifest,
      stable: true,
      afterContentHash: implementationManifest.contentHash,
      changedPaths: [],
    },
    authority: {
      commands: [{ id: "probe" }],
      childEnvironmentPolicy: "inherited-safe-name-allowlist-v1",
    },
    runtime: [
      {
        program: "node",
        context: "host",
        executableSha256: "e".repeat(64),
      },
    ],
    commands: [
      {
        id: "probe",
        program: "node",
        args: ["--version"],
        code: 0,
        signal: null,
        spawnError: null,
        timedOut: false,
        timeoutMs: 30_000,
        testInventory: null,
        output: {
          stdoutBytes: 1,
          stderrBytes: 0,
          stdoutSha256: "f".repeat(64),
          stderrSha256: "0".repeat(64),
        },
      },
    ],
    artifacts: {
      algorithm: "sha256",
      complete: true,
      missingPaths: [],
      invalidPaths: [],
      files: [],
      contentHash: emptyManifestHash,
      archive: {
        algorithm: "sha256",
        complete: true,
        root: `target/agentic-qe/test-profile/artifacts/${emptyManifestHash}`,
        files: [],
        totalBytes: 0,
        contentHash: emptyManifestHash,
      },
    },
    publication: {
      schemaVersion: 1,
      immutable: true,
      root: publicationRoot,
      receiptPath: `${publicationRoot}/receipt.json`,
      oraclePath: `${publicationRoot}/oracle.json`,
    },
    passed: true,
  };
  receipt.contentHash = agenticReceiptContentHash(receipt);
  receipt.executionHash = agenticReceiptExecutionHash(receipt);
  const options = {
    expectedProfile: "test-profile",
    expectedAgenticQeVersion: "1.2.3",
    expectedCommandIds: ["probe"],
    expectedCommands: {
      probe: ["node", ["--version"], { timeoutMs: 30_000 }],
    },
  };

  assert.doesNotThrow(() => validateAgenticReceipt(receipt, options));
  assert.equal(
    implementationManifestsEqual(
      receipt.implementation,
      implementationManifest,
    ),
    true,
  );
  const oracle = {
    schemaVersion: 1,
    profile: receipt.profile,
    runId: receipt.runId,
    passed: true,
    baselinePassed: true,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    receiptSha256:
      "0".repeat(64),
  };
  oracle.receiptSha256 = createHash("sha256")
    .update(agenticReceiptBytes(receipt))
    .digest("hex");
  assert.doesNotThrow(() =>
    validateAgenticOracle(oracle, receipt, agenticReceiptBytes(receipt)),
  );
  assert.throws(
    () =>
      validateAgenticOracle(
        { ...oracle, receiptSha256: "2".repeat(64) },
        receipt,
        agenticReceiptBytes(receipt),
      ),
    /exact receipt/,
  );
  const manifestBytes = readFileSync(join(repoRoot, "tools/agentic-qe/package.json"));
  const lockfileBytes = readFileSync(
    join(repoRoot, "tools/agentic-qe/package-lock.json"),
  );
  const npmrcBytes = readFileSync(join(repoRoot, "tools/agentic-qe/.npmrc"));
  const installedPackageJsonBytes = readFileSync(
    join(
      repoRoot,
      "tools/agentic-qe/node_modules/agentic-qe/package.json",
    ),
  );
  const lockfile = JSON.parse(lockfileBytes);
  const locked = lockfile.packages["node_modules/agentic-qe"];
  const dependency = {
    name: "agentic-qe",
    policy: "latest",
    version: locked.version,
    resolved: locked.resolved,
    integrity: locked.integrity,
    manifest: "tools/agentic-qe/package.json",
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    lockfile: "tools/agentic-qe/package-lock.json",
    lockfileSha256: createHash("sha256").update(lockfileBytes).digest("hex"),
    npmrc: "tools/agentic-qe/.npmrc",
    npmrcSha256: createHash("sha256").update(npmrcBytes).digest("hex"),
    installedPackageJsonSha256: createHash("sha256")
      .update(installedPackageJsonBytes)
      .digest("hex"),
  };
  assert.doesNotThrow(() =>
    validateAgenticDependencyEvidence({
      dependency,
      manifestBytes,
      lockfileBytes,
      npmrcBytes,
      installedPackageJsonBytes,
    }),
  );
  assert.throws(
    () =>
      validateAgenticDependencyEvidence({
        dependency: {
          ...dependency,
          version: "9.9.9",
          resolved: "https://evil.invalid/fabricated.tgz",
          integrity: "sha512-ZmFicmljYXRlZA==",
        },
        manifestBytes,
        lockfileBytes,
        npmrcBytes,
        installedPackageJsonBytes,
      }),
    /dependency evidence is invalid|resolution is inconsistent/u,
  );
  const unsafeNpmrcBytes = Buffer.from("ignore-scripts=false\n", "utf8");
  assert.throws(
    () =>
      validateAgenticDependencyEvidence({
        dependency: {
          ...dependency,
          npmrcSha256: createHash("sha256")
            .update(unsafeNpmrcBytes)
            .digest("hex"),
        },
        manifestBytes,
        lockfileBytes,
        npmrcBytes: unsafeNpmrcBytes,
        installedPackageJsonBytes,
      }),
    /dependency evidence is invalid|resolution is inconsistent/u,
  );
  const unsafeIntegrity = "sha512-ZmFicmljYXRlZA==";
  const unsafeLockfile = structuredClone(lockfile);
  unsafeLockfile.packages["node_modules/agentic-qe"].integrity = unsafeIntegrity;
  const unsafeLockfileBytes = Buffer.from(JSON.stringify(unsafeLockfile), "utf8");
  assert.throws(
    () =>
      validateAgenticDependencyEvidence({
        dependency: {
          ...dependency,
          integrity: unsafeIntegrity,
          lockfileSha256: createHash("sha256")
            .update(unsafeLockfileBytes)
            .digest("hex"),
        },
        manifestBytes,
        lockfileBytes: unsafeLockfileBytes,
        npmrcBytes,
        installedPackageJsonBytes,
      }),
    /dependency evidence is invalid|resolution is inconsistent/u,
  );
  assert.throws(
    () =>
      validateAgenticReceipt(receipt, {
        ...options,
        expectedCommandIds: ["different-command"],
      }),
    /execution or hash contract/,
  );
  assert.throws(
    () =>
      validateAgenticReceipt(
        { ...receipt, executionHash: "2".repeat(64) },
        options,
      ),
    /execution or hash contract/,
  );
  const fabricatedCommand = structuredClone(receipt);
  fabricatedCommand.commands[0].args = ["--fabricated"];
  fabricatedCommand.contentHash = agenticReceiptContentHash(fabricatedCommand);
  fabricatedCommand.executionHash =
    agenticReceiptExecutionHash(fabricatedCommand);
  assert.throws(
    () => validateAgenticReceipt(fabricatedCommand, options),
    /execution or hash contract/,
  );
  const fabricatedManifest = structuredClone(receipt);
  fabricatedManifest.artifacts.algorithm = "not-sha256";
  fabricatedManifest.contentHash = agenticReceiptContentHash(fabricatedManifest);
  fabricatedManifest.executionHash =
    agenticReceiptExecutionHash(fabricatedManifest);
  assert.throws(
    () => validateAgenticReceipt(fabricatedManifest, options),
    /execution or hash contract/,
  );

  const reversedFiles = [...implementationFiles].reverse();
  const duplicateFiles = [implementationFiles[0], implementationFiles[0]];
  const invalidImplementations = [
    { algorithm: "not-sha256" },
    {
      files: reversedFiles,
      contentHash: implementationContentHash(reversedFiles),
      afterContentHash: implementationContentHash(reversedFiles),
    },
    {
      files: duplicateFiles,
      contentHash: implementationContentHash(duplicateFiles),
      afterContentHash: implementationContentHash(duplicateFiles),
    },
    {
      files: [
        { ...implementationFiles[0], path: "../escape" },
        implementationFiles[1],
      ],
    },
    {
      files: [
        { ...implementationFiles[0], bytes: -1 },
        implementationFiles[1],
      ],
    },
    {
      files: [
        { ...implementationFiles[0], sha256: "invalid" },
        implementationFiles[1],
      ],
    },
    { contentHash: "3".repeat(64) },
  ];
  for (const invalidImplementation of invalidImplementations) {
    const fabricated = structuredClone(receipt);
    Object.assign(fabricated.implementation, invalidImplementation);
    fabricated.contentHash = agenticReceiptContentHash(fabricated);
    fabricated.executionHash = agenticReceiptExecutionHash(fabricated);
    assert.throws(
      () => validateAgenticReceipt(fabricated, options),
      /execution or hash contract/,
    );
  }

  const publicationDirectory = join(repoRoot, publicationRoot);
  rmSync(publicationDirectory, { recursive: true, force: true });
  try {
    atomicJson(join(publicationDirectory, "receipt.json"), receipt, {
      replace: false,
    });
    atomicJson(join(publicationDirectory, "oracle.json"), oracle, {
      replace: false,
    });
    const authoritative = validateAgenticPublication(receipt);
    assert.deepEqual(authoritative.receipt, receipt);
    assert.deepEqual(authoritative.oracle, oracle);
    assertPublicationHardening(receipt, publicationDirectory, validateAgenticPublication);

    if (process.platform !== "win32") {
      const fifoRunId = "00000000-0000-4000-8000-000000000001";
      const fifoRoot = `target/agentic-qe/test-profile/runs/${fifoRunId}`;
      const fifoReceipt = structuredClone(receipt);
      fifoReceipt.runId = fifoRunId;
      fifoReceipt.publication = {
        schemaVersion: 1,
        immutable: true,
        root: fifoRoot,
        receiptPath: `${fifoRoot}/receipt.json`,
        oraclePath: `${fifoRoot}/oracle.json`,
      };
      fifoReceipt.contentHash = agenticReceiptContentHash(fifoReceipt);
      fifoReceipt.executionHash = agenticReceiptExecutionHash(fifoReceipt);
      const fifoDirectory = join(repoRoot, fifoRoot);
      atomicJson(join(fifoDirectory, "receipt.json"), fifoReceipt, {
        replace: false,
      });
      const fifo = join(fifoDirectory, "oracle.json");
      const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert.equal(created.status, 0, created.stderr);
      assert.throws(
        () => validateAgenticPublication(fifoReceipt),
        /not a regular file/,
      );
      rmSync(fifoDirectory, { recursive: true, force: true });
    }
  } finally {
    rmSync(publicationDirectory, { recursive: true, force: true });
  }
});
