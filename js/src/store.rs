use crate::format_err;
use crate::io::{
    BytesInput, buffer_from_js_value, convert_base_iri, optional_rdf_version, parse_rdf_version,
    rdf_parser, rdf_serializer,
};
use crate::model::*;
use crate::reflect::*;
use crate::utils::{to_option, to_option_ref};
use js_sys::{Array, Map, try_iter};
use oxigraph::model::RdfVersion;
use oxigraph::sparql::results::{
    QueryResultsFormat, QueryResultsMediaType, QueryResultsSerializer,
};
use oxigraph::sparql::{
    QueryEntailment, QueryEntailmentOptions, QueryResults, SparqlEvaluator, SparqlVersion,
};
use oxigraph::store::Store;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = Store, skip_typescript)]
pub struct JsStore {
    store: Store,
    data_factory: DataFactory,
}

#[wasm_bindgen(js_class = Store)]
impl JsStore {
    #[wasm_bindgen(constructor)]
    pub fn new(quads: &JsValue) -> Result<JsStore, JsValue> {
        console_error_panic_hook::set_once();

        let store = Self {
            store: Store::new().map_err(JsError::from)?,
            data_factory: default_data_factory(),
        };
        if let Some(quads) = to_option_ref(quads) {
            if let Some(quads) = try_iter(quads)? {
                for quad in quads {
                    store.add(&quad?)?;
                }
            }
        }
        Ok(store)
    }

    pub fn add(&self, quad: &JsValue) -> Result<(), JsValue> {
        self.store.insert(to_quad(quad)?).map_err(JsError::from)?;
        Ok(())
    }

    pub fn delete(&self, quad: &JsValue) -> Result<(), JsValue> {
        self.store.remove(&to_quad(quad)?).map_err(JsError::from)?;
        Ok(())
    }

    pub fn has(&self, quad: &JsValue) -> Result<bool, JsValue> {
        Ok(self
            .store
            .contains(&to_quad(quad)?)
            .map_err(JsError::from)?)
    }

    #[wasm_bindgen(getter=size)]
    pub fn size(&self) -> Result<usize, JsError> {
        Ok(self.store.len()?)
    }

