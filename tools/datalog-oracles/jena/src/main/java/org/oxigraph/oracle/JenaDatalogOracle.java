package org.oxigraph.oracle;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.apache.jena.rdf.model.InfModel;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Property;
import org.apache.jena.rdf.model.RDFNode;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.rdf.model.Statement;
import org.apache.jena.rdf.model.StmtIterator;
import org.apache.jena.reasoner.rulesys.GenericRuleReasoner;
import org.apache.jena.reasoner.rulesys.Rule;

public final class JenaDatalogOracle {
    private static final String NODE_PREFIX = "urn:test:node:";
    private static final String EDGE_IRI = "urn:test:relation:edge";
    private static final String ANCESTOR_IRI = "urn:test:relation:ancestor";
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]+");
    private static final String RULES =
            "[ancestor-direct: (?x <" + EDGE_IRI + "> ?y) "
                    + "-> (?x <" + ANCESTOR_IRI + "> ?y)]\n"
                    + "[ancestor-transitive: (?x <" + ANCESTOR_IRI + "> ?y) "
                    + "(?y <" + EDGE_IRI + "> ?z) "
                    + "-> (?x <" + ANCESTOR_IRI + "> ?z)]";

    private JenaDatalogOracle() {}

    public static void main(String[] arguments) throws IOException {
        if (arguments.length == 0 || arguments.length % 2 != 0) {
            throw new IllegalArgumentException(
                    "usage: JenaDatalogOracle <input.tsv> <output.tsv> [...]");
        }
        for (int index = 0; index < arguments.length; index += 2) {
            evaluate(Path.of(arguments[index]), Path.of(arguments[index + 1]));
        }
    }

    private static void evaluate(Path inputPath, Path outputPath) throws IOException {
        Model base = ModelFactory.createDefaultModel();
        Property edge = base.createProperty(EDGE_IRI);
        for (Edge input : readEdges(inputPath)) {
            Resource subject = base.createResource(NODE_PREFIX + input.subject());
            Resource object = base.createResource(NODE_PREFIX + input.object());
            base.add(subject, edge, object);
        }

        GenericRuleReasoner reasoner = new GenericRuleReasoner(Rule.parseRules(RULES));
        reasoner.setMode(GenericRuleReasoner.FORWARD_RETE);
        InfModel inferred = ModelFactory.createInfModel(reasoner, base);
        try {
            SortedSet<String> rows = ancestorRows(inferred);
            Files.writeString(
                    outputPath, String.join("\n", rows) + "\n", StandardCharsets.UTF_8);
        } finally {
            inferred.close();
            base.close();
        }
    }

    private static List<Edge> readEdges(Path path) throws IOException {
        List<Edge> edges = new ArrayList<>();
        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        for (int index = 0; index < lines.size(); index++) {
            String line = lines.get(index);
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] columns = line.split("\\t", -1);
            if (columns.length != 2) {
                throw new IllegalArgumentException(
                        path + ":" + (index + 1) + ": expected exactly two columns");
            }
            validateName(columns[0]);
            validateName(columns[1]);
            edges.add(new Edge(columns[0], columns[1]));
        }
        return edges;
    }

    private static SortedSet<String> ancestorRows(InfModel model) {
        SortedSet<String> rows = new TreeSet<>();
        Property ancestor = model.createProperty(ANCESTOR_IRI);
        StmtIterator statements = model.listStatements(null, ancestor, (RDFNode) null);
        try {
            while (statements.hasNext()) {
                Statement statement = statements.nextStatement();
                if (!statement.getObject().isURIResource()) {
                    throw new IllegalStateException("ancestor object is not an IRI");
                }
                rows.add(
                        localName(statement.getSubject().getURI())
                                + "\t"
                                + localName(statement.getResource().getURI()));
            }
        } finally {
            statements.close();
        }
        return rows;
    }

    private static String localName(String iri) {
        if (!iri.startsWith(NODE_PREFIX)) {
            throw new IllegalStateException("unexpected result namespace: " + iri);
        }
        return iri.substring(NODE_PREFIX.length());
    }

    private static void validateName(String name) {
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("invalid fixture name: " + name);
        }
    }

    private record Edge(String subject, String object) {}
}
