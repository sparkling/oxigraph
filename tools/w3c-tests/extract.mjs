import { createHash } from "node:crypto";

const BCP14 =
  /\b(?:MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL|REQUIRED)\b/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function extractCandidates(document, bytes) {
  const sourceSha256 = digest(bytes);
  if (sourceSha256 !== document.sha256) {
    throw new Error(`${document.id} extraction source hash mismatch`);
  }
  let decoded;
  try {
    decoded = UTF8.decode(bytes);
  } catch (error) {
    throw new Error(`${document.id} source is not valid UTF-8`, {
      cause: error,
    });
  }
  const html = decoded.replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const state = {
    allIds: new Set(),
    duplicateIds: new Set(),
    sectionIds: new Set(),
    rawCandidates: [],
    elementOrdinal: 0,
  };
  const stack = [];
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) ??
    []) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {
      for (const frame of stack) {
        if (frame.capture) frame.text.push(token);
      }
      continue;
    }
    if (/^<\//.test(token)) {
      closeThrough(stack, parseClosingTag(token), state, document);
      continue;
    }
    const element = parseOpeningTag(token);
    if (!element) continue;
    state.elementOrdinal += 1;
    registerId(element, state);
    const sectionRef = nearestSection(stack);
    const grammarTable = stack.some((frame) => frame.grammarTable);
    const frame = {
      ...element,
      capture: shouldCapture(element, grammarTable),
      text: [],
      sectionRef,
      grammarTable:
        grammarTable || classTokens(element.attrs.class).has("grammarTable"),
      ordinal: state.elementOrdinal,
    };
    stack.push(frame);
    if (element.tag === "section" && element.attrs.id) {
      state.sectionIds.add(element.attrs.id);
    }
    if (element.selfClosing || VOID.has(element.tag)) {
      finalizeFrame(stack.pop(), state, document);
    }
  }
  while (stack.length) finalizeFrame(stack.pop(), state, document);
  if (state.duplicateIds.size) {
    throw new Error(
      `${document.id} contains duplicate HTML ids: ${[...state.duplicateIds]
        .sort()
        .join(",")}`,
    );
  }

  const candidates = materializeCandidates(
    document,
    sourceSha256,
    state.rawCandidates,
  );
  return Object.freeze({
    candidates: Object.freeze(candidates),
    sectionIds: Object.freeze([...state.sectionIds].sort()),
    sourceSha256,
  });
}

function shouldCapture(element, grammarTable) {
  return (
    ["p", "li", "pre"].includes(element.tag) ||
    /^h[1-6]$/.test(element.tag) ||
    (element.attrs.id?.startsWith("grammar-production-") ?? false) ||
    (grammarTable && /^r[A-Z0-9_]/.test(element.attrs.id ?? ""))
  );
}

function finalizeFrame(frame, state, document) {
  if (!frame.capture) return;
  const text = normalizeText(frame.text.join(""));
  if (!text) return;
  if (frame.tag === "p" || frame.tag === "li") {
    const keywords = [...text.matchAll(BCP14)].map((match) => match[0]);
    if (keywords.length) {
      state.rawCandidates.push({
        kind: "bcp14-block",
        sectionRef: frame.sectionRef,
        structuralRef: frame.attrs.id ?? `${frame.tag}-${frame.ordinal}`,
        keywords: [...new Set(keywords)],
        text,
      });
    }
  }
  const directGrammar = frame.attrs.id?.startsWith("grammar-production-");
  const queryGrammar =
    frame.grammarTable && /^r[A-Z0-9_]/.test(frame.attrs.id ?? "");
  if (directGrammar || queryGrammar) {
    state.rawCandidates.push({
      kind: "grammar-production",
      sectionRef: frame.sectionRef,
      structuralRef: frame.attrs.id,
      keywords: [],
      text,
    });
  }
  if (/^h[1-6]$/.test(frame.tag)) {
    const production = text.match(/\bProduction\s+([^\s:,(]+)/i)?.[1];
    if (production) {
      state.rawCandidates.push({
        kind: "syntax-production",
        sectionRef: frame.sectionRef,
        structuralRef: production,
        keywords: [],
        text,
      });
    }
  }
  if (frame.tag === "pre" && text.includes("::=")) {
    for (const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*::=/g)) {
      state.rawCandidates.push({
        kind: "syntax-production",
        sectionRef: frame.sectionRef,
        structuralRef: `${frame.attrs.id ?? `pre-${frame.ordinal}`}:${match[1]}`,
        keywords: [],
        text,
      });
    }
  }
}

