package org.oxigraph.oracle;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import org.apache.jena.graph.Graph;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.riot.system.StreamRDF;
import org.apache.jena.riot.system.StreamRDFLib;
import org.apache.jena.shacl.compact.ShaclcParser;
import org.apache.jena.sparql.graph.GraphFactory;
import org.apache.jena.sparql.util.Context;

public final class JenaCompactOracle {
    private static final String EXTERNAL_BASE = "urn:x-base:default";

    private JenaCompactOracle() {}

    public static void main(String[] arguments) throws Exception {
        if (arguments.length != 1) {
            throw new IllegalArgumentException(
                    "usage: JenaCompactOracle <shacl12-cs/tests/valid>");
        }
        Path root = Path.of(arguments[0]).toRealPath(LinkOption.NOFOLLOW_LINKS);
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("compact fixture root is not a directory");
        }
        List<Path> sources;
        try (var paths = Files.list(root)) {
            sources =
                    paths.filter(path -> path.getFileName().toString().endsWith(".shaclc"))
                            .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                            .toList();
        }
        int passed = 0;
        int failed = 0;
        for (Path source : sources) {
            String name = source.getFileName().toString();
            Path expected =
                    source.resolveSibling(name.substring(0, name.length() - 7) + ".ttl");
            try {
                verify(root, source, expected);
                passed++;
                emit("PASS", name, "jena-6.1.0-graph-isomorphic");
            } catch (Exception error) {
                failed++;
                emit("FAIL", name, error.getMessage());
            }
        }
        System.out.printf(
                "SUMMARY discovered=%d eligible=%d passed=%d unsupported=0 failed=%d excluded=0%n",
                sources.size(), sources.size(), passed, failed);
        if (sources.size() != 32 || failed != 0) {
            throw new IllegalStateException("Jena SHACL-C differential did not qualify");
        }
    }

    private static void verify(Path root, Path source, Path expected) throws Exception {
        source = secureFile(root, source);
        expected = secureFile(root, expected);
        Graph actual = GraphFactory.createDefaultGraph();
        StreamRDF destination = StreamRDFLib.graph(actual);
        try (InputStream input = Files.newInputStream(source)) {
            ShaclcParser.parseSHACLC(
                    input, EXTERNAL_BASE, destination, Context.emptyContext());
        }
        Model expectedModel = ModelFactory.createDefaultModel();
        try (InputStream input = Files.newInputStream(expected)) {
            RDFDataMgr.read(expectedModel, input, EXTERNAL_BASE, Lang.TURTLE);
        }
        try {
            if (!actual.isIsomorphicWith(expectedModel.getGraph())) {
                throw new IllegalStateException("Jena graph differs from pinned TTL");
            }
        } finally {
            actual.close();
            expectedModel.close();
        }
    }

    private static Path secureFile(Path root, Path path) throws Exception {
        Path canonical = path.toRealPath(LinkOption.NOFOLLOW_LINKS);
        if (!canonical.startsWith(root)
                || !Files.isRegularFile(canonical, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("fixture escapes pinned root");
        }
        return canonical;
    }

    private static void emit(String kind, String name, String detail) {
        String safe = detail == null ? "no-detail" : detail.replaceAll("[\\r\\n\\t]", " ");
        System.out.printf("%s\t%s\t%s\t%s%n", kind, name, name, safe);
    }
}
