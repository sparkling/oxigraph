#[cfg(test)]
#[cfg(feature = "rdf-12")]
mod tests {
    #[cfg(feature = "rdf-12")]
    use oxrdf::{BaseDirection, BlankNode, Literal};
    use oxrdf::{NamedNode, Quad, RdfVersion, Triple};
    #[cfg(feature = "rdf-12")]
    use oxttl::NTriplesMediaType;
    use oxttl::{NQuadsSerializer, NTriplesSerializer};
    #[cfg(feature = "rdf-12")]
    use std::cell::RefCell;
    use std::error::Error;
    #[cfg(feature = "rdf-12")]
    use std::io::{self, Write};
    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    use std::pin::Pin;
    #[cfg(feature = "rdf-12")]
    use std::rc::Rc;
    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    use std::task::{Context, Poll};
    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    use tokio::io::AsyncWrite;

    const NTRIPLES_LINE: &[u8] =
        b"<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n";
    const NQUADS_LINE: &[u8] = b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n";

    fn named_node(value: &'static str) -> NamedNode {
        NamedNode::new_unchecked(value)
    }

    fn example_triple() -> Triple {
        Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            named_node("http://example.com/o"),
        )
    }

    fn example_quad() -> Quad {
        Quad::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            named_node("http://example.com/o"),
            named_node("http://example.com/g"),
        )
    }

    fn in_named_graph(triple: &Triple) -> Quad {
        Quad::new(
            triple.subject.clone(),
            triple.predicate.clone(),
            triple.object.clone(),
            named_node("http://example.com/g"),
        )
    }

    fn version_cases() -> [(RdfVersion, &'static [u8]); 3] {
        [
            (RdfVersion::V1_1, b""),
            (RdfVersion::V1_2Basic, b"VERSION \"1.2-basic\"\n"),
            (RdfVersion::V1_2, b"VERSION \"1.2\"\n"),
        ]
    }

    #[cfg(feature = "rdf-12")]
    #[derive(Clone, Debug, Default)]
    struct SharedWriter(Rc<RefCell<Vec<u8>>>);

    #[cfg(feature = "rdf-12")]
    impl SharedWriter {
        fn bytes(&self) -> Vec<u8> {
            self.0.borrow().clone()
        }
    }

    #[cfg(feature = "rdf-12")]
    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    impl AsyncWrite for SharedWriter {
        fn poll_write(
            self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            buf: &[u8],
        ) -> Poll<io::Result<usize>> {
            self.0.borrow_mut().extend_from_slice(buf);
            Poll::Ready(Ok(buf.len()))
        }

        fn poll_flush(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn directives_are_byte_exact_for_sync_and_low_level_paths() -> Result<(), Box<dyn Error>> {
        for (version, directive) in version_cases() {
            let expected_ntriples = [directive, NTRIPLES_LINE, NTRIPLES_LINE].concat();
            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .for_writer(Vec::new());
            serializer.serialize_triple(&example_triple())?;
            serializer.serialize_triple(&example_triple())?;
            assert_eq!(serializer.finish()?, expected_ntriples);

            let mut low_level = NTriplesSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            low_level.serialize_triple(&example_triple(), &mut output)?;
            low_level.serialize_triple(&example_triple(), &mut output)?;
            low_level.finish(&mut output)?;
            assert_eq!(output, expected_ntriples);

            let mut empty = NTriplesSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            empty.finish(&mut output)?;
            empty.finish(&mut output)?;
            assert_eq!(output, directive);
            assert_eq!(
                NTriplesSerializer::new()
                    .with_rdf_version(version)
                    .for_writer(Vec::new())
                    .finish()?,
                directive
            );

            let expected_nquads = [directive, NQUADS_LINE, NQUADS_LINE].concat();
            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .for_writer(Vec::new());
            serializer.serialize_quad(&example_quad())?;
            serializer.serialize_quad(&example_quad())?;
            assert_eq!(serializer.finish()?, expected_nquads);

            let mut low_level = NQuadsSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            low_level.serialize_quad(&example_quad(), &mut output)?;
            low_level.serialize_quad(&example_quad(), &mut output)?;
            low_level.finish(&mut output)?;
            assert_eq!(output, expected_nquads);

            let mut empty = NQuadsSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            empty.finish(&mut output)?;
            empty.finish(&mut output)?;
            assert_eq!(output, directive);
            assert_eq!(
                NQuadsSerializer::new()
                    .with_rdf_version(version)
                    .for_writer(Vec::new())
                    .finish()?,
                directive
            );
        }

        let mut serializer = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .for_writer(Vec::new());
        serializer.serialize_triple(&example_triple())?;
        assert_eq!(
            serializer.finish()?,
            [b"VERSION \"1.2\"\n".as_slice(), NTRIPLES_LINE].concat()
        );

        let unicode = Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            Literal::new_simple_literal("\u{e9}"),
        );
        let mut text = NTriplesSerializer::new()
            .with_media_type(NTriplesMediaType::TextPlain)
            .with_rdf_version(RdfVersion::V1_2)
            .for_writer(Vec::new());
        text.serialize_triple(&unicode)?;
        assert_eq!(
            text.finish()?,
            b"VERSION \"1.2\"\n<http://example.com/s> <http://example.com/p> \"\\u00E9\" .\n"
        );
        Ok(())
    }

    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    #[tokio::test]
    #[expect(clippy::panic_in_result_fn)]
    async fn directives_are_byte_exact_for_async_paths() -> Result<(), Box<dyn Error>> {
        for (version, directive) in version_cases() {
            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .for_tokio_async_writer(Vec::new());
            serializer.serialize_triple(&example_triple()).await?;
            assert_eq!(
                serializer.finish().await?,
                [directive, NTRIPLES_LINE].concat()
            );
            assert_eq!(
                NTriplesSerializer::new()
                    .with_rdf_version(version)
                    .for_tokio_async_writer(Vec::new())
                    .finish()
                    .await?,
                directive
            );

            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .for_tokio_async_writer(Vec::new());
            serializer.serialize_quad(&example_quad()).await?;
            assert_eq!(
                serializer.finish().await?,
                [directive, NQUADS_LINE].concat()
            );
            assert_eq!(
                NQuadsSerializer::new()
                    .with_rdf_version(version)
                    .for_tokio_async_writer(Vec::new())
                    .finish()
                    .await?,
                directive
            );
        }

        let mut serializer = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .for_tokio_async_writer(Vec::new());
        serializer.serialize_triple(&example_triple()).await?;
        assert_eq!(
            serializer.finish().await?,
            [b"VERSION \"1.2\"\n".as_slice(), NTRIPLES_LINE].concat()
        );
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    #[expect(clippy::expect_used, clippy::panic_in_result_fn)]
    fn incompatible_terms_are_rejected_without_partial_output() -> Result<(), Box<dyn Error>> {
        let directional = Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Ltr)?,
        );
        let triple_term = Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            example_triple(),
        );

        for (version, invalid, directive) in [
            (RdfVersion::V1_1, &directional, b"".as_slice()),
            (RdfVersion::V1_1, &triple_term, b"".as_slice()),
            (
                RdfVersion::V1_2Basic,
                &triple_term,
                b"VERSION \"1.2-basic\"\n".as_slice(),
            ),
        ] {
            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            let error = serializer
                .serialize_triple(invalid, &mut output)
                .expect_err("incompatible N-Triples term must be rejected");
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(output.is_empty());
            serializer.serialize_triple(&example_triple(), &mut output)?;
            assert_eq!(output, [directive, NTRIPLES_LINE].concat());

            let invalid_quad = in_named_graph(invalid);
            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            let error = serializer
                .serialize_quad(&invalid_quad, &mut output)
                .expect_err("incompatible N-Quads term must be rejected");
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(output.is_empty());
            serializer.serialize_quad(&example_quad(), &mut output)?;
            assert_eq!(output, [directive, NQUADS_LINE].concat());
        }

        let shared = SharedWriter::default();
        let mut serializer = NTriplesSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_writer(shared.clone());
        let error = serializer
            .serialize_triple(&directional)
            .expect_err("sync N-Triples serializer must reject RDF 1.2 terms");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(shared.bytes().is_empty());

        let shared = SharedWriter::default();
        let mut serializer = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2Basic)
            .for_writer(shared.clone());
        let invalid_quad = in_named_graph(&triple_term);
        let error = serializer
            .serialize_quad(&invalid_quad)
            .expect_err("sync N-Quads serializer must reject triple terms in Basic");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(shared.bytes().is_empty());

        let mut basic = NTriplesSerializer::new()
            .with_rdf_version(RdfVersion::V1_2Basic)
            .for_writer(Vec::new());
        basic.serialize_triple(&directional)?;
        assert!(basic.finish()?.starts_with(b"VERSION \"1.2-basic\"\n"));

        let mut full = NTriplesSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .for_writer(Vec::new());
        full.serialize_triple(&directional)?;
        full.serialize_triple(&triple_term)?;
        assert!(full.finish()?.starts_with(b"VERSION \"1.2\"\n"));

        let mut basic = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2Basic)
            .for_writer(Vec::new());
        basic.serialize_quad(&in_named_graph(&directional))?;
        assert!(basic.finish()?.starts_with(b"VERSION \"1.2-basic\"\n"));

        let mut full = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .for_writer(Vec::new());
        full.serialize_quad(&in_named_graph(&directional))?;
        full.serialize_quad(&in_named_graph(&triple_term))?;
        assert!(full.finish()?.starts_with(b"VERSION \"1.2\"\n"));

        let non_ascii_blank = Triple::new(
            BlankNode::new_unchecked("\u{e9}"),
            named_node("http://example.com/p"),
            named_node("http://example.com/o"),
        );
        let mut serializer = NTriplesSerializer::new()
            .with_media_type(NTriplesMediaType::TextPlain)
            .with_rdf_version(RdfVersion::V1_2)
            .low_level();
        let mut output = Vec::new();
        let error = serializer
            .serialize_triple(&non_ascii_blank, &mut output)
            .expect_err("text/plain cannot encode a non-ASCII blank-node identifier");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(output.is_empty());
        Ok(())
    }

    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    #[tokio::test]
    #[expect(clippy::expect_used, clippy::panic_in_result_fn)]
    async fn incompatible_terms_are_rejected_atomically_by_async_paths()
    -> Result<(), Box<dyn Error>> {
        let directional = Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Ltr)?,
        );
        let shared = SharedWriter::default();
        let mut serializer = NTriplesSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_tokio_async_writer(shared.clone());
        let error = serializer
            .serialize_triple(&directional)
            .await
            .expect_err("async N-Triples serializer must reject RDF 1.2 terms");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(shared.bytes().is_empty());

        let triple_term = Triple::new(
            named_node("http://example.com/s"),
            named_node("http://example.com/p"),
            example_triple(),
        );
        let invalid_quad = in_named_graph(&triple_term);
        let shared = SharedWriter::default();
        let mut serializer = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_2Basic)
            .for_tokio_async_writer(shared.clone());
        let error = serializer
            .serialize_quad(&invalid_quad)
            .await
            .expect_err("async N-Quads serializer must reject triple terms in Basic");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(shared.bytes().is_empty());
        Ok(())
    }
}
