#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    clippy::expect_used,
    clippy::panic,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "the fail-closed integration evaluator reports exact storage-contract drift"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::Store;
use std::error::Error;
use tempfile::TempDir;

const STORE_SOURCE: &str = include_str!("../src/store.rs");
const STORE_TEST_SOURCE: &str = include_str!("store.rs");
const STORAGE_MOD_SOURCE: &str = include_str!("../src/storage/mod.rs");
const ROCKSDB_STORAGE_SOURCE: &str = include_str!("../src/storage/rocksdb.rs");
const ROCKSDB_WRAPPER_SOURCE: &str = include_str!("../src/storage/rocksdb_wrapper.rs");
// Primary contract evidence from the pinned RocksDB v11.1.2 gitlink
// 3b446089141659fad25328c5ea3e7ed283df46e4.
const ROCKSDB_V11_1_2_DB_HEADER: &str =
    include_str!("../../../oxrocksdb-sys/rocksdb/include/rocksdb/db.h");

fn blank_non_newlines(output: &mut [u8], start: usize, end: usize) {
    for byte in &mut output[start..end] {
        if *byte != b'\n' && *byte != b'\r' {
            *byte = b' ';
        }
    }
}

fn raw_string_end(source: &[u8], start: usize) -> Option<usize> {
    if start > 0 && (source[start - 1].is_ascii_alphanumeric() || source[start - 1] == b'_') {
        return None;
    }
    let mut cursor = if source.get(start) == Some(&b'r') {
        start + 1
    } else if matches!(source.get(start), Some(b'b' | b'c')) && source.get(start + 1) == Some(&b'r')
    {
        start + 2
    } else {
        return None;
    };
    let hash_start = cursor;
    while source.get(cursor) == Some(&b'#') {
        cursor += 1;
    }
    let hash_count = cursor - hash_start;
    if source.get(cursor) != Some(&b'"') {
        return None;
    }
    cursor += 1;
    while cursor < source.len() {
        if source[cursor] == b'"'
            && source.get(cursor + 1..cursor + 1 + hash_count)
                == Some(&source[hash_start..hash_start + hash_count])
        {
            return Some(cursor + 1 + hash_count);
        }
        cursor += 1;
    }
    Some(source.len())
}

fn quoted_string_end(source: &[u8], start: usize) -> Option<usize> {
    let quote = if source.get(start) == Some(&b'"') {
        start
    } else if matches!(source.get(start), Some(b'b' | b'c')) && source.get(start + 1) == Some(&b'"')
    {
        start + 1
    } else {
        return None;
    };
    let mut cursor = quote + 1;
    while cursor < source.len() {
        if source[cursor] == b'\\' {
            cursor = (cursor + 2).min(source.len());
        } else if source[cursor] == b'"' {
            return Some(cursor + 1);
        } else {
            cursor += 1;
        }
    }
    Some(source.len())
}

fn character_literal_end(source: &[u8], start: usize) -> Option<usize> {
    if source.get(start) != Some(&b'\'') {
        return None;
    }
    let first = *source.get(start + 1)?;
    if first.is_ascii_alphabetic() || first == b'_' {
        let mut cursor = start + 2;
        while source
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            cursor += 1;
        }
        return (source.get(cursor) == Some(&b'\'')).then_some(cursor + 1);
    }
    let mut cursor = start + 1;
    while cursor < source.len() && source[cursor] != b'\n' && source[cursor] != b'\r' {
        if source[cursor] == b'\\' {
            cursor = (cursor + 2).min(source.len());
        } else if source[cursor] == b'\'' {
            return Some(cursor + 1);
        } else {
            cursor += 1;
        }
    }
    None
}

