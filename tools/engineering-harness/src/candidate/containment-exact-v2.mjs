import { createHash } from "node:crypto";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { canonicalJson } from "../routing/features.mjs";

const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const bufferPrototype = Buffer.prototype;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectHasOwn = Object.hasOwn;
const objectIsFrozen = Object.isFrozen;
const objectValues = Object.values;
const arrayIsArray = Array.isArray;
const arrayBufferIsView = ArrayBuffer.isView;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const bufferToString = Buffer.prototype.toString;
const utilTypesIsProxy = utilTypes.isProxy;
const utilTypesIsSharedArrayBuffer = utilTypes.isSharedArrayBuffer;
const typedArrayPrototype = objectGetPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArrayBufferGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
).get;
const typedArraySet = Uint8Array.prototype.set;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decoderDecode = TextDecoder.prototype.decode;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function nullRecord(entries) {
  const value = objectCreate(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

export function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !arrayBufferIsView(value) &&
    !objectIsFrozen(value)
  ) {
    objectFreeze(value);
    for (const child of objectValues(value)) deepFreeze(child);
  }
  return value;
}

export function frozenCopyOnReadBytes(bytes, entries = []) {
  const retained = bufferFrom(bytes);
  const value = objectCreate(null);
  objectDefineProperty(value, "bytes", {
    configurable: false,
    enumerable: true,
    get() {
      return bufferFrom(retained);
    },
  });
  for (const [key, child] of entries) value[key] = child;
  return objectFreeze(value);
}

export function exactRecord(value, expected, label, fail) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypesIsProxy(value) ||
    arrayIsArray(value) ||
    !arrayIsArray(expected)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} cannot be inspected`);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(`${label} has a foreign prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (keys.length !== expected.length) {
    fail(`${label} fields are not exact enumerable own data`);
  }
  const expectedKeys = objectCreate(null);
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    if (typeof key !== "string" || objectHasOwn(expectedKeys, key)) {
      fail(`${label} fields are not exact enumerable own data`);
    }
    expectedKeys[key] = true;
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !objectHasOwn(expectedKeys, key)) {
      fail(`${label} fields are not exact enumerable own data`);
    }
    const descriptor = descriptors[key];
    if (
      !objectHasOwn(descriptor, "value") ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(`${label} fields are not exact enumerable own data`);
    }
  }
  const normalized = objectCreate(null);
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    normalized[key] = descriptors[key].value;
  }
  return normalized;
}

export function exactDenseArray(value, label, maximum, fail) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypesIsProxy(value) ||
    !arrayIsArray(value) ||
    objectGetPrototypeOf(value) !== arrayPrototype
  ) {
    fail(`${label} must be an exact dense array`);
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(`${label} length is outside its exact bound`);
  }
  const keys = reflectOwnKeys(descriptors);
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ];
  if (
    !isDeepStrictEqual([...keys].sort(), expectedKeys.sort()) ||
    Array.from({ length }, (_, index) => descriptors[String(index)]).some(
      (descriptor) =>
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined,
    )
  ) {
    fail(`${label} shape changed`);
  }
  return objectFreeze(
    Array.from({ length }, (_, index) => descriptors[String(index)].value),
  );
}

export function boundedInteger(value, label, minimum, maximum, fail) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} is outside its exact bound`);
  }
  return value;
}

export function exactBoolean(value, expected, label, fail) {
  if (value !== expected) fail(`${label} changed`);
  return value;
}

export function exactDigest(value, label, fail) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} is not exact lowercase SHA-256`);
  }
  return value;
}

export function exactDecimal(value, label, { minimum = 0n } = {}, fail) {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    fail(`${label} is not an exact decimal integer`);
  }
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    fail(`${label} is not an exact decimal integer`);
  }
  if (parsed < minimum) fail(`${label} is outside its exact bound`);
  return value;
}

export function exactUnicodeString(
  value,
  label,
  { minimumBytes = 0, maximumBytes, nulFree = true } = {},
  fail,
) {
  if (typeof value !== "string") fail(`${label} is not text`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail(`${label} contains an unpaired surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(`${label} contains an unpaired surrogate`);
    }
  }
  if (nulFree && value.includes("\0")) fail(`${label} contains NUL`);
  const bytes = bufferByteLength(value, "utf8");
  if (
    bytes < minimumBytes ||
    !Number.isSafeInteger(maximumBytes) ||
    bytes > maximumBytes
  ) {
    fail(`${label} is outside its UTF-8 byte bound`);
  }
  return value;
}

export function copyBoundedBuffer(
  value,
  label,
  { minimumBytes = 0, maximumBytes },
  fail,
) {
  const length = exactBufferByteLength(
    value,
    label,
    { minimumBytes, maximumBytes },
    fail,
  );
  const copied = bufferAllocUnsafe(length);
  reflectApply(typedArraySet, copied, [value]);
  return copied;
}

export function exactBufferByteLength(
  value,
  label,
  { minimumBytes = 0, maximumBytes },
  fail,
) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypesIsProxy(value) ||
    !bufferIsBuffer(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = reflectApply(typedArrayLengthGetter, value, []);
  } catch {
    fail(`${label} length cannot be read intrinsically`);
  }
  if (
    !Number.isSafeInteger(length) ||
    length < minimumBytes ||
    length > maximumBytes
  ) {
    fail(`${label} is outside its byte bound`);
  }
  let backing;
  try {
    backing = reflectApply(typedArrayBufferGetter, value, []);
  } catch {
    fail(`${label} backing store cannot be read intrinsically`);
  }
  if (utilTypesIsSharedArrayBuffer(backing)) {
    fail(`${label} may not use shared mutable backing`);
  }
  return length;
}

export function decodeCanonicalJsonLine(bytesValue, label, maximumBytes, fail) {
  const bytes = copyBoundedBuffer(
    bytesValue,
    label,
    { minimumBytes: 2, maximumBytes },
    fail,
  );
  let text;
  try {
    text = reflectApply(decoderDecode, decoder, [bytes]);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.slice(0, -1).includes("\n")
  ) {
    fail(`${label} framing is invalid`);
  }
  const line = text.slice(0, -1);
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    fail(`${label} is not JSON`);
  }
  let canonical;
  try {
    canonical = canonicalJson(value);
  } catch {
    fail(`${label} is not canonical JSON data`);
  }
  if (canonical !== line) fail(`${label} is not canonical`);
  return { bytes, value };
}

export function canonicalJsonLine(value) {
  return bufferFrom(`${canonicalJson(value)}\n`, "utf8");
}

export function canonicalJsonBytes(value) {
  return bufferFrom(canonicalJson(value), "utf8");
}

export function encodeCanonicalBase64(value, label, maximumBytes, fail) {
  const copied = copyBoundedBuffer(
    value,
    label,
    { minimumBytes: 2, maximumBytes },
    fail,
  );
  return reflectApply(bufferToString, copied, ["base64"]);
}

export function decodeCanonicalBase64(value, label, maximumBytes, fail) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(maximumBytes / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    fail(`${label} is not bounded canonical base64`);
  }
  const decoded = bufferFrom(value, "base64");
  if (
    reflectApply(bufferToString, decoded, ["base64"]) !== value ||
    decoded.length > maximumBytes
  ) {
    fail(`${label} is not bounded canonical base64`);
  }
  return decoded;
}
