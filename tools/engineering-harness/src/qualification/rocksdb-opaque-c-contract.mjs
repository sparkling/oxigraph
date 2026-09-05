import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ORACLE_URL = new URL("./rocksdb-opaque-c-oracle.json", import.meta.url);
export const ROCKSDB_OPAQUE_C_ORACLE_SHA256 =
  "b1e494f22b1534ba429f005ebabd220870a838bd748b72b317785b0ae9dd6342";

const DEFAULT_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function blankExceptNewlines(value) {
  return value.replace(/[^\r\n]/gu, " ");
}

/**
 * Applies C/C++ translation phase 2 before comments, directives, or tokens are
 * interpreted.  The compacted source is accompanied by a projection back to
 * physical source offsets and lines so diagnostics do not silently become
 * logical-line diagnostics after a splice.
 */
function spliceCppTranslationLines(input) {
  if (!/\\(?:\r\n|\n|\r)/u.test(input)) {
    return { source: input, spliceEvents: [] };
  }
  const output = [];
  const spliceEvents = [];
  let sourceStart = 0;
  let normalizedLength = 0;
  let cumulativeRemoved = 0;
  let cumulativeLines = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\\") {
      const removed =
        input[index + 1] === "\n"
          ? 2
          : input[index + 1] === "\r"
            ? input[index + 2] === "\n"
              ? 3
              : 2
            : 0;
      if (removed > 0) {
        const prefix = input.slice(sourceStart, index);
        output.push(prefix);
        normalizedLength += prefix.length;
        cumulativeRemoved += removed;
        cumulativeLines += 1;
        spliceEvents.push({
          index: normalizedLength,
          cumulativeLines,
          cumulativeRemoved,
        });
        index += removed - 1;
        sourceStart = index + 1;
        continue;
      }
    }
  }
  output.push(input.slice(sourceStart));
  return {
    source: output.join(""),
    spliceEvents,
  };
}

function spliceProjectionAt(spliceEvents, index) {
  let left = 0;
  let right = spliceEvents.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (spliceEvents[middle].index <= index) left = middle + 1;
    else right = middle;
  }
  return left === 0
    ? { cumulativeLines: 0, cumulativeRemoved: 0 }
    : spliceEvents[left - 1];
}

function maskLexicalNoise(
  input,
  { nestedBlockComments = false, preserveStringLiterals = false } = {},
) {
  const output = [];
  let index = 0;

  const maskThrough = (stop) => {
    output.push(blankExceptNewlines(input.slice(index, stop)));
    index = stop;
  };

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "/" && next === "/") {
      const end = input.indexOf("\n", index + 2);
      maskThrough(end < 0 ? input.length : end);
      continue;
    }

    if (char === "/" && next === "*") {
      let cursor = index + 2;
      let depth = 1;
      while (cursor < input.length && depth > 0) {
        if (
          nestedBlockComments &&
          input[cursor] === "/" &&
          input[cursor + 1] === "*"
        ) {
          depth += 1;
          cursor += 2;
        } else if (input[cursor] === "*" && input[cursor + 1] === "/") {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      maskThrough(cursor);
      continue;
    }

    const rustRaw = /^(?:br|r)(#+)?"/u.exec(input.slice(index));
    if (rustRaw) {
      const hashes = rustRaw[1] ?? "";
      const close = `"${hashes}`;
      const end = input.indexOf(close, index + rustRaw[0].length);
      maskThrough(end < 0 ? input.length : end + close.length);
      continue;
    }

    const cppRaw = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/u.exec(
      input.slice(index),
    );
    if (cppRaw) {
      const close = `)${cppRaw[1]}"`;
      const end = input.indexOf(close, index + cppRaw[0].length);
      maskThrough(end < 0 ? input.length : end + close.length);
      continue;
    }

    const quoted = /^(?:u8|u|U|L|b|c)?(["'])/u.exec(input.slice(index));
    if (quoted) {
      const quote = quoted[1];
      if (quote === "'") {
        const lifetime = /^'[A-Za-z_][A-Za-z0-9_]*/u.exec(input.slice(index));
        if (lifetime && input[index + lifetime[0].length] !== "'") {
          output.push(char);
          index += 1;
          continue;
        }
      }
      let cursor = index + quoted[0].length;
      while (cursor < input.length) {
        if (input[cursor] === "\\") {
          cursor += 2;
        } else if (input[cursor] === quote) {
          cursor += 1;
          break;
        } else {
          cursor += 1;
        }
      }
      if (preserveStringLiterals && quote === '"') {
        output.push(input.slice(index, cursor));
        index = cursor;
        continue;
      }
      maskThrough(cursor);
      continue;
    }

    output.push(char);
    index += 1;
  }
  return output.join("");
}

function definitelyKnownCondition(expression) {
  const normalized = expression
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gu, "")
    .replace(/[()\s]/gu, "")
    .toLowerCase();
  if (["0", "false"].includes(normalized)) return false;
  if (["1", "true"].includes(normalized)) return true;
  return null;
}

/**
 * Removes only branches that are provably inactive without macro expansion.
 * Unknown preprocessor branches are all scanned, so a mirror cannot hide
 * behind a build-specific define.
 */
export function maskDefinitelyInactivePreprocessor(
  input,
  { language = "cpp" } = {},
) {
  const translated =
    language === "cpp"
      ? spliceCppTranslationLines(input)
      : {
          source: input,
          spliceEvents: [],
        };
  const source = maskLexicalNoise(translated.source, {
    nestedBlockComments: language === "rust",
    preserveStringLiterals: language === "rust",
  });
  if (language === "rust") {
    return {
      source,
      macros: [],
      includes: [],
      spliceEvents: [],
    };
  }

  const lines = source.match(/.*(?:\r\n|\n|\r|$)/gu) ?? [];
  const originalLines = translated.source.match(/.*(?:\r\n|\n|\r|$)/gu) ?? [];
  const stack = [];
  let active = true;
  const output = [];
  const macros = [];
  const includes = [];
  let sourceOffset = 0;
  let fallbackLineNumber = 1;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const logicalLines = [lines[lineIndex]];
    const originalLogicalLines = [originalLines[lineIndex]];
    while (
      /\\(?:\r\n|\n|\r)$/u.test(logicalLines.at(-1)) &&
      lineIndex + 1 < lines.length
    ) {
      lineIndex += 1;
      logicalLines.push(lines[lineIndex]);
      originalLogicalLines.push(originalLines[lineIndex]);
    }
    const line = logicalLines.join("");
    const lineNumber =
      fallbackLineNumber +
      spliceProjectionAt(translated.spliceEvents, sourceOffset).cumulativeLines;
    sourceOffset += line.length;
    const lineBreaks = (line.match(/\n|\r(?!\n)/gu) ?? []).length;
    if (line.length === 0) continue;
    const logical = line.replace(/\\(?:\r\n|\n|\r)/gu, "");
    const originalLogical = originalLogicalLines
      .join("")
      .replace(/\\(?:\r\n|\n|\r)/gu, "");
    const directive =
      /^\s*(?:#|%:)\s*([A-Za-z_][A-Za-z0-9_]*)\b([^\r\n]*)/u.exec(
        logical,
      );
    if (!directive) {
      output.push(active ? line : blankExceptNewlines(line));
      fallbackLineNumber += lineBreaks;
      continue;
    }

    const [, rawKeyword, expression] = directive;
    const keyword = rawKeyword.toLowerCase();
    if (["if", "ifdef", "ifndef"].includes(keyword)) {
      const condition =
        keyword === "if" ? definitelyKnownCondition(expression) : null;
      const guardName =
        keyword === "ifndef"
          ? (/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(expression)?.[1] ?? null)
          : keyword === "if"
            ? (/^\s*!\s*defined\s*(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/u.exec(
                expression,
              )?.[1] ?? null)
            : null;
      const frame = {
        parentActive: active,
        condition,
        branchTaken: condition === true,
        unknown: condition === null,
        guardName,
      };
      stack.push(frame);
      active = frame.parentActive && condition !== false;
    } else if (keyword === "elif") {
      const frame = stack.at(-1);
      if (frame) {
        if (frame.condition === null) {
          active = frame.parentActive;
        } else if (frame.branchTaken) {
          active = false;
        } else {
          const condition = definitelyKnownCondition(expression);
          frame.condition = condition;
          frame.branchTaken = condition === true;
          if (condition === null) frame.unknown = true;
          active = frame.parentActive && condition !== false;
        }
      }
    } else if (keyword === "else") {
      const frame = stack.at(-1);
      if (frame) {
        active =
          frame.condition === null
            ? frame.parentActive
            : frame.parentActive && !frame.branchTaken;
        frame.branchTaken = true;
      }
    } else if (keyword === "endif") {
      const frame = stack.pop();
      active = frame?.parentActive ?? true;
    } else if (keyword === "define" && active) {
      const unknownFrames = stack.filter((frame) => frame.unknown);
      macros.push({
        kind: "define",
        line: lineNumber,
        expression,
        conditional: unknownFrames.length > 0,
        unknownConditionalCount: unknownFrames.length,
        unknownGuardNames: unknownFrames.flatMap(({ guardName }) =>
          guardName === null ? [] : [guardName],
        ),
      });
    } else if (keyword === "undef" && active) {
      const unknownFrames = stack.filter((frame) => frame.unknown);
      macros.push({
        kind: "undef",
        line: lineNumber,
        expression,
        conditional: unknownFrames.length > 0,
        unknownConditionalCount: unknownFrames.length,
        unknownGuardNames: unknownFrames.flatMap(({ guardName }) =>
          guardName === null ? [] : [guardName],
        ),
      });
    } else if (
      ["import", "include", "include_next"].includes(keyword) &&
      active
    ) {
      const unknownFrames = stack.filter((frame) => frame.unknown);
      const originalDirective =
        /^\s*(?:#|%:)\s*[A-Za-z_][A-Za-z0-9_]*\b([^\r\n]*)/u.exec(
          originalLogical,
        );
      includes.push({
        keyword,
        line: lineNumber,
        expression: originalDirective?.[1] ?? expression,
        conditional: unknownFrames.length > 0,
        unknownConditionalCount: unknownFrames.length,
        unknownGuardNames: unknownFrames.flatMap(({ guardName }) =>
          guardName === null ? [] : [guardName],
        ),
      });
    }
    output.push(blankExceptNewlines(line));
    fallbackLineNumber += lineBreaks;
  }
  return {
    source: output.join(""),
    macros,
    includes,
    spliceEvents: translated.spliceEvents,
  };
}

function advanceLine(state, value) {
  state.line += (value.match(/\n|\r(?!\n)/gu) ?? []).length;
}

const C_DIGRAPHS = new Map([
  ["%:%:", "##"],
  ["%:", "#"],
  ["<%", "{"],
  ["%>", "}"],
  ["<:", "["],
  [":>", "]"],
]);

function tokenizeMaskedCode(source, { spliceEvents = [] } = {}) {
  const tokens = [];
  const state = { line: 1 };
  let index = 0;

  const push = (value, tokenIndex = index) => {
    const projection = spliceProjectionAt(spliceEvents, tokenIndex);
    tokens.push({
      value,
      line: state.line + projection.cumulativeLines,
      index: tokenIndex + projection.cumulativeRemoved,
    });
  };

  while (index < source.length) {
    const start = index;
    const char = source[index];
    const next = source[index + 1];

    if (/\s/u.test(char)) {
      const whitespace = /^\s+/u.exec(source.slice(index))[0];
      advanceLine(state, whitespace);
      index += whitespace.length;
      continue;
    }

    if (char === '"') {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") cursor += 2;
        else if (source[cursor] === '"') {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      push(source.slice(index, cursor), start);
      advanceLine(state, source.slice(index, cursor));
      index = cursor;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(index));
    if (identifier) {
      push(identifier[0], start);
      index += identifier[0].length;
      continue;
    }

    const number = /^(?:0[xX][0-9A-Fa-f]+|[0-9]+)/u.exec(source.slice(index));
    if (number) {
      push(number[0], start);
      index += number[0].length;
      continue;
    }

    const punctuation = [
      "->*",
      "...",
      "%:%:",
      "::",
      "->",
      "[[",
      "]]",
      "&&",
      "||",
      "##",
      "%:",
      "<%",
      "%>",
      "<:",
      ":>",
    ].find((candidate) => source.startsWith(candidate, index));
    if (punctuation) {
      push(C_DIGRAPHS.get(punctuation) ?? punctuation, start);
      index += punctuation.length;
      continue;
    }

    push(char, start);
    index += 1;
  }
  return tokens;
}

function parseMacros(records) {
  const macros = new Map();
  const failures = [];
  for (const record of records) {
    if (record.kind === "undef") {
      const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(record.expression)?.[1];
      if (name) {
        const events = macros.get(name) ?? [];
        events.push({ line: record.line, definition: null });
        macros.set(name, events);
      }
      continue;
    }
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(\(([^)]*)\))?\s*(.*)$/u.exec(
      record.expression,
    );
    if (!match) {
      failures.push({ line: record.line, reason: "unparsed macro definition" });
      continue;
    }
    const [, name, parameterGroup, parameterText, replacement] = match;
    const rawParameters = parameterGroup
      ? parameterText
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : null;
    let parameters = rawParameters;
    let variadic = false;
    if (parameters?.includes("...")) {
      if (parameters.at(-1) !== "...") {
        failures.push({
          line: record.line,
          reason: `${name} has a non-terminal variadic parameter`,
        });
      } else {
        parameters = parameters.slice(0, -1);
        variadic = true;
      }
    }
    if (parameters?.some((parameter) => parameter.endsWith("..."))) {
      failures.push({
        line: record.line,
        reason: `${name} uses unsupported named variadic parameters`,
      });
    }
    const replacementTokens = tokenizeMaskedCode(replacement).map((token) => ({
      ...token,
      line: record.line,
    }));
    if (
      replacementTokens.some(({ value }) =>
        ["#", "__VA_OPT__"].includes(value),
      ) ||
      (!variadic &&
        replacementTokens.some(({ value }) => value === "__VA_ARGS__"))
    ) {
      failures.push({
        line: record.line,
        reason: `${name} uses unsupported macro replacement operators`,
      });
    }
    const events = macros.get(name) ?? [];
    events.push({
      line: record.line,
      definition: { parameters, replacement: replacementTokens, variadic },
    });
    macros.set(name, events);
  }
  Object.defineProperty(macros, "macroFailures", { value: failures });
  return macros;
}

function macroDefinitionAt(macros, name, line) {
  const events = macros.get(name) ?? [];
  let definition = null;
  for (const event of events) {
    if (event.line > line) break;
    definition = event.definition;
  }
  return definition;
}

function splitTopLevelTokenRanges(tokens) {
  const ranges = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (["(", "[", "{"].includes(tokens[index].value)) depth += 1;
    if ([")", "]", "}"].includes(tokens[index].value)) depth -= 1;
    if (tokens[index].value === "," && depth === 0) {
      ranges.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  ranges.push(tokens.slice(start));
  return ranges;
}

const FROZEN_RUST_TARGET = Object.freeze({
  triple: "x86_64-unknown-linux-gnu",
  flags: Object.freeze({ test: false, unix: true, windows: false }),
  values: Object.freeze({
    feature: Object.freeze(["rocksdb"]),
    target_arch: "x86_64",
    target_endian: "little",
    target_env: "gnu",
    target_family: "unix",
    target_os: "linux",
    target_pointer_width: "64",
    target_vendor: "unknown",
  }),
});

const EXPECTED_RUST_FFI_RESULT_CONTRACT = Object.freeze({
  macro: "ffi_result",
  tokenSha256:
    "0f6f5b268837035ce83f7751fe95e28ab1260a77812248b03fddb0dd3505af20",
});

function rustStringValue(token) {
  if (!/^"(?:\\.|[^"\\])*"$/u.test(token?.value ?? "")) return null;
  try {
    return JSON.parse(token.value);
  } catch {
    return null;
  }
}

function definitelyKnownRustCfg(tokens, target = FROZEN_RUST_TARGET) {
  if (tokens.length === 1 && tokens[0].value === "true") return true;
  if (tokens.length === 1 && tokens[0].value === "false") return false;
  if (tokens.length === 1 && tokens[0].value in target.flags) {
    return target.flags[tokens[0].value];
  }
  if (tokens.length === 3 && tokens[1].value === "=") {
    const key = tokens[0].value;
    const expected = rustStringValue(tokens[2]);
    const configured = target.values[key];
    if (expected === null || configured === undefined) return null;
    return Array.isArray(configured)
      ? configured.includes(expected)
      : configured === expected;
  }
  const operator = tokens[0]?.value;
  if (
    !["all", "any", "not"].includes(operator) ||
    tokens[1]?.value !== "(" ||
    matchingToken(tokens, 1, "(", ")") !== tokens.length - 1
  ) {
    return null;
  }
  const arguments_ = splitTopLevelTokenRanges(tokens.slice(2, -1));
  const values =
    tokens.length === 3
      ? []
      : arguments_.map((argument) => definitelyKnownRustCfg(argument, target));
  if (operator === "not") {
    return values.length === 1 && values[0] !== null ? !values[0] : null;
  }
  if (operator === "all") {
    if (values.includes(false)) return false;
    return values.every((value) => value === true) ? true : null;
  }
  if (values.includes(true)) return true;
  return values.every((value) => value === false) ? false : null;
}

function rustAttributeDisposition(tokens, target) {
  const name = tokens[0]?.value;
  if (name === "cfg" && tokens[1]?.value === "(") {
    const close = matchingToken(tokens, 1, "(", ")");
    return close === tokens.length - 1
      ? definitelyKnownRustCfg(tokens.slice(2, close), target)
      : null;
  }
  if (name !== "cfg_attr" || tokens[1]?.value !== "(") return true;
  const close = matchingToken(tokens, 1, "(", ")");
  if (close !== tokens.length - 1) return null;
  const arguments_ = splitTopLevelTokenRanges(tokens.slice(2, close));
  const predicate = definitelyKnownRustCfg(arguments_[0] ?? [], target);
  if (predicate === null) return null;
  if (!predicate) return true;
  for (const attribute of arguments_.slice(1)) {
    const disposition = rustAttributeDisposition(attribute, target);
    if (disposition !== true) return disposition;
  }
  return true;
}

function rustAttributedItemEnd(tokens, start) {
  let itemHead = start;
  while (
    ["pub", "unsafe", "async", "const", "extern", "default"].includes(
      tokens[itemHead]?.value,
    )
  ) {
    if (
      tokens[itemHead].value === "pub" &&
      tokens[itemHead + 1]?.value === "("
    ) {
      const close = matchingToken(tokens, itemHead + 1, "(", ")");
      if (close < 0) return tokens.length;
      itemHead = close + 1;
    } else {
      itemHead += 1;
      if (/^"/u.test(tokens[itemHead]?.value ?? "")) itemHead += 1;
    }
  }
  if (tokens[itemHead]?.value === "fn") {
    const fnIndex = itemHead;
    let cursor = fnIndex + 2;
    if (tokens[cursor]?.value === "<") {
      const closeGenerics = matchingToken(tokens, cursor, "<", ">");
      if (closeGenerics < 0) return tokens.length;
      cursor = closeGenerics + 1;
    }
    if (tokens[cursor]?.value !== "(") return tokens.length;
    const closeParameters = matchingToken(tokens, cursor, "(", ")");
    if (closeParameters < 0) return tokens.length;
    let squareDepth = 0;
    let angleDepth = 0;
    for (cursor = closeParameters + 1; cursor < tokens.length; cursor += 1) {
      const value = tokens[cursor].value;
      if (value === "[") squareDepth += 1;
      if (value === "]") squareDepth -= 1;
      if (value === "<") angleDepth += 1;
      if (value === ">") angleDepth -= 1;
      if (value === ";" && squareDepth === 0 && angleDepth === 0)
        return cursor + 1;
      if (value === "{" && squareDepth === 0 && angleDepth === 0) {
        const close = matchingToken(tokens, cursor, "{", "}");
        return close < 0 ? tokens.length : close + 1;
      }
    }
    return tokens.length;
  }
  let cursor = start;
  while (cursor < tokens.length) {
    if (tokens[cursor].value === "{") {
      const close = matchingToken(tokens, cursor, "{", "}");
      return close < 0 ? tokens.length : close + 1;
    }
    if ([";", ","].includes(tokens[cursor].value)) return cursor + 1;
    cursor += 1;
  }
  return tokens.length;
}

function filterDefinitelyInactiveRust(tokens, target = FROZEN_RUST_TARGET) {
  const ranges = [];
  const failures = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== "#" || tokens[index + 1]?.value !== "[")
      continue;
    const closeAttribute = matchingToken(tokens, index + 1, "[", "]");
    if (closeAttribute < 0) {
      failures.push({ line: tokens[index].line, reason: "unclosed attribute" });
      ranges.push([index, tokens.length]);
      break;
    }
    const disposition = rustAttributeDisposition(
      tokens.slice(index + 2, closeAttribute),
      target,
    );
    if (disposition === true) {
      index = closeAttribute;
      continue;
    }
    const end = rustAttributedItemEnd(tokens, closeAttribute + 1);
    ranges.push([index, end]);
    if (disposition === null) {
      failures.push({
        line: tokens[index].line,
        reason: "unsupported or unknown cfg predicate",
      });
    }
    index = Math.max(index, end - 1);
  }
  const cfgFiltered = tokens.filter((_, index) =>
    ranges.every(([start, end]) => index < start || index >= end),
  );
  const macroRanges = [];
  const macroDefinitions = [];
  let macroBraceDepth = 0;
  const macroDepthAt = cfgFiltered.map(({ value }) => {
    const current = macroBraceDepth;
    if (value === "{") macroBraceDepth += 1;
    if (value === "}") macroBraceDepth -= 1;
    return current;
  });
  for (let index = 0; index < cfgFiltered.length; index += 1) {
    if (
      cfgFiltered[index].value !== "macro_rules" ||
      cfgFiltered[index + 1]?.value !== "!"
    ) {
      continue;
    }
    const open = cfgFiltered.findIndex(
      ({ value }, cursor) =>
        cursor > index + 1 && ["(", "[", "{"].includes(value),
    );
    if (open < 0) continue;
    const closing = { "(": ")", "[": "]", "{": "}" }[cfgFiltered[open].value];
    const close = matchingToken(
      cfgFiltered,
      open,
      cfgFiltered[open].value,
      closing,
    );
    if (close >= 0) {
      const definitionTokens = cfgFiltered.slice(index, close + 1);
      macroDefinitions.push({
        name: cfgFiltered[index + 2]?.value ?? null,
        line: cfgFiltered[index].line,
        sourceIndex: cfgFiltered[index].index,
        depth: macroDepthAt[index],
        tokenSha256: sha256(
          Buffer.from(JSON.stringify(tokenValues(definitionTokens))),
        ),
      });
      macroRanges.push([index, close + 1]);
    }
  }
  const macroFiltered = cfgFiltered.filter((_, index) =>
    macroRanges.every(([start, end]) => index < start || index >= end),
  );
  const deadRanges = [];
  for (let index = 0; index < macroFiltered.length; index += 1) {
    if (!["if", "while"].includes(macroFiltered[index].value)) continue;
    let openBody = -1;
    if (
      macroFiltered[index + 1]?.value === "false" &&
      macroFiltered[index + 2]?.value === "{"
    ) {
      openBody = index + 2;
    } else if (
      macroFiltered[index + 1]?.value === "cfg" &&
      macroFiltered[index + 2]?.value === "!" &&
      macroFiltered[index + 3]?.value === "("
    ) {
      const closeCfg = matchingToken(macroFiltered, index + 3, "(", ")");
      if (
        closeCfg >= 0 &&
        macroFiltered[closeCfg + 1]?.value === "{" &&
        definitelyKnownRustCfg(macroFiltered.slice(index + 4, closeCfg)) ===
          false
      ) {
        openBody = closeCfg + 1;
      }
    }
    if (openBody < 0) continue;
    const close = matchingToken(macroFiltered, openBody, "{", "}");
    if (close >= 0) deadRanges.push([index, close + 1]);
  }
  const filtered = macroFiltered.filter((_, index) =>
    deadRanges.every(([start, end]) => index < start || index >= end),
  );
  Object.defineProperty(filtered, "rustCfgFailures", { value: failures });
  Object.defineProperty(filtered, "rustMacroDefinitions", {
    value: macroDefinitions,
  });
  return filtered;
}

function macroArguments(tokens, openIndex) {
  const closeIndex = matchingToken(tokens, openIndex, "(", ")");
  if (closeIndex < 0) return null;
  const args = [];
  let current = [];
  let depth = 0;
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const value = tokens[index].value;
    if (["(", "[", "{"].includes(value)) depth += 1;
    if ([")", "]", "}"].includes(value)) depth -= 1;
    if (value === "," && depth === 0) {
      args.push(current);
      current = [];
    } else {
      current.push(tokens[index]);
    }
  }
  args.push(current);
  return { args, closeIndex };
}