function materializeCandidates(document, sourceSha256, rawCandidates) {
  const seenStructural = new Set();
  const result = [];
  for (const candidate of rawCandidates) {
    const structuralKey = `${candidate.kind}\0${candidate.structuralRef}`;
    if (candidate.kind !== "bcp14-block" && seenStructural.has(structuralKey)) {
      continue;
    }
    seenStructural.add(structuralKey);
    const textSha256 = digest(candidate.text);
    const identity = [
      document.id,
      candidate.kind,
      candidate.sectionRef,
      candidate.structuralRef,
      textSha256,
    ].join("\0");
    const id = `${document.id}:${candidate.kind}:${digest(identity).slice(0, 24)}`;
    const record = {
      id,
      documentId: document.id,
      family: document.family,
      kind: candidate.kind,
      sectionRef: candidate.sectionRef,
      structuralRef: candidate.structuralRef,
      keywords: candidate.keywords,
      textSha256,
      sourceSha256,
      excerpt: candidate.text.slice(0, 240),
    };
    record.bindingSha256 = digest(canonicalCandidate(record));
    result.push(Object.freeze(record));
  }
  const ids = new Set(result.map((item) => item.id));
  if (ids.size !== result.length) {
    throw new Error(`${document.id} candidate identifiers are not unique`);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalCandidate(candidate) {
  return JSON.stringify([
    candidate.id,
    candidate.documentId,
    candidate.family,
    candidate.kind,
    candidate.sectionRef,
    candidate.structuralRef,
    candidate.keywords,
    candidate.textSha256,
    candidate.sourceSha256,
  ]);
}

function closeThrough(stack, closingTag, state, document) {
  const index = stack.findLastIndex((frame) => frame.tag === closingTag);
  if (index < 0) return;
  while (stack.length > index) {
    finalizeFrame(stack.pop(), state, document);
  }
}

function parseOpeningTag(token) {
  const match = token.match(/^<\s*([A-Za-z][\w:-]*)([\s\S]*?)\/?\s*>$/);
  if (!match) return null;
  return {
    tag: match[1].toLowerCase(),
    attrs: parseAttributes(match[2]),
    selfClosing: /\/\s*>$/.test(token),
  };
}

function parseClosingTag(token) {
  return token.match(/^<\s*\/\s*([A-Za-z][\w:-]*)/)?.[1].toLowerCase();
}

function parseAttributes(source) {
  const attrs = {};
  const pattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function registerId(element, state) {
  const id = element.attrs.id;
  if (!id) return;
  if (state.allIds.has(id)) state.duplicateIds.add(id);
  state.allIds.add(id);
}

function nearestSection(stack) {
  return (
    stack.findLast((frame) => frame.tag === "section" && frame.attrs.id)?.attrs
      .id ?? "document"
  );
}

function classTokens(value = "") {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function normalizeText(text) {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function decodeEntities(text) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return text.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/gi,
    (entity, hex, decimal, name) => {
      if (hex) return safeCodePoint(Number.parseInt(hex, 16), entity);
      if (decimal) return safeCodePoint(Number.parseInt(decimal, 10), entity);
      return named[name.toLowerCase()] ?? entity;
    },
  );
}

function safeCodePoint(value, fallback) {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
