import { commandIds } from "./command-registry.mjs";
import { installedDependencyResolution } from "./dependency-binding.mjs";

export function doctorReport() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    throw new Error(`Node.js >=20 is required; found ${process.versions.node}`);
  }
  const dependencies = installedDependencyResolution();
  return Object.freeze({
    schema: 1,
    status: "scaffold-valid",
    node: process.versions.node,
    commands: commandIds(),
    dependencies: dependencies.packages,
    manifestSha256: dependencies.manifestSha256,
    lockfileSha256: dependencies.lockfileSha256,
    npmrcSha256: dependencies.npmrcSha256,
    mcpRegistered: false,
    nativeWorkersImplemented: false,
    programmeRunnerImplemented: false,
    localOnly: true,
    promotionAuthority: false,
  });
}
