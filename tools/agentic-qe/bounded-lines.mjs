export const MAX_TEST_OUTPUT_LINE_BYTES = 65_536;

function scanLimit(message) {
  const error = new Error(message);
  error.code = "TEST_OUTPUT_SCAN_LIMIT";
  throw error;
}

export function* boundedTestOutputLines(output) {
  if (typeof output !== "string") {
    scanLimit("test output is not decoded text");
  }
  let start = 0;
  for (let index = 0; index <= output.length; index += 1) {
    if (index !== output.length && output.charCodeAt(index) !== 0x0a) {
      if (index - start + 1 > MAX_TEST_OUTPUT_LINE_BYTES) {
        scanLimit("test output line exceeds its byte ceiling");
      }
      continue;
    }
    const end =
      index > start && output.charCodeAt(index - 1) === 0x0d
        ? index - 1
        : index;
    const line = output.slice(start, end);
    if (Buffer.byteLength(line, "utf8") > MAX_TEST_OUTPUT_LINE_BYTES) {
      scanLimit("test output line exceeds its byte ceiling");
    }
    yield line;
    start = index + 1;
  }
}

export function assertBoundedObservationCount(count, maximum, label) {
  if (count > maximum) scanLimit(`${label} exceeds its observation ceiling`);
}

export function lastNonemptyBoundedTestOutputLine(output) {
  let last = "";
  for (const line of boundedTestOutputLines(output)) {
    if (line.length > 0) last = line;
  }
  return last;
}
