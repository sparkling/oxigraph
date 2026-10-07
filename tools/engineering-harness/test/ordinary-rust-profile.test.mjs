import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { execute } from "../../agentic-qe/process-runner.mjs";
import { repository, runDelivery } from "../src/delivery.mjs";

const profile = {
  CARGO_PROFILE_DEV_DEBUG: "1", CARGO_PROFILE_TEST_DEBUG: "1",
  CARGO_PROFILE_DEV_INCREMENTAL: "false", CARGO_PROFILE_TEST_INCREMENTAL: "false",
};

function hostileCargoEnvironment(t) {
  const values = {
    CARGO_INCREMENTAL: "1", CARGO_PROFILE_DEV_DEBUG: "2", CARGO_PROFILE_TEST_DEBUG: "2",
    CARGO_TARGET_DIR: "/untrusted/target", CARGO_HOME: "/untrusted/cargo",
    RUSTFLAGS: "-C linker=/untrusted/linker", CC: "/untrusted/compiler",
    OPENROUTER_API_KEY: "test-secret-never-forwarded",
  };
  const before = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}

test("ordinary checks add fixed lean profiles only after Cargo/compiler authority is scrubbed", async t => {
  hostileCargoEnvironment(t);
  const result = await execute(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
    ordinaryRustProfile: true, quiet: true, announce: false, timeoutMs: 5000, captureOutputBytes: 16384,
  });
  assert.equal(result.code, 0);
  const observed = JSON.parse(result.capturedOutput.stdout.toString());
  assert.deepEqual(Object.fromEntries(Object.keys(profile).map(name => [name, observed[name]])), profile);
  for (const name of ["CARGO_INCREMENTAL", "CARGO_TARGET_DIR", "CARGO_HOME", "RUSTFLAGS", "CC", "OPENROUTER_API_KEY", "CARGO_PROFILE_RELEASE_DEBUG"]) {
    assert.equal(Object.hasOwn(observed, name), false, name);
  }
});

test("generic and sealed execution retain their prior scrubbed environment without ordinary profiles", async t => {
  hostileCargoEnvironment(t);
  for (const options of [{}, { ordinaryRustProfile: false }, { inheritEnvironment: false, env: { LANG: "C.UTF-8" } }]) {
    const result = await execute(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
      ...options, quiet: true, announce: false, timeoutMs: 5000, captureOutputBytes: 16384,
    });
    assert.equal(result.code, 0);
    const observed = JSON.parse(result.capturedOutput.stdout.toString());
    for (const name of [...Object.keys(profile), "CARGO_INCREMENTAL", "CARGO_TARGET_DIR", "RUSTFLAGS", "OPENROUTER_API_KEY"]) {
      assert.equal(Object.hasOwn(observed, name), false, name);
    }
    if (options.inheritEnvironment === false) assert.deepEqual(observed, { LANG: "C.UTF-8" });
  }
});

test("ordinary profile opt-in is typed and does not admit arbitrary Cargo/compiler overrides", async () => {
  for (const ordinaryRustProfile of ["true", 1, {}]) {
    await assert.rejects(execute(process.execPath, ["-e", "process.exit(99)"], { ordinaryRustProfile }), /ordinary Rust profile policy is invalid/);
  }
  for (const name of ["CARGO_TARGET_DIR", "CARGO_INCREMENTAL", "CARGO_PROFILE_DEV_DEBUG", "RUSTFLAGS", "CC"]) {
    await assert.rejects(execute(process.execPath, ["-e", "process.exit(99)"], {
      ordinaryRustProfile: true, quiet: true, announce: false, env: { [name]: "untrusted" },
    }), /override is prohibited/);
  }
});

test("resumed historical candidate without dev profile builds and tests with debug=1 and no incremental state", async t => {
  hostileCargoEnvironment(t);
  const parent = join(repository, "target/engineering-delivery/candidates");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "ordinary-profile-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  const manifest = '[package]\nname = "lean-probe"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n';
  writeFileSync(join(root, "Cargo.toml"), manifest);
  writeFileSync(join(root, "Cargo.lock"), 'version = 4\n[[package]]\nname = "lean-probe"\nversion = "0.0.0"\n');
  writeFileSync(join(root, "src/main.rs"), 'fn main() {}\n#[test]\nfn fixture_passes() { assert_eq!(2 + 2, 4); }\n');
  const context = { root, observe: () => ({ source: "fixed-historical-fixture" }) };
  const common = { taskId: "task-ordinary-profile-fixture", completionCheck: "historical candidate uses lean profiles", quiet: true, timeoutMs: 30000 };
  const build = await runDelivery({ ...common,
    argv: ["cargo", "build", "--locked", "--offline", "--bin", "lean-probe"], artifact: "target/debug/lean-probe",
  }, context);
  assert.equal(build.status, "command-passed", JSON.stringify(build));
  const messages = readFileSync(join(build.directory, "stdout.log"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(messages.find(message => message.reason === "compiler-artifact" && message.target.name === "lean-probe").profile.debuginfo, 1);
  const check = await runDelivery({ ...common, argv: ["cargo", "test", "--locked", "--offline", "--bin", "lean-probe"] }, context);
  assert.equal(check.status, "command-passed", JSON.stringify(check));
  assert.equal(check.result.observedPassedTests, 1);
  assert.equal(readFileSync(join(root, "Cargo.toml"), "utf8"), manifest);
  const incremental = join(root, "target/debug/incremental");
  assert.deepEqual(existsSync(incremental) ? readdirSync(incremental) : [], []);
});
