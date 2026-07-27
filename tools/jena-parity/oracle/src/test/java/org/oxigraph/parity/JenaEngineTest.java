package org.oxigraph.parity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

final class JenaEngineTest {
    @Test
    void evaluatesAskAndNormalizesSyntaxFailure() {
        Scenario ask = scenario(
                "ask",
                "sparql-ask",
                "<https://example.test/s> <https://example.test/p> \"o\" .",
                "ASK { <https://example.test/s> <https://example.test/p> \"o\" }");
        assertEquals("success", new JenaEngine().observe(ask).get("status").getAsString());
        assertEquals(true, new JenaEngine().observe(ask).get("value").getAsBoolean());

        Scenario invalid = scenario("bad", "sparql-ask", "", "ASK {");
        assertEquals("error", new JenaEngine().observe(invalid).get("status").getAsString());
        assertEquals(
                "syntax-or-evaluation",
                new JenaEngine().observe(invalid).get("error_code").getAsString());
    }

    @Test
    void trigRoundTripDropsAnExplicitEmptyNamedGraph() {
        Scenario scenario = new Scenario(
                "empty-graph",
                "rdf",
                "rdf-roundtrip",
                "w3c-overrides-jena",
                "https://www.w3.org/TR/rdf12-concepts/#section-dataset",
                true,
                "trig",
                "trig",
                "<urn:g> {}",
                null,
                null,
                null,
                null,
                false,
                List.of(new Scenario.Assertion("jena", "/status", "success")));

        var observation = new JenaEngine().observe(scenario);
        assertEquals("success", observation.get("status").getAsString());
        assertEquals(
                0,
                observation
                        .getAsJsonObject("value")
                        .get("named_graph_count")
                        .getAsInt());
    }

    @Test
    void jsonLdRoundTripDropsAnExplicitEmptyNamedGraph() {
        Scenario scenario = new Scenario(
                "empty-jsonld-graph",
                "rdf",
                "rdf-roundtrip",
                "w3c-overrides-jena",
                "https://www.w3.org/TR/json-ld11-api/"
                        + "#deserialize-json-ld-to-rdf-algorithm",
                true,
                "jsonld",
                "jsonld",
                "{\"@id\":\"http://example.com/empty\",\"@graph\":[]}",
                null,
                null,
                null,
                null,
                false,
                List.of(new Scenario.Assertion("jena", "/status", "success")));

        var observation = new JenaEngine().observe(scenario);
        assertEquals("success", observation.get("status").getAsString());
        assertEquals(0, observation.getAsJsonObject("value").get("quad_count").getAsInt());
        assertEquals(
                0,
                observation
                        .getAsJsonObject("value")
                        .get("named_graph_count")
                        .getAsInt());
    }

    @Test
    void trigEmptyGraphIsNotQueryableAfterJenaDropsItsTopology() {
        Scenario scenario = new Scenario(
                "query-empty-graph",
                "sparql",
                "sparql-select",
                "w3c-overrides-jena",
                "https://www.w3.org/TR/sparql12-query/#accessByIdentifier",
                true,
                "trig",
                null,
                "<urn:g> {}",
                "SELECT ?g WHERE { GRAPH ?g {} }",
                null,
                null,
                null,
                true,
                List.of(new Scenario.Assertion("jena", "/status", "success")));

        var observation = new JenaEngine().observe(scenario);
        assertEquals("success", observation.get("status").getAsString());
        assertEquals(0, observation.getAsJsonObject("value").get("row_count").getAsInt());
    }

    private static Scenario scenario(String id, String operation, String data, String query) {
        return new Scenario(
                id,
                "test",
                operation,
                "agreement",
                "https://www.w3.org/",
                true,
                "turtle",
                null,
                data,
                query,
                null,
                null,
                null,
                false,
                List.of(new Scenario.Assertion("both", "/status", "success")));
    }
}
