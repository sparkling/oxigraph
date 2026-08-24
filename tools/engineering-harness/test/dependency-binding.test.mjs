import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_PACKAGES,
  dependencyLockResolution,
  installedDependencyResolution,
} from "../src/dependency-binding.mjs";

test("all required packages request latest and resolve to exact installed artifacts", () => {
  const locked = dependencyLockResolution();
  const installed = installedDependencyResolution();
  assert.deepEqual(
    locked.packages.map(({ name }) => name),
    [...REQUIRED_PACKAGES],
  );
  assert.deepEqual(
    installed.packages.map(({ name, policy, version }) => ({ name, policy, version })),
    locked.packages.map(({ name, policy, version }) => ({ name, policy, version })),
  );
  for (const entry of installed.packages) {
    assert.match(entry.integrity, /^sha512-/);
    assert.match(entry.installedPackageJsonSha256, /^[a-f0-9]{64}$/);
  }
});