function substituteMacro(
  definition,
  args,
  line,
  { macros = null, state = null, depth = 0 } = {},
) {
  const rawBindings = new Map(
    (definition.parameters ?? []).map((parameter, index) => [
      parameter,
      args[index] ?? [],
    ]),
  );
  if (definition.variadic) {
    const variadic = [];
    for (const [index, argument] of args
      .slice(definition.parameters.length)
      .entries()) {
      if (index > 0) variadic.push({ value: ",", line, index: 0 });
      variadic.push(...argument);
    }
    rawBindings.set("__VA_ARGS__", variadic);
  }
  const expandedBindings = new Map(
    [...rawBindings].map(([parameter, values]) => [
      parameter,
      macros === null || state === null
        ? values
        : expandMacrosRecursive(values, macros, state, depth + 1),
    ]),
  );
  const expanded = [];
  let paste = false;
  for (let index = 0; index < definition.replacement.length; index += 1) {
    const token = definition.replacement[index];
    if (token.value === "##") {
      paste = true;
      continue;
    }
    const adjacentToPaste =
      definition.replacement[index - 1]?.value === "##" ||
      definition.replacement[index + 1]?.value === "##";
    const bindings = adjacentToPaste ? rawBindings : expandedBindings;
    const values = bindings.has(token.value)
      ? bindings.get(token.value).map((value) => ({ ...value, line }))
      : [{ ...token, line }];
    if (paste && expanded.length > 0 && values.length > 0) {
      const left = expanded.pop();
      const right = values.shift();
      expanded.push({ ...left, value: `${left.value}${right.value}`, line });
      paste = false;
    }
    expanded.push(...values);
  }
  return expanded;
}

function expandMacrosRecursive(tokens, macros, state, depth = 0) {
  if (depth >= 32) {
    if (
      tokens.some(
        (token) => macroDefinitionAt(macros, token.value, token.line) !== null,
      )
    ) {
      state.failures.push({
        line: tokens[0]?.line ?? null,
        reason: "macro expansion depth exceeded 32",
      });
    }
    return tokens;
  }
  if (macros.size === 0) return tokens;
  const output = [];
  let changed = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const definition = macroDefinitionAt(macros, token.value, token.line);
    if (!definition) {
      output.push(token);
      continue;
    }
    state.remaining -= 1;
    if (state.remaining < 0) {
      state.failures.push({
        line: token.line,
        reason: "macro expansion budget exhausted",
      });
      output.push(...tokens.slice(index));
      break;
    }
    if (definition.parameters === null) {
      const replacement = substituteMacro(definition, [], token.line, {
        macros,
        state,
        depth,
      });
      state.remaining -= replacement.length;
      if (state.remaining < 0) {
        state.failures.push({
          line: token.line,
          reason: "macro expansion budget exhausted",
        });
        output.push(...tokens.slice(index));
        break;
      }
      output.push(...replacement);
      changed = true;
      continue;
    }
    if (tokens[index + 1]?.value !== "(") {
      output.push(token);
      continue;
    }
    const invocation = macroArguments(tokens, index + 1);
    if (!invocation) {
      output.push(token);
      continue;
    }
    const replacement = substituteMacro(
      definition,
      invocation.args,
      token.line,
      { macros, state, depth },
    );
    state.remaining -= replacement.length;
    if (state.remaining < 0) {
      state.failures.push({
        line: token.line,
        reason: "macro expansion budget exhausted",
      });
      output.push(...tokens.slice(index));
      break;
    }
    output.push(...replacement);
    index = invocation.closeIndex;
    changed = true;
  }
  return changed
    ? expandMacrosRecursive(output, macros, state, depth + 1)
    : output;
}

function expandMacros(tokens, macros) {
  const state = { remaining: 10_000, failures: [] };
  const expanded = expandMacrosRecursive(tokens, macros, state);
  Object.defineProperty(expanded, "macroFailures", {
    value: [...(macros.macroFailures ?? []), ...state.failures],
  });
  return expanded;
}

/** A deliberately small C++/Rust lexer used only for structural policy. */
export function tokenizeCode(
  input,
  { language = "cpp", rustTarget = FROZEN_RUST_TARGET } = {},
) {
  const preprocessed = maskDefinitelyInactivePreprocessor(input, { language });
  const tokens = tokenizeMaskedCode(preprocessed.source, preprocessed);
  if (language === "cpp") {
    return expandMacros(tokens, parseMacros(preprocessed.macros));
  }
  return filterDefinitelyInactiveRust(tokens, rustTarget);
}

function matchingToken(tokens, start, opening, closing) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

export function findCompleteTypeDefinitions(tokens) {
  const definitions = [];
  const attributeFailures = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!["struct", "class", "union"].includes(tokens[index].value)) continue;
    let nameIndex = index + 1;
    while (nameIndex < tokens.length) {
      if (tokens[nameIndex]?.value === "[[") {
        let depth = 1;
        let cursor = nameIndex + 1;
        while (cursor < tokens.length && depth > 0) {
          if (tokens[cursor].value === "[[") depth += 1;
          if (tokens[cursor].value === "]]") depth -= 1;
          cursor += 1;
        }
        if (depth !== 0) {
          attributeFailures.push({
            line: tokens[index].line,
            subject: tokens[nameIndex + 1]?.value ?? "attribute",
          });
          nameIndex = tokens.length;
          break;
        }
        nameIndex = cursor;
        continue;
      }
      if (
        [
          "__attribute",
          "__attribute__",
          "__declspec",
          "_Alignas",
          "alignas",
        ].includes(tokens[nameIndex]?.value) &&
        tokens[nameIndex + 1]?.value === "("
      ) {
        const close = matchingToken(tokens, nameIndex + 1, "(", ")");
        if (close < 0) {
          attributeFailures.push({
            line: tokens[index].line,
            subject: tokens[nameIndex].value,
          });
          nameIndex = tokens.length;
          break;
        }
        nameIndex = close + 1;
        continue;
      }
      break;
    }
    const nameToken = tokens[nameIndex];
    if (!nameToken || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(nameToken.value)) {
      continue;
    }
    let cursor = nameIndex + 1;
    if (
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[cursor]?.value ?? "") &&
      tokens[cursor + 1]?.value === "{"
    ) {
      attributeFailures.push({
        line: tokens[index].line,
        subject: tokens[cursor].value,
      });
      continue;
    }
    if (tokens[cursor]?.value === "<") {
      const closeGenerics = matchingToken(tokens, cursor, "<", ">");
      if (closeGenerics < 0) continue;
      cursor = closeGenerics + 1;
    }
    if (tokens[cursor]?.value === "final") cursor += 1;
    if (tokens[cursor]?.value === ":") {
      while (
        cursor < tokens.length &&
        !["{", ";"].includes(tokens[cursor].value)
      ) {
        cursor += 1;
      }
    }
    if (tokens[cursor]?.value !== "{") continue;
    const close = matchingToken(tokens, cursor, "{", "}");
    if (close < 0) continue;
    definitions.push({
      kind: tokens[index].value,
      name: nameToken.value,
      line: tokens[index].line,
      body: tokens.slice(cursor + 1, close),
      start: index,
      end: close,
    });
  }
  Object.defineProperty(definitions, "attributeFailures", {
    value: attributeFailures,
  });
  return definitions;
}

export function findFunctionDefinitions(tokens, symbol) {
  const definitions = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== symbol || tokens[index + 1]?.value !== "(") {
      continue;
    }
    const closeParameters = matchingToken(tokens, index + 1, "(", ")");
    if (closeParameters < 0) continue;
    let cursor = closeParameters + 1;
    while (
      cursor < tokens.length &&
      !["{", ";"].includes(tokens[cursor].value)
    ) {
      cursor += 1;
    }
    if (tokens[cursor]?.value !== "{") continue;
    const closeBody = matchingToken(tokens, cursor, "{", "}");
    if (closeBody < 0) continue;
    definitions.push({
      line: tokens[index].line,
      body: tokens.slice(cursor + 1, closeBody),
      nameIndex: index,
      parametersOpen: index + 1,
      parametersClose: closeParameters,
      bodyOpen: cursor,
      bodyClose: closeBody,
    });
  }
  return definitions;
}

const ATOMIC_OWNER_PARAMETERS = [
  "rocksdb_t",
  "*",
  "db",
  ",",
  "const",
  "rocksdb_ingestexternalfilearg_t",
  "*",
  "list",
  ",",
  "const",
  "size_t",
  "list_len",
  ",",
  "char",
  "*",
  "*",
  "errptr",
];

export function extractAtomicOwnerDefinition(source, symbol) {
  const preprocessed = maskDefinitelyInactivePreprocessor(source);
  const tokens = tokenizeMaskedCode(preprocessed.source, preprocessed);
  const definitions = findFunctionDefinitions(tokens, symbol);
  if (definitions.length !== 1) return null;
  const definition = definitions[0];
  const directExternIndex = definition.nameIndex - 2;
  const hasDirectCLinkage =
    tokens[directExternIndex]?.value === "extern" &&
    tokens[directExternIndex + 1]?.value === "void" &&
    /^extern\s*"C"\s+void\s*$/u.test(
      spliceCppTranslationLines(
        source.slice(
          tokens[directExternIndex].index,
          tokens[definition.nameIndex].index,
        ),
      ).source,
    );
  const enclosingExternIndex = tokens.findIndex((token, index) => {
    if (
      token.value !== "extern" ||
      tokens[index + 1]?.value !== "{" ||
      !/^extern\s*"C"\s*\{$/u.test(
        spliceCppTranslationLines(
          source.slice(token.index, tokens[index + 1].index + 1),
        ).source,
      )
    ) {
      return false;
    }
    const close = matchingToken(tokens, index + 1, "{", "}");
    return (
      close >= 0 &&
      index + 1 < definition.nameIndex &&
      definition.bodyClose < close
    );
  });
  const hasEnclosingCLinkage =
    tokens[definition.nameIndex - 1]?.value === "void" &&
    enclosingExternIndex >= 0;
  if (
    (!hasDirectCLinkage && !hasEnclosingCLinkage) ||
    !tokenValues(
      tokens.slice(definition.parametersOpen + 1, definition.parametersClose),
    ).every((value, index) => value === ATOMIC_OWNER_PARAMETERS[index]) ||
    definition.parametersClose - definition.parametersOpen - 1 !==
      ATOMIC_OWNER_PARAMETERS.length
  ) {
    return null;
  }
  const start =
    tokens[hasDirectCLinkage ? directExternIndex : definition.nameIndex - 1]
      .index;
  const end = tokens[definition.bodyClose].index + 1;
  return Object.freeze({
    source: source.slice(start, end),
    line: definition.line,
    linkage: hasDirectCLinkage ? "direct" : "enclosing",
    sha256: sha256(Buffer.from(source.slice(start, end), "utf8")),
  });
}

function finding(code, subject, message, line = null) {
  return { code, subject, message, line };
}

function macroFailureFindings(tokens) {
  return (tokens.macroFailures ?? []).map((failure) =>
    finding(
      "preprocessor-macro-unsupported",
      "macro-expansion",
      failure.reason,
      failure.line,
    ),
  );
}

function rustCfgFailureFindings(tokens) {
  return (tokens.rustCfgFailures ?? []).map(({ line, reason }) =>
    finding("rust-cfg-unsupported", "frozen-build-target", reason, line),
  );
}

function tokenValues(tokens) {
  return tokens.map((token) => token.value);
}

function identifierOccurrences(tokens, identifier) {
  return tokens.filter((token) => token.value === identifier);
}

function ambiguousConditionalMacroFindings(
  preprocessed,
  oracle,
  { tagsOnly = false } = {},
) {
  const unexpandedTokens = tokenizeMaskedCode(
    preprocessed.source,
    preprocessed,
  );
  const protectedNames = new Set(
    oracle.opaqueMirrors.flatMap((entry) =>
      tagsOnly ? [entry.tag] : [entry.tag, entry.privateCppType],
    ),
  );
  const macroShapes = preprocessed.macros.map((record) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s*(.*)$/u.exec(
      record.expression,
    );
    return {
      name: match?.[1] ?? null,
      references: new Set(
        tokenizeMaskedCode(match?.[2] ?? "")
          .map(({ value }) => value)
          .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)),
      ),
    };
  });
  const relevantNames = new Set(protectedNames);
  for (let index = 0; index < unexpandedTokens.length; index += 1) {
    if (unexpandedTokens[index + 1]?.value !== "(") continue;
    const close = matchingToken(unexpandedTokens, index + 1, "(", ")");
    if (close < 0) continue;
    const fragments = unexpandedTokens
      .slice(index + 2, close)
      .map(({ value }) => value)
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value));
    if (
      protectedNames.has(fragments.join("")) ||
      fragments.some((value) => protectedNames.has(value))
    ) {
      relevantNames.add(unexpandedTokens[index].value);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, references } of macroShapes) {
      if (
        name !== null &&
        !relevantNames.has(name) &&
        [...references].some((reference) => relevantNames.has(reference))
      ) {
        relevantNames.add(name);
        changed = true;
      }
    }
  }
  const conditionalIndexes = preprocessed.macros.flatMap((record, index) =>
    record.conditional === true && relevantNames.has(macroShapes[index].name)
      ? [index]
      : [],
  );
  if (conditionalIndexes.length === 0) return [];
  if (conditionalIndexes.length > 12) {
    return [
      finding(
        "ambiguous-preprocessor-macro",
        "conditional-macro-state-space",
        "too many unknown conditional macro events to prove opaque representations remain hidden",
      ),
    ];
  }

  // Each unknown arm is a possible preprocessing state. Exploring every
  // inclusion combination is deliberately conservative: impossible
  // combinations can reject a source, but no textual #undef or harmless
  // redefinition can erase a dangerous alternative before the use is audited.
  const macroStates = [];
  const conditionalBitByRecord = new Map(
    conditionalIndexes.map((recordIndex, bitIndex) => [recordIndex, bitIndex]),
  );
  for (let state = 0; state < 2 ** conditionalIndexes.length; state += 1) {
    const records = preprocessed.macros.filter((_, recordIndex) => {
      const bitIndex = conditionalBitByRecord.get(recordIndex);
      return bitIndex === undefined || (state & (1 << bitIndex)) !== 0;
    });
    macroStates.push(parseMacros(records));
  }

  const findings = [];
  const reported = new Set();
  for (let index = 0; index < unexpandedTokens.length; index += 1) {
    const token = unexpandedTokens[index];
    const name = token.value;
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
      reported.has(name) ||
      !macroStates.some(
        (macros) => macroDefinitionAt(macros, name, token.line) !== null,
      )
    ) {
      continue;
    }

    let invocationEnd = index + 1;
    if (unexpandedTokens[index + 1]?.value === "(") {
      const close = matchingToken(unexpandedTokens, index + 1, "(", ")");
      if (close >= 0) invocationEnd = close + 1;
    }
    const invocation = unexpandedTokens.slice(index, invocationEnd);
    const expansions = macroStates.map((macros) =>
      expandMacros(invocation, macros),
    );
    const signatures = new Set(
      expansions.map((expanded) => tokenValues(expanded).join(" ")),
    );
    const protectedExpansion = expansions
      .flat()
      .find((expanded) => protectedNames.has(expanded.value))?.value;
    if (
      signatures.size < 2 ||
      (protectedExpansion === undefined && !protectedNames.has(name))
    ) {
      continue;
    }
    reported.add(name);
    findings.push(
      finding(
        "ambiguous-preprocessor-macro",
        name,
        `unknown conditional leaves ${name} able to alter protected representation ${protectedExpansion ?? name}`,
        token.line,
      ),
    );
  }
  return findings;
}

function containsSequence(values, sequence) {
  return values.some((_, index) =>
    sequence.every((value, offset) => values[index + offset] === value),
  );
}

function sequenceIndex(values, sequence, start = 0, end = values.length) {
  for (let index = start; index + sequence.length <= end; index += 1) {
    if (sequence.every((value, offset) => values[index + offset] === value)) {
      return index;
    }
  }
  return -1;
}

function findLoopBlock(
  tokens,
  depthAt,
  expectedDepth,
  conditionSequence,
  start = 0,
  end = tokens.length,
) {
  const values = tokenValues(tokens);
  for (let index = start; index < end; index += 1) {
    if (values[index] !== "for" || depthAt[index] !== expectedDepth) continue;
    const openParameters = index + 1;
    if (values[openParameters] !== "(") continue;
    const closeParameters = matchingToken(tokens, openParameters, "(", ")");
    if (closeParameters < 0 || closeParameters >= end) continue;
    if (
      sequenceIndex(
        values,
        conditionSequence,
        openParameters + 1,
        closeParameters,
      ) < 0
    ) {
      continue;
    }
    const openBody = closeParameters + 1;
    if (values[openBody] !== "{") continue;
    const closeBody = matchingToken(tokens, openBody, "{", "}");
    if (closeBody < 0 || closeBody >= end) continue;
    return {
      start: index,
      openBody,
      closeBody,
      parameters: values.slice(openParameters + 1, closeParameters),
    };
  }
  return null;
}

const EXPECTED_SHIM_DISPOSITIONS = new Map([
  [
    "oxrocksdb_writebatch_wi_create_iterator_with_base_readopts_cf",
    [
      "replace-with-public-c",
      ["rocksdb_writebatch_wi_create_iterator_with_base_cf_readopts"],
    ],
  ],
  [
    "oxrocksdb_get_pinned_cf_v2",
    [
      "replace-with-public-c",
      [
        "rocksdb_get_pinned_cf_v2",
        "rocksdb_pinnable_handle_get_value",
        "rocksdb_pinnable_handle_destroy",
      ],
    ],
  ],
  [
    "oxrocksdb_pinnable_handle_get_value",
    ["replace-with-public-c", ["rocksdb_pinnable_handle_get_value"]],
  ],
  [
    "oxrocksdb_pinnable_handle_destroy",
    ["replace-with-public-c", ["rocksdb_pinnable_handle_destroy"]],
  ],
  [
    "oxrocksdb_get_into_buffer_cf",
    ["replace-with-public-c", ["rocksdb_get_into_buffer_cf"]],
  ],
  [
    "oxrocksdb_iter_key_slice",
    ["replace-with-public-c", ["rocksdb_iter_key_slice"]],
  ],
  [
    "oxrocksdb_writebatch_wi_get_into_buffer_cf",
    [
      "replace-with-public-c-composition",
      [
        "rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf",
        "rocksdb_pinnableslice_value",
        "rocksdb_pinnableslice_destroy",
      ],
    ],
  ],
  [
    "oxrocksdb_writebatch_wi_get_pinned_cf_v2",
    [
      "replace-with-public-c",
      [
        "rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf",
        "rocksdb_pinnableslice_value",
        "rocksdb_pinnableslice_destroy",
      ],
    ],
  ],
  [
    "oxrocksdb_readoptions_create_copy",
    [
      "replace-with-product-state-reconstruction",
      [
        "rocksdb_readoptions_create",
        "rocksdb_readoptions_set_async_io",
        "rocksdb_readoptions_set_snapshot",
        "rocksdb_readoptions_set_iterate_upper_bound",
        "rocksdb_readoptions_destroy",
      ],
    ],
  ],
]);

