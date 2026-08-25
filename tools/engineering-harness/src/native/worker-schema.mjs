import { readFileSync } from "node:fs";
import { join } from "node:path";

import { harnessRoot } from "../paths.mjs";

export const workerOutputSchemaPath = join(
  harnessRoot,
  "schemas/worker-output.schema.json",
);

export function claudeWorkerOutputSchema() {
  const schema = JSON.parse(readFileSync(workerOutputSchemaPath, "utf8"));
  // Claude Code 2.1.x validates --json-schema with a draft-07-compatible
  // validator that rejects the draft 2020-12 meta-schema URI before any model
  // request is made. The application validator remains authoritative; this
  // transport projection removes only the dialect declaration.
  delete schema.$schema;
  return JSON.stringify(schema);
}
