#[cfg(test)]
#[cfg(not(feature = "rdf-12"))]
mod tests {
    use oxrdf::{NamedNode, Quad, RdfVersion, Triple};
    use oxttl::{NQuadsSerializer, NTriplesSerializer};
    use std::cell::RefCell;
    use std::fmt::Debug;
    use std::io::{self, Write};
    #[cfg(feature = "async-tokio")]
    use std::pin::Pin;
    use std::rc::Rc;
    #[cfg(feature = "async-tokio")]
    use std::task::{Context, Poll};
    #[cfg(feature = "async-tokio")]
    use tokio::io::AsyncWrite;

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

    #[expect(clippy::expect_used)]
    fn assert_invalid<T: Debug>(result: io::Result<T>) {
        let error = result.expect_err("an RDF 1.2 serializer must require the rdf-12 feature");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[derive(Clone, Debug, Default)]
    struct SharedWriter(Rc<RefCell<Vec<u8>>>);

    impl SharedWriter {
        fn is_empty(&self) -> bool {
            self.0.borrow().is_empty()
        }
    }

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[cfg(feature = "async-tokio")]
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

    #[test]
    fn rdf_12_versions_fail_closed_on_sync_and_low_level_paths() {
        for version in [RdfVersion::V1_2Basic, RdfVersion::V1_2] {
            let sink = SharedWriter::default();
            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .for_writer(sink.clone());
            assert_invalid(serializer.serialize_triple(&example_triple()));
            assert!(sink.is_empty());

            let sink = SharedWriter::default();
            assert_invalid(
                NTriplesSerializer::new()
                    .with_rdf_version(version)
                    .for_writer(sink.clone())
                    .finish(),
            );
            assert!(sink.is_empty());

            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            assert_invalid(serializer.serialize_triple(&example_triple(), &mut output));
            assert_invalid(serializer.finish(&mut output));
            assert!(output.is_empty());

            let sink = SharedWriter::default();
            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .for_writer(sink.clone());
            assert_invalid(serializer.serialize_quad(&example_quad()));
            assert!(sink.is_empty());

            let sink = SharedWriter::default();
            assert_invalid(
                NQuadsSerializer::new()
                    .with_rdf_version(version)
                    .for_writer(sink.clone())
                    .finish(),
            );
            assert!(sink.is_empty());

            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .low_level();
            let mut output = Vec::new();
            assert_invalid(serializer.serialize_quad(&example_quad(), &mut output));
            assert_invalid(serializer.finish(&mut output));
            assert!(output.is_empty());
        }
    }

    #[cfg(feature = "async-tokio")]
    #[tokio::test]
    async fn rdf_12_versions_fail_closed_on_async_paths() {
        for version in [RdfVersion::V1_2Basic, RdfVersion::V1_2] {
            let sink = SharedWriter::default();
            let mut serializer = NTriplesSerializer::new()
                .with_rdf_version(version)
                .for_tokio_async_writer(sink.clone());
            assert_invalid(serializer.serialize_triple(&example_triple()).await);
            assert!(sink.is_empty());

            let sink = SharedWriter::default();
            assert_invalid(
                NTriplesSerializer::new()
                    .with_rdf_version(version)
                    .for_tokio_async_writer(sink.clone())
                    .finish()
                    .await,
            );
            assert!(sink.is_empty());

            let sink = SharedWriter::default();
            let mut serializer = NQuadsSerializer::new()
                .with_rdf_version(version)
                .for_tokio_async_writer(sink.clone());
            assert_invalid(serializer.serialize_quad(&example_quad()).await);
            assert!(sink.is_empty());

            let sink = SharedWriter::default();
            assert_invalid(
                NQuadsSerializer::new()
                    .with_rdf_version(version)
                    .for_tokio_async_writer(sink.clone())
                    .finish()
                    .await,
            );
            assert!(sink.is_empty());
        }
    }
}
