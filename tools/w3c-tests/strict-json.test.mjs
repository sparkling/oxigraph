import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictJson } from "./strict-json.mjs";

test("parses the complete JSON data model", () => {
  const parsed = parseStrictJson(
    '{"text":"a\\u0020b","values":[true,false,null,-1.5e2],"nested":{"x":1}}',
    "fixture",
  );
  assert.equal(parsed.text, "a b");
  assert.deepEqual(parsed.values, [true, false, null, -150]);
  assert.equal(parsed.nested.x, 1);
});

test("rejects duplicate object keys at any depth", () => {
  assert.throws(
    () => parseStrictJson('{"outer":{"same":1,"same":2}}', "fixture"),
    /duplicate object key "same"/,
  );
});

test("rejects trailing input, invalid escapes, and excessive nesting", () => {
  assert.throws(
    () => parseStrictJson("{} false", "fixture"),
    /trailing content/,
  );
  assert.throws(
    () => parseStrictJson('"\\x"', "fixture"),
    /invalid string escape/,
  );
  assert.throws(
    () => parseStrictJson(`${"[".repeat(130)}0${"]".repeat(130)}`, "fixture"),
    /nesting limit/,
  );
  assert.throws(
    () => parseStrictJson(Buffer.from([0xff]), "fixture"),
    /not valid UTF-8/,
  );
});