const EXPECTED_PUBLIC_C_DECLARATIONS = new Map([
  [
    "rocksdb_writebatch_wi_create_iterator_with_base_cf_readopts",
    "extern ROCKSDB_LIBRARY_API rocksdb_iterator_t* rocksdb_writebatch_wi_create_iterator_with_base_cf_readopts(rocksdb_writebatch_wi_t* wbwi, rocksdb_iterator_t* base_iterator, rocksdb_column_family_handle_t* cf, const rocksdb_readoptions_t* options);",
  ],
  [
    "rocksdb_get_pinned_cf_v2",
    "extern ROCKSDB_LIBRARY_API rocksdb_pinnable_handle_t* rocksdb_get_pinned_cf_v2(rocksdb_t* db, const rocksdb_readoptions_t* options, rocksdb_column_family_handle_t* column_family, const char* key, size_t keylen, char** errptr);",
  ],
  [
    "rocksdb_pinnable_handle_get_value",
    "extern ROCKSDB_LIBRARY_API const char* rocksdb_pinnable_handle_get_value(const rocksdb_pinnable_handle_t* handle, size_t* vallen);",
  ],
  [
    "rocksdb_pinnable_handle_destroy",
    "extern ROCKSDB_LIBRARY_API void rocksdb_pinnable_handle_destroy(rocksdb_pinnable_handle_t* handle);",
  ],
  [
    "rocksdb_get_into_buffer_cf",
    "extern ROCKSDB_LIBRARY_API unsigned char rocksdb_get_into_buffer_cf(rocksdb_t* db, const rocksdb_readoptions_t* options, rocksdb_column_family_handle_t* column_family, const char* key, size_t keylen, char* buffer, size_t buffer_size, size_t* vallen, unsigned char* found, char** errptr);",
  ],
  [
    "rocksdb_iter_key_slice",
    "extern ROCKSDB_LIBRARY_API rocksdb_slice_t rocksdb_iter_key_slice(const rocksdb_iterator_t* iter);",
  ],
  [
    "rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf",
    "extern ROCKSDB_LIBRARY_API rocksdb_pinnableslice_t* rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf(rocksdb_writebatch_wi_t* wbwi, rocksdb_t* db, const rocksdb_readoptions_t* options, rocksdb_column_family_handle_t* column_family, const char* key, size_t keylen, char** errptr);",
  ],
  [
    "rocksdb_pinnableslice_value",
    "extern ROCKSDB_LIBRARY_API const char* rocksdb_pinnableslice_value(const rocksdb_pinnableslice_t* t, size_t* vlen);",
  ],
  [
    "rocksdb_pinnableslice_destroy",
    "extern ROCKSDB_LIBRARY_API void rocksdb_pinnableslice_destroy(rocksdb_pinnableslice_t* v);",
  ],
  [
    "rocksdb_readoptions_create",
    "extern ROCKSDB_LIBRARY_API rocksdb_readoptions_t* rocksdb_readoptions_create(void);",
  ],
  [
    "rocksdb_readoptions_set_async_io",
    "extern ROCKSDB_LIBRARY_API void rocksdb_readoptions_set_async_io(rocksdb_readoptions_t*, unsigned char);",
  ],
  [
    "rocksdb_readoptions_set_snapshot",
    "extern ROCKSDB_LIBRARY_API void rocksdb_readoptions_set_snapshot(rocksdb_readoptions_t*, const rocksdb_snapshot_t*);",
  ],
  [
    "rocksdb_readoptions_set_iterate_upper_bound",
    "extern ROCKSDB_LIBRARY_API void rocksdb_readoptions_set_iterate_upper_bound(rocksdb_readoptions_t*, const char* key, size_t keylen);",
  ],
  [
    "rocksdb_readoptions_destroy",
    "extern ROCKSDB_LIBRARY_API void rocksdb_readoptions_destroy(rocksdb_readoptions_t*);",
  ],
]);

const EXPECTED_EXTENSION_HEADER =
  "extern ROCKSDB_LIBRARY_API void oxrocksdb_ingest_external_files(rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list, const size_t list_len, char** errptr);";

function canonicalCParameters(values) {
  const parameters = [];
  let current = [];
  let depth = 0;
  const finish = () => {
    const last = current.at(-1);
    if (
      current.length >= 2 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(last) &&
      ![
        "char",
        "double",
        "float",
        "int",
        "long",
        "short",
        "signed",
        "unsigned",
        "void",
      ].includes(last) &&
      !last.endsWith("_t")
    ) {
      current.pop();
    }
    if (parameters.length > 0) parameters.push(",");
    parameters.push(...current);
    current = [];
  };
  for (const value of values) {
    if (["(", "[", "{"].includes(value)) depth += 1;
    if ([")", "]", "}"].includes(value)) depth -= 1;
    if (value === "," && depth === 0) finish();
    else current.push(value);
  }
  finish();
  return parameters;
}

function declarationSignatures(tokens, symbol) {
  const signatures = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== symbol || tokens[index + 1]?.value !== "(") {
      continue;
    }
    const close = matchingToken(tokens, index + 1, "(", ")");
    if (close < 0 || tokens[close + 1]?.value !== ";") continue;
    let start = index - 1;
    while (start >= 0 && ![";", "{", "}"].includes(tokens[start].value)) {
      start -= 1;
    }
    signatures.push({
      result: tokenValues(tokens.slice(start + 1, index)),
      parameters: canonicalCParameters(
        tokenValues(tokens.slice(index + 2, close)),
      ),
    });
  }
  return signatures;
}

function declarationSignature(tokens, symbol) {
  const signatures = declarationSignatures(tokens, symbol);
  return signatures.length === 1 ? signatures[0] : null;
}

function expectedDeclarationSignature(source, symbol) {
  return declarationSignature(tokenizeCode(source), symbol);
}

function expectedPublicDeclarationSignature(source, symbol) {
  return declarationSignature(
    tokenizeCode(`#define ROCKSDB_LIBRARY_API\n${source}`),
    symbol,
  );
}

function signatureArity(signature) {
  if (
    !signature ||
    signature.parameters.length === 0 ||
    (signature.parameters.length === 1 && signature.parameters[0] === "void")
  ) {
    return 0;
  }
  let depth = 0;
  let arity = 1;
  for (const value of signature.parameters) {
    if (["(", "[", "{"].includes(value)) depth += 1;
    if ([")", "]", "}"].includes(value)) depth -= 1;
    if (value === "," && depth === 0) arity += 1;
  }
  return arity;
}

function callArity(tokens, open) {
  const close = matchingToken(tokens, open, "(", ")");
  if (close < 0) return null;
  if (close === open + 1) return { arity: 0, close };
  let depth = 0;
  let arity = 1;
  for (let index = open + 1; index < close; index += 1) {
    const value = tokens[index].value;
    if (["(", "[", "{"].includes(value)) depth += 1;
    if ([")", "]", "}"].includes(value)) depth -= 1;
    if (value === "," && depth === 0 && index < close - 1) arity += 1;
  }
  return { arity, close };
}

function hasTrailingErrorOut(signature) {
  return signature?.parameters.slice(-3).join(" ") === "char * *";
}

function isFfiResultWrapped(tokens, symbolIndex, callClose) {
  if (
    tokens[symbolIndex - 3]?.value !== "ffi_result" ||
    tokens[symbolIndex - 2]?.value !== "!" ||
    tokens[symbolIndex - 1]?.value !== "("
  ) {
    return false;
  }
  return matchingToken(tokens, symbolIndex - 1, "(", ")") === callClose + 1;
}

function liveCallExpressions(
  tokens,
  symbol,
  expectedArity,
  { allowFfiResult = false } = {},
) {
  const calls = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index].value !== symbol ||
      tokens[index + 1]?.value !== "(" ||
      tokens[index - 1]?.value === "fn"
    ) {
      continue;
    }
    const call = callArity(tokens, index + 1);
    if (
      call?.arity === expectedArity ||
      (allowFfiResult &&
        call?.arity === expectedArity - 1 &&
        isFfiResultWrapped(tokens, index, call.close))
    ) {
      calls.push({ index, ...call });
    }
  }
  return calls;
}

function rustItemPrefix(tokens, index) {
  let start = index;
  while (start > 0 && ![";", "{", "}"].includes(tokens[start - 1].value)) {
    start -= 1;
  }
  return tokenValues(tokens.slice(start, index));
}

function rustModuleRanges(tokens) {
  const ranges = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].value !== "mod" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[index + 1]?.value ?? "") ||
      tokens[index + 2]?.value !== "{"
    ) {
      continue;
    }
    const close = matchingToken(tokens, index + 2, "{", "}");
    if (close < 0) continue;
    ranges.push({
      name: tokens[index + 1].value,
      open: index + 2,
      close,
      isPublic: rustItemPrefix(tokens, index).includes("pub"),
    });
  }
  return ranges;
}

function rustModuleScopeAt(moduleRanges, index) {
  const modules = moduleRanges
    .filter(({ open, close }) => open < index && index < close)
    .sort((left, right) => left.open - right.open);
  return {
    key: modules.map(({ name, open }) => `${name}@${open}`).join("/"),
    isVisible: modules.every(({ isPublic }) => isPublic),
  };
}

function rustImplRanges(tokens, moduleRanges) {
  const ranges = [];
  const dropShadowState = rustDropShadowState(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "impl") continue;
    let bodyOpen = index + 1;
    while (bodyOpen < tokens.length && tokens[bodyOpen].value !== "{")
      bodyOpen += 1;
    if (bodyOpen >= tokens.length) continue;
    const bodyClose = matchingToken(tokens, bodyOpen, "{", "}");
    if (bodyClose < 0) continue;
    const forIndex = tokens.findIndex(
      ({ value }, candidate) =>
        candidate > index && candidate < bodyOpen && value === "for",
    );
    let typeStart = forIndex >= 0 ? forIndex + 1 : index + 1;
    if (tokens[typeStart]?.value === "<") {
      const closeGenerics = matchingToken(tokens, typeStart, "<", ">");
      if (closeGenerics < 0) continue;
      typeStart = closeGenerics + 1;
    }
    let typeName = null;
    for (let cursor = typeStart; cursor < bodyOpen; cursor += 1) {
      if (["<", "where"].includes(tokens[cursor].value)) break;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[cursor].value)) {
        typeName = tokens[cursor].value;
      }
    }
    const moduleScope = rustModuleScopeAt(moduleRanges, index);
    ranges.push({
      open: bodyOpen,
      close: bodyClose,
      typeName,
      moduleKey: moduleScope.key,
      isLanguageDrop:
        forIndex >= 0 &&
        isLanguageDropTrait(
          tokenValues(tokens.slice(index + 1, forIndex)),
          dropShadowState,
        ),
    });
  }
  return ranges;
}

function rustBlockDefinitelyDiverges(body, start, end, depthAt, depth) {
  for (let index = start; index < end; index += 1) {
    if (depthAt[index] !== depth) continue;
    const value = body[index].value;
    if (["return", "break", "continue"].includes(value)) return true;
    if (
      ["panic", "todo", "unimplemented", "unreachable"].includes(value) &&
      body[index + 1]?.value === "!"
    ) {
      return true;
    }
    if (
      ["abort", "exit"].includes(value) &&
      body[index - 1]?.value === "::" &&
      body[index - 2]?.value === "process"
    ) {
      return true;
    }
    const isDivergingLoop =
      value === "loop" ||
      (value === "while" && body[index + 1]?.value === "true");
    if (isDivergingLoop) {
      const open = body.findIndex(
        ({ value: candidate }, cursor) =>
          cursor > index &&
          cursor < end &&
          candidate === "{" &&
          depthAt[cursor] === depth,
      );
      if (open >= 0) {
        const close = matchingToken(body, open, "{", "}");
        if (
          close >= 0 &&
          close < end &&
          !body.some(
            ({ value: token }, cursor) =>
              cursor > open &&
              cursor < close &&
              token === "break" &&
              depthAt[cursor] === depth + 1,
          )
        ) {
          return true;
        }
      }
    }
    if (value !== "if") continue;
    let conditionIsTrue = body[index + 1]?.value === "true";
    let open = conditionIsTrue ? index + 2 : -1;
    if (
      !conditionIsTrue &&
      body[index + 1]?.value === "cfg" &&
      body[index + 2]?.value === "!" &&
      body[index + 3]?.value === "("
    ) {
      const closeCfg = matchingToken(body, index + 3, "(", ")");
      if (
        closeCfg >= 0 &&
        definitelyKnownRustCfg(body.slice(index + 4, closeCfg)) === true
      ) {
        conditionIsTrue = true;
        open = closeCfg + 1;
      }
    }
    if (
      !conditionIsTrue ||
      body[open]?.value !== "{" ||
      depthAt[open] !== depth
    ) {
      continue;
    }
    const close = matchingToken(body, open, "{", "}");
    if (
      close >= 0 &&
      close < end &&
      rustBlockDefinitelyDiverges(body, open + 1, close, depthAt, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

function rustCallSiteIsReachable(body, callIndex) {
  let depth = 0;
  const depthAt = body.map(({ value }) => {
    const current = depth;
    if (value === "{") depth += 1;
    if (value === "}") depth -= 1;
    return current;
  });
  const callDepth = depthAt[callIndex] ?? 0;
  for (let scopeDepth = 0; scopeDepth <= callDepth; scopeDepth += 1) {
    let blockStart = 0;
    if (scopeDepth > 0) {
      for (let index = callIndex - 1; index >= 0; index -= 1) {
        if (
          body[index].value === "{" &&
          depthAt[index] === scopeDepth - 1 &&
          matchingToken(body, index, "{", "}") >= callIndex
        ) {
          blockStart = index + 1;
          break;
        }
      }
    }
    if (
      rustBlockDefinitelyDiverges(
        body,
        blockStart,
        callIndex,
        depthAt,
        scopeDepth,
      )
    ) {
      return false;
    }
  }
  return true;
}

function rustFunctionDefinitions(tokens) {
  const definitions = [];
  const moduleRanges = rustModuleRanges(tokens);
  const implRanges = rustImplRanges(tokens, moduleRanges);
  const publicTypes = new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (
      !["enum", "struct", "type", "union"].includes(tokens[index].value) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[index + 1]?.value ?? "")
    ) {
      continue;
    }
    const moduleScope = rustModuleScopeAt(moduleRanges, index);
    if (
      moduleScope.isVisible &&
      rustItemPrefix(tokens, index).includes("pub")
    ) {
      publicTypes.add(`${moduleScope.key}\0${tokens[index + 1].value}`);
    }
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].value !== "fn" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[index + 1]?.value ?? "")
    )
      continue;
    let openParameters = index + 2;
    if (tokens[openParameters]?.value === "<") {
      const closeGenerics = matchingToken(tokens, openParameters, "<", ">");
      if (closeGenerics < 0) continue;
      openParameters = closeGenerics + 1;
    }
    if (tokens[openParameters]?.value !== "(") continue;
    const closeParameters = matchingToken(tokens, openParameters, "(", ")");
    if (closeParameters < 0) continue;
    let bodyOpen = closeParameters + 1;
    let squareDepth = 0;
    let angleDepth = 0;
    while (bodyOpen < tokens.length) {
      const value = tokens[bodyOpen].value;
      if (value === "[") squareDepth += 1;
      if (value === "]") squareDepth -= 1;
      if (value === "<") angleDepth += 1;
      if (value === ">") angleDepth -= 1;
      if (value === ";" && squareDepth === 0 && angleDepth === 0) break;
      if (value === "{" && squareDepth === 0 && angleDepth === 0) break;
      bodyOpen += 1;
    }
    if (tokens[bodyOpen]?.value !== "{") continue;
    const bodyClose = matchingToken(tokens, bodyOpen, "{", "}");
    if (bodyClose < 0) continue;
    const signaturePrefix = rustItemPrefix(tokens, index);
    const moduleScope = rustModuleScopeAt(moduleRanges, index);
    const implRange = implRanges
      .filter(({ open, close }) => open < index && index < close)
      .sort((left, right) => right.open - left.open)[0];
    const typeIsPublic =
      implRange?.typeName !== null &&
      publicTypes.has(`${moduleScope.key}\0${implRange?.typeName}`);
    definitions.push({
      name: tokens[index + 1].value,
      nameIndex: index + 1,
      bodyOpen,
      bodyClose,
      moduleKey: moduleScope.key,
      implRange: implRange ?? null,
      dropType: implRange?.isLanguageDrop ? implRange.typeName : null,
      isEntry: implRange?.isLanguageDrop
        ? typeIsPublic
        : signaturePrefix.includes("pub") &&
          moduleScope.isVisible &&
          (implRange === undefined || typeIsPublic),
    });
  }
  return definitions;
}

function rustInnermostFunctionAt(definitions, index, close = index) {
  return definitions
    .filter(({ bodyOpen, bodyClose }) => index > bodyOpen && close < bodyClose)
    .sort((left, right) => right.bodyOpen - left.bodyOpen)[0];
}

function reachableRustFunctions(tokens) {
  const definitions = rustFunctionDefinitions(tokens);
  const reachable = new Set(
    definitions
      .filter(({ isEntry }) => isEntry)
      .map(({ nameIndex }) => nameIndex),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (!reachable.has(definition.nameIndex)) continue;
      const body = tokens.slice(definition.bodyOpen + 1, definition.bodyClose);
      for (let index = 0; index < body.length - 1; index += 1) {
        const absoluteIndex = definition.bodyOpen + 1 + index;
        if (
          body[index + 1].value !== "(" ||
          [".", "::", "!", "fn"].includes(body[index - 1]?.value) ||
          !rustCallSiteIsReachable(body, index) ||
          rustInnermostFunctionAt(definitions, absoluteIndex) !== definition ||
          rustCallIsInDeferredBlock(tokens, absoluteIndex, definition)
        ) {
          continue;
        }
        const callee = body[index].value;
        const candidates = definitions.filter(
          ({ name, moduleKey, implRange }) =>
            name === callee &&
            moduleKey === definition.moduleKey &&
            implRange === null,
        );
        if (
          candidates.length === 1 &&
          !reachable.has(candidates[0].nameIndex)
        ) {
          reachable.add(candidates[0].nameIndex);
          changed = true;
        }
      }
      for (const dropDefinition of definitions.filter(
        ({ dropType, moduleKey }) =>
          dropType !== null && moduleKey === definition.moduleKey,
      )) {
        const constructed = body.some(
          ({ value }, index) =>
            value === dropDefinition.dropType &&
            ["{", "("].includes(body[index + 1]?.value) &&
            rustInnermostFunctionAt(
              definitions,
              definition.bodyOpen + 1 + index,
            ) === definition &&
            !rustCallIsInDeferredBlock(
              tokens,
              definition.bodyOpen + 1 + index,
              definition,
            ),
        );
        if (constructed && !reachable.has(dropDefinition.nameIndex)) {
          reachable.add(dropDefinition.nameIndex);
          changed = true;
        }
      }
    }
  }
  return definitions.filter(({ nameIndex }) => reachable.has(nameIndex));
}

function rustCallIsInDeferredBlock(tokens, callIndex, owner) {
  for (let open = owner.bodyOpen + 1; open < callIndex; open += 1) {
    if (tokens[open].value !== "{") continue;
    const close = matchingToken(tokens, open, "{", "}");
    if (close < callIndex) continue;
    if (
      tokens[open - 1]?.value === "async" ||
      tokens[open - 1]?.value === "const" ||
      tokens[open - 1]?.value === "gen" ||
      (tokens[open - 1]?.value === "move" &&
        ["async", "gen"].includes(tokens[open - 2]?.value))
    ) {
      return true;
    }
    let headerStart = open - 1;
    while (
      headerStart >= owner.bodyOpen &&
      ![";", "{", "}", "="].includes(tokens[headerStart]?.value)
    ) {
      headerStart -= 1;
    }
    const header = tokenValues(tokens.slice(headerStart + 1, open));
    if (
      header.includes("||") ||
      header.filter((value) => value === "|").length >= 2
    ) {
      return true;
    }
  }
  return false;
}

function hasExactFfiImport(tokens) {
  const values = tokenValues(tokens);
  let depth = 0;
  const depthAt = values.map((value) => {
    const current = depth;
    if (value === "{") depth += 1;
    if (value === "}") depth -= 1;
    return current;
  });
  return [["use", "::", "oxrocksdb_sys", "::", "*", ";"]].some((sequence) => {
    const index = sequenceIndex(values, sequence);
    return index >= 0 && depthAt[index] === 0;
  });
}

const SAFE_RUST_ATTRIBUTES = new Set([
  "allow",
  "cfg",
  "cfg_attr",
  "cold",
  "deprecated",
  "derive",
  "doc",
  "expect",
  "inline",
  "must_use",
  "non_exhaustive",
  "path",
  "repr",
  "test",
  "track_caller",
]);
const SAFE_RUST_MACRO_INVOCATIONS = new Set([
  "assert",
  "assert_eq",
  "assert_ne",
  "cfg",
  "concat",
  "debug_assert",
  "debug_assert_eq",
  "debug_assert_ne",
  "eprintln",
  "format",
  "format_args",
  "matches",
  "panic",
  "print",
  "println",
  "todo",
  "unimplemented",
  "unreachable",
  "vec",
  "write",
  "writeln",
]);

function rustMacroInvocations(tokens) {
  const invocations = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[index].value) &&
      tokens[index + 1]?.value === "!" &&
      ["(", "[", "{"].includes(tokens[index + 2]?.value)
    ) {
      invocations.push({ name: tokens[index].value, index });
    }
  }
  return invocations;
}

