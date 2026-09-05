import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROCKSDB_OPAQUE_C_ORACLE_SHA256,
  auditAtomicOwnerExecution,
  auditBridgeSource,
  auditBuildGraphSources,
  auditFutureGreenGates,
  auditLifecycle,
  auditOracleContract,
  auditReleaseIdentityState,
  auditRequiredExtension,
  auditShimDisposition,
  compileAndRunAtomicExtensionFixture,
  compileAndRunAtomicOwnerSource,
  compileAndRunLifecycleFixture,
  evaluateRocksdbOpaqueCContract,
  extractAtomicOwnerDefinition,
  findCompleteTypeDefinitions,
  loadBuildGraphSources,
  maskDefinitelyInactivePreprocessor,
  tokenizeCode,
} from "../src/qualification/rocksdb-opaque-c-contract.mjs";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ORACLE_URL = new URL(
  "../src/qualification/rocksdb-opaque-c-oracle.json",
  import.meta.url,
);
const oracleBytes = await readFile(ORACLE_URL);
const oracle = JSON.parse(oracleBytes.toString("utf8"));
const buildScriptSource = await readFile(
  resolve(REPOSITORY_ROOT, oracle.buildGraph.buildScript.path),
  "utf8",
);
const buildGraphSources = await loadBuildGraphSources(REPOSITORY_ROOT, oracle);

const PUBLIC_CALL_ARITIES = new Map([
  ["rocksdb_writebatch_wi_create_iterator_with_base_cf_readopts", 4],
  ["rocksdb_get_pinned_cf_v2", 6],
  ["rocksdb_pinnable_handle_get_value", 2],
  ["rocksdb_pinnable_handle_destroy", 1],
  ["rocksdb_get_into_buffer_cf", 10],
  ["rocksdb_iter_key_slice", 1],
  ["rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf", 7],
  ["rocksdb_pinnableslice_value", 2],
  ["rocksdb_pinnableslice_destroy", 1],
  ["rocksdb_readoptions_create", 0],
  ["rocksdb_readoptions_set_async_io", 2],
  ["rocksdb_readoptions_set_snapshot", 2],
  ["rocksdb_readoptions_set_iterate_upper_bound", 3],
  ["rocksdb_readoptions_destroy", 1],
]);
const ERROR_OUT_SYMBOLS = new Set([
  "rocksdb_get_pinned_cf_v2",
  "rocksdb_get_into_buffer_cf",
  "rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf",
]);

