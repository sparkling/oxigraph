import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const IDENTITY_FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"];
const REVIEWED_W3C_HOSTS = new Set(["www.w3.org", "w3c.github.io"]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readStableFile(path) {
  const pathBefore = lstatSync(path, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new Error(`stable file ${basename(path)} is not a regular file`);
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw new Error(
      `unable to open stable file ${basename(path)}: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("source is not a regular file");
    if (before.nlink !== 1n)
      throw new Error("source must have exactly one link");
    for (const field of ["dev", "ino"]) {
      if (pathBefore[field] !== before[field]) {
        throw new Error(`source path changed before read (${field})`);
      }
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const field of IDENTITY_FIELDS) {
      if (before[field] !== after[field]) {
        throw new Error(`source changed during read (${field})`);
      }
    }
    if (BigInt(bytes.length) !== before.size) {
      throw new Error("source byte count changed during read");
    }
    const pathAfter = lstatSync(path, { bigint: true });
    for (const field of IDENTITY_FIELDS) {
      if (before[field] !== pathAfter[field]) {
        throw new Error(`source path changed during read (${field})`);
      }
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export async function acquireRegisteredSource(
  document,
  {
    cacheRoot,
    repositoryRoot,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    maxBytes = MAX_SOURCE_BYTES,
  },
) {
  validateDocument(document);
  if (typeof fetchImpl !== "function") {
    throw new Error("a fetch implementation is required");
  }
  if (typeof cacheRoot !== "string" || !isAbsolute(cacheRoot)) {
    throw new Error("cacheRoot must be an absolute path");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  const cacheDirectory = prepareCacheDirectory(repositoryRoot, cacheRoot);

  const response = await fetchReviewedW3c(
    document.url,
    fetchImpl,
    AbortSignal.timeout(timeoutMs),
  );
  if (!response?.ok) {
    throw new Error(
      `${document.id} fetch failed with HTTP ${response?.status}`,
    );
  }
  if (!isReviewedW3cUrl(response.url)) {
    throw new Error(
      `${document.id} fetch ended at an unreviewed W3C HTTPS host`,
    );
  }
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
    throw new Error(
      `${document.id} returned non-HTML content type ${contentType}`,
    );
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${document.id} exceeds the source-size limit`);
  }
  const bytes = await readBoundedResponse(response, maxBytes, document.id);
  if (bytes.length === 0) {
    throw new Error(`${document.id} has an invalid source byte count`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== document.sha256) {
    throw new Error(
      `${document.id} registered source hash drift: expected ${document.sha256}, got ${actualHash}`,
    );
  }

  const cachePath = resolve(
    cacheDirectory,
    `${document.id}-${document.sha256}.html`,
  );
  publishExactFile(cachePath, bytes, { directory: cacheDirectory });
  const stableBytes = readStableFile(cachePath);
  if (!stableBytes.equals(bytes) || sha256(stableBytes) !== document.sha256) {
    throw new Error(`${document.id} stable cache verification failed`);
  }
  return Object.freeze({
    bytes: stableBytes,
    cachePath,
    fetchedUrl: response.url || document.url,
  });
}

async function readBoundedResponse(response, maxBytes, documentId) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(`${documentId} exceeds the source-size limit`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      length += chunk.length;
      if (length > maxBytes) {
        await reader.cancel("source-size limit exceeded");
        throw new Error(`${documentId} exceeds the source-size limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

export function publishExactFile(path, bytes, { directory }) {
  assertCacheDirectory(directory);
  if (dirname(resolve(path)) !== directory) {
    throw new Error("cache output path escapes its reviewed directory");
  }
  if (existsSync(path)) {
    const current = readStableFile(path);
    if (!current.equals(bytes)) {
      throw new Error(`${basename(path)} cache collision`);
    }
    return;
  }
  const temporary = `${path}.tmp-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertCacheDirectory(directory);
    linkSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary) && !lstatSync(temporary).isSymbolicLink()) {
      unlinkSync(temporary);
    }
  }
  assertCacheDirectory(directory);
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
  }
}

function validateDocument(document) {
  if (
    !document ||
    typeof document.id !== "string" ||
    !/^[a-z0-9-]+$/.test(document.id) ||
    !isReviewedW3cUrl(document.url) ||
    !/^[0-9a-f]{64}$/.test(document.sha256 ?? "")
  ) {
    throw new Error("invalid registered document descriptor");
  }
}

export function isReviewedW3cUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      REVIEWED_W3C_HOSTS.has(url.hostname.toLowerCase()) &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

async function fetchReviewedW3c(initialUrl, fetchImpl, signal) {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal,
    });
    if (!isReviewedW3cUrl(response?.url)) {
      throw new Error("W3C fetch response has an unreviewed HTTPS host");
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get?.("location");
    if (typeof location !== "string" || location.length === 0) {
      throw new Error("W3C redirect is missing its Location header");
    }
    const nextUrl = new URL(location, currentUrl).href;
    if (!isReviewedW3cUrl(nextUrl)) {
      throw new Error("W3C redirect targets an unreviewed HTTPS host");
    }
    await response.body?.cancel?.("following reviewed W3C redirect");
    currentUrl = nextUrl;
  }
  throw new Error(`W3C fetch exceeded ${MAX_REDIRECTS} redirects`);
}

function prepareCacheDirectory(repositoryRoot, cacheRoot) {
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) {
    throw new Error("repositoryRoot must be an absolute path");
  }
  const lexicalRoot = resolve(repositoryRoot);
  const lexicalCache = resolve(cacheRoot);
  const child = relative(lexicalRoot, lexicalCache);
  if (!inside(child)) {
    throw new Error("cacheRoot escapes the repository boundary");
  }
  const root = realpathSync(lexicalRoot);
  const path = resolve(root, child);
  rejectSymlinkComponents(root, path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  rejectSymlinkComponents(root, path);
  if (realpathSync(path) !== path) {
    throw new Error("cacheRoot does not resolve to its reviewed location");
  }
  assertCacheDirectory(path);
  return path;
}

function rejectSymlinkComponents(root, path) {
  let cursor = root;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`cacheRoot contains a symbolic link: ${cursor}`);
    }
  }
}

function assertCacheDirectory(path) {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(path) !== path
  ) {
    throw new Error("cache output directory is not canonical and symlink-free");
  }
}

function inside(relativePath) {
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
