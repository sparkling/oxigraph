package org.oxigraph.parity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.google.gson.JsonObject;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.apache.jena.query.Dataset;
import org.apache.jena.query.DatasetFactory;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.riot.RDFFormat;
import org.apache.jena.riot.RDFParser;
import org.junit.jupiter.api.Test;

final class CanonicalizerTest {
    @Test
    void blankNodeLabelsDoNotAffectCanonicalDataset() {
        Dataset left = RDFParser.fromString(
                        "_:left <https://example.test/p> _:tail . "
                                + "_:tail <https://example.test/q> \"v\" .",
                        Lang.TURTLE)
                .toDataset();
        Dataset right = RDFParser.fromString(
                        "_:other <https://example.test/p> _:end . "
                                + "_:end <https://example.test/q> \"v\" .",
                        Lang.TURTLE)
                .toDataset();

        assertEquals(Canonicalizer.dataset(left), Canonicalizer.dataset(right));
    }

    @Test
    void reportsNamedGraphTopologySeparatelyFromQuads() {
        Dataset populated =
                RDFParser.fromString("<urn:g> { <urn:s> <urn:p> <urn:o> }", Lang.TRIG)
                        .toDataset();
        JsonObject populatedValue = Canonicalizer.dataset(populated);
        assertEquals(1, populatedValue.get("quad_count").getAsInt());
        assertEquals(1, populatedValue.get("named_graph_count").getAsInt());
        assertEquals(
                "urn:g",
                populatedValue
                        .getAsJsonArray("named_graphs")
                        .get(0)
                        .getAsJsonObject()
                        .get("value")
                        .getAsString());

        Dataset empty = RDFParser.fromString("<urn:g> {}", Lang.TRIG).toDataset();
        JsonObject emptyValue = Canonicalizer.dataset(empty);
        assertEquals(0, emptyValue.get("quad_count").getAsInt());
        assertEquals(0, emptyValue.get("named_graph_count").getAsInt());
    }

    @Test
    void jenaParserModelAndTrigWriterDropAnExplicitEmptyNamedGraph() {
        Dataset parsed = RDFParser.fromString("<urn:g> {}", Lang.TRIG).toDataset();
        assertFalse(parsed.listNames().hasNext());
        assertFalse(parsed.containsNamedModel("urn:g"));

        Dataset modeled = DatasetFactory.create();
        modeled.addNamedModel("urn:g", ModelFactory.createDefaultModel());
        assertFalse(modeled.listNames().hasNext());
        assertFalse(modeled.containsNamedModel("urn:g"));

        ByteArrayOutputStream serialized = new ByteArrayOutputStream();
        RDFDataMgr.write(serialized, modeled, RDFFormat.TRIG_PRETTY);
        assertEquals("", serialized.toString(StandardCharsets.UTF_8));
    }

    @Test
    void jenaJsonLdParserAndWriterDropAnExplicitEmptyNamedGraph() {
        String graphName = "http://example.com/empty";
        String input = "{\"@id\":\"" + graphName + "\",\"@graph\":[]}";
        Dataset parsed = RDFParser.fromString(input, Lang.JSONLD11).toDataset();
        assertFalse(parsed.listNames().hasNext());
        assertFalse(parsed.containsNamedModel(graphName));
        assertEquals(0, Canonicalizer.dataset(parsed).get("named_graph_count").getAsInt());

        ByteArrayOutputStream serialized = new ByteArrayOutputStream();
        RDFDataMgr.write(serialized, parsed, RDFFormat.JSONLD11_PLAIN);
        String output = serialized.toString(StandardCharsets.UTF_8);
        assertFalse(output.contains(graphName));

        Dataset reparsed = RDFParser.fromString(output, Lang.JSONLD11).toDataset();
        assertFalse(reparsed.listNames().hasNext());
        assertFalse(reparsed.containsNamedModel(graphName));
        assertEquals(0, Canonicalizer.dataset(reparsed).get("named_graph_count").getAsInt());
    }
}
