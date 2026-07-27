import assert from "node:assert";
import { webcrypto } from "node:crypto";
import dataModel from "@rdfjs/data-model";
import type { Quad, Term } from "@rdfjs/types";
import { describe, it, vi } from "vitest";
import { Store } from "../pkg";

// thread_rng: Node.js ES modules are not directly supported, see https://docs.rs/getrandom#nodejs-es-module-support
vi.stubGlobal("crypto", webcrypto);

const ex = dataModel.namedNode("http://example.com");
const ex2 = dataModel.namedNode("http://example.com/2");
const triple = dataModel.quad(
    dataModel.blankNode("s"),
    dataModel.namedNode("http://example.com/p"),
    dataModel.literal("o"),
);

describe("Store", () => {
    describe("#add()", () => {
        it("an added quad should be in the store", () => {
            const store = new Store();
            store.add(dataModel.quad(ex, ex, triple));
            assert(store.has(dataModel.quad(ex, ex, triple)));
        });

        it("rejects reserved literal datatypes without their required components", () => {
            const store = new Store();
            const invalidLangString = {
                termType: "Literal" as const,
                value: "foo",
                language: "",
                datatype: dataModel.namedNode(
                    "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
                ),
                equals: () => false,
            };
            const invalidDirLangString = {
                ...invalidLangString,
                datatype: dataModel.namedNode(
                    "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
                ),
            };

            assert.throws(
                () => store.add(dataModel.quad(ex, ex, invalidLangString)),
                /must have a language/,
            );
            assert.throws(
                () => store.add(dataModel.quad(ex, ex, invalidDirLangString)),
                /must have a language/,
            );
        });
    });

    describe("#delete()", () => {
        it("a removed quad should not be in the store anymore", () => {
            const store = new Store([dataModel.quad(ex, ex, triple, ex)]);
            assert(store.has(dataModel.quad(ex, ex, triple, ex)));
            store.delete(dataModel.quad(ex, ex, triple, ex));
            assert(!store.has(dataModel.quad(ex, ex, triple, ex)));
        });
    });

    describe("#has()", () => {
        it("an added quad should be in the store", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            assert(store.has(dataModel.quad(ex, ex, ex)));
        });
    });

    describe("#size()", () => {
        it("A store with one quad should have 1 for size", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            assert.strictEqual(1, store.size);
        });
    });

    describe("#match_quads()", () => {
        it("blank pattern should return all quads", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.match();
            assert.strictEqual(1, results.length);
            assert(dataModel.quad(ex, ex, ex).equals(results[0]));
        });
    });

    describe("#query()", () => {
        it("ASK true", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            assert.strictEqual(true, store.query("ASK { ?s ?s ?s }"));
        });

        it("ASK false", () => {
            const store = new Store();
            assert.strictEqual(false, store.query("ASK { FILTER(false)}"));
        });

        it("uses an explicit SPARQL version", () => {
            const query =
                "ASK { BIND( <<( <http://example.com/s> <http://example.com/p> " +
                "<http://example.com/o> )>> AS ?triple) }";
            const store = new Store();
            assert.throws(() => store.query(query, { sparql_version: "1.1" }), /SPARQL 1.1/);
            assert.strictEqual(true, store.query(query, { sparql_version: "1.2" }));
        });

        it("uses only explicit bounded entailment profiles", () => {
            const rdfType = dataModel.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
            const subClassOf = dataModel.namedNode(
                "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            );
            const child = dataModel.namedNode("http://example.com/Child");
            const parent = dataModel.namedNode("http://example.com/Parent");
            const alice = dataModel.namedNode("http://example.com/alice");
            const store = new Store([
                dataModel.quad(child, subClassOf, parent),
                dataModel.quad(alice, rdfType, child),
            ]);
            const query = "ASK { <http://example.com/alice> a <http://example.com/Parent> }";
            assert.strictEqual(false, store.query(query));
            assert.strictEqual(true, store.query(query, { entailment: "rdfs-1.2-finite" }));
            assert.throws(
                () => store.query(query, { entailment: "rdfs" as never }),
                /Unsupported query entailment profile/,
            );
        });

        it("runs bounded OWL 2 RL/RDF entailment in WASM", () => {
            const rdfType = dataModel.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
            const transitiveProperty = dataModel.namedNode(
                "http://www.w3.org/2002/07/owl#TransitiveProperty",
            );
            const ancestor = dataModel.namedNode("http://example.com/ancestor");
            const alice = dataModel.namedNode("http://example.com/alice");
            const bob = dataModel.namedNode("http://example.com/bob");
            const carol = dataModel.namedNode("http://example.com/carol");
            const store = new Store([
                dataModel.quad(ancestor, rdfType, transitiveProperty),
                dataModel.quad(alice, ancestor, bob),
                dataModel.quad(bob, ancestor, carol),
            ]);
            assert.strictEqual(
                true,
                store.query(
                    "ASK { <http://example.com/alice> " +
                        "<http://example.com/ancestor> <http://example.com/carol> }",
                    { entailment: "owl2-rl-rdf-bounded" },
                ),
            );
        });

        it("CONSTRUCT", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }") as Quad[];
            assert.strictEqual(1, results.length);
            assert(dataModel.quad(ex, ex, ex).equals(results[0]));
        });

        it("SELECT", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("SELECT ?s WHERE { ?s ?p ?o }") as Map<string, Term>[];
            assert.strictEqual(1, results.length);
            assert(ex.equals(results[0]?.get("s")));
        });

        it("SELECT with NOW()", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query(
                "SELECT * WHERE { FILTER(2022 <= YEAR(NOW()) && YEAR(NOW()) <= 2100) }",
            ) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with RAND()", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("SELECT (RAND() AS ?y) WHERE {}") as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with base IRI", () => {
            const store = new Store();
            const results = store.query("SELECT * WHERE { BIND(<t> AS ?t) }", {
                base_iri: "http://example.com/",
            }) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with union graph", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            const results = store.query("SELECT * WHERE { ?s ?p ?o }", {
                use_default_graph_as_union: true,
            }) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with explicit default graph", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            const results = store.query("SELECT * WHERE { ?s ?p ?o }", {
                default_graph: ex,
            }) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("RDF-merges an explicit default graph list as a set", () => {
            const store = new Store([dataModel.quad(ex, ex, ex), dataModel.quad(ex, ex, ex, ex)]);
            const results = store.query("SELECT * WHERE { ?s ?p ?o }", {
                default_graph: [dataModel.defaultGraph(), ex],
            }) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with explicit named graphs list", () => {
            const store = new Store([
                dataModel.quad(ex, ex, ex, ex),
                dataModel.quad(ex, ex, ex, ex2),
            ]);
            const results = store.query("SELECT * WHERE { GRAPH ?g { ?s ?p ?o } }", {
                named_graphs: [ex],
            }) as Map<string, Term>[];
            assert.strictEqual(1, results.length);
        });

        it("SELECT with results format", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("SELECT ?s ?p ?o WHERE { ?s ?p ?o }", {
                results_format: "json",
            });
            assert.strictEqual(
                '{"head":{"vars":["s","p","o"]},"results":{"bindings":[{"s":{"type":"uri","value":"http://example.com"},"p":{"type":"uri","value":"http://example.com"},"o":{"type":"uri","value":"http://example.com"}}]}}',
                results,
            );
        });

        it("serializes an explicit SPARQL results version", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("SELECT ?s WHERE { ?s ?p ?o }", {
                results_format: "application/sparql-results+json",
                results_version: "1.2",
            });
            assert.strictEqual("1.2", JSON.parse(results as string).head.version);
        });

        it("CONSTRUCT with results format", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("CONSTRUCT WHERE { ?s ?p ?o }", {
                results_format: "text/turtle",
            });
            assert.strictEqual(
                "<http://example.com> <http://example.com> <http://example.com> .\n",
                results,
            );
        });

        it("ASK with results format", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            const results = store.query("ASK { ?s ?p ?o }", {
                results_format: "csv",
            });
            assert.strictEqual("true", results);
        });
    });

    describe("#update()", () => {
        it("INSERT DATA", () => {
            const store = new Store();
            store.update(
                "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
            );
            assert.strictEqual(1, store.size);
        });

        it("uses an explicit SPARQL version", () => {
            const update =
                "INSERT DATA { <http://example.com/s> <http://example.com/p> " +
                "<<( <http://example.com/s> <http://example.com/p> " +
                "<http://example.com/o> )>> }";
            assert.throws(
                () => new Store().update(update, { sparql_version: "1.1" }),
                /SPARQL 1.1/,
            );
            const store = new Store();
            store.update(update, { sparql_version: "1.2" });
            assert.strictEqual(1, store.size);
        });

        it("DELETE DATA", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            store.update(
                "DELETE DATA { <http://example.com> <http://example.com> <http://example.com> }",
            );
            assert.strictEqual(0, store.size);
        });

        it("DELETE WHERE", () => {
            const store = new Store([dataModel.quad(ex, ex, ex)]);
            store.update("DELETE WHERE { ?v ?v ?v }");
            assert.strictEqual(0, store.size);
        });
    });

    describe("#load()", () => {
        it("load NTriples in the default graph", () => {
            const store = new Store();
            store.load("<http://example.com> <http://example.com> <http://example.com> .", {
                format: "application/n-triples",
            });
            assert(store.has(dataModel.quad(ex, ex, ex)));
        });

        it("load NTriples in an other graph", () => {
            const store = new Store();
            store.load(["<http://example.com> <http://example.com> <http://example.com> ."], {
                format: "application/n-triples",
                to_graph_name: ex,
            });
            assert(store.has(dataModel.quad(ex, ex, ex, ex)));
        });

        it("load Turtle with a base IRI", () => {
            const store = new Store();
            store.load(Buffer.from("<http://example.com> <http://example.com> <> ."), {
                base_iri: "http://example.com",
                format: "text/turtle",
            });
            assert(store.has(dataModel.quad(ex, ex, ex)));
        });

        it("load NQuads", () => {
            const store = new Store();
            store.load(
                [
                    Buffer.from(
                        "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .",
                    ),
                ],
                { format: "application/n-quads" },
            );
            assert(store.has(dataModel.quad(ex, ex, ex, ex)));
        });

        it("load TriG with a base IRI", () => {
            const store = new Store();
            store.load("GRAPH <> { <http://example.com> <http://example.com> <> }", {
                format: "application/trig",
                base_iri: "http://example.com",
            });
            assert(store.has(dataModel.quad(ex, ex, ex, ex)));
        });

        it("load TriG with options", () => {
            const store = new Store();
            store.load("GRAPH <> { <http://example.com> <http://example.com> <> }", {
                format: "application/trig",
                base_iri: "http://example.com",
                unchecked: true,
                no_transaction: true,
            });
            assert(store.has(dataModel.quad(ex, ex, ex, ex)));
        });

        it("preserves empty TriG graph topology in transactional and bulk loads", () => {
            for (const no_transaction of [false, true]) {
                const store = new Store();
                store.load("<http://example.com/empty> {}", {
                    format: "application/trig",
                    no_transaction,
                });
                assert.strictEqual(0, store.size);
                assert.match(
                    store.dump({ format: "application/trig" }),
                    /<http:\/\/example\.com\/empty>\s*\{\s*\}/,
                );
            }
        });

        it("round-trips IRI and blank empty graph topology through JSON-LD", () => {
            const input = JSON.stringify([
                { "@id": "http://example.com/empty", "@graph": [] },
                { "@id": "_:empty-blank", "@graph": [] },
            ]);
            for (const no_transaction of [false, true]) {
                const store = new Store();
                store.load(input, {
                    format: "application/ld+json",
                    no_transaction,
                });
                assert.strictEqual(0, store.size);

                const output = store.dump({ format: "application/ld+json" });
                const graphNames = (
                    JSON.parse(output) as Array<{
                        "@id": string;
                        "@graph": unknown[];
                    }>
                )
                    .filter((entry) => entry["@graph"].length === 0)
                    .map((entry) => entry["@id"]);
                assert.strictEqual(graphNames.length, 2);
                assert(graphNames.includes("http://example.com/empty"));
                assert.strictEqual(
                    graphNames.filter((graphName) => graphName.startsWith("_:")).length,
                    1,
                );

                const restored = new Store();
                restored.load(output, { format: "application/ld+json" });
                assert.strictEqual(0, restored.size);
                assert.match(
                    restored.dump({ format: "application/trig" }),
                    /<http:\/\/example\.com\/empty>\s*\{\s*\}/,
                );
                assert.match(restored.dump({ format: "application/trig" }), /_:[^\s]+\s*\{\s*\}/);
            }
        });

        it("loads RDF 1.2 terms with an explicit version", () => {
            const store = new Store();
            store.load(
                'VERSION "1.2"\n' +
                    "<http://example.com> <http://example.com> " +
                    "<<( <http://example.com> <http://example.com> " +
                    "<http://example.com> )>> .",
                {
                    format: "application/n-triples",
                    rdf_version: "1.2",
                },
            );
            assert.strictEqual(1, store.size);
        });
    });

    describe("#dump()", () => {
        it("dump dataset content", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            assert.strictEqual(
                "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .\n",
                store.dump({ format: "application/n-quads" }),
            );
        });

        it("fails closed when the format cannot represent empty graph topology", () => {
            const store = new Store();
            store.load("<http://example.com/empty> {}", {
                format: "application/trig",
            });
            assert.throws(
                () => store.dump({ format: "application/n-quads" }),
                /cannot represent empty named graphs/,
            );
        });

        it("dump named graph content", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            assert.strictEqual(
                "<http://example.com> <http://example.com> <http://example.com> .\n",
                store.dump({ format: "application/n-triples", from_graph_name: ex }),
            );
        });

        it("dump named graph content with options", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            assert.strictEqual(
                "<http://example.com> <http://example.com> <http://example.com> .\n",
                store.dump({ format: "application/n-triples", from_graph_name: ex }),
            );
        });

        it("dumps RDF 1.2 terms with an explicit version", () => {
            const store = new Store([dataModel.quad(ex, ex, triple)]);
            const output = store.dump({
                format: "application/n-triples",
                from_graph_name: dataModel.defaultGraph(),
                rdf_version: "1.2",
            });
            assert.match(output, /^VERSION "1\.2"/);
            assert.match(output, /<<\(/);
        });

        it("dump default graph content", () => {
            const store = new Store([dataModel.quad(ex, ex, ex, ex)]);
            assert.strictEqual(
                "",
                store.dump({
                    format: "application/n-triples",
                    from_graph_name: dataModel.defaultGraph(),
                }),
            );
        });
    });
});
