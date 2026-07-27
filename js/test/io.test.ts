import assert from "node:assert";
import { webcrypto } from "node:crypto";
import dataModel from "@rdfjs/data-model";
import { describe, it, vi } from "vitest";
import { parse } from "../pkg";

// thread_rng: Node.js ES modules are not directly supported, see https://docs.rs/getrandom#nodejs-es-module-support
vi.stubGlobal("crypto", webcrypto);

const ex = dataModel.namedNode("http://example.com");

describe("parse", () => {
    it("parse NTriples in the default graph", () => {
        const result = parse("<http://example.com> <http://example.com> <http://example.com> .", {
            format: "application/n-triples",
        });
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse NTriples in an other graph", () => {
        const result = parse("<http://example.com> <http://example.com> <http://example.com> .", {
            format: "application/n-triples",
            to_graph_name: ex,
        });
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex, ex)));
    });

    it("parse Turtle with a base IRI", () => {
        const result = parse("<http://example.com> <http://example.com> <> .", {
            base_iri: "http://example.com",
            format: "text/turtle",
        });
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse NQuads", () => {
        const result = parse(
            "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .",
            { format: "application/n-quads" },
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex, ex)));
    });

    it("parse TriG with a base IRI", () => {
        const result = parse("GRAPH <> { <http://example.com> <http://example.com> <> }", {
            format: "application/trig",
            base_iri: "http://example.com",
        });
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex, ex)));
    });

    it("parse TriG with options", () => {
        const result = parse("GRAPH <> { <http://example.com> <http://example.com> <> }", {
            format: "application/trig",
            base_iri: "http://example.com",
            lenient: true,
        });
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex, ex)));
    });

    it("preserves RDF 1.2 directional literals and triple terms", () => {
        const result = parse(
            `VERSION "1.2"
             <http://example.com> <http://example.com> "hello"@en--ltr .
             <http://example.com> <http://example.com>
               <<( <http://example.com> <http://example.com> "nested" )>> .`,
            { format: "text/turtle" },
        );

        assert.strictEqual(result.length, 2);
        const directional = result[0].object;
        assert.strictEqual(directional.termType, "Literal");
        if (directional.termType !== "Literal") {
            assert.fail("expected an RDF literal");
        }
        assert.strictEqual(directional.language, "en");
        assert.strictEqual(directional.direction, "ltr");
        assert.strictEqual(
            directional.datatype.value,
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
        );

        const triple = result[1].object;
        assert.strictEqual(triple.termType, "Quad");
        if (triple.termType !== "Quad") {
            assert.fail("expected an RDF triple term");
        }
        assert(triple.subject.equals(ex));
        assert(triple.predicate.equals(ex));
        assert(triple.object.equals(dataModel.literal("nested")));
        assert(triple.graph.equals(dataModel.defaultGraph()));
    });

    it("enforces an explicit RDF version from media types and options", () => {
        const data =
            "<http://example.com> <http://example.com> " +
            "<<( <http://example.com> <http://example.com> <http://example.com> )>> .";
        assert.throws(
            () =>
                parse(data, {
                    format: "application/n-triples; version=1.1",
                }),
            /triple terms/,
        );
        assert.strictEqual(
            parse(data, {
                format: "application/n-triples",
                rdf_version: "1.2",
            }).length,
            1,
        );
    });

    it("parse Buffer", () => {
        const result = parse(
            Buffer.from("<http://example.com> <http://example.com> <http://example.com> ."),
            {
                format: "application/n-triples",
            },
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse Array<string>", () => {
        const result = Array.from(
            parse(["<http://example.com> <http://example.com> <http://example.com> ."], {
                format: "application/n-triples",
            }),
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse Array<Buffer>", () => {
        const result = Array.from(
            parse(
                [Buffer.from("<http://example.com> <http://example.com> <http://example.com> .")],
                {
                    format: "application/n-triples",
                },
            ),
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse AsyncGenerator<string>", async () => {
        const result = await arrayFromAsyncIterable(
            parse(
                asyncIterator(["<http://example.com> <http://example.com> <http://example.com> ."]),
                {
                    format: "application/n-triples",
                },
            ),
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });

    it("parse Array<Buffer>", async () => {
        const result = await arrayFromAsyncIterable(
            parse(
                asyncIterator([
                    Buffer.from("<http://example.com> <http://example.com> <http://example.com> ."),
                ]),
                {
                    format: "application/n-triples",
                },
            ),
        );
        assert.strictEqual(result.length, 1);
        assert(result[0].equals(dataModel.quad(ex, ex, ex)));
    });
});

async function arrayFromAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    // TODO: replace with Array.fromAsync when available
    const output = [];
    for await (const item of iterable) {
        output.push(item);
    }
    return output;
}

async function* asyncIterator<T>(iterable: Iterable<T>): AsyncIterator<T> {
    for (const item of iterable) {
        yield item;
    }
}
