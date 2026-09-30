import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeDelivery } from "../../src/delivery.mjs";
import { runOrdinaryNativeRequest } from "../../src/native/ordinary-host.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--run") {
  throw new Error("Explicit --run required for real configured native Sol 6.1/high proof");
}
const directory = mkdtempSync(join(tmpdir(), "oxigraph-ordinary-sol61-proof-"));
const request = { schema: 1, runId: randomUUID(), requestId: 1, taskId: "task-sol61-native-proof",
  specSha256: "local-native-smoke", sourceSha256: "local-native-smoke", action: "native-worker",
  payload: { route: routeDelivery({ role: "review", taskId: "task-sol61-native-proof", completionCheck: "Native bridge returns exact structured readiness" }), files: [] } };
const requestPath = join(directory, "request.json");
writeFileSync(requestPath, JSON.stringify(request), { flag: "wx", mode: 0o600 });
const outcome = await runOrdinaryNativeRequest({ request, requestPath, directory,
  prompt: 'Return exactly {"summary":"OXIGRAPH_SOL61_HIGH_READY","verdict":"ACCEPT","findings":[],"changes":[]}. No tools or source changes.',
  driverUrl: new URL(import.meta.url) });
assert.equal(outcome.status, "completed");
assert.equal(outcome.response.result.client, "codex");
assert.equal(outcome.response.result.model, "gpt-6.1-sol");
assert.equal(outcome.response.result.effort, "high");
assert.equal(outcome.response.result.summary, "OXIGRAPH_SOL61_HIGH_READY");
assert.equal(outcome.response.result.verdict, "ACCEPT");
assert.equal(outcome.terminal.custodyReleased, true);
console.log(JSON.stringify({ type: "native-proof", directory, workerId: outcome.response.result.workerId,
  client: "codex", model: "gpt-6.1-sol", effort: "high", status: outcome.status,
  custodyReleased: outcome.terminal.custodyReleased, durationMs: outcome.terminal.durationMs }));
