// Small stdio adapter to the active native coding host, not a second agent host.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Executes only the mechanical MCP actions. Native work and root application
 * remain pending for the active host. This function is deliberately
 * dependency-free so a native host can serialize it into its tool isolate and
 * inject the registered MCP callbacks.
 */
export async function relayWorkflowHost(request, callbacks) {
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      !callbacks || typeof callbacks !== "object" || Array.isArray(callbacks)) {
    throw new Error("Relay needs a host request and injected callbacks");
  }
  if (request.action === "native-worker" || request.action === "root-apply") return request;

  const invoke = async (name, args) => {
    const callback = callbacks[name];
    if (typeof callback !== "function") throw new Error(`Missing relay callback: ${name}`);
    const pending = callback(args);
    if (pending && typeof pending[Symbol.asyncIterator] === "function") {
      const iterator = pending[Symbol.asyncIterator]();
      try {
        while (true) {
          const step = await iterator.next();
          if (step.done) return step.value;
          if (typeof callbacks.observation === "function") await callbacks.observation(step.value);
        }
      } catch (error) {
        if (typeof iterator.return === "function") {
          try {
            await iterator.return();
          } catch {
            // Cleanup failure must not replace the primary failure.
          }
        }
        throw error;
      }
    }
    return await pending;
  };
  const decode = (response, label) => {
    if (response?.isError === true) throw new Error(`${label} failed`);
    if (Array.isArray(response?.content)) {
      const blocks = response.content.filter((item) => item?.type === "text");
      if (blocks.length !== 1 || typeof blocks[0].text !== "string") throw new Error(`${label} returned no exact JSON value`);
      try { return JSON.parse(blocks[0].text); } catch { throw new Error(`${label} returned invalid JSON`); }
    }
    return response;
  };
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  };
  const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  const { action, payload, ...identity } = request;
  if (action === "mcp-read") {
    const [taskResponse, controlResponse] = await Promise.all([
      invoke("taskStatus", { taskId: request.taskId }),
      invoke("memoryRetrieve", { namespace: payload?.namespace, key: payload?.key }),
    ]);
    const task = decode(taskResponse, "task_status");
    const controlRecord = decode(controlResponse, "memory_retrieve");
    if (controlRecord?.found !== true || !Object.hasOwn(controlRecord, "value")) {
      throw new Error("Live control memory is missing");
    }
    return { ...identity, result: { task, control: controlRecord.value } };
  }
  if (action === "mcp-handoff") {
    if (!payload || typeof payload.namespace !== "string" || typeof payload.key !== "string" ||
        !Object.hasOwn(payload, "evidence")) throw new Error("MCP handoff is incomplete");
    const stored = decode(await invoke("memoryStore", {
      namespace: payload.namespace, key: payload.key, value: payload.evidence,
      upsert: false, provenance_type: "tool_result",
    }), "memory_store");
    if (stored?.success !== true) throw new Error("MCP evidence store was not confirmed");
    const record = decode(await invoke("memoryRetrieve", {
      namespace: payload.namespace, key: payload.key,
    }), "memory_retrieve");
    if (record?.found !== true || !Object.hasOwn(record, "value") ||
        !same(record.value, payload.evidence)) {
      throw new Error("MCP evidence readback is missing or mismatched");
    }
    return { ...identity, result: { value: record.value } };
  }
  throw new Error(`Unsupported relay action: ${action}`);
}

export function stdioHost(directory, input = process.stdin, output = process.stdout, callbacks) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Map();
  const identity = (value) => JSON.stringify([value?.runId, value?.requestId]);
  let closed = false;
  let unresolved = [];
  const detach = () => {
    input.removeListener("error", onInputError);
    output.removeListener("error", onOutputError);
    lines.removeListener("error", onLinesError);
    lines.removeListener("line", onLine);
    lines.removeListener("close", onClose);
  };
  const fail = (error) => {
    if (closed) return;
    closed = true;
    unresolved = [...pending.values()].map((item) => item.request);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    detach();
    lines.close();
  };
  const onInputError = (error) => fail(error);
  const onOutputError = (error) => fail(error);
  const onLinesError = (error) => fail(error);
  const onLine = (line) => {
    try {
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new Error("Host response exceeds structural limit");
      const result = JSON.parse(line);
      const key = identity(result), item = pending.get(key);
      if (!item) throw new Error("Unsolicited host response");
      clearTimeout(item.timer);
      const { resolve } = item;
      pending.delete(key);
      resolve(result);
    } catch (error) { fail(error); }
  };
  const onClose = () => fail(new Error("Host input closed before workflow completion"));
  input.on("error", onInputError);
  output.on("error", onOutputError);
  lines.on("error", onLinesError);
  lines.on("line", onLine);
  lines.on("close", onClose);
  const requestThroughStdio = (request) => new Promise((resolve, reject) => {
    const key = identity(request);
    if (closed || pending.has(key)) return reject(new Error("Host bridge closed or already awaiting this request"));
    const path = join(directory, `request-${randomUUID()}.json`);
    writeFileSync(path, JSON.stringify(request, null, 2) + "\n", { flag: "wx" });
    // Host tool turnaround bound, not a model usage/attempt budget.
    const timer = setTimeout(() => fail(new Error("Host action timed out after 30 minutes")), 1800000);
    pending.set(key, { resolve, reject, timer, request: {
      runId: request.runId, requestId: request.requestId, taskId: request.taskId, action: request.action,
    } });
    try {
      output.write(JSON.stringify({ type: "host-request", action: request.action, runId: request.runId, requestId: request.requestId, path }) + "\n");
    } catch (error) { fail(error); }
  });
  return {
    request: async (request) => {
      if (callbacks !== undefined) {
        const relayed = await relayWorkflowHost(request, callbacks);
        if (relayed !== request) return relayed;
      }
      return requestThroughStdio(request);
    },
    close: (error = new Error("Host bridge closed")) => {
      fail(error);
      return unresolved.map((request) => ({ ...request }));
    },
  };
}