function rustCall(symbol) {
  const arity = PUBLIC_CALL_ARITIES.get(symbol);
  assert.notEqual(arity, undefined, symbol);
  const callArity = ERROR_OUT_SYMBOLS.has(symbol) ? arity - 1 : arity;
  const call = `${symbol}(${Array.from({ length: callArity }, (_, index) => `arg${index}`).join(", ")})`;
  return ERROR_OUT_SYMBOLS.has(symbol) ? `ffi_result!(${call});` : `${call};`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function codes(findings) {
  return new Set(findings.map((entry) => entry.code));
}

function gitInRocksdb(args, encoding = "utf8") {
  const result = spawnSync(
    "git",
    ["-C", resolve(REPOSITORY_ROOT, "oxrocksdb-sys/rocksdb"), ...args],
    { encoding, shell: false },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function preprocessCpp(source) {
  const result = spawnSync("c++", ["-E", "-P", "-x", "c++", "-"], {
    encoding: "utf8",
    input: source,
    shell: false,
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function preprocessCppWithHeaders(
  source,
  headers,
  { includeDirectories = ["."] } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-opaque-preprocess-"));
  try {
    await Promise.all(
      [...headers].map(async ([path, bytes]) => {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { encoding: "utf8", mode: 0o600 });
      }),
    );
    const result = spawnSync(
      "c++",
      [
        "-E",
        "-P",
        "-x",
        "c++",
        ...includeDirectories.flatMap((path) => ["-I", join(root, path)]),
        "-",
      ],
      {
        encoding: "utf8",
        input: source,
        shell: false,
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function frozenHeader(commit) {
  return gitInRocksdb(["show", `${commit}:include/rocksdb/c.h`]);
}

const ATOMIC_OWNER_DEFINITION = `
extern "C" void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr) {
  vector<rocksdb::IngestExternalFileArg> args(list_len);
  for (size_t i = 0; i < list_len; ++i) {
    args[i].column_family = list[i].column_family->rep;
    for (size_t j = 0; j < list[i].external_files_len; ++j) {
      args[i].external_files.emplace_back(list[i].external_files[j]);
    }
    args[i].options = list[i].options->rep;
  }
  SaveError(errptr, db->rep->IngestExternalFiles(args));
}
`;

const ATOMIC_EXTENSION_HEADER = `
extern ROCKSDB_LIBRARY_API void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr);
`;
const FFI_RESULT_MACRO = `
macro_rules! ffi_result {
    ( $($function:ident)::*( $arg1:expr $(, $arg:expr)* $(,)? ) ) => {{
        let mut error: *mut ::std::ffi::c_char = ::std::ptr::null_mut();
        let result = $($function)::*($arg1 $(, $arg)* , &mut error);
        if error.is_null() {
            Ok(result)
        } else {
            Err(ErrorStatus(::std::ffi::CString::from_raw(error)))
        }
    }}
}
`;
const ATOMIC_EXTENSION_RUST_CALL = `
${FFI_RESULT_MACRO}
use ::oxrocksdb_sys::*;
pub fn ingest(db: *mut rocksdb_t, args: &[rocksdb_ingestexternalfilearg_t]) {
  unsafe { ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len())); }
}
`;

const ATOMIC_EXTENSION_FIXTURE = `
#include <cstddef>
#include <string>
#include <vector>

using std::size_t;
using std::string;
using std::vector;

struct ColumnFamilyHandle { int id; };
struct IngestExternalFileOptions { int id; };
struct IngestExternalFileArg {
  ColumnFamilyHandle* column_family;
  vector<string> external_files;
  IngestExternalFileOptions options;
};
namespace rocksdb {
using IngestExternalFileArg = ::IngestExternalFileArg;
}
struct DB {
  int calls = 0;
  int status = 0;
  vector<IngestExternalFileArg> observed;
  int IngestExternalFiles(const vector<IngestExternalFileArg>& args) {
    ++calls;
    observed = args;
    return status;
  }
};
struct rocksdb_t { DB* rep; };
struct rocksdb_column_family_handle_t { ColumnFamilyHandle* rep; };
struct rocksdb_ingestexternalfileoptions_t {
  IngestExternalFileOptions rep;
};
struct rocksdb_ingestexternalfilearg_t {
  rocksdb_column_family_handle_t* column_family;
  const char* const* external_files;
  size_t external_files_len;
  rocksdb_ingestexternalfileoptions_t* options;
};

static void SaveError(char** errptr, int status) {
  if (status != 0) *errptr = const_cast<char*>("frozen-error");
}

extern "C" void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr) {
  vector<rocksdb::IngestExternalFileArg> args(list_len);
  for (size_t i = 0; i < list_len; ++i) {
    args[i].column_family = list[i].column_family->rep;
    for (size_t j = 0; j < list[i].external_files_len; ++j) {
      args[i].external_files.emplace_back(list[i].external_files[j]);
    }
    args[i].options = list[i].options->rep;
  }
  SaveError(errptr, db->rep->IngestExternalFiles(args));
}

static int run_success_case(size_t count) {
  DB implementation;
  rocksdb_t db{&implementation};
  ColumnFamilyHandle columns[] = {{17}, {19}, {23}, {29}, {31}};
  rocksdb_column_family_handle_t handles[] = {
      {&columns[0]}, {&columns[1]}, {&columns[2]}, {&columns[3]},
      {&columns[4]}};
  rocksdb_ingestexternalfileoptions_t options[] = {
      {{31}}, {{37}}, {{41}}, {{43}}, {{47}}};
  char first[] = "alpha.sst";
  char second[] = "beta.sst";
  char third[] = "gamma.sst";
  char fourth[] = "delta.sst";
  char fifth[] = "epsilon.sst";
  const char* paths_a[] = {first};
  const char* paths_b[] = {second};
  const char* paths_c[] = {third};
  const char* paths_d[] = {fourth};
  const char* paths_e[] = {fifth};
  rocksdb_ingestexternalfilearg_t input[] = {
      {&handles[0], paths_a, 1, &options[0]},
      {&handles[1], paths_b, 1, &options[1]},
      {&handles[2], paths_c, 1, &options[2]},
      {&handles[3], paths_d, 1, &options[3]},
      {&handles[4], paths_e, 1, &options[4]},
  };
  char* error = nullptr;
  oxrocksdb_ingest_external_files(&db, input, count, &error);
  first[0] = 'X';
  second[0] = 'Y';
  third[0] = 'Z';
  fourth[0] = 'Q';
  fifth[0] = 'R';
  const char* expected_paths[] = {
      "alpha.sst", "beta.sst", "gamma.sst", "delta.sst", "epsilon.sst"};
  const int expected_options[] = {31, 37, 41, 43, 47};
  if (implementation.calls != 1 || error != nullptr ||
      implementation.observed.size() != count) return 10;
  for (size_t i = 0; i < count; ++i) {
    if (implementation.observed[i].column_family != &columns[i] ||
        implementation.observed[i].external_files.size() != 1 ||
        implementation.observed[i].external_files[0] != expected_paths[i] ||
        implementation.observed[i].options.id != expected_options[i]) return 11;
  }
  return 0;
}

int main() {
  const size_t counts[] = {0, 1, 2, 4, 5};
  for (size_t count : counts) {
    if (const int status = run_success_case(count); status != 0) return status;
  }

  DB implementation;
  implementation.status = 5;
  rocksdb_t db{&implementation};
  ColumnFamilyHandle columns[] = {{17}, {19}, {23}};
  rocksdb_column_family_handle_t handles[] = {
      {&columns[0]}, {&columns[1]}, {&columns[2]}};
  rocksdb_ingestexternalfileoptions_t options[] = {{{31}}, {{37}}, {{41}}};
  char first[] = "alpha.sst";
  const char* paths[] = {first};
  rocksdb_ingestexternalfilearg_t input[] = {
      {&handles[0], paths, 1, &options[0]},
      {&handles[1], paths, 1, &options[1]},
      {&handles[2], paths, 1, &options[2]},
  };
  char* error = nullptr;
  oxrocksdb_ingest_external_files(&db, input, 3, &error);
  if (implementation.calls != 1 || error == nullptr) return 12;
  return 0;
}
`;

test("freezes the exact baseline and candidate identities without network input", () => {
  assert.equal(digest(oracleBytes), ROCKSDB_OPAQUE_C_ORACLE_SHA256);
  assert.equal(
    oracle.upstream.repository,
    "https://github.com/facebook/rocksdb",
  );
  assert.deepEqual(
    {
      tag: oracle.upstream.baseline.tag,
      tagKind: oracle.upstream.baseline.tagKind,
      tagObject: oracle.upstream.baseline.tagObject,
      releaseUrl: oracle.upstream.baseline.releaseUrl,
      commitUrl: oracle.upstream.baseline.commitUrl,
      commit: oracle.upstream.baseline.commit,
      tree: oracle.upstream.baseline.tree,
      dbSourceSha256: oracle.upstream.baseline.files[0].sha256,
    },
    {
      tag: "v11.1.2",
      tagKind: "annotated",
      tagObject: "9d94571e3091e14a0b428cab639c388971cb4fcb",
      releaseUrl: "https://github.com/facebook/rocksdb/releases/tag/v11.1.2",
      commitUrl:
        "https://github.com/facebook/rocksdb/commit/3b446089141659fad25328c5ea3e7ed283df46e4",
      commit: "3b446089141659fad25328c5ea3e7ed283df46e4",
      tree: "36afaac5df4b9666e3c7ca5e32e094edd6fedfac",
      dbSourceSha256:
        "3e513ee412f140da8aa7d7a6d8fc92b69bb03a774829532073e9610673399b13",
    },
  );
  assert.deepEqual(
    {
      tag: oracle.upstream.candidate.tag,
      tagKind: oracle.upstream.candidate.tagKind,
      tagObject: oracle.upstream.candidate.tagObject,
      releaseUrl: oracle.upstream.candidate.releaseUrl,
      commitUrl: oracle.upstream.candidate.commitUrl,
      commit: oracle.upstream.candidate.commit,
      tree: oracle.upstream.candidate.tree,
      dbSourceSha256: oracle.upstream.candidate.files[0].sha256,
    },
    {
      tag: "v11.8.1",
      tagKind: "lightweight",
      tagObject: null,
      releaseUrl: "https://github.com/facebook/rocksdb/releases/tag/v11.8.1",
      commitUrl:
        "https://github.com/facebook/rocksdb/commit/abeebd9630f11bd08c28b7bd43c7bdfc62050654",
      commit: "abeebd9630f11bd08c28b7bd43c7bdfc62050654",
      tree: "061f8e3ce4ac04b1e9420ff92f6ed3c9b841b806",
      dbSourceSha256:
        "f2d55e08fed8f9502271a555aabb937a18786acc12384337e5f076b64f3a592a",
    },
  );
  for (const release of [oracle.upstream.baseline, oracle.upstream.candidate]) {
    assert.equal(
      gitInRocksdb(["rev-parse", `${release.commit}^{tree}`]).trim(),
      release.tree,
    );
    for (const file of release.files) {
      assert.equal(
        gitInRocksdb(["rev-parse", `${release.commit}:${file.path}`]).trim(),
        file.gitBlob,
      );
      assert.equal(
        digest(gitInRocksdb(["show", `${release.commit}:${file.path}`], null)),
        file.sha256,
      );
    }
  }

  const observedRelease = (release) =>
    new Map(
      release.files.map((file) => [
        file.path,
        gitInRocksdb(["show", `${release.commit}:${file.path}`], null),
      ]),
    );
  assert.deepEqual(
    auditReleaseIdentityState(
      oracle.upstream.baseline,
      {
        headCommit: oracle.upstream.baseline.commit,
        changedPaths: [],
        observed: observedRelease(oracle.upstream.baseline),
      },
      oracle,
    ),
    [],
  );
  const baselineDescendant = auditReleaseIdentityState(
    oracle.upstream.baseline,
    {
      headCommit: "arbitrary-descendant",
      changedPaths: [],
      observed: observedRelease(oracle.upstream.baseline),
    },
    oracle,
  );
  assert.ok(codes(baselineDescendant).has("baseline-source-drift"));

  const candidateObserved = observedRelease(oracle.upstream.candidate);
  const candidatePristine = candidateObserved.get("db/c.cc");
  const exactOverlay = Buffer.concat([
    candidatePristine,
    Buffer.from(oracle.requiredExtension.candidateOverlay.utf8),
  ]);
  candidateObserved.set("db/c.cc", exactOverlay);
  assert.deepEqual(
    auditReleaseIdentityState(
      oracle.upstream.candidate,
      {
        headCommit: oracle.upstream.candidate.commit,
        candidateIsAncestor: true,
        changedPaths: ["db/c.cc"],
        observed: candidateObserved,
        candidatePristine,
      },
      oracle,
    ),
    [],
  );
  assert.ok(
    codes(
      auditReleaseIdentityState(
        oracle.upstream.candidate,
        {
          headCommit: "arbitrary-descendant",
          candidateIsAncestor: true,
          changedPaths: ["db/c.cc"],
          observed: candidateObserved,
          candidatePristine,
        },
        oracle,
      ),
    ).has("candidate-commit-drift"),
  );
  for (const [changedPaths, source] of [
    [["db/c.cc"], Buffer.concat([exactOverlay, Buffer.from("// suffix\n")])],
    [["db/c.cc"], Buffer.concat([Buffer.from("// prefix\n"), exactOverlay])],
    [["db/c.cc", "util/extra.cc"], exactOverlay],
  ]) {
    const hostileObserved = new Map(candidateObserved);
    hostileObserved.set("db/c.cc", source);
    assert.ok(
      codes(
        auditReleaseIdentityState(
          oracle.upstream.candidate,
          {
            headCommit: "arbitrary-descendant",
            candidateIsAncestor: true,
            changedPaths,
            observed: hostileObserved,
            candidatePristine,
          },
          oracle,
        ),
      ).has("candidate-overlay-drift"),
    );
  }
});

test("executes every frozen public-C disposition against both exact headers", () => {
  const baselineHeader = frozenHeader(oracle.upstream.baseline.commit);
  const candidateHeader = frozenHeader(oracle.upstream.candidate.commit);
  assert.deepEqual(
    auditOracleContract(oracle, baselineHeader, candidateHeader),
    [],
  );
  assert.deepEqual(oracle.rustFfiResult, {
    macro: "ffi_result",
    tokenSha256:
      "0f6f5b268837035ce83f7751fe95e28ab1260a77812248b03fddb0dd3505af20",
  });

  const unreviewedFfiResult = structuredClone(oracle);
  unreviewedFfiResult.rustFfiResult.tokenSha256 = "0".repeat(64);
  assert.ok(
    codes(
      auditOracleContract(unreviewedFfiResult, baselineHeader, candidateHeader),
    ).has("oracle-rust-ffi-result-drift"),
  );

  const indirectBuffer = structuredClone(oracle);
  const row = indirectBuffer.shimDisposition.find(
    ({ customSymbol }) => customSymbol === "oxrocksdb_get_into_buffer_cf",
  );
  row.disposition = "replace-with-public-c-composition";
  row.publicSymbols = [
    "rocksdb_get_pinned_cf_v2",
    "rocksdb_pinnable_handle_get_value",
    "rocksdb_pinnable_handle_destroy",
  ];
  assert.ok(
    codes(
      auditOracleContract(indirectBuffer, baselineHeader, candidateHeader),
    ).has("oracle-shim-disposition"),
  );

  const fabricated = structuredClone(oracle);
  fabricated.shimDisposition[0].publicSymbols = ["rocksdb_not_a_public_api"];
  assert.ok(
    codes(auditOracleContract(fabricated, baselineHeader, candidateHeader)).has(
      "oracle-shim-disposition",
    ),
  );

  const wrongSignature = candidateHeader.replace(
    "rocksdb_t* db, const rocksdb_readoptions_t* options,\n    rocksdb_column_family_handle_t* column_family, const char* key,\n    size_t keylen, char* buffer, size_t buffer_size, size_t* vallen,\n    unsigned char* found, char** errptr);",
    "void* db, const rocksdb_readoptions_t* options,\n    rocksdb_column_family_handle_t* column_family, const char* key,\n    size_t keylen, char* buffer, size_t buffer_size, size_t* vallen,\n    unsigned char* found, char** errptr);",
  );
  assert.notEqual(wrongSignature, candidateHeader);
  assert.ok(
    codes(auditOracleContract(oracle, baselineHeader, wrongSignature)).has(
      "oracle-public-signature-drift",
    ),
  );
});

test("freezes executable future-GREEN ASan and UBSan gates", () => {
  assert.deepEqual(auditFutureGreenGates(oracle), []);
  for (const id of ["address-sanitizer", "undefined-behavior-sanitizer"]) {
    const mutation = structuredClone(oracle);
    mutation.futureGreenGates.find((gate) => gate.id === id).cargo = ["test"];
    assert.ok(
      codes(auditFutureGreenGates(mutation)).has("sanitizer-gate-contract"),
    );
    const silentSkip = structuredClone(oracle);
    silentSkip.futureGreenGates.find(
      (gate) => gate.id === id,
    ).unavailableDisposition = "SKIP";
    assert.ok(
      codes(auditFutureGreenGates(silentSkip)).has("sanitizer-gate-contract"),
    );
  }
});

test("ignores hostile comment string raw-string and definitely-dead decoys", () => {
  const source = `
// struct rocksdb_t { DB* rep; };
/* struct rocksdb_readoptions_t { ReadOptions rep; }; */
const char* quoted = "struct rocksdb_iterator_t { Iterator* rep; };";
const char* raw = R"tag(struct rocksdb_t { DB* rep; };)tag";
#if 0
struct rocksdb_column_family_handle_t { ColumnFamilyHandle* rep; };
#endif
struct Harmless {
  struct NestedDecoy { int rep; };
  void braces() { if (true) { int value = 1; } }
};
`;
  assert.deepEqual(auditBridgeSource(source, oracle), []);
});

test("uses C++ comment and preprocessor semantics before scanning active code", () => {
  const nonNestedComment = `
/* an inner opener is ordinary text: /* */
struct rocksdb_t { DB* rep; };
`;
  assert.ok(
    codes(auditBridgeSource(nonNestedComment, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const directiveInsideComment = `
/*
#if 0
*/
struct rocksdb_t { DB* rep; };
/*
#endif
*/
`;
  assert.ok(
    codes(auditBridgeSource(directiveInsideComment, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const genuinelyDead = `
#if 0
/* nested-looking text /* does not change the inactive branch */
struct rocksdb_t { DB* rep; };
#endif
`;
  assert.deepEqual(auditBridgeSource(genuinelyDead, oracle), []);
});

test("applies C++ line splicing before comments and tokens with physical lines", () => {
  const joinedIdentifier = ["struct rocksdb_\\", "t { void* rep; };"].join(
    "\n",
  );
  assert.equal(
    preprocessCpp(joinedIdentifier),
    "struct rocksdb_t { void* rep; };",
  );
  assert.ok(
    auditBridgeSource(joinedIdentifier, oracle).some(
      ({ code, subject, line }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t" && line === 1,
    ),
  );

  const continuedLineComment = [
    "// the following physical line remains in this comment \\",
    "struct rocksdb_t { void* rep; };",
  ].join("\n");
  assert.equal(preprocessCpp(continuedLineComment), "");
  assert.deepEqual(auditBridgeSource(continuedLineComment, oracle), []);

  const physicalLineProjection = [
    "int harmless = 0;\\",
    "",
    "struct rocksdb_t { void* rep; };",
  ].join("\n");
  assert.equal(
    auditBridgeSource(physicalLineProjection, oracle).find(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    )?.line,
    3,
  );

  for (const [name, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ]) {
    const joined = `struct rocksdb_\\${eol}t { void* rep; };`;
    assert.equal(
      preprocessCpp(joined),
      "struct rocksdb_t { void* rep; };",
      name,
    );
    assert.ok(
      auditBridgeSource(joined, oracle).some(
        ({ code, subject, line }) =>
          code === "opaque-redefinition" &&
          subject === "rocksdb_t" &&
          line === 1,
      ),
      name,
    );
    const comment = `// continued comment \\${eol}struct rocksdb_t { void* rep; };`;
    assert.equal(preprocessCpp(comment), "", name);
    assert.deepEqual(auditBridgeSource(comment, oracle), [], name);
    const directive = `#def\\${eol}ine HANDLE rocksdb_t${eol}struct HANDLE { void* rep; };`;
    assert.equal(
      preprocessCpp(directive),
      "struct rocksdb_t { void* rep; };",
      name,
    );
    assert.ok(
      codes(auditBridgeSource(directive, oracle)).has("opaque-redefinition"),
      name,
    );
    const projected = [
      "int first = 0;",
      "int second = 0;\\",
      "",
      "struct rocksdb_t { void* rep; };",
    ].join(eol);
    assert.equal(
      auditBridgeSource(projected, oracle).find(
        ({ code, subject }) =>
          code === "opaque-redefinition" && subject === "rocksdb_t",
      )?.line,
      4,
      name,
    );
  }
});

test("recognizes preprocessing digraphs before directives and macro expansion", async () => {
  for (const [name, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ]) {
    const source = [
      "%:def\\",
      "ine V15_CAT(left, right) left %:%: right",
      "%:if 0",
      "V15_CAT(str, uct) rocksdb_iterator_t { void* rep; };",
      "%:elif 1",
      "V15_CAT(str, uct) rocksdb_t { void* rep; };",
      "%:else",
      "V15_CAT(str, uct) rocksdb_readoptions_t { void* rep; };",
      "%:endif",
      "%:undef V15_CAT",
    ].join(eol);
    assert.equal(
      preprocessCpp(source),
      "struct rocksdb_t { void* rep; };",
      name,
    );
    const findings = auditBridgeSource(source, oracle).filter(
      ({ code }) => code === "opaque-redefinition",
    );
    assert.deepEqual(
      findings.map(({ subject, line }) => [subject, line]),
      [["rocksdb_t", 6]],
      name,
    );
    const preprocessed = maskDefinitelyInactivePreprocessor(source);
    assert.deepEqual(
      preprocessed.macros.map(({ kind, line }) => [kind, line]),
      [
        ["define", 1],
        ["undef", 10],
      ],
      name,
    );

    const splitDigraphs = [
      "%\\",
      ":define V15_SPLIT_CAT(left, right) left %:\\",
      "%: right",
      "%:if 1",
      "V15_SPLIT_CAT(str, uct) rocksdb_iterator_t { void* rep; };",
      "%:else",
      "V15_SPLIT_CAT(str, uct) rocksdb_readoptions_t { void* rep; };",
      "%:endif",
    ].join(eol);
    assert.equal(
      preprocessCpp(splitDigraphs),
      "struct rocksdb_iterator_t { void* rep; };",
      `${name} split digraphs`,
    );
    assert.deepEqual(
      auditBridgeSource(splitDigraphs, oracle)
        .filter(({ code }) => code === "opaque-redefinition")
        .map(({ subject, line }) => [subject, line]),
      [["rocksdb_iterator_t", 5]],
      `${name} split digraphs`,
    );
  }

  const includeDirectives = maskDefinitelyInactivePreprocessor(
    [
      '%:include "v15-first.h"',
      "%:include_next <v15-second.h>",
    ].join("\n"),
  );
  assert.deepEqual(
    includeDirectives.includes.map(({ keyword, expression, line }) => [
      keyword,
      expression.trim(),
      line,
    ]),
    [
      ["include", '"v15-first.h"', 1],
      ["include_next", "<v15-second.h>", 2],
    ],
  );
  assert.equal(
    await preprocessCppWithHeaders(
      '%:include "v15-next.h"\n',
      new Map([
        ["first/v15-next.h", '%:include_next "v15-next.h"\n'],
        [
          "second/v15-next.h",
          "struct rocksdb_iterator_t { void* rep; };\n",
        ],
      ]),
      { includeDirectories: ["first", "second"] },
    ),
    "struct rocksdb_iterator_t { void* rep; };",
  );
});

test("expands object function and token-paste aliases before opaque scanning", () => {
  const source = `
#define HANDLE(a, b) a ## b
#define PRIVATE(a, b) a ## b
#define HIDDEN_HANDLE HANDLE(rocksdb_, t)
struct HIDDEN_HANDLE { PRIVATE(D, B)* storage; };
`;
  const findings = auditBridgeSource(source, oracle);
  assert.ok(codes(findings).has("opaque-redefinition"));
  assert.ok(codes(findings).has("private-cpp-type-outside-owner"));

  const activeBeforeUndef = `
#define HANDLE rocksdb_t
struct HANDLE { int value; };
#undef HANDLE
`;
  assert.ok(
    codes(auditBridgeSource(activeBeforeUndef, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const undefinedBeforeUse = `
#define HANDLE rocksdb_t
#undef HANDLE
struct HANDLE { int value; };
`;
  assert.deepEqual(auditBridgeSource(undefinedBeforeUse, oracle), []);

  const redefinedBeforeUse = `
#define HANDLE harmless_t
#undef HANDLE
#define HANDLE rocksdb_t
struct HANDLE { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(redefinedBeforeUse, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const redefinedAfterUse = `
#define HANDLE rocksdb_t
struct HANDLE { int value; };
#undef HANDLE
#define HANDLE harmless_t
struct HANDLE { int value; };
`;
  assert.equal(
    auditBridgeSource(redefinedAfterUse, oracle).filter(
      ({ code }) => code === "opaque-redefinition",
    ).length,
    1,
  );

  const inactiveUndef = `
#define JOIN(a, b) a ## b
#if 0
#undef JOIN
#endif
struct JOIN(rocksdb_, t) { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(inactiveUndef, oracle)).has("opaque-redefinition"),
  );

  const unknownElseUndef = `
#if UNKNOWN_CONFIGURATION
#define HANDLE rocksdb_t
#else
#undef HANDLE
#endif
struct HANDLE { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(unknownElseUndef, oracle)).has(
      "ambiguous-preprocessor-macro",
    ),
  );

  const unknownElseHarmlessRedefinition = `
#if UNKNOWN_CONFIGURATION
#define HANDLE rocksdb_t
#else
#define HANDLE harmless_t
#endif
struct HANDLE { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(unknownElseHarmlessRedefinition, oracle)).has(
      "ambiguous-preprocessor-macro",
    ),
  );

  const protectedNameConditionalUndef = `
#if UNKNOWN_CONFIGURATION
#define rocksdb_t harmless_t
#else
#undef rocksdb_t
#endif
struct rocksdb_t { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(protectedNameConditionalUndef, oracle)).has(
      "ambiguous-preprocessor-macro",
    ),
  );

  const protectedNameConditionalRedefinition = `
#if UNKNOWN_CONFIGURATION
#define rocksdb_t harmless_t
#else
#define rocksdb_t alternate_t
#endif
struct rocksdb_t { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(protectedNameConditionalRedefinition, oracle)).has(
      "ambiguous-preprocessor-macro",
    ),
  );

  const activeFunctionRedefinition = `
#define JOIN(a, b) harmless_t
#undef JOIN
#define JOIN(a, b) a ## b
struct JOIN(rocksdb_, t) { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(activeFunctionRedefinition, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const variadicAlias = `
#define HANDLE(prefix, ...) prefix ## __VA_ARGS__
struct HANDLE(rocksdb_, t) { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(variadicAlias, oracle)).has("opaque-redefinition"),
  );

  const unsupportedVariadic = `
#define HANDLE(...) __VA_OPT__(rocksdb_t)
struct HANDLE(value) { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(unsupportedVariadic, oracle)).has(
      "preprocessor-macro-unsupported",
    ),
  );
  const invalidVariadicUse = `
#define HANDLE(value) __VA_ARGS__
struct HANDLE(value) { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(invalidVariadicUse, oracle)).has(
      "preprocessor-macro-unsupported",
    ),
  );

  const deepAliases = `${Array.from(
    { length: 35 },
    (_, index) => `#define ALIAS_${index} ALIAS_${index + 1}`,
  ).join("\n")}\n#define ALIAS_35 rocksdb_t\nstruct ALIAS_0 { int value; };`;
  assert.ok(
    codes(auditBridgeSource(deepAliases, oracle)).has(
      "preprocessor-macro-unsupported",
    ),
  );

  let expandingExpression = "rocksdb_t";
  for (let depth = 0; depth < 15; depth += 1) {
    expandingExpression = `DUPLICATE(${expandingExpression})`;
  }
  const budgetExhaustion = `
#define DUPLICATE(value) value value
#define HANDLE ${expandingExpression}
struct HANDLE { int value; };
`;
  assert.ok(
    codes(auditBridgeSource(budgetExhaustion, oracle)).has(
      "preprocessor-macro-unsupported",
    ),
  );
});

test("does not accept public C wiring hidden under cfg(any())", () => {
  const publicSymbols = [
    ...new Set(oracle.shimDisposition.flatMap((entry) => entry.publicSymbols)),
  ];
  const inactiveRust = `
#[cfg(any())]
fn inactive_replacements() {
${publicSymbols.map((symbol) => `  ${symbol}();`).join("\n")}
}
`;
  const missing = auditShimDisposition("", "", inactiveRust, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(missing), new Set(publicSymbols));

  const nestedInactiveRust = `
#[cfg(all(any()))]
fn inactive_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  const nestedMissing = auditShimDisposition("", "", nestedInactiveRust, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(nestedMissing), new Set(publicSymbols));

  const constGenericInactiveRust = `
#[cfg(all(any()))]
fn inactive_replacements<const N: usize = { 1 }>()
where
  [(); { N }]: Sized,
{
${publicSymbols.map(rustCall).join("\n")}
}
`;
  const constGenericMissing = auditShimDisposition(
    "",
    "",
    constGenericInactiveRust,
    oracle,
  )
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(constGenericMissing), new Set(publicSymbols));

  const recursivelyInactiveRust = `
#[cfg_attr(all(), cfg_attr(target_os = "linux", cfg(all(any()))))]
fn inactive_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  const recursivelyInactiveMissing = auditShimDisposition(
    "",
    "",
    recursivelyInactiveRust,
    oracle,
  )
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(recursivelyInactiveMissing), new Set(publicSymbols));

  const wrongTargetRust = `
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn inactive_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  const wrongTargetMissing = auditShimDisposition(
    "",
    "",
    wrongTargetRust,
    oracle,
  )
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(wrongTargetMissing), new Set(publicSymbols));

  const unknownCfgRust = `
#[cfg(target_has_atomic = "128")]
fn ambiguous_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  const unknownFindings = auditShimDisposition("", "", unknownCfgRust, oracle);
  assert.ok(codes(unknownFindings).has("rust-cfg-unsupported"));
  assert.deepEqual(
    new Set(
      unknownFindings
        .filter(({ code }) => code === "public-replacement-not-wired")
        .map(({ subject }) => subject),
    ),
    new Set(publicSymbols),
  );

  const declarationsOnly = `
unsafe extern "C" {
${publicSymbols.map((symbol) => `  fn ${symbol}();`).join("\n")}
}
`;
  const declarationMissing = auditShimDisposition(
    "",
    "",
    declarationsOnly,
    oracle,
  )
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(declarationMissing), new Set(publicSymbols));

  const deadBranch = `if false { ${publicSymbols.map(rustCall).join("\n")} }`;
  const deadBranchMissing = auditShimDisposition("", "", deadBranch, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(deadBranchMissing), new Set(publicSymbols));

  const deadCfgExpression = `if cfg!(all(any())) { ${publicSymbols
    .map(rustCall)
    .join("\n")} }`;
  const deadCfgMissing = auditShimDisposition("", "", deadCfgExpression, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(deadCfgMissing), new Set(publicSymbols));

  const macroOnly = `
macro_rules! replacement_decoy {
  () => { ${publicSymbols.map(rustCall).join("\n")} };
}
`;
  const macroMissing = auditShimDisposition("", "", macroOnly, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(macroMissing), new Set(publicSymbols));

  const wrongArity = publicSymbols
    .map((symbol) =>
      PUBLIC_CALL_ARITIES.get(symbol) === 0
        ? `${symbol}(unexpected);`
        : `${symbol}();`,
    )
    .join("\n");
  const arityMissing = auditShimDisposition("", "", wrongArity, oracle)
    .filter(({ code }) => code === "public-replacement-not-wired")
    .map(({ subject }) => subject);
  assert.deepEqual(new Set(arityMissing), new Set(publicSymbols));

  const activeRust = `
${FFI_RESULT_MACRO}
use ::oxrocksdb_sys::*;
#[cfg(all(target_arch = "x86_64", target_os = "linux", target_family = "unix"))]
pub fn active_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  assert.deepEqual(auditShimDisposition("", "", activeRust, oracle), []);

  const localFunctions = `
use ::oxrocksdb_sys::*;
${publicSymbols.map((symbol) => `fn ${symbol}() {}`).join("\n")}
pub fn active_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  assert.deepEqual(
    new Set(
      auditShimDisposition("", "", localFunctions, oracle)
        .filter(({ code }) => code === "public-replacement-not-wired")
        .map(({ subject }) => subject),
    ),
    new Set(publicSymbols),
  );

  const unreachableCalls = `
use ::oxrocksdb_sys::*;
fn unreachable_decoy() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  assert.deepEqual(
    new Set(
      auditShimDisposition("", "", unreachableCalls, oracle)
        .filter(({ code }) => code === "public-replacement-not-wired")
        .map(({ subject }) => subject),
    ),
    new Set(publicSymbols),
  );

  const scopedImportDecoy = `
fn import_decoy() { use ::oxrocksdb_sys::*; }
pub fn active_replacements() {
${publicSymbols.map(rustCall).join("\n")}
}
`;
  assert.deepEqual(
    new Set(
      auditShimDisposition("", "", scopedImportDecoy, oracle)
        .filter(({ code }) => code === "public-replacement-not-wired")
        .map(({ subject }) => subject),
    ),
    new Set(publicSymbols),
  );

  for (const ordinaryUnused of [
    `use ::oxrocksdb_sys::*;
fn drop() { rocksdb_readoptions_create(); }`,
    `use ::oxrocksdb_sys::*;
fn main() { rocksdb_readoptions_create(); }`,
    `use ::oxrocksdb_sys::*;
trait NeverUsed { fn call(&self); }
struct Hidden;
impl NeverUsed for Hidden {
  fn call(&self) { rocksdb_readoptions_create(); }
}`,
    `use ::oxrocksdb_sys::*;
mod visible { pub fn duplicate_name() {} }
mod hidden {
  fn duplicate_name() { rocksdb_readoptions_create(); }
}`,
  ]) {
    const miniOracle = structuredClone(oracle);
    miniOracle.shimDisposition = [
      {
        customSymbol: "unused_custom_symbol",
        publicSymbols: ["rocksdb_readoptions_create"],
      },
    ];
    assert.ok(
      codes(auditShimDisposition("", "", ordinaryUnused, miniOracle)).has(
        "public-replacement-not-wired",
      ),
    );
  }

  const reachableHelperOracle = structuredClone(oracle);
  reachableHelperOracle.shimDisposition = [
    {
      customSymbol: "unused_custom_symbol",
      publicSymbols: ["rocksdb_readoptions_create"],
    },
  ];
  assert.deepEqual(
    auditShimDisposition(
      "",
      "",
      `use ::oxrocksdb_sys::*;
fn helper() { rocksdb_readoptions_create(); }
pub fn active() { helper(); }`,
      reachableHelperOracle,
    ),
    [],
  );

  const macroGeneratedLocalFfi = `
macro_rules! install_shadow {
  () => { mod oxrocksdb_sys { pub fn rocksdb_readoptions_create() {} } };
}
install_shadow!();
use ::oxrocksdb_sys::*;
pub fn active() { rocksdb_readoptions_create(); }
`;
  const miniOracle = structuredClone(oracle);
  miniOracle.shimDisposition = [
    {
      customSymbol: "unused_custom_symbol",
      publicSymbols: ["rocksdb_readoptions_create"],
    },
  ];
  assert.ok(
    codes(auditShimDisposition("", "", macroGeneratedLocalFfi, miniOracle)).has(
      "public-replacement-not-wired",
    ),
  );

  for (const adversarialReachability of [
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { return; rocksdb_readoptions_create(); }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { if true { return; } rocksdb_readoptions_create(); }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { if cfg!(all()) { return; } rocksdb_readoptions_create(); }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { return; unsafe { rocksdb_readoptions_create(); } }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { panic!("stop"); unsafe { rocksdb_readoptions_create(); } }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { loop { break; unsafe { rocksdb_readoptions_create(); } } }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { loop { continue; unsafe { rocksdb_readoptions_create(); } } }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { return; let _deferred = || { rocksdb_readoptions_create(); }; }`,
    `use ::oxrocksdb_sys::*;
#[allow(unreachable_code)]
pub fn active() { return; let _deferred = async { rocksdb_readoptions_create(); }; }`,
    `use ::oxrocksdb_sys::*;
struct PrivateDrop;
impl ::std::ops::Drop for PrivateDrop {
  fn drop(&mut self) { rocksdb_readoptions_create(); }
}`,
    `use ::oxrocksdb_sys::*;
mod private_scope {
  pub fn active() { rocksdb_readoptions_create(); }
}`,
    `use ::oxrocksdb_sys::*;
pub fn active() {
  fn local() { rocksdb_readoptions_create(); }
}`,
    `use ::oxrocksdb_sys::*;
fn helper() { rocksdb_readoptions_create(); }
pub fn active() {
  fn local() { helper(); }
}`,
    `use ::oxrocksdb_sys::*;
pub fn active() {
  let _deferred = || { rocksdb_readoptions_create(); };
}`,
    `use ::oxrocksdb_sys::*;
fn helper() { rocksdb_readoptions_create(); }
pub fn active() {
  let _deferred = || { helper(); };
}`,
    `use ::oxrocksdb_sys::*;
pub fn active() {
  let _deferred = async { rocksdb_readoptions_create(); };
}`,
    `use ::oxrocksdb_sys::*;
trait CallsHelper { fn helper(&self); }
struct Value;
impl CallsHelper for Value { fn helper(&self) {} }
fn helper() { rocksdb_readoptions_create(); }
pub fn active(value: &impl CallsHelper) { value.helper(); }`,
    `use ::oxrocksdb_sys::*;
pub fn active() {
  macro_rules! install_shadow {
    () => { fn rocksdb_readoptions_create() {} };
  }
  install_shadow!();
  rocksdb_readoptions_create();
}`,
    `use oxrocksdb_sys::*;
pub fn active() { rocksdb_readoptions_create(); }`,
  ]) {
    assert.ok(
      codes(
        auditShimDisposition("", "", adversarialReachability, miniOracle),
      ).has("public-replacement-not-wired"),
      adversarialReachability,
    );
  }

  assert.deepEqual(
    auditShimDisposition(
      "",
      "",
      `use ::oxrocksdb_sys::*;
pub struct PublicDrop;
impl ::std::ops::Drop for PublicDrop {
  fn drop(&mut self) { rocksdb_readoptions_create(); }
}`,
      miniOracle,
    ),
    [],
  );
  assert.deepEqual(
    auditShimDisposition(
      "",
      "",
      `use ::oxrocksdb_sys::*;
pub fn active() { { unsafe { rocksdb_readoptions_create(); } } }`,
      miniOracle,
    ),
    [],
  );
  assert.deepEqual(
    auditShimDisposition(
      "",
      "",
      `use ::oxrocksdb_sys::*;
pub fn active() { unsafe { rocksdb_readoptions_create(); } }`,
      miniOracle,
    ),
    [],
  );
  assert.deepEqual(
    auditShimDisposition(
      "",
      "",
      `use ::oxrocksdb_sys::*;
struct ConstructedDrop { marker: usize }
impl ::std::ops::Drop for ConstructedDrop {
  fn drop(&mut self) { rocksdb_readoptions_create(); }
}
pub fn active() { let _value = ConstructedDrop { marker: 1 }; }`,
      miniOracle,
    ),
    [],
  );
});

test("finds all direct opaque definitions including active nested definitions", () => {
  const source = `
struct [[deprecated]] rocksdb_t { DB* rep; };
struct Container {
  class [[gnu::packed]] alignas(16) rocksdb_iterator_t { Iterator* rep; };
};
union __attribute__((packed)) rocksdb_column_family_handle_t { ColumnFamilyHandle* rep; };
struct __declspec(align(16)) rocksdb_writebatch_wi_t { WriteBatchWithIndex* rep; };
struct rocksdb_ingestexternalfileoptions_t { IngestExternalFileOptions rep; };
struct rocksdb_readoptions_t { ReadOptions rep; };
`;
  const direct = auditBridgeSource(source, oracle)
    .filter((entry) => entry.code === "opaque-redefinition")
    .map((entry) => entry.subject)
    .sort();
  assert.deepEqual(
    direct,
    oracle.opaqueMirrors.map((entry) => entry.tag).sort(),
  );

  assert.ok(
    codes(
      auditBridgeSource("struct OPAQUE_ABI rocksdb_t { DB* rep; };", oracle),
    ).has("opaque-type-attribute-unsupported"),
  );

  const digraph = auditBridgeSource("struct rocksdb_t <% DB* rep; %>;", oracle);
  assert.ok(codes(digraph).has("opaque-redefinition"));
});

test("finds unused renamed mirrors and reports every duplicate", () => {
  const source = `
static void never_called() {
  struct RenamedReadOptions { ReadOptions storage; };
}
struct RenamedDbOne { DB* hidden; };
struct Outer {
  struct RenamedDbTwo { DB* hidden; };
};
`;
  const renamed = auditBridgeSource(source, oracle)
    .filter((entry) => entry.code === "renamed-opaque-mirror")
    .map((entry) => entry.subject);
  assert.deepEqual(
    new Set(renamed),
    new Set(["RenamedReadOptions", "RenamedDbOne", "Outer", "RenamedDbTwo"]),
  );
});

test("does not let a preprocessor rename conceal a private representation", () => {
  const source = `
#define rocksdb_t apparently_safe_t
struct apparently_safe_t { DB* representation; };
`;
  assert.ok(
    codes(auditBridgeSource(source, oracle)).has("renamed-opaque-mirror"),
  );

  const currentGraphFindings = auditBuildGraphSources(
    buildScriptSource,
    buildGraphSources,
    oracle,
  ).filter(({ code }) => code.startsWith("build-"));
  assert.deepEqual(currentGraphFindings, []);

  const includedMirror = new Map(buildGraphSources);
  includedMirror.set(
    "oxrocksdb-sys/api/c.cc",
    `${includedMirror.get("oxrocksdb-sys/api/c.cc")}\n#include "moved_mirror.h"\n`,
  );
  includedMirror.set(
    "oxrocksdb-sys/api/moved_mirror.h",
    "struct rocksdb_t { DB* rep; };\n",
  );
  const includedFindings = auditBuildGraphSources(
    buildScriptSource,
    includedMirror,
    oracle,
  );
  assert.ok(codes(includedFindings).has("build-graph-drift"));
  assert.ok(codes(includedFindings).has("opaque-redefinition"));

  const newTranslationUnit = new Map(buildGraphSources);
  newTranslationUnit.set(
    "oxrocksdb-sys/api/moved_mirror.cc",
    "struct rocksdb_t { DB* rep; };\n",
  );
  const extendedBuild = buildScriptSource.replace(
    '.file("api/c.cc")',
    '.file("api/c.cc").file("api/moved_mirror.cc")',
  );
  const translationUnitFindings = auditBuildGraphSources(
    extendedBuild,
    newTranslationUnit,
    oracle,
  );
  assert.ok(codes(translationUnitFindings).has("build-script-drift"));
  assert.ok(codes(translationUnitFindings).has("build-translation-unit-drift"));
  assert.ok(codes(translationUnitFindings).has("opaque-redefinition"));

  const unresolvedInclude = new Map(buildGraphSources);
  unresolvedInclude.set(
    "oxrocksdb-sys/api/c.cc",
    `${unresolvedInclude.get("oxrocksdb-sys/api/c.cc")}\n#include "missing_mirror.h"\n`,
  );
  assert.ok(
    codes(
      auditBuildGraphSources(buildScriptSource, unresolvedInclude, oracle),
    ).has("build-include-unresolved"),
  );
  const includeNext = new Map(buildGraphSources);
  includeNext.set(
    "oxrocksdb-sys/api/c.cc",
    `${includeNext.get("oxrocksdb-sys/api/c.cc")}\n#include_next "c.h"\n`,
  );
  assert.ok(
    codes(auditBuildGraphSources(buildScriptSource, includeNext, oracle)).has(
      "build-include-unresolved",
    ),
  );

  const traversal = new Map(buildGraphSources);
  traversal.set(
    "oxrocksdb-sys/api/c.cc",
    `${traversal.get("oxrocksdb-sys/api/c.cc")}\n#include "../rocksdb/include/rocksdb/c.h"\n`,
  );
  assert.ok(
    codes(auditBuildGraphSources(buildScriptSource, traversal, oracle)).has(
      "build-include-traversal",
    ),
  );

  const lz4Mirror = new Map(buildGraphSources);
  lz4Mirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${lz4Mirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}\nstruct rocksdb_t { void* rep; };\n`,
  );
  assert.ok(
    codes(auditBuildGraphSources(buildScriptSource, lz4Mirror, oracle)).has(
      "opaque-redefinition",
    ),
  );

  const macroComposedLz4Mirror = new Map(buildGraphSources);
  macroComposedLz4Mirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${macroComposedLz4Mirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define OPAQUE_JOIN(left, right) left##right
struct OPAQUE_JOIN(rocksdb_, t) { void* rep; };
`,
  );
  assert.ok(
    codes(
      auditBuildGraphSources(buildScriptSource, macroComposedLz4Mirror, oracle),
    ).has("opaque-redefinition"),
  );

  const conditionalLz4Mirror = new Map(buildGraphSources);
  conditionalLz4Mirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${conditionalLz4Mirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#if UNKNOWN_BUILD_CONFIGURATION
#define MAYBE_HANDLE rocksdb_t
#else
#define MAYBE_HANDLE harmless_t
#endif
struct MAYBE_HANDLE { void* rep; };
`,
  );
  assert.ok(
    codes(
      auditBuildGraphSources(buildScriptSource, conditionalLz4Mirror, oracle),
    ).has("ambiguous-preprocessor-macro"),
  );

  const crossFileConditionalMirror = new Map(buildGraphSources);
  crossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${crossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#if UNKNOWN_BUILD_CONFIGURATION
#define CROSS_FILE_HANDLE rocksdb_t
#else
#define CROSS_FILE_HANDLE harmless_t
#endif
`,
  );
  crossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${crossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct CROSS_FILE_HANDLE { void* rep; };
`,
  );
  assert.ok(
    codes(
      auditBuildGraphSources(
        buildScriptSource,
        crossFileConditionalMirror,
        oracle,
      ),
    ).has("ambiguous-preprocessor-macro"),
  );

  const chainedCrossFileConditionalMirror = new Map(buildGraphSources);
  chainedCrossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${chainedCrossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#if UNKNOWN_BUILD_CONFIGURATION
#define INNER_CROSS_FILE_HANDLE rocksdb_t
#else
#define INNER_CROSS_FILE_HANDLE harmless_t
#endif
#include "lz4hc.h"
`,
  );
  chainedCrossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4hc.h",
    `${chainedCrossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4hc.h")}
#define OUTER_CROSS_FILE_HANDLE INNER_CROSS_FILE_HANDLE
`,
  );
  chainedCrossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${chainedCrossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct OUTER_CROSS_FILE_HANDLE { void* rep; };
`,
  );
  assert.ok(
    codes(
      auditBuildGraphSources(
        buildScriptSource,
        chainedCrossFileConditionalMirror,
        oracle,
      ),
    ).has("ambiguous-preprocessor-macro"),
  );

  const composedCrossFileConditionalMirror = new Map(buildGraphSources);
  composedCrossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${composedCrossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#define OPAQUE_CAT_DETAIL(left, right) left ## right
#define OPAQUE_CAT(left, right) OPAQUE_CAT_DETAIL(left, right)
#if UNKNOWN_BUILD_CONFIGURATION
#define OPAQUE_PREFIX rocksdb_
#else
#define OPAQUE_PREFIX harmless_
#endif
#define COMPOSED_CROSS_FILE_HANDLE OPAQUE_CAT(OPAQUE_PREFIX, t)
`,
  );
  composedCrossFileConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${composedCrossFileConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct COMPOSED_CROSS_FILE_HANDLE { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      composedCrossFileConditionalMirror,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" && subject === "OPAQUE_PREFIX",
    ),
  );

  const orderedInnerThenOuterMirror = new Map(buildGraphSources);
  orderedInnerThenOuterMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${orderedInnerThenOuterMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#define ORDERED_CAT_DETAIL(left, right) left ## right
#define ORDERED_CAT(left, right) ORDERED_CAT_DETAIL(left, right)
#if UNKNOWN_INNER_CONFIGURATION
#define ORDERED_PREFIX rocksdb_
#else
#define ORDERED_PREFIX harmless_
#endif
#define ORDERED_HANDLE ORDERED_CAT(ORDERED_PREFIX, t)
`,
  );
  orderedInnerThenOuterMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${orderedInnerThenOuterMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#undef ORDERED_PREFIX
#define ORDERED_PREFIX harmless_
struct ORDERED_HANDLE { void* rep; };
`,
  );
  assert.equal(
    auditBuildGraphSources(
      buildScriptSource,
      orderedInnerThenOuterMirror,
      oracle,
    ).filter(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" &&
        subject.startsWith("ORDERED_"),
    ).length,
    0,
  );

  const orderedOuterConditionalMirror = new Map(buildGraphSources);
  orderedOuterConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${orderedOuterConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#define ORDERED_OUTER_CAT_DETAIL(left, right) left ## right
#define ORDERED_OUTER_CAT(left, right) ORDERED_OUTER_CAT_DETAIL(left, right)
#define ORDERED_OUTER_PREFIX harmless_
#define ORDERED_OUTER_HANDLE ORDERED_OUTER_CAT(ORDERED_OUTER_PREFIX, t)
`,
  );
  orderedOuterConditionalMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${orderedOuterConditionalMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#undef ORDERED_OUTER_PREFIX
#if UNKNOWN_OUTER_CONFIGURATION
#define ORDERED_OUTER_PREFIX rocksdb_
#else
#define ORDERED_OUTER_PREFIX harmless_
#endif
struct ORDERED_OUTER_HANDLE { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      orderedOuterConditionalMirror,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" &&
        subject === "ORDERED_OUTER_PREFIX",
    ),
  );

  const disconnectedCrossFileMirror = new Map(buildGraphSources);
  disconnectedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/disconnected-probe.h",
    `#define DISCONNECTED_CAT_DETAIL(left, right) left ## right
#define DISCONNECTED_CAT(left, right) DISCONNECTED_CAT_DETAIL(left, right)
#if UNKNOWN_DISCONNECTED_CONFIGURATION
#define DISCONNECTED_PREFIX rocksdb_
#else
#define DISCONNECTED_PREFIX harmless_
#endif
#define DISCONNECTED_HANDLE DISCONNECTED_CAT(DISCONNECTED_PREFIX, t)
`,
  );
  disconnectedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${disconnectedCrossFileMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct DISCONNECTED_HANDLE { void* rep; };
`,
  );
  assert.equal(
    auditBuildGraphSources(
      buildScriptSource,
      disconnectedCrossFileMirror,
      oracle,
    ).filter(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" &&
        subject.startsWith("DISCONNECTED_"),
    ).length,
    0,
  );

  const chainedComposedCrossFileMirror = new Map(buildGraphSources);
  chainedComposedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/composition-helper.h",
    `#define CHAINED_CAT_DETAIL(left, right) left ## right
#define CHAINED_CAT(left, right) CHAINED_CAT_DETAIL(left, right)
#if UNKNOWN_BUILD_CONFIGURATION
#define CHAINED_PREFIX rocksdb_
#else
#define CHAINED_PREFIX harmless_
#endif
`,
  );
  chainedComposedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${chainedComposedCrossFileMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#include "composition-helper.h"
#define CHAINED_COMPOSED_HANDLE CHAINED_CAT(CHAINED_PREFIX, t)
`,
  );
  chainedComposedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${chainedComposedCrossFileMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct CHAINED_COMPOSED_HANDLE { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      chainedComposedCrossFileMirror,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" && subject === "CHAINED_PREFIX",
    ),
  );

  const generatedDeclaration = `#define PARENT_TYPE_KEYWORD struct
#define PARENT_TAG_PREFIX rocksdb_
#define PARENT_TAG_DETAIL(left, right) left ## right
#define PARENT_TAG(left, right) PARENT_TAG_DETAIL(left, right)
PARENT_TYPE_KEYWORD PARENT_TAG(PARENT_TAG_PREFIX, t) { void* rep; };
`;
  const literalDeclaration = "struct rocksdb_t { void* rep; };";
  assert.equal(preprocessCpp(generatedDeclaration), literalDeclaration);

  const parentGeneratedKeywordAndTag = new Map(buildGraphSources);
  parentGeneratedKeywordAndTag.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    parentGeneratedKeywordAndTag.get("oxrocksdb-sys/lz4/lib/lz4.c").replace(
      '#include "lz4.h"',
      `#define PARENT_TYPE_KEYWORD struct
#define PARENT_TAG_PREFIX rocksdb_
#include "lz4.h"`,
    ),
  );
  parentGeneratedKeywordAndTag.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${parentGeneratedKeywordAndTag.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#define PARENT_TAG_DETAIL(left, right) left ## right
#define PARENT_TAG(left, right) PARENT_TAG_DETAIL(left, right)
PARENT_TYPE_KEYWORD PARENT_TAG(PARENT_TAG_PREFIX, t) { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      parentGeneratedKeywordAndTag,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ),
    "incoming parent macros must be expanded before declaration-window filtering",
  );

  const harmlessParentGeneratedTag = new Map(parentGeneratedKeywordAndTag);
  harmlessParentGeneratedTag.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    harmlessParentGeneratedTag
      .get("oxrocksdb-sys/lz4/lib/lz4.c")
      .replace(
        "#define PARENT_TAG_PREFIX rocksdb_",
        "#define PARENT_TAG_PREFIX harmless_",
      ),
  );
  assert.equal(
    auditBuildGraphSources(
      buildScriptSource,
      harmlessParentGeneratedTag,
      oracle,
    ).filter(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ).length,
    0,
    "the bounded parent-macro scan must not reject the literal harmless equivalent",
  );

  const directParentIntoHeader = new Map(buildGraphSources);
  directParentIntoHeader.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${directParentIntoHeader.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define DIRECT_PARENT_PREFIX rocksdb_
#include "direct-parent-probe.h"
`,
  );
  directParentIntoHeader.set(
    "oxrocksdb-sys/lz4/lib/direct-parent-probe.h",
    `#define DIRECT_PARENT_CAT_DETAIL(left, right) left ## right
#define DIRECT_PARENT_CAT(left, right) DIRECT_PARENT_CAT_DETAIL(left, right)
struct DIRECT_PARENT_CAT(DIRECT_PARENT_PREFIX, t) { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      directParentIntoHeader,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ),
    "a parent macro must expand inside structural tokens from its included header",
  );

  const multiHopParentIntoHeader = new Map(buildGraphSources);
  multiHopParentIntoHeader.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${multiHopParentIntoHeader.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define MULTI_HOP_PREFIX rocksdb_
#include "multi-hop-middle.h"
`,
  );
  multiHopParentIntoHeader.set(
    "oxrocksdb-sys/lz4/lib/multi-hop-middle.h",
    '#include "multi-hop-leaf.h"\n',
  );
  multiHopParentIntoHeader.set(
    "oxrocksdb-sys/lz4/lib/multi-hop-leaf.h",
    `#define MULTI_HOP_CAT_DETAIL(left, right) left ## right
#define MULTI_HOP_CAT(left, right) MULTI_HOP_CAT_DETAIL(left, right)
struct MULTI_HOP_CAT(MULTI_HOP_PREFIX, t) { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      multiHopParentIntoHeader,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ),
    "macro state must cross a parent-to-header-to-header include chain",
  );

  const guardedReinclude = new Map(buildGraphSources);
  guardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${guardedReinclude.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define GUARDED_REINCLUDE_PREFIX harmless_
#include "guarded-reinclude-probe.h"
#undef GUARDED_REINCLUDE_PROBE_H
#undef GUARDED_REINCLUDE_PREFIX
#define GUARDED_REINCLUDE_PREFIX rocksdb_
#include "guarded-reinclude-probe.h"
`,
  );
  guardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/guarded-reinclude-probe.h",
    `#ifndef GUARDED_REINCLUDE_PROBE_H
#define GUARDED_REINCLUDE_PROBE_H
#define GUARDED_REINCLUDE_CAT_DETAIL(left, right) left ## right
#define GUARDED_REINCLUDE_CAT(left, right) GUARDED_REINCLUDE_CAT_DETAIL(left, right)
struct GUARDED_REINCLUDE_CAT(GUARDED_REINCLUDE_PREFIX, t) { void* rep; };
#endif
`,
  );
  assert.ok(
    auditBuildGraphSources(buildScriptSource, guardedReinclude, oracle).some(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ),
    "undefining a conventional guard must permit a later include to re-enter",
  );

  const guardedSkip = new Map(buildGraphSources);
  guardedSkip.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${guardedSkip.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define GUARDED_SKIP_PREFIX harmless_
#include "guarded-skip-probe.h"
#undef GUARDED_SKIP_PREFIX
#define GUARDED_SKIP_PREFIX rocksdb_
#include "guarded-skip-probe.h"
`,
  );
  guardedSkip.set(
    "oxrocksdb-sys/lz4/lib/guarded-skip-probe.h",
    `#ifndef GUARDED_SKIP_PROBE_H
#define GUARDED_SKIP_PROBE_H
#define GUARDED_SKIP_CAT_DETAIL(left, right) left ## right
#define GUARDED_SKIP_CAT(left, right) GUARDED_SKIP_CAT_DETAIL(left, right)
struct GUARDED_SKIP_CAT(GUARDED_SKIP_PREFIX, t) { void* rep; };
#endif
`,
  );
  assert.equal(
    auditBuildGraphSources(buildScriptSource, guardedSkip, oracle).filter(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ).length,
    0,
    "a still-defined conventional guard must suppress the later include",
  );

  const pragmaOnceSkip = new Map(buildGraphSources);
  pragmaOnceSkip.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${pragmaOnceSkip.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define PRAGMA_ONCE_PREFIX harmless_
#include "pragma-once-probe.h"
#undef PRAGMA_ONCE_PREFIX
#define PRAGMA_ONCE_PREFIX rocksdb_
#include "pragma-once-probe.h"
`,
  );
  pragmaOnceSkip.set(
    "oxrocksdb-sys/lz4/lib/pragma-once-probe.h",
    `#pragma once
#define PRAGMA_ONCE_CAT_DETAIL(left, right) left ## right
#define PRAGMA_ONCE_CAT(left, right) PRAGMA_ONCE_CAT_DETAIL(left, right)
struct PRAGMA_ONCE_CAT(PRAGMA_ONCE_PREFIX, t) { void* rep; };
`,
  );
  assert.equal(
    auditBuildGraphSources(buildScriptSource, pragmaOnceSkip, oracle).filter(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ).length,
    0,
    "pragma once must suppress the later include in the same translation unit",
  );

  const unguardedReinclude = new Map(buildGraphSources);
  unguardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${unguardedReinclude.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define UNGUARDED_REINCLUDE_PREFIX harmless_
#include "unguarded-reinclude-probe.h"
#undef UNGUARDED_REINCLUDE_PREFIX
#define UNGUARDED_REINCLUDE_PREFIX rocksdb_
#include "unguarded-reinclude-probe.h"
`,
  );
  unguardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/unguarded-reinclude-probe.h",
    `#define UNGUARDED_REINCLUDE_CAT_DETAIL(left, right) left ## right
#define UNGUARDED_REINCLUDE_CAT(left, right) UNGUARDED_REINCLUDE_CAT_DETAIL(left, right)
struct UNGUARDED_REINCLUDE_CAT(UNGUARDED_REINCLUDE_PREFIX, t) { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(buildScriptSource, unguardedReinclude, oracle).some(
      ({ code, subject }) =>
        code === "opaque-redefinition" && subject === "rocksdb_t",
    ),
    "an unguarded header must be expanded at every include site",
  );

  const boundedUnguardedReinclude = new Map(buildGraphSources);
  boundedUnguardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${boundedUnguardedReinclude.get("oxrocksdb-sys/lz4/lib/lz4.c")}
${Array.from(
  { length: 17 },
  (_, index) => `#undef BOUNDED_REINCLUDE_PREFIX
#define BOUNDED_REINCLUDE_PREFIX harmless_${index}_
#include "bounded-reinclude-probe.h"`,
).join("\n")}
`,
  );
  boundedUnguardedReinclude.set(
    "oxrocksdb-sys/lz4/lib/bounded-reinclude-probe.h",
    `#define BOUNDED_REINCLUDE_CAT_DETAIL(left, right) left ## right
#define BOUNDED_REINCLUDE_CAT(left, right) BOUNDED_REINCLUDE_CAT_DETAIL(left, right)
struct BOUNDED_REINCLUDE_CAT(BOUNDED_REINCLUDE_PREFIX, t) { void* rep; };
`,
  );
  assert.ok(
    auditBuildGraphSources(
      buildScriptSource,
      boundedUnguardedReinclude,
      oracle,
    ).some(
      ({ code, subject }) =>
        code === "ambiguous-preprocessor-macro" &&
        subject === "oxrocksdb-sys/lz4/lib/bounded-reinclude-probe.h",
    ),
    "unguarded include expansion must fail closed at its deterministic repetition bound",
  );

  const isolatedTranslationUnits = new Map(buildGraphSources);
  isolatedTranslationUnits.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${isolatedTranslationUnits.get("oxrocksdb-sys/lz4/lib/lz4.c")}
#define TU_ISOLATED_PREFIX rocksdb_
`,
  );
  isolatedTranslationUnits.set(
    "oxrocksdb-sys/api/tu-isolation-probe.cc",
    '#include "tu-isolation-probe.h"\n',
  );
  isolatedTranslationUnits.set(
    "oxrocksdb-sys/api/tu-isolation-probe.h",
    `#define TU_ISOLATED_CAT_DETAIL(left, right) left ## right
#define TU_ISOLATED_CAT(left, right) TU_ISOLATED_CAT_DETAIL(left, right)
struct TU_ISOLATED_CAT(TU_ISOLATED_PREFIX, t) { void* rep; };
`,
  );
  const isolatedBuild = buildScriptSource.replace(
    '.file("api/c.cc")',
    '.file("api/c.cc").file("api/tu-isolation-probe.cc")',
  );
  assert.equal(
    auditBuildGraphSources(
      isolatedBuild,
      isolatedTranslationUnits,
      oracle,
    ).filter(
      ({ code, subject }) =>
        ["ambiguous-preprocessor-macro", "opaque-redefinition"].includes(
          code,
        ) &&
        (subject === "rocksdb_t" || subject.startsWith("TU_ISOLATED_")),
    ).length,
    0,
    "macro state from one translation unit must not enter another",
  );

  const benignComposedCrossFileMirror = new Map(buildGraphSources);
  benignComposedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.h",
    `${benignComposedCrossFileMirror.get("oxrocksdb-sys/lz4/lib/lz4.h")}
#define BENIGN_CAT_DETAIL(left, right) left ## right
#define BENIGN_CAT(left, right) BENIGN_CAT_DETAIL(left, right)
#if UNKNOWN_BUILD_CONFIGURATION
#define BENIGN_PREFIX harmless_
#else
#define BENIGN_PREFIX ordinary_
#endif
#define BENIGN_COMPOSED_HANDLE BENIGN_CAT(BENIGN_PREFIX, t)
`,
  );
  benignComposedCrossFileMirror.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${benignComposedCrossFileMirror.get("oxrocksdb-sys/lz4/lib/lz4.c")}
struct BENIGN_COMPOSED_HANDLE { void* rep; };
`,
  );
  assert.equal(
    auditBuildGraphSources(
      buildScriptSource,
      benignComposedCrossFileMirror,
      oracle,
    ).filter(({ code }) => code === "ambiguous-preprocessor-macro").length,
    0,
  );

  const symlinkEscape = new Map(buildGraphSources);
  symlinkEscape.canonicalRoot = buildGraphSources.canonicalRoot;
  symlinkEscape.realPaths = new Map([
    ["oxrocksdb-sys/lz4/lib/lz4.c", "/tmp/outside-reviewed-source-tree/lz4.c"],
  ]);
  assert.ok(
    codes(auditBuildGraphSources(buildScriptSource, symlinkEscape, oracle)).has(
      "build-path-escape",
    ),
  );
});

test("fails closed for bounded cross-file phase and macro state", async () => {
  const headers = new Map([
    [
      "v14-direct-keyword.h",
      "V14_KW_CAT(str, uct) rocksdb_t { void* rep; };\n",
    ],
    [
      "v14-conditional-guard.h",
      `#ifndef V14_CONDITIONAL_GUARD_H
#define V14_CONDITIONAL_GUARD_H
#define V14_GUARD_CAT_DETAIL(left, right) left ## right
#define V14_GUARD_CAT(left, right) V14_GUARD_CAT_DETAIL(left, right)
struct V14_GUARD_CAT(V14_GUARD_PREFIX, t) { void* rep; };
#endif
`,
    ],
    [
      "v14-guard-else.h",
      `#ifndef V14_GUARD_ELSE_H
#define V14_GUARD_ELSE_H
#else
#define V14_ELSE_CAT_DETAIL(left, right) left ## right
#define V14_ELSE_CAT(left, right) V14_ELSE_CAT_DETAIL(left, right)
struct V14_ELSE_CAT(V14_ELSE_PREFIX, t) { void* rep; };
#endif
`,
    ],
    [
      "v14-deep-parent.h",
      "V14_DEEP_CAT(V14_DEEP_0, V14_DEEP_UCT) rocksdb_writebatch_wi_t { void* rep; };\n",
    ],
    [
      "v14-inactive-pragma.h",
      `#if 0
#pragma once
#endif
#define V14_PRAGMA_CAT_DETAIL(left, right) left ## right
#define V14_PRAGMA_CAT(left, right) V14_PRAGMA_CAT_DETAIL(left, right)
struct V14_PRAGMA_CAT(V14_PRAGMA_PREFIX, t) { void* rep; };
`,
    ],
  ]);
  const deepDefinitions = `${Array.from(
    { length: 35 },
    (_, index) => `#define V14_DEEP_${index} V14_DEEP_${index + 1}`,
  ).join("\n")}
#define V14_DEEP_35 str
#define V14_DEEP_UCT uct
#define V14_DEEP_CAT_DETAIL(left, right) left ## right
#define V14_DEEP_CAT(left, right) V14_DEEP_CAT_DETAIL(left, right)`;
  const translationUnit = `#define V14_KW_CAT(left, right) left ## right
#include "v14-direct-keyword.h"

#define V14_GUARD_PREFIX harmless_
#include "v14-conditional-guard.h"
#define V14_UNKNOWN_GUARD_STATE 1
#if V14_UNKNOWN_GUARD_STATE
#undef V14_CONDITIONAL_GUARD_H
#endif
#undef V14_GUARD_PREFIX
#define V14_GUARD_PREFIX rocksdb_iterator_
#include "v14-conditional-guard.h"

#define V14_ELSE_PREFIX rocksdb_readoptions_
#include "v14-guard-else.h"
#include "v14-guard-else.h"

${deepDefinitions}
#include "v14-deep-parent.h"

#define V14_PRAGMA_PREFIX harmless_
#include "v14-inactive-pragma.h"
#undef V14_PRAGMA_PREFIX
#define V14_PRAGMA_PREFIX rocksdb_column_family_handle_
#include "v14-inactive-pragma.h"
`;
  const preprocessed = await preprocessCppWithHeaders(
    translationUnit,
    headers,
  );
  for (const type of [
    "rocksdb_t",
    "rocksdb_iterator_t",
    "rocksdb_readoptions_t",
    "rocksdb_writebatch_wi_t",
    "rocksdb_column_family_handle_t",
  ]) {
    assert.match(preprocessed, new RegExp(`struct ${type} \\{`, "u"), type);
  }

  const sources = new Map(buildGraphSources);
  sources.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${sources.get("oxrocksdb-sys/lz4/lib/lz4.c")}\n${translationUnit}`,
  );
  for (const [path, bytes] of headers) {
    sources.set(`oxrocksdb-sys/lz4/lib/${path}`, bytes);
  }
  const findings = auditBuildGraphSources(
    buildScriptSource,
    sources,
    oracle,
  );
  for (const subject of [
    "rocksdb_t",
    "rocksdb_iterator_t",
    "rocksdb_column_family_handle_t",
  ]) {
    assert.ok(
      findings.some(
        ({ code, subject: observed }) =>
          code === "opaque-redefinition" && observed === subject,
      ),
      subject,
    );
  }
  assert.ok(
    findings.some(
      ({ code, message }) =>
        code === "ambiguous-preprocessor-macro" &&
        message.includes("rocksdb_readoptions_t"),
    ),
  );
  assert.ok(
    findings.some(
      ({ code, message }) =>
        code === "ambiguous-preprocessor-macro" &&
        message.includes("macro expansion depth exceeded 32"),
    ),
  );
});

test("follows selected digraph includes and guards without inactive credit", async () => {
  const headers = new Map([
    [
      "v15-digraph-guard.h",
      `%:ifndef V15_DIGRAPH_GUARD_H
%:define V15_DIGRAPH_GUARD_H
%:def\\
ine V15_DIGRAPH_CAT_DETAIL(left, right) left %:%: right
%:define V15_DIGRAPH_CAT(left, right) V15_DIGRAPH_CAT_DETAIL(left, right)
%:if 0
struct rocksdb_readoptions_t { void* inactive_rep; };
%:endif
struct V15_DIGRAPH_CAT(V15_DIGRAPH_PREFIX, t) { void* rep; };
%:endif
`,
    ],
    [
      "v15-digraph-once.h",
      `%:pragma once
%:if 0
struct rocksdb_column_family_handle_t { void* inactive_rep; };
%:endif
struct V15_DIGRAPH_CAT(V15_DIGRAPH_ONCE_PREFIX, t) { void* rep; };
`,
    ],
  ]);
  const translationUnit = `%:define V15_DIGRAPH_PREFIX harmless_
%:include "v15-digraph-guard.h"
%:undef V15_DIGRAPH_GUARD_H
%:undef V15_DIGRAPH_PREFIX
%:define V15_DIGRAPH_PREFIX rocksdb_
%:include "v15-digraph-guard.h"

%:define V15_DIGRAPH_ONCE_PREFIX harmless_once_
%:include "v15-digraph-once.h"
%:undef V15_DIGRAPH_ONCE_PREFIX
%:define V15_DIGRAPH_ONCE_PREFIX rocksdb_iterator_
%:include "v15-digraph-once.h"
`;
  const compilerOutput = await preprocessCppWithHeaders(
    translationUnit,
    headers,
  );
  assert.match(compilerOutput, /struct harmless_t \{/u);
  assert.match(compilerOutput, /struct rocksdb_t \{/u);
  assert.match(compilerOutput, /struct harmless_once_t \{/u);
  assert.doesNotMatch(compilerOutput, /rocksdb_iterator_t/u);
  assert.doesNotMatch(compilerOutput, /rocksdb_readoptions_t/u);
  assert.doesNotMatch(compilerOutput, /rocksdb_column_family_handle_t/u);

  const sources = new Map(buildGraphSources);
  sources.set(
    "oxrocksdb-sys/lz4/lib/lz4.c",
    `${sources.get("oxrocksdb-sys/lz4/lib/lz4.c")}\n${translationUnit}`,
  );
  for (const [path, bytes] of headers) {
    sources.set(`oxrocksdb-sys/lz4/lib/${path}`, bytes);
  }
  const findings = auditBuildGraphSources(
    buildScriptSource,
    sources,
    oracle,
  );
  assert.ok(
    findings.some(
      ({ code, subject, line }) =>
        code === "opaque-redefinition" &&
        subject === "rocksdb_t" &&
        line === 9,
    ),
    "the selected header finding must retain its physical line after a digraph directive splice",
  );
  for (const subject of [
    "rocksdb_iterator_t",
    "rocksdb_readoptions_t",
    "rocksdb_column_family_handle_t",
  ]) {
    assert.equal(
      findings.some(
        ({ code, subject: observed }) =>
          ["ambiguous-preprocessor-macro", "opaque-redefinition"].includes(
            code,
          ) && observed === subject,
      ),
      false,
      subject,
    );
  }
});

test("accepts only one atomic multi-CF extension in the upstream-owned unit", () => {
  const apiSource = "";
  const headerSource = ATOMIC_EXTENSION_HEADER;
  const rustSource = ATOMIC_EXTENSION_RUST_CALL;
  const upstreamSource = ATOMIC_OWNER_DEFINITION;
  assert.deepEqual(
    auditRequiredExtension(
      apiSource,
      headerSource,
      rustSource,
      upstreamSource,
      oracle,
    ),
    [],
  );

  const declarationOnly = `
unsafe extern "C" {
  fn oxrocksdb_ingest_external_files(
      db: *mut rocksdb_t,
      list: *const rocksdb_ingestexternalfilearg_t,
      list_len: usize,
      errptr: *mut *mut i8);
}
`;
  const nestedInactive = `
#[cfg(all(any()))]
fn dead() { ${ATOMIC_EXTENSION_RUST_CALL} }
`;
  const cfgAttrInactive = `
#[cfg_attr(all(), cfg_attr(target_os = "linux", cfg(any())))]
fn dead() { ${ATOMIC_EXTENSION_RUST_CALL} }
`;
  const targetInactive = `
#[cfg(target_os = "windows")]
fn dead() { ${ATOMIC_EXTENSION_RUST_CALL} }
`;
  for (const hostileRust of [
    declarationOnly,
    nestedInactive,
    cfgAttrInactive,
    targetInactive,
    `if false { ${ATOMIC_EXTENSION_RUST_CALL} }`,
    `if cfg!(all(any())) { ${ATOMIC_EXTENSION_RUST_CALL} }`,
    `macro_rules! decoy { () => { ${ATOMIC_EXTENSION_RUST_CALL} }; }`,
    "oxrocksdb_ingest_external_files();",
  ]) {
    assert.ok(
      codes(
        auditRequiredExtension(
          apiSource,
          headerSource,
          hostileRust,
          upstreamSource,
          oracle,
        ),
      ).has("required-extension-rust-count"),
    );
  }
  const ancestorDivergentAtomicCall = ATOMIC_EXTENSION_RUST_CALL.replace(
    "  unsafe { ffi_result!",
    "  return;\n  unsafe { ffi_result!",
  );
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource,
        ancestorDivergentAtomicCall,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-rust-count"),
  );
  const directStatusOut = `
use ::oxrocksdb_sys::*;
pub fn ingest(db: *mut rocksdb_t, args: &[rocksdb_ingestexternalfilearg_t]) {
  unsafe { oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len(), errptr); }
}
`;
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource,
        directStatusOut,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-rust-count"),
  );

  const swallowedFfiResult = ATOMIC_EXTENSION_RUST_CALL.replace(
    FFI_RESULT_MACRO,
    `macro_rules! ffi_result {
      ($expression:expr) => {{ let _ = stringify!($expression); }};
    }`,
  );
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource,
        swallowedFfiResult,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-rust-count"),
  );

  const nestedUnusedFfiResult = `
