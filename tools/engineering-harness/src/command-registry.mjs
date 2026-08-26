import { engineeringTaskRegistry } from "./task-profile.mjs";

const STATIC_COMMANDS = Object.freeze([
  Object.freeze({ id: "doctor", usage: "doctor" }),
]);

const TRAILING_COMMANDS = Object.freeze([
  Object.freeze({
    id: "receipt.verify",
    usage: "receipt verify --receipt <runtime-name>",
  }),
  Object.freeze({ id: "history.inspect", usage: "history inspect" }),
  Object.freeze({
    id: "factory.diagnose",
    usage: "factory diagnose --claude <outside-path> --codex <outside-path>",
  }),
  Object.freeze({ id: "help", usage: "help" }),
  Object.freeze({ id: "version", usage: "version" }),
]);

const TASK_ACTION_USAGE = Object.freeze({
  preflight: "preflight",
  run: "run [--run-id <safe-id>]",
  replay: "replay --receipt <runtime-name>",
});

function command(id, usage) {
  return Object.freeze({ id, usage });
}

function taskCommand(profile, action) {
  return command(
    `${profile.slug}.${action}`,
    `${profile.slug} ${TASK_ACTION_USAGE[action]}`,
  );
}

function expectedCommands() {
  return [
    ...STATIC_COMMANDS,
    ...engineeringTaskRegistry.map((profile) =>
      taskCommand(profile, "preflight"),
    ),
    ...engineeringTaskRegistry.flatMap((profile) => [
      taskCommand(profile, "run"),
      taskCommand(profile, "replay"),
    ]),
    ...TRAILING_COMMANDS,
  ];
}

function assertCanonicalCommand(entry, index) {
  const keys = entry !== null && typeof entry === "object"
    ? Reflect.ownKeys(entry)
    : [];
  if (
    keys.length !== 2 ||
    keys[0] !== "id" ||
    keys[1] !== "usage"
  ) {
    throw new Error(`command ${index} must contain exactly {id, usage}`);
  }
  if (
    typeof entry.id !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(entry.id)
  ) {
    throw new Error(`command ${index} has a non-canonical id`);
  }
  if (
    typeof entry.usage !== "string" ||
    entry.usage.length === 0 ||
    entry.usage !== entry.usage.trim() ||
    /[\0\r\n\\/]/u.test(entry.usage)
  ) {
    throw new Error(`command ${entry.id} has a non-canonical usage`);
  }
}

export function validateCommandRegistry(commands) {
  if (!Array.isArray(commands)) {
    throw new Error("command registry must be an array");
  }

  const expected = expectedCommands();
  if (commands.length !== expected.length) {
    throw new Error(
      `command registry must contain exactly ${expected.length} commands`,
    );
  }

  const ids = new Set();
  const usages = new Set();
  for (const [index, entry] of commands.entries()) {
    assertCanonicalCommand(entry, index);
    if (ids.has(entry.id)) {
      throw new Error(`duplicate command id: ${entry.id}`);
    }
    if (usages.has(entry.usage)) {
      throw new Error(`duplicate command usage: ${entry.usage}`);
    }
    ids.add(entry.id);
    usages.add(entry.usage);

    const canonical = expected[index];
    if (entry.id !== canonical.id || entry.usage !== canonical.usage) {
      throw new Error(
        `command ${index} must be ${canonical.id}: ${canonical.usage}`,
      );
    }
  }
  return true;
}

const commands = expectedCommands();
validateCommandRegistry(commands);

export const COMMANDS = Object.freeze(commands);

export function commandIds() {
  return COMMANDS.map(({ id }) => id);
}
