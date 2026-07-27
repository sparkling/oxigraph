const LAB_KEYS = [
  "outcomes",
  "total_mutants",
  "missed",
  "caught",
  "timeout",
  "unviable",
  "success",
  "start_time",
  "end_time",
  "cargo_mutants_version",
];
const OUTCOME_KEYS = [
  "scenario",
  "summary",
  "log_path",
  "diff_path",
  "phase_results",
];
const PHASE_KEYS = ["phase", "duration", "process_status", "argv"];
const MUTANT_KEYS = [
  "name",
  "package",
  "file",
  "function",
  "span",
  "replacement",
  "genre",
];
const INVENTORY_KEYS = ["diff", ...MUTANT_KEYS];
const GENRES = new Set([
  "FnValue",
  "BinaryOperator",
  "UnaryOperator",
  "MatchArm",
  "MatchArmGuard",
  "StructField",
]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeySet(value, keys) {
  return (
    plainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `cargo-mutants outcome field ${field} must be a nonnegative integer`,
    );
  }
  return value;
}

function validPortableRelativePath(value, prefix, suffix) {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.endsWith(suffix) &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function validatePosition(value, label) {
  if (
    !hasExactKeySet(value, ["line", "column"]) ||
    !Number.isSafeInteger(value.line) ||
    value.line < 1 ||
    !Number.isSafeInteger(value.column) ||
    value.column < 1
  ) {
    throw new Error(`cargo-mutants ${label} is invalid`);
  }
}

function validateSpan(value, label) {
  if (!hasExactKeySet(value, ["start", "end"])) {
    throw new Error(`cargo-mutants ${label} has an invalid span`);
  }
  validatePosition(value.start, `${label} start`);
  validatePosition(value.end, `${label} end`);
  if (
    value.end.line < value.start.line ||
    (value.end.line === value.start.line &&
      value.end.column < value.start.column)
  ) {
    throw new Error(`cargo-mutants ${label} has a reversed span`);
  }
}

function validateFunction(value) {
  if (value === null) return;
  if (
    !hasExactKeySet(value, ["function_name", "return_type", "span"]) ||
    typeof value.function_name !== "string" ||
    value.function_name.length === 0 ||
    typeof value.return_type !== "string"
  ) {
    throw new Error("cargo-mutants function record is invalid");
  }
  validateSpan(value.span, "function");
}

function validateMutant(value, { inventory = false } = {}) {
  const keys = inventory ? INVENTORY_KEYS : MUTANT_KEYS;
  if (
    !hasExactKeySet(value, keys) ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.package !== "oxdatalog" ||
    !validPortableRelativePath(value.file, "lib/oxdatalog/src/", ".rs") ||
    typeof value.replacement !== "string" ||
    !GENRES.has(value.genre)
  ) {
    throw new Error("cargo-mutants Mutant record is invalid");
  }
  validateFunction(value.function);
  validateSpan(value.span, "mutant");
  if (
    !value.name.startsWith(
      `${value.file}:${value.span.start.line}:${value.span.start.column}: `,
    )
  ) {
    throw new Error("cargo-mutants Mutant name does not match its span");
  }
  if (inventory && (typeof value.diff !== "string" || value.diff.length === 0)) {
    throw new Error("cargo-mutants inventory Mutant has no diff");
  }
}

function inventoryMutant(value) {
  const {
    diff: _diff,
    file,
    function: fn,
    genre,
    name,
    package: packageName,
    replacement,
    span,
  } = value;
  return {
    name,
    package: packageName,
    file,
    function: fn,
    span,
    replacement,
    genre,
  };
}

export function validateMutantInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    throw new Error("cargo-mutants inventory must be a nonempty array");
  }
  const identities = new Set();
  for (const mutant of inventory) {
    validateMutant(mutant, { inventory: true });
    const identity = canonicalJson(inventoryMutant(mutant));
    if (identities.has(identity)) {
      throw new Error("duplicate Mutant in cargo-mutants inventory");
    }
    identities.add(identity);
  }
  return inventory.map(inventoryMutant);
}