mod unused {
${FFI_RESULT_MACRO}
}
#[macro_use]
mod fake {
  macro_rules! ffi_result {
    ($expression:expr) => {{ let _ = stringify!($expression); }};
  }
}
use ::oxrocksdb_sys::*;
pub fn ingest(db: *mut rocksdb_t, args: &[rocksdb_ingestexternalfilearg_t]) {
  unsafe { ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len())); }
}
`;
  const lateFfiResult = `
use ::oxrocksdb_sys::*;
pub fn ingest(db: *mut rocksdb_t, args: &[rocksdb_ingestexternalfilearg_t]) {
  unsafe { ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len())); }
}
${FFI_RESULT_MACRO}
`;
  const localFfiResult = `
use ::oxrocksdb_sys::*;
pub fn ingest(db: *mut rocksdb_t, args: &[rocksdb_ingestexternalfilearg_t]) {
${FFI_RESULT_MACRO}
  unsafe { ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len())); }
}
`;
  for (const lexicalMacroDecoy of [
    nestedUnusedFfiResult,
    lateFfiResult,
    localFfiResult,
  ]) {
    assert.ok(
      codes(
        auditRequiredExtension(
          apiSource,
          headerSource,
          lexicalMacroDecoy,
          upstreamSource,
          oracle,
        ),
      ).has("required-extension-rust-count"),
      lexicalMacroDecoy,
    );
  }

  const localSymbol = `
