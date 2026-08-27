import { isDeepStrictEqual } from "node:util";

const MAX_ELF_BYTES = 512 * 1024 * 1024;
const MAX_PROGRAM_HEADERS = 4_096;
const MAX_DYNAMIC_ENTRIES = 65_536;
const MAX_LINKER_SCRIPT_BYTES = 1024 * 1024;
const MAX_DYNAMIC_STRING_BYTES = 16 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export class G17NativeElfFault extends Error {
  constructor(reason) {
    super(`G1.7 native ELF: ${reason}`);
    this.name = "G17NativeElfFault";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new G17NativeElfFault(reason);
}

function boundedBuffer(value, label, maximum = MAX_ELF_BYTES) {
  if (!Buffer.isBuffer(value) || value.length < 1 || value.length > maximum) {
    fail(`${label} is not a bounded Buffer`);
  }
  return value;
}

function boundedNumber(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (value > BigInt(maximum)) fail(`${label} exceeds its integer ceiling`);
  return Number(value);
}

function region(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length ||
    length > bytes.length - offset
  ) {
    fail(`${label} is outside the ELF file`);
  }
  return bytes.subarray(offset, offset + length);
}

function cString(bytes, offset, maximum, label) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
    fail(`${label} offset is outside its string table`);
  }
  const ceiling = Math.min(bytes.length, offset + maximum + 1);
  const end = bytes.indexOf(0, offset);
  if (end < offset || end >= ceiling) fail(`${label} is absent or unbounded`);
  try {
    const value = decoder.decode(bytes.subarray(offset, end));
    if (value.length === 0 || value.includes("\0")) fail(`${label} is empty`);
    return value;
  } catch (error) {
    if (error instanceof G17NativeElfFault) throw error;
    fail(`${label} is not UTF-8`);
  }
}

function splitSearchPath(value, label) {
  const paths = value.split(":");
  if (
    paths.length > 256 ||
    paths.some(
      (path) =>
        path.length === 0 ||
        Buffer.byteLength(path, "utf8") > 4_096 ||
        path.includes("\0"),
    )
  ) {
    fail(`${label} is not a bounded non-empty search path`);
  }
  return paths;
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function parseG17Elf64(input) {
  if (Buffer.isBuffer(input) && input.length === 0) return null;
  const bytes = boundedBuffer(input, "input");
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    return null;
  }
  if (bytes.length < 64) fail("ELF header is truncated");
  if (bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) {
    fail("ELF class, data encoding, or version is unsupported");
  }
  const elfMachine = bytes.readUInt16LE(18);
  if (elfMachine !== 62) fail("ELF machine is not x86-64");
  const programHeaderOffset = boundedNumber(
    bytes.readBigUInt64LE(32),
    "program-header offset",
    bytes.length,
  );
  const programHeaderEntryBytes = bytes.readUInt16LE(54);
  const programHeaderCount = bytes.readUInt16LE(56);
  if (
    programHeaderEntryBytes < 56 ||
    programHeaderCount < 1 ||
    programHeaderCount > MAX_PROGRAM_HEADERS
  ) {
    fail("program-header inventory is unsupported or unbounded");
  }
  region(
    bytes,
    programHeaderOffset,
    programHeaderEntryBytes * programHeaderCount,
    "program-header table",
  );
  const programHeaders = [];
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * programHeaderEntryBytes;
    programHeaders.push({
      type: bytes.readUInt32LE(offset),
      fileOffset: boundedNumber(bytes.readBigUInt64LE(offset + 8), "segment offset", bytes.length),
      virtualAddress: bytes.readBigUInt64LE(offset + 16),
      fileBytes: boundedNumber(bytes.readBigUInt64LE(offset + 32), "segment file size", bytes.length),
      memoryBytes: bytes.readBigUInt64LE(offset + 40),
    });
  }
  for (const [index, header] of programHeaders.entries()) {
    region(bytes, header.fileOffset, header.fileBytes, `program segment ${index}`);
    if (BigInt(header.fileBytes) > header.memoryBytes) {
      fail(`program segment ${index} file size exceeds memory size`);
    }
  }
  const interpreterSegments = programHeaders.filter(({ type }) => type === 3);
  if (interpreterSegments.length > 1) fail("ELF has multiple interpreters");
  const interpreter = interpreterSegments.length === 0
    ? null
    : cString(
      bytes,
      interpreterSegments[0].fileOffset,
      interpreterSegments[0].fileBytes,
      "ELF interpreter",
    );
  if (interpreter !== null && !interpreter.startsWith("/")) {
    fail("ELF interpreter is not absolute");
  }
  const dynamicSegments = programHeaders.filter(({ type }) => type === 2);
  if (dynamicSegments.length > 1) fail("ELF has multiple dynamic segments");
  if (dynamicSegments.length === 0) {
    return freeze({
      elfClass: 64,
      elfData: "little",
      elfMachine,
      interpreter,
      soname: null,
      needed: [],
      rpath: [],
      runpath: [],
    });
  }
  const dynamic = dynamicSegments[0];
  if (dynamic.fileBytes % 16 !== 0) fail("ELF dynamic segment is misaligned");
  const dynamicCount = dynamic.fileBytes / 16;
  if (dynamicCount > MAX_DYNAMIC_ENTRIES) fail("ELF dynamic table is unbounded");
  const values = new Map();
  let nullSeen = false;
  for (let index = 0; index < dynamicCount; index += 1) {
    const offset = dynamic.fileOffset + index * 16;
    const tag = bytes.readBigInt64LE(offset);
    const value = bytes.readBigUInt64LE(offset + 8);
    if (tag === 0n) {
      nullSeen = true;
      break;
    }
    const entries = values.get(tag) ?? [];
    entries.push(value);
    values.set(tag, entries);
  }
  if (!nullSeen) fail("ELF dynamic table has no terminator");
  const stringTables = values.get(5n) ?? [];
  const stringSizes = values.get(10n) ?? [];
  if (stringTables.length !== 1 || stringSizes.length !== 1) {
    fail("ELF dynamic string table is absent or ambiguous");
  }
  const stringVirtualAddress = stringTables[0];
  const stringSize = boundedNumber(
    stringSizes[0],
    "dynamic string-table size",
    Math.min(bytes.length, MAX_DYNAMIC_STRING_BYTES),
  );
  const matchingLoads = programHeaders.filter(
    ({ type, virtualAddress, fileBytes }) =>
      type === 1 &&
      stringVirtualAddress >= virtualAddress &&
      stringVirtualAddress + BigInt(stringSize) <= virtualAddress + BigInt(fileBytes),
  );
  if (matchingLoads.length !== 1) {
    fail("ELF dynamic string table does not map to one load segment");
  }
  const load = matchingLoads[0];
  const stringOffset = load.fileOffset + boundedNumber(
    stringVirtualAddress - load.virtualAddress,
    "dynamic string-table file offset",
    bytes.length,
  );
  const strings = region(bytes, stringOffset, stringSize, "dynamic string table");
  const valuesFor = (tag, label) => (values.get(tag) ?? []).map((offset, index) =>
    cString(
      strings,
      boundedNumber(offset, `${label} offset`, strings.length - 1),
      MAX_DYNAMIC_STRING_BYTES,
      `${label} ${index}`,
    ));
  const sonames = valuesFor(14n, "SONAME");
  const rpaths = valuesFor(15n, "RPATH");
  const runpaths = valuesFor(29n, "RUNPATH");
  if (sonames.length > 1 || rpaths.length > 1 || runpaths.length > 1) {
    fail("ELF dynamic singleton tags are ambiguous");
  }
  const node = {
    elfClass: 64,
    elfData: "little",
    elfMachine,
    interpreter,
    soname: sonames[0] ?? null,
    needed: valuesFor(1n, "DT_NEEDED"),
    rpath: rpaths.length === 0 ? [] : splitSearchPath(rpaths[0], "ELF RPATH"),
    runpath: runpaths.length === 0 ? [] : splitSearchPath(runpaths[0], "ELF RUNPATH"),
  };
  if (new Set(node.needed).size !== node.needed.length) {
    fail("ELF DT_NEEDED inventory is duplicated");
  }
  return freeze(node);
}