fn executable_rust(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut output = bytes.to_vec();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes.get(cursor..cursor + 2) == Some(b"//") {
            let end = bytes[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(bytes.len(), |offset| cursor + offset);
            blank_non_newlines(&mut output, cursor, end);
            cursor = end;
        } else if bytes.get(cursor..cursor + 2) == Some(b"/*") {
            let mut end = cursor + 2;
            let mut depth = 1_usize;
            while end < bytes.len() && depth > 0 {
                if bytes.get(end..end + 2) == Some(b"/*") {
                    depth += 1;
                    end += 2;
                } else if bytes.get(end..end + 2) == Some(b"*/") {
                    depth -= 1;
                    end += 2;
                } else {
                    end += 1;
                }
            }
            blank_non_newlines(&mut output, cursor, end);
            cursor = end;
        } else if let Some(end) = raw_string_end(bytes, cursor) {
            blank_non_newlines(&mut output, cursor, end);
            cursor = end;
        } else if let Some(end) = quoted_string_end(bytes, cursor) {
            blank_non_newlines(&mut output, cursor, end);
            cursor = end;
        } else if let Some(end) = character_literal_end(bytes, cursor) {
            blank_non_newlines(&mut output, cursor, end);
            cursor = end;
        } else {
            cursor += 1;
        }
    }
    String::from_utf8(output).expect("masking Rust source with ASCII spaces preserves UTF-8")
}

fn executable_line_offsets(source: &str, line_start: &str) -> Vec<usize> {
    let code = executable_rust(source);
    let mut offsets = Vec::new();
    let mut offset = 0;
    for line in code.split_inclusive('\n') {
        if line.trim_start().starts_with(line_start) {
            offsets.push(offset);
        }
        offset += line.len();
    }
    offsets
}

fn unique_executable_declaration(source: &str, declaration: &str) -> usize {
    let offsets = executable_line_offsets(source, declaration);
    assert_eq!(
        offsets.len(),
        1,
        "expected exactly one executable line starting with {declaration:?}, found {}",
        offsets.len()
    );
    offsets[0]
}

fn method_docs(source: &str, declaration: &str) -> String {
    let declaration_offset = unique_executable_declaration(source, declaration);
    let mut docs = Vec::new();
    let mut found_doc = false;
    for line in source[..declaration_offset].lines().rev() {
        let line = line.trim();
        if let Some(line) = line.strip_prefix("///") {
            found_doc = true;
            docs.push(line.trim());
        } else if !line.starts_with("#[") && (found_doc || !line.is_empty()) {
            break;
        }
    }
    assert!(found_doc, "missing documentation for {declaration:?}");
    docs.reverse();
    docs.join(" ")
}

fn executable_function(source: &str, declaration: &str) -> String {
    let code = executable_rust(source);
    let declaration_offset = unique_executable_declaration(source, declaration);
    let open = code[declaration_offset..].find('{').map_or_else(
        || panic!("missing body for executable declaration {declaration:?}"),
        |offset| declaration_offset + offset,
    );
    let mut depth = 0_usize;
    for (offset, byte) in code.as_bytes()[open..].iter().enumerate() {
        if *byte == b'{' {
            depth += 1;
        } else if *byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return code[declaration_offset..=open + offset].to_owned();
            }
        }
    }
    panic!("unterminated body for executable declaration {declaration:?}")
}

fn exact_statement_offsets_at_depth(
    function_code: &str,
    statement: &str,
    expected_depth: usize,
) -> Vec<usize> {
    let mut offsets = Vec::new();
    let mut offset = 0;
    let mut depth = 0_usize;
    for line in function_code.split_inclusive('\n') {
        if line.trim() == statement && depth == expected_depth {
            offsets.push(offset);
        }
        for byte in line.bytes() {
            if byte == b'{' {
                depth += 1;
            } else if byte == b'}' {
                depth = depth
                    .checked_sub(1)
                    .expect("executable Rust function has balanced braces");
            }
        }
        offset += line.len();
    }
    offsets
}

