// Upstream bounds ready callbacks; ownership and accepted-source integration stay local.
import { runBoundedPool } from "@claude-flow/cli/dist/src/services/bounded-worker-pool.js";
import { runIsolatedWorkflow } from "./ordinary-workspace.mjs";
import { validateWorkflow } from "./workflow.mjs";

const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

// JSON entrypoint contains ready work only; dependency release stays with the owner.
export function readyBatchEntries(batch, host, options = {}) {
  if (!batch || batch.schema !== 1 || Object.keys(batch).some((key) =>
    !["schema", "maxConcurrency", "entries"].includes(key)) ||
    !Number.isSafeInteger(batch.maxConcurrency) || batch.maxConcurrency < 1 ||
    !Array.isArray(batch.entries) || batch.entries.length === 0) {
    throw new Error("Ready batch needs schema 1, positive maxConcurrency and entries");
  }
  return batch.entries.map((entry) => {
    if (!entry || Object.keys(entry).some((key) => !["id", "spec", "resources"].includes(key))) {
      throw new Error("Ready batch entries accept only id, spec and resources");
    }
    return { ...entry, host, options };
  });
}

export async function runOrdinaryBatch(entries, { maxConcurrency, signal } = {}, execute = runIsolatedWorkflow) {
  signal?.throwIfAborted();
  if (!Array.isArray(entries)) throw new Error("Ordinary pool requires ready workflow entries");
  const tasks = entries.map((entry) => {
    if (!entry || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(entry.id)
        || typeof entry.host !== "function" || !Array.isArray(entry.resources ?? [])
        || (entry.resources ?? []).some((resource) => typeof resource !== "string" || !resource.trim())) {
      throw new Error("Ordinary pool entry needs identity, host callback and named resources");
    }
    return { ...entry, spec: validateWorkflow(entry.spec), resources: [...(entry.resources ?? [])] };
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length ||
      new Set(tasks.map((task) => task.spec.taskId)).size !== tasks.length) {
    throw new Error("Ordinary pool requires unique entry and task identities");
  }
  for (let i = 0; i < tasks.length; i++) {
    for (const other of tasks.slice(i + 1)) {
      const task = tasks[i];
      if (task.spec.paths.some((a) => other.spec.paths.some((b) => overlaps(a, b))) ||
          task.resources.some((resource) => other.resources.includes(resource))) {
        throw new Error(`Ordinary pool ownership conflict: ${task.id}/${other.id}`);
      }
    }
  }
  const started = performance.now();
  const active = [];
  const retained = new Map();
  let result;
  try {
    result = await runBoundedPool(tasks.map((task) => ({ id: task.id, run: (workerSignal) => {
      workerSignal.throwIfAborted();
      const job = Promise.resolve().then(() => {
        workerSignal.throwIfAborted();
        return execute(task.spec, (request) => {
          workerSignal.throwIfAborted();
          return task.host(request, workerSignal);
        }, task.options);
      }).then((value) => {
        if (value?.candidateRoot) retained.set(task.id, {
          candidateRoot: value.candidateRoot, evidenceDirectory: value.directory,
        });
        return value;
      }, (error) => {
        if (error?.candidateRoot) retained.set(task.id, {
          candidateRoot: error.candidateRoot, evidenceDirectory: error.evidenceDirectory,
        });
        throw error;
      });
      active.push(job);
      return job;
    } })), { maxConcurrency, signal });
  } finally {
    // Upstream cancellation can return before a noncooperative callback terminates.
    // Keep caller ownership until every started workflow actually settles.
    await Promise.allSettled(active);
  }
  return { ...result, results: result.results.map((item) => ({ ...item, ...retained.get(item.id) })),
    poolDurationMs: result.durationMs, durationMs: performance.now() - started,
    integration: "pending-owner-acceptance" };
}
