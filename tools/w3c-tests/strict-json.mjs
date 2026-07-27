const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function parseStrictJson(bytes, label = "JSON") {
  let source;
  try {
    source = Buffer.isBuffer(bytes) ? UTF8.decode(bytes) : String(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
  let offset = 0;

  function fail(message) {
    throw new Error(`${label} ${message} at byte ${offset}`);
  }

  function whitespace() {
    while (/[\t\n\r ]/.test(source[offset] ?? "")) offset += 1;
  }

  function value(depth) {
    if (depth > 128) fail("exceeds the nesting limit");
    whitespace();
    const character = source[offset];
    if (character === "{") return object(depth + 1);
    if (character === "[") return array(depth + 1);
    if (character === '"') return string();
    if (source.startsWith("true", offset)) {
      offset += 4;
      return true;
    }
    if (source.startsWith("false", offset)) {
      offset += 5;
      return false;
    }
    if (source.startsWith("null", offset)) {
      offset += 4;
      return null;
    }
    const number = source
      .slice(offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)?.[0];
    if (number) {
      offset += number.length;
      const parsed = Number(number);
      if (!Number.isFinite(parsed)) fail("contains a non-finite number");
      return parsed;
    }
    fail("contains an invalid value");
  }

  function object(depth) {
    offset += 1;
    whitespace();
    const result = Object.create(null);
    const keys = new Set();
    if (source[offset] === "}") {
      offset += 1;
      return result;
    }
    while (true) {
      whitespace();
      if (source[offset] !== '"') fail("contains a non-string object key");
      const key = string();
      if (keys.has(key))
        fail(`contains duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (source[offset] !== ":") fail("is missing an object colon");
      offset += 1;
      result[key] = value(depth);
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") fail("is missing an object comma");
      offset += 1;
    }
  }

  function array(depth) {
    offset += 1;
    whitespace();
    const result = [];
    if (source[offset] === "]") {
      offset += 1;
      return result;
    }
    while (true) {
      result.push(value(depth));
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") fail("is missing an array comma");
      offset += 1;
    }
  }

  function string() {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      }
      if (character === "\\") {
        offset += 1;
        const escape = source[offset];
        if (escape === "u") {
          if (!/^[0-9a-f]{4}$/i.test(source.slice(offset + 1, offset + 5))) {
            fail("contains an invalid Unicode escape");
          }
          offset += 5;
          continue;
        }
        if (!'"/\\bfnrt'.includes(escape ?? "")) {
          fail("contains an invalid string escape");
        }
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        fail("contains an unescaped control character");
      }
      offset += 1;
    }
    fail("contains an unterminated string");
  }

  const parsed = value(0);
  whitespace();
  if (offset !== source.length) fail("contains trailing content");
  return parsed;
}
