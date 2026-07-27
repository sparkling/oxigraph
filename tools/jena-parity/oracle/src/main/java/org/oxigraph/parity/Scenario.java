package org.oxigraph.parity;

import java.util.List;
import java.util.Set;

record Scenario(
        String id,
        String domain,
        String operation,
        String classification,
        String normativeBasis,
        boolean reviewed,
        String syntax,
        String outputSyntax,
        String data,
        String query,
        String update,
        String shapes,
        String reasoner,
        Boolean ordered,
        List<Assertion> assertions) {
    private static final Set<String> OPERATIONS = Set.of(
            "rdf-parse",
            "rdf-roundtrip",
            "sparql-select",
            "sparql-ask",
            "sparql-construct",
            "sparql-describe",
            "sparql-service",
            "sparql-update",
            "sparql-unsupported",
            "shacl-validate",
            "shacl-sparql-validate",
            "shacl-unsupported",
            "entailment");

    void validate() {
        require(id, "id");
        require(domain, "domain");
        require(operation, "operation");
        require(classification, "classification");
        require(normativeBasis, "normativeBasis");
        if (!reviewed) {
            throw new IllegalArgumentException("scenario " + id + " is not reviewed");
        }
        if (!OPERATIONS.contains(operation)) {
            throw new IllegalArgumentException("scenario " + id + " has unknown operation " + operation);
        }
        if (assertions == null || assertions.isEmpty()) {
            throw new IllegalArgumentException("scenario " + id + " has no assertions");
        }
    }

    boolean isOrdered() {
        return Boolean.TRUE.equals(ordered);
    }

    private static void require(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("missing scenario " + field);
        }
    }

    record Assertion(String target, String pointer, Object equals) {}
}
