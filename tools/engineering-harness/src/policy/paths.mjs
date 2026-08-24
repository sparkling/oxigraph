import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { harnessRoot } from "../paths.mjs";

const globalPolicy = JSON.parse(
  readFileSync(new URL("./global-paths.json", import.meta.url), "utf8"),
);

function portable(path) {
  return path.replaceAll("\\", "/");
}

export function normalizeCandidatePath(path) {
  const candidate = portable(path);
  if (
    candidate.length === 0 ||
    candidate.includes("\0") ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate)
  ) {
    throw new Error(`candidate path is not repository-relative: ${path}`);
  }
  const normalized = posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`candidate path escapes repository: ${path}`);
  }
  return normalized.replace(/^\.\//, "");
}

function prefixed(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function pathEquals(left, right) {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function pathPrefixed(path, prefix) {
  return prefixed(
    path.toLocaleLowerCase("en-US"),
    prefix.toLocaleLowerCase("en-US"),
  );
}

export function validateCandidatePath(path, contract) {
  const normalized = normalizeCandidatePath(path);
  const scope = contract.scope ?? {};
  const blockedPrefixes = [
    ...globalPolicy.blockedPrefixes,
    ...(contract.blockedPaths ?? []),
    ...(scope.blockedPrefixes ?? []),
    contract.evaluatorPath ?? contract.evaluator?.path,
  ].filter(Boolean);
  const blockedExact = [
    ...globalPolicy.blockedExact,
    ...(scope.blockedExact ?? []),
  ].map(normalizeCandidatePath);
  if (
    blockedPrefixes.some((prefix) =>
      pathPrefixed(normalized, normalizeCandidatePath(prefix)),
    ) ||
    blockedExact.some((path) => pathEquals(normalized, path)) ||
    globalPolicy.blockedBasenames.some((basename) =>
      pathEquals(posix.basename(normalized), basename),
    )
  ) {
    throw new Error(`candidate path is protected: ${normalized}`);
  }
  const mutableExact = [
    ...(contract.mutableExact ?? []),
    ...(scope.mutableExact ?? []),
  ].map(normalizeCandidatePath);
  const mutablePrefixes = [
    ...(contract.mutablePaths ?? []),
    ...(scope.mutablePrefixes ?? []),
  ].map(normalizeCandidatePath);
  const admitted =
    mutableExact.some((path) => pathEquals(normalized, path)) ||
    mutablePrefixes.some((prefix) => pathPrefixed(normalized, prefix));
  if (!admitted) {
    throw new Error(`candidate path is outside mutable paths: ${normalized}`);
  }
  return normalized;
}

function hunkCount(value) {
  return value === undefined ? 1 : Number.parseInt(value, 10);
}

function assertFinished(section) {
  if (section === null) return;
  if (!section.oldHeaderSeen || !section.newHeaderSeen || section.hunks === 0) {
    throw new Error(`candidate diff is incomplete for ${section.path}`);
  }
  if (section.oldRemaining !== 0 || section.newRemaining !== 0) {
    throw new Error(`candidate hunk counts are invalid for ${section.path}`);
  }
}

export function patchPaths(patch, contract = {}) {
  if (typeof patch !== "string" || patch.length === 0) {
    throw new Error("candidate patch must be a non-empty unified diff");
  }
  if (/^(?:rename|copy) (?:from|to) /m.test(patch)) {
    throw new Error("candidate patch may not rename or copy paths");
  }
  if (/^(?:GIT binary patch|Binary files |diff --cc |diff --combined )/m.test(patch)) {
    throw new Error("candidate patch may not contain binary or combined diffs");
  }
  if (
    /^(?:old mode|new mode|deleted file mode|Subproject commit|[-+]Subproject commit)(?: |$)/m.test(
      patch,
    )
  ) {
    throw new Error("candidate patch may not change modes, symlinks, deletions, or submodules");
  }
  if (/^index [0-9a-f]+\.\.[0-9a-f]+ (?:120000|160000)$/mi.test(patch)) {
    throw new Error("candidate patch may not modify symlinks or submodules");
  }
  if (/^new file mode (?:120000|160000)$/m.test(patch)) {
    throw new Error("candidate patch may not create symlinks or submodules");
  }
  if (/^new file mode /m.test(patch) && contract.scope?.allowCreate !== true) {
    throw new Error("candidate patch may not create files");
  }
  const paths = [];
  let section = null;
  let changedLines = 0;
  for (const line of patch.split("\n")) {
    if (
      section !== null &&
      (section.oldRemaining > 0 || section.newRemaining > 0)
    ) {
      if (line.startsWith("\\ No newline at end of file")) continue;
      const marker = line[0];
      if (marker === " ") {
        section.oldRemaining -= 1;
        section.newRemaining -= 1;
      } else if (marker === "-") {
        section.oldRemaining -= 1;
        changedLines += 1;
      } else if (marker === "+") {
        section.newRemaining -= 1;
        changedLines += 1;
      } else {
        throw new Error(`candidate hunk is malformed for ${section.path}`);
      }
      if (section.oldRemaining < 0 || section.newRemaining < 0) {
        throw new Error(`candidate hunk counts are invalid for ${section.path}`);
      }
      continue;
    }
    const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (match !== null) {
      assertFinished(section);
      if (match[1] !== match[2]) {
        throw new Error("candidate patch may not rename paths");
      }
      const path = normalizeCandidatePath(match[1]);
      if (paths.includes(path)) {
        throw new Error(`candidate patch repeats a diff section for ${path}`);
      }
      section = {
        path,
        oldHeaderSeen: false,
        newHeaderSeen: false,
        hunks: 0,
        oldRemaining: 0,
        newRemaining: 0,
      };
      paths.push(path);
      continue;
    }
    const oldHeader = /^--- (.+)$/.exec(line);
    if (oldHeader !== null) {
      if (section === null || section.oldHeaderSeen || section.hunks > 0) {
        throw new Error("candidate patch contains an unbound old-file header");
      }
      const expected = `a/${section.path}`;
      if (oldHeader[1] !== expected && oldHeader[1] !== "/dev/null") {
        throw new Error(`candidate old-file header does not match ${section.path}`);
      }
      if (oldHeader[1] === "/dev/null" && contract.scope?.allowCreate !== true) {
        throw new Error("candidate patch may not create files");
      }
      section.oldHeaderSeen = true;
      continue;
    }
    const newHeader = /^\+\+\+ (.+)$/.exec(line);
    if (newHeader !== null) {
      if (
        section === null ||
        !section.oldHeaderSeen ||
        section.newHeaderSeen ||
        section.hunks > 0
      ) {
        throw new Error("candidate patch contains an unbound new-file header");
      }
      const expected = `b/${section.path}`;
      if (newHeader[1] !== expected || newHeader[1] === "/dev/null") {
        throw new Error(`candidate new-file header does not match ${section.path}`);
      }
      section.newHeaderSeen = true;
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk !== null) {
      if (section === null || !section.oldHeaderSeen || !section.newHeaderSeen) {
        throw new Error("candidate patch contains an unbound hunk");
      }
      section.hunks += 1;
      section.oldRemaining = hunkCount(hunk[1]);
      section.newRemaining = hunkCount(hunk[2]);
      if (section.oldRemaining === 0 && section.newRemaining === 0) {
        throw new Error(`candidate hunk is empty for ${section.path}`);
      }
      continue;
    }
    if (line === "\\ No newline at end of file" && section?.hunks > 0) {
      continue;
    }
    if (
      line.length > 0 &&
      !/^index [0-9a-f]+\.\.[0-9a-f]+(?: 100644)?$/i.test(line) &&
      !/^new file mode 100644$/.test(line)
    ) {
      throw new Error(`candidate patch contains unsupported metadata: ${line}`);
    }
  }
  if (paths.length === 0) {
    throw new Error("candidate patch has no diff --git path headers");
  }
  assertFinished(section);
  const maxChangedFiles = contract.ceilings?.maxChangedFiles ?? 16;
  const maxChangedLines = contract.ceilings?.maxChangedLines ?? 4096;
  if (!Number.isInteger(maxChangedFiles) || maxChangedFiles < 1 || maxChangedFiles > 32) {
    throw new Error("candidate changed-file ceiling is invalid");
  }
  if (!Number.isInteger(maxChangedLines) || maxChangedLines < 1 || maxChangedLines > 4096) {
    throw new Error("candidate changed-line ceiling is invalid");
  }
  if (new Set(paths).size > maxChangedFiles) {
    throw new Error(`candidate patch exceeds ${maxChangedFiles} changed files`);
  }
  if (changedLines > maxChangedLines) {
    throw new Error(`candidate patch exceeds ${maxChangedLines} changed lines`);
  }
  if (changedLines === 0) {
    throw new Error("candidate patch contains no changed lines");
  }
  return Object.freeze([...new Set(paths)]);
}

export function validateCandidatePatch(patch, contract) {
  const maxPatchBytes = contract.ceilings?.maxPatchBytes ?? 262_144;
  if (!Number.isInteger(maxPatchBytes) || maxPatchBytes < 1 || maxPatchBytes > 262_144) {
    throw new Error("candidate patch ceiling is invalid");
  }
  if (Buffer.byteLength(patch) > maxPatchBytes) {
    throw new Error(`candidate patch exceeds ${maxPatchBytes} bytes`);
  }
  const paths = patchPaths(patch, contract);
  for (const path of paths) validateCandidatePath(path, contract);
  return paths;
}

export const policySource = `${harnessRoot}/src/policy/global-paths.json`;
