import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { repositoryRoot } from "../paths.mjs";

export const SAFE_NATIVE_PATH =
  process.platform === "win32"
    ? ""
    : ["/usr/local/bin", "/usr/bin", "/bin"].join(delimiter);

const attestationCache = new Map();

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function trustedRoots(provider) {
  const userHome = realpathSync(userInfo().homedir);
  const providerRoots =
    provider === "codex"
      ? [join(userHome, ".codex/packages/standalone/releases")]
      : [join(userHome, ".local/share/claude/versions")];
  return [...providerRoots, "/usr/local/bin", "/usr/bin", "/bin"].map((path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  });
}

function candidateIsTrusted(provider, discoveredPath, resolvedPath) {
  if (!isAbsolute(discoveredPath) || !isAbsolute(resolvedPath)) return false;
  if (contained(repositoryRoot, resolvedPath) || contained(realpathSync(tmpdir()), resolvedPath)) {
    return false;
  }
  if (resolvedPath.split(sep).includes("node_modules")) return false;
  return trustedRoots(provider).some((root) => contained(root, resolvedPath));
}

export function resolveNativeExecutable(provider, searchPath = process.env.PATH ?? "") {
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`unsupported native provider: ${provider}`);
  }
  if (process.platform === "win32") {
    throw new Error("native provider execution is fail-closed on Windows until job-object isolation exists");
  }
  for (const directory of searchPath.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const discoveredPath = join(directory, provider);
    try {
      accessSync(discoveredPath, constants.X_OK);
      const resolvedPath = realpathSync(discoveredPath);
      if (!candidateIsTrusted(provider, discoveredPath, resolvedPath)) continue;
      const stat = statSync(resolvedPath);
      if (!stat.isFile() || (stat.mode & 0o022) !== 0) continue;
      const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
      if (stat.uid !== 0 && stat.uid !== uid) continue;
      const cacheKey = [
        provider,
        resolvedPath,
        stat.dev,
        stat.ino,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
      ].join(":");
      const cached = attestationCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const bytes = readFileSync(resolvedPath);
      const attestation = Object.freeze({
        provider,
        discoveredPath,
        path: resolvedPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: stat.size,
        mode: stat.mode & 0o777,
        uid: stat.uid,
        gid: stat.gid,
      });
      attestationCache.set(cacheKey, attestation);
      if (attestationCache.size > 4) {
        attestationCache.delete(attestationCache.keys().next().value);
      }
      return attestation;
    } catch {
      // Missing, inaccessible, or untrusted candidates are skipped fail-closed.
    }
  }
  throw new Error(`no trusted ${provider} executable found`);
}
