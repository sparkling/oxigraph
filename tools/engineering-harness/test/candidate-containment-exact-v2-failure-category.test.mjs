import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { types as utilTypes } from "node:util";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIRECTORY = resolve(TEST_DIRECTORY, "../src/candidate");
const EXACT_V2_URL = new URL(
  "../src/candidate/containment-exact-v2.mjs",
  import.meta.url,
);

const EXISTING_EXPORTS = Object.freeze([
  "boundedInteger",
  "canonicalJsonBytes",
  "canonicalJsonLine",
  "copyBoundedBuffer",
  "decodeCanonicalBase64",
  "decodeCanonicalJsonLine",
  "deepFreeze",
  "encodeCanonicalBase64",
  "exactBoolean",
  "exactBufferByteLength",
  "exactDecimal",
  "exactDenseArray",
  "exactDigest",
  "exactRecord",
  "exactUnicodeString",
  "frozenCopyOnReadBytes",
  "nullRecord",
  "sha256",
]);

const EXISTING_FUNCTION_CONTRACTS = Object.freeze({
  boundedInteger: Object.freeze({
    length: 5,
    sourceSha256:
      "6619272bc5c2ea74e0d242f4b94ea4bf61f335c801f29efb3fda1d29f528c0bd",
  }),
  canonicalJsonBytes: Object.freeze({
    length: 1,
    sourceSha256:
      "20acffd584fa748bf4563c33626adf892ab16da969f1b60b7976780a51a44762",
  }),
  canonicalJsonLine: Object.freeze({
    length: 1,
    sourceSha256:
      "891a6b45da1d06ff4d5081d331073186d6646b0fc036c0df83777e2e50c7b7c8",
  }),
  copyBoundedBuffer: Object.freeze({
    length: 4,
    sourceSha256:
      "79da5919c7ec8138b4dd347bf6a5c88996ecab47a0da4a4b87f91037dde20647",
  }),
  decodeCanonicalBase64: Object.freeze({
    length: 4,
    sourceSha256:
      "f6baaf3fef1ca5cc19cc1aa9d3a2990f5173bb6c073ad2d06bb83e45dcb7901a",
  }),
  decodeCanonicalJsonLine: Object.freeze({
    length: 4,
    sourceSha256:
      "0dbf46394b71ad29c32ff1b5a8a81883db0573356126a349c3dcd24e343030d2",
  }),
  deepFreeze: Object.freeze({
    length: 1,
    sourceSha256:
      "ffc208ab37d361a90ee0504ed82396cd4bf265c2d36be68b53c7ee6238209d85",
  }),
  encodeCanonicalBase64: Object.freeze({
    length: 4,
    sourceSha256:
      "6e5e23c2233886190a5f9ba25eb79bb2042cb3734be5f63628266275005a5aad",
  }),
  exactBoolean: Object.freeze({
    length: 4,
    sourceSha256:
      "462b730e27bc0c1230b186bc6bdb2680ecb535e95a9a90240451f32cd39499a4",
  }),
  exactBufferByteLength: Object.freeze({
    length: 4,
    sourceSha256:
      "3ec78b502e3f9acad5cbb656acf8fcce29afd9545e8a1be7ba9b7b42f07285c5",
  }),
  exactDecimal: Object.freeze({
    length: 2,
    sourceSha256:
      "bba62b1c011b02799ea12bbe75989213fc2a69c39c210e4b0ebdb9b67098aa81",
  }),
  exactDenseArray: Object.freeze({
    length: 4,
    sourceSha256:
      "30846a471d3189ab8374109d04d7f1a0ab8b736059c5158549c01532c12600c9",
  }),
  exactDigest: Object.freeze({
    length: 3,
    sourceSha256:
      "a83a129591d0963accde2a43ba98a26ec25bece5a262cdded5fecce08d0842ec",
  }),
  exactRecord: Object.freeze({
    length: 4,
    sourceSha256:
      "df7064fd90f0b370520376a04569a0c03644ea91e9c4c53c07e4d17de0f12ecc",
  }),
  exactUnicodeString: Object.freeze({
    length: 2,
    sourceSha256:
      "3d97808056e2e6c7c55d5e383a70edd728abf5fb7e8c669a04d725454b8a3810",
  }),
  frozenCopyOnReadBytes: Object.freeze({
    length: 1,
    sourceSha256:
      "5b8952646833c639581a429e015feb947c40e012873e6bb69127d171d3d482a9",
  }),
  nullRecord: Object.freeze({
    length: 1,
    sourceSha256:
      "adfa9df5684c4a239f69db97b67541c6b59b5a60c0b71d5f06936441d726c7dc",
  }),
  sha256: Object.freeze({
    length: 1,
    sourceSha256:
      "7d51a4c2aad28cd5d724c97645fda7d23345a0d943b3be761f4ac471ed68e79d",
  }),
});

