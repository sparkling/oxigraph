#!/usr/bin/env node
import { routeDelivery, runDelivery } from "../src/delivery.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "../src/delivery.mjs";
import { jsonReference, preflightWorkflow, runWorkflow } from "../src/workflow.mjs";
import { stdioHost } from "../src/workflow-host.mjs";
import { createOrdinaryApi, withOrdinaryApi } from "../src/ordinary-api.mjs";
import { ensureDirectoryInsideRepository } from "../../agentic-qe/path-policy.mjs";

const help = `Ordinary Oxigraph delivery (ADR-0043)
  run --task ID --check "observable completion" [--timeout-ms N] [--artifact target/release/oxigraph] -- cargo test --locked -p oxigraph --test store
  run --task ID --check "harness contracts pass" -- node --test --test-reporter=tap tools/engineering-harness/test/delivery.test.mjs
  route --task ID --role implement --check "observable completion" [--model MODEL --effort EFFORT --reason REASON --selection owner|unresolved]
  workflow --spec FILE.json  (JSON-line bridge to the active native coding host)
Use live Ruflo MCP before dispatch and after execution. Route is a plan, not a model invocation.
Ordinary API packets use isolated OpenRouter transport. No shell, publication, qualification, or G1.7 commands are admitted.
`;
try {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === "--help" || action === "help") {
    process.stdout.write(help);
  } else {
    const split = args.indexOf("--");
    const options = split < 0 ? args : args.slice(0, split);
    const values = {};
    const allowed = action === "run" ? ["--task", "--check", "--timeout-ms", "--artifact"] :
      action === "route" ? ["--task", "--role", "--check", "--model", "--effort", "--reason", "--selection"] :
      action === "workflow" ? ["--spec"] : [];
    for (let i = 0; i < options.length; i += 2) {
      if (!allowed.includes(options[i]) || Object.hasOwn(values, options[i]) || !options[i + 1]) {
        throw new Error("Unknown, duplicate or incomplete delivery option");
      }
      values[options[i]] = options[i + 1];
    }
    if (action === "run" && split >= 0) {
      const run = await runDelivery({
        taskId: values["--task"], completionCheck: values["--check"], argv: args.slice(split + 1),
        timeoutMs: values["--timeout-ms"] === undefined ? undefined : Number(values["--timeout-ms"]),
        artifact: values["--artifact"],
      });
      process.stdout.write(JSON.stringify({ status: run.status, directory: run.directory, taskId: run.taskId,
        sourceStable: run.sourceStable, artifact: run.artifact, failure: run.failure }) + "\n");
      process.exitCode = run.status === "command-passed" ? 0 : 1;
    } else if (action === "route" && split < 0) {
      process.stdout.write(JSON.stringify(routeDelivery({ taskId: values["--task"], role: values["--role"],
        completionCheck: values["--check"], model: values["--model"], effort: values["--effort"],
        reason: values["--reason"], selection: values["--selection"] }), null, 2) + "\n");
    } else if (action === "workflow" && split < 0 && values["--spec"]) {
      const spec = JSON.parse(readFileSync(values["--spec"], "utf8"));
      const preflight = preflightWorkflow(spec);
      const directory = mkdtempSync(join(ensureDirectoryInsideRepository(join(repository, "target", "engineering-delivery")), "workflow-"));
      const bridge = stdioHost(directory);
      let eventId = 0;
      try {
        const apiDirectory = ensureDirectoryInsideRepository(join(repository, "target", "engineering-delivery", "api-ledger"));
        const result = await runWorkflow(spec, withOrdinaryApi(bridge.request,
          createOrdinaryApi({ directory: apiDirectory })), {
          preflight,
          event: (event) => {
            const path = join(directory, `event-${++eventId}.json`);
            writeFileSync(path, JSON.stringify(event, null, 2) + "\n", { flag: "wx" });
            return jsonReference(path, event);
          },
        });
        writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
        process.stdout.write(JSON.stringify({ status: result.status, directory, taskId: result.taskId }) + "\n");
      } catch (error) {
        writeFileSync(join(directory, "failure.json"), JSON.stringify({ status: "incomplete", error: error.message, eventCount: eventId }) + "\n", { flag: "wx" });
        throw error;
      } finally { bridge.close(); }
    } else { throw new Error("Expected run with literal argv, route, or workflow --spec FILE.json"); }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