export function canonicalMutationInventory(inventory) {
  validateMutantInventory(inventory);
  return inventory.map(canonicalJson).sort();
}

export function strictNativeTimestampMs(value, field = "timestamp") {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  ) {
    throw new Error(`cargo-mutants ${field} is not canonical UTC RFC3339`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`cargo-mutants ${field} is invalid`);
  }
  const expectedPrefix = value.replace(/(?:\.(\d{1,9}))?Z$/, (_match, fraction) => {
    const millis = (fraction ?? "").padEnd(3, "0").slice(0, 3);
    return `.${millis}Z`;
  });
  if (new Date(milliseconds).toISOString() !== expectedPrefix) {
    throw new Error(`cargo-mutants ${field} is not a real calendar timestamp`);
  }
  return milliseconds;
}

function processStatus(value) {
  if (["Success", "Timeout", "Other"].includes(value)) return value;
  if (
    hasExactKeySet(value, ["Failure"]) &&
    Number.isSafeInteger(value.Failure) &&
    value.Failure !== 0
  ) {
    return "Failure";
  }
  if (
    hasExactKeySet(value, ["Signalled"]) &&
    Number.isSafeInteger(value.Signalled) &&
    value.Signalled > 0
  ) {
    return "Signalled";
  }
  throw new Error("cargo-mutants phase process_status is invalid");
}

function validateCargoArgv(argv, phase, cargoPath) {
  if (
    !Array.isArray(argv) ||
    argv.some((argument) => typeof argument !== "string" || argument.length === 0)
  ) {
    throw new Error("cargo-mutants phase argv is invalid");
  }
  const packageArgument = argv.find((argument) =>
    argument.startsWith("--package="),
  );
  const expected =
    phase === "Build"
      ? [
          cargoPath,
          "test",
          "--no-run",
          "--verbose",
          packageArgument,
          "--all-features",
        ]
      : [
          cargoPath,
          "test",
          "--verbose",
          packageArgument,
          "--all-features",
          "--all-targets",
        ];
  if (
    !/^--package=oxdatalog@[^@\s]+$/.test(packageArgument ?? "") ||
    JSON.stringify(argv) !== JSON.stringify(expected)
  ) {
    throw new Error(`cargo-mutants ${phase} argv does not run the reviewed suite`);
  }
}

function validatePhase(value, cargoPath) {
  if (
    !hasExactKeySet(value, PHASE_KEYS) ||
    !["Build", "Test"].includes(value.phase) ||
    !Number.isFinite(value.duration) ||
    value.duration < 0
  ) {
    throw new Error("cargo-mutants phase result is invalid");
  }
  validateCargoArgv(value.argv, value.phase, cargoPath);
  return processStatus(value.process_status);
}

function validateScenarioPhases(outcome, cargoPath) {
  if (!Array.isArray(outcome.phase_results) || outcome.phase_results.length < 1) {
    throw new Error("cargo-mutants scenario has no phase results");
  }
  const phases = outcome.phase_results.map((phase) => ({
    phase: phase?.phase,
    status: validatePhase(phase, cargoPath),
  }));
  const signature = phases.map(({ phase, status }) => `${phase}:${status}`).join(",");
  const expected = {
    Success: "Build:Success,Test:Success",
    CaughtMutant: "Build:Success,Test:Failure",
    MissedMutant: "Build:Success,Test:Success",
    Unviable: "Build:Failure",
  }[outcome.summary];
  const timeoutSignatures = new Set([
    "Build:Timeout",
    "Build:Success,Test:Timeout",
  ]);
  if (
    (outcome.summary === "Timeout" && !timeoutSignatures.has(signature)) ||
    (outcome.summary !== "Timeout" && signature !== expected)
  ) {
    throw new Error(
      `cargo-mutants ${outcome.summary} phase results are inconsistent`,
    );
  }
}

