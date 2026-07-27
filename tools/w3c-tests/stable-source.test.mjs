import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireRegisteredSource, readStableFile } from "./stable-source.mjs";

test("fetches, hash-verifies, publishes, and descriptor-stably rereads", async (t) => {
  const root = temporary(t);
  const bytes = Buffer.from("<html><p>fixed</p></html>");
  const document = descriptor(bytes);
  const result = await acquireRegisteredSource(document, {
    cacheRoot: join(root, "cache"),
    repositoryRoot: root,
    fetchImpl: responseFor(bytes),
  });
  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(readFileSync(result.cachePath), bytes);
});

test("rejects registered hash drift without publishing bytes", async (t) => {
  const root = temporary(t);
  const expected = Buffer.from("<html>expected</html>");
  const changed = Buffer.from("<html>changed</html>");
  await assert.rejects(
    acquireRegisteredSource(descriptor(expected), {
      cacheRoot: join(root, "cache"),
      repositoryRoot: root,
      fetchImpl: responseFor(changed),
    }),
    /registered source hash drift/,
  );
});

test("rejects non-HTML and oversized responses", async (t) => {
  const root = temporary(t);
  const bytes = Buffer.from("not html");
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "cache"),
      repositoryRoot: root,
      fetchImpl: responseFor(bytes, "text/plain"),
    }),
    /non-HTML content type/,
  );
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "cache"),
      repositoryRoot: root,
      fetchImpl: responseFor(bytes),
      maxBytes: bytes.length - 1,
    }),
    /source-size limit|invalid source byte count/,
  );
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "stream-cache"),
      repositoryRoot: root,
      fetchImpl: streamingResponseFor(Buffer.concat([bytes, bytes])),
      maxBytes: bytes.length,
    }),
    /source-size limit/,
  );
});

test("rejects a pre-existing cache collision", async (t) => {
  const root = temporary(t);
  const bytes = Buffer.from("<html>expected</html>");
  const document = descriptor(bytes);
  const first = await acquireRegisteredSource(document, {
    cacheRoot: join(root, "cache"),
    repositoryRoot: root,
    fetchImpl: responseFor(bytes),
  });
  writeFileSync(first.cachePath, "<html>corrupt</html>");
  await assert.rejects(
    acquireRegisteredSource(document, {
      cacheRoot: join(root, "cache"),
      repositoryRoot: root,
      fetchImpl: responseFor(bytes),
    }),
    /cache collision/,
  );
});

test("rejects unreviewed initial and redirected HTTPS hosts", async (t) => {
  const root = temporary(t);
  const bytes = Buffer.from("<html>expected</html>");
  await assert.rejects(
    acquireRegisteredSource(
      { ...descriptor(bytes), url: "https://attacker.example/spec" },
      {
        cacheRoot: join(root, "initial"),
        repositoryRoot: root,
        fetchImpl: responseFor(bytes),
      },
    ),
    /invalid registered document descriptor/,
  );
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "redirect"),
      repositoryRoot: root,
      fetchImpl: responseFor(
        bytes,
        "text/html",
        "https://attacker.example/spec",
      ),
    }),
    /unreviewed (?:W3C )?HTTPS host/,
  );
  let redirectRequests = 0;
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "manual-redirect"),
      repositoryRoot: root,
      fetchImpl: async (url) => {
        redirectRequests += 1;
        return {
          ok: false,
          status: 302,
          url,
          headers: {
            get(name) {
              return name === "location"
                ? "https://attacker.example/spec"
                : null;
            },
          },
        };
      },
    }),
    /redirect targets an unreviewed HTTPS host/,
  );
  assert.equal(redirectRequests, 1);
});

test("rejects escaping and symlinked cache directories", async (t) => {
  const root = temporary(t);
  const outside = temporary(t);
  const bytes = Buffer.from("<html>expected</html>");
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(outside, "escape"),
      repositoryRoot: root,
      fetchImpl: responseFor(bytes),
    }),
    /escapes the repository boundary/,
  );
  symlinkSync(outside, join(root, "cache"), "dir");
  await assert.rejects(
    acquireRegisteredSource(descriptor(bytes), {
      cacheRoot: join(root, "cache", "nested"),
      repositoryRoot: root,
      fetchImpl: responseFor(bytes),
    }),
    /contains a symbolic link/,
  );
});

test("descriptor-stable reads reject symbolic links and hard links", (t) => {
  const root = temporary(t);
  const source = join(root, "source");
  const symbolic = join(root, "symbolic");
  const hard = join(root, "hard");
  writeFileSync(source, "content");
  symlinkSync(source, symbolic);
  assert.throws(() => readStableFile(symbolic), /not a regular file/);
  linkSync(source, hard);
  assert.throws(() => readStableFile(source), /exactly one link/);
});

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-w3c-source-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function streamingResponseFor(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    url: "https://www.w3.org/spec",
    headers: {
      get(name) {
        return name === "content-type" ? "text/html" : null;
      },
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
}

function descriptor(bytes) {
  return {
    id: "rdf-fixture",
    url: "https://www.w3.org/spec",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function responseFor(
  bytes,
  contentType = "text/html",
  url = "https://www.w3.org/spec",
) {
  return async () => ({
    ok: true,
    status: 200,
    url,
    headers: {
      get(name) {
        if (name === "content-type") return contentType;
        if (name === "content-length") return String(bytes.length);
        return null;
      },
    },
    async arrayBuffer() {
      return bytes;
    },
  });
}