function hasUnreviewedRustExpansionSurface(tokens, contract = null) {
  const definitions = tokens.rustMacroDefinitions ?? [];
  const hasReviewedDefinition =
    definitions.length === 1 &&
    definitions[0].name === EXPECTED_RUST_FFI_RESULT_CONTRACT.macro &&
    definitions[0].tokenSha256 ===
      EXPECTED_RUST_FFI_RESULT_CONTRACT.tokenSha256 &&
    definitions[0].depth === 0;
  if (
    definitions.length > 1 ||
    (definitions.length === 1 && !hasReviewedDefinition)
  ) {
    return true;
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index].value !== "#") continue;
    const open = tokens[index + 1]?.value === "!" ? index + 2 : index + 1;
    if (tokens[open]?.value !== "[") continue;
    const name = tokens[open + 1]?.value;
    if (name === "macro_use" || !SAFE_RUST_ATTRIBUTES.has(name)) return true;
  }
  const invocations = rustMacroInvocations(tokens);
  if (
    invocations.some(
      ({ name }) =>
        name !== contract?.macro &&
        !(
          hasReviewedDefinition &&
          name === EXPECTED_RUST_FFI_RESULT_CONTRACT.macro
        ) &&
        !SAFE_RUST_MACRO_INVOCATIONS.has(name),
    )
  ) {
    return true;
  }
  const invokedNames = new Set(invocations.map(({ name }) => name));
  const values = tokenValues(tokens);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "use") continue;
    const end = values.indexOf(";", index + 1);
    if (
      end > index &&
      values.slice(index + 1, end).some((value) => invokedNames.has(value))
    ) {
      return true;
    }
  }
  return false;
}

function hasReviewedFfiResultMacro(tokens, contract, callIndexes) {
  if (
    JSON.stringify(contract) !==
    JSON.stringify(EXPECTED_RUST_FFI_RESULT_CONTRACT)
  ) {
    return false;
  }
  const definitions = tokens.rustMacroDefinitions ?? [];
  if (
    definitions.length !== 1 ||
    definitions[0].name !== contract.macro ||
    definitions[0].tokenSha256 !== contract.tokenSha256 ||
    definitions[0].depth !== 0 ||
    callIndexes.some(
      (callIndex) => definitions[0].sourceIndex >= tokens[callIndex].index,
    ) ||
    hasUnreviewedRustExpansionSurface(tokens, contract)
  ) {
    return false;
  }
  const values = tokenValues(tokens);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "use") continue;
    const end = values.indexOf(";", index + 1);
    if (end > index && values.slice(index + 1, end).includes(contract.macro)) {
      return false;
    }
  }
  return true;
}

function isUnshadowedExternalCall(
  tokens,
  symbol,
  callIndexes,
  macroContract = null,
) {
  if (
    !hasExactFfiImport(tokens) ||
    rustNamespaceIsShadowed(tokens, "oxrocksdb_sys") ||
    hasUnreviewedRustExpansionSurface(tokens, macroContract)
  ) {
    return false;
  }
  const callIndexSet = new Set(callIndexes);
  if (
    tokens.some(
      ({ value }, index) => value === symbol && !callIndexSet.has(index),
    )
  )
    return false;
  if (
    tokens.some(
      ({ value }, index) =>
        value === "oxrocksdb_sys" &&
        ["mod", "let", "const", "static", "type", "struct", "enum"].includes(
          tokens[index - 1]?.value,
        ),
    )
  )
    return false;
  const values = tokenValues(tokens);
  for (let index = 0; index < values.length - 4; index += 1) {
    if (
      values[index] === "use" &&
      values[index + 1] !== "oxrocksdb_sys" &&
      !(values[index + 1] === "::" && values[index + 2] === "oxrocksdb_sys")
    ) {
      const semicolon = values.indexOf(";", index + 1);
      if (semicolon > index && values.slice(index, semicolon).includes("*"))
        return false;
    }
  }
  return callIndexes.every(
    (index) => ![".", "::"].includes(tokens[index - 1]?.value),
  );
}

function reachableExternalCalls(
  tokens,
  symbol,
  expectedArity,
  { ffiResultContract = null, requireFfiResult = false } = {},
) {
  const definitions = rustFunctionDefinitions(tokens);
  const reachable = new Set(
    reachableRustFunctions(tokens).map(({ nameIndex }) => nameIndex),
  );
  const calls = liveCallExpressions(tokens, symbol, expectedArity, {
    allowFfiResult: requireFfiResult,
  }).filter(({ index, arity, close }) => {
    const owner = rustInnermostFunctionAt(definitions, index, close);
    if (
      owner === undefined ||
      !reachable.has(owner.nameIndex) ||
      rustCallIsInDeferredBlock(tokens, index, owner)
    ) {
      return false;
    }
    const body = tokens.slice(owner.bodyOpen + 1, owner.bodyClose);
    return (
      rustCallSiteIsReachable(body, index - owner.bodyOpen - 1) &&
      (!requireFfiResult ||
        (arity === expectedArity - 1 &&
          isFfiResultWrapped(tokens, index, close)))
    );
  });
  if (
    requireFfiResult &&
    !hasReviewedFfiResultMacro(
      tokens,
      ffiResultContract,
      calls.map(({ index }) => index),
    )
  ) {
    return [];
  }
  return isUnshadowedExternalCall(
    tokens,
    symbol,
    calls.map(({ index }) => index),
    requireFfiResult ? ffiResultContract : null,
  )
    ? calls
    : [];
}

export function auditOracleContract(oracle, baselineHeader, candidateHeader) {
  const findings = [];
  if (
    JSON.stringify(oracle.rustTarget) !== JSON.stringify(FROZEN_RUST_TARGET)
  ) {
    findings.push(
      finding(
        "oracle-rust-target-drift",
        "rustTarget",
        "the Rust cfg target must remain the exact reviewed native build target",
      ),
    );
  }
  if (
    JSON.stringify(oracle.rustFfiResult) !==
    JSON.stringify(EXPECTED_RUST_FFI_RESULT_CONTRACT)
  ) {
    findings.push(
      finding(
        "oracle-rust-ffi-result-drift",
        "rustFfiResult",
        "the Rust error-out call path must retain the exact reviewed FFI result macro",
      ),
    );
  }
  const headers = [
    ["v11.1.2", tokenizeCode(baselineHeader)],
    ["v11.8.1", tokenizeCode(candidateHeader)],
  ];
  const observed = new Map(
    oracle.shimDisposition.map((entry) => [entry.customSymbol, entry]),
  );
  if (
    observed.size !== oracle.shimDisposition.length ||
    observed.size !== EXPECTED_SHIM_DISPOSITIONS.size
  ) {
    findings.push(
      finding(
        "oracle-shim-inventory",
        "shimDisposition",
        "the shim inventory must contain each frozen custom symbol exactly once",
      ),
    );
  }
  for (const [
    symbol,
    [disposition, publicSymbols],
  ] of EXPECTED_SHIM_DISPOSITIONS) {
    const entry = observed.get(symbol);
    if (
      !entry ||
      entry.disposition !== disposition ||
      JSON.stringify(entry.publicSymbols) !== JSON.stringify(publicSymbols) ||
      typeof entry.ownership !== "string" ||
      entry.ownership.length === 0
    ) {
      findings.push(
        finding(
          "oracle-shim-disposition",
          symbol,
          "the public-C disposition or executable ownership rule drifted",
        ),
      );
      continue;
    }
    for (const publicSymbol of publicSymbols) {
      for (const [release, tokens] of headers) {
        if (identifierOccurrences(tokens, publicSymbol).length === 0) {
          findings.push(
            finding(
              "oracle-public-symbol-missing",
              publicSymbol,
              `${release} does not expose the claimed public C symbol`,
            ),
          );
          continue;
        }
        const expectedSource = EXPECTED_PUBLIC_C_DECLARATIONS.get(publicSymbol);
        const expected = expectedSource
          ? expectedPublicDeclarationSignature(expectedSource, publicSymbol)
          : null;
        const observedSignature = declarationSignature(tokens, publicSymbol);
        if (
          expected === null ||
          JSON.stringify(observedSignature) !== JSON.stringify(expected)
        ) {
          findings.push(
            finding(
              "oracle-public-signature-drift",
              publicSymbol,
              `${release} does not expose the exact reviewed public C signature`,
            ),
          );
        }
      }
    }
  }
  const required = oracle.requiredExtension;
  for (const [release, tokens] of headers) {
    if (identifierOccurrences(tokens, required.symbol).length !== 0) {
      findings.push(
        finding(
          "oracle-extension-already-public",
          required.symbol,
          `${release} already exposes the supposedly required extension`,
        ),
      );
    }
    if (
      identifierOccurrences(tokens, "rocksdb_ingest_external_file_cf")
        .length === 0
    ) {
      findings.push(
        finding(
          "oracle-per-cf-ingest-missing",
          "rocksdb_ingest_external_file_cf",
          `${release} does not expose the frozen non-atomic alternative`,
        ),
      );
    }
  }
  return findings;
}

export function auditFutureGreenGates(oracle) {
  const expected = [
    {
      id: "address-sanitizer",
      compilerFlag: "-fsanitize=address",
      environment: { ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1" },
      buildEnvironment: {
        CXXFLAGS: "-fsanitize=address -fno-omit-frame-pointer",
        RUSTFLAGS: "-C link-arg=-fsanitize=address",
      },
      diagnostic: /AddressSanitizer|LeakSanitizer/u,
    },
    {
      id: "undefined-behavior-sanitizer",
      compilerFlag: "-fsanitize=undefined",
      environment: { UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" },
      buildEnvironment: {
        CXXFLAGS: "-fsanitize=undefined -fno-omit-frame-pointer",
        RUSTFLAGS: "-C link-arg=-fsanitize=undefined",
      },
      diagnostic: /UndefinedBehaviorSanitizer|runtime error/u,
    },
  ];
  const findings = [];
  if (
    !Array.isArray(oracle.futureGreenGates) ||
    oracle.futureGreenGates.length !== expected.length
  ) {
    return [
      finding(
        "sanitizer-gate-inventory",
        "futureGreenGates",
        "future GREEN requires exactly one ASan and one UBSan gate",
      ),
    ];
  }
  for (const contract of expected) {
    const gate = oracle.futureGreenGates.find(({ id }) => id === contract.id);
    const cargo = gate?.cargo;
    if (
      !gate ||
      gate.compilerFlag !== contract.compilerFlag ||
      JSON.stringify(gate.environment) !==
        JSON.stringify(contract.environment) ||
      JSON.stringify(gate.buildEnvironment) !==
        JSON.stringify(contract.buildEnvironment) ||
      !Array.isArray(cargo) ||
      JSON.stringify(cargo) !==
        JSON.stringify([
          "test",
          "--offline",
          "-p",
          "oxigraph",
          "--features",
          "rocksdb",
          "--lib",
        ]) ||
      typeof gate.success !== "string" ||
      !gate.success.includes("zero exit") ||
      !contract.diagnostic.test(gate.success) ||
      gate.executionPhase !== "future-green-post-implementation" ||
      gate.unavailableDisposition !== "BLOCKED"
    ) {
      findings.push(
        finding(
          "sanitizer-gate-contract",
          contract.id,
          "sanitizer gate must bind exact compiler/runtime controls and fail on diagnostics",
        ),
      );
    }
  }
  return findings;
}

export function auditBridgeSource(
  source,
  oracle,
  { conditionalProtectedTagsOnly = false } = {},
) {
  const preprocessed = maskDefinitelyInactivePreprocessor(source);
  const tokens = expandMacros(
    tokenizeMaskedCode(preprocessed.source, preprocessed),
    parseMacros(preprocessed.macros),
  );
  const definitions = findCompleteTypeDefinitions(tokens);
  const opaqueByTag = new Map(
    oracle.opaqueMirrors.map((entry) => [entry.tag, entry]),
  );
  const privateTypes = new Set(
    oracle.opaqueMirrors.map((entry) => entry.privateCppType),
  );
  const findings = [
    ...ambiguousConditionalMacroFindings(preprocessed, oracle, {
      tagsOnly: conditionalProtectedTagsOnly,
    }),
    ...macroFailureFindings(tokens),
    ...(definitions.attributeFailures ?? [])
      .filter(({ subject }) => opaqueByTag.has(subject))
      .map(({ line, subject }) =>
        finding(
          "opaque-type-attribute-unsupported",
          subject,
          "an attribute between the type keyword and opaque tag is unsupported or ambiguous",
          line,
        ),
      ),
  ];

  for (const definition of definitions) {
    const opaque = opaqueByTag.get(definition.name);
    const bodyValues = tokenValues(definition.body);
    if (opaque) {
      findings.push(
        finding(
          "opaque-redefinition",
          definition.name,
          "RocksDB's public C handle is opaque and must not be completed outside its owner translation unit",
          definition.line,
        ),
      );
      const missingBaseline = opaque.baselineMemberNames.filter(
        (member) => !bodyValues.includes(member),
      );
      if (missingBaseline.length > 0) {
        findings.push(
          finding(
            "baseline-layout-divergence",
            definition.name,
            `local mirror omits baseline members: ${missingBaseline.join(", ")}`,
            definition.line,
          ),
        );
      }
      const missingCandidate = opaque.candidateMemberNames.filter(
        (member) => !bodyValues.includes(member),
      );
      if (missingCandidate.length > 0) {
        findings.push(
          finding(
            "candidate-layout-divergence",
            definition.name,
            `local mirror omits candidate members: ${missingCandidate.join(", ")}`,
            definition.line,
          ),
        );
      }
    } else {
      const mirroredTypes = [...privateTypes].filter((type) =>
        bodyValues.includes(type),
      );
      if (mirroredTypes.length > 0) {
        findings.push(
          finding(
            "renamed-opaque-mirror",
            definition.name,
            `renaming the wrapper does not make private representations safe: ${mirroredTypes.join(", ")}`,
            definition.line,
          ),
        );
      }
    }
  }

  for (const privateType of privateTypes) {
    const uses = identifierOccurrences(tokens, privateType);
    if (uses.length > 0) {
      findings.push(
        finding(
          "private-cpp-type-outside-owner",
          privateType,
          `private C++ representation type occurs ${uses.length} time(s) outside RocksDB's owner translation unit`,
          uses[0].line,
        ),
      );
    }
  }

  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (
      ["->", "."].includes(tokens[index].value) &&
      tokens[index + 1].value === "rep"
    ) {
      findings.push(
        finding(
          "opaque-representation-access",
          "rep",
          "direct representation access bypasses the public C ABI",
          tokens[index].line,
        ),
      );
    }
    if (tokens[index].value === "new") {
      let cursor = index + 1;
      if (tokens[cursor]?.value === "(") {
        const close = matchingToken(tokens, cursor, "(", ")");
        cursor = close < 0 ? cursor : close + 1;
      }
      if (opaqueByTag.has(tokens[cursor]?.value)) {
        findings.push(
          finding(
            "opaque-construction-outside-owner",
            tokens[cursor].value,
            "an opaque RocksDB wrapper must be constructed by its owner translation unit",
            tokens[index].line,
          ),
        );
      }
    }
  }
  return findings;
}

function literalBuildTranslationUnits(buildScriptSource) {
  return [
    ...new Set(
      [
        ...buildScriptSource.matchAll(
          /\.file\s*\(\s*"([^"]+\.(?:c|cc|cpp|cxx))"\s*\)/gu,
        ),
      ].map((match) => posix.join("oxrocksdb-sys", match[1])),
    ),
  ].sort();
}

function manifestBuildTranslationUnits(sourceManifest) {
  const body = /LIB_SOURCES\s*=([\s\S]*?)\nifeq\b/u.exec(sourceManifest)?.[1];
  if (body === undefined) return null;
  return [
    ...new Set(
      body
        .replaceAll("\\", " ")
        .split(/\s+/u)
        .filter((path) => /\.(?:c|cc|cpp|cxx)$/u.test(path))
        .filter((path) => path !== "util/build_version.cc")
        .map((path) => posix.join("oxrocksdb-sys/rocksdb", path)),
    ),
  ].sort();
}

function parseInclude(record) {
  const quoted =
    /^\s*"([^"]+)"\s*(?:(?:\/\/.*)|(?:\/\*[\s\S]*?\*\/))?\s*$/u.exec(
      record.expression,
    );
  if (quoted) return { kind: "quoted", path: quoted[1] };
  const angled =
    /^\s*<([^>]+)>\s*(?:(?:\/\/.*)|(?:\/\*[\s\S]*?\*\/))?\s*$/u.exec(
      record.expression,
    );
  if (angled) return { kind: "angled", path: angled[1] };
  return null;
}

const BUILD_INCLUDE_CACHE = new Map();
const BUILD_SEMANTIC_CACHE = new Map();
const BUILD_PREPROCESSOR_CACHE = new Map();
const BUILD_CROSS_FILE_MACRO_CACHE = new Map();
const BUILD_INCLUDE_GUARD_CACHE = new Map();
const BUILD_STRUCTURAL_TYPE_TOKEN_CACHE = new Map();

function buildPreprocessed(source) {
  let preprocessed = BUILD_PREPROCESSOR_CACHE.get(source);
  if (preprocessed === undefined) {
    preprocessed = maskDefinitelyInactivePreprocessor(source);
    BUILD_PREPROCESSOR_CACHE.set(source, preprocessed);
  }
  return preprocessed;
}

function buildIncludes(source) {
  let includes = BUILD_INCLUDE_CACHE.get(source);
  if (includes === undefined) {
    includes = buildPreprocessed(source).includes;
    BUILD_INCLUDE_CACHE.set(source, includes);
  }
  return includes;
}

function buildCrossFileMacroShapes(source) {
  let shapes = BUILD_CROSS_FILE_MACRO_CACHE.get(source);
  if (shapes !== undefined) return shapes;
  shapes = buildPreprocessed(source).macros.map((record) => {
    const match =
      record.kind === "undef"
        ? /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(record.expression)
        : /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s*(.*)$/u.exec(
            record.expression,
          );
    const replacementTokens = tokenizeMaskedCode(
      record.kind === "undef" ? "" : (match?.[2] ?? ""),
    );
    return {
      record,
      name: match?.[1] ?? null,
      replacementTokens,
      references: new Set(
        replacementTokens
          .map(({ value }) => value)
          .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)),
      ),
    };
  });
  BUILD_CROSS_FILE_MACRO_CACHE.set(source, shapes);
  return shapes;
}

function auditSelectedBuildSource(path, source, oracle) {
  const mode = path.startsWith("oxrocksdb-sys/rocksdb/")
    ? path === oracle.requiredExtension.ownerTranslationUnit
      ? "rocksdb-owner"
      : "rocksdb-non-owner"
    : path === "oxrocksdb-sys/api/c.cc"
      ? "api-owner"
      : "external";
  const key = `${mode}\0${source}`;
  let findings = BUILD_SEMANTIC_CACHE.get(key);
  if (findings !== undefined) return findings;
  const semanticFindings = auditBridgeSource(source, oracle, {
    conditionalProtectedTagsOnly: mode.startsWith("rocksdb-"),
  });
  if (mode === "api-owner") {
    // The complete semantic audit is also reported by the top-level evaluator.
    // Build-graph auditing retains conditional ambiguity rather than silently
    // discarding a protected representation that an unknown build arm selects.
    findings = semanticFindings.filter(
      ({ code }) => code === "ambiguous-preprocessor-macro",
    );
  } else if (mode.startsWith("rocksdb-")) {
    findings =
      mode === "rocksdb-owner"
        ? semanticFindings.filter(
            ({ code }) => code === "ambiguous-preprocessor-macro",
          )
        : semanticFindings
            .filter(({ code }) =>
              ["ambiguous-preprocessor-macro", "opaque-redefinition"].includes(
                code,
              ),
            )
            .map((entry) =>
              entry.code === "opaque-redefinition"
                ? {
                    ...entry,
                    message:
                      "an opaque RocksDB wrapper definition moved outside its exact owner translation unit",
                  }
                : entry,
            );
  } else {
    findings = semanticFindings.filter(({ code }) =>
      [
        "ambiguous-preprocessor-macro",
        "opaque-redefinition",
        "renamed-opaque-mirror",
        "private-cpp-type-outside-owner",
        "opaque-representation-access",
        "opaque-construction-outside-owner",
      ].includes(code),
    );
  }
  BUILD_SEMANTIC_CACHE.set(key, findings);
  return findings;
}

function selectedIncludeTargets(path, source, sources, selectedPaths) {
  const targets = [];
  for (const record of buildIncludes(source)) {
    const include = parseInclude(record);
    if (record.keyword !== "include" || include === null) continue;
    const candidates = [
      posix.normalize(posix.join(posix.dirname(path), include.path)),
      posix.join("oxrocksdb-sys/rocksdb", include.path),
      posix.join("oxrocksdb-sys/rocksdb/include", include.path),
      posix.join("oxrocksdb-sys/lz4/lib", include.path),
      posix.join("oxrocksdb-sys/api", include.path),
    ];
    const resolved = candidates.find(
      (candidate) => selectedPaths.has(candidate) && sources.has(candidate),
    );
    if (resolved !== undefined && !targets.includes(resolved)) {
      targets.push(resolved);
    }
  }
  return targets;
}

