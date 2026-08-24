import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const harnessRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
export const repositoryRoot = realpathSync(resolve(harnessRoot, "../.."));

export function isContained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}