const DIRECT_IMPORTER_SHA256 = Object.freeze({
  "containment-guardian-journal-v1.mjs":
    "c48c6692752550a547fa5936ab47c78170c6e33f0d8d527fe2d24c4ffc5e1276",
  "containment-guardian-journal-v2.mjs":
    "0fd3751914828519300cdcb3d327824ce78c5b95e5a9acd7211a376b548f0075",
  "containment-guardian-lifetime-v1.mjs":
    "f454ee962615e887c294f4aabade6a640ac1881fd3662842b75a3be8afb8f3e5",
  "containment-guardian-recovery-v1.mjs":
    "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
  "containment-launch-capsule-v2.mjs":
    "4b6a7ed38f3b91d25488d0f9a3c88d376e1907086be17c62dc949ab80c74dda4",
  "containment-launch-capsule-v3.mjs":
    "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
  "containment-supervisor-bootstrap-v3.mjs":
    "f045a0830067f9e41d6532663754938d1cdeece4f088b732dac054ba9fe3efa5",
  "containment-supervisor-control-v2.mjs":
    "92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842",
  "containment-supervisor-preflight-v4.mjs":
    "747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff",
});

const exactV2 = await import(EXACT_V2_URL.href);
const copyBoundedBufferByFailureCategory =
  exactV2.copyBoundedBufferByFailureCategory;
const HELPER_AVAILABLE =
  typeof copyBoundedBufferByFailureCategory === "function";
const HELPER_RED_SKIP = HELPER_AVAILABLE
  ? false
  : "RED: copyBoundedBufferByFailureCategory is not exported";
let freshImportOrdinal = 0;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function failureCallbacks(expectedCategory) {
  const calls = [];
  const boundsError = new Error("bounds sentinel");
  const shapeError = new Error("shape sentinel");
  const expectedError =
    expectedCategory === "bounds" ? boundsError : shapeError;
  return {
    calls,
    expectedError,
    failBounds() {
      calls.push("bounds");
      throw boundsError;
    },
    failShape() {
      calls.push("shape");
      throw shapeError;
    },
  };
}

function assertFailureCategory(
  value,
  limits,
  expectedCategory,
  helper = copyBoundedBufferByFailureCategory,
) {
  const callbacks = failureCallbacks(expectedCategory);
  assert.throws(
    () =>
      helper(
        value,
        "carrier",
        limits,
        callbacks.failBounds,
        callbacks.failShape,
      ),
    (error) => error === callbacks.expectedError,
  );
  assert.deepEqual(callbacks.calls, [expectedCategory]);
}

function ordinaryBuffer(bytes) {
  const value = Buffer.allocUnsafeSlow(bytes.length);
  value.set(bytes);
  return value;
}

function subclassBuffer(length) {
  class ExactV2BufferSubclass extends Buffer {}
  return Reflect.construct(Uint8Array, [length], ExactV2BufferSubclass);
}

function foreignPrototypeBuffer(length) {
  const value = Buffer.allocUnsafeSlow(length);
  const foreignPrototype = runInNewContext("Object.create(Buffer.prototype)", {
    Buffer,
  });
  Object.setPrototypeOf(value, foreignPrototype);
  return value;
}