function crossFileComposedMacroFindings(paths, sources, oracle) {
  const selectedPaths = new Set(paths);
  const protectedNames = new Set(
    oracle.opaqueMirrors.flatMap(({ tag, privateCppType }) => [
      tag,
      privateCppType,
    ]),
  );
  const preprocessedByPath = new Map(
    paths.flatMap((path) => {
      const source = sources.get(path);
      return typeof source === "string"
        ? [[path, buildPreprocessed(source)]]
        : [];
    }),
  );
  const includesByPath = new Map(
    [...preprocessedByPath].map(([path]) => [
      path,
      selectedIncludeTargets(path, sources.get(path), sources, selectedPaths),
    ]),
  );
  const findings = [];
  const reported = new Set();
  for (const path of paths) {
    if (!/\.(?:c|cc|cpp|cxx)$/u.test(path)) continue;
    const preprocessed = preprocessedByPath.get(path);
    if (preprocessed === undefined) continue;
    const included = new Set();
    const queued = [...(includesByPath.get(path) ?? [])];
    while (queued.length > 0) {
      const includedPath = queued.shift();
      if (included.has(includedPath)) continue;
      included.add(includedPath);
      queued.push(...(includesByPath.get(includedPath) ?? []));
    }
    if (included.size === 0) continue;
    const macroShapes = [...included].flatMap((includedPath) =>
      buildCrossFileMacroShapes(sources.get(includedPath)),
    );
    const macroNames = new Set(
      macroShapes.flatMap(({ name }) => (name === null ? [] : [name])),
    );
    const macroShapesByName = new Map();
    for (const shape of macroShapes) {
      if (shape.name === null) continue;
      const shapes = macroShapesByName.get(shape.name) ?? [];
      shapes.push(shape);
      macroShapesByName.set(shape.name, shapes);
    }
    const potentiallyProtectedNames = new Set(
      macroShapes.flatMap(({ name, record, replacementTokens }) => {
        if (name === null) return [];
        const values = tokenValues(replacementTokens);
        const hasComposition = values.includes("##");
        const hasProtectedFragment = values.some((value) =>
          [...protectedNames].some(
            (protectedName) =>
              value === protectedName ||
              (value.length >= 3 && protectedName.includes(value)),
          ),
        );
        return hasComposition ||
          (record.conditional === true && hasProtectedFragment)
          ? [name]
          : [];
      }),
    );
    let potentiallyChanged = true;
    while (potentiallyChanged) {
      potentiallyChanged = false;
      for (const { name, references } of macroShapes) {
        if (
          name !== null &&
          !potentiallyProtectedNames.has(name) &&
          [...references].some((reference) =>
            potentiallyProtectedNames.has(reference),
          )
        ) {
          potentiallyProtectedNames.add(name);
          potentiallyChanged = true;
        }
      }
    }
    const sourceTokens = tokenizeMaskedCode(preprocessed.source, preprocessed);
    const seenInvocations = new Set();
    for (let index = 0; index < sourceTokens.length; index += 1) {
      const invocationName = sourceTokens[index].value;
      if (
        !macroNames.has(invocationName) ||
        !potentiallyProtectedNames.has(invocationName)
      )
        continue;
      let invocationEnd = index + 1;
      if (sourceTokens[index + 1]?.value === "(") {
        const close = matchingToken(sourceTokens, index + 1, "(", ")");
        if (close >= 0) invocationEnd = close + 1;
      }
      const invocation = sourceTokens.slice(index, invocationEnd);
      const invocationSignature = tokenValues(invocation).join("\0");
      if (seenInvocations.has(invocationSignature)) continue;
      seenInvocations.add(invocationSignature);
      const dependencyNames = new Set(
        invocation
          .map(({ value }) => value)
          .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)),
      );
      const dependencyQueue = [...dependencyNames];
      while (dependencyQueue.length > 0) {
        const dependencyName = dependencyQueue.shift();
        for (const shape of macroShapesByName.get(dependencyName) ?? []) {
          for (const reference of shape.references) {
            if (!dependencyNames.has(reference)) {
              dependencyNames.add(reference);
              dependencyQueue.push(reference);
            }
          }
        }
      }
      const relevantShapes = macroShapes.filter(
        ({ name }) => name !== null && dependencyNames.has(name),
      );
      const hasProtectedMaterial = [
        ...invocation,
        ...relevantShapes.flatMap(({ replacementTokens }) => replacementTokens),
      ].some(({ value }) =>
        [...protectedNames].some(
          (protectedName) =>
            value === protectedName ||
            (value.length >= 3 && protectedName.includes(value)),
        ),
      );
      if (!hasProtectedMaterial) continue;
      const conditionalIndexes = relevantShapes.flatMap((shape, shapeIndex) =>
        shape.record.conditional === true ? [shapeIndex] : [],
      );
      if (conditionalIndexes.length === 0) continue;
      if (conditionalIndexes.length > 6) {
        const key = `ambiguous-preprocessor-macro\0${invocationName}`;
        if (!reported.has(key)) {
          reported.add(key);
          findings.push(
            finding(
              "ambiguous-preprocessor-macro",
              invocationName,
              `cross-file macro composition from selected includes has ${conditionalIndexes.length} conditional events and cannot be proved representation-safe`,
              sourceTokens[index].line,
            ),
          );
        }
        continue;
      }
      const conditionalBitByShape = new Map(
        conditionalIndexes.map((shapeIndex, bitIndex) => [
          shapeIndex,
          bitIndex,
        ]),
      );
      const dangerousStates = [];
      for (let state = 0; state < 2 ** conditionalIndexes.length; state += 1) {
        let line = 1;
        const records = relevantShapes.flatMap((shape, shapeIndex) => {
          const bitIndex = conditionalBitByShape.get(shapeIndex);
          if (bitIndex !== undefined && (state & (1 << bitIndex)) === 0) {
            return [];
          }
          return [{ ...shape.record, line: line++ }];
        });
        const macros = parseMacros(records);
        const expanded = expandMacros(
          invocation.map((token) => ({ ...token, line: line + 1 })),
          macros,
        );
        const protectedExpansion = expanded.find(({ value }) =>
          protectedNames.has(value),
        )?.value;
        if (protectedExpansion !== undefined) {
          dangerousStates.push(protectedExpansion);
        }
      }
      if (dangerousStates.length === 0) continue;
      const conditionalNames = new Set(
        conditionalIndexes.map((shapeIndex) => relevantShapes[shapeIndex].name),
      );
      if (conditionalNames.size === 0) {
        const subject = dangerousStates[0];
        const key = `opaque-redefinition\0${subject}`;
        if (!reported.has(key)) {
          reported.add(key);
          findings.push(
            finding(
              "opaque-redefinition",
              subject,
              `cross-file macro composition from selected includes completes protected representation ${subject}`,
              sourceTokens[index].line,
            ),
          );
        }
      } else {
        for (const subject of conditionalNames) {
          const key = `ambiguous-preprocessor-macro\0${subject}`;
          if (reported.has(key)) continue;
          reported.add(key);
          findings.push(
            finding(
              "ambiguous-preprocessor-macro",
              subject,
              `conditional cross-file macro composition from selected includes can complete protected representation ${dangerousStates[0]}`,
              sourceTokens[index].line,
            ),
          );
        }
      }
    }
  }
  return findings;
}

function crossFileConditionalMacroFindings(paths, sources, oracle) {
  const protectedNames = new Set(
    oracle.opaqueMirrors.flatMap(({ tag, privateCppType }) => [
      tag,
      privateCppType,
    ]),
  );
  const files = paths.flatMap((path) => {
    const source = sources.get(path);
    if (typeof source !== "string") return [];
    const preprocessed = buildPreprocessed(source);
    return [
      {
        path,
        tokens: new Set(
          tokenizeMaskedCode(preprocessed.source, preprocessed).map(
            ({ value }) => value,
          ),
        ),
        macros: buildCrossFileMacroShapes(source).flatMap(
          ({ name, record, references }) =>
            name === null
              ? []
              : [
                  {
                    name,
                    line: record.line,
                    conditional: record.conditional === true,
                    references,
                  },
                ],
        ),
      },
    ];
  });
  const relevantNames = new Set(protectedNames);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { macros } of files) {
      for (const { name, references } of macros) {
        if (
          !relevantNames.has(name) &&
          [...references].some((reference) => relevantNames.has(reference))
        ) {
          relevantNames.add(name);
          changed = true;
        }
      }
    }
  }
  const findings = [];
  const reported = new Set();
  for (const file of files) {
    for (const macro of file.macros) {
      const key = `${file.path}\0${macro.name}\0${macro.line}`;
      if (
        !macro.conditional ||
        !relevantNames.has(macro.name) ||
        reported.has(key) ||
        !files.some(
          (candidate) =>
            candidate.path !== file.path &&
            (candidate.tokens.has(macro.name) ||
              candidate.macros.some(({ references }) =>
                references.has(macro.name),
              )),
        )
      ) {
        continue;
      }
      reported.add(key);
      findings.push(
        finding(
          "ambiguous-preprocessor-macro",
          macro.name,
          `unknown conditional macro from ${file.path} can alter a protected representation in another selected source`,
          macro.line,
        ),
      );
    }
  }
  for (const composedFinding of crossFileComposedMacroFindings(
    paths,
    sources,
    oracle,
  )) {
    if (
      !findings.some(
        ({ code, subject }) =>
          code === composedFinding.code && subject === composedFinding.subject,
      )
    ) {
      findings.push(composedFinding);
    }
  }
  return findings;
}

function orderedSelectedIncludeTarget(path, record, sources, selectedPaths) {
  const include = parseInclude(record);
  if (record.keyword !== "include" || include === null) return null;
  return (
    [
      posix.normalize(posix.join(posix.dirname(path), include.path)),
      posix.join("oxrocksdb-sys/rocksdb", include.path),
      posix.join("oxrocksdb-sys/rocksdb/include", include.path),
      posix.join("oxrocksdb-sys/lz4/lib", include.path),
      posix.join("oxrocksdb-sys/api", include.path),
    ].find(
      (candidate) => selectedPaths.has(candidate) && sources.has(candidate),
    ) ?? null
  );
}

function conventionalIncludeGuard(path, source) {
  if (BUILD_INCLUDE_GUARD_CACHE.has(source)) {
    const cached = BUILD_INCLUDE_GUARD_CACHE.get(source);
    return cached === "#pragma-once" ? `#pragma-once:${path}` : cached;
  }
  const masked = maskLexicalNoise(spliceCppTranslationLines(source).source);
  const pragmaOnce =
    /^[^\S\r\n]*(?:#|%:)\s*pragma\s+once\b[^\r\n]*/mu.exec(masked);
  if (
    pragmaOnce !== null &&
    masked.slice(0, pragmaOnce.index).trim() === ""
  ) {
    BUILD_INCLUDE_GUARD_CACHE.set(source, "#pragma-once");
    return `#pragma-once:${path}`;
  }
  const directives = [
    ...masked.matchAll(
      /^\s*(?:#|%:)\s*([A-Za-z_][A-Za-z0-9_]*)\b([^\r\n]*)/gmu,
    ),
  ];
  const conditional = directives[0];
  const define = directives[1];
  const closing = directives.at(-1);
  let conditionalDepth = 0;
  let outerAlternative = false;
  let balancedConditionals = true;
  for (const directive of directives) {
    const keyword = directive[1].toLowerCase();
    if (["if", "ifdef", "ifndef"].includes(keyword)) {
      conditionalDepth += 1;
    } else if (["else", "elif"].includes(keyword)) {
      if (conditionalDepth === 1) outerAlternative = true;
      if (conditionalDepth === 0) balancedConditionals = false;
    } else if (keyword === "endif") {
      conditionalDepth -= 1;
      if (conditionalDepth < 0) balancedConditionals = false;
    }
  }
  if (conditionalDepth !== 0) balancedConditionals = false;
  if (
    conditional !== undefined &&
    define !== undefined &&
    closing?.[1] === "endif" &&
    balancedConditionals &&
    !outerAlternative &&
    masked.slice(0, conditional.index).trim() === "" &&
    masked.slice(closing.index + closing[0].length).trim() === ""
  ) {
    const guard =
      conditional[1] === "ifndef"
        ? /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(conditional[2])?.[1]
        : conditional[1] === "if"
          ? /^\s*!\s*defined\s*(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/u.exec(
              conditional[2],
            )?.[1]
          : null;
    if (
      guard !== null &&
      define[1] === "define" &&
      new RegExp(`^\\s*${guard}\\b`, "u").test(define[2])
    ) {
      BUILD_INCLUDE_GUARD_CACHE.set(source, guard);
      return guard;
    }
  }
  BUILD_INCLUDE_GUARD_CACHE.set(source, null);
  return null;
}

function orderedRecordIsConditional(record, guard) {
  if (record.conditional !== true) return false;
  if (guard === null || guard.startsWith("#pragma-once:")) return true;
  return !(
    record.unknownConditionalCount === 1 &&
    record.unknownGuardNames?.length === 1 &&
    record.unknownGuardNames[0] === guard
  );
}

function macroNamesProducingTypeKeywords(shapes) {
  const names = new Set(
    shapes.flatMap(({ name, replacementTokens }) => {
      if (name === null) return [];
      const values = tokenValues(replacementTokens);
      const identifiers = values.filter((value) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value),
      );
      const composesKeyword = identifiers.some((_, start) =>
        [1, 2, 3].some((length) =>
          ["struct", "class", "union"].includes(
            identifiers.slice(start, start + length).join(""),
          ),
        ),
      );
      return composesKeyword ? [name] : [];
    }),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, references } of shapes) {
      if (
        name !== null &&
        !names.has(name) &&
        [...references].some((reference) => names.has(reference))
      ) {
        names.add(name);
        changed = true;
      }
    }
  }
  return names;
}

function macroNamesProducingProtectedTags(shapes, protectedNames) {
  const names = new Set(
    shapes.flatMap(({ name, replacementTokens }) => {
      if (name === null) return [];
      const values = tokenValues(replacementTokens);
      return values.includes("##") ||
        values.some((value) => protectedNames.has(value))
        ? [name]
        : [];
    }),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, references } of shapes) {
      if (
        name !== null &&
        !names.has(name) &&
        [...references].some((reference) => names.has(reference))
      ) {
        names.add(name);
        changed = true;
      }
    }
  }
  return names;
}

function macroIdentifierFragmentValues(shapes) {
  const fragments = new Map();
  for (const { name, record, replacementTokens } of shapes) {
    if (name === null || record.kind !== "define") continue;
    const definition =
      /^\s*[A-Za-z_][A-Za-z0-9_]*(\([^)]*\))?\s*(.*)$/u.exec(
        record.expression,
      );
    if (definition?.[1] !== undefined) continue;
    const identifiers = replacementTokens
      .map(({ value }) => value)
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value));
    if (identifiers.length === 0) continue;
    const values = fragments.get(name) ?? new Set();
    for (const identifier of identifiers) values.add(identifier);
    values.add(identifiers.join(""));
    fragments.set(name, values);
  }
  let changed = true;
  for (
    let iteration = 0;
    changed && iteration <= fragments.size;
    iteration += 1
  ) {
    changed = false;
    for (const values of fragments.values()) {
      for (const value of [...values]) {
        for (const expanded of fragments.get(value) ?? []) {
          if (!values.has(expanded)) {
            values.add(expanded);
            changed = true;
          }
        }
      }
    }
  }
  return fragments;
}

function invocationCouldComposeTypeKeyword(tokens, index, policy) {
  if (
    !policy.macroNames.has(tokens[index]?.value) ||
    tokens[index + 1]?.value !== "("
  ) {
    return false;
  }
  const close = matchingToken(tokens, index + 1, "(", ")");
  if (close < 0) return false;
  const identifiers = [];
  for (let cursor = index + 2; cursor < close; cursor += 1) {
    const value = tokens[cursor].value;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) continue;
    if (
      policy.macroNames.has(value) &&
      tokens[cursor + 1]?.value === "("
    ) {
      continue;
    }
    identifiers.push(value);
    if (identifiers.length >= 16) break;
  }
  for (const keyword of ["struct", "class", "union"]) {
    for (let start = 0; start < identifiers.length; start += 1) {
      let prefixes = new Set([""]);
      for (
        let cursor = start;
        cursor < identifiers.length && cursor < start + 8;
        cursor += 1
      ) {
        const options = new Set([
          identifiers[cursor],
          ...(policy.identifierFragments.get(identifiers[cursor]) ?? []),
        ]);
        const next = new Set();
        for (const prefix of prefixes) {
          for (const option of options) {
            const candidate = `${prefix}${option}`;
            if (candidate === keyword) return true;
            if (keyword.startsWith(candidate)) next.add(candidate);
          }
        }
        prefixes = next;
        if (prefixes.size === 0) break;
      }
    }
  }
  return false;
}

function enclosingKnownMacroInvocationStart(tokens, index, macroNames) {
  let start = index;
  let changed = true;
  while (changed) {
    changed = false;
    let depth = 0;
    for (let cursor = start - 1; cursor >= 0; cursor -= 1) {
      const value = tokens[cursor].value;
      if ([")", "]"].includes(value)) {
        depth += 1;
      } else if (["(", "["].includes(value)) {
        if (depth > 0) {
          depth -= 1;
        } else {
          const candidate = tokens[cursor - 1]?.value;
          if (value === "(" && macroNames.has(candidate)) {
            start = cursor - 1;
            changed = true;
          }
          break;
        }
      }
    }
  }
  return start;
}

function structuralTypeWindows(tokens, policy) {
  const retained = new Map();
  const failures = [];
  const starts = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const dynamicInvocation = invocationCouldComposeTypeKeyword(
      tokens,
      index,
      policy,
    );
    if (
      ["struct", "class", "union"].includes(tokens[index].value) ||
      policy.typeKeywordMacroNames.has(tokens[index].value) ||
      dynamicInvocation
    ) {
      const start = enclosingKnownMacroInvocationStart(
        tokens,
        index,
        policy.macroNames,
      );
      const roots = starts.get(start) ?? new Set();
      if (dynamicInvocation) roots.add(tokens[index].value);
      starts.set(start, roots);
    }
  }
  for (const [start, typeKeywordMacroRoots] of starts) {
    let delimiterDepth = 0;
    let boundary = -1;
    const limit = Math.min(tokens.length, start + 256);
    for (let cursor = start; cursor < limit; cursor += 1) {
      const value = tokens[cursor].value;
      if (
        cursor > start &&
        delimiterDepth === 0 &&
        ["{", ";"].includes(value)
      ) {
        boundary = cursor;
        break;
      }
      if (["(", "["].includes(value)) delimiterDepth += 1;
      if ([")", "]"].includes(value) && delimiterDepth > 0) {
        delimiterDepth -= 1;
      }
    }
    if (boundary < 0) {
      failures.push(tokens[start]?.line ?? null);
      continue;
    }
    for (let cursor = start; cursor <= boundary; cursor += 1) {
      if (!retained.has(cursor)) {
        retained.set(cursor, {
          ...tokens[cursor],
          sourceTokenIndex: cursor,
          declarationWindowEnds: [],
          typeKeywordMacroRoots: [],
        });
      }
    }
    retained.get(start).declarationWindowEnds.push(boundary);
    retained
      .get(start)
      .typeKeywordMacroRoots.push(...typeKeywordMacroRoots);
  }
  return {
    failures,
    tokens: [...retained.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, token]) => token),
  };
}

function buildStructuralTypeTokens(source, policy) {
  let sourceCache = BUILD_STRUCTURAL_TYPE_TOKEN_CACHE.get(source);
  if (sourceCache === undefined) {
    sourceCache = new Map();
    BUILD_STRUCTURAL_TYPE_TOKEN_CACHE.set(source, sourceCache);
  }
  let result = sourceCache.get(policy.cacheKey);
  if (result !== undefined) return result;
  const preprocessed = buildPreprocessed(source);
  const allTokens = tokenizeMaskedCode(preprocessed.source, preprocessed);
  result = structuralTypeWindows(allTokens, policy);
  sourceCache.set(policy.cacheKey, result);
  return result;
}

