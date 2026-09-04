#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    unsafe_code,
    reason = "the evaluator reads per-column-family RocksDB properties through its C API"
)]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration-test assertions provide clearer storage regression failures"
)]

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::Store;
use oxrocksdb_sys::{
    rocksdb_close, rocksdb_column_family_handle_destroy, rocksdb_column_family_handle_t,
    rocksdb_free, rocksdb_list_column_families, rocksdb_list_column_families_destroy,
    rocksdb_open_for_read_only_column_families, rocksdb_options_create, rocksdb_options_destroy,
    rocksdb_options_t, rocksdb_property_value_cf, rocksdb_t,
};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::ffi::{CStr, CString, c_char};
use std::fs::{DirBuilder, remove_dir_all};
use std::io;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::time::{SystemTime, UNIX_EPOCH};

const OWNED_COLUMN_FAMILIES: [&str; 12] = [
    "default", "id2str", "spog", "posg", "ospg", "gspo", "gpos", "gosp", "dspo", "dpos", "dosp",
    "graphs",
];

struct TemporaryStoreDirectory(PathBuf);

impl TemporaryStoreDirectory {
    fn new() -> Result<Self, Box<dyn Error>> {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!(
            "oxigraph-rocksdb-graphs-compaction-{}-{nonce}",
            std::process::id(),
        ));
        DirBuilder::new().create(&path)?;
        Ok(Self(path))
    }
}

