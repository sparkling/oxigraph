import { engineeringTaskRegistry } from "./task-profile.mjs";

function command(value) {
  return Object.freeze(value);
}

function taskCommand(profile, action) {
  const suffix = {
    preflight: "preflight",
    run: "run [--run-id <safe-id>]",
    replay: "replay --receipt <runtime-name>",
  }[action];
  return command({
    id: `${profile.slug}.${action}`,
    usage: `${profile.slug} ${suffix}`,
    taskId: profile.id,
    taskSlug: profile.slug,
    action,
  });
}

export const COMMANDS = Object.freeze([
  command({ id: "doctor", usage: "doctor" }),
  ...engineeringTaskRegistry.map((profile) => taskCommand(profile, "preflight")),
  ...engineeringTaskRegistry.flatMap((profile) => [
    taskCommand(profile, "run"),
    taskCommand(profile, "replay"),
  ]),
  command({
    id: "receipt.verify",
    usage: "receipt verify --receipt <runtime-name>",
  }),
  command({ id: "history.inspect", usage: "history inspect" }),
  command({
    id: "factory.diagnose",
    usage: "factory diagnose --claude <outside-path> --codex <outside-path>",
  }),
  command({ id: "help", usage: "help" }),
  command({ id: "version", usage: "version" }),
]);

export function commandIds() {
  return COMMANDS.map(({ id }) => id);
}