function orderedTranslationUnitEventStream(
  rootPath,
  sources,
  selectedPaths,
  structuralPolicy,
) {
  const eventBudget = 20_000;
  const declarationWindows = [];
  const macroEvents = [];
  const macroValueEvents = new Map();
  const definitionEvents = new Map();
  const guardByPath = new Map();
  const expandedUnguardedStates = new Map();
  const unguardedVisitCounts = new Map();
  const repetitionBudgetFailures = new Set();
  const conditionsImply = (current, required) =>
    required.every((condition) => current.includes(condition));
  const definitelyDefinedAt = (name, conditions) => {
    const events = definitionEvents.get(name) ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (conditionsImply(conditions, events[index].conditions)) {
        return events[index].defined;
      }
    }
    return false;
  };
  const recordDefinition = (name, defined, conditions) => {
    const events = definitionEvents.get(name) ?? [];
    events.push({ conditions: [...conditions], defined });
    definitionEvents.set(name, events);
  };
  const recordMacroValue = (name, value, conditions) => {
    const events = macroValueEvents.get(name) ?? [];
    events.push({ conditions: [...conditions], value });
    macroValueEvents.set(name, events);
  };
  const macroValueAt = (events, conditions) => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (conditionsImply(conditions, events[index].conditions)) {
        return events[index].value;
      }
    }
    return null;
  };
  const unguardedStateIdentity = (conditions) =>
    sha256(
      Buffer.from(
        JSON.stringify([
          conditions,
          [...macroValueEvents]
            .flatMap(([name, events]) => {
              const value = macroValueAt(events, conditions);
              return value === null ? [] : [[name, value]];
            })
            .sort(([left], [right]) => left.localeCompare(right)),
        ]),
      ),
    );
  let sequence = 0;
  let visitSequence = 0;
  const visit = (path, stack, inheritedConditions) => {
    if (sequence >= eventBudget) {
      repetitionBudgetFailures.add(path);
      return;
    }
    const source = sources.get(path);
    if (typeof source !== "string") return;
    const visitId = visitSequence++;
    let guard = guardByPath.get(path);
    if (guard === undefined) {
      guard = conventionalIncludeGuard(path, source);
      guardByPath.set(path, guard);
    }
    const pragmaOnce = guard?.startsWith("#pragma-once:") === true;
    if (pragmaOnce && definitelyDefinedAt(guard, inheritedConditions)) return;
    if (
      !pragmaOnce &&
      guard !== null &&
      definitelyDefinedAt(guard, inheritedConditions)
    ) {
      return;
    }
    if (stack.has(path)) return;
    if (guard === null) {
      const stateIdentity = unguardedStateIdentity(inheritedConditions);
      const expandedStates = expandedUnguardedStates.get(path) ?? new Set();
      if (expandedStates.has(stateIdentity)) return;
      const visits = unguardedVisitCounts.get(path) ?? 0;
      if (visits >= 16) {
        repetitionBudgetFailures.add(path);
        return;
      }
      expandedStates.add(stateIdentity);
      expandedUnguardedStates.set(path, expandedStates);
      unguardedVisitCounts.set(path, visits + 1);
    }
    if (guard !== null) {
      recordDefinition(guard, true, inheritedConditions);
    }
    const preprocessed = buildPreprocessed(source);
    const structural = buildStructuralTypeTokens(source, structuralPolicy);
    const fileTokens = structural.tokens;
    if (structural.failures.length > 0) {
      repetitionBudgetFailures.add(path);
    }
    const shapeByRecord = new Map(
      buildCrossFileMacroShapes(source).map((shape) => [shape.record, shape]),
    );
    const events = [
      ...preprocessed.macros.map((record, order) => ({
        kind: "macro",
        line: record.line,
        order,
        record,
      })),
      ...preprocessed.includes.map((record, order) => ({
        kind: "include",
        line: record.line,
        order,
        record,
      })),
      ...fileTokens.map((token) => ({
        kind: "token",
        line: token.line,
        order: token.index,
        token,
      })),
    ].sort(
      (left, right) =>
        left.line - right.line ||
        (left.kind === "token" ? 1 : 0) - (right.kind === "token" ? 1 : 0) ||
        left.order - right.order,
    );
    const nextStack = new Set(stack).add(path);
    let activeDeclarationWindows = [];
    for (const event of events) {
      if (sequence >= eventBudget) {
        repetitionBudgetFailures.add(path);
        return;
      }
      if (event.kind === "token") {
        const emitted = {
          ...event.token,
          line: sequence++,
          sourceLine: event.token.line,
          path,
          visitId,
          inheritedConditions,
        };
        activeDeclarationWindows = activeDeclarationWindows.filter(
          ({ end }) => end >= event.token.sourceTokenIndex,
        );
        for (const end of event.token.declarationWindowEnds ?? []) {
          const window = { end, path, tokens: [], visitId };
          declarationWindows.push(window);
          activeDeclarationWindows.push(window);
        }
        for (const window of activeDeclarationWindows) {
          if (event.token.sourceTokenIndex <= window.end) {
            window.tokens.push(emitted);
          }
        }
      } else if (event.kind === "macro") {
        const shape = shapeByRecord.get(event.record);
        if (shape !== undefined) {
          const intrinsicConditional = orderedRecordIsConditional(
            event.record,
            guard,
          );
          const effectiveConditional =
            inheritedConditions.length > 0 || intrinsicConditional;
          const orderedRecord = {
            ...event.record,
            conditional: effectiveConditional,
            line: sequence,
            sourceLine: event.record.line,
          };
          macroEvents.push({
            ...shape,
            path,
            sequence: sequence++,
            inheritedConditions,
            intrinsicConditional,
            record: orderedRecord,
          });
          if (shape.name !== null) {
            if (event.record.kind === "undef" && intrinsicConditional) {
              // A possible undef means the name is no longer definitely
              // defined.  Conservatively permit a later include to re-enter;
              // the ordered conditional expansion will retain the ambiguity.
              recordDefinition(shape.name, false, inheritedConditions);
              recordMacroValue(shape.name, null, inheritedConditions);
            } else if (event.record.kind === "undef") {
              recordDefinition(shape.name, false, inheritedConditions);
              recordMacroValue(shape.name, null, inheritedConditions);
            } else if (!intrinsicConditional) {
              recordDefinition(shape.name, true, inheritedConditions);
              recordMacroValue(
                shape.name,
                JSON.stringify({
                  parameters:
                    /^\s*[A-Za-z_][A-Za-z0-9_]*(\([^)]*\))?/u.exec(
                      event.record.expression,
                    )?.[1] ?? null,
                  replacement: tokenValues(shape.replacementTokens),
                }),
                inheritedConditions,
              );
            }
          }
        }
      } else {
        const includeSequence = sequence++;
        const target = orderedSelectedIncludeTarget(
          path,
          event.record,
          sources,
          selectedPaths,
        );
        if (target !== null) {
          const includeConditional = orderedRecordIsConditional(
            event.record,
            guard,
          );
          visit(
            target,
            nextStack,
            includeConditional
              ? [
                  ...inheritedConditions,
                  `${path}:${event.record.line}:${includeSequence}:${event.record.expression}`,
                ]
              : inheritedConditions,
          );
        }
      }
    }
  };
  visit(rootPath, new Set(), []);
  return {
    declarationWindows,
    macroEvents,
    repetitionBudgetFailures,
  };
}

function orderedCrossFileConditionalMacroFindings(
  translationUnits,
  selectedPathList,
  sources,
  oracle,
) {
  const selectedPaths = new Set(selectedPathList);
  const protectedNames = new Set(oracle.opaqueMirrors.map(({ tag }) => tag));
  const selectedMacroShapes = selectedPathList.flatMap((selectedPath) => {
    const source = sources.get(selectedPath);
    return typeof source === "string" ? buildCrossFileMacroShapes(source) : [];
  });
  const typeKeywordMacroNames =
    macroNamesProducingTypeKeywords(selectedMacroShapes);
  const protectedTagMacroNames = macroNamesProducingProtectedTags(
    selectedMacroShapes,
    protectedNames,
  );
  const macroNames = new Set(
    selectedMacroShapes.flatMap(({ name }) => (name === null ? [] : [name])),
  );
  const identifierFragments = macroIdentifierFragmentValues(
    selectedMacroShapes,
  );
  const structuralPolicy = {
    cacheKey: sha256(
      Buffer.from(
        JSON.stringify([
          [...typeKeywordMacroNames].sort(),
          [...macroNames].sort(),
          [...identifierFragments]
            .map(([name, values]) => [name, [...values].sort()])
            .sort(([left], [right]) => left.localeCompare(right)),
        ]),
      ),
    ),
    identifierFragments,
    macroNames,
    typeKeywordMacroNames,
  };
  const completeProtectedType = (expanded) => {
    const candidate =
      expanded.at(-1)?.value === "{"
        ? [
            ...expanded,
            {
              value: "}",
              line: expanded.at(-1)?.line ?? 1,
              index: expanded.at(-1)?.index ?? 0,
            },
          ]
        : expanded;
    return findCompleteTypeDefinitions(candidate).find(({ name }) =>
      protectedNames.has(name),
    )?.name;
  };
  const findings = [];
  const reported = new Set();
  for (const path of translationUnits) {
    if (!selectedPaths.has(path) || !sources.has(path)) continue;
    const { declarationWindows, macroEvents, repetitionBudgetFailures } =
      orderedTranslationUnitEventStream(
        path,
        sources,
        selectedPaths,
        structuralPolicy,
      );
    for (const repeatedPath of repetitionBudgetFailures) {
      const key = `ambiguous-preprocessor-macro\0${repeatedPath}`;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push(
        finding(
          "ambiguous-preprocessor-macro",
          repeatedPath,
          `ordered include/declaration expansion in ${path} exceeded a finite per-translation-unit event, declaration-window, or per-path repetition bound`,
        ),
      );
    }
    if (macroEvents.length === 0) continue;
    for (const window of declarationWindows) {
      const declaration = window.tokens;
      if (declaration.length === 0) continue;
      const declarationValues = tokenValues(declaration);
      const protectedRoots = declarationValues.filter(
        (value) =>
          protectedNames.has(value) || protectedTagMacroNames.has(value),
      );
      if (protectedRoots.length === 0) continue;
      const invocationSequence = declaration[0].line;
      const invocationConditions = new Set(
        declaration[0].inheritedConditions ?? [],
      );
      const precedingShapes = macroEvents
        .filter(
          ({ sequence: definitionSequence }) =>
            definitionSequence < invocationSequence,
        )
        .map((shape) => ({
          ...shape,
          record: {
            ...shape.record,
            conditional:
              shape.intrinsicConditional === true ||
              (shape.inheritedConditions ?? []).some(
                (condition) => !invocationConditions.has(condition),
              ),
          },
        }));
      const lastUnconditionalByName = new Map();
      for (
        let shapeIndex = 0;
        shapeIndex < precedingShapes.length;
        shapeIndex += 1
      ) {
        const shape = precedingShapes[shapeIndex];
        if (shape.name !== null && shape.record.conditional !== true) {
          lastUnconditionalByName.set(shape.name, shapeIndex);
        }
      }
      const activePrecedingShapes = precedingShapes.filter(
        ({ name }, shapeIndex) =>
          name !== null &&
          shapeIndex >= (lastUnconditionalByName.get(name) ?? 0),
      );
      const macroShapesByName = new Map();
      for (const shape of activePrecedingShapes) {
        if (shape.name === null) continue;
        const shapes = macroShapesByName.get(shape.name) ?? [];
        shapes.push(shape);
        macroShapesByName.set(shape.name, shapes);
      }
      const dependencyNames = new Set(
        declarationValues.filter(
          (value) =>
            typeKeywordMacroNames.has(value) ||
            protectedTagMacroNames.has(value),
        ),
      );
      for (const token of declaration) {
        for (const root of token.typeKeywordMacroRoots ?? []) {
          dependencyNames.add(root);
        }
      }
      for (let index = 0; index < declaration.length; index += 1) {
        if (
          !dependencyNames.has(declaration[index].value) ||
          declaration[index + 1]?.value !== "("
        ) {
          continue;
        }
        const close = matchingToken(declaration, index + 1, "(", ")");
        if (close < 0) continue;
        for (const token of declaration.slice(index + 2, close)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) {
            dependencyNames.add(token.value);
          }
        }
      }
      const dependencyQueue = [...dependencyNames];
      while (dependencyQueue.length > 0) {
        const dependencyName = dependencyQueue.shift();
        for (const shape of macroShapesByName.get(dependencyName) ?? []) {
          for (const reference of shape.references) {
            if (!dependencyNames.has(reference)) {
              dependencyNames.add(reference);
              dependencyQueue.push(reference);
            }
          }
        }
      }
      const relevantShapes = activePrecedingShapes.filter(
        ({ name }) => name !== null && dependencyNames.has(name),
      );
      if (
        !relevantShapes.some(
          ({ path: definitionPath }) => definitionPath !== window.path,
        )
      ) {
        continue;
      }
      const hasProtectedMaterial = [
        ...declaration,
        ...relevantShapes.flatMap(({ replacementTokens }) => replacementTokens),
      ].some(({ value }) =>
        [...protectedNames].some(
          (protectedName) =>
            value === protectedName ||
            (value.length >= 3 && protectedName.includes(value)),
        ),
      );
      if (!hasProtectedMaterial) continue;
      const conditionalIndexes = relevantShapes.flatMap((shape, shapeIndex) =>
        shape.record.conditional === true ? [shapeIndex] : [],
      );
      if (conditionalIndexes.length === 0) {
        const expanded = expandMacros(
          declaration,
          parseMacros(relevantShapes.map(({ record }) => record)),
        );
        for (const failure of expanded.macroFailures ?? []) {
          const subject =
            declarationValues.find((value) => macroNames.has(value)) ??
            window.path;
          const key = `ambiguous-preprocessor-macro\0${subject}\0${window.path}\0${failure.reason}`;
          if (!reported.has(key)) {
            reported.add(key);
            findings.push(
              finding(
                "ambiguous-preprocessor-macro",
                subject,
                `ordered cross-file macro expansion failed closed: ${failure.reason}`,
                declaration[0].sourceLine,
              ),
            );
          }
        }
        const protectedExpansion = completeProtectedType(expanded);
        if (protectedExpansion !== undefined) {
          const key = `opaque-redefinition\0${protectedExpansion}\0${window.path}\0${declaration[0].line}`;
          if (!reported.has(key)) {
            reported.add(key);
            findings.push(
              finding(
                "opaque-redefinition",
                protectedExpansion,
                `ordered include-site macro composition in ${path} completes protected representation ${protectedExpansion}`,
                declaration[0].sourceLine,
              ),
            );
          }
        }
        continue;
      }
      if (conditionalIndexes.length > 6) {
        const subject = declaration[0].value;
        const key = `ambiguous-preprocessor-macro\0${subject}`;
        if (!reported.has(key)) {
          reported.add(key);
          findings.push(
            finding(
              "ambiguous-preprocessor-macro",
              subject,
              `ordered macro state in ${path} has ${conditionalIndexes.length} relevant conditional events and cannot be proved representation-safe`,
              declaration[0].sourceLine,
            ),
          );
        }
        continue;
      }
      const conditionalBitByShape = new Map(
        conditionalIndexes.map((shapeIndex, bitIndex) => [
          shapeIndex,
          bitIndex,
        ]),
      );
      let protectedExpansion = null;
      for (let state = 0; state < 2 ** conditionalIndexes.length; state += 1) {
        let line = 1;
        const records = relevantShapes.flatMap((shape, shapeIndex) => {
          const bitIndex = conditionalBitByShape.get(shapeIndex);
          return bitIndex !== undefined && (state & (1 << bitIndex)) === 0
            ? []
            : [{ ...shape.record, line: line++ }];
        });
        const expanded = expandMacros(
          declaration.map((token) => ({ ...token, line: line + 1 })),
          parseMacros(records),
        );
        for (const failure of expanded.macroFailures ?? []) {
          const subject =
            declarationValues.find((value) => macroNames.has(value)) ??
            window.path;
          const key = `ambiguous-preprocessor-macro\0${subject}\0${window.path}\0${failure.reason}`;
          if (!reported.has(key)) {
            reported.add(key);
            findings.push(
              finding(
                "ambiguous-preprocessor-macro",
                subject,
                `ordered conditional macro expansion failed closed: ${failure.reason}`,
                declaration[0].sourceLine,
              ),
            );
          }
        }
        protectedExpansion =
          completeProtectedType(expanded) ?? protectedExpansion;
      }
      if (protectedExpansion === null) continue;
      const conditionalNames = new Set(
        conditionalIndexes.map((shapeIndex) => relevantShapes[shapeIndex].name),
      );
      for (const subject of conditionalNames) {
        const key = `ambiguous-preprocessor-macro\0${subject}`;
        if (reported.has(key)) continue;
        reported.add(key);
        findings.push(
          finding(
            "ambiguous-preprocessor-macro",
            subject,
            `ordered cross-file macro composition in ${path} can complete protected representation ${protectedExpansion}`,
            declaration[0].sourceLine,
          ),
        );
      }
    }
  }
  return findings;
}

export function auditBuildGraphSources(buildScriptSource, sources, oracle) {
  // Structural windows are policy-dependent and can be large.  Retain them
  // only within one complete graph audit so repeated control mutations do not
  // accumulate stale policy generations in a long-lived evaluator process.
  BUILD_STRUCTURAL_TYPE_TOKEN_CACHE.clear();
  const contract = oracle.buildGraph;
  const findings = [];
  if (sha256(Buffer.from(buildScriptSource)) !== contract.buildScript.sha256) {
    findings.push(
      finding(
        "build-script-drift",
        contract.buildScript.path,
        "the native source-selection build script differs from the reviewed bytes",
      ),
    );
  }
  const sourceManifest = sources.get(contract.sourceManifest.path);
  if (
    sourceManifest === undefined ||
    sha256(Buffer.from(sourceManifest)) !== contract.sourceManifest.sha256
  ) {
    findings.push(
      finding(
        "build-source-manifest-drift",
        contract.sourceManifest.path,
        "the vendored translation-unit manifest differs from the reviewed bytes",
      ),
    );
  }

  const literalTranslationUnits =
    literalBuildTranslationUnits(buildScriptSource);
  if (
    JSON.stringify(literalTranslationUnits) !==
    JSON.stringify([...contract.literalTranslationUnits].sort())
  ) {
    findings.push(
      finding(
        "build-translation-unit-drift",
        contract.buildScript.path,
        "literal C/C++ translation units differ from the reviewed build graph",
      ),
    );
  }

  const manifestTranslationUnits =
    sourceManifest === undefined
      ? null
      : manifestBuildTranslationUnits(sourceManifest);
  const manifestIdentity = manifestTranslationUnits
    ? {
        count: manifestTranslationUnits.length,
        sha256: sha256(Buffer.from(JSON.stringify(manifestTranslationUnits))),
      }
    : null;
  if (
    manifestIdentity === null ||
    JSON.stringify(manifestIdentity) !==
      JSON.stringify(contract.manifestTranslationUnits)
  ) {
    findings.push(
      finding(
        "build-translation-unit-drift",
        contract.sourceManifest.path,
        "manifest-selected C/C++ translation units differ from the reviewed build graph",
      ),
    );
  }

  const visited = new Set();
  const externalHeaders = new Set();
  const queued = [
    ...literalTranslationUnits,
    ...(manifestTranslationUnits ?? []),
  ];
  const rootFor = (path) =>
    contract.sourceRoots.find((root) => path.startsWith(root)) ?? null;
  while (queued.length > 0) {
    const path = queued.shift();
    const normalizedPath = posix.normalize(path);
    if (
      normalizedPath !== path ||
      !path.startsWith("oxrocksdb-sys/") ||
      path.split("/").includes("..")
    ) {
      findings.push(
        finding(
          "build-path-escape",
          path,
          "a selected native source path escapes its reviewed logical root",
        ),
      );
      continue;
    }
    if (visited.has(path)) continue;
    visited.add(path);
    const observedRealPath = sources.realPaths?.get(path);
    if (
      observedRealPath !== undefined &&
      (sources.canonicalRoot !== undefined
        ? observedRealPath.replaceAll("\\", "/") !==
          posix.join(sources.canonicalRoot, path)
        : !observedRealPath.replaceAll("\\", "/").endsWith(`/${path}`))
    ) {
      findings.push(
        finding(
          "build-path-escape",
          path,
          "a selected native source resolves outside its reviewed logical path",
        ),
      );
      continue;
    }
    const source = sources.get(path);
    if (source === undefined) {
      findings.push(
        finding(
          "build-source-unresolved",
          path,
          "a selected native source file could not be resolved",
        ),
      );
      continue;
    }
    findings.push(...auditSelectedBuildSource(path, source, oracle));
    for (const record of buildIncludes(source)) {
      const include = parseInclude(record);
      if (record.keyword !== "include" || include === null) {
        findings.push(
          finding(
            "build-include-unresolved",
            include === null ? record.expression.trim() : path,
            "an active include is not a literal reviewed header path",
            record.line,
          ),
        );
        continue;
      }
      const currentRoot = rootFor(path);
      const relativeCandidate = posix.normalize(
        posix.join(posix.dirname(path), include.path),
      );
      const candidates = [
        relativeCandidate,
        posix.join("oxrocksdb-sys/rocksdb", include.path),
        posix.join("oxrocksdb-sys/rocksdb/include", include.path),
        posix.join("oxrocksdb-sys/lz4/lib", include.path),
        posix.join("oxrocksdb-sys/api", include.path),
      ].filter(
        (candidate, index, entries) => entries.indexOf(candidate) === index,
      );
      const resolved = candidates.find((candidate) => sources.has(candidate));
      if (resolved === undefined) {
        externalHeaders.add(include.path);
        continue;
      }
      const resolvedRoot = rootFor(resolved);
      if (
        include.path.split("/").includes("..") &&
        (currentRoot === null || resolvedRoot !== currentRoot)
      ) {
        findings.push(
          finding(
            "build-include-traversal",
            include.path,
            `active include from ${path} crosses its reviewed source root`,
            record.line,
          ),
        );
        continue;
      }
      queued.push(resolved);
    }
  }
  findings.push(
    ...orderedCrossFileConditionalMacroFindings(
      [
        ...new Set([
          ...literalTranslationUnits,
          ...(manifestTranslationUnits ?? []),
        ]),
      ],
      [...visited],
      sources,
      oracle,
    ),
  );
  const closure = [...visited].sort();
  const closureIdentity = {
    count: closure.length,
    sha256: sha256(Buffer.from(JSON.stringify(closure))),
  };
  if (JSON.stringify(closureIdentity) !== JSON.stringify(contract.closure)) {
    findings.push(
      finding(
        "build-graph-drift",
        "native-source-closure",
        `the build-included translation-unit/header closure drifted (observed ${closureIdentity.count}:${closureIdentity.sha256})`,
      ),
    );
  }
  const externalHeaderList = [...externalHeaders].sort();
  const externalHeaderIdentity = {
    count: externalHeaderList.length,
    sha256: sha256(Buffer.from(JSON.stringify(externalHeaderList))),
  };
  if (
    JSON.stringify(externalHeaderIdentity) !==
    JSON.stringify(contract.externalHeaders)
  ) {
    findings.push(
      finding(
        "build-external-header-drift",
        "native-external-headers",
        `the build-included external header inventory drifted (observed ${externalHeaderIdentity.count}:${externalHeaderIdentity.sha256})`,
      ),
    );
    findings.push(
      finding(
        "build-include-unresolved",
        "native-external-headers",
        "an include is absent from the exact reviewed internal or external header inventory",
      ),
    );
  }
  return findings;
}

async function loadNativeSourceTree(repositoryRoot, directory, sources) {
  const absolute = join(repositoryRoot, directory);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      await loadNativeSourceTree(repositoryRoot, path, sources);
    } else if (
      entry.isFile() &&
      /\.(?:c|cc|cpp|cxx|h|hh|hpp|inc)$/u.test(entry.name)
    ) {
      sources.set(path, await readFile(join(repositoryRoot, path), "utf8"));
      sources.realPaths.set(path, await realpath(join(repositoryRoot, path)));
    }
  }
}

