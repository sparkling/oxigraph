import { createHash } from "node:crypto";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const BCP14 =
  /\b(?:MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL|REQUIRED)\b/g;
const ATOMIC_TAGS = new Set(["p", "li", "dt", "dd", "tr"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const OMITTED_TAGS = new Set([
  "head",
  "nav",
  "script",
  "style",
  "svg",
  "figure",
  "template",
]);
const VOID_TAGS = new Set([
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
export function extractClauseInventory(document, bytes) {
  const sourceSha256 = digest(bytes);
  if (sourceSha256 !== document.sha256) {
    throw new Error(`${document.id} clause source hash mismatch`);
  }
  let source;
  try {
    source = UTF8.decode(bytes);
  } catch (error) {
    throw new Error(`${document.id} clause source is not valid UTF-8`, {
      cause: error,
    });
  }
  source = source.replace(
    /<(script|style|svg|template)\b[\s\S]*?<\/\1\s*>/gi,
    " ",
  );

  const state = {
    allIds: new Set(),
    duplicateIds: new Set(),
    sectionIds: new Set(),
    productionNames: new Map(),
    capturedProductionNames: new Set(),
    raw: [],
    ordinal: 0,
  };
  const stack = [];
  for (const token of source.match(
    /<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g,
  ) ?? []) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {
      const atomic = stack.findLast((frame) => frame.atomic);
      if (atomic && !atomic.omitted) atomic.text.push(token);
      const heading = stack.findLast((frame) => frame.heading);
      if (heading && !heading.omitted) heading.text.push(token);
      const pre = stack.findLast((frame) => frame.tag === "pre");
      if (pre && !pre.omitted) pre.text.push(token);
      continue;
    }
    if (/^<\//.test(token)) {
      closeThrough(stack, closingTag(token), state, document);
      continue;
    }
    const element = openingTag(token);
    if (!element) continue;
    state.ordinal += 1;
    registerId(element.attrs.id, state);
    const classes = classTokens(element.attrs.class);
    const parent = stack.at(-1);
    const hasRfc2119Markup = classes.has("rfc2119");
    if (hasRfc2119Markup) {
      const atomic = stack.findLast((frame) => frame.atomic);
      if (atomic) atomic.rfc2119Markup = true;
    }
    const ownSection =
      element.tag === "section" && element.attrs.id
        ? element.attrs.id
        : undefined;
    const locallyInformative =
      classes.has("example") ||
      classes.has("issue") ||
      classes.has("note") ||
      ((element.tag === "section" || element.tag === "aside") &&
        (classes.has("informative") || classes.has("non-normative")));
    const frame = {
      ...element,
      ordinal: state.ordinal,
      sectionRef: ownSection ?? nearestSection(stack),
      informative:
        document.applicability === "informative" ||
        parent?.informative === true ||
        locallyInformative ||
        element.tag === "aside",
      omitted:
        parent?.omitted === true ||
        OMITTED_TAGS.has(element.tag) ||
        element.attrs.id === "toc",
      atomic: ATOMIC_TAGS.has(element.tag),
      heading: HEADING_TAGS.has(element.tag),
      productionRegion:
        ownSection === "section-grammar-productions" ||
        parent?.productionRegion === true,
      productionBlock:
        classes.has("productionOuter") ||
        parent?.productionBlock === true,
      rfc2119Markup:
        hasRfc2119Markup || parent?.rfc2119Markup === true,
      text: [],
    };
    if (ownSection) state.sectionIds.add(ownSection);
    stack.push(frame);
    if (element.selfClosing || VOID_TAGS.has(element.tag)) {
      finalize(stack.pop(), state, document);
    }
  }
  while (stack.length) finalize(stack.pop(), state, document);
  if (state.duplicateIds.size) {
    throw new Error(
      `${document.id} contains duplicate HTML ids: ${[
        ...state.duplicateIds,
      ]
        .sort()
        .join(",")}`,
    );
  }

  const records = materialize(document, sourceSha256, state.raw);
  return Object.freeze({
    records: Object.freeze(records),
    sectionIds: Object.freeze([...state.sectionIds].sort()),
    sourceSha256,
  });
}

function finalize(frame, state, document) {
  if (
    frame.omitted ||
    frame.informative ||
    document.applicability === "informative"
  ) {
    return;
  }
  const text = normalizeText(frame.text.join(" "));
  if (!text) return;
  const structuralRef = frame.attrs.id ?? `${frame.tag}-${frame.ordinal}`;

  if (frame.heading) {
    const production = text.match(
      /^(?:\d+(?:\.\d+)*\s+)?(?:Production|Grammar)\s+([A-Za-z_][A-Za-z0-9_-]*)$/i,
    );
    if (production) {
      state.productionNames.set(frame.sectionRef, production[1]);
    }
    return;
  }

  if (frame.tag === "pre") {
    const productions = splitProductions(text);
    if (productions.length) {
      for (const production of productions) {
        state.raw.push({
          kind: "grammar-production",
          sectionRef: frame.sectionRef,
          structuralRef: `${structuralRef}:${production.name}`,
          keywords: [],
          text: production.text,
        });
        state.capturedProductionNames.add(production.name);
      }
    } else {
      state.raw.push({
        kind: "normative-code-block",
        sectionRef: frame.sectionRef,
        structuralRef,
        keywords: [],
        text,
      });
    }
    return;
  }
  if (!frame.atomic) return;

  const sectionProductionName = state.productionNames.get(frame.sectionRef);
  if (
    frame.tag === "p" &&
    frame.productionRegion &&
    frame.productionBlock &&
    sectionProductionName &&
    !state.capturedProductionNames.has(sectionProductionName)
  ) {
    state.raw.push({
      kind: "grammar-production",
      sectionRef: frame.sectionRef,
      structuralRef: `${frame.sectionRef}:${sectionProductionName}`,
      keywords: [],
      text: `Production ${sectionProductionName} ${text}`,
    });
    state.capturedProductionNames.add(sectionProductionName);
    return;
  }

  const productions =
    frame.tag === "tr"
      ? [...splitProductions(text), ...splitRdfXmlProductionRow(text)]
      : [];
  if (productions.length) {
    for (const production of productions) {
      state.raw.push({
        kind: "grammar-production",
        sectionRef: frame.sectionRef,
        structuralRef: `${structuralRef}:${production.name}`,
        keywords: [],
        text: production.text,
      });
      state.capturedProductionNames.add(production.name);
    }
    return;
  }

  const sentences = splitSentences(text);
  let bcpIndex = 0;
  const prose = [];
  for (const sentence of sentences) {
    const keywords = bcpKeywords(sentence, frame.rfc2119Markup);
    if (!keywords.length) {
      prose.push(sentence);
      continue;
    }
    state.raw.push({
      kind: "bcp14-clause",
      sectionRef: frame.sectionRef,
      structuralRef: `${structuralRef}:bcp-${bcpIndex}`,
      keywords,
      text: sentence,
    });
    bcpIndex += 1;
  }
  if (bcpIndex === 0) {
    state.raw.push({
      kind:
        frame.tag === "tr"
          ? "normative-table-row"
          : frame.tag === "dt" || frame.tag === "dd"
            ? "normative-definition"
            : "normative-prose-block",
      sectionRef: frame.sectionRef,
      structuralRef,
      keywords: [],
      text,
    });
  } else if (prose.length) {
    state.raw.push({
      kind:
        frame.tag === "tr"
          ? "normative-table-row"
          : frame.tag === "dt" || frame.tag === "dd"
            ? "normative-definition"
            : "normative-prose-block",
      sectionRef: frame.sectionRef,
      structuralRef: `${structuralRef}:context`,
      keywords: [],
      text: prose.join(" "),
    });
  }
}

function materialize(document, sourceSha256, raw) {
  const records = [];
  const seen = new Set();
  for (const item of raw) {
    const textSha256 = digest(item.text);
    const identity = [
      document.id,
      item.kind,
      item.sectionRef,
      item.structuralRef,
      textSha256,
    ].join("\0");
    const id = `${document.id}:${item.kind}:${digest(identity).slice(0, 24)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const record = {
      id,
      documentId: document.id,
      family: document.family,
      documentApplicability: document.applicability,
      kind: item.kind,
      sectionRef: item.sectionRef,
      structuralRef: item.structuralRef,
      keywords: item.keywords,
      actor: "unassessed",
      disposition: "unassessed",
      textSha256,
      sourceSha256,
      excerpt: item.text.slice(0, 240),
    };
    record.bindingSha256 = digest(
      JSON.stringify([
        record.id,
        record.documentId,
        record.family,
        record.documentApplicability,
        record.kind,
        record.sectionRef,
        record.structuralRef,
        record.keywords,
        record.actor,
        record.disposition,
        record.textSha256,
        record.sourceSha256,
      ]),
    );
    records.push(Object.freeze(record));
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

function splitProductions(text) {
  const matches = [
    ...text.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_-]*)\s*::=/g),
  ];
  return matches.map((match, index) => {
    const start = match.index + match[0].lastIndexOf(match[1]);
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index
        : text.length;
    return {
      name: match[1],
      text: text.slice(start, end).trim(),
    };
  });
}

function splitRdfXmlProductionRow(text) {
  const match = text.match(
    /^(?:\d+(?:\.\d+)*\s+)?Production\s+([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)$/i,
  );
  return match
    ? [
        {
          name: match[1],
          text,
        },
      ]
    : [];
}

function splitSentences(text) {
  const result = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!".!?".includes(text[index])) continue;
    const tail = text.slice(index + 1);
    const whitespace = tail.match(/^\s+/)?.[0].length ?? 0;
    const next = text[index + 1 + whitespace];
    if (whitespace > 0 && (!next || /[A-Z0-9("'[]/.test(next))) {
      result.push(text.slice(start, index + 1).trim());
      start = index + 1 + whitespace;
      index = start - 1;
    }
  }
  const remainder = text.slice(start).trim();
  if (remainder) result.push(remainder);
  return result.length ? result : [text];
}

function bcpKeywords(text, marked) {
  const source = marked ? text.toUpperCase() : text;
  return [...new Set(source.match(BCP14) ?? [])].sort();
}

function closeThrough(stack, tag, state, document) {
  const index = stack.findLastIndex((frame) => frame.tag === tag);
  if (index < 0) return;
  while (stack.length > index) finalize(stack.pop(), state, document);
}

function openingTag(token) {
  const match = token.match(/^<\s*([A-Za-z][\w:-]*)([\s\S]*?)\/?\s*>$/);
  if (!match) return null;
  return {
    tag: match[1].toLowerCase(),
    attrs: attributes(match[2]),
    selfClosing: /\/\s*>$/.test(token),
  };
}

function closingTag(token) {
  return token.match(/^<\s*\/\s*([A-Za-z][\w:-]*)/)?.[1].toLowerCase();
}

function attributes(source) {
  const result = {};
  const pattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    result[match[1].toLowerCase()] =
      match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

function registerId(id, state) {
  if (!id) return;
  if (state.allIds.has(id)) state.duplicateIds.add(id);
  state.allIds.add(id);
}

function nearestSection(stack) {
  return (
    stack.findLast((frame) => frame.tag === "section")?.sectionRef ??
    "document"
  );
}

function classTokens(value = "") {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function normalizeText(text) {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function decodeEntities(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    times: "×",
  };
  return text.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/gi,
    (entity, hex, decimal, name) => {
      const value = hex
        ? Number.parseInt(hex, 16)
        : decimal
          ? Number.parseInt(decimal, 10)
          : undefined;
      if (value !== undefined) {
        try {
          return String.fromCodePoint(value);
        } catch {
          return entity;
        }
      }
      return named[name.toLowerCase()] ?? entity;
    },
  );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