use ::oxrocksdb_sys::*;
fn oxrocksdb_ingest_external_files(_: usize, _: usize, _: usize) {}
pub fn ingest() {
  ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len()));
}
`;
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource,
        localSymbol,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-rust-count"),
  );

  const unreachableSymbol = `
use ::oxrocksdb_sys::*;
fn unreachable_decoy() {
  ffi_result!(oxrocksdb_ingest_external_files(db, args.as_ptr(), args.len()));
}
`;
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource,
        unreachableSymbol,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-rust-count"),
  );
  assert.ok(
    codes(
      auditRequiredExtension(
        apiSource,
        headerSource.replace("rocksdb_t* db", "void* db"),
        rustSource,
        upstreamSource,
        oracle,
      ),
    ).has("required-extension-header-signature"),
  );
});

test("compiles and executes the atomic extension with exact C linkage", async (t) => {
  assert.deepEqual(
    auditRequiredExtension(
      "",
      ATOMIC_EXTENSION_HEADER,
      ATOMIC_EXTENSION_RUST_CALL,
      ATOMIC_EXTENSION_FIXTURE,
      oracle,
    ),
    [],
  );
  const plain = await compileAndRunAtomicExtensionFixture(
    ATOMIC_EXTENSION_FIXTURE,
  );
  if (!plain.available) {
    t.skip(plain.reason);
    return;
  }
  assert.deepEqual(
    {
      phase: plain.phase,
      status: plain.status,
      signal: plain.signal,
      stdout: plain.stdout,
      stderr: plain.stderr,
      hasExactCLinkage: plain.hasExactCLinkage,
    },
    {
      phase: "execute",
      status: 0,
      signal: null,
      stdout: "",
      stderr: "",
      hasExactCLinkage: true,
    },
  );

  const extracted = extractAtomicOwnerDefinition(
    ATOMIC_OWNER_DEFINITION,
    oracle.requiredExtension.symbol,
  );
  assert.deepEqual(
    {
      source: extracted?.source,
      linkage: extracted?.linkage,
      sha256: extracted?.sha256,
    },
    {
      source: ATOMIC_OWNER_DEFINITION.trim(),
      linkage: "direct",
      sha256: digest(Buffer.from(ATOMIC_OWNER_DEFINITION.trim())),
    },
  );
  const actualOwner = await compileAndRunAtomicOwnerSource(
    ATOMIC_OWNER_DEFINITION,
  );
  assert.equal(actualOwner.available, true);
  assert.equal(actualOwner.phase, "execute", JSON.stringify(actualOwner));
  assert.equal(actualOwner.status, 0, JSON.stringify(actualOwner));
  assert.equal(actualOwner.signal, null, JSON.stringify(actualOwner));
  assert.equal(actualOwner.hasExactCLinkage, true);

  const boundedExecution = await compileAndRunAtomicExtensionFixture(
    `extern "C" void oxrocksdb_ingest_external_files() {}\nint main() { for (;;) {} }`,
    { timeouts: { execute: 100 } },
  );
  assert.deepEqual(
    {
      available: boundedExecution.available,
      phase: boundedExecution.phase,
      status: boundedExecution.status,
      timedOut: boundedExecution.timedOut,
      errorCode: boundedExecution.errorCode,
      stderr: boundedExecution.stderr,
      hasExactCLinkage: boundedExecution.hasExactCLinkage,
    },
    {
      available: true,
      phase: "execute",
      status: null,
      timedOut: true,
      errorCode: "ETIMEDOUT",
      stderr: "execute timed out after 100ms",
      hasExactCLinkage: true,
    },
  );

  const missingSymbolInspector = await compileAndRunAtomicExtensionFixture(
    ATOMIC_EXTENSION_FIXTURE,
    {
      symbolInspector: "missing-opaque-contract-symbol-inspector",
    },
  );
  assert.deepEqual(missingSymbolInspector, {
    available: false,
    phase: "symbols",
    reason: "missing-opaque-contract-symbol-inspector is unavailable",
  });

  const timeoutToolRoot = await mkdtemp(
    join(tmpdir(), "oxigraph-opaque-timeout-tool-"),
  );
  const timeoutTool = join(timeoutToolRoot, "hang");
  try {
    await writeFile(timeoutTool, "#!/bin/sh\nwhile :; do :; done\n", {
      encoding: "utf8",
      mode: 0o700,
    });
    const boundedCompilation = await compileAndRunAtomicExtensionFixture(
      ATOMIC_EXTENSION_FIXTURE,
      { compiler: timeoutTool, timeouts: { compile: 100 } },
    );
    assert.deepEqual(
      {
        available: boundedCompilation.available,
        phase: boundedCompilation.phase,
        status: boundedCompilation.status,
        timedOut: boundedCompilation.timedOut,
        errorCode: boundedCompilation.errorCode,
        stderr: boundedCompilation.stderr,
      },
      {
        available: true,
        phase: "compile",
        status: null,
        timedOut: true,
        errorCode: "ETIMEDOUT",
        stderr: "compile timed out after 100ms",
      },
    );
    const boundedSymbols = await compileAndRunAtomicExtensionFixture(
      ATOMIC_EXTENSION_FIXTURE,
      { symbolInspector: timeoutTool, timeouts: { symbols: 100 } },
    );
    assert.deepEqual(
      {
        available: boundedSymbols.available,
        phase: boundedSymbols.phase,
        status: boundedSymbols.status,
        timedOut: boundedSymbols.timedOut,
        errorCode: boundedSymbols.errorCode,
        stderr: boundedSymbols.stderr,
      },
      {
        available: true,
        phase: "symbols",
        status: null,
        timedOut: true,
        errorCode: "ETIMEDOUT",
        stderr: "symbols timed out after 100ms",
      },
    );
  } finally {
    await rm(timeoutToolRoot, { recursive: true, force: true });
  }
});

test("executes ASan and UBSan controls for the owner extension fixture", async (t) => {
  for (const gate of oracle.futureGreenGates) {
    const result = await compileAndRunAtomicOwnerSource(
      ATOMIC_OWNER_DEFINITION,
      { sanitizerFlag: gate.compilerFlag },
    );
    if (!result.available) {
      t.skip(`${gate.id}: ${result.reason}`);
      continue;
    }
    assert.equal(result.phase, "execute", JSON.stringify(result));
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(result.signal, null, JSON.stringify(result));
    assert.equal(result.hasExactCLinkage, true);
    assert.equal(
      /AddressSanitizer|LeakSanitizer|UndefinedBehaviorSanitizer|runtime error/u.test(
        result.stderr,
      ),
      false,
      result.stderr,
    );
  }
});

test("rejects non-C signatures and non-live owner implementations", async (t) => {
  const enclosingOwner = `