export async function loadBuildGraphSources(repositoryRoot, oracle) {
  const sources = new Map();
  Object.defineProperty(sources, "realPaths", { value: new Map() });
  Object.defineProperty(sources, "canonicalRoot", {
    value: (await realpath(repositoryRoot)).replaceAll("\\", "/"),
  });
  for (const directory of [
    "oxrocksdb-sys/api",
    "oxrocksdb-sys/lz4/lib",
    "oxrocksdb-sys/rocksdb",
  ]) {
    await loadNativeSourceTree(repositoryRoot, directory, sources);
  }
  sources.set(
    oracle.buildGraph.sourceManifest.path,
    await readFile(join(repositoryRoot, oracle.buildGraph.sourceManifest.path)),
  );
  sources.realPaths.set(
    oracle.buildGraph.sourceManifest.path,
    await realpath(join(repositoryRoot, oracle.buildGraph.sourceManifest.path)),
  );
  return sources;
}

async function auditBuildGraph(repositoryRoot, oracle) {
  const buildScriptSource = await readFile(
    join(repositoryRoot, oracle.buildGraph.buildScript.path),
    "utf8",
  );
  let sources;
  try {
    sources = await loadBuildGraphSources(repositoryRoot, oracle);
  } catch (error) {
    return [
      finding(
        "build-graph-unavailable",
        "oxrocksdb-sys",
        `the exact native build graph could not be enumerated: ${error.message}`,
      ),
    ];
  }
  return auditBuildGraphSources(buildScriptSource, sources, oracle);
}

function dropTraitIsShadowed(tokens) {
  const values = tokenValues(tokens);
  for (let index = 0; index < values.length; index += 1) {
    if (
      ["trait", "struct", "enum", "union", "type", "mod"].includes(
        values[index],
      ) &&
      values[index + 1] === "Drop"
    )
      return true;
    if (values[index] === "as" && values[index + 1] === "Drop") return true;
    if (values[index] === "use") {
      const end = values.indexOf(";", index + 1);
      if (end > index && values.slice(index + 1, end).includes("Drop")) {
        const imported = values.slice(index + 1, end).join(" ");
        if (!["std :: ops :: Drop", "core :: ops :: Drop"].includes(imported))
          return true;
      }
    }
  }
  return false;
}

function rustNamespaceIsShadowed(tokens, name) {
  const values = tokenValues(tokens);
  for (let index = 0; index < values.length; index += 1) {
    if (
      values[index] === name &&
      ([
        "const",
        "enum",
        "fn",
        "let",
        "mod",
        "static",
        "struct",
        "trait",
        "type",
        "union",
      ].includes(values[index - 1]) ||
        values[index - 1] === "as")
    ) {
      return true;
    }
    if (values[index] !== "use") continue;
    const end = values.indexOf(";", index + 1);
    if (end < 0) continue;
    const imported = values.slice(index + 1, end);
    if (
      imported.includes(name) &&
      imported[0] !== name &&
      !(imported[0] === "::" && imported[1] === name)
    ) {
      return true;
    }
    index = end;
  }
  return false;
}

function rustDropShadowState(tokens) {
  return {
    drop: dropTraitIsShadowed(tokens),
    std: rustNamespaceIsShadowed(tokens, "std"),
    core: rustNamespaceIsShadowed(tokens, "core"),
  };
}

function isLanguageDropTrait(values, shadowState) {
  const rooted = values[0] === "::";
  const normalized = rooted ? values.slice(1) : values;
  if (normalized.length === 1 && normalized[0] === "Drop") {
    return !shadowState.drop;
  }
  if (
    !["std", "core"].includes(normalized[0]) ||
    normalized.slice(1).join(" ") !== ":: ops :: Drop"
  ) {
    return false;
  }
  return rooted || !shadowState[normalized[0]];
}

function findImplDropBody(tokens, typeName, shadowState) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "impl") continue;
    let cursor = index + 1;
    if (tokens[cursor]?.value === "<") {
      const close = matchingToken(tokens, cursor, "<", ">");
      if (close < 0) continue;
      cursor = close + 1;
    }
    const traitStart = cursor;
    while (cursor < tokens.length && tokens[cursor].value !== "{") {
      cursor += 1;
    }
    if (tokens[cursor]?.value !== "{") continue;
    const forIndex = tokens.findIndex(
      ({ value }, candidate) =>
        candidate >= traitStart && candidate < cursor && value === "for",
    );
    if (
      forIndex < 0 ||
      !isLanguageDropTrait(
        tokenValues(tokens.slice(traitStart, forIndex)),
        shadowState,
      ) ||
      tokens[forIndex + 1]?.value !== typeName
    ) {
      continue;
    }
    const close = matchingToken(tokens, cursor, "{", "}");
    if (close < 0) continue;
    const implBody = tokens.slice(cursor + 1, close);
    let depth = 0;
    const depthAt = implBody.map(({ value }) => {
      const current = depth;
      if (value === "{") depth += 1;
      if (value === "}") depth -= 1;
      return current;
    });
    const definitions = findFunctionDefinitions(implBody, "drop").filter(
      ({ nameIndex, parametersOpen, parametersClose }) =>
        depthAt[nameIndex] === 0 &&
        tokenValues(implBody.slice(parametersOpen + 1, parametersClose)).join(
          " ",
        ) === "& mut self",
    );
    if (definitions.length === 1) return definitions[0].body;
  }
  return null;
}

function orderedIdentifiers(tokens, identifiers) {
  let cursor = -1;
  for (const identifier of identifiers) {
    cursor = tokens.findIndex(
      (token, index) => index > cursor && token.value === identifier,
    );
    if (cursor < 0) return false;
  }
  return true;
}

function safeDestructorArguments(tokens) {
  if (tokens.length === 0) return false;
  return splitTopLevelTokenRanges(tokens).every((argument) => {
    const values = tokenValues(argument);
    if (values[0] !== "self" || values[1] !== ".") return false;
    let cursor = 2;
    if (!/^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/u.test(values[cursor] ?? ""))
      return false;
    cursor += 1;
    while (cursor < values.length) {
      if (
        values[cursor] !== "." ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(values[cursor + 1] ?? "")
      )
        return false;
      cursor += 2;
      if (values[cursor] === "(") {
        if (
          values[cursor - 1] !== "as_ptr" ||
          values[cursor + 1] !== ")" ||
          cursor + 2 !== values.length
        )
          return false;
        cursor += 2;
      }
    }
    return cursor === values.length;
  });
}

function exactTerminalDestructionPath(tokens, identifiers) {
  if (
    !orderedIdentifiers(tokens, identifiers) ||
    !identifiers.every(
      (identifier) => identifierOccurrences(tokens, identifier).length === 1,
    )
  ) {
    return false;
  }
  let depth = 0;
  const depthAt = tokens.map(({ value }) => {
    const current = depth;
    if (value === "{") depth += 1;
    if (value === "}") depth -= 1;
    return current;
  });
  const unsafeIndex = tokens.findIndex(
    ({ value }, index) =>
      value === "unsafe" &&
      depthAt[index] === 0 &&
      tokens[index + 1]?.value === "{",
  );
  if (unsafeIndex !== 0) return false;
  const closeUnsafe = matchingToken(tokens, unsafeIndex + 1, "{", "}");
  if (closeUnsafe !== tokens.length - 1) return false;
  const terminal = tokens.slice(unsafeIndex + 2, closeUnsafe);
  let cursor = 0;
  for (const identifier of identifiers) {
    if (
      terminal[cursor]?.value !== identifier ||
      terminal[cursor + 1]?.value !== "("
    )
      return false;
    const closeCall = matchingToken(terminal, cursor + 1, "(", ")");
    if (
      closeCall < 0 ||
      !safeDestructorArguments(terminal.slice(cursor + 2, closeCall))
    )
      return false;
    cursor = closeCall + 1;
    if (terminal[cursor]?.value === ";") cursor += 1;
  }
  return cursor === terminal.length;
}

export function auditLifecycle(rustSource) {
  const tokens = tokenizeCode(rustSource, { language: "rust" });
  const findings = [];
  const structs = new Map(
    findCompleteTypeDefinitions(tokens).map((definition) => [
      definition.name,
      definition,
    ]),
  );
  const iterBody = structs.get("Iter")?.body ?? [];
  for (const field of ["_upper_bound", "_reader", "options"]) {
    if (!tokenValues(iterBody).includes(field)) {
      findings.push(
        finding(
          "iterator-owner-missing",
          field,
          "Iter must retain its bound, reader, and read-options owners",
        ),
      );
    }
  }

  const dropContracts = [
    ["Reader", ["rocksdb_readoptions_destroy"]],
    ["SnapshotReader", ["rocksdb_release_snapshot"]],
    ["Iter", ["rocksdb_iter_destroy", "rocksdb_readoptions_destroy"]],
    [
      "ReadableTransaction",
      [
        "rocksdb_writebatch_wi_destroy",
        "rocksdb_readoptions_destroy",
        "rocksdb_release_snapshot",
      ],
    ],
    ["PinnableSlice", ["rocksdb_pinnable_handle_destroy"]],
  ];
  const destructorArities = new Map([
    ["rocksdb_iter_destroy", 1],
    ["rocksdb_pinnable_handle_destroy", 1],
    ["rocksdb_readoptions_destroy", 1],
    ["rocksdb_release_snapshot", 2],
    ["rocksdb_writebatch_wi_destroy", 1],
  ]);
  const externallyBound = new Map(
    [...new Set(dropContracts.flatMap(([, identifiers]) => identifiers))].map(
      (identifier) => {
        const calls = liveCallExpressions(
          tokens,
          identifier,
          destructorArities.get(identifier),
        );
        return [
          identifier,
          calls.length > 0 &&
            isUnshadowedExternalCall(
              tokens,
              identifier,
              calls.map(({ index }) => index),
              EXPECTED_RUST_FFI_RESULT_CONTRACT,
            ),
        ];
      },
    ),
  );
  const dropShadowState = rustDropShadowState(tokens);
  for (const [typeName, identifiers] of dropContracts) {
    const body = findImplDropBody(tokens, typeName, dropShadowState);
    if (!body || !exactTerminalDestructionPath(body, identifiers)) {
      findings.push(
        finding(
          "lifecycle-drop-order",
          typeName,
          `required exact-once destruction order is ${identifiers.join(" -> ")}`,
        ),
      );
    }
    if (identifiers.some((identifier) => !externallyBound.get(identifier))) {
      findings.push(
        finding(
          "lifecycle-external-binding",
          typeName,
          `destructors must resolve through the absolute external oxrocksdb_sys import: ${identifiers.join(", ")}`,
        ),
      );
    }
  }
  return findings;
}

export function auditShimDisposition(
  apiSource,
  headerSource,
  rustSource,
  oracle,
) {
  const sources = [
    ["api/c.cc", tokenizeCode(apiSource)],
    ["api/c.h", tokenizeCode(headerSource)],
    ["rocksdb_wrapper.rs", tokenizeCode(rustSource, { language: "rust" })],
  ];
  const rustTokens = sources[2][1];
  const findings = [...rustCfgFailureFindings(rustTokens)];
  const requiredPublicSymbols = new Set();

  for (const shim of oracle.shimDisposition) {
    const locations = sources
      .filter(
        ([, tokens]) =>
          identifierOccurrences(tokens, shim.customSymbol).length > 0,
      )
      .map(([name]) => name);
    if (locations.length > 0) {
      findings.push(
        finding(
          "replaceable-custom-shim",
          shim.customSymbol,
          `replace with the frozen public-C disposition; still present in ${locations.join(", ")}`,
        ),
      );
    }
    for (const symbol of shim.publicSymbols) requiredPublicSymbols.add(symbol);
  }

  for (const symbol of requiredPublicSymbols) {
    const expected = expectedPublicDeclarationSignature(
      EXPECTED_PUBLIC_C_DECLARATIONS.get(symbol) ?? "",
      symbol,
    );
    if (
      expected === null ||
      reachableExternalCalls(rustTokens, symbol, signatureArity(expected), {
        ffiResultContract: oracle.rustFfiResult,
        requireFfiResult: hasTrailingErrorOut(expected),
      }).length === 0
    ) {
      findings.push(
        finding(
          "public-replacement-not-wired",
          symbol,
          "the product call site does not use the frozen public C replacement",
        ),
      );
    }
  }
  return findings;
}

export function auditRequiredExtension(
  apiSource,
  headerSource,
  rustSource,
  upstreamSource,
  oracle,
) {
  const extension = oracle.requiredExtension;
  const apiTokens = tokenizeCode(apiSource);
  const headerTokens = tokenizeCode(headerSource);
  const rustTokens = tokenizeCode(rustSource, { language: "rust" });
  const upstreamTokens = tokenizeCode(upstreamSource);
  const findings = [...rustCfgFailureFindings(rustTokens)];
  const apiDefinitions = findFunctionDefinitions(apiTokens, extension.symbol);
  const upstreamDefinitions = findFunctionDefinitions(
    upstreamTokens,
    extension.symbol,
  );
  const observedOwnerDefinition =
    upstreamDefinitions.length === 1
      ? extractAtomicOwnerDefinition(upstreamSource, extension.symbol)
      : null;
  const reviewedOwnerDefinition = extractAtomicOwnerDefinition(
    extension.candidateOverlay.utf8,
    extension.symbol,
  );

  if (apiDefinitions.length > 0) {
    findings.push(
      finding(
        "required-extension-wrong-owner",
        extension.symbol,
        `definition must move from ${extension.forbiddenTranslationUnit} to ${extension.ownerTranslationUnit}`,
        apiDefinitions[0].line,
      ),
    );
  }
  if (upstreamDefinitions.length !== 1) {
    findings.push(
      finding(
        "required-extension-owner-count",
        extension.symbol,
        `expected exactly one owner definition, observed ${upstreamDefinitions.length}`,
      ),
    );
  } else if (observedOwnerDefinition === null) {
    findings.push(
      finding(
        "required-extension-signature",
        extension.symbol,
        "owner definition must have the exact extern C void signature and parameter types",
        upstreamDefinitions[0].line,
      ),
    );
  }
  if (
    observedOwnerDefinition !== null &&
    (reviewedOwnerDefinition === null ||
      sha256(
        Buffer.from(
          JSON.stringify(
            tokenValues(tokenizeCode(observedOwnerDefinition.source)),
          ),
        ),
      ) !==
        sha256(
          Buffer.from(
            JSON.stringify(
              tokenValues(tokenizeCode(reviewedOwnerDefinition.source)),
            ),
          ),
        ))
  ) {
    findings.push(
      finding(
        "multi-cf-ingest-not-general-list-len",
        extension.symbol,
        "the owner body must match the reviewed arbitrary-list structural token contract without count-dependent or additional behavior",
        upstreamDefinitions[0].line,
      ),
    );
  }
  const expectedHeaderSignature = expectedDeclarationSignature(
    EXPECTED_EXTENSION_HEADER,
    extension.symbol,
  );
  const observedHeaderSignature = declarationSignature(
    headerTokens,
    extension.symbol,
  );
  if (identifierOccurrences(headerTokens, extension.symbol).length !== 1) {
    findings.push(
      finding(
        "required-extension-header-count",
        extension.symbol,
        "the public fork header must declare the extension exactly once",
      ),
    );
  } else if (
    JSON.stringify(observedHeaderSignature) !==
    JSON.stringify(expectedHeaderSignature)
  ) {
    findings.push(
      finding(
        "required-extension-header-signature",
        extension.symbol,
        "the public fork header must expose the exact reviewed C signature",
      ),
    );
  }
  if (
    reachableExternalCalls(rustTokens, extension.symbol, 4, {
      ffiResultContract: oracle.rustFfiResult,
      requireFfiResult: true,
    }).length !== 1
  ) {
    findings.push(
      finding(
        "required-extension-rust-count",
        extension.symbol,
        "the Rust product must call the atomic extension exactly once",
      ),
    );
  }

  if (upstreamDefinitions.length === 1) {
    const body = upstreamDefinitions[0].body;
    const values = tokenValues(body);
    const atomicIndexes = values
      .map((value, index) => (value === extension.atomicCppCall ? index : -1))
      .filter((index) => index >= 0);
    let braceDepth = 0;
    const depthAt = values.map((value) => {
      const depth = braceDepth;
      if (value === "{") braceDepth += 1;
      if (value === "}") braceDepth -= 1;
      return depth;
    });
    const atomicIndex = atomicIndexes[0] ?? -1;
    let statementStart = atomicIndex;
    while (
      statementStart > 0 &&
      ![";", "}"].includes(values[statementStart - 1])
    ) {
      statementStart -= 1;
    }
    let statementEnd = atomicIndex;
    while (statementEnd < values.length && values[statementEnd] !== ";") {
      statementEnd += 1;
    }
    const atomicStatement = values.slice(statementStart, statementEnd + 1);
    const isLiveStatusCall =
      atomicIndexes.length === 1 &&
      depthAt[atomicIndex] === 0 &&
      atomicStatement[0] === "SaveError" &&
      containsSequence(atomicStatement, [
        "SaveError",
        "(",
        "errptr",
        ",",
        "db",
        "->",
        "rep",
        "->",
        extension.atomicCppCall,
        "(",
        "args",
        ")",
      ]);
    if (identifierOccurrences(body, "SaveError").length !== 1) {
      findings.push(
        finding(
          "multi-cf-ingest-status-wrapper",
          extension.symbol,
          "the owner extension must report exactly one status through SaveError",
          upstreamDefinitions[0].line,
        ),
      );
    }
    if (!isLiveStatusCall) {
      findings.push(
        finding(
          "multi-cf-ingest-not-single-atomic-call",
          extension.symbol,
          `expected one unconditional top-level SaveError(errptr, DB::${extension.atomicCppCall}(args)) call`,
          upstreamDefinitions[0].line,
        ),
      );
    }
    if (
      values.some(
        (value, index) =>
          index < atomicIndex &&
          ["return", "break", "continue", "goto", "throw"].includes(value),
      ) ||
      sequenceIndex(values, ["switch", "(", "list_len", ")"]) >= 0
    ) {
      findings.push(
        finding(
          "multi-cf-ingest-not-general-list-len",
          extension.symbol,
          "the owner extension must assemble and execute for every list_len without a count-specific early exit",
          upstreamDefinitions[0].line,
        ),
      );
    }

    const outerLoop = findLoopBlock(
      body,
      depthAt,
      0,
      ["i", "<", "list_len"],
      0,
      atomicIndex < 0 ? values.length : atomicIndex,
    );
    const generalConstructionIndexes = values
      .map((value, index) =>
        value === "args" &&
        values[index + 1] === "(" &&
        values[index + 2] === "list_len" &&
        values[index + 3] === ")" &&
        depthAt[index] === 0
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    if (
      generalConstructionIndexes.length !== 1 ||
      JSON.stringify(outerLoop?.parameters) !==
        JSON.stringify([
          "size_t",
          "i",
          "=",
          "0",
          ";",
          "i",
          "<",
          "list_len",
          ";",
          "+",
          "+",
          "i",
        ])
    ) {
      findings.push(
        finding(
          "multi-cf-ingest-not-general-list-len",
          extension.symbol,
          "argument storage and iteration must be constructed directly from arbitrary list_len",
          upstreamDefinitions[0].line,
        ),
      );
    }
    const assembly = [
      [
        "arguments",
        ["args", "(", "list_len", ")"],
        0,
        outerLoop?.start ?? (atomicIndex < 0 ? values.length : atomicIndex),
        0,
      ],
      [
        "column_family",
        [
          "args",
          "[",
          "i",
          "]",
          ".",
          "column_family",
          "=",
          "list",
          "[",
          "i",
          "]",
          ".",
          "column_family",
          "->",
          "rep",
        ],
        (outerLoop?.openBody ?? -1) + 1,
        outerLoop?.closeBody ?? -1,
        1,
      ],
      [
        "options",
        [
          "args",
          "[",
          "i",
          "]",
          ".",
          "options",
          "=",
          "list",
          "[",
          "i",
          "]",
          ".",
          "options",
          "->",
          "rep",
        ],
        (outerLoop?.openBody ?? -1) + 1,
        outerLoop?.closeBody ?? -1,
        1,
      ],
    ];
    for (const [subject, sequence, start, end, expectedDepth] of assembly) {
      const index =
        start >= 0 && end >= start
          ? sequenceIndex(values, sequence, start, end)
          : -1;
      if (index < 0 || depthAt[index] !== expectedDepth) {
        findings.push(
          finding(
            "multi-cf-ingest-argument-lifetime",
            subject,
            "owner extension does not assemble this exact owned argument component",
            upstreamDefinitions[0].line,
          ),
        );
      }
    }
    const assignedPaths = [
      "external_files",
      ".",
      "assign",
      "(",
      "list",
      "[",
      "i",
      "]",
      ".",
      "external_files",
    ];
    const assignedPathsIndex = outerLoop
      ? sequenceIndex(
          values,
          assignedPaths,
          outerLoop.openBody + 1,
          outerLoop.closeBody,
        )
      : -1;
    const innerLoop = outerLoop
      ? findLoopBlock(
          body,
          depthAt,
          1,
          ["j", "<", "list", "[", "i", "]", ".", "external_files_len"],
          outerLoop.openBody + 1,
          outerLoop.closeBody,
        )
      : null;
    const copiedPathIndex = innerLoop
      ? (["emplace_back", "push_back"]
          .map((method) =>
            sequenceIndex(
              values,
              [
                "args",
                "[",
                "i",
                "]",
                ".",
                "external_files",
                ".",
                method,
                "(",
                "list",
                "[",
                "i",
                "]",
                ".",
                "external_files",
                "[",
                "j",
                "]",
              ],
              innerLoop.openBody + 1,
              innerLoop.closeBody,
            ),
          )
          .find((index) => index >= 0) ?? -1)
      : -1;
    const copiesPaths =
      (assignedPathsIndex >= 0 && depthAt[assignedPathsIndex] === 1) ||
      (copiedPathIndex >= 0 && depthAt[copiedPathIndex] === 2);
    if (!copiesPaths) {
      findings.push(
        finding(
          "multi-cf-ingest-argument-lifetime",
          "external_files",
          "every input path must be copied into the owner argument before the atomic call",
          upstreamDefinitions[0].line,
        ),
      );
    }
    if (values.includes("IngestExternalFile")) {
      findings.push(
        finding(
          "multi-cf-ingest-degraded-to-per-cf",
          extension.symbol,
          "per-column-family ingestion cannot replace one atomic multi-CF call",
          upstreamDefinitions[0].line,
        ),
      );
    }
  }
  return findings;
}

const ATOMIC_OWNER_HARNESS_PREFIX = String.raw`
#include <cstddef>
#include <string>
#include <type_traits>
#include <vector>

using std::size_t;
using std::string;
using std::vector;

namespace rocksdb {
struct ColumnFamilyHandle { int id; };
struct IngestExternalFileOptions { int id = 0; };
struct IngestExternalFileArg {
  ColumnFamilyHandle* column_family = nullptr;
  vector<string> external_files;
  IngestExternalFileOptions options{};
};
struct DB {
  int calls = 0;
  int status = 0;
  vector<IngestExternalFileArg> observed;
  int IngestExternalFiles(const vector<IngestExternalFileArg>& args) {
    ++calls;
    observed = args;
    return status;
  }
};
}  // namespace rocksdb

using rocksdb::ColumnFamilyHandle;
using rocksdb::IngestExternalFileArg;
using rocksdb::IngestExternalFileOptions;

struct rocksdb_t { rocksdb::DB* rep; };
struct rocksdb_column_family_handle_t { ColumnFamilyHandle* rep; };
struct rocksdb_ingestexternalfileoptions_t {
  IngestExternalFileOptions rep;
};
struct rocksdb_ingestexternalfilearg_t {
  rocksdb_column_family_handle_t* column_family;
  const char* const* external_files;
  size_t external_files_len;
  rocksdb_ingestexternalfileoptions_t* options;
};

static void SaveError(char** errptr, int status) {
  if (status != 0) *errptr = const_cast<char*>("frozen-error");
}
`;

const ATOMIC_OWNER_HARNESS_SUFFIX = String.raw`
static_assert(std::is_same_v<
    decltype(&oxrocksdb_ingest_external_files),
    void (*)(rocksdb_t*, const rocksdb_ingestexternalfilearg_t*,
             size_t, char**)>);

static int run_success_case(size_t count) {
  rocksdb::DB implementation;
  rocksdb_t db{&implementation};
  ColumnFamilyHandle columns[] = {{17}, {19}, {23}, {29}, {31}};
  rocksdb_column_family_handle_t handles[] = {
      {&columns[0]}, {&columns[1]}, {&columns[2]}, {&columns[3]},
      {&columns[4]}};
  rocksdb_ingestexternalfileoptions_t options[] = {
      {{31}}, {{37}}, {{41}}, {{43}}, {{47}}};
  char first[] = "alpha.sst";
  char second[] = "beta.sst";
  char third[] = "gamma.sst";
  char fourth[] = "delta.sst";
  char fifth[] = "epsilon.sst";
  const char* paths_a[] = {first};
  const char* paths_b[] = {second};
  const char* paths_c[] = {third};
  const char* paths_d[] = {fourth};
  const char* paths_e[] = {fifth};
  rocksdb_ingestexternalfilearg_t input[] = {
      {&handles[0], paths_a, 1, &options[0]},
      {&handles[1], paths_b, 1, &options[1]},
      {&handles[2], paths_c, 1, &options[2]},
      {&handles[3], paths_d, 1, &options[3]},
      {&handles[4], paths_e, 1, &options[4]},
  };
  char* error = nullptr;
  oxrocksdb_ingest_external_files(&db, input, count, &error);
  first[0] = 'X';
  second[0] = 'Y';
  third[0] = 'Y';
  fourth[0] = 'Q';
  fifth[0] = 'R';
  const char* expected_paths[] = {
      "alpha.sst", "beta.sst", "gamma.sst", "delta.sst", "epsilon.sst"};
  const int expected_options[] = {31, 37, 41, 43, 47};
  if (implementation.calls != 1 || error != nullptr ||
      implementation.observed.size() != count) return 10;
  for (size_t i = 0; i < count; ++i) {
    if (implementation.observed[i].column_family != &columns[i] ||
        implementation.observed[i].external_files.size() != 1 ||
        implementation.observed[i].external_files[0] != expected_paths[i] ||
        implementation.observed[i].options.id != expected_options[i]) return 11;
  }
  return 0;
}

int main() {
  const size_t counts[] = {0, 1, 2, 4, 5};
  for (size_t count : counts) {
    if (const int status = run_success_case(count); status != 0) return status;
  }

  rocksdb::DB implementation;
  implementation.status = 5;
  rocksdb_t db{&implementation};
  ColumnFamilyHandle columns[] = {{17}, {19}, {23}};
  rocksdb_column_family_handle_t handles[] = {
      {&columns[0]}, {&columns[1]}, {&columns[2]}};
  rocksdb_ingestexternalfileoptions_t options[] = {{{31}}, {{37}}, {{41}}};
  char first[] = "alpha.sst";
  const char* paths[] = {first};
  rocksdb_ingestexternalfilearg_t input[] = {
      {&handles[0], paths, 1, &options[0]},
      {&handles[1], paths, 1, &options[1]},
      {&handles[2], paths, 1, &options[2]},
  };
  char* error = nullptr;
  oxrocksdb_ingest_external_files(&db, input, 3, &error);
  if (implementation.calls != 1 || error == nullptr) return 12;
  return 0;
}
`;

export async function compileAndRunAtomicOwnerSource(
  ownerSource,
  {
    compiler = "c++",
    sanitizerFlag = null,
    symbolInspector = "nm",
    timeouts = {},
  } = {},
) {
  const definition = extractAtomicOwnerDefinition(
    ownerSource,
    "oxrocksdb_ingest_external_files",
  );
  if (definition === null) {
    return {
      available: true,
      phase: "extract",
      status: 1,
      stderr: "exact extern C owner definition not found",
    };
  }
  const linkedDefinition =
    definition.linkage === "direct"
      ? definition.source
      : `extern "C" {\n${definition.source}\n}`;
  const result = await compileAndRunAtomicExtensionFixture(
    `${ATOMIC_OWNER_HARNESS_PREFIX}\n${linkedDefinition}\n${ATOMIC_OWNER_HARNESS_SUFFIX}`,
    { compiler, sanitizerFlag, symbolInspector, timeouts },
  );
  return { ...result, definitionSha256: definition.sha256 };
}

const NATIVE_SUBPROCESS_TIMEOUTS = Object.freeze({
  compile: 30_000,
  symbols: 5_000,
  execute: 5_000,
});

function boundedNativeTimeout(timeouts, phase) {
  const limit = NATIVE_SUBPROCESS_TIMEOUTS[phase];
  const requested = timeouts?.[phase];
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, limit)
    : limit;
}