async function importWithTypedArrayGetter(name, replacement) {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const original = Object.getOwnPropertyDescriptor(typedArrayPrototype, name);
  assert.equal(original.configurable, true);
  Object.defineProperty(typedArrayPrototype, name, {
    ...original,
    get: replacement(original.get),
  });
  try {
    freshImportOrdinal += 1;
    return await import(
      `${EXACT_V2_URL.href}?failure-category-${name}=${freshImportOrdinal}`
    );
  } finally {
    Object.defineProperty(typedArrayPrototype, name, original);
  }
}

test("exact-v2 preserves all 18 incumbent function signatures and source bodies", () => {
  for (const name of EXISTING_EXPORTS) {
    const value = exactV2[name];
    const expected = EXISTING_FUNCTION_CONTRACTS[name];
    assert.equal(typeof value, "function", name);
    assert.equal(value.length, expected.length, `${name} positional signature`);
    assert.equal(
      sha256(Function.prototype.toString.call(value)),
      expected.sourceSha256,
      `${name} function source`,
    );
  }
});

test("exact-v2 preserves the nine incumbent direct-importer byte identities", async () => {
  for (const [name, expectedSha256] of Object.entries(DIRECT_IMPORTER_SHA256)) {
    const bytes = await readFile(resolve(CANDIDATE_DIRECTORY, name));
    assert.equal(sha256(bytes), expectedSha256, name);
  }
});

test("exact-v2 adds exactly the five-argument category-aware helper export", () => {
  assert.equal(
    typeof copyBoundedBufferByFailureCategory,
    "function",
    "copyBoundedBufferByFailureCategory export",
  );
  assert.equal(copyBoundedBufferByFailureCategory.length, 5);
  assert.deepEqual(
    Object.keys(exactV2).sort(),
    [...EXISTING_EXPORTS, "copyBoundedBufferByFailureCategory"].sort(),
  );
});

test(
  "category helper rejects Proxies through shape without invoking any trap",
  { skip: HELPER_RED_SKIP },
  () => {
    const trapCalls = [];
    const trap = (name) => () => {
      trapCalls.push(name);
      throw new Error(`unexpected ${name} trap`);
    };
    const proxy = new Proxy(ordinaryBuffer([1, 2, 3, 4]), {
      defineProperty: trap("defineProperty"),
      deleteProperty: trap("deleteProperty"),
      get: trap("get"),
      getOwnPropertyDescriptor: trap("getOwnPropertyDescriptor"),
      getPrototypeOf: trap("getPrototypeOf"),
      has: trap("has"),
      ownKeys: trap("ownKeys"),
      set: trap("set"),
      setPrototypeOf: trap("setPrototypeOf"),
    });
    assertFailureCategory(proxy, { maximumBytes: 0 }, "shape");
    assert.deepEqual(trapCalls, []);

    const revoked = Proxy.revocable(ordinaryBuffer([1]), {});
    revoked.revoke();
    assertFailureCategory(revoked.proxy, { maximumBytes: 0 }, "shape");
  },
);

test(
  "category helper rejects non-Buffers through shape without reading caller properties",
  { skip: HELPER_RED_SKIP },
  () => {
    const reads = [];
    const value = {};
    for (const key of ["length", "buffer", "byteLength", "constructor"]) {
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        get() {
          reads.push(key);
          throw new Error(`unexpected ${key} read`);
        },
      });
    }
    assertFailureCategory(value, { maximumBytes: 0 }, "shape");
    assert.deepEqual(reads, []);
  },
);

test(
  "category helper maps non-safe and out-of-range intrinsic lengths to bounds",
  { skip: HELPER_RED_SKIP },
  async () => {
    assertFailureCategory(
      ordinaryBuffer([1]),
      { minimumBytes: 2, maximumBytes: 4 },
      "bounds",
    );
    assertFailureCategory(
      ordinaryBuffer([1, 2, 3, 4, 5]),
      { maximumBytes: 4 },
      "bounds",
    );
    assertFailureCategory(
      ordinaryBuffer([]),
      { maximumBytes: Number.NaN },
      "bounds",
    );

    const invalidLengthTarget = ordinaryBuffer([1]);
    const invalidLengthModule = await importWithTypedArrayGetter(
      "length",
      (originalGetter) =>
        function invalidIntrinsicLength() {
          if (this === invalidLengthTarget) return Number.NaN;
          return Reflect.apply(originalGetter, this, []);
        },
    );
    assertFailureCategory(
      invalidLengthTarget,
      { maximumBytes: 4 },
      "bounds",
      invalidLengthModule.copyBoundedBufferByFailureCategory,
    );
  },
);