impl AsRef<Path> for TemporaryStoreDirectory {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TemporaryStoreDirectory {
    fn drop(&mut self) {
        drop(remove_dir_all(&self.0));
    }
}

struct ReadOnlyColumnFamilies {
    db: *mut rocksdb_t,
    handles: Vec<*mut rocksdb_column_family_handle_t>,
    db_options: *mut rocksdb_options_t,
    column_family_options: Vec<*mut rocksdb_options_t>,
}

impl Drop for ReadOnlyColumnFamilies {
    fn drop(&mut self) {
        // SAFETY: All pointers were returned by RocksDB, are owned by this
        // value, and are destroyed once in the API-mandated handle/DB/options
        // order.
        unsafe {
            for handle in self.handles.drain(..) {
                rocksdb_column_family_handle_destroy(handle);
            }
            rocksdb_close(self.db);
            for options in self.column_family_options.drain(..) {
                rocksdb_options_destroy(options);
            }
            rocksdb_options_destroy(self.db_options);
        }
    }
}

fn rocksdb_error(error: *mut c_char) -> io::Error {
    // SAFETY: RocksDB reports a NUL-terminated allocation through `error`;
    // this function takes ownership and frees it exactly once after copying.
    let message = unsafe {
        let message = CStr::from_ptr(error).to_string_lossy().into_owned();
        rocksdb_free(error.cast());
        message
    };
    io::Error::other(message)
}

fn column_family_level_zero_files(path: &Path) -> Result<BTreeMap<String, u64>, Box<dyn Error>> {
    let path = CString::new(path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "RocksDB path is not valid UTF-8",
        )
    })?)?;
    let column_family_count = i32::try_from(OWNED_COLUMN_FAMILIES.len())?;
    let names = OWNED_COLUMN_FAMILIES
        .iter()
        .map(|name| CString::new(*name))
        .collect::<Result<Vec<_>, _>>()?;
    // SAFETY: The constructor has no preconditions and its returned pointer is
    // owned until explicitly transferred to the RAII value below.
    let db_options = unsafe { rocksdb_options_create() };
    if db_options.is_null() {
        return Err(io::Error::other("RocksDB options allocation failed").into());
    }

    let mut list_len = 0;
    let mut error = null_mut();
    // SAFETY: `path` and `db_options` remain alive through the call; both
    // output pointers designate writable local storage.
    let list = unsafe {
        rocksdb_list_column_families(db_options, path.as_ptr(), &raw mut list_len, &raw mut error)
    };
    if !error.is_null() {
        // SAFETY: If RocksDB returned a partial list with the error, the exact
        // pointer/length pair is destroyed once. `db_options` has not been
        // transferred and is likewise destroyed once.
        unsafe {
            if !list.is_null() {
                rocksdb_list_column_families_destroy(list, list_len);
            }
            rocksdb_options_destroy(db_options);
        }
        return Err(rocksdb_error(error).into());
    }
    if list.is_null() {
        // SAFETY: `db_options` has not been transferred and is destroyed once.
        unsafe {
            rocksdb_options_destroy(db_options);
        }
        return Err(io::Error::other("RocksDB column-family inventory is missing").into());
    }
    // SAFETY: RocksDB returned an array containing `list_len` valid C-string
    // pointers, and the array remains alive until the destroy call below.
    let actual_names = unsafe {
        std::slice::from_raw_parts(list, list_len)
            .iter()
            .map(|name| CStr::from_ptr(*name).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    };
    // SAFETY: `list` and `list_len` are the unmodified pair returned above.
    unsafe {
        rocksdb_list_column_families_destroy(list, list_len);
    }

    let actual_name_set = actual_names.iter().cloned().collect::<BTreeSet<_>>();
    let expected_names = OWNED_COLUMN_FAMILIES
        .into_iter()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    if actual_names.len() != OWNED_COLUMN_FAMILIES.len() || actual_name_set != expected_names {
        // SAFETY: `db_options` has not been transferred and is destroyed once.
        unsafe {
            rocksdb_options_destroy(db_options);
        }
        return Err(io::Error::other(format!(
            "RocksDB owned-column-family inventory drifted: {actual_name_set:?}",
        ))
        .into());
    }

    let name_pointers = names.iter().map(|name| name.as_ptr()).collect::<Vec<_>>();
    let mut column_family_options = Vec::with_capacity(names.len());
    for _ in &names {
        // SAFETY: The constructor has no preconditions.
        let options = unsafe { rocksdb_options_create() };
        if options.is_null() {
            // SAFETY: These pointers are the still-owned successful
            // constructor results, each destroyed exactly once.
            unsafe {
                for options in column_family_options {
                    rocksdb_options_destroy(options);
                }
                rocksdb_options_destroy(db_options);
            }
            return Err(io::Error::other("RocksDB column-family options allocation failed").into());
        }
        column_family_options.push(options);
    }
    let mut handles = vec![null_mut(); names.len()];
    let column_family_option_pointers = column_family_options
        .iter()
        .map(|options| options.cast_const())
        .collect::<Vec<_>>();
    error = null_mut();
    // SAFETY: All input arrays have `names.len()` entries and remain alive;
    // the handles/error outputs designate writable storage. The database is
    // closed before any options or names are destroyed.
    let db = unsafe {
        rocksdb_open_for_read_only_column_families(
            db_options,
            path.as_ptr(),
            column_family_count,
            name_pointers.as_ptr(),
            column_family_option_pointers.as_ptr(),
            handles.as_mut_ptr(),
            0,
            &raw mut error,
        )
    };
    if !error.is_null() || db.is_null() {
        // SAFETY: Any non-null handles produced on an error path, plus all
        // still-owned options, are released exactly once.
        unsafe {
            for handle in handles.into_iter().filter(|handle| !handle.is_null()) {
                rocksdb_column_family_handle_destroy(handle);
            }
            if !db.is_null() {
                rocksdb_close(db);
            }
            for options in column_family_options {
                rocksdb_options_destroy(options);
            }
            rocksdb_options_destroy(db_options);
        }
        return if error.is_null() {
            Err(io::Error::other("RocksDB read-only open returned no database").into())
        } else {
            Err(rocksdb_error(error).into())
        };
    }
    if handles.iter().any(|handle| handle.is_null()) {
        // SAFETY: The successful open owns `db`; every handle that RocksDB did
        // return is destroyed once before the DB and all options are released.
        unsafe {
            for handle in handles.into_iter().filter(|handle| !handle.is_null()) {
                rocksdb_column_family_handle_destroy(handle);
            }
            rocksdb_close(db);
            for options in column_family_options {
                rocksdb_options_destroy(options);
            }
            rocksdb_options_destroy(db_options);
        }
        return Err(io::Error::other("RocksDB returned a null column-family handle").into());
    }
    let opened = ReadOnlyColumnFamilies {
        db,
        handles,
        db_options,
        column_family_options,
    };
    let property = CString::new("rocksdb.num-files-at-level0")?;
    let mut counts = BTreeMap::new();
    for (name, handle) in names.iter().zip(&opened.handles) {
        // SAFETY: The DB and corresponding handle remain live in `opened` and
        // `property` is NUL-terminated. A non-null result is a RocksDB-owned
        // NUL-terminated allocation that is copied and freed below.
        let raw_value = unsafe { rocksdb_property_value_cf(opened.db, *handle, property.as_ptr()) };
        if raw_value.is_null() {
            return Err(io::Error::other(format!(
                "RocksDB did not expose the level-zero file count for {:?}",
                name.to_string_lossy(),
            ))
            .into());
        }
        // SAFETY: `raw_value` is the non-null C string returned above and is freed
        // exactly once after its contents are copied.
        let value = unsafe {
            let value = CStr::from_ptr(raw_value).to_string_lossy().into_owned();
            rocksdb_free(raw_value.cast());
            value
        };
        let count = value.parse()?;
        counts.insert(name.to_string_lossy().into_owned(), count);
    }
    Ok(counts)
}

