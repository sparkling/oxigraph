package org.oxigraph.parity;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.NodeFactory;
import org.apache.jena.query.ARQ;
import org.apache.jena.query.Dataset;
import org.apache.jena.query.DatasetFactory;
import org.apache.jena.query.Query;
import org.apache.jena.query.QueryExecution;
import org.apache.jena.query.QueryException;
import org.apache.jena.query.QueryFactory;
import org.apache.jena.query.QuerySolution;
import org.apache.jena.query.ResultSet;
import org.apache.jena.query.Syntax;
import org.apache.jena.rdf.model.InfModel;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.reasoner.Reasoner;
import org.apache.jena.reasoner.ReasonerRegistry;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.riot.RDFFormat;
import org.apache.jena.riot.RDFLanguages;
import org.apache.jena.riot.RDFParser;
import org.apache.jena.shacl.ShaclValidator;
import org.apache.jena.shacl.ValidationReport;
import org.apache.jena.shacl.validation.ReportEntry;
import org.apache.jena.sparql.core.Var;
import org.apache.jena.sparql.engine.iterator.QueryIterSingleton;
import org.apache.jena.sparql.path.P_Path0;
import org.apache.jena.sparql.path.Path;
import org.apache.jena.sparql.path.PathWriter;
import org.apache.jena.sparql.service.ServiceExecutorRegistry;
import org.apache.jena.sparql.util.Context;
import org.apache.jena.update.UpdateAction;
import org.apache.jena.update.UpdateFactory;
import org.apache.jena.update.UpdateRequest;

final class JenaEngine {
    private static final String BASE = "https://example.test/base/";
    private static final String OFFLINE_SERVICE = "urn:oxigraph:jena-parity:service";
    private static final String OFFLINE_VALUE = "offline-service";

    JsonObject observe(Scenario scenario) {
        scenario.validate();
        try {
            return switch (scenario.operation()) {
                case "rdf-parse" -> success("dataset", parseValue(scenario));
                case "rdf-roundtrip" -> success("dataset", roundTripValue(scenario));
                case "sparql-select" -> select(scenario);
                case "sparql-ask" -> ask(scenario);
                case "sparql-construct" -> construct(scenario);
                case "sparql-describe" -> describe(scenario);
                case "sparql-service" -> service(scenario);
                case "sparql-update" -> update(scenario);
                case "shacl-validate", "shacl-sparql-validate" -> shacl(scenario);
                case "entailment" -> entailment(scenario);
                case "sparql-unsupported", "shacl-unsupported" ->
                        unsupported("outside-enumerated-profile");
                default -> throw new IllegalArgumentException(
                        "unknown operation " + scenario.operation());
            };
        } catch (UnsupportedOperationException error) {
            return unsupported(error.getMessage());
        } catch (RuntimeException error) {
            return failure(error);
        }
    }

    private static JsonObject parseValue(Scenario scenario) {
        return Canonicalizer.dataset(parseDataset(scenario.data(), scenario.syntax()));
    }

    private static JsonObject roundTripValue(Scenario scenario) {
        Dataset parsed = parseDataset(scenario.data(), scenario.syntax());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        RDFFormat format = outputFormat(scenario.outputSyntax());
        if (RDFLanguages.isTriples(format.getLang())) {
            RDFDataMgr.write(output, parsed.getDefaultModel(), format);
        } else {
            RDFDataMgr.write(output, parsed, format);
        }
        String serialized = output.toString(StandardCharsets.UTF_8);
        Dataset reparsed = parseDataset(serialized, scenario.outputSyntax());
        return Canonicalizer.dataset(reparsed);
    }

    private static JsonObject select(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        Query query = parseQuery(scenario);
        try (QueryExecution execution =
                QueryExecution.dataset(dataset).query(query).build()) {
            ResultSet results = execution.execSelect();
            List<String> variables = results.getResultVars();
            List<Map<String, Node>> rows = new ArrayList<>();
            while (results.hasNext()) {
                QuerySolution solution = results.nextSolution();
                Map<String, Node> row = new LinkedHashMap<>();
                for (String variable : variables) {
                    if (solution.contains(variable)) {
                        row.put(variable, solution.get(variable).asNode());
                    }
                }
                rows.add(row);
            }
            return success(
                    "solutions",
                    Canonicalizer.solutions(variables, rows, scenario.isOrdered()));
        }
    }