test(
  "category helper applies bounds before subclass, foreign-prototype, own-length, and shared-backing shape faults",
  { skip: HELPER_RED_SKIP },
  () => {
    const subclass = subclassBuffer(4);
    assert.equal(Buffer.isBuffer(subclass), true);
    assertFailureCategory(subclass, { maximumBytes: 3 }, "bounds");

    const foreign = foreignPrototypeBuffer(4);
    assert.equal(Buffer.isBuffer(foreign), true);
    assertFailureCategory(foreign, { maximumBytes: 3 }, "bounds");

    const ownLength = ordinaryBuffer([1, 2, 3, 4]);
    Object.defineProperty(ownLength, "length", {
      configurable: true,
      enumerable: false,
      value: 1,
    });
    assertFailureCategory(ownLength, { maximumBytes: 3 }, "bounds");

    const shared = Buffer.from(new SharedArrayBuffer(4));
    assert.equal(utilTypes.isSharedArrayBuffer(shared.buffer), true);
    assertFailureCategory(shared, { maximumBytes: 3 }, "bounds");
  },
);

test(
  "category helper maps post-length prototype, own-length, and shared-backing faults to shape",
  { skip: HELPER_RED_SKIP },
  () => {
    assertFailureCategory(subclassBuffer(2), { maximumBytes: 3 }, "shape");
    assertFailureCategory(
      foreignPrototypeBuffer(2),
      { maximumBytes: 3 },
      "shape",
    );

    const ownLength = ordinaryBuffer([1, 2]);
    Object.defineProperty(ownLength, "length", {
      configurable: true,
      enumerable: false,
      value: 2,
    });
    assertFailureCategory(ownLength, { maximumBytes: 3 }, "shape");

    const shared = Buffer.from(new SharedArrayBuffer(2));
    assertFailureCategory(shared, { maximumBytes: 3 }, "shape");
  },
);

test(
  "category helper maps an unreadable intrinsic backing store to shape",
  { skip: HELPER_RED_SKIP },
  async () => {
    const value = ordinaryBuffer([1, 2]);
    const unreadableBackingModule = await importWithTypedArrayGetter(
      "buffer",
      (originalGetter) =>
        function unreadableBacking() {
          if (this === value) throw new Error("injected unreadable backing");
          return Reflect.apply(originalGetter, this, []);
        },
    );
    assertFailureCategory(
      value,
      { maximumBytes: 3 },
      "shape",
      unreadableBackingModule.copyBoundedBufferByFailureCategory,
    );
  },
);

test(
  "category helper rejects detached backing through shape after an in-range intrinsic length",
  { skip: HELPER_RED_SKIP },
  () => {
    const backing = new ArrayBuffer(2);
    const value = Buffer.from(backing);
    structuredClone(backing, { transfer: [backing] });
    assert.equal(value.length, 0);
    assertFailureCategory(value, { maximumBytes: 0 }, "shape");
  },
);

