// Small stdio adapter to the active native coding host, not a second agent host.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function stdioHost(directory, input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let pending;
  let closed = false;
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
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
    detach();
    lines.close();
  };
  const onInputError = (error) => fail(error);
  const onOutputError = (error) => fail(error);
  const onLinesError = (error) => fail(error);
  const onLine = (line) => {
    if (!pending) return fail(new Error("Unsolicited host response"));
    try {
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new Error("Host response exceeds structural limit");
      const result = JSON.parse(line);
      clearTimeout(pending.timer);
      const { resolve } = pending;
      pending = undefined;
      resolve(result);
    } catch (error) { fail(error); }
  };
  const onClose = () => fail(new Error("Host input closed before workflow completion"));
  input.on("error", onInputError);
  output.on("error", onOutputError);
  lines.on("error", onLinesError);
  lines.on("line", onLine);
  lines.on("close", onClose);
  return {
    request: (request) => new Promise((resolve, reject) => {
      if (closed || pending) return reject(new Error("Host bridge closed or already awaiting a result"));
      const path = join(directory, `request-${request.requestId}.json`);
      writeFileSync(path, JSON.stringify(request, null, 2) + "\n", { flag: "wx" });
      // Host tool turnaround bound, not a model usage/attempt budget.
      const timer = setTimeout(() => fail(new Error("Host action timed out after 30 minutes")), 1800000);
      pending = { resolve, reject, timer };
      try {
        output.write(JSON.stringify({ type: "host-request", action: request.action, requestId: request.requestId, path }) + "\n");
      } catch (error) { fail(error); }
    }),
    close: () => fail(new Error("Host bridge closed")),
  };
}
