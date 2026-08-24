import { commandIds } from "./command-registry.mjs";
import { installedDependencyResolution } from "./dependency-binding.mjs";
import { nativeHostDiagnostics } from "./native/diagnostics.mjs";

export async function doctorReport() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    throw new Error(`Node.js >=20 is required; found ${process.versions.node}`);
  }
  const dependencies = installedDependencyResolution();
  const nativeHosts = await nativeHostDiagnostics();
  return Object.freeze({
    schema: 1,
    status: nativeHosts.every(({ available }) => available)
      ? "native-hosts-attested"
      : "inconclusive",
    node: process.versions.node,
    commands: commandIds(),
    dependencies: dependencies.packages,
    manifestSha256: dependencies.manifestSha256,
    lockfileSha256: dependencies.lockfileSha256,
    npmrcSha256: dependencies.npmrcSha256,
    nativeHosts,
    mcpRegistered: false,
    nativeWorkerBoundaryImplemented: true,
    nativeWorkersImplemented: false,
    programmeRunnerImplemented: false,
    localOnly: true,
    promotionAuthority: false,
  });
}