    private static JsonObject ask(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        Query query = parseQuery(scenario);
        try (QueryExecution execution =
                QueryExecution.dataset(dataset).query(query).build()) {
            return success("boolean", execution.execAsk());
        }
    }

    private static JsonObject construct(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        Query query = parseQuery(scenario);
        try (QueryExecution execution =
                QueryExecution.dataset(dataset).query(query).build()) {
            Model graph = execution.execConstruct();
            Dataset result = DatasetFactory.createTxnMem();
            result.setDefaultModel(graph);
            return success("dataset", Canonicalizer.dataset(result));
        }
    }

    private static JsonObject describe(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        Query query = parseQuery(scenario);
        try (QueryExecution execution =
                QueryExecution.dataset(dataset).query(query).build()) {
            Model graph = execution.execDescribe();
            Dataset result = DatasetFactory.createTxnMem();
            result.setDefaultModel(graph);
            return success("dataset", Canonicalizer.dataset(result));
        }
    }

    private static JsonObject service(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        Query query = parseQuery(scenario);
        Context context = ARQ.getContext().copy();
        ServiceExecutorRegistry registry = new ServiceExecutorRegistry();
        registry.add((opExecute, _opOriginal, binding, executionContext) -> {
            Node endpoint = opExecute.getService();
            if (!endpoint.isURI() || !OFFLINE_SERVICE.equals(endpoint.getURI())) {
                throw new QueryException("unexpected offline SERVICE endpoint " + endpoint);
            }
            return QueryIterSingleton.create(
                    binding,
                    Var.alloc("remote"),
                    NodeFactory.createLiteralString(OFFLINE_VALUE),
                    executionContext);
        });
        ServiceExecutorRegistry.set(context, registry);
        try (QueryExecution execution =
                QueryExecution.dataset(dataset).query(query).context(context).build()) {
            ResultSet results = execution.execSelect();
            List<String> variables = results.getResultVars();
            List<Map<String, Node>> rows = new ArrayList<>();
            while (results.hasNext()) {
                QuerySolution solution = results.nextSolution();
                Map<String, Node> row = new LinkedHashMap<>();
                for (String variable : variables) {
                    if (solution.contains(variable)) {
                        row.put(variable, solution.get(variable).asNode());
                    }
                }
                rows.add(row);
            }
            return success(
                    "solutions",
                    Canonicalizer.solutions(variables, rows, scenario.isOrdered()));
        }
    }

    private static JsonObject update(Scenario scenario) {
        Dataset dataset = parseDataset(scenario.data(), scenario.syntax());
        UpdateRequest request =
                UpdateFactory.create(scenario.update(), BASE, Syntax.syntaxSPARQL_12);
        UpdateAction.execute(request, dataset);
        return success("dataset", Canonicalizer.dataset(dataset));
    }

    private static JsonObject shacl(Scenario scenario) {
        Dataset data = parseDataset(scenario.data(), scenario.syntax());
        Dataset shapes = parseDataset(scenario.shapes(), "turtle");
        ValidationReport report = ShaclValidator.get()
                .validate(shapes.getDefaultModel().getGraph(), data.getDefaultModel().getGraph());
        JsonObject value = new JsonObject();
        value.addProperty("conforms", report.conforms());
        List<String> entries = new ArrayList<>();
        for (ReportEntry entry : report.getEntries()) {
            entries.add(shaclEntry(entry).toString());
        }
        entries.sort(String::compareTo);
        JsonArray results = new JsonArray();
        entries.forEach(serialized ->
                results.add(com.google.gson.JsonParser.parseString(serialized)));
        value.addProperty("result_count", results.size());
        value.add("results", results);
        return success("shacl-report", value);
    }

    private static JsonObject entailment(Scenario scenario) {
        Dataset data = parseDataset(scenario.data(), scenario.syntax());
        Reasoner reasoner = switch (scenario.reasoner()) {
            case "rdfs" -> ReasonerRegistry.getRDFSReasoner();
            case "owl2-rl-selected" -> ReasonerRegistry.getOWLReasoner();
            default -> throw new UnsupportedOperationException(
                    "unsupported reasoner " + scenario.reasoner());
        };
        InfModel inferred = ModelFactory.createInfModel(reasoner, data.getDefaultModel());
        Query query = QueryFactory.create(scenario.query(), BASE, Syntax.syntaxSPARQL_12);
        try (QueryExecution execution = QueryExecution.create(query, inferred)) {
            return success("boolean", execution.execAsk());
        }
    }

