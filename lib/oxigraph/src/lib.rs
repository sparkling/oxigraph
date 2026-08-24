#![cfg_attr(doc, doc = include_str!("../README.md"))]
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]

#[cfg(feature = "http-client")]
mod http;
pub mod io;
pub mod model;
#[cfg(feature = "datalog")]
#[cfg_attr(docsrs, doc(cfg(feature = "datalog")))]
pub use oxdatalog as datalog;
#[cfg(feature = "owl2-rl")]
#[cfg_attr(docsrs, doc(cfg(feature = "owl2-rl")))]
pub use oxowl as owl2_rl;
#[cfg(feature = "rdfs")]
#[cfg_attr(docsrs, doc(cfg(feature = "rdfs")))]
pub use oxrdfs as rdfs;
#[cfg(any(
    feature = "datalog",
    feature = "owl2-rl",
    feature = "rdfs",
    feature = "shacl"
))]
pub mod reasoning;
#[cfg(feature = "shacl")]
#[cfg_attr(docsrs, doc(cfg(feature = "shacl")))]
pub use oxshacl as shacl;
pub mod sparql;
mod storage;
pub mod store;
