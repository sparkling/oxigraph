#[cfg(test)]
mod tests {
    use oxigraph::model::{
        OxStr as PublicOxStr, OxString as PublicOxString, ReserveError as PublicReserveError,
    };

    #[test]
    fn oxigraph_model_reexports_the_workspace_oxstr_types() {
        let value: PublicOxString = PublicOxStr::try_new_owned("public path").unwrap();
        let oxrdf_value: oxrdf::OxString = value.clone();
        let direct_value: oxstr::OxString = oxrdf_value;
        assert_eq!(direct_value, "public path");

        let error: Result<PublicOxString, PublicReserveError> =
            PublicOxStr::try_concat(["public", " path"]);
        assert_eq!(error.unwrap(), "public path");
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn persisted_strings_decode_after_store_reopen() -> Result<(), Box<dyn std::error::Error>> {
        use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
        use oxigraph::store::Store;

        let directory = tempfile::tempdir()?;
        let quad = Quad::new(
            NamedNode::new("https://example.test/subject/\u{e9}")?,
            NamedNode::new("https://example.test/predicate")?,
            Literal::new_language_tagged_literal("Gr\u{fc}\u{df}e", "de")?,
            GraphName::from(NamedNode::new("https://example.test/graph")?),
        );

        {
            let store = Store::open(directory.path())?;
            store.insert(quad.clone())?;
            store.validate()?;
        }

        let reopened = Store::open_read_only(directory.path())?;
        if !reopened.contains(&quad)? {
            return Err("reopened store did not contain the persisted quad".into());
        }
        reopened.validate()?;
        Ok(())
    }
}
