package org.oxigraph.parity;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.jena.Jena;

public final class JenaOracle {
    private static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .setPrettyPrinting()
            .create();

    private JenaOracle() {}

    public static void main(String[] arguments) throws IOException {
        if (arguments.length != 2) {
            throw new IllegalArgumentException(
                    "usage: JenaOracle <resolved-inventory.json> <observations.json>");
        }
        Path inventoryPath = Path.of(arguments[0]).toAbsolutePath().normalize();
        Path outputPath = Path.of(arguments[1]).toAbsolutePath().normalize();
        if (!Files.isRegularFile(inventoryPath)) {
            throw new IllegalArgumentException("inventory is not a regular file: " + inventoryPath);
        }
        if (outputPath.getParent() == null || !Files.isDirectory(outputPath.getParent())) {
            throw new IllegalArgumentException(
                    "output parent is not a directory: " + outputPath);
        }

        Scenario[] scenarios;
        try (Reader reader = Files.newBufferedReader(inventoryPath, StandardCharsets.UTF_8)) {
            scenarios = GSON.fromJson(reader, Scenario[].class);
        }
        if (scenarios == null || scenarios.length == 0) {
            throw new IllegalArgumentException("resolved inventory is empty");
        }

        JenaEngine engine = new JenaEngine();
        JsonArray observations = new JsonArray();
        for (Scenario scenario : scenarios) {
            JsonObject observation = engine.observe(scenario);
            observation.addProperty("id", scenario.id());
            observations.add(observation);
        }
        JsonObject root = new JsonObject();
        JsonObject oracle = new JsonObject();
        oracle.addProperty("name", "Apache Jena");
        oracle.addProperty("version", Jena.VERSION);
        oracle.addProperty("java", System.getProperty("java.version"));
        root.add("oracle", oracle);
        root.add("observations", observations);

        try (Writer writer = Files.newBufferedWriter(outputPath, StandardCharsets.UTF_8)) {
            GSON.toJson(JsonParser.parseString(root.toString()), writer);
            writer.write(System.lineSeparator());
        }
    }
}
