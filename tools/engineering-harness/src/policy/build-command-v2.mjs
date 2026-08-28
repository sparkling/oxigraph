const artifactTargetPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u;
const exactFlags = new Set([
  "--all-features",
  "--locked",
  "--no-default-features",
  "--no-run",
  "--offline",
  "--workspace",
]);
const exactValueOptions = new Set([
  "--bin",
  "--exclude",
  "--features",
  "--package",
  "--test",
  "-F",
  "-p",
]);
const literalOptionValuePattern = /^[A-Za-z0-9][A-Za-z0-9._,+?/-]{0,4095}$/u;

/**
 * Returns the normalized Cargo artifact stems for the only admitted v2 build
 * shape. Cargo maps hyphens in target names to underscores in executable
 * filenames under target/debug/deps.
 * Callers first snapshot argv as a bounded dense array of scalar strings.
 */
export function exactCargoBuildArtifactStemsV2(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length < 5 ||
    argv[0] !== "cargo" ||
    argv[1] !== "test" ||
    argv.includes("--")
  ) {
    return undefined;
  }
  const artifactStems = [];
  const seenFlags = new Set();
  const seenOptionValues = new Set();
  let noRunCount = 0;
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (exactFlags.has(argument)) {
      if (seenFlags.has(argument)) return undefined;
      seenFlags.add(argument);
      if (argument === "--no-run") noRunCount += 1;
      continue;
    }
    if (!exactValueOptions.has(argument)) return undefined;
    const value = argv[index + 1];
    if (
      typeof value !== "string" ||
      !literalOptionValuePattern.test(value) ||
      seenOptionValues.has(`${argument}\0${value}`)
    ) {
      return undefined;
    }
    seenOptionValues.add(`${argument}\0${value}`);
    if (["--bin", "--test"].includes(argument)) {
      if (!artifactTargetPattern.test(value)) return undefined;
      artifactStems.push(value.replaceAll("-", "_"));
    }
    index += 1;
  }
  if (
    noRunCount !== 1 ||
    artifactStems.length === 0 ||
    new Set(artifactStems).size !== artifactStems.length
  ) {
    return undefined;
  }
  for (let left = 0; left < artifactStems.length; left += 1) {
    for (let right = left + 1; right < artifactStems.length; right += 1) {
      if (
        artifactStems[left].startsWith(`${artifactStems[right]}-`) ||
        artifactStems[right].startsWith(`${artifactStems[left]}-`)
      ) {
        return undefined;
      }
    }
  }
  return Object.freeze([...artifactStems]);
}