fn lifecycle_violations(source: &str) -> Vec<String> {
    let function = executable_function(source, "fn test_read_only()");
    let read_only_opens = exact_statement_offsets_at_depth(
        &function,
        "let read_only = Store::open_read_only(&store_dir)?;",
        1,
    );
    let writer_opens = exact_statement_offsets_at_depth(
        &function,
        "let read_write = Store::open(&store_dir)?;",
        1,
    );
    let drops = exact_statement_offsets_at_depth(&function, "drop(read_only);", 1);
    let frozen_assertions = exact_statement_offsets_at_depth(
        &function,
        "assert!(!read_only.contains(&second_quad)?);",
        1,
    );
    let mut violations = Vec::new();
    let Some(read_only_open) = read_only_opens.first().copied() else {
        violations.push("test_read_only must exercise Store::open_read_only".to_owned());
        return violations;
    };
    let Some(writer_open) = writer_opens
        .iter()
        .copied()
        .find(|offset| *offset > read_only_open)
    else {
        violations.push("test_read_only must exercise a later read-write lifecycle".to_owned());
        return violations;
    };
    if !drops
        .iter()
        .any(|offset| *offset > read_only_open && *offset < writer_open)
    {
        violations.push(
            "test_read_only must explicitly close the ordinary read-only instance before reopening a writer"
                .to_owned(),
        );
    }
    if frozen_assertions.iter().any(|offset| *offset > writer_open) {
        violations.push(
            "test_read_only must not assert a frozen view while an ordinary read-only instance coexists with a writer"
                .to_owned(),
        );
    }
    violations
}

fn secondary_surface_violations(label: &str, source: &str) -> Vec<String> {
    let words = source
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    let identifiers = source
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .filter(|identifier| !identifier.is_empty())
        .map(|identifier| identifier.replace('_', "").to_ascii_lowercase())
        .collect::<Vec<_>>();
    let has_words = |needle: &[&str]| {
        words
            .windows(needle.len())
            .any(|window| window.iter().map(String::as_str).eq(needle.iter().copied()))
    };
    let has_identifier = |needles: &[&str]| {
        identifiers
            .iter()
            .any(|identifier| needles.iter().any(|needle| identifier.contains(needle)))
    };
    let mut violations = Vec::new();
    let mut forbid = |description: &str, found: bool| {
        if found {
            violations.push(format!(
                "{label} contains unauthorized {description}; this contract does not add live refresh"
            ));
        }
    };
    forbid(
        "OpenAsSecondary/open_as_secondary/FFI equivalent",
        has_identifier(&["openassecondary", "opensecondary"])
            || has_words(&["open", "as", "secondary"])
            || has_words(&["open", "secondary"]),
    );
    forbid(
        "OpenAsFollower/open_as_follower equivalent",
        has_identifier(&["openasfollower", "openfollower"])
            || has_words(&["open", "as", "follower"])
            || has_words(&["open", "follower"]),
    );
    forbid(
        "TryCatchUpWithPrimary/try_catch_up_with_primary/FFI equivalent",
        has_identifier(&[
            "trycatchupwithprimary",
            "catchupwithprimary",
            "catchupwiththeprimary",
            "catchesupwithprimary",
        ]) || has_words(&["try", "catch", "up", "with", "primary"])
            || has_words(&["catch", "up", "with", "primary"])
            || has_words(&["catch", "up", "with", "the", "primary"])
            || has_words(&["catches", "up", "with", "primary"]),
    );
    forbid(
        "secondary-instance product path",
        has_identifier(&[
            "secondaryinstance",
            "secondarydatabase",
            "secondarydb",
            "secondaryreader",
            "secondarystore",
            "secondarymode",
            "secondarypath",
            "secondaryrocksdb",
            "rocksdbsecondary",
        ]) || [
            "instance", "database", "db", "reader", "store", "mode", "path", "rocksdb",
        ]
        .iter()
        .any(|noun| has_words(&["secondary", noun])),
    );
    forbid(
        "live or dynamic catch-up/refresh path",
        has_identifier(&["livecatchup", "dynamiccatchup", "liverefresh"])
            || has_words(&["live", "catch", "up"])
            || has_words(&["dynamic", "catch", "up"])
            || has_words(&["dynamically", "catches", "up"])
            || has_words(&["live", "refresh"]),
    );
    forbid(
        "read-replica or primary-follower product path",
        has_identifier(&[
            "readreplica",
            "primaryfollower",
            "followerdatabase",
            "followerdb",
        ]) || has_words(&["read", "replica"])
            || has_words(&["primary", "follower"])
            || has_words(&["follower", "database"])
            || has_words(&["follower", "db"]),
    );
    violations
}