function validateOutcomeShape(outcome, cargoPath) {
  if (
    !hasExactKeySet(outcome, OUTCOME_KEYS) ||
    typeof outcome.summary !== "string" ||
    !validPortableRelativePath(outcome.log_path, "log/", ".log")
  ) {
    throw new Error("cargo-mutants scenario outcome schema is invalid");
  }
  const baseline = outcome.scenario === "Baseline";
  if (
    (baseline &&
      (outcome.log_path !== "log/baseline.log" ||
        outcome.diff_path !== null ||
        outcome.summary !== "Success")) ||
    (!baseline &&
      (!hasExactKeySet(outcome.scenario, ["Mutant"]) ||
        !validPortableRelativePath(outcome.diff_path, "diff/", ".diff")))
  ) {
    throw new Error("cargo-mutants scenario paths or summary are invalid");
  }
  if (!baseline) validateMutant(outcome.scenario.Mutant);
  validateScenarioPhases(outcome, cargoPath);
  return baseline;
}

function compareInventory(inventoryMutants, outcomeMutants) {
  const sorted = (values) => values.map(canonicalJson).sort();
  if (
    JSON.stringify(sorted(inventoryMutants)) !==
    JSON.stringify(sorted(outcomeMutants))
  ) {
    throw new Error("cargo-mutants outcomes do not match mutants.json inventory");
  }
}

export function validateOutcomes(
  outcomes,
  expectedVersion,
  inventory,
  { cargoPath } = {},
) {
  if (
    !hasExactKeySet(outcomes, LAB_KEYS) ||
    outcomes.cargo_mutants_version !== expectedVersion ||
    outcomes.success !== 0 ||
    !Array.isArray(outcomes.outcomes) ||
    typeof cargoPath !== "string" ||
    cargoPath.length === 0
  ) {
    throw new Error("cargo-mutants returned an invalid complete outcome object");
  }
  const startedAt = strictNativeTimestampMs(outcomes.start_time, "start_time");
  const endedAt = strictNativeTimestampMs(outcomes.end_time, "end_time");
  if (endedAt < startedAt) {
    throw new Error("cargo-mutants native timestamps are reversed");
  }
  const generated = nonNegativeInteger(outcomes.total_mutants, "total_mutants");
  const aggregates = {
    CaughtMutant: nonNegativeInteger(outcomes.caught, "caught"),
    MissedMutant: nonNegativeInteger(outcomes.missed, "missed"),
    Timeout: nonNegativeInteger(outcomes.timeout, "timeout"),
    Unviable: nonNegativeInteger(outcomes.unviable, "unviable"),
  };
  const inventoryMutants = validateMutantInventory(inventory);
  const observed = Object.fromEntries(
    Object.keys(aggregates).map((summary) => [summary, 0]),
  );
  const outcomeMutants = [];
  let baselineCount = 0;
  for (const outcome of outcomes.outcomes) {
    const baseline = validateOutcomeShape(outcome, cargoPath);
    if (baseline) {
      baselineCount += 1;
      continue;
    }
    if (!(outcome.summary in observed)) {
      throw new Error(`unknown mutant outcome summary: ${outcome.summary}`);
    }
    observed[outcome.summary] += 1;
    outcomeMutants.push(outcome.scenario.Mutant);
  }
  if (baselineCount !== 1) {
    throw new Error(`expected exactly one baseline outcome, found ${baselineCount}`);
  }
  const aggregateTotal = Object.values(aggregates).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (
    generated < 1 ||
    generated !== aggregateTotal ||
    outcomeMutants.length !== generated ||
    outcomes.outcomes.length !== generated + 1 ||
    inventoryMutants.length !== generated
  ) {
    throw new Error("cargo-mutants outcome and inventory cardinality is inconsistent");
  }
  for (const [summary, count] of Object.entries(aggregates)) {
    if (observed[summary] !== count) {
      throw new Error(
        `${summary} aggregate ${count} does not match ${observed[summary]} outcomes`,
      );
    }
  }
  compareInventory(inventoryMutants, outcomeMutants);
  return {
    baselinePassed: true,
    baselineSummary: "Success",
    generated,
    caught: aggregates.CaughtMutant,
    missed: aggregates.MissedMutant,
    timeout: aggregates.Timeout,
    unviable: aggregates.Unviable,
    startedAt,
    endedAt,
  };
}