function stripLinkerComments(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//gu, " ");
  if (stripped.includes("/*") || stripped.includes("*/")) {
    fail("GNU linker script contains an unterminated comment");
  }
  return stripped;
}

export function parseG17GnuLinkerScript(input) {
  const bytes = boundedBuffer(input, "linker-script input");
  if (parseG17Elf64(bytes) !== null) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from("!<arch>\n", "ascii"))) return null;
  if (bytes.length > MAX_LINKER_SCRIPT_BYTES) {
    fail("GNU linker script exceeds its byte ceiling");
  }
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  if (text.includes("\0")) fail("GNU linker script contains NUL");
  const source = stripLinkerComments(text);
  const tokens = source.match(/(?:[^\s(),]+|[(),])/gu) ?? [];
  if (tokens.length > 65_536) fail("GNU linker script token inventory is unbounded");
  const directives = [];
  const inputs = [];
  const directiveNames = new Set(["GROUP", "INPUT", "AS_NEEDED"]);
  let depth = 0;
  let acceptsInputs = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (directiveNames.has(token)) {
      if (tokens[index + 1] !== "(") fail(`GNU linker directive ${token} has no body`);
      directives.push(token);
      if (token === "GROUP" || token === "INPUT") acceptsInputs = true;
      continue;
    }
    if (token === "(") {
      depth += 1;
      if (depth > 64) fail("GNU linker script nesting is unbounded");
      continue;
    }
    if (token === ")") {
      depth -= 1;
      if (depth < 0) fail("GNU linker script parentheses are unbalanced");
      continue;
    }
    if (token === "," || !acceptsInputs || depth < 1 || token === "OUTPUT_FORMAT") {
      continue;
    }
    if (token.startsWith("-") && !token.startsWith("-l")) {
      fail(`GNU linker script option is unsupported: ${token}`);
    }
    inputs.push(token);
  }
  if (depth !== 0) fail("GNU linker script parentheses are unbalanced");
  if (directives.every((value) => value !== "GROUP" && value !== "INPUT")) return null;
  if (inputs.length < 1 || inputs.length > 4_096 || new Set(inputs).size !== inputs.length) {
    fail("GNU linker script inputs are absent, duplicated, or unbounded");
  }
  const value = { directives, inputs };
  if (!isDeepStrictEqual(value, JSON.parse(JSON.stringify(value)))) {
    fail("GNU linker script projection is not JSON-safe");
  }
  return freeze(value);
}
