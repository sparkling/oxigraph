import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";

export const ordinaryStreamLimits = Object.freeze({
  warnMs: 120_000,
  cancelMs: 300_000,
  termGraceMs: 1_000,
  drainMs: 5_000,
  progressMs: 5_000,
  maxRecordBytes: 2 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
});

export function ordinaryClaudeStreamArgs(args) {
  const index = args.indexOf("--output-format");
  if (index < 0 || args.lastIndexOf("--output-format") !== index || !["json", "stream-json"].includes(args[index + 1])) {
    throw new Error("Ordinary Claude stream requires one JSON output format");
  }
  const result = [...args];
  result[index + 1] = "stream-json";
  for (const flag of ["--verbose", "--include-partial-messages"]) if (!result.includes(flag)) result.push(flag);
  return result;
}

export function forwardOrdinaryStreamSignals(execution) {
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
  const cancel = () => execution.cancel();
  // Last-resort crash/exit cleanup cannot certify reap or release custody.
  const onExit = () => {
    if (Number.isSafeInteger(execution.pid) && execution.pid > 0) {
      try { process.kill(-execution.pid, "SIGKILL"); } catch { /* best effort */ }
    }
  };
  for (const signal of signals) process.on(signal, cancel);
  process.on("exit", onExit);
  const detach = () => {
    for (const signal of signals) process.removeListener(signal, cancel);
    process.removeListener("exit", onExit);
  };
  execution.completion.then(result => {
    // Keep the crash guard when a bounded drain could not confirm termination.
    if (result.custodyReleased) detach();
  });
  return detach;
}

// Content and matched tool lifecycle events count, never heartbeat/tool-progress traffic.
function substantive(event, tools) {
  const part = event?.type === "stream_event" ? event.event : undefined;
  if (part?.type === "message_start" || part?.type === "message_stop") tools.thinking.clear();
  if (part?.type === "content_block_stop") tools.thinking.delete(part.index);
  if (part?.type === "content_block_start" && Number.isSafeInteger(part.index) && part.index >= 0) {
    tools.thinking.delete(part.index);
    if (part.content_block?.type === "thinking" && tools.thinking.size < 1024) tools.thinking.add(part.index);
  }
  if (part?.type === "content_block_delta") {
    const delta = part.delta;
    if (delta?.type === "thinking_delta" && tools.thinking.has(part.index) &&
        Number.isSafeInteger(delta.estimated_tokens) && delta.estimated_tokens > 0) return true;
    const field = { text_delta: "text", thinking_delta: "thinking", input_json_delta: "partial_json" }[delta?.type];
    return field !== undefined && typeof delta[field] === "string" && delta[field].length > 0;
  }
  const blocks = part?.type === "content_block_start" ? [part.content_block]
    : ["assistant", "user"].includes(event?.type) && Array.isArray(event.message?.content) ? event.message.content : [];
  let changed = false;
  for (const block of blocks) {
    if (block?.type === "tool_use" && (part || event.type === "assistant") &&
        typeof block.id === "string" && block.id.length > 0 && block.id.length <= 256 &&
        typeof block.name === "string" && block.name.trim().length > 0 && block.name.length <= 256 &&
        !tools.active.has(block.id) && !tools.completed.has(block.id)) {
      if (tools.active.size === 4096) throw new Error("tool-state-limit");
      tools.active.add(block.id);
      changed = true;
    } else if (event?.type === "user" && block?.type === "tool_result" &&
        tools.active.has(block.tool_use_id) && (typeof block.content === "string" || Array.isArray(block.content))) {
      tools.active.delete(block.tool_use_id);
      tools.completed.add(block.tool_use_id);
      if (tools.completed.size > 4096) tools.completed.delete(tools.completed.values().next().value);
      changed = true;
    }
  }
  return changed;
}

function codexSubstantive(event, items) {
  const item = event?.item;
  if (!item || typeof item.id !== "string" || item.id.length > 256) return false;
  if (["agent_message", "reasoning"].includes(item.type) && ["item.updated", "item.completed"].includes(event.type)) {
    if (typeof item.text !== "string" || !item.text.length) return false;
    const digest = createHash("sha256").update(item.text).digest("hex");
    if (items.get(item.id) === digest) return false;
    items.set(item.id, digest);
  } else if (["command_execution", "mcp_tool_call", "web_search"].includes(item.type) &&
      ["item.started", "item.completed"].includes(event.type)) {
    const state = `${item.type}:${event.type}`;
    if (items.get(item.id) === state || items.get(item.id)?.endsWith(":item.completed")) return false;
    items.set(item.id, state);
  } else return false;
  if (items.size > 4096) throw new Error("tool-state-limit");
  return true;
}

