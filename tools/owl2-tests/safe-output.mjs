import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);

function isInside(root, path) {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) &&
    !isAbsolute(child);
}

function safeOutputPath(path) {
  const lexical = resolve(path);
  if (!isInside(repositoryRoot, lexical)) {
    throw new Error(`output must remain inside the repository: ${path}`);
  }
  const parent = dirname(lexical);
  let cursor = repositoryRoot;
  for (const component of relative(repositoryRoot, parent).split(sep)) {
    if (!component) continue;
    cursor = join(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`output path contains a symlink: ${cursor}`);
    }
  }
  mkdirSync(parent, { recursive: true });
  if (!isInside(repositoryRoot, realpathSync(parent))) {
    throw new Error(`output parent escapes the repository: ${parent}`);
  }
  if (existsSync(lexical)) {
    const metadata = lstatSync(lexical);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`output target must be a regular file: ${lexical}`);
    }
  }
  return lexical;
}

export function atomicWrite(path, value) {
  const output = safeOutputPath(path);
  const temporary = join(
    dirname(output),
    `.${basename(output)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}
