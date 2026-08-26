export const G17_COMPATIBILITY_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-compatibility-evidence/v2";

export const G17_SEMANTIC_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-semantic-evidence/v2";

export function g17EvidenceSchemaState(entry, currentSchema) {
  if (entry?.status !== "PASS") return "NOT_APPLICABLE";
  return entry.projection?.schema === currentSchema
    ? "CURRENT_SCHEMA_UNREPLAYED"
    : "LEGACY_REPLAY_ONLY";
}
