use oxigraph::store::Store;
use std::error::Error;
use std::sync::Arc;

pub type TestError = Box<dyn Error + Send + Sync>;

pub struct StoreBackend {
    store: Arc<Store>,
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    _directory: Option<tempfile::TempDir>,
}

impl StoreBackend {
    pub fn memory() -> Result<Self, TestError> {
        Ok(Self {
            store: Arc::new(Store::new()?),
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            _directory: None,
        })
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn rocksdb() -> Result<Self, TestError> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(Store::open(directory.path())?);
        Ok(Self {
            store,
            _directory: Some(directory),
        })
    }
}
