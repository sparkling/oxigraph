import { spawn } from "node:child_process";

function signalTree(child, signal) {
  if (
    process.platform === "win32" ||
    !Number.isInteger(child.pid) ||
    child.pid <= 0
  ) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export async function runProcess(program, args, options = {}) {
  const capture = options.capture === true;
  const timeoutMs = options.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("every mutation subprocess needs a positive timeout");
  }
  const forceKillAfterMs = options.forceKillAfterMs ?? 5_000;
  const startedAt = new Date().toISOString();
  const startedNanoseconds = process.hrtime.bigint();
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutHandle;
    let forceKillHandle;
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      const endedAt = new Date().toISOString();
      const durationMs = Math.round(
        Number(process.hrtime.bigint() - startedNanoseconds) / 1_000_000,
      );
      resolvePromise({
        ...result,
        stdout,
        stderr,
        timedOut,
        timeoutMs,
        startedAt,
        endedAt,
        durationMs,
      });
    };
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      signalTree(child, "SIGTERM");
      forceKillHandle = setTimeout(
        () => signalTree(child, "SIGKILL"),
        forceKillAfterMs,
      );
      forceKillHandle.unref();
    }, timeoutMs);
    timeoutHandle.unref();
    child.once("error", (error) => {
      settle({ status: null, signal: null, error });
    });
    child.once("close", (status, signal) => {
      if (timedOut) signalTree(child, "SIGKILL");
      settle({ status, signal, error: null });
    });
  });
}
