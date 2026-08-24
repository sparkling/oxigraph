export const COMMANDS = Object.freeze([
  Object.freeze({ id: "doctor", usage: "doctor" }),
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
