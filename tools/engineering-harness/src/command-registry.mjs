import { types as utilTypes } from "node:util";

import {
  engineeringTaskRegistry,
  harnessCreateExactV2Profile,
} from "./task-profile.mjs";

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

const DORMANT_TASK_V2_ACTIONS = Object.freeze(["preflight", "run", "replay"]);
const DORMANT_TASK_V2_COMMAND_KEYS = Object.freeze([
  "id",
  "usage",
  "taskId",
  "taskSlug",
  "action",
  "contractSchemaVersion",
  "executionGate",
  "registrationMode",
  "productAuthority",
]);
const DORMANT_TASK_V2_NAMESPACE = "dormant";
const DORMANT_TASK_V2_NAMESPACE_CEILING = 16;
const DORMANT_TASK_V2_IDENTIFIER_CEILING = 192;
const DORMANT_TASK_V2_USAGE_CEILING = 256;
const DORMANT_TASK_V2_TASK_CEILING = 128;
const DORMANT_TASK_V2_ACTION_CEILING = 16;

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

function dormantTaskV2Command(profile, action) {
  return Object.freeze({
    id: `${DORMANT_TASK_V2_NAMESPACE}.${profile.slug}.${action}`,
    usage: `${DORMANT_TASK_V2_NAMESPACE} ${profile.slug} ${TASK_ACTION_USAGE[action]}`,
    taskId: profile.id,
    taskSlug: profile.slug,
    action,
    contractSchemaVersion: profile.taskSchemaVersion,
    executionGate: profile.executionGate,
    registrationMode: profile.registrationMode,
    productAuthority: profile.productAuthority,
  });
}

function expectedDormantTaskV2Commands() {
  return DORMANT_TASK_V2_ACTIONS.map((action) =>
    dormantTaskV2Command(harnessCreateExactV2Profile, action),
  );
}

function snapshotDormantTaskV2CommandArray(value) {
  let descriptors;
  try {
    if (
      utilTypes.isProxy(value) ||
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      throw new Error("invalid dormant command array");
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(
      "dormant engineering task v2 command registry must be a plain dense array",
    );
  }

  const lengthDescriptor = descriptors.length;
  const length =
    lengthDescriptor !== undefined && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (length !== DORMANT_TASK_V2_ACTIONS.length) {
    throw new Error(
      "dormant engineering task v2 command registry must contain exactly three commands",
    );
  }
  const expectedKeys = ["0", "1", "2", "length"];
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key, index) => typeof key !== "string" || key !== expectedKeys[index],
    )
  ) {
    throw new Error(
      "dormant engineering task v2 command registry must be a plain dense array",
    );
  }

  return expectedKeys.slice(0, -1).map((key) => {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error(
        "dormant engineering task v2 command registry must be a plain dense array",
      );
    }
    return descriptor.value;
  });
}

function snapshotDormantTaskV2Command(value) {
  let descriptors;
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      throw new Error("invalid dormant command record");
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(
      "dormant engineering task v2 command must be an exact plain own-data record",
    );
  }

  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== DORMANT_TASK_V2_COMMAND_KEYS.length ||
    actualKeys.some(
      (key, index) =>
        typeof key !== "string" || key !== DORMANT_TASK_V2_COMMAND_KEYS[index],
    ) ||
    DORMANT_TASK_V2_COMMAND_KEYS.some((key) => {
      const descriptor = descriptors[key];
      return !(
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true
      );
    })
  ) {
    throw new Error(
      "dormant engineering task v2 command must be an exact plain own-data record",
    );
  }

  return Object.fromEntries(
    DORMANT_TASK_V2_COMMAND_KEYS.map((key) => [key, descriptors[key].value]),
  );
}

function boundedDormantTaskV2Command(entry) {
  return (
    typeof entry.id === "string" &&
    entry.id.length <= DORMANT_TASK_V2_IDENTIFIER_CEILING &&
    typeof entry.usage === "string" &&
    entry.usage.length <= DORMANT_TASK_V2_USAGE_CEILING &&
    typeof entry.taskId === "string" &&
    entry.taskId.length <= DORMANT_TASK_V2_TASK_CEILING &&
    typeof entry.taskSlug === "string" &&
    entry.taskSlug.length <= DORMANT_TASK_V2_TASK_CEILING &&
    typeof entry.action === "string" &&
    entry.action.length <= DORMANT_TASK_V2_ACTION_CEILING &&
    Number.isSafeInteger(entry.contractSchemaVersion) &&
    typeof entry.executionGate === "string" &&
    entry.executionGate.length <= DORMANT_TASK_V2_TASK_CEILING &&
    typeof entry.registrationMode === "string" &&
    entry.registrationMode.length <= DORMANT_TASK_V2_TASK_CEILING &&
    typeof entry.productAuthority === "boolean"
  );
}

export function validateDormantTaskV2CommandRegistry(value) {
  const commands = snapshotDormantTaskV2CommandArray(value);
  const expected = expectedDormantTaskV2Commands();
  for (const [index, value] of commands.entries()) {
    const command = snapshotDormantTaskV2Command(value);
    if (!boundedDormantTaskV2Command(command)) {
      throw new Error(
        "dormant engineering task v2 command exceeds its bounded literal shape",
      );
    }
    const canonical = expected[index];
    if (
      DORMANT_TASK_V2_COMMAND_KEYS.some(
        (key) => command[key] !== canonical[key],
      )
    ) {
      throw new Error(
        `dormant engineering task v2 command ${index} is not canonical`,
      );
    }
  }
  return true;
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

const dormantTaskV2Commands = expectedDormantTaskV2Commands();
validateDormantTaskV2CommandRegistry(dormantTaskV2Commands);

export const DORMANT_TASK_V2_COMMANDS = Object.freeze(dormantTaskV2Commands);

const dormantTaskV2CommandBySelection = new Map(
  DORMANT_TASK_V2_COMMANDS.map((entry) => [
    `${entry.taskSlug}\0${entry.action}`,
    entry,
  ]),
);

export function dormantTaskV2CommandIds() {
  return DORMANT_TASK_V2_COMMANDS.map(({ id }) => id);
}

export function resolveDormantTaskV2Command(namespace, slug, action) {
  if (
    typeof namespace !== "string" ||
    namespace.length > DORMANT_TASK_V2_NAMESPACE_CEILING ||
    namespace !== DORMANT_TASK_V2_NAMESPACE ||
    typeof slug !== "string" ||
    slug.length > DORMANT_TASK_V2_TASK_CEILING ||
    typeof action !== "string" ||
    action.length > DORMANT_TASK_V2_ACTION_CEILING
  ) {
    return null;
  }
  return dormantTaskV2CommandBySelection.get(`${slug}\0${action}`) ?? null;
}
