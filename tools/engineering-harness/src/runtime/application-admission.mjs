import {
  applicationReceiptQualityOutcomes,
  verifyApplicationReceipt,
  verifyApplicationReceiptOutcome,
} from "../receipts/application.mjs";
import { canonicalJson } from "../routing/features.mjs";
import { createDirectApplicationAdmissionAuthority } from "../routing/history.mjs";

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function providerModels(contract) {
  return Object.freeze(
    Object.fromEntries(
      contract.routing.providers.map(({ provider, model, transport }) => {
        if (transport !== "native" || !["codex", "claude"].includes(provider)) {
          throw new Error("application admission requires both native provider declarations");
        }
        return [provider, model];
      }),
    ),
  );
}

function expectedContract(contract, contractSha256) {
  return Object.freeze({
    sha256: contractSha256,
    baseline: Object.freeze({ ...contract.baseline }),
    evaluator: Object.freeze({
      commit: contract.evaluator.commit,
      tree: contract.evaluator.tree,
      patchSha256: contract.evaluator.patchSha256,
    }),
    success: Object.freeze({ ...contract.success }),
  });
}

function nativeHosts(control) {
  if (!Array.isArray(control?.nativeHosts) || control.nativeHosts.length !== 2) {
    throw new Error("application admission requires the frozen native host set");
  }
  const hosts = new Map();
  for (const host of control.nativeHosts) {
    if (
      !["codex", "claude"].includes(host?.provider) ||
      host.available !== true ||
      host.interfaceValid !== true ||
      typeof host.executablePath !== "string" ||
      !/^[0-9a-f]{64}$/u.test(host.executableSha256 ?? "") ||
      hosts.has(host.provider)
    ) {
      throw new Error("application admission received an invalid native host identity");
    }
    hosts.set(host.provider, host);
  }
  if (!["codex", "claude"].every((provider) => hosts.has(provider))) {
    throw new Error("application admission requires Codex and Claude host identities");
  }
  return hosts;
}

/**
 * Replays a receipt and binds it to the current, clean preflight control plane.
 * This is deliberately stronger than the owner-independent receipt verifier:
 * it is the production capability-minting boundary.
 */
export function verifyPinnedApplicationReceipt(receiptOrBytes, preflight) {
  const verification = verifyApplicationReceipt(receiptOrBytes);
  if (!verification.ok) {
    throw new Error(`invalid application receipt: ${verification.reason}`);
  }
  const { receipt } = verification;
  const models = providerModels(preflight.contract);
  const contract = expectedContract(preflight.contract, preflight.contractSha256);
  if (
    receipt.control.harnessSha256 !== preflight.control.harnessSha256 ||
    !same(receipt.control.providerModels, models) ||
    !same(receipt.contract, contract)
  ) {
    throw new Error("application receipt does not bind the current preflight control plane");
  }

  const hosts = nativeHosts(preflight.control);
  for (const invocation of receipt.nativeInvocations) {
    if (invocation.status === "ERROR") continue;
    const host = hosts.get(invocation.provider);
    if (
      invocation.executable !== host.executablePath ||
      invocation.executableAttestation.provider !== invocation.provider ||
      invocation.executableAttestation.path !== host.executablePath ||
      invocation.executableAttestation.sha256 !== host.executableSha256
    ) {
      throw new Error(
        `application receipt changes the current ${invocation.provider} executable identity`,
      );
    }
  }
  return verification;
}

/**
 * Atomically admits every quality-bearing outcome authorized by one persisted
 * receipt. Exact replay is idempotent; a conflicting history remains rejected.
 */
export async function admitApplicationReceipt({ receiptBytes, preflight, history }) {
  if (typeof history?.appendBatch !== "function") {
    throw new Error("application admission requires an atomic RouterHistory");
  }
  const verification = verifyPinnedApplicationReceipt(receiptBytes, preflight);
  const targets = applicationReceiptQualityOutcomes(receiptBytes);
  if (targets.length === 0) {
    return Object.freeze({
      receiptSha256: verification.receiptSha256,
      outcomeCount: 0,
      entries: Object.freeze([]),
    });
  }
  const authority = createDirectApplicationAdmissionAuthority({
    verifyDirectApplication: async ({ bindingSha256, verifierReceipt, binding }) => {
      const current = verifyPinnedApplicationReceipt(verifierReceipt, preflight);
      if (current.receiptSha256 !== verification.receiptSha256) {
        throw new Error("application admission receipt changed while minting capabilities");
      }
      const direct = verifyApplicationReceiptOutcome(verifierReceipt, binding.outcome);
      return Object.freeze({
        verified: direct.verified === true && direct.bindingSha256 === bindingSha256,
        bindingSha256,
      });
    },
  });
  const outcomes = targets.map(({ outcome }) => outcome);
  const capabilities = [];
  for (const outcome of outcomes) {
    capabilities.push(await authority.verifyAndMint(outcome, receiptBytes));
  }
  const entries = await history.appendBatch(outcomes, capabilities);
  if (
    entries.length !== outcomes.length ||
    entries.some((entry, index) => !same(entry.outcome, outcomes[index]))
  ) {
    throw new Error("RouterHistory did not return the exact admitted outcome batch");
  }
  return Object.freeze({
    receiptSha256: verification.receiptSha256,
    outcomeCount: outcomes.length,
    entries,
  });
}