    #[wasm_bindgen(js_name = match)]
    pub fn match_quads(
        &self,
        subject: &JsValue,
        predicate: &JsValue,
        object: &JsValue,
        graph_name: &JsValue,
    ) -> Result<Vec<JsValue>, JsValue> {
        let subject = to_option_ref(subject)
            .map(to_named_or_blank_node)
            .transpose()?;
        let predicate = to_option_ref(predicate).map(to_named_node).transpose()?;
        let object = to_option_ref(object).map(to_term).transpose()?;
        let graph_name = to_option_ref(graph_name).map(to_graph_name).transpose()?;
        Ok(self
            .store
            .quads_for_pattern(
                subject.as_ref(),
                predicate.as_ref(),
                object.as_ref(),
                graph_name.as_ref(),
            )
            .map(|v| v.map(|q| from_quad(&self.data_factory, &q)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(JsError::from)?)
    }

    pub fn query(&self, query: &str, options: &JsValue) -> Result<JsValue, JsValue> {
        // Parsing options
        let mut base_iri = None;
        let mut use_default_graph_as_union = false;
        let mut results_format = None;
        let mut results_version = None;
        let mut default_graph = None;
        let mut named_graphs = None;
        let mut sparql_version = None;
        let mut entailment = QueryEntailment::Simple;
        if let Some(options) = to_option_ref(options) {
            base_iri = convert_base_iri(&reflect_get(options, &BASE_IRI)?)?;

            default_graph =
                if let Some(default_graph) = to_option(reflect_get(options, &DEFAULT_GRAPH)?) {
                    Some(if let Some(iter) = try_iter(&default_graph)? {
                        iter.map(|term| to_graph_name(&term?))
                            .collect::<Result<Vec<_>, _>>()?
                    } else {
                        vec![to_graph_name(&default_graph)?]
                    })
                } else {
                    None
                };

            named_graphs =
                if let Some(named_graphs) = to_option(reflect_get(options, &NAMED_GRAPHS)?) {
                    Some(
                        try_iter(&named_graphs)?
                            .ok_or_else(|| format_err!("named_graphs option must be iterable"))?
                            .map(|term| to_named_or_blank_node(&term?))
                            .collect::<Result<Vec<_>, _>>()?,
                    )
                } else {
                    None
                };

            use_default_graph_as_union =
                reflect_get(options, &USED_DEFAULT_GRAPH_AS_UNION)?.is_truthy();

            if let Some(js_results_format) = to_option(reflect_get(options, &RESULTS_FORMAT)?) {
                results_format = Some(
                    js_results_format
                        .as_string()
                        .ok_or_else(|| format_err!("results_format option must be a string"))?,
                );
            }
            if let Some(js_results_version) = to_option(reflect_get(options, &RESULTS_VERSION)?) {
                results_version = Some(parse_version_option(
                    &js_results_version,
                    "results_version",
                )?);
            }
            if let Some(js_sparql_version) = to_option(reflect_get(options, &SPARQL_VERSION)?) {
                sparql_version = Some(parse_sparql_version_option(&js_sparql_version)?);
            }
            if let Some(js_entailment) = to_option(reflect_get(options, &ENTAILMENT)?) {
                entailment = parse_entailment_option(&js_entailment)?;
            }
        }

        let mut evaluator = SparqlEvaluator::new();
        if let Some(base_iri) = base_iri {
            evaluator = evaluator.with_base_iri(&base_iri).map_err(JsError::from)?;
        }
        if let Some(version) = sparql_version {
            evaluator = evaluator.with_version(version);
        }

        let mut prepared_query = evaluator.parse_query(&query).map_err(JsError::from)?;
        if use_default_graph_as_union {
            prepared_query.dataset_mut().set_default_graph_as_union();
        }
        if let Some(default_graph) = default_graph {
            prepared_query
                .dataset_mut()
                .set_default_graph(default_graph);
        }
        if let Some(named_graphs) = named_graphs {
            prepared_query
                .dataset_mut()
                .set_available_named_graphs(named_graphs);
        }

        let entailment_options = QueryEntailmentOptions::new(entailment);
        let results = prepared_query
            .on_store_with_entailment(&self.store, &entailment_options)
            .map_err(JsError::from)?
            .execute()
            .map_err(JsError::from)?;
        Ok(match results {
            QueryResults::Solutions(solutions) => {
                if let Some(results_format) = results_format {
                    let mut serializer =
                        query_results_serializer(&results_format, results_version)?
                            .serialize_solutions_to_writer(Vec::new(), solutions.variables().into())
                            .map_err(JsError::from)?;
                    for solution in solutions {
                        serializer
                            .serialize(&solution.map_err(JsError::from)?)
                            .map_err(JsError::from)?;
                    }
                    JsValue::from_str(
                        &String::from_utf8(serializer.finish().map_err(JsError::from)?)
                            .map_err(JsError::from)?,
                    )
                } else {
                    let results = Array::new();
                    for solution in solutions {
                        let solution = solution.map_err(JsError::from)?;
                        let result = Map::new();
                        for (variable, value) in solution.iter() {
                            result.set(
                                &variable.as_str().into(),
                                &from_term(&self.data_factory, value),
                            );
                        }
                        results.push(&result.into());
                    }
                    results.into()
                }
            }
            QueryResults::Graph(triples) => {
                if let Some(results_format) = results_format {
                    let mut serializer =
                        rdf_serializer(&results_format, results_version)?.for_writer(Vec::new());
                    for triple in triples {
                        serializer
                            .serialize_triple(&triple.map_err(JsError::from)?)
                            .map_err(JsError::from)?;
                    }
                    JsValue::from_str(
                        &String::from_utf8(serializer.finish().map_err(JsError::from)?)
                            .map_err(JsError::from)?,
                    )
                } else {
                    let results = Array::new();
                    for triple in triples {
                        results.push(&from_triple(
                            &self.data_factory,
                            &triple.map_err(JsError::from)?,
                        ));
                    }
                    results.into()
                }
            }
            QueryResults::Boolean(b) => {
                if let Some(results_format) = results_format {
                    JsValue::from_str(
                        &String::from_utf8(
                            query_results_serializer(&results_format, results_version)?
                                .serialize_boolean_to_writer(Vec::new(), b)
                                .map_err(JsError::from)?,
                        )
                        .map_err(JsError::from)?,
                    )
                } else {
                    b.into()
                }
            }
        })
    }

    pub fn update(&self, update: &str, options: &JsValue) -> Result<(), JsValue> {
        // Parsing options
        let mut base_iri = None;
        let mut sparql_version = None;
        if let Some(options) = to_option_ref(options) {
            base_iri = convert_base_iri(&reflect_get(options, &BASE_IRI)?)?;
            if let Some(js_sparql_version) = to_option(reflect_get(options, &SPARQL_VERSION)?) {
                sparql_version = Some(parse_sparql_version_option(&js_sparql_version)?);
            }
        }

        let mut evaluator = SparqlEvaluator::new();
        if let Some(base_iri) = base_iri {
            evaluator = evaluator.with_base_iri(&base_iri).map_err(JsError::from)?;
        }
        if let Some(version) = sparql_version {
            evaluator = evaluator.with_version(version);
        }

        Ok(evaluator
            .parse_update(update)
            .map_err(JsError::from)?
            .on_store(&self.store)
            .execute()
            .map_err(JsError::from)?)
    }

    pub fn load(&self, data: &JsValue, options: &JsValue) -> Result<(), JsValue> {
        // Parsing options
        let mut format = None;
        let mut base_iri = None;
        let mut to_graph_name_rs = None;
        let mut lenient = false;
        let mut no_transaction = false;
        let mut rdf_version = None;
        if let Some(options) = to_option_ref(options) {
            if let Some(format_str) = reflect_get(options, &FORMAT)?.as_string() {
                format = Some(format_str);
            }
            base_iri = convert_base_iri(&reflect_get(options, &BASE_IRI)?)?;
            to_graph_name_rs = to_option_ref(&reflect_get(options, &TO_GRAPH_NAME)?)
                .map(to_graph_name)
                .transpose()?;
            lenient = reflect_get(options, &LENIENT)?.is_truthy();
            no_transaction = reflect_get(options, &NO_TRANSACTION)?.is_truthy();
            rdf_version = optional_rdf_version(options)?;
        }
        let format = format
            .ok_or_else(|| format_err!("The format option should be provided as a second argument of Store.load like store.load(my_content, {{format: 'nt'}}"))?;

        let mut parser = rdf_parser(&format, rdf_version)?;
        if let Some(to_graph_name) = to_graph_name_rs {
            parser = parser.with_default_graph(to_graph_name);
        }
        if let Some(base_iri) = base_iri {
            parser = parser.with_base_iri(&base_iri).map_err(JsError::from)?;
        }
        if lenient {
            parser = parser.lenient();
        }
        if let Some(buffer) = buffer_from_js_value(data) {
            if no_transaction {
                let mut loader = self.store.bulk_loader();
                loader
                    .load_from_slice(parser, &buffer)
                    .map_err(JsError::from)?;
                loader.commit().map_err(JsError::from)?;
            } else {
                self.store
                    .load_from_slice(parser, &buffer)
                    .map_err(JsError::from)?;
            }
        } else if let Some(iterator) = try_iter(data)? {
            if no_transaction {
                let mut loader = self.store.bulk_loader();
                loader
                    .load_from_reader(parser, BytesInput::from(iterator))
                    .map_err(JsError::from)?;
                loader.commit().map_err(JsError::from)?;
            } else {
                self.store
                    .load_from_reader(parser, BytesInput::from(iterator))
                    .map_err(JsError::from)?;
            }
        } else {
            return Err(format_err!(
                "The input must be a string, Uint8Array or an iterator of string or Uint8Array"
            ));
        }
        Ok(())
    }

    pub fn dump(&self, options: &JsValue) -> Result<String, JsValue> {
        // Serialization options
        let mut format = None;
        let mut from_graph_name_rs = None;
        let mut rdf_version = None;
        if let Some(options) = to_option_ref(options) {
            if let Some(format_str) = reflect_get(options, &FORMAT)?.as_string() {
                format = Some(format_str);
            }
            from_graph_name_rs = to_option_ref(&reflect_get(options, &FROM_GRAPH_NAME)?)
                .map(to_graph_name)
                .transpose()?;
            rdf_version = optional_rdf_version(options)?;
        }
        let format = format
            .ok_or_else(|| format_err!("The format option should be provided as a second argument of Store.load like store.dump({{format: 'nt'}}"))?;

        let serializer = rdf_serializer(&format, rdf_version)?;
        let buffer = if let Some(from_graph_name) = from_graph_name_rs {
            self.store
                .dump_graph_to_writer(&from_graph_name, serializer, Vec::new())
        } else {
            self.store.dump_to_writer(serializer, Vec::new())
        }
        .map_err(JsError::from)?;
        Ok(String::from_utf8(buffer).map_err(JsError::from)?)
    }
}

fn query_results_serializer(
    format: &str,
    results_version: Option<RdfVersion>,
) -> Result<QueryResultsSerializer, JsValue> {
    let (format, inline_version) = if format.contains('/') {
        let media_type = if let Some(version) = results_version {
            format!("{format}; version={}", rdf_version_label(version))
        } else {
            format.to_owned()
        };
        let descriptor =
            QueryResultsMediaType::parse(&media_type).map_err(|error| format_err!("{error}"))?;
        (descriptor.format(), descriptor.version())
    } else {
        (
            QueryResultsFormat::from_extension(format).ok_or_else(|| {
                format_err!(
                    "Not supported SPARQL query results format extension: {}",
                    format
                )
            })?,
            results_version,
        )
    };
    let serializer = QueryResultsSerializer::from_format(format);
    if let Some(version) = inline_version {
        serializer
            .with_rdf_version(version)
            .map_err(|error| format_err!("{error}"))
    } else {
        Ok(serializer)
    }
}

fn parse_version_option(value: &JsValue, option: &str) -> Result<RdfVersion, JsValue> {
    let value = value
        .as_string()
        .ok_or_else(|| format_err!("{option} option must be a string"))?;
    parse_rdf_version(&value)
}

fn parse_sparql_version_option(value: &JsValue) -> Result<SparqlVersion, JsValue> {
    let value = value
        .as_string()
        .ok_or_else(|| format_err!("sparql_version option must be a string"))?;
    match value.as_str() {
        "1.1" => Ok(SparqlVersion::V1_1),
        "1.2-basic" => Ok(SparqlVersion::V1_2Basic),
        "1.2" => Ok(SparqlVersion::V1_2),
        _ => Err(format_err!(
            "Unsupported SPARQL version '{value}'; expected '1.1', '1.2-basic', or '1.2'"
        )),
    }
}

fn parse_entailment_option(value: &JsValue) -> Result<QueryEntailment, JsValue> {
    let value = value
        .as_string()
        .ok_or_else(|| format_err!("entailment option must be a string"))?;
    match value.as_str() {
        "simple" => Ok(QueryEntailment::Simple),
        "rdf-1.2-finite" => Ok(QueryEntailment::Rdf12Finite),
        "rdfs-1.2-finite" => Ok(QueryEntailment::Rdfs12Finite),
        "owl2-rl-rdf-bounded" => Ok(QueryEntailment::Owl2RlRdfBounded),
        _ => Err(format_err!(
            "Unsupported query entailment profile '{value}'"
        )),
    }
}

const fn rdf_version_label(version: RdfVersion) -> &'static str {
    match version {
        RdfVersion::V1_1 => "1.1",
        RdfVersion::V1_2Basic => "1.2-basic",
        RdfVersion::V1_2 => "1.2",
        _ => "unknown",
    }
}
