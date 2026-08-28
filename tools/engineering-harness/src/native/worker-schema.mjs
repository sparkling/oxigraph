import { readFileSync } from "node:fs";
import { join } from "node:path";

import { harnessRoot } from "../paths.mjs";

export const workerOutputSchemaPath = join(
  harnessRoot,
  "schemas/worker-output.schema.json",
);
export const workerOutputV2SchemaPath = join(
  harnessRoot,
  "schemas/worker-output-v2.schema.json",
);

export function workerOutputSchemaPathForVersion(schemaVersion = 1) {
  if (schemaVersion === 1) return workerOutputSchemaPath;
  if (schemaVersion === 2) return workerOutputV2SchemaPath;
  throw new Error(`unsupported worker output schema version: ${schemaVersion}`);
}

export function claudeWorkerOutputSchema(schemaVersion = 1) {
  const schema = JSON.parse(
    readFileSync(workerOutputSchemaPathForVersion(schemaVersion), "utf8"),
  );
  // Claude Code 2.1.x validates --json-schema with a draft-07-compatible
  // validator that rejects the draft 2020-12 meta-schema URI before any model
  // request is made. The application validator remains authoritative; this
  // transport projection removes only the dialect declaration.
  delete schema.$schema;
  return JSON.stringify(schema);
}
