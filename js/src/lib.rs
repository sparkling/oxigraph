use wasm_bindgen::prelude::*;

mod io;
mod model;
mod reflect;
mod store;
mod utils;

// We skip_typescript on specific wasm_bindgen macros and provide custom TypeScript types for parts of this module to have narrower types
// instead of any and improve compatibility with RDF/JS Dataset interfaces (https://rdf.js.org/dataset-spec/).
#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT_CUSTOM_SECTION: &str = r###"
import { BaseQuad, BlankNode, DataFactory, Literal, NamedNode, DefaultGraph, Term } from "@rdfjs/types";

export type RdfVersion = "1.1" | "1.2-basic" | "1.2";
export type SparqlVersion = "1.1" | "1.2-basic" | "1.2";
export type QueryEntailment =
    | "simple"
    | "rdf-1.2-finite"
    | "rdfs-1.2-finite"
    | "owl2-rl-rdf-bounded";

interface Quad extends BaseQuad {
    subject: NamedNode | BlankNode;
    predicate: NamedNode;
    object: NamedNode | BlankNode | Literal | Quad;
    graph: NamedNode | BlankNode | DefaultGraph;
}

export class Store {
    readonly size: number;

    constructor(quads?: Iterable<Quad>);

    add(quad: Quad): void;

    delete(quad: Quad): void;

    dump(
        options: {
            format: string;
            from_graph_name?: BlankNode | DefaultGraph | NamedNode;
            rdf_version?: RdfVersion;
        }
    ): string;

    has(quad: Quad): boolean;

    load(
        input: string | Uint8Array | Iterable<string | Uint8Array>,
        options: {
            base_iri?: NamedNode | string;
            format: string;
            no_transaction?: boolean;
            rdf_version?: RdfVersion;
            to_graph_name?: BlankNode | DefaultGraph | NamedNode;
            unchecked?: boolean;
            lenient?: boolean;
        }
    ): void;

    match(
        subject?: BlankNode | NamedNode | null,
        predicate?: NamedNode | null,
        object?: Quad | Term | null,
        graph?: BlankNode | DefaultGraph | NamedNode | null
    ): Quad[];

    query(
        query: string,
        options?: {
            base_iri?: NamedNode | string;
            results_format?: string;
            default_graph?: BlankNode | DefaultGraph | NamedNode | Iterable<BlankNode | DefaultGraph | NamedNode>;
            entailment?: QueryEntailment;
            named_graphs?: Iterable<BlankNode | NamedNode>;
            use_default_graph_as_union?: boolean;
            results_version?: RdfVersion;
            sparql_version?: SparqlVersion;
        }
    ): boolean | Map<string, Quad | Term>[] | Quad[] | string;

    update(
        update: string,
        options?: {
            base_iri?: NamedNode | string;
            sparql_version?: SparqlVersion;
        }
    ): void;
}

function parse(
    input: string | Uint8Array,
    options: {
        base_iri?: NamedNode | string;
        format: string;
        rdf_version?: RdfVersion;
        to_graph_name?: BlankNode | DefaultGraph | NamedNode;
        lenient?: boolean;
        data_factory?: DataFactory;
    }
): Quad[];

function parse(
    input: Iterable<string | Uint8Array>,
    options: {
        base_iri?: NamedNode | string;
        format: string;
        rdf_version?: RdfVersion;
        to_graph_name?: BlankNode | DefaultGraph | NamedNode;
        lenient?: boolean;
        data_factory?: DataFactory;
    }
): IterableIterator<Quad>;

function parse(
    input: AsyncIterable<string | Uint8Array>,
    options: {
        base_iri?: NamedNode | string;
        format: string;
        rdf_version?: RdfVersion;
        to_graph_name?: BlankNode | DefaultGraph | NamedNode;
        lenient?: boolean;
        data_factory?: DataFactory;
    }
): AsyncIterableIterator<Quad>;
"###;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}