#[test]
fn vendored_rocksdb_header_is_the_read_only_lifecycle_oracle() {
    let header = ROCKSDB_V11_1_2_DB_HEADER
        .lines()
        .map(|line| line.trim().strip_prefix("//").unwrap_or(line.trim()).trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        header.contains(
            "While a given DB can be simultaneously opened via OpenForReadOnly by any number of readers"
        ),
        "the vendored RocksDB header no longer guarantees concurrent ordinary read-only instances"
    );
    assert!(
        header.contains(
            "if a DB is simultaneously opened by Open and OpenForReadOnly, the read-only instance has undefined behavior"
        ),
        "the vendored RocksDB header no longer defines writer/read-only coexistence as undefined"
    );
    assert!(
        header.contains("See also OpenAsSecondary"),
        "the vendored RocksDB header no longer distinguishes the secondary lifecycle"
    );
    assert!(
        header.contains("OpenAsSecondary() creates a secondary instance that supports read-only operations and supports dynamic catch up with the primary"),
        "the vendored RocksDB header no longer defines live catch-up as a secondary-instance feature"
    );
    assert!(
        header.contains("static Status OpenAsFollower")
            && header.contains("periodically tailing the leader's MANIFEST"),
        "the vendored RocksDB header no longer exposes the automatic follower lifecycle"
    );
}

#[test]
fn executable_declarations_ignore_commented_and_stringified_spoofs() {
    const HOSTILE_SOURCE: &str = r##"
// pub fn open(path: &str) {}
/*
pub fn open(path: &str) {}
*/
const STRINGIFIED: &str = r#"
pub fn open(path: &str) {}
"#;
/// The real open contract.
pub fn open(path: &str) {}
"##;

    let declarations = executable_line_offsets(HOSTILE_SOURCE, "pub fn open(");
    assert_eq!(
        declarations.len(),
        1,
        "comments and strings must not redirect declaration extraction"
    );
    assert_eq!(
        method_docs(HOSTILE_SOURCE, "pub fn open("),
        "The real open contract."
    );
}

#[test]
fn lifecycle_contract_rejects_non_executable_and_nested_drop_spoofs() {
    const HOSTILE_TEST: &str = r##"
fn test_read_only() {
    if false {
        let read_only = Store::open_read_only(&store_dir)?;
        drop(read_only);
        let read_write = Store::open(&store_dir)?;
    }
    let read_only = Store::open_read_only(&store_dir)?;
    // drop(read_only);
    let _stringified = "drop(read_only);";
    let _raw_stringified = r#"
drop(read_only);
"#;
    if false {
        drop(read_only);
    }
    let read_write = Store::open(&store_dir)?;
    assert!(!read_only.contains(&second_quad)?);
}
"##;
    const SAFE_TEST: &str = "
fn test_read_only() {
    let read_only = Store::open_read_only(&store_dir)?;
    drop(read_only);
    let read_write = Store::open(&store_dir)?;
}
";

    let violations = lifecycle_violations(HOSTILE_TEST);
    assert!(
        violations.iter().any(|violation| violation.contains(
            "explicitly close the ordinary read-only instance before reopening a writer"
        )),
        "commented and stringified drop calls must not satisfy the lifecycle contract"
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("must not assert a frozen view")),
        "the executable frozen-view assertion must remain visible to the evaluator"
    );

    assert!(
        lifecycle_violations(SAFE_TEST).is_empty(),
        "a genuine outer-scope sequential lifecycle must satisfy the contract"
    );
}

#[test]
fn secondary_guard_rejects_symbol_wiring_and_prose_spoofs() {
    for (label, hostile_source) in [
        ("CamelCase", "fn wire() { OpenAsSecondary(); }"),
        ("snake_case", "fn wire() { open_as_secondary(); }"),
        ("follower CamelCase", "fn wire() { OpenAsFollower(); }"),
        ("follower snake_case", "fn wire() { open_as_follower(); }"),
        (
            "FFI symbol",
            "unsafe extern \"C\" { fn rocksdb_open_as_secondary(); }",
        ),
        ("commented catch-up prose", "// live catch-up with primary"),
        (
            "stringified catch-up symbol",
            "const SYMBOL: &str = \"rocksdb_try_catch_up_with_primary\";",
        ),
        (
            "equivalent prose",
            "/// This secondary reader dynamically catches up with primary.",
        ),
    ] {
        assert!(
            !secondary_surface_violations(label, hostile_source).is_empty(),
            "{label} must not bypass the no-secondary/live-refresh guard"
        );
    }
    assert!(
        secondary_surface_violations(
            "benign index prose",
            "/// Maintains ordinary secondary indexes.\nfn scan_secondary_index() {}",
        )
        .is_empty(),
        "the scoped guard must not ban unrelated secondary-index prose"
    );
    assert!(
        secondary_surface_violations(
            "benign follower prose",
            "/// Counts social-graph followers.\nfn count_followers() {}",
        )
        .is_empty(),
        "the scoped guard must not ban unrelated uses of the word follower"
    );
}