test(
  "category helper returns a fresh ordinary local Buffer with no caller alias",
  { skip: HELPER_RED_SKIP },
  () => {
    const value = ordinaryBuffer([3, 5, 8, 13]);
    const callbackCalls = [];
    const copied = copyBoundedBufferByFailureCategory(
      value,
      "carrier",
      { maximumBytes: 4 },
      () => callbackCalls.push("bounds"),
      () => callbackCalls.push("shape"),
    );
    assert.deepEqual(callbackCalls, []);
    assert.equal(Buffer.isBuffer(copied), true);
    assert.equal(Object.getPrototypeOf(copied), Buffer.prototype);
    assert.equal(utilTypes.isSharedArrayBuffer(copied.buffer), false);
    assert.notEqual(copied, value);
    assert.notEqual(copied.buffer, value.buffer);
    assert.deepEqual([...copied], [3, 5, 8, 13]);

    value[0] = 21;
    assert.deepEqual([...copied], [3, 5, 8, 13]);
    copied[1] = 34;
    assert.deepEqual([...value], [21, 5, 8, 13]);

    const empty = copyBoundedBufferByFailureCategory(
      Buffer.alloc(0),
      "empty",
      { maximumBytes: 0 },
      () => {
        throw new Error("unexpected bounds");
      },
      () => {
        throw new Error("unexpected shape");
      },
    );
    assert.equal(empty.length, 0);
    assert.equal(Object.getPrototypeOf(empty), Buffer.prototype);
  },
);

