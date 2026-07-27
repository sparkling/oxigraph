package org.oxigraph.parity;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.TextDirection;
import org.apache.jena.graph.Triple;
import org.apache.jena.query.Dataset;
import org.apache.jena.sparql.core.Quad;

final class Canonicalizer {
    private static final int MAX_BLANK_NODES = 8;
    private static final String XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

    private Canonicalizer() {}

    static JsonObject dataset(Dataset dataset) {
        List<Quad> quads = new ArrayList<>();
        dataset.asDatasetGraph().find().forEachRemaining(quads::add);
        List<Node> namedGraphs = new ArrayList<>();
        dataset.asDatasetGraph().listGraphNodes().forEachRemaining(namedGraphs::add);
        Set<Node> blanks = new LinkedHashSet<>();
        for (Quad quad : quads) {
            collectBlank(quad.getGraph(), blanks);
            collectBlank(quad.getSubject(), blanks);
            collectBlank(quad.getPredicate(), blanks);
            collectBlank(quad.getObject(), blanks);
        }
        namedGraphs.forEach(graphName -> collectBlank(graphName, blanks));
        MappingChoice choice =
                choose(blanks, mapping -> renderDataset(quads, namedGraphs, mapping));
        JsonObject canonical = JsonParser.parseString(choice.serialized()).getAsJsonObject();
        JsonArray canonicalQuads = canonical.getAsJsonArray("quads");
        JsonArray canonicalNamedGraphs = canonical.getAsJsonArray("named_graphs");
        JsonObject value = new JsonObject();
        value.addProperty("quad_count", canonicalQuads.size());
        value.add("quads", canonicalQuads);
        value.addProperty("named_graph_count", canonicalNamedGraphs.size());
        value.add("named_graphs", canonicalNamedGraphs);
        return value;
    }

    static JsonObject solutions(
            List<String> variables, List<Map<String, Node>> rows, boolean ordered) {
        Set<Node> blanks = new LinkedHashSet<>();
        for (Map<String, Node> row : rows) {
            row.values().forEach(node -> collectBlank(node, blanks));
        }
        MappingChoice choice = choose(blanks, mapping -> renderRows(variables, rows, ordered, mapping));
        JsonArray canonicalRows = JsonParser.parseString(choice.serialized()).getAsJsonArray();
        JsonObject value = new JsonObject();
        JsonArray names = new JsonArray();
        variables.forEach(names::add);
        value.add("variables", names);
        value.addProperty("row_count", canonicalRows.size());
        value.addProperty("ordered", ordered);
        value.add("rows", canonicalRows);
        return value;
    }

    static JsonObject term(Node node) {
        return term(node, Map.of());
    }

    private static MappingChoice choose(Set<Node> blankSet, Renderer renderer) {
        List<Node> blanks = new ArrayList<>(blankSet);
        if (blanks.size() > MAX_BLANK_NODES) {
            throw new UnsupportedOperationException(
                    "canonicalization supports at most " + MAX_BLANK_NODES + " blank nodes");
        }
        if (blanks.isEmpty()) {
            return new MappingChoice(renderer.render(Map.of()));
        }
        boolean[] used = new boolean[blanks.size()];
        Node[] order = new Node[blanks.size()];
        String[] best = new String[1];
        permute(blanks, used, order, 0, renderer, best);
        return new MappingChoice(best[0]);
    }

    private static void permute(
            List<Node> blanks,
            boolean[] used,
            Node[] order,
            int depth,
            Renderer renderer,
            String[] best) {
        if (depth == order.length) {
            Map<Node, String> mapping = new HashMap<>();
            for (int index = 0; index < order.length; index++) {
                mapping.put(order[index], "b" + index);
            }
            String candidate = renderer.render(mapping);
            if (best[0] == null || candidate.compareTo(best[0]) < 0) {
                best[0] = candidate;
            }
            return;
        }
        for (int index = 0; index < blanks.size(); index++) {
            if (!used[index]) {
                used[index] = true;
                order[depth] = blanks.get(index);
                permute(blanks, used, order, depth + 1, renderer, best);
                used[index] = false;
            }
        }
    }

