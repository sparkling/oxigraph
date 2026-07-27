package org.oxigraph.oracle;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.jena.rdf.model.InfModel;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Statement;

public final class JenaRdfsOracle {
    private static final Pattern NAMED_TRIPLE =
            Pattern.compile("^<([^<>]*)>\\s+<([^<>]*)>\\s+<([^<>]*)>\\s+\\.$");

    private JenaRdfsOracle() {}

    public static void main(String[] arguments) throws IOException {
        if (arguments.length != 4) {
            throw new IllegalArgumentException(
                    "usage: JenaRdfsOracle "
                            + "<input.nt> <entailed.nt> <not-entailed.nt> <output.tsv>");
        }
        evaluate(
                Path.of(arguments[0]),
                Path.of(arguments[1]),
                Path.of(arguments[2]),
                Path.of(arguments[3]));
    }

    private static void evaluate(
            Path inputPath, Path entailedPath, Path notEntailedPath, Path outputPath)
            throws IOException {
        Model base = ModelFactory.createDefaultModel();
        for (FixtureStatement input : readStatements(base, inputPath)) {
            base.add(input.statement());
        }
        InfModel inferred = ModelFactory.createRDFSModel(base);
        try {
            SortedSet<String> rows = new TreeSet<>();
            for (FixtureStatement assertion : readStatements(base, entailedPath)) {
                if (!inferred.contains(assertion.statement())) {
                    throw new IllegalStateException(
                            "missing expected entailment: " + assertion.line());
                }
                rows.add("entailed\t" + assertion.line());
            }
            for (FixtureStatement assertion : readStatements(base, notEntailedPath)) {
                if (inferred.contains(assertion.statement())) {
                    throw new IllegalStateException("unexpected entailment: " + assertion.line());
                }
                rows.add("not-entailed\t" + assertion.line());
            }
            Files.writeString(
                    outputPath, String.join("\n", rows) + "\n", StandardCharsets.UTF_8);
        } finally {
            inferred.close();
            base.close();
        }
    }

    private static List<FixtureStatement> readStatements(Model model, Path path)
            throws IOException {
        List<FixtureStatement> statements = new ArrayList<>();
        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        for (int index = 0; index < lines.size(); index++) {
            String line = lines.get(index).trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            Matcher matcher = NAMED_TRIPLE.matcher(line);
            if (!matcher.matches()) {
                throw new IllegalArgumentException(
                        path + ":" + (index + 1) + ": expected three named nodes and a dot");
            }
            Statement statement =
                    model.createStatement(
                            model.createResource(matcher.group(1)),
                            model.createProperty(matcher.group(2)),
                            model.createResource(matcher.group(3)));
            statements.add(new FixtureStatement(line, statement));
        }
        return statements;
    }

    private record FixtureStatement(String line, Statement statement) {}
}