#[test]
fn manual_compaction_covers_graph_topology_and_preserves_empty_graphs() -> Result<(), Box<dyn Error>>
{
    let directory = TemporaryStoreDirectory::new()?;
    let retained = NamedNode::new_unchecked("urn:oxigraph:compaction:retained");
    let removed = NamedNode::new_unchecked("urn:oxigraph:compaction:removed");
    let populated = NamedNode::new_unchecked("urn:oxigraph:compaction:populated");
    let retained_graph = NamedOrBlankNode::from(retained.clone());
    let removed_graph = NamedOrBlankNode::from(removed.clone());
    let populated_graph = NamedOrBlankNode::from(populated.clone());
    let retained_graph_name = GraphName::from(retained.clone());
    let subject = NamedNode::new_unchecked("urn:oxigraph:compaction:subject");
    let predicate = NamedNode::new_unchecked("urn:oxigraph:compaction:predicate");
    let object = NamedNode::new_unchecked("urn:oxigraph:compaction:object");

    let store = Store::open(directory.as_ref())?;
    store.insert_named_graph(retained.clone())?;
    store.insert_named_graph(removed.clone())?;
    store.insert(Quad::new(
        subject.clone(),
        predicate.clone(),
        object.clone(),
        GraphName::DefaultGraph,
    ))?;
    store.insert(Quad::new(subject, predicate, object, populated))?;
    store.remove_named_graph(&removed_graph)?;
    store.flush()?;
    drop(store);

    let files_before_compaction = column_family_level_zero_files(directory.as_ref())?;
    assert_eq!(
        files_before_compaction
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        OWNED_COLUMN_FAMILIES
            .into_iter()
            .map(str::to_owned)
            .collect(),
    );
    assert!(
        files_before_compaction.values().all(|count| *count == 1),
        "one deliberate flush must publish exactly one L0 file in every owned column family: {files_before_compaction:?}",
    );

    let store = Store::open(directory.as_ref())?;
    store.optimize()?;
    drop(store);

    let files_after_compaction = column_family_level_zero_files(directory.as_ref())?;
    let reopened = Store::open(directory.as_ref())?;
    assert!(reopened.contains_named_graph(&retained_graph)?);
    assert!(!reopened.contains_named_graph(&removed_graph)?);
    assert!(reopened.contains_named_graph(&populated_graph)?);
    assert!(
        reopened
            .quads_for_pattern(None, None, None, Some(&retained_graph_name))
            .next()
            .transpose()?
            .is_none(),
        "the retained explicit graph must remain empty",
    );
    assert_eq!(
        reopened
            .named_graphs()
            .map(|graph| graph.map(|graph| graph.to_string()))
            .collect::<Result<BTreeSet<_>, _>>()?,
        [populated_graph.to_string(), retained_graph.to_string()]
            .into_iter()
            .collect(),
    );
    assert_eq!(reopened.len()?, 2);
    drop(reopened);

    let uncompacted = files_after_compaction
        .iter()
        .filter(|(_, count)| **count != 0)
        .collect::<BTreeMap<_, _>>();
    assert!(
        uncompacted.is_empty(),
        "manual compaction left L0 files in owned column families: {uncompacted:?}; before: {files_before_compaction:?}",
    );
    Ok(())
}