    private static String renderQuads(List<Quad> quads, Map<Node, String> mapping) {
        List<String> rendered = new ArrayList<>();
        for (Quad quad : quads) {
            JsonArray row = new JsonArray();
            row.add(term(quad.getSubject(), mapping));
            row.add(term(quad.getPredicate(), mapping));
            row.add(term(quad.getObject(), mapping));
            if (quad.isDefaultGraph()) {
                row.add(JsonNull.INSTANCE);
            } else {
                row.add(term(quad.getGraph(), mapping));
            }
            rendered.add(row.toString());
        }
        rendered.sort(Comparator.naturalOrder());
        return "[" + String.join(",", rendered) + "]";
    }

    private static String renderDataset(
            List<Quad> quads, List<Node> namedGraphs, Map<Node, String> mapping) {
        List<String> renderedNames = new ArrayList<>();
        for (Node graphName : namedGraphs) {
            renderedNames.add(term(graphName, mapping).toString());
        }
        renderedNames.sort(Comparator.naturalOrder());
        JsonObject value = new JsonObject();
        value.add(
                "named_graphs",
                JsonParser.parseString("[" + String.join(",", renderedNames) + "]"));
        value.add("quads", JsonParser.parseString(renderQuads(quads, mapping)));
        return value.toString();
    }

    private static String renderRows(
            List<String> variables,
            List<Map<String, Node>> rows,
            boolean ordered,
            Map<Node, String> mapping) {
        List<String> rendered = new ArrayList<>();
        for (Map<String, Node> row : rows) {
            JsonObject object = new JsonObject();
            for (String variable : variables) {
                Node node = row.get(variable);
                if (node != null) {
                    object.add(variable, term(node, mapping));
                }
            }
            rendered.add(object.toString());
        }
        if (!ordered) {
            rendered.sort(Comparator.naturalOrder());
        }
        return "[" + String.join(",", rendered) + "]";
    }

    private static JsonObject term(Node node, Map<Node, String> mapping) {
        JsonObject value = new JsonObject();
        if (node.isURI()) {
            value.addProperty("type", "iri");
            value.addProperty("value", node.getURI());
        } else if (node.isBlank()) {
            String label = mapping.get(node);
            value.addProperty("type", "blank");
            value.addProperty("value", label == null ? node.getBlankNodeLabel() : label);
        } else if (node.isLiteral()) {
            value.addProperty("type", "literal");
            value.addProperty("value", node.getLiteralLexicalForm());
            String language = node.getLiteralLanguage();
            if (language != null && !language.isEmpty()) {
                value.addProperty("language", language);
            }
            TextDirection direction = node.getLiteralBaseDirection();
            if (direction != null) {
                value.addProperty("direction", direction.direction());
            }
            String datatype = node.getLiteralDatatypeURI();
            value.addProperty("datatype", datatype == null ? XSD_STRING : datatype);
        } else if (node.isTripleTerm()) {
            Triple triple = node.getTriple();
            value.addProperty("type", "triple");
            JsonArray components = new JsonArray();
            components.add(term(triple.getSubject(), mapping));
            components.add(term(triple.getPredicate(), mapping));
            components.add(term(triple.getObject(), mapping));
            value.add("value", components);
        } else {
            throw new IllegalArgumentException("unsupported RDF node " + node);
        }
        return value;
    }

    private static void collectBlank(Node node, Set<Node> output) {
        if (node == null || Quad.isDefaultGraph(node)) {
            return;
        }
        if (node.isBlank()) {
            output.add(node);
        } else if (node.isTripleTerm()) {
            Triple triple = node.getTriple();
            collectBlank(triple.getSubject(), output);
            collectBlank(triple.getPredicate(), output);
            collectBlank(triple.getObject(), output);
        }
    }

    @FunctionalInterface
    private interface Renderer {
        String render(Map<Node, String> mapping);
    }

    private record MappingChoice(String serialized) {}
}
