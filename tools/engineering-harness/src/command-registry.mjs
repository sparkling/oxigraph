export const COMMANDS = Object.freeze([
  Object.freeze({ id: "doctor", usage: "doctor" }),
  Object.freeze({ id: "g1.2.preflight", usage: "g1.2 preflight" }),
  Object.freeze({ id: "g1.3.preflight", usage: "g1.3 preflight" }),
  Object.freeze({ id: "g1.4.preflight", usage: "g1.4 preflight" }),
  Object.freeze({ id: "g1.5.preflight", usage: "g1.5 preflight" }),
  Object.freeze({ id: "g1.5b.preflight", usage: "g1.5b preflight" }),
  Object.freeze({
    id: "g1.2.run",
    usage: "g1.2 run [--run-id <safe-id>]",
  }),
  Object.freeze({
    id: "g1.2.replay",
    usage: "g1.2 replay --receipt <runtime-name>",
  }),
  Object.freeze({
    id: "g1.3.run",
    usage: "g1.3 run [--run-id <safe-id>]",
  }),
  Object.freeze({
    id: "g1.3.replay",
    usage: "g1.3 replay --receipt <runtime-name>",
  }),
  Object.freeze({
    id: "g1.4.run",
    usage: "g1.4 run [--run-id <safe-id>]",
  }),
  Object.freeze({
    id: "g1.4.replay",
    usage: "g1.4 replay --receipt <runtime-name>",
  }),
  Object.freeze({
    id: "g1.5.run",
    usage: "g1.5 run [--run-id <safe-id>]",
  }),
  Object.freeze({
    id: "g1.5.replay",
    usage: "g1.5 replay --receipt <runtime-name>",
  }),
  Object.freeze({
    id: "g1.5b.run",
    usage: "g1.5b run [--run-id <safe-id>]",
  }),
  Object.freeze({
    id: "g1.5b.replay",
    usage: "g1.5b replay --receipt <runtime-name>",
  }),
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

export function commandIds() {
  return COMMANDS.map(({ id }) => id);
}