extern "C" {
${ATOMIC_OWNER_DEFINITION.replace('extern "C" ', "")}
}
`;
  const enclosing = extractAtomicOwnerDefinition(
    enclosingOwner,
    oracle.requiredExtension.symbol,
  );
  assert.equal(enclosing?.linkage, "enclosing");
  const enclosingResult = await compileAndRunAtomicOwnerSource(enclosingOwner);
  if (!enclosingResult.available) {
    t.skip(enclosingResult.reason);
    return;
  }
  assert.equal(enclosingResult.status, 0, JSON.stringify(enclosingResult));
  assert.equal(enclosingResult.hasExactCLinkage, true);

  const missingCLinkage = ATOMIC_OWNER_DEFINITION.replace('extern "C" ', "");
  const wrongParameter = ATOMIC_OWNER_DEFINITION.replace(
    "const size_t list_len",
    "unsigned list_len",
  );
  for (const source of [missingCLinkage, wrongParameter]) {
    assert.equal(
      extractAtomicOwnerDefinition(source, oracle.requiredExtension.symbol),
      null,
    );
    const result = await compileAndRunAtomicOwnerSource(source);
    assert.deepEqual(
      { phase: result.phase, status: result.status },
      { phase: "extract", status: 1 },
    );
    assert.ok(
      codes(auditRequiredExtension("", "x();", "x();", source, oracle)).has(
        "required-extension-signature",
      ),
    );
  }

  const nonLiveMutants = [
    ATOMIC_OWNER_DEFINITION.replace(
      "  vector<rocksdb::IngestExternalFileArg> args(list_len);",
      "  if (list_len > 0) return;\n  vector<rocksdb::IngestExternalFileArg> args(list_len);",
    ),
    ATOMIC_OWNER_DEFINITION.replace(
      "for (size_t i = 0; i < list_len; ++i)",
      "for (size_t i = list_len; i < list_len; ++i)",
    ),
    ATOMIC_OWNER_DEFINITION.replace(
      "SaveError(errptr, db->rep->IngestExternalFiles(args));",
      "db->rep->IngestExternalFiles(args);",
    ),
    ATOMIC_OWNER_DEFINITION.replace(
      "  vector<rocksdb::IngestExternalFileArg> args(list_len);",
      "  if (list_len != 2) return;\n  vector<rocksdb::IngestExternalFileArg> args(list_len);",
    ),
    ATOMIC_OWNER_DEFINITION.replace(
      "vector<rocksdb::IngestExternalFileArg> args(list_len);",
      "vector<rocksdb::IngestExternalFileArg> args(5);",
    ),
  ];
  for (const source of nonLiveMutants) {
    const result = await compileAndRunAtomicOwnerSource(source);
    assert.equal(result.available, true);
    assert.notEqual(result.status, 0, JSON.stringify(result));
  }
  const untestedCountBranch = ATOMIC_OWNER_DEFINITION.replace(
    "  SaveError(errptr, db->rep->IngestExternalFiles(args));",
    "  if (list_len == 6) args.clear();\n  SaveError(errptr, db->rep->IngestExternalFiles(args));",
  );
  const untestedCountExecution =
    await compileAndRunAtomicOwnerSource(untestedCountBranch);
  assert.equal(untestedCountExecution.available, true);
  assert.equal(
    untestedCountExecution.status,
    0,
    JSON.stringify(untestedCountExecution),
  );
  assert.ok(
    codes(
      auditRequiredExtension(
        "",
        ATOMIC_EXTENSION_HEADER,
        ATOMIC_EXTENSION_RUST_CALL,
        untestedCountBranch,
        oracle,
      ),
    ).has("multi-cf-ingest-not-general-list-len"),
  );
  const executableFindings = await auditAtomicOwnerExecution(
    nonLiveMutants.at(-1),
    oracle,
  );
  assert.deepEqual(
    executableFindings.map(({ code, subject }) => [code, subject]),
    [
      ["atomic-owner-executable-contract", "plain"],
      ["atomic-owner-executable-contract", "address-sanitizer"],
      ["atomic-owner-executable-contract", "undefined-behavior-sanitizer"],
    ],
  );
  const neverExecuteOwner = ATOMIC_OWNER_DEFINITION.replace(
    "  SaveError(errptr, db->rep->IngestExternalFiles(args));",
    "  for (;;) {}",
  );
  assert.deepEqual(
    await auditAtomicOwnerExecution(neverExecuteOwner, oracle, {
      staticFindings: [{ code: "static-rejection" }],
    }),
    [],
  );

  assert.ok(
    codes(
      auditRequiredExtension(
        "",
        ATOMIC_EXTENSION_HEADER,
        ATOMIC_EXTENSION_RUST_CALL,
        nonLiveMutants.at(-2),
        oracle,
      ),
    ).has("multi-cf-ingest-not-general-list-len"),
  );
  assert.ok(
    codes(
      auditRequiredExtension(
        "",
        ATOMIC_EXTENSION_HEADER,
        ATOMIC_EXTENSION_RUST_CALL,
        nonLiveMutants.at(-1),
        oracle,
      ),
    ).has("multi-cf-ingest-not-general-list-len"),
  );
});

test("rejects dead atomic calls and unused argument-name decoys", () => {
  const header = ATOMIC_EXTENSION_HEADER;
  const rust = ATOMIC_EXTENSION_RUST_CALL;
  const deadCall = `
