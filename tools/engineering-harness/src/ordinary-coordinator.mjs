import { spawnSync } from "node:child_process";
import { repository, sourceObservation } from "./delivery.mjs";

export const coordinatorPrompt = `Read AGENTS.md, docs/adr/0049-upstream-first-parallel-hybrid-delivery.md and tools/engineering-harness/README.md.
Act as outer native coordinator only for current user-authorized work. Launch is not programme-resumption authority. Respect paused goals, historical WIP, protected qualification and publication boundaries. Create goals only when requested.
Refresh accepted frontier, source revision and live project MCP task/control evidence. Plan independent dependency-ready outcomes with disjoint mutation paths, complete read dependencies and named resources. Do not invent filler work or reopen accepted outcomes.
Use node tools/engineering-harness/bin/oxigraph-delivery.mjs batch --spec FILE.json for compatible ready sets. Existing runOrdinaryBatch/runBoundedPool and isolated workflows execute lanes; do not replace scheduler, routing or learning. Preserve configured native gpt-6.1-sol/high ordinary planning/author/documentation/fresh review, Opus repair and stronger explicit task pins. Historical routes and receipts remain unchanged.
Service native-worker and root-apply bridge requests by runId plus requestId. Launch Claude workers with nativeChildEnvironment("claude") from tools/engineering-harness/src/native/environment.mjs: this preserves configured transport and CLAUDE_CODE_MAX_OUTPUT_TOKENS (default requested ceiling 128000, valid operator override retained; client/model clamp applies). Never substitute the generic scrubbed tool environment. Root-apply writes only the exact isolated candidate root. Root alone writes canonical main; no branches or additional Git worktrees.
Inspect lane-settled events immediately, verify receipt hashes and review completed evidence while siblings run. Fulfilled means pending-owner-acceptance, never accepted dependency source. Failed/cancelled lanes retain custody; queued cancellations appear in final batch output.
Before canonical integration, confirm the completed lane's external native/root actions stopped. Do not wait for unrelated snapshot-bound siblings. Invoke assertOwnerActionIndependent from this module with the exact integration paths/resources and complete held-lane custody across every live batch. Reads confined to frozen candidate snapshots do not conflict with canonical writes; canonical supplemental reads and shared dependencies do. Unknown reads/actions retain the hold. This owner-invoked assertion checks conflicts, not acceptance or filesystem isolation. Revalidate every candidate source/read/evaluator input against current main and previously integrated siblings. Disjoint writes alone do not establish independence. Repair/re-run stale candidates; never weaken source guards.
Integrate reviewed, deterministically green candidates serially; run affected canonical checks/build, commit accepted slices and update exact task/control evidence. Release dependants only after accepted parent source reaches main; create fresh snapshots from accepted main, never sibling candidates.
After acceptance or failed lanes, reassess the whole authorized frontier and refill through the same batch entrypoint while unrelated siblings run; previous batch size is not a ceiling. Invoke assertOwnerActionIndependent for new lanes against complete held custody before dispatch. Upstream pool refills queued independent entries. Coordinator owns cross-batch conflicts and custody; unconfirmed external actions keep ownership. Never integrate inside awaited onSettled reporting.
Status or handoff answers do not pause an authorized programme: keep servicing the existing bridge, settled results and ready frontier. Explicit user pause wins. If host action is required, report that blocker and required action; never label an unserviced or stopped loop active.
Measure effective CPU, interval usage and memory/I/O pressure before heavy checks, every 30 seconds and at refill. Allocate private Cargo targets, DBs and ports; no fixed model-session cap. Preserve native memory/learning and exact native errors, never transport fallback.
Verify actual worker/check activity, not prompt delivery or empty dispatch. Report accepted outcomes separately from candidates, WIP and blockers. Harness repairs are direct scoped work, never self-repair dispatch.`;

const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const pathsValid = (paths) => Array.isArray(paths) && paths.every(path => typeof path === "string" &&
  path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") &&
  path.split("/").every(part => part && part !== "." && part !== ".."));
const resourcesValid = (resources) => Array.isArray(resources) && resources.every(value =>
  typeof value === "string" && value.trim().length > 0);

// Stateless owner check, not a scheduler, custody registry, or acceptance receipt.
// Owner includes retained cancelled/failed lanes and all live external actions.
export function assertOwnerActionIndependent(action, held) {
  if (!action || !pathsValid(action.paths) || !resourcesValid(action.resources) || !Array.isArray(held)) {
    throw new Error("Owner action requires exact paths, resources and complete held custody");
  }
  for (const lane of held) {
    if (!lane || lane.custodyComplete !== true || !["snapshot-bound", "stopped"].includes(lane.externalActions) ||
        !pathsValid(lane.paths) || !pathsValid(lane.canonicalReads) || !resourcesValid(lane.resources)) {
      throw new Error("Owner action blocked by unknown read/external-action custody");
    }
    if (action.paths.some(path => [...lane.paths, ...lane.canonicalReads].some(other => overlaps(path, other))) ||
        action.resources.some(resource => lane.resources.includes(resource))) {
      throw new Error("Owner action ownership conflict");
    }
  }
}

export function coordinatorLaunch(session) {
  if (typeof session !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(session)) {
    throw new Error("Coordinator requires an existing resume UUID; no new session or model fallback");
  }
  return { classification: "coordinator-launch-preview", executionStarted: false,
    executable: "codex", cwd: repository, model: "gpt-6-astra", effort: "medium",
    args: ["resume", session, "--yolo", "--model", "gpt-6-astra", "--config",
      'model_reasoning_effort="medium"', "--config", 'plan_mode_reasoning_effort="medium"', coordinatorPrompt],
    notChecked: ["resume UUID existence", "exclusive integration ownership", "native model availability"],
    startCondition: "Explicit --start true after confirming no other session writer and current execution authority" };
}

export function startCoordinator(session, { observe = sourceObservation, spawn = spawnSync } = {}) {
  const launch = coordinatorLaunch(session);
  observe(); // Canonical-main guard; preserve dirty WIP for coordinator inspection.
  // Inherit configured native subscription transport and permission environment.
  const result = spawn(launch.executable, launch.args, { cwd: launch.cwd, stdio: "inherit" });
  if (result.error) throw new Error(`codex gpt-6-astra: ${result.error.message}`, { cause: result.error });
  return result.status ?? 1;
}