/** Ordinary host only. No qualification authority, retry, routing or scheduler. */
export function startOrdinaryClaudeStream({
  executable, args, cwd, environment, stdin, identity, progressPath, signal,
  limits: overrides = {}, onProgress, client = "claude-code",
}) {
  if (process.platform === "win32") throw new Error("Ordinary native streaming requires POSIX process groups");
  if (!["claude-code", "codex"].includes(client)) throw new Error("Invalid ordinary native client");
  const limits = { ...ordinaryStreamLimits, ...overrides };
  if (Object.keys(limits).some(key => !Object.hasOwn(ordinaryStreamLimits, key)) ||
      Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0) ||
      limits.warnMs >= limits.cancelMs || limits.termGraceMs >= limits.drainMs) {
    throw new Error("Invalid ordinary stream limits");
  }
  const ids = {};
  if (onProgress !== undefined && typeof onProgress !== "function") throw new Error("Invalid progress observer");
  for (const key of ["taskId", "runId", "requestId"]) {
    const value = identity?.[key];
    if (!["string", "number"].includes(typeof value) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(String(value))) {
      throw new Error("Invalid ordinary stream identity");
    }
    ids[key] = value;
  }
  // Exclusive private journal exists before spawn. No prompts, bodies or env enter it.
  const journal = openSync(progressPath, "wx", 0o600);
  const started = performance.now();
  let child, pid = null, lastActivity = started, lastReport = started;
  let stopAt, disposition, warned = false, killed = false, settled = false;
  let exited = false, closed = false, exitCode = null, exitSignal = null;
  let stdoutBytes = 0, stderrBytes = 0, activityCount = 0, line = Buffer.alloc(0);
  let stderr = Buffer.alloc(0), terminal, stdout = "", timer, spawnErrorCode;
  let journalFailed = false;
  const stderrHash = createHash("sha256");
  const terminationErrors = [];
  const toolState = { active: new Set(), completed: new Set(), thinking: new Set() };
  const codexItems = new Map();
  let threadId;
  let resolve;
  const completion = new Promise(done => { resolve = done; });
  const groupGone = () => {
    if (pid === null) return true;
    try { process.kill(-pid, 0); return false; }
    catch (error) { return error.code === "ESRCH"; }
  };
  const killGroup = kind => {
    if (pid === null) return;
    try { process.kill(-pid, kind); }
    catch (error) {
      if (error.code !== "ESRCH") terminationErrors.push({ signal: kind, code: error.code ?? "UNKNOWN" });
    }
  };
  const report = type => {
    if (journalFailed) return;
    const now = performance.now();
    const record = { schema: 1, ...ids, pid, type, at: new Date().toISOString(),
      elapsedMs: Math.round(now - started), inactiveMs: Math.round(now - lastActivity),
      activityCount, stdoutBytes, stderrBytes, disposition: disposition ?? null };
    try {
      const bytes = Buffer.from(JSON.stringify(record) + "\n");
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(journal, bytes, offset);
      fsyncSync(journal);
      lastReport = now;
    } catch {
      journalFailed = true;
      stop("progress-io-error");
    }
    try { onProgress?.(Object.freeze(record)); }
    catch { stop("progress-observer-error"); }
  };
  const stop = reason => {
    if (settled || disposition !== undefined) return;
    disposition = reason;
    stopAt = performance.now();
    killGroup("SIGTERM");
    report("stopping");
  };
  const abort = () => stop("cancelled");
  const finish = () => {
    if (settled) return;
    const groupQuiescent = groupGone();
    disposition ??= terminal ? "completed" : "invalid-output";
    report("terminal");
    if (journalFailed) disposition = "progress-io-error";
    settled = true;
    clearInterval(timer);
    signal?.removeEventListener("abort", abort);
    closeSync(journal);
    child?.stdin?.destroy();
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    child?.unref();
    resolve({ pid, disposition, exitCode, signal: exitSignal, reaped: exited,
      closed, groupQuiescent, custodyReleased: pid === null || (exited && closed && groupQuiescent),
      stdout, stderr: stderr.toString("utf8"), stderrSha256: stderrHash.digest("hex"),
      stderrTruncated: stderrBytes > stderr.length, stdoutBytes, stderrBytes,
      activityCount, durationMs: Math.round(performance.now() - started),
      spawnErrorCode, journalFailed, terminationErrors });
  };
  const tick = () => {
    if (settled) return;
    const now = performance.now();
    if (disposition === undefined) {
      const idle = now - lastActivity;
      if (idle >= limits.warnMs && !warned) { warned = true; report("inactivity-warning"); }
      if (idle >= limits.cancelMs) stop("stalled");
      else if (now - lastReport >= limits.progressMs) report("progress");
    }
    if (disposition !== undefined && !killed && now - stopAt >= limits.termGraceMs) {
      killed = true;
      killGroup("SIGKILL");
      report("kill");
    }
    if (exited && closed && groupGone()) finish();
    else if (disposition !== undefined && now - stopAt >= limits.drainMs) finish();
  };
  const parseLine = bytes => {
    let event;
    try { event = JSON.parse(bytes.toString("utf8")); } catch { return; }
    let active;
    try { active = client === "codex" ? codexSubstantive(event, codexItems) : substantive(event, toolState); }
    catch { stop("output-limit"); return; }
    if (active) {
      if (terminal !== undefined) { stop("invalid-output"); return; }
      lastActivity = performance.now();
      activityCount += 1;
      if (warned) { warned = false; report("activity-resumed"); }
    }
    if (client === "codex" && event?.type === "thread.started") {
      if (threadId !== undefined || typeof event.thread_id !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(event.thread_id)) {
        stop("invalid-output"); return;
      }
      threadId = event.thread_id;
    }
    if (client === "codex" && ["turn.completed", "turn.failed"].includes(event?.type)) {
      if (terminal !== undefined || threadId === undefined) { stop("invalid-output"); return; }
      terminal = true;
      stdout = JSON.stringify({ session_id: threadId, is_error: event.type === "turn.failed",
        ...(event.error?.message ? { result: event.error.message } : {}) });
    } else if (client === "claude-code" && event?.type === "result") {
      if (terminal !== undefined) { stop("invalid-output"); return; }
      terminal = true;
      // Preserve only terminal authority. Never retain reasoning/tool stream bodies.
      const result = {};
      for (const key of ["type", "subtype", "is_error", "session_id", "result", "structured_output", "errors"]) {
        if (Object.hasOwn(event, key)) result[key] = event[key];
      }
      try { stdout = JSON.stringify(result); }
      catch { stop("invalid-output"); }
    }
  };
  const appendStdout = chunk => {
    stdoutBytes += chunk.length;
    if (disposition !== undefined) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const next = end === -1 ? chunk.length : end;
      const part = chunk.subarray(offset, next);
      if (line.length + part.length > limits.maxRecordBytes) { stop("output-limit"); line = Buffer.alloc(0); return; }
      line = Buffer.concat([line, part]);
      if (end === -1) return;
      parseLine(line);
      line = Buffer.alloc(0);
      if (disposition !== undefined) return;
      offset = next + 1;
    }
  };
  if (signal?.aborted) { disposition = "cancelled"; finish(); return { pid, completion, cancel: abort }; }
  try {
    child = spawn(executable, args, { cwd, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    pid = child.pid ?? null;
  } catch (error) {
    spawnErrorCode = error.code ?? "UNKNOWN";
    disposition = "spawn-error";
    finish();
    return { pid, completion, cancel: abort };
  }
  child.stdout.on("data", appendStdout);
  child.stderr.on("data", chunk => {
    stderrBytes += chunk.length;
    stderrHash.update(chunk);
    const remaining = limits.maxStderrBytes - stderr.length;
    if (remaining > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("error", () => stop("stream-error"));
  child.stdin.on("error", error => { if (error.code !== "EPIPE") stop("stdin-error"); });
  child.once("error", error => {
    spawnErrorCode = error.code ?? "UNKNOWN";
    stop("spawn-error");
    if (pid === null) finish();
  });
  child.once("exit", (code, sig) => {
    exited = true; exitCode = code; exitSignal = sig;
    // A dead leader does not imply its descendants or inherited pipes stopped.
    if (!groupGone()) stop("descendant-retained");
    tick();
  });
  child.once("close", () => {
    closed = true;
    if (line.length && disposition === undefined) parseLine(line);
    line = Buffer.alloc(0);
    tick();
  });
  timer = setInterval(tick, Math.min(50, limits.warnMs, limits.termGraceMs));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  report("started");
  child.stdin.end(stdin);
  return Object.freeze({ pid, completion, cancel: abort });
}
