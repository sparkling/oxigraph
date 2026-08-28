import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const harnessRoot = fileURLToPath(new URL("..", import.meta.url));
const executeFile = promisify(execFile);
const providerFreeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"].includes(
        name,
      ),
  ),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("historical contract replay is Darwin-free while current replay fails closed without Darwin", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const isolatedHarness = join(root, "engineering-harness");
  const modulePaths = [
    "src/paths.mjs",
    "src/routing/features.mjs",
    "src/qualification/benchmark-contract.mjs",
    "src/qualification/contract-identity.mjs",
    "src/qualification/contract-replay.mjs",
    "src/qualification/contract.mjs",
    "src/qualification/decision-contract.mjs",
  ];
  for (const modulePath of modulePaths) {
    const target = join(isolatedHarness, modulePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(harnessRoot, modulePath), target);
  }

  const replay = await import(
    pathToFileURL(
      join(isolatedHarness, "src", "qualification", "contract-replay.mjs"),
    ).href
  );
  for (const expected of [
    {
      fixture: "g17-qualification-contract-v1.json",
      digest:
        "e267e4d276a3d0b7997c2522d3f24ca7a32f669282c5f2ea332a752c3322c54c",
      generation: "LEGACY_V1",
    },
    {
      fixture: "g17-qualification-contract-v3.json",
      digest:
        "de547f5bc4a484f83da1b3d9167c4969766189455a22f9dcf542b471a8b77278",
      generation: "LEGACY_V3",
    },
  ]) {
    const bytes = await readFile(
      join(harnessRoot, "test", "fixtures", expected.fixture),
    );
    assert.equal(sha256(bytes), expected.digest);
    const decoded = await replay.decodeSealedG17ContractForReplay({
      bytes,
      receiptSha256: expected.digest,
    });
    assert.equal(decoded.contractSha256, expected.digest);
    assert.equal(decoded.generation, expected.generation);
    assert.equal(Object.isFrozen(decoded.contract), true);
  }

  const currentBytes = await readFile(
    join(harnessRoot, "qualification", "g1.7", "contract.json"),
  );
  await assert.rejects(
    replay.decodeSealedG17ContractForReplay({
      bytes: currentBytes,
      receiptSha256: sha256(currentBytes),
    }),
    /current protocol runtime validation failed:.*@metaharness\/darwin/su,
  );
});

test("sealed verifier import bypasses Darwin while current replay resolves it fail-closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-loader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loaderPath = join(root, "deny-darwin-loader.mjs");
  await writeFile(
    loaderPath,
    [
      "export async function resolve(specifier, context, nextResolve) {",
      '  if (specifier === "@metaharness/darwin" || specifier.startsWith("@metaharness/darwin/")) {',
      '    throw new Error("DARWIN_RESOLUTION_FORBIDDEN");',
      "  }",
      "  return nextResolve(specifier, context);",
      "}",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const nodeOptions = [
    "--experimental-loader",
    pathToFileURL(loaderPath).href,
    "--input-type=module",
    "--eval",
  ];
  const verifierUrl = pathToFileURL(
    join(harnessRoot, "src", "qualification", "verifier.mjs"),
  ).href;
  await executeFile(
    process.execPath,
    [
      ...nodeOptions,
      `await import(${JSON.stringify(verifierUrl)}); process.stdout.write("VERIFIER_IMPORT_OK\\n");`,
    ],
    { env: providerFreeEnvironment },
  );

  const replayUrl = pathToFileURL(
    join(harnessRoot, "src", "qualification", "contract-replay.mjs"),
  ).href;
  const currentContractPath = join(
    harnessRoot,
    "qualification",
    "g1.7",
    "contract.json",
  );
  const script = `
    import { createHash } from "node:crypto";
    import { readFile } from "node:fs/promises";
    const { decodeSealedG17ContractForReplay } = await import(${JSON.stringify(replayUrl)});
    const bytes = await readFile(${JSON.stringify(currentContractPath)});
    try {
      await decodeSealedG17ContractForReplay({
        bytes,
        receiptSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      throw new Error("current replay unexpectedly succeeded");
    } catch (error) {
      if (!error.message.includes("DARWIN_RESOLUTION_FORBIDDEN")) throw error;
    }
  `;
  await executeFile(process.execPath, [...nodeOptions, script], {
    env: providerFreeEnvironment,
  });
});