extern "C" void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr) {
  vector<IngestExternalFileArg> args(list_len);
  for (size_t i = 0; i < list_len; ++i) {
    args[i].column_family = list[i].column_family->rep;
    args[i].external_files.assign(
        list[i].external_files,
        list[i].external_files + list[i].external_files_len);
    args[i].options = list[i].options->rep;
  }
  if (false) { SaveError(errptr, db->rep->IngestExternalFiles(args)); }
}
`;
  assert.ok(
    codes(auditRequiredExtension("", header, rust, deadCall, oracle)).has(
      "multi-cf-ingest-not-single-atomic-call",
    ),
  );

  const unusedNames = `
extern "C" void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr) {
  if (false) SaveError(errptr, db->rep->IngestExternalFiles(args));
  auto column_family = list[0].column_family;
  auto external_files = list[0].external_files;
  auto options = list[0].options;
  auto count = list_len;
}
`;
  const findings = auditRequiredExtension(
    "",
    header,
    rust,
    unusedNames,
    oracle,
  );
  assert.ok(codes(findings).has("multi-cf-ingest-not-single-atomic-call"));
  assert.ok(codes(findings).has("multi-cf-ingest-argument-lifetime"));

  const deadAssembly = `
extern "C" void oxrocksdb_ingest_external_files(
    rocksdb_t* db, const rocksdb_ingestexternalfilearg_t* list,
    const size_t list_len, char** errptr) {
  vector<IngestExternalFileArg> args(list_len);
  if (false) {
    for (size_t i = 0; i < list_len; ++i) {
      args[i].column_family = list[i].column_family->rep;
      args[i].external_files.assign(
          list[i].external_files,
          list[i].external_files + list[i].external_files_len);
      args[i].options = list[i].options->rep;
    }
  }
  SaveError(errptr, db->rep->IngestExternalFiles(args));
}
`;
  assert.ok(
    codes(auditRequiredExtension("", header, rust, deadAssembly, oracle)).has(
      "multi-cf-ingest-argument-lifetime",
    ),
  );

  const duplicateStatus = ATOMIC_OWNER_DEFINITION.replace(
    "SaveError(errptr, db->rep->IngestExternalFiles(args));",
    "SaveError(errptr, 0);\n  SaveError(errptr, db->rep->IngestExternalFiles(args));",
  );
  assert.ok(
    codes(
      auditRequiredExtension("", header, rust, duplicateStatus, oracle),
    ).has("multi-cf-ingest-status-wrapper"),
  );
});

test("rejects a multi-CF extension in the external shim unit", () => {
  const definition = `
