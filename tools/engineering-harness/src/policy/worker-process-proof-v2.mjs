/**
 * Pure coherence check shared by the worker-v2 capture boundary and receipt-v7.
 * Callers first normalize field types and bounded error counts; this function
 * only evaluates the exact relationships between those already-captured facts.
 */
export function evaluateWorkerProcessProofV2(
  value,
  terminationErrorCount,
  processErrorCount,
) {
  const noChildProof =
    value.noChild === true &&
    value.spawned === false &&
    value.reaped === false &&
    value.directChildCleanupSafe === true &&
    value.processGroupQuiescent === true;
  const directReapedProof =
    value.reaped === true &&
    value.spawned === true &&
    value.noChild === false &&
    value.statusAgreement === true &&
    value.exitObserved === true &&
    value.closeObserved === true &&
    value.stdoutEof === true &&
    value.stderrEof === true &&
    value.directChildCleanupSafe === true &&
    value.exitCode === value.closeCode &&
    value.signal === value.closeSignal;
  const reapedCleanupProof =
    directReapedProof && value.processGroupQuiescent === true;
  const coherent = !(
    (value.noChild && !noChildProof) ||
    (value.reaped && !directReapedProof) ||
    (value.statusAgreement &&
      (!value.exitObserved ||
        !value.closeObserved ||
        value.exitCode !== value.closeCode ||
        value.signal !== value.closeSignal)) ||
    (value.captureComplete &&
      (!reapedCleanupProof ||
        !value.stdinComplete ||
        value.outputTruncated ||
        terminationErrorCount !== 0 ||
        processErrorCount !== 0))
  );
  return Object.freeze({
    coherent,
    noChildProof,
    directReapedProof,
    reapedCleanupProof,
    cleanupSafe: noChildProof || reapedCleanupProof,
  });
}