#[test]
fn store_source_documents_and_tests_the_ordinary_read_only_lifecycle() {
    let mut violations = Vec::new();
    for declaration in ["pub fn open(", "pub fn open_with_options("] {
        let docs = method_docs(STORE_SOURCE, declaration);
        if !docs.contains("[`Store::clone`]") {
            violations.push(format!(
                "{declaration} must recommend Store::clone for another same-process handle: {docs}"
            ));
        }
        if docs.contains("[`Store::open_read_only`]") {
            violations.push(format!(
                "{declaration} must not recommend an ordinary read-only open beside a writer: {docs}"
            ));
        }
    }

    let read_only_docs = method_docs(STORE_SOURCE, "pub fn open_read_only(");
    if !read_only_docs.contains("Multiple read-only [`Store`] instances may coexist") {
        violations.push(format!(
            "Store::open_read_only must document the supported concurrent-reader lifecycle: {read_only_docs}"
        ));
    }
    if !read_only_docs.contains("same or another process")
        || !read_only_docs.contains("undefined behavior")
    {
        violations.push(format!(
            "Store::open_read_only must warn that any simultaneous writer makes the read-only instance undefined: {read_only_docs}"
        ));
    }

    violations.extend(lifecycle_violations(STORE_TEST_SOURCE));
    for (label, source) in [
        ("lib/oxigraph/src/store.rs", STORE_SOURCE),
        ("lib/oxigraph/src/storage/mod.rs", STORAGE_MOD_SOURCE),
        (
            "lib/oxigraph/src/storage/rocksdb.rs",
            ROCKSDB_STORAGE_SOURCE,
        ),
        (
            "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
            ROCKSDB_WRAPPER_SOURCE,
        ),
    ] {
        violations.extend(secondary_surface_violations(label, source));
    }
    assert!(
        violations.is_empty(),
        "ordinary read-only lifecycle contract violations:\n{}",
        violations.join("\n")
    );
}

#[test]
fn ordinary_read_only_and_writer_lifetimes_are_sequential() -> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new_unchecked("urn:oxigraph:read-only-contract:subject");
    let predicate = NamedNode::new_unchecked("urn:oxigraph:read-only-contract:predicate");
    let first_quad = Quad::new(
        subject.clone(),
        predicate.clone(),
        NamedNode::new_unchecked("urn:oxigraph:read-only-contract:first"),
        GraphName::DefaultGraph,
    );
    let second_quad = Quad::new(
        subject,
        predicate,
        NamedNode::new_unchecked("urn:oxigraph:read-only-contract:second"),
        GraphName::DefaultGraph,
    );
    let store_dir = TempDir::new()?;

    {
        let writer = Store::open(&store_dir)?;
        writer.insert(first_quad.clone())?;
        writer.flush()?;
    }
    {
        let first_read_only = Store::open_read_only(&store_dir)?;
        let second_read_only = Store::open_read_only(&store_dir)?;
        for read_only in [&first_read_only, &second_read_only] {
            assert!(read_only.contains(&first_quad)?);
            assert!(!read_only.contains(&second_quad)?);
            read_only.validate()?;
        }
    }
    {
        let writer = Store::open(&store_dir)?;
        writer.insert(second_quad.clone())?;
        writer.flush()?;
        writer.optimize()?;
    }
    {
        let read_only = Store::open_read_only(&store_dir)?;
        assert!(read_only.contains(&first_quad)?);
        assert!(read_only.contains(&second_quad)?);
        assert_eq!(read_only.len()?, 2);
        read_only.validate()?;
    }

    Ok(())
}