void oxrocksdb_ingest_external_files(
    rocksdb_t*, const rocksdb_ingestexternalfilearg_t*, size_t, char**) {}
`;
  const findings = auditRequiredExtension(
    definition,
    ATOMIC_EXTENSION_HEADER,
    ATOMIC_EXTENSION_RUST_CALL,
    "",
    oracle,
  );
  assert.ok(codes(findings).has("required-extension-wrong-owner"));
  assert.ok(codes(findings).has("required-extension-owner-count"));
});

test("executes exact owner retention and destruction-order predicates", async (t) => {
  const localLifecycleStubs = `
unsafe fn rocksdb_readoptions_destroy(_: usize) {
  EVENTS.lock().unwrap().push(1);
}
unsafe fn rocksdb_release_snapshot(_: usize, _: usize) {
  EVENTS.lock().unwrap().push(2);
}
unsafe fn rocksdb_iter_destroy(_: usize) {
  EVENTS.lock().unwrap().push(3);
}
unsafe fn rocksdb_writebatch_wi_destroy(_: usize) {
  EVENTS.lock().unwrap().push(4);
}
unsafe fn rocksdb_pinnable_handle_destroy(_: usize) {
  EVENTS.lock().unwrap().push(5);
}
`;
  const validExecution = `
use std::sync::Mutex;

static EVENTS: Mutex<Vec<u8>> = Mutex::new(Vec::new());

${localLifecycleStubs}

struct Iter {
  inner: usize,
  _upper_bound: Option<Vec<u8>>,
  _reader: usize,
  options: usize,
}
struct Reader { options: usize }
struct SnapshotReader { db: usize, snapshot: usize }
struct ReadableTransaction {
  db: usize,
  batch: usize,
  read_options: usize,
  snapshot: usize,
}
struct PinnableSlice(usize);
impl Drop for Reader {
  fn drop(&mut self) {
    unsafe { rocksdb_readoptions_destroy(self.options); }
  }
}
impl Drop for SnapshotReader {
  fn drop(&mut self) {
    unsafe { rocksdb_release_snapshot(self.db, self.snapshot); }
  }
}
impl Drop for Iter {
  fn drop(&mut self) {
    unsafe {
      rocksdb_iter_destroy(self.inner);
      rocksdb_readoptions_destroy(self.options);
    }
  }
}
impl Drop for ReadableTransaction {
  fn drop(&mut self) {
    unsafe {
      rocksdb_writebatch_wi_destroy(self.batch);
      rocksdb_readoptions_destroy(self.read_options);
      rocksdb_release_snapshot(self.db, self.snapshot);
    }
  }
}
impl Drop for PinnableSlice {
  fn drop(&mut self) {
    unsafe { rocksdb_pinnable_handle_destroy(self.0); }
  }
}

fn take_events() -> Vec<u8> {
  let mut events = EVENTS.lock().unwrap();
  std::mem::take(&mut *events)
}

