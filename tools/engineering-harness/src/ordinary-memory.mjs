import { mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, linkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Router } from "@metaharness/router";
import { canonicalSha256 } from "./routing/features.mjs";

const digestPattern = /^[a-f0-9]{64}$/;
const routeId = (route) => `${route.model}/${route.effort}`;
const embedding = (digest) => Array.from(Buffer.from(digest, "hex").subarray(0, 16), (byte) => (byte + 1) / 256);

function publish(directory, record) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${record.runId}.json`), temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
  try { linkSync(temporary, path); } finally { unlinkSync(temporary); }
  return path;
}

function captureDelta(record) {
  if (record?.schema !== "oxigraph.ordinary-native-outcomes/v1" || record.transport !== "native-only" ||
      !/^[a-zA-Z0-9-]+$/.test(record.runId ?? "") || !digestPattern.test(record.binding ?? "") ||
      !Array.isArray(record.observations) || record.observations.length === 0 ||
      !digestPattern.test(record.digest ?? "")) throw new Error("Invalid ordinary native outcome delta");
  const { digest, ...body } = record;
  if (canonicalSha256(body) !== digest) throw new Error("Ordinary native outcome digest mismatch");
  for (const observation of record.observations) {
    if (!digestPattern.test(observation.inputDigest ?? "") || !digestPattern.test(observation.evidenceDigest ?? "") ||
        ![0, 1].includes(observation.quality) || typeof observation.model !== "string" ||
        !/^(cc\/claude-|gpt-)/.test(observation.model) || typeof observation.effort !== "string" ||
        !["implement", "repair"].includes(observation.role) || typeof observation.controlled !== "boolean") throw new Error("Invalid ordinary native observation");
  }
  return record;
}

/** Immutable per-run files; only the caller-owned reduction reads the complete ready set. */
export function ordinaryMemory(directory, binding) {
  if (!digestPattern.test(binding)) throw new Error("Ordinary memory needs exact evaluator/runtime binding");
  const load = () => {
    let names;
    try { names = readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const records = names.map((name) => {
      const path = join(directory, name);
      if (!lstatSync(path).isFile()) throw new Error("Ordinary native outcomes require regular files");
      const record = captureDelta(JSON.parse(readFileSync(path, "utf8")));
      if (name !== `${record.runId}.json`) throw new Error("Ordinary native outcome identity mismatch");
      return record;
    });
    return records.filter((record) => record.binding === binding).flatMap((record) => record.observations);
  };
  const observations = load();
  return {
    summary: () => ({ binding, observations: observations.length,
      accepted: observations.filter((item) => item.quality === 1).length,
      rejected: observations.filter((item) => item.quality === 0).length,
      attribution: "deterministic-check-and-independent-review;native-only", hybridTraining: false }),
    select(defaultRoute, candidates, inputDigest, role = "implement") {
      const allowed = new Set(candidates.map(routeId));
      const relevant = observations.filter((item) => item.controlled && item.role === role && allowed.has(routeId(item)));
      const inputs = new Map();
      for (const item of relevant) {
        const members = inputs.get(item.inputDigest) ?? new Set();
        members.add(routeId(item)); inputs.set(item.inputDigest, members);
      }
      // Separate ordinary observations are never relabelled as controlled pairs.
      // Only actually identical inputs observed across every eligible route qualify.
      const comparable = new Set([...inputs].filter(([, members]) => members.size === allowed.size).map(([id]) => id));
      if (comparable.size < 5) return { ...defaultRoute, memorySelection: "cold-start" };
      const router = new Router({ candidates: candidates.map((route) => ({
        id: routeId(route), costPerMTok: 0,
        examples: relevant.filter((item) => routeId(item) === routeId(route) && comparable.has(item.inputDigest))
          .map((item) => ({ embedding: embedding(item.inputDigest), quality: item.quality })),
      })) });
      const choice = router.route(embedding(inputDigest));
      if (choice.predictedQuality < 1) return { ...defaultRoute, memorySelection: "quality-floor-bootstrap" };
      return { ...candidates.find((route) => routeId(route) === choice.id), memorySelection: "upstream-router-quality",
        predictedQuality: choice.predictedQuality };
    },
    record(runId, entries, { hybrid = false, interrupted = false } = {}) {
      if (hybrid || interrupted || !entries.length) return { recorded: false, reason: hybrid ? "hybrid-excluded" : "no-attributable-native-outcomes" };
      const body = { schema: "oxigraph.ordinary-native-outcomes/v1", runId, binding,
        transport: "native-only", observations: structuredClone(entries).map((item) => ({ ...item, controlled: false })) };
      const record = captureDelta({ ...body, digest: canonicalSha256(body) });
      const path = publish(directory, record);
      return { recorded: true, path, digest: record.digest, observations: entries.length };
    },
    async compare(runId, packet, candidates, evaluate) {
      if (!packet || !["implement", "repair"].includes(packet.role) || typeof packet.prompt !== "string" ||
          !digestPattern.test(packet.sourceDigest ?? "") || !digestPattern.test(packet.policyDigest ?? "") ||
          candidates.length < 2 || new Set(candidates.map(routeId)).size !== candidates.length ||
          candidates.some((route) => route.transport !== "native-subscription")) throw new Error("Invalid controlled native comparison");
      const inputDigest = canonicalSha256(packet);
      const entries = [];
      for (const route of candidates) {
        const result = await evaluate(structuredClone(packet), structuredClone(route));
        if (result?.inputDigest !== inputDigest || result.model !== route.model || result.effort !== route.effort ||
            ![0, 1].includes(result.quality) || !digestPattern.test(result.evidenceDigest ?? "")) {
          throw new Error("Controlled native comparison evaluator binding mismatch");
        }
        entries.push({ inputDigest, role: packet.role, model: route.model, effort: route.effort,
          quality: result.quality, evidenceDigest: result.evidenceDigest, controlled: true });
      }
      const body = { schema: "oxigraph.ordinary-native-outcomes/v1", runId, binding,
        transport: "native-only", observations: entries };
      const record = captureDelta({ ...body, digest: canonicalSha256(body) });
      publish(directory, record);
      return { digest: record.digest, observations: entries.length };
    },
  };
}
