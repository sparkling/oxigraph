const RDFXML_SOURCE_SHA256: &str =
    "d309ed73d2d46adc576d929cbbd906b905ab8805968634b4e219ca771b108945";
const RDFXML_SERIALIZER_CLAUSES: &[&str] = &[
    "rdf12-xml:normative-prose-block:230c1759a2a856ffecf064c7",
    "rdf12-xml:normative-prose-block:40aa81b8865e7d7a36b8cadd",
    "rdf12-xml:normative-definition:52af07309b2faf4aa1b724a5",
    "rdf12-xml:normative-definition:bdb57c4f1e12a28e1525b6d2",
    "rdf12-xml:normative-prose-block:e2678ccfe218ca93661ddeaa",
];

#[test]
fn serializer_clause_map_is_pinned_and_unique() {
    assert_eq!(RDFXML_SOURCE_SHA256.len(), 64);
    assert!(
        RDFXML_SOURCE_SHA256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    );
    let mut clauses = RDFXML_SERIALIZER_CLAUSES.to_vec();
    clauses.sort_unstable();
    clauses.dedup();
    assert_eq!(clauses.len(), RDFXML_SERIALIZER_CLAUSES.len());
}
