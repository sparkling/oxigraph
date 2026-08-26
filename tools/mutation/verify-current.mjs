#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentMutationQualification,
  mutationQualificationBindingValid,
} from "./current-qualification.mjs";

const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolDir, "../.."));

export function assertExpectedCurrentQualification(value, expectedRunId) {
  if (!mutationQualificationBindingValid(value)) {
    throw new Error(
      `current mutation qualification is invalid: ${value?.error ?? "invalid binding"}`,
    );
  }
  if (value.runId !== expectedRunId) {
    throw new Error(
      `current mutation qualification does not identify the expected run ${expectedRunId}`,
    );
  }
  return value;
}

function main(values = process.argv.slice(2)) {
  if (values.length !== 2 || values[0] !== "--expected-run-id") {
    throw new Error("usage: verify-current.mjs --expected-run-id <UUIDv4>");
  }
  const binding = assertExpectedCurrentQualification(
    currentMutationQualification(repoRoot),
    values[1],
  );
  process.stdout.write(`${JSON.stringify(binding)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
