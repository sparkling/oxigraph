import sys
import unittest
from io import BytesIO, StringIO, UnsupportedOperation
from tempfile import NamedTemporaryFile, TemporaryFile
from typing import cast

from pyoxigraph import (
    BaseDirection,
    Literal,
    NamedNode,
    Quad,
    QueryBoolean,
    QueryResultsFormat,
    QuerySolutions,
    RdfFormat,
    RdfVersion,
    Triple,
    parse,
    parse_query_results,
    serialize,
)

EXAMPLE_TRIPLE = Quad(
    NamedNode("http://example.com/foo"),
    NamedNode("http://example.com/p"),
    Literal("éù"),
)
EXAMPLE_QUAD = Quad(
    NamedNode("http://example.com/foo"),
    NamedNode("http://example.com/p"),
    Literal("1"),
    NamedNode("http://example.com/g"),
)


class TestParse(unittest.TestCase):
    def test_parse_file(self) -> None:
        with NamedTemporaryFile(suffix=".ttl") as fp:
            fp.write('<foo> <p> "éù" .'.encode())
            fp.flush()
            self.assertEqual(
                list(parse(path=fp.name, base_iri="http://example.com/")),
                [EXAMPLE_TRIPLE],
            )

    def test_parse_not_existing_file(self) -> None:
        with self.assertRaises(IOError) as _:
            parse(path="/tmp/not-existing-oxigraph-file.ttl", format=RdfFormat.TURTLE)

    def test_parse_str(self) -> None:
        self.assertEqual(
            list(
                parse(
                    '<foo> <p> "éù" .',
                    RdfFormat.TURTLE,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_TRIPLE],
        )

    def test_parse_bytes(self) -> None:
        self.assertEqual(
            list(
                parse(
                    '<foo> <p> "éù" .'.encode(),
                    RdfFormat.TURTLE,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_TRIPLE],
        )

    def test_parse_str_io(self) -> None:
        self.assertEqual(
            list(
                parse(
                    StringIO('<foo> <p> "éù" .'),
                    RdfFormat.TURTLE,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_TRIPLE],
        )

    def test_parse_long_str_io(self) -> None:
        self.assertEqual(
            list(
                parse(
                    StringIO('<foo> <p> "éù" .\n' * 1024),
                    RdfFormat.TURTLE,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_TRIPLE] * 1024,
        )

    def test_parse_bytes_io(self) -> None:
        self.assertEqual(
            list(
                parse(
                    BytesIO('<foo> <p> "éù" .'.encode()),
                    RdfFormat.TURTLE,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_TRIPLE],
        )

    def test_parse_io_error(self) -> None:
        with self.assertRaises(UnsupportedOperation) as _, TemporaryFile("wb") as fp:
            list(parse(fp, RdfFormat.N_TRIPLES))

    def test_parse_quad(self) -> None:
        self.assertEqual(
            list(
                parse(
                    '<g> { <foo> <p> "1" }',
                    RdfFormat.TRIG,
                    base_iri="http://example.com/",
                )
            ),
            [EXAMPLE_QUAD],
        )

    def test_parse_syntax_error(self) -> None:
        with NamedTemporaryFile() as fp:
            fp.write(b"@base <http://example.com/> .\n")
            fp.write(b'<foo> "p" "1"')
            fp.flush()
            with self.assertRaises(SyntaxError) as ctx:
                list(parse(path=fp.name, format=RdfFormat.TURTLE))
            self.assertEqual(ctx.exception.filename, fp.name)
            self.assertEqual(ctx.exception.lineno, 2)
            self.assertEqual(ctx.exception.offset, 7)
            if sys.version_info >= (3, 10):
                self.assertEqual(ctx.exception.end_lineno, 2)
                self.assertEqual(ctx.exception.end_offset, 10)

    def test_parse_without_named_graphs(self) -> None:
        with self.assertRaises(SyntaxError) as _:
            list(
                parse(
                    '<g> { <foo> <p> "1" }',
                    RdfFormat.TRIG,
                    base_iri="http://example.com/",
                    without_named_graphs=True,
                )
            )

    def test_parse_rename_blank_nodes(self) -> None:
        self.assertNotEqual(
            list(
                parse(
                    '_:s <http://example.com/p> "o" .',
                    RdfFormat.N_TRIPLES,
                    rename_blank_nodes=True,
                )
            ),
            list(
                parse(
                    '_:s <http://example.com/p> "o" .',
                    RdfFormat.N_TRIPLES,
                    rename_blank_nodes=True,
                )
            ),
        )

    def test_parse_lenient(self) -> None:
        triples = list(
            parse(
                '<foo> <p> "a"@abcdefghijklmnop .',
                RdfFormat.TURTLE,
                lenient=True,
            )
        )
        self.assertEqual(str(triples[0].subject), "<foo>")
        with self.assertRaisesRegex(OSError, "subject IRI .* is invalid"):
            serialize(triples, format=RdfFormat.N_TRIPLES)

    def test_parse_enforces_explicit_rdf_version(self) -> None:
        data = (
            "<http://example.com/s> <http://example.com/p> "
            "<<( <http://example.com/s> <http://example.com/p> "
            "<http://example.com/o> )>> ."
        )
        with self.assertRaisesRegex(SyntaxError, "triple terms"):
            list(parse(data, RdfFormat.N_TRIPLES, rdf_version=RdfVersion.V1_1))
        self.assertEqual(
            len(list(parse(data, RdfFormat.N_TRIPLES, rdf_version=RdfVersion.V1_2))),
            1,
        )


class TestSerialize(unittest.TestCase):
    def test_serialize_to_bytes(self) -> None:
        self.assertEqual(
            (serialize([EXAMPLE_TRIPLE.triple], None, RdfFormat.TURTLE) or b"").decode(),
            '<http://example.com/foo> <http://example.com/p> "éù" .\n',
        )

    def test_serialize_to_bytes_io(self) -> None:
        output = BytesIO()
        serialize([EXAMPLE_TRIPLE.triple], output, RdfFormat.TURTLE)
        self.assertEqual(
            output.getvalue().decode(),
            '<http://example.com/foo> <http://example.com/p> "éù" .\n',
        )

    def test_serialize_to_file(self) -> None:
        with NamedTemporaryFile(suffix=".ttl") as fp:
            serialize([EXAMPLE_TRIPLE], fp.name)
            self.assertEqual(
                fp.read().decode(),
                '<http://example.com/foo> <http://example.com/p> "éù" .\n',
            )

    def test_serialize_io_error(self) -> None:
        with self.assertRaises(UnsupportedOperation) as _, TemporaryFile("rb") as fp:
            serialize([EXAMPLE_TRIPLE], fp, RdfFormat.TURTLE)

    def test_serialize_quad(self) -> None:
        output = BytesIO()
        serialize([EXAMPLE_QUAD], output, RdfFormat.TRIG)
        self.assertEqual(
            output.getvalue(),
            b'<http://example.com/g> {\n\t<http://example.com/foo> <http://example.com/p> "1" .\n}\n',
        )

    def test_serialize_rdf_12_terms_with_explicit_version(self) -> None:
        triple_term = Triple(
            NamedNode("http://example.com/s"),
            NamedNode("http://example.com/p"),
            NamedNode("http://example.com/o"),
        )
        values = [
            Quad(
                NamedNode("http://example.com/s"),
                NamedNode("http://example.com/p"),
                Literal("hello", language="en", direction=BaseDirection.LTR),
            ),
            Quad(
                NamedNode("http://example.com/s"),
                NamedNode("http://example.com/p"),
                triple_term,
            ),
        ]
        with self.assertRaisesRegex(OSError, "RDF 1.2"):
            serialize(values, format=RdfFormat.N_TRIPLES, rdf_version=RdfVersion.V1_1)
        output = serialize(
            values,
            format=RdfFormat.N_TRIPLES,
            rdf_version=RdfVersion.V1_2,
        )
        assert output is not None
        self.assertTrue(output.startswith(b'VERSION "1.2"\n'))
        self.assertIn(b'"hello"@en--ltr', output)
        self.assertIn(b"<<(", output)


class TestParseQuerySolutions(unittest.TestCase):
    def test_parse_file(self) -> None:
        with NamedTemporaryFile(suffix=".tsv") as fp:
            fp.write(b'?s\t?p\t?o\n<http://example.com/s>\t<http://example.com/s>\t"1"\n')
            fp.flush()
            r = parse_query_results(path=fp.name)
            self.assertIsInstance(r, QuerySolutions)
            results = list(cast(QuerySolutions, r))
            self.assertEqual(results[0]["s"], NamedNode("http://example.com/s"))
            self.assertEqual(results[0][2], Literal("1"))

    def test_parse_not_existing_file(self) -> None:
        with self.assertRaises(IOError) as _:
            parse_query_results(path="/tmp/not-existing-oxigraph-file.ttl", format=QueryResultsFormat.JSON)

    def test_parse_str(self) -> None:
        result = parse_query_results("true", QueryResultsFormat.TSV)
        self.assertIsInstance(result, QueryBoolean)
        self.assertTrue(result)

    def test_parse_bytes(self) -> None:
        result = parse_query_results(b"false", QueryResultsFormat.TSV)
        self.assertIsInstance(result, QueryBoolean)
        self.assertFalse(result)

    def test_parse_str_io(self) -> None:
        result = parse_query_results("true", QueryResultsFormat.TSV)
        self.assertIsInstance(result, QueryBoolean)
        self.assertTrue(result)

    def test_parse_bytes_io(self) -> None:
        result = parse_query_results(BytesIO(b"false"), QueryResultsFormat.TSV)
        self.assertIsInstance(result, QueryBoolean)
        self.assertFalse(result)

    def test_parse_io_error(self) -> None:
        with self.assertRaises(UnsupportedOperation) as _, TemporaryFile("wb") as fp:
            parse_query_results(fp, QueryResultsFormat.XML)

    def test_parse_syntax_error_json(self) -> None:
        with NamedTemporaryFile() as fp:
            fp.write(b"{]")
            fp.flush()
            with self.assertRaises(SyntaxError) as ctx:
                list(cast(QuerySolutions, parse_query_results(path=fp.name, format=QueryResultsFormat.JSON)))
            self.assertEqual(ctx.exception.filename, fp.name)
            self.assertEqual(ctx.exception.lineno, 1)
            self.assertEqual(ctx.exception.offset, 2)
            if sys.version_info >= (3, 10):
                self.assertEqual(ctx.exception.end_lineno, 1)
                self.assertEqual(ctx.exception.end_offset, 3)

    def test_parse_syntax_error_tsv(self) -> None:
        with NamedTemporaryFile() as fp:
            fp.write(b"?a\t?test\n")
            fp.write(b"1\t<foo >\n")
            fp.flush()
            with self.assertRaises(SyntaxError) as ctx:
                list(cast(QuerySolutions, parse_query_results(path=fp.name, format=QueryResultsFormat.TSV)))
            self.assertEqual(ctx.exception.filename, fp.name)
            self.assertEqual(ctx.exception.lineno, 2)
            self.assertEqual(ctx.exception.offset, 3)
            if sys.version_info >= (3, 10):
                self.assertEqual(ctx.exception.end_lineno, 2)
                self.assertEqual(ctx.exception.end_offset, 9)

    def test_query_results_version_round_trip(self) -> None:
        result = cast(
            QuerySolutions,
            parse_query_results(
                '{"head":{"version":"1.2","vars":[]},"results":{"bindings":[]}}',
                QueryResultsFormat.JSON,
                rdf_version=RdfVersion.V1_2,
            ),
        )
        self.assertEqual(
            result.serialize(
                format=QueryResultsFormat.JSON,
                rdf_version=RdfVersion.V1_2,
            ),
            b'{"head":{"version":"1.2","vars":[]},"results":{"bindings":[]}}',
        )