fn main() {
  drop(Reader { options: 1 });
  assert_eq!(take_events(), vec![1]);
  drop(SnapshotReader { db: 2, snapshot: 3 });
  assert_eq!(take_events(), vec![2]);
  drop(Iter {
    inner: 4,
    _upper_bound: Some(vec![1]),
    _reader: 5,
    options: 6,
  });
  assert_eq!(take_events(), vec![3, 1]);
  drop(ReadableTransaction {
    db: 7,
    batch: 8,
    read_options: 9,
    snapshot: 10,
  });
  assert_eq!(take_events(), vec![4, 1, 2]);
  drop(PinnableSlice(11));
  assert_eq!(take_events(), vec![5]);
}
`;
  const validAudit = validExecution.replace(
    localLifecycleStubs,
    "use ::oxrocksdb_sys::*;\n",
  );
  assert.deepEqual(auditLifecycle(validAudit), []);
  assert.ok(
    codes(auditLifecycle(validExecution)).has("lifecycle-external-binding"),
  );
  const execution = await compileAndRunLifecycleFixture(validExecution);
  if (!execution.available) {
    t.skip(execution.reason);
    return;
  }
  assert.deepEqual(
    {
      phase: execution.phase,
      status: execution.status,
      signal: execution.signal,
      stdout: execution.stdout,
      stderr: execution.stderr,
    },
    {
      phase: "execute",
      status: 0,
      signal: null,
      stdout: "",
      stderr: "",
    },
  );
  const boundedLifecycleExecution = await compileAndRunLifecycleFixture(
    "fn main() { loop {} }",
    { timeouts: { execute: 100 } },
  );
  assert.deepEqual(
    {
      available: boundedLifecycleExecution.available,
      phase: boundedLifecycleExecution.phase,
      status: boundedLifecycleExecution.status,
      timedOut: boundedLifecycleExecution.timedOut,
      errorCode: boundedLifecycleExecution.errorCode,
      stderr: boundedLifecycleExecution.stderr,
    },
    {
      available: true,
      phase: "execute",
      status: null,
      timedOut: true,
      errorCode: "ETIMEDOUT",
      stderr: "execute timed out after 100ms",
    },
  );

  const duplicateDestroy = validAudit.replace(
    "rocksdb_iter_destroy(self.inner);",
    "rocksdb_iter_destroy(self.inner); rocksdb_iter_destroy(self.inner);",
  );

  const precedingCall = validAudit.replace(
    "unsafe { rocksdb_readoptions_destroy(self.options); }",
    "take_events();\n    unsafe { rocksdb_readoptions_destroy(self.options); }",
  );
  assert.ok(
    auditLifecycle(precedingCall).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Reader",
    ),
  );

  const shadowedLanguageTrait = `
trait Drop { fn drop(&mut self); }
${validAudit}
`;
  assert.ok(
    auditLifecycle(shadowedLanguageTrait).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Reader",
    ),
  );

  const qualifiedLocalDropTrait = `
use ::oxrocksdb_sys::*;
mod scope {
  mod std { pub mod ops { pub trait Drop { fn drop(&mut self); } } }
  struct Iter { inner: usize, _upper_bound: usize, _reader: usize, options: usize }
  struct Reader { options: usize }
  struct SnapshotReader { db: usize, snapshot: usize }
  struct ReadableTransaction {
    db: usize, batch: usize, read_options: usize, snapshot: usize
  }
  struct PinnableSlice(usize);
  impl std::ops::Drop for Reader {
    fn drop(&mut self) { unsafe { rocksdb_readoptions_destroy(self.options); } }
  }
  impl std::ops::Drop for SnapshotReader {
    fn drop(&mut self) { unsafe { rocksdb_release_snapshot(self.db, self.snapshot); } }
  }
  impl std::ops::Drop for Iter {
    fn drop(&mut self) {
      unsafe { rocksdb_iter_destroy(self.inner); rocksdb_readoptions_destroy(self.options); }
    }
  }
  impl std::ops::Drop for ReadableTransaction {
    fn drop(&mut self) {
      unsafe {
        rocksdb_writebatch_wi_destroy(self.batch);
        rocksdb_readoptions_destroy(self.read_options);
        rocksdb_release_snapshot(self.db, self.snapshot);
      }
    }
  }
  impl std::ops::Drop for PinnableSlice {
    fn drop(&mut self) { unsafe { rocksdb_pinnable_handle_destroy(self.0); } }
  }
}
`;
  assert.ok(
    auditLifecycle(qualifiedLocalDropTrait).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Reader",
    ),
  );
  assert.deepEqual(
    auditLifecycle(
      qualifiedLocalDropTrait.replaceAll(
        "impl std::ops::Drop",
        "impl ::std::ops::Drop",
      ),
    ),
    [],
  );
  assert.ok(
    auditLifecycle(duplicateDestroy).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Iter",
    ),
  );

  const reversed = validAudit.replace(
    "rocksdb_writebatch_wi_destroy(self.batch);\n      rocksdb_readoptions_destroy(self.read_options);",
    "rocksdb_readoptions_destroy(self.read_options);\n      rocksdb_writebatch_wi_destroy(self.batch);",
  );
  assert.ok(
    auditLifecycle(reversed).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "ReadableTransaction",
    ),
  );

  const droppedOwner = validAudit.replace("_upper_bound: Option<Vec<u8>>,", "");
  assert.ok(
    auditLifecycle(droppedOwner).some(
      ({ code, subject }) =>
        code === "iterator-owner-missing" && subject === "_upper_bound",
    ),
  );

  const hiddenDestroy = validAudit.replace(
    "unsafe { rocksdb_readoptions_destroy(self.options); }",
    "if false { unsafe { rocksdb_readoptions_destroy(self.options); } }",
  );
  assert.ok(
    auditLifecycle(hiddenDestroy).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Reader",
    ),
  );
  const hiddenExecution = await compileAndRunLifecycleFixture(
    validExecution.replace(
      "unsafe { rocksdb_readoptions_destroy(self.options); }",
      "if false { unsafe { rocksdb_readoptions_destroy(self.options); } }",
    ),
  );
  assert.equal(hiddenExecution.available, true);
  assert.notEqual(hiddenExecution.status, 0, JSON.stringify(hiddenExecution));

  const earlyReturn = validAudit.replace(
    "unsafe { rocksdb_readoptions_destroy(self.options); }",
    "if self.options != 0 { return; }\n    unsafe { rocksdb_readoptions_destroy(self.options); }",
  );
  assert.ok(
    auditLifecycle(earlyReturn).some(
      ({ code, subject }) =>
        code === "lifecycle-drop-order" && subject === "Reader",
    ),
  );
  const earlyExecution = await compileAndRunLifecycleFixture(
    validExecution.replace(
      "unsafe { rocksdb_readoptions_destroy(self.options); }",
      "if self.options != 0 { return; }\n    unsafe { rocksdb_readoptions_destroy(self.options); }",
    ),
  );
  assert.equal(earlyExecution.available, true);
  assert.notEqual(earlyExecution.status, 0, JSON.stringify(earlyExecution));

  for (const divergence of [
    'panic!("before destroy");',
    'assert!(false, "before destroy");',
    'debug_assert!(false, "before destroy");',
    "std::process::abort();",
    "std::process::exit(9);",
    "while true {}",
    "loop {}",
    "unreachable!();",
  ]) {
    const divergent = validAudit.replace(
      "unsafe { rocksdb_readoptions_destroy(self.options); }",
      `${divergence}\n    unsafe { rocksdb_readoptions_destroy(self.options); }`,
    );
    assert.ok(
      auditLifecycle(divergent).some(
        ({ code, subject }) =>
          code === "lifecycle-drop-order" && subject === "Reader",
      ),
      divergence,
    );
  }

  for (const hostileArgument of [
    '{ assert!(false, "argument divergence"); self.options }',
    "{ std::process::abort(); self.options }",
    "{ unreachable!(); self.options }",
  ]) {
    const divergentArgument = validAudit.replace(
      "rocksdb_readoptions_destroy(self.options)",
      `rocksdb_readoptions_destroy(${hostileArgument})`,
    );
    assert.ok(
      auditLifecycle(divergentArgument).some(
        ({ code, subject }) =>
          code === "lifecycle-drop-order" && subject === "Reader",
      ),
      hostileArgument,
    );
  }
});

test("the exact integrated product is RED for the opaque bridge, not identity drift", async () => {
  const result = await evaluateRocksdbOpaqueCContract(REPOSITORY_ROOT);
  assert.equal(result.status, "FAIL");
  assert.equal(result.findingCount, 77);
  assert.deepEqual(result.upstream, {
    tag: "v11.1.2",
    commit: "3b446089141659fad25328c5ea3e7ed283df46e4",
    observedHead: "3b446089141659fad25328c5ea3e7ed283df46e4",
  });
  const findingCodes = codes(result.findings);
  assert.equal(findingCodes.has("upstream-identity-unrecognized"), false);
  assert.equal(findingCodes.has("baseline-source-drift"), false);
  assert.ok(findingCodes.has("opaque-redefinition"));
  assert.ok(findingCodes.has("baseline-layout-divergence"));
  assert.ok(findingCodes.has("candidate-layout-divergence"));
  assert.ok(findingCodes.has("replaceable-custom-shim"));
  assert.ok(findingCodes.has("required-extension-wrong-owner"));
  assert.ok(findingCodes.has("required-extension-owner-count"));
  assert.ok(findingCodes.has("lifecycle-drop-order"));
  const inventory = [
    ...result.findings.reduce((entries, { code, subject }) => {
      const key = `${code}:${subject}`;
      entries.set(key, (entries.get(key) ?? 0) + 1);
      return entries;
    }, new Map()),
  ];
  assert.deepEqual(inventory, [
    ["opaque-redefinition:rocksdb_t", 1],
    ["opaque-redefinition:rocksdb_iterator_t", 1],
    ["opaque-redefinition:rocksdb_column_family_handle_t", 1],
    ["baseline-layout-divergence:rocksdb_column_family_handle_t", 1],
    ["candidate-layout-divergence:rocksdb_column_family_handle_t", 1],
    ["opaque-redefinition:rocksdb_writebatch_wi_t", 1],
    ["opaque-redefinition:rocksdb_ingestexternalfileoptions_t", 1],
    ["opaque-redefinition:rocksdb_readoptions_t", 1],
    ["candidate-layout-divergence:rocksdb_readoptions_t", 1],
    ["private-cpp-type-outside-owner:DB", 1],
    ["private-cpp-type-outside-owner:Iterator", 1],
    ["private-cpp-type-outside-owner:ColumnFamilyHandle", 1],
    ["private-cpp-type-outside-owner:WriteBatchWithIndex", 1],
    ["private-cpp-type-outside-owner:IngestExternalFileOptions", 1],
    ["private-cpp-type-outside-owner:ReadOptions", 1],
    ["opaque-representation-access:rep", 27],
    ["opaque-construction-outside-owner:rocksdb_iterator_t", 1],
    ["opaque-construction-outside-owner:rocksdb_readoptions_t", 1],
    [
      "replaceable-custom-shim:oxrocksdb_writebatch_wi_create_iterator_with_base_readopts_cf",
      1,
    ],
    ["replaceable-custom-shim:oxrocksdb_get_pinned_cf_v2", 1],
    ["replaceable-custom-shim:oxrocksdb_pinnable_handle_get_value", 1],
    ["replaceable-custom-shim:oxrocksdb_pinnable_handle_destroy", 1],
    ["replaceable-custom-shim:oxrocksdb_get_into_buffer_cf", 1],
    ["replaceable-custom-shim:oxrocksdb_iter_key_slice", 1],
    ["replaceable-custom-shim:oxrocksdb_writebatch_wi_get_into_buffer_cf", 1],
    ["replaceable-custom-shim:oxrocksdb_writebatch_wi_get_pinned_cf_v2", 1],
    ["replaceable-custom-shim:oxrocksdb_readoptions_create_copy", 1],
    [
      "public-replacement-not-wired:rocksdb_writebatch_wi_create_iterator_with_base_cf_readopts",
      1,
    ],
    ["public-replacement-not-wired:rocksdb_get_pinned_cf_v2", 1],
    ["public-replacement-not-wired:rocksdb_pinnable_handle_get_value", 1],
    ["public-replacement-not-wired:rocksdb_pinnable_handle_destroy", 1],
    ["public-replacement-not-wired:rocksdb_get_into_buffer_cf", 1],
    ["public-replacement-not-wired:rocksdb_iter_key_slice", 1],
    [
      "public-replacement-not-wired:rocksdb_writebatch_wi_get_pinned_from_batch_and_db_cf",
      1,
    ],
    ["public-replacement-not-wired:rocksdb_pinnableslice_value", 1],
    ["public-replacement-not-wired:rocksdb_pinnableslice_destroy", 1],
    ["public-replacement-not-wired:rocksdb_readoptions_create", 1],
    ["public-replacement-not-wired:rocksdb_readoptions_set_async_io", 1],
    ["public-replacement-not-wired:rocksdb_readoptions_set_snapshot", 1],
    [
      "public-replacement-not-wired:rocksdb_readoptions_set_iterate_upper_bound",
      1,
    ],
    ["public-replacement-not-wired:rocksdb_readoptions_destroy", 1],
    ["lifecycle-external-binding:Reader", 1],
    ["lifecycle-external-binding:SnapshotReader", 1],
    ["lifecycle-external-binding:Iter", 1],
    ["lifecycle-drop-order:ReadableTransaction", 1],
    ["lifecycle-external-binding:ReadableTransaction", 1],
    ["lifecycle-drop-order:PinnableSlice", 1],
    ["lifecycle-external-binding:PinnableSlice", 1],
    ["required-extension-wrong-owner:oxrocksdb_ingest_external_files", 1],
    ["required-extension-owner-count:oxrocksdb_ingest_external_files", 1],
    ["required-extension-rust-count:oxrocksdb_ingest_external_files", 1],
  ]);
});

test("the scanner preserves nested type boundaries", () => {
  const definitions = findCompleteTypeDefinitions(
    tokenizeCode("struct A { struct B { int x; }; void f() { if (x) {} } };"),
  );
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ["A", "B"],
  );
});