function classifiedSubprocessError(result, { executable, phase, timeoutMs }) {
  const errorCode = result.error?.code;
  if (errorCode === undefined) return null;
  if (errorCode === "ENOENT") {
    return {
      available: false,
      phase,
      reason: `${executable} is unavailable`,
    };
  }
  const timedOut = errorCode === "ETIMEDOUT";
  return {
    available: true,
    phase,
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: timedOut
      ? `${phase} timed out after ${timeoutMs}ms`
      : `${phase} failed with ${errorCode ?? "SUBPROCESS_ERROR"}`,
    errorCode: errorCode ?? "SUBPROCESS_ERROR",
    timedOut,
  };
}

export async function compileAndRunAtomicExtensionFixture(
  source,
  {
    compiler = "c++",
    sanitizerFlag = null,
    symbolInspector = "nm",
    timeouts = {},
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-opaque-c-fixture-"));
  const sourcePath = join(root, "owner.cc");
  const executablePath = join(root, "owner");
  try {
    await writeFile(sourcePath, source, { encoding: "utf8", mode: 0o600 });
    const flags = ["-std=c++17", "-fno-omit-frame-pointer"];
    if (sanitizerFlag) flags.push(sanitizerFlag);
    const compileTimeout = boundedNativeTimeout(timeouts, "compile");
    const compilation = spawnSync(
      compiler,
      [...flags, sourcePath, "-o", executablePath],
      { encoding: "utf8", shell: false, timeout: compileTimeout },
    );
    const compileError = classifiedSubprocessError(compilation, {
      executable: compiler,
      phase: "compile",
      timeoutMs: compileTimeout,
    });
    if (compileError !== null) return compileError;
    if (compilation.status !== 0) {
      return {
        available: true,
        phase: "compile",
        status: compilation.status,
        stdout: compilation.stdout,
        stderr: compilation.stderr,
      };
    }
    const symbolsTimeout = boundedNativeTimeout(timeouts, "symbols");
    const symbols = spawnSync(
      symbolInspector,
      ["-g", "--defined-only", executablePath],
      {
        encoding: "utf8",
        shell: false,
        timeout: symbolsTimeout,
      },
    );
    const symbolsError = classifiedSubprocessError(symbols, {
      executable: symbolInspector,
      phase: "symbols",
      timeoutMs: symbolsTimeout,
    });
    if (symbolsError !== null) return symbolsError;
    const hasExactCLinkage = symbols.stdout
      .split(/\r?\n/u)
      .some((line) => /\bT oxrocksdb_ingest_external_files$/u.test(line));
    if (symbols.status !== 0 || !hasExactCLinkage) {
      return {
        available: true,
        phase: "symbols",
        status: symbols.status,
        stdout: symbols.stdout,
        stderr: symbols.stderr,
      };
    }
    const environment = { ...process.env };
    if (sanitizerFlag === "-fsanitize=address") {
      environment.ASAN_OPTIONS = "detect_leaks=1:halt_on_error=1";
    }
    if (sanitizerFlag === "-fsanitize=undefined") {
      environment.UBSAN_OPTIONS = "halt_on_error=1:print_stacktrace=1";
    }
    const executionTimeout = boundedNativeTimeout(timeouts, "execute");
    const execution = spawnSync(executablePath, [], {
      encoding: "utf8",
      env: environment,
      shell: false,
      timeout: executionTimeout,
    });
    const executionError = classifiedSubprocessError(execution, {
      executable: executablePath,
      phase: "execute",
      timeoutMs: executionTimeout,
    });
    if (executionError !== null) {
      return { ...executionError, hasExactCLinkage };
    }
    return {
      available: true,
      phase: "execute",
      status: execution.status,
      signal: execution.signal,
      stdout: execution.stdout,
      stderr: execution.stderr,
      hasExactCLinkage,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function compileAndRunLifecycleFixture(
  source,
  { compiler = "rustc", timeouts = {} } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-opaque-rust-fixture-"));
  const sourcePath = join(root, "lifecycle.rs");
  const executablePath = join(root, "lifecycle");
  try {
    await writeFile(sourcePath, source, { encoding: "utf8", mode: 0o600 });
    const compileTimeout = boundedNativeTimeout(timeouts, "compile");
    const compilation = spawnSync(
      compiler,
      ["--edition=2024", sourcePath, "-o", executablePath],
      { encoding: "utf8", shell: false, timeout: compileTimeout },
    );
    const compileError = classifiedSubprocessError(compilation, {
      executable: compiler,
      phase: "compile",
      timeoutMs: compileTimeout,
    });
    if (compileError !== null) return compileError;
    if (compilation.status !== 0) {
      return {
        available: true,
        phase: "compile",
        status: compilation.status,
        stdout: compilation.stdout,
        stderr: compilation.stderr,
      };
    }
    const executionTimeout = boundedNativeTimeout(timeouts, "execute");
    const execution = spawnSync(executablePath, [], {
      encoding: "utf8",
      shell: false,
      timeout: executionTimeout,
    });
    const executionError = classifiedSubprocessError(execution, {
      executable: executablePath,
      phase: "execute",
      timeoutMs: executionTimeout,
    });
    if (executionError !== null) return executionError;
    return {
      available: true,
      phase: "execute",
      status: execution.status,
      signal: execution.signal,
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function auditAtomicOwnerExecution(
  upstreamSource,
  oracle,
  { staticFindings = [] } = {},
) {
  if (staticFindings.length > 0) return [];
  if (
    extractAtomicOwnerDefinition(
      upstreamSource,
      oracle.requiredExtension.symbol,
    ) === null
  ) {
    return [];
  }
  const variants = [
    ["plain", null, null],
    ...oracle.futureGreenGates.map((gate) => [
      gate.id,
      gate.compilerFlag,
      /AddressSanitizer|LeakSanitizer|UndefinedBehaviorSanitizer|runtime error/u,
    ]),
  ];
  const findings = [];
  for (const [label, sanitizerFlag, diagnostic] of variants) {
    const result = await compileAndRunAtomicOwnerSource(upstreamSource, {
      sanitizerFlag,
    });
    if (!result.available) {
      findings.push(
        finding(
          "atomic-owner-proof-unavailable",
          label,
          result.reason ?? "the compiler-backed owner proof is unavailable",
        ),
      );
      continue;
    }
    if (
      result.phase !== "execute" ||
      result.status !== 0 ||
      result.signal !== null ||
      result.hasExactCLinkage !== true ||
      (diagnostic && diagnostic.test(result.stderr ?? ""))
    ) {
      findings.push(
        finding(
          "atomic-owner-executable-contract",
          label,
          `the actual owner definition failed its compiler-backed ${label} proof`,
        ),
      );
    }
  }
  return findings;
}

function runGit(repository, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding,
    shell: false,
  });
  if (result.status !== 0) {
    return { ok: false, stdout: result.stdout, stderr: result.stderr };
  }
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

async function readFrozenOracle() {
  const bytes = await readFile(ORACLE_URL);
  const digest = sha256(bytes);
  if (digest !== ROCKSDB_OPAQUE_C_ORACLE_SHA256) {
    throw new Error(
      `RocksDB opaque-C oracle digest mismatch: expected ${ROCKSDB_OPAQUE_C_ORACLE_SHA256}, observed ${digest}`,
    );
  }
  return JSON.parse(bytes.toString("utf8"));
}

export function auditReleaseIdentityState(release, state, oracle) {
  const findings = [];
  const isCandidate = release.commit === oracle.upstream.candidate.commit;
  const isBaseline = release.commit === oracle.upstream.baseline.commit;
  const changedPaths = [...new Set(state.changedPaths)].sort();
  const expectedFiles = new Map(
    release.files.map((file) => [file.path, file.sha256]),
  );
  const identityFilesMatch = [...expectedFiles].every(([path, digest]) => {
    if (isCandidate && path === "db/c.cc") {
      return true;
    }
    const bytes = state.observed.get(path);
    return bytes !== undefined && sha256(bytes) === digest;
  });
  if (!identityFilesMatch) {
    findings.push(
      finding(
        "upstream-identity-unrecognized",
        release.tag,
        "reviewed release identity bytes drifted",
      ),
    );
  }

  if (isBaseline) {
    const dbSource = state.observed.get("db/c.cc");
    if (
      state.headCommit !== release.commit ||
      changedPaths.length !== 0 ||
      dbSource === undefined ||
      sha256(dbSource) !== expectedFiles.get("db/c.cc")
    ) {
      findings.push(
        finding(
          "baseline-source-drift",
          release.tag,
          "baseline must be the exact frozen commit, tree, and worktree bytes",
        ),
      );
    }
    return findings;
  }

  if (state.headCommit !== release.commit) {
    findings.push(
      finding(
        "candidate-commit-drift",
        release.tag,
        "candidate overlay must be applied to the exact reviewed candidate commit",
      ),
    );
  }
  if (state.candidateIsAncestor !== true) {
    findings.push(
      finding(
        "candidate-ancestry-drift",
        release.tag,
        "the exact reviewed candidate commit is not the overlay base",
      ),
    );
  }
  const overlay = oracle.requiredExtension.candidateOverlay;
  const overlayBytes = Buffer.from(overlay.utf8);
  const pristine = state.candidatePristine;
  const observedSource = state.observed.get("db/c.cc");
  const expectedSource = pristine
    ? Buffer.concat([pristine, overlayBytes])
    : null;
  if (
    sha256(overlayBytes) !== overlay.sha256 ||
    expectedSource === null ||
    sha256(expectedSource) !== overlay.resultSha256 ||
    observedSource === undefined ||
    !observedSource.equals(expectedSource) ||
    JSON.stringify(changedPaths) !==
      JSON.stringify([...overlay.changedPaths].sort())
  ) {
    findings.push(
      finding(
        "candidate-overlay-drift",
        release.tag,
        "candidate must contain only the exact reviewed owner overlay bytes",
      ),
    );
  }
  return findings;
}

async function identifyUpstream(repositoryRoot, oracle) {
  const submodule = join(repositoryRoot, "oxrocksdb-sys/rocksdb");
  const observed = new Map();
  for (const path of [
    "db/c.cc",
    "include/rocksdb/c.h",
    "include/rocksdb/version.h",
  ]) {
    observed.set(path, await readFile(join(submodule, path)));
  }
  const digestFor = (path) => sha256(observed.get(path));
  const matchesIdentityFiles = (release) =>
    release.files
      .filter((file) => file.path !== "db/c.cc")
      .every((file) => digestFor(file.path) === file.sha256);
  const release = [oracle.upstream.baseline, oracle.upstream.candidate].find(
    matchesIdentityFiles,
  );
  const findings = [];

  if (!release) {
    findings.push(
      finding(
        "upstream-identity-unrecognized",
        "oxrocksdb-sys/rocksdb",
        "version and public-C header bytes match neither frozen release",
      ),
    );
    return { release: null, observed, findings };
  }

  const head = runGit(submodule, ["rev-parse", "HEAD"]);
  const headCommit = head.ok ? head.stdout.trim() : null;
  const changed = runGit(submodule, [
    "diff",
    "--name-only",
    "--no-renames",
    release.commit,
    "--",
  ]);
  const untracked = runGit(submodule, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (!changed.ok || !untracked.ok) {
    findings.push(
      finding(
        "upstream-worktree-unavailable",
        release.tag,
        "the exact vendored worktree projection could not be enumerated",
      ),
    );
  }
  const changedPaths = [changed, untracked]
    .flatMap((result) => (result.ok ? result.stdout.split(/\r?\n/u) : []))
    .filter(Boolean);
  let candidateIsAncestor = null;
  let candidatePristine = null;
  if (release.commit === oracle.upstream.candidate.commit) {
    const ancestor = runGit(submodule, [
      "merge-base",
      "--is-ancestor",
      release.commit,
      "HEAD",
    ]);
    candidateIsAncestor = ancestor.ok;
    const pristine = runGit(
      submodule,
      ["show", `${release.commit}:db/c.cc`],
      null,
    );
    const expectedSource = release.files.find(
      (file) => file.path === "db/c.cc",
    );
    if (!pristine.ok || sha256(pristine.stdout) !== expectedSource.sha256) {
      findings.push(
        finding(
          "candidate-oracle-object-missing",
          release.tag,
          "the exact frozen upstream db/c.cc object is unavailable locally",
        ),
      );
    } else candidatePristine = pristine.stdout;
  }
  findings.push(
    ...auditReleaseIdentityState(
      release,
      {
        headCommit,
        changedPaths,
        observed,
        candidateIsAncestor,
        candidatePristine,
      },
      oracle,
    ),
  );
  return { release, observed, findings, headCommit };
}

export async function evaluateRocksdbOpaqueCContract(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const oracle = await readFrozenOracle();
  const submodule = join(root, "oxrocksdb-sys/rocksdb");
  const [apiSource, headerSource, rustSource] = await Promise.all([
    readFile(join(root, "oxrocksdb-sys/api/c.cc"), "utf8"),
    readFile(join(root, "oxrocksdb-sys/api/c.h"), "utf8"),
    readFile(join(root, "lib/oxigraph/src/storage/rocksdb_wrapper.rs"), "utf8"),
  ]);
  const upstream = await identifyUpstream(root, oracle);
  const buildGraphFindings = await auditBuildGraph(root, oracle);
  const upstreamSource = upstream.observed.get("db/c.cc").toString("utf8");
  const frozenHeaders = [
    oracle.upstream.baseline.commit,
    oracle.upstream.candidate.commit,
  ].map((commit) =>
    runGit(submodule, ["show", `${commit}:include/rocksdb/c.h`]),
  );
  const oracleFindings = frozenHeaders.every(({ ok }) => ok)
    ? auditOracleContract(
        oracle,
        frozenHeaders[0].stdout,
        frozenHeaders[1].stdout,
      )
    : [
        finding(
          "oracle-header-object-missing",
          "include/rocksdb/c.h",
          "both frozen public C headers must be available offline",
        ),
      ];
  const staticFindings = [
    ...upstream.findings,
    ...buildGraphFindings,
    ...oracleFindings,
    ...auditFutureGreenGates(oracle),
    ...auditBridgeSource(apiSource, oracle),
    ...auditShimDisposition(apiSource, headerSource, rustSource, oracle),
    ...auditLifecycle(rustSource),
    ...auditRequiredExtension(
      apiSource,
      headerSource,
      rustSource,
      upstreamSource,
      oracle,
    ),
  ];
  const findings = [
    ...staticFindings,
    ...(await auditAtomicOwnerExecution(upstreamSource, oracle, {
      staticFindings,
    })),
  ];
  return {
    schema: "oxigraph.rocksdb-opaque-c-upgrade-evaluation/v1",
    taskId: oracle.taskId,
    oracleSha256: ROCKSDB_OPAQUE_C_ORACLE_SHA256,
    repositoryRoot: root,
    upstream: upstream.release
      ? {
          tag: upstream.release.tag,
          commit: upstream.release.commit,
          observedHead: upstream.headCommit,
        }
      : null,
    status: findings.length === 0 ? "PASS" : "FAIL",
    findingCount: findings.length,
    findings,
  };
}

async function main() {
  const repositoryRoot = process.argv[2] ?? DEFAULT_REPOSITORY_ROOT;
  const result = await evaluateRocksdbOpaqueCContract(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
