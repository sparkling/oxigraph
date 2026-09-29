#!/usr/bin/env node
import { routeDelivery, runDelivery } from "../src/delivery.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "../src/delivery.mjs";
import { jsonReference, preflightWorkflow, runWorkflow } from "../src/workflow.mjs";
import { stdioHost } from "../src/workflow-host.mjs";
import { createOrdinaryApi, withOrdinaryApi } from "../src/ordinary-api.mjs";
import { runIsolatedWorkflow } from "../src/ordinary-workspace.mjs";
import { readyBatchEntries, runOrdinaryBatch } from "../src/ordinary-pool.mjs";
import { createOrdinaryRuntime, loadOrdinaryRuntimeConfig } from "../src/ordinary-runtime.mjs";
import { activateOrdinaryPolicy, rollbackOrdinaryPolicy } from "../src/ordinary-policy.mjs";
import { coordinatorLaunch, startCoordinator } from "../src/ordinary-coordinator.mjs";
import { ensureDirectoryInsideRepository } from "../../agentic-qe/path-policy.mjs";

const help = `Ordinary Oxigraph delivery (ADR-0043)
  run --task ID --check "observable completion" [--timeout-ms N] [--artifact target/release/oxigraph] -- cargo test --locked -p oxigraph --test store
  run --task ID --check "harness contracts pass" -- node --test --test-reporter=tap tools/engineering-harness/test/delivery.test.mjs
  route --task ID --role implement --check "observable completion" [--model MODEL --effort EFFORT --reason REASON --selection owner|unresolved]
  workflow --spec FILE.json [--isolated true] [--coordination-unavailable REASON --owner-review-hold true|false]
  batch --spec FILE.json [--coordination-unavailable REASON --owner-review-hold true|false]
  coordinator --session EXISTING_UUID [--start true]
  policy-activate --runtime-config FILE.json --envelope FILE.json --expected-parent SHA256
  policy-rollback --runtime-config FILE.json --expected-current SHA256
Workflow/batch automatically load tools/engineering-harness/ordinary-runtime.json when present; --runtime-config overrides its location.
Use live project Ruflo MCP when available. Explicit unavailable coordination permits harness repair only, never product resumption.
Route is a plan, not a model invocation. Workflow uses the JSON-line bridge for native work and root application.
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
      action === "workflow" ? ["--spec", "--isolated", "--coordination-unavailable", "--owner-review-hold", "--runtime-config"] :
      action === "batch" ? ["--spec", "--coordination-unavailable", "--owner-review-hold", "--runtime-config"] :
      action === "coordinator" ? ["--session", "--start"] :
      action === "policy-activate" ? ["--runtime-config", "--envelope", "--expected-parent"] :
      action === "policy-rollback" ? ["--runtime-config", "--expected-current"] : [];
    for (let i = 0; i < options.length; i += 2) {
      if (!allowed.includes(options[i]) || Object.hasOwn(values, options[i]) || !options[i + 1]) {
        throw new Error("Unknown, duplicate or incomplete delivery option");
      }
      values[options[i]] = options[i + 1];
    }
    if (action === "coordinator" && split < 0) {
      if (values["--start"] !== undefined && values["--start"] !== "true") throw new Error("Coordinator start must be explicit true");
      const launch = coordinatorLaunch(values["--session"]);
      if (values["--start"] === "true") process.exitCode = startCoordinator(values["--session"]);
      else process.stdout.write(JSON.stringify(launch, null, 2) + "\n");
    } else if (action === "run" && split >= 0) {
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
    } else if (action === "policy-rollback" && split < 0 && values["--runtime-config"] && values["--expected-current"]) {
      const config = loadOrdinaryRuntimeConfig(values["--runtime-config"]);
      if (!config.policyActivation) throw new Error("Policy rollback requires explicit configured trust");
      process.stdout.write(JSON.stringify(rollbackOrdinaryPolicy(config.policyActivation, values["--expected-current"])) + "\n");
    } else if (action === "policy-activate" && split < 0 && values["--runtime-config"] && values["--envelope"] && values["--expected-parent"]) {
      const config = loadOrdinaryRuntimeConfig(values["--runtime-config"]);
      if (!config.policyActivation) throw new Error("Policy activation requires explicit configured trust");
      process.stdout.write(JSON.stringify(activateOrdinaryPolicy(config.policyActivation,
        JSON.parse(readFileSync(values["--envelope"], "utf8")), values["--expected-parent"])) + "\n");
    } else if (["workflow", "batch"].includes(action) && split < 0 && values["--spec"]) {
      const batch = action === "batch";
      const unavailable = values["--coordination-unavailable"];
      const hold = values["--owner-review-hold"];
      if ((unavailable === undefined) !== (hold === undefined) ||
          (hold !== undefined && !["true", "false"].includes(hold))) {
        throw new Error("Unavailable coordination needs an exact true/false owner hold state");
      }
      const spec = JSON.parse(readFileSync(values["--spec"], "utf8"));
      if (values["--isolated"] !== undefined && values["--isolated"] !== "true") throw new Error("Isolated workflow option must be true");
      const isolated = batch || values["--isolated"] === "true";
      if (batch) readyBatchEntries(spec, () => {});
      const runtime = createOrdinaryRuntime(loadOrdinaryRuntimeConfig(values["--runtime-config"]));
      const preflight = isolated ? undefined : preflightWorkflow(spec);
      const directory = mkdtempSync(join(ensureDirectoryInsideRepository(join(repository, "target", "engineering-delivery")), "workflow-"));
      const bridge = stdioHost(directory);
      const controller = new AbortController();
      let externalActionsUnconfirmed = [];
      const abort = () => {
        if (controller.signal.aborted) return;
        const error = new Error("Ordinary delivery interrupted; external host actions require termination confirmation");
        controller.abort(error);
        externalActionsUnconfirmed = bridge.close(error);
      };
      if (batch) { process.on("SIGINT", abort); process.on("SIGTERM", abort); }
      let eventId = 0;
      try {
        const apiDirectory = ensureDirectoryInsideRepository(join(repository, "target", "engineering-delivery", "api-ledger"));
        const host = withOrdinaryApi(bridge.request,
          createOrdinaryApi({ directory: apiDirectory, signal: controller.signal, observation: (event) => {
            process.stderr.write(JSON.stringify({ type: "api-progress", ...event }) + "\n");
          } }));
        const workflowOptions = {
          runtime,
          ...(preflight === undefined ? {} : { preflight }),
          ...(unavailable === undefined ? {} : { coordinationUnavailable: unavailable, ownerReviewHold: hold === "true" }),
          event: (event) => {
            const path = join(directory, `event-${++eventId}.json`);
            writeFileSync(path, JSON.stringify(event, null, 2) + "\n", { flag: "wx" });
            return jsonReference(path, event);
          },
        };
        const result = batch
          ? await runOrdinaryBatch(readyBatchEntries(spec, host, workflowOptions), {
            maxConcurrency: spec.maxConcurrency, signal: controller.signal,
            onSettled: (lane) => {
              const path = join(directory, `lane-${lane.id}.json`);
              writeFileSync(path, JSON.stringify(lane), { flag: "wx", mode: 0o600 });
              process.stdout.write(JSON.stringify({ type: "lane-settled", id: lane.id, taskId: lane.taskId,
                status: lane.status, integration: lane.integration, ...jsonReference(path, lane) }) + "\n");
            },
          })
          : await (isolated ? runIsolatedWorkflow : runWorkflow)(spec, host, workflowOptions);
        if (batch) externalActionsUnconfirmed = bridge.close();
        if (batch && (controller.signal.aborted || externalActionsUnconfirmed.length)) Object.assign(result, {
          externalActionsUnconfirmed,
          ownership: externalActionsUnconfirmed.length ? "retained-until-external-actions-confirmed" : "callbacks-drained",
        });
        writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
        if (batch) {
          const passed = result.results.every((item) => item.status === "fulfilled");
          process.exitCode = passed ? 0 : 1;
          process.stdout.write(JSON.stringify({ status: passed ? "ready-for-owner-review" : "incomplete",
            directory, integration: result.integration, results: result.results,
            notificationErrors: result.notificationErrors,
            ownership: result.ownership, externalActionsUnconfirmed: result.externalActionsUnconfirmed }) + "\n");
        } else process.stdout.write(JSON.stringify({ status: result.status, directory, taskId: result.taskId,
          ...(result.candidateRoot ? { candidateRoot: result.candidateRoot, integration: result.integration } : {}) }) + "\n");
      } catch (error) {
        writeFileSync(join(directory, "failure.json"), JSON.stringify({ status: "incomplete", error: error.message, eventCount: eventId }) + "\n", { flag: "wx" });
        throw error;
      } finally {
        bridge.close();
        process.stdin.destroy();
        if (batch) { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
      }
    } else { throw new Error("Expected run with literal argv, route, workflow or batch --spec FILE.json"); }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  if (error.candidateRoot) process.stderr.write(JSON.stringify({ candidateRoot: error.candidateRoot, evidenceDirectory: error.evidenceDirectory }) + "\n");
  process.exitCode = 2;
}
