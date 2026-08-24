import { createHash } from "node:crypto";
import { runGit } from "./git.mjs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function records(output) {
  return output
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const separator = record.indexOf("\t");
      if (separator === -1) throw new Error("git ls-tree emitted an invalid record");
      return Object.freeze({ record, path: record.slice(separator + 1) });
    });
}

export async function treeManifest({ workspace, tree, home, exclude = [] }) {
  const excluded = new Set(exclude);
  const output = await runGit({
    args: ["ls-tree", "-r", "-z", tree],
    cwd: workspace,
    home,
    maxOutputBytes: 32 * 1024 * 1024,
  });
  const admitted = records(output)
    .filter(({ path }) => !excluded.has(path))
    .map(({ record }) => Buffer.from(record, "utf8"))
    .sort(Buffer.compare);
  const framed = Buffer.concat(
    admitted.flatMap((record) => [record, Buffer.from([0])]),
  );
  return Object.freeze({
    entries: admitted.length,
    sha256: sha256(framed),
  });
}
