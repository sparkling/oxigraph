import { spawn } from "node:child_process";
import { fstatSync } from "node:fs";
import { performance } from "node:perf_hooks";

const maximumInheritedFileDescriptors = 32;

function validatedInheritedFileDescriptors(value) {
  if (!Array.isArray(value) || value.length > maximumInheritedFileDescriptors) {
    throw new Error("inherited file descriptors must be a bounded array");
  }
  const descriptors = [...value];
  if (
    descriptors.some((descriptor) => !Number.isInteger(descriptor) || descriptor < 0) ||
    new Set(descriptors).size !== descriptors.length
  ) {
    throw new Error("inherited file descriptors must be unique non-negative integers");
  }
  for (const [index, descriptor] of descriptors.entries()) {
    try {
      fstatSync(descriptor);
    } catch (error) {
      throw new Error(`inherited file descriptor ${index} is not live`, { cause: error });
    }
  }
  return descriptors;
}

function terminate(child, signal, killProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return null;
  try {
    if (!Number.isInteger(child.pid)) child.kill(signal);
    else killProcess(-child.pid, signal);
    return null;
  } catch (error) {
    if (error.code === "ESRCH") return null;
    return `${error.code ?? error.name}: ${error.message}`;
  }
}

export function runBoundedProcess({
  executable,
  args,
  cwd,
  environment,
  stdin = "",
  timeoutMs,
  maxOutputBytes,
  signal,
  killProcess = process.kill,
  inheritedFileDescriptors = [],
}) {
  if (process.platform === "win32") {
    throw new Error("bounded process execution is disabled on Windows until job-object tree termination exists");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("process timeout must be a positive integer");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("process output ceiling must be a positive integer");
  }
  const inherited = validatedInheritedFileDescriptors(inheritedFileDescriptors);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe", ...inherited],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let disposition = "completed";
    let killTimer;
    let reapTimer;
    let timeout;
    let settled = false;
    let capturedBytes = 0;
    const terminationErrors = [];

    const outcome = (exitCode, exitSignal) =>
      Object.freeze({
        exitCode,
        signal: exitSignal,
        disposition,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Math.round(performance.now() - started),
        terminationErrors: Object.freeze([...terminationErrors]),
      });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      signal?.removeEventListener("abort", abort);
    };

    const stop = (reason) => {
      if (disposition !== "completed") return;
      disposition = reason;
      const termError = terminate(child, "SIGTERM", killProcess);
      if (termError !== null) terminationErrors.push({ signal: "SIGTERM", error: termError });
      killTimer = setTimeout(() => {
        const killError = terminate(child, "SIGKILL", killProcess);
        if (killError !== null) {
          terminationErrors.push({ signal: "SIGKILL", error: killError });
        }
      }, 250);
      reapTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        disposition = `${disposition}-unreaped`;
        cleanup();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve(outcome(null, null));
      }, 2_000);
    };
    const append = (target, chunk) => {
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (chunk.length > remaining) stop("output-limit");
      const admitted = chunk.subarray(0, remaining);
      capturedBytes += admitted.length;
      return admitted.length === 0 ? target : Buffer.concat([target, admitted]);
    };
    const abort = () => stop("cancelled");
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome(exitCode, exitSignal));
    });
    timeout = setTimeout(() => stop("timeout"), timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !settled) stop("stdin-error");
    });
    child.stdin.end(stdin);
  });
}