    private static JsonObject shaclEntry(ReportEntry entry) {
        JsonObject value = new JsonObject();
        value.add("focus_node", Canonicalizer.term(entry.focusNode()));
        addOptionalTerm(value, "value", entry.value());
        addOptionalPath(value, entry.resultPath());
        addOptionalTerm(value, "source_shape", entry.source());
        addOptionalTerm(
                value, "source_constraint_component", entry.sourceConstraintComponent());
        if (entry.severity() == null) {
            value.add("severity", JsonNull.INSTANCE);
        } else {
            value.add("severity", Canonicalizer.term(entry.severity().level()));
        }
        return value;
    }

    private static void addOptionalTerm(JsonObject object, String key, Node node) {
        object.add(key, node == null ? JsonNull.INSTANCE : Canonicalizer.term(node));
    }

    private static void addOptionalPath(JsonObject object, Path path) {
        if (path == null) {
            object.add("result_path", JsonNull.INSTANCE);
        } else if (path instanceof P_Path0 link) {
            object.add("result_path", Canonicalizer.term(link.getNode()));
        } else {
            JsonObject value = new JsonObject();
            value.addProperty("type", "path");
            value.addProperty("value", PathWriter.asString(path));
            object.add("result_path", value);
        }
    }

    private static Query parseQuery(Scenario scenario) {
        Syntax syntax = "arq".equals(scenario.syntax())
                ? Syntax.syntaxARQ
                : Syntax.syntaxSPARQL_12;
        return QueryFactory.create(scenario.query(), BASE, syntax);
    }

    private static Dataset parseDataset(String data, String syntax) {
        if (data == null) {
            data = "";
        }
        return RDFParser.fromString(data, language(syntax)).base(BASE).toDataset();
    }

    private static Lang language(String syntax) {
        if (syntax == null || syntax.equals("turtle") || syntax.equals("arq")) {
            return Lang.TURTLE;
        }
        return switch (syntax) {
            case "trig" -> Lang.TRIG;
            case "ntriples" -> Lang.NTRIPLES;
            case "nquads" -> Lang.NQUADS;
            case "rdfxml" -> Lang.RDFXML;
            case "jsonld" -> Lang.JSONLD11;
            default -> throw new IllegalArgumentException("unknown RDF syntax " + syntax);
        };
    }

    private static RDFFormat outputFormat(String syntax) {
        return switch (syntax) {
            case "turtle" -> RDFFormat.TURTLE_PRETTY;
            case "trig" -> RDFFormat.TRIG_PRETTY;
            case "ntriples" -> RDFFormat.NTRIPLES_UTF8;
            case "nquads" -> RDFFormat.NQUADS_UTF8;
            case "rdfxml" -> RDFFormat.RDFXML_PLAIN;
            case "jsonld" -> RDFFormat.JSONLD11_PLAIN;
            default -> throw new IllegalArgumentException("unknown output syntax " + syntax);
        };
    }

    private static JsonObject success(String kind, boolean value) {
        JsonObject observation = base("success", kind);
        observation.addProperty("value", value);
        return observation;
    }

    private static JsonObject success(String kind, JsonObject value) {
        JsonObject observation = base("success", kind);
        observation.add("value", value);
        return observation;
    }

    private static JsonObject unsupported(String reason) {
        JsonObject observation = base("unsupported", "unsupported");
        observation.addProperty("error_code", "unsupported-profile");
        observation.addProperty("diagnostic", reason);
        return observation;
    }

    private static JsonObject failure(RuntimeException error) {
        JsonObject observation = base("error", "error");
        observation.addProperty("error_code", "syntax-or-evaluation");
        observation.addProperty("diagnostic_type", error.getClass().getName());
        return observation;
    }

    private static JsonObject base(String status, String kind) {
        JsonObject observation = new JsonObject();
        observation.addProperty("status", status);
        observation.addProperty("kind", kind);
        return observation;
    }
}