test(
  "category helper does not enumerate, inspect, read, write, invoke, or copy additional non-index properties",
  { skip: HELPER_RED_SKIP },
  async () => {
    const value = ordinaryBuffer([2, 4, 6]);
    const symbolData = Symbol("symbol data");
    const symbolAccessor = Symbol("symbol accessor");
    const propertyEffects = [];

    Object.defineProperties(value, {
      metadata: {
        configurable: true,
        enumerable: true,
        value: Object.freeze({ ignored: true }),
      },
      readProbe: {
        configurable: true,
        enumerable: true,
        get() {
          propertyEffects.push("readProbe:get");
          throw new Error("unexpected getter invocation");
        },
      },
      writeProbe: {
        configurable: true,
        enumerable: true,
        set() {
          propertyEffects.push("writeProbe:set");
          throw new Error("unexpected setter invocation");
        },
      },
    });
    Object.defineProperty(value, symbolData, {
      configurable: true,
      enumerable: true,
      value: "ignored",
    });
    Object.defineProperty(value, symbolAccessor, {
      configurable: true,
      enumerable: true,
      get() {
        propertyEffects.push("symbolAccessor:get");
        throw new Error("unexpected symbol getter invocation");
      },
      set() {
        propertyEffects.push("symbolAccessor:set");
        throw new Error("unexpected symbol setter invocation");
      },
    });

    const originalIntrinsics = {
      assign: Object.assign,
      entries: Object.entries,
      getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
      getOwnPropertyNames: Object.getOwnPropertyNames,
      getOwnPropertySymbols: Object.getOwnPropertySymbols,
      hasOwn: Object.hasOwn,
      keys: Object.keys,
      values: Object.values,
      get: Reflect.get,
      ownKeys: Reflect.ownKeys,
      set: Reflect.set,
    };
    const unexpectedInspection = (name) => {
      propertyEffects.push(name);
      throw new Error(`unexpected ${name}`);
    };
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(
      target,
      key,
    ) {
      if (target === value && key !== "length") {
        return unexpectedInspection(`getOwnPropertyDescriptor:${String(key)}`);
      }
      return originalIntrinsics.getOwnPropertyDescriptor(target, key);
    };
    Object.assign = function assign(target, ...sources) {
      if (target === value || sources.includes(value)) {
        return unexpectedInspection("Object.assign");
      }
      return Reflect.apply(originalIntrinsics.assign, Object, [
        target,
        ...sources,
      ]);
    };
    Object.entries = function entries(target) {
      if (target === value) return unexpectedInspection("Object.entries");
      return originalIntrinsics.entries(target);
    };
    Object.getOwnPropertyDescriptors = function getOwnPropertyDescriptors(
      target,
    ) {
      if (target === value)
        return unexpectedInspection("getOwnPropertyDescriptors");
      return originalIntrinsics.getOwnPropertyDescriptors(target);
    };
    Object.getOwnPropertyNames = function getOwnPropertyNames(target) {
      if (target === value) return unexpectedInspection("getOwnPropertyNames");
      return originalIntrinsics.getOwnPropertyNames(target);
    };
    Object.getOwnPropertySymbols = function getOwnPropertySymbols(target) {
      if (target === value)
        return unexpectedInspection("getOwnPropertySymbols");
      return originalIntrinsics.getOwnPropertySymbols(target);
    };
    Object.hasOwn = function hasOwn(target, key) {
      if (target === value && key !== "length") {
        return unexpectedInspection(`Object.hasOwn:${String(key)}`);
      }
      return originalIntrinsics.hasOwn(target, key);
    };
    Object.keys = function keys(target) {
      if (target === value) return unexpectedInspection("Object.keys");
      return originalIntrinsics.keys(target);
    };
    Object.values = function values(target) {
      if (target === value) return unexpectedInspection("Object.values");
      return originalIntrinsics.values(target);
    };
    Reflect.get = function get(target, key, receiver) {
      if (target === value) {
        return unexpectedInspection(`Reflect.get:${String(key)}`);
      }
      if (arguments.length < 3) return originalIntrinsics.get(target, key);
      return originalIntrinsics.get(target, key, receiver);
    };
    Reflect.ownKeys = function ownKeys(target) {
      if (target === value) return unexpectedInspection("Reflect.ownKeys");
      return originalIntrinsics.ownKeys(target);
    };
    Reflect.set = function set(target, key, child, receiver) {
      if (target === value) {
        return unexpectedInspection(`Reflect.set:${String(key)}`);
      }
      if (arguments.length < 4) {
        return originalIntrinsics.set(target, key, child);
      }
      return originalIntrinsics.set(target, key, child, receiver);
    };

    let probedModule;
    try {
      freshImportOrdinal += 1;
      probedModule = await import(
        `${EXACT_V2_URL.href}?ignored-properties=${freshImportOrdinal}`
      );
    } finally {
      Object.assign = originalIntrinsics.assign;
      Object.entries = originalIntrinsics.entries;
      Object.getOwnPropertyDescriptor =
        originalIntrinsics.getOwnPropertyDescriptor;
      Object.getOwnPropertyDescriptors =
        originalIntrinsics.getOwnPropertyDescriptors;
      Object.getOwnPropertyNames = originalIntrinsics.getOwnPropertyNames;
      Object.getOwnPropertySymbols = originalIntrinsics.getOwnPropertySymbols;
      Object.hasOwn = originalIntrinsics.hasOwn;
      Object.keys = originalIntrinsics.keys;
      Object.values = originalIntrinsics.values;
      Reflect.get = originalIntrinsics.get;
      Reflect.ownKeys = originalIntrinsics.ownKeys;
      Reflect.set = originalIntrinsics.set;
    }

    const copied = probedModule.copyBoundedBufferByFailureCategory(
      value,
      "carrier",
      { maximumBytes: 3 },
      () => {
        throw new Error("unexpected bounds");
      },
      () => {
        throw new Error("unexpected shape");
      },
    );
    assert.deepEqual(propertyEffects, []);
    assert.deepEqual([...copied], [2, 4, 6]);
    assert.equal(Object.hasOwn(copied, "metadata"), false);
    assert.equal(Object.hasOwn(copied, "readProbe"), false);
    assert.equal(Object.hasOwn(copied, "writeProbe"), false);
    assert.equal(Object.hasOwn(copied, symbolData), false);
    assert.equal(Object.hasOwn(copied, symbolAccessor), false);
    assert.equal(value.metadata.ignored, true);
  },
);

test(
  "category helper never returns when failBounds returns",
  { skip: HELPER_RED_SKIP },
  () => {
    const calls = [];
    assert.throws(() =>
      copyBoundedBufferByFailureCategory(
        ordinaryBuffer([1, 2]),
        "carrier",
        { maximumBytes: 1 },
        () => calls.push("bounds"),
        () => calls.push("shape"),
      ),
    );
    assert.deepEqual(calls, ["bounds"]);
  },
);

test(
  "category helper never returns when failShape returns",
  { skip: HELPER_RED_SKIP },
  () => {
    const calls = [];
    assert.throws(() =>
      copyBoundedBufferByFailureCategory(
        subclassBuffer(1),
        "carrier",
        { maximumBytes: 1 },
        () => calls.push("bounds"),
        () => calls.push("shape"),
      ),
    );
    assert.deepEqual(calls, ["shape"]);
  },
);
