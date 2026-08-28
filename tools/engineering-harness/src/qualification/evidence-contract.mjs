export const G17_COMPATIBILITY_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-compatibility-evidence/v4";

export const G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS = Object.freeze([
  "oxigraph.g1.7-compatibility-evidence/v2",
  "oxigraph.g1.7-compatibility-evidence/v3",
]);

export const G17_SEMANTIC_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-semantic-evidence/v2";

export function g17EvidenceSchemaState(entry, currentSchema) {
  if (entry?.status !== "PASS") return "NOT_APPLICABLE";
  if (entry.projection?.schema === currentSchema) {
    return "CURRENT_SCHEMA_UNREPLAYED";
  }
  if (
    entry.projection?.schema === undefined ||
    (currentSchema === G17_COMPATIBILITY_EVIDENCE_SCHEMA &&
      G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS.includes(
        entry.projection?.schema,
      ))
  ) {
    return "LEGACY_REPLAY_ONLY";
  }
  return "UNSUPPORTED_SCHEMA";
}
