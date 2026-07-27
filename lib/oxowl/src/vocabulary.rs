use oxrdf::NamedNode;

pub(crate) const OWL_NAMESPACE: &str = "http://www.w3.org/2002/07/owl#";

macro_rules! owl {
    ($name:ident, $local:literal) => {
        pub(crate) const $name: NamedNode =
            NamedNode::new_const_unchecked(concat!("http://www.w3.org/2002/07/owl#", $local));
    };
}

owl!(ALL_DIFFERENT, "AllDifferent");
owl!(ALL_DISJOINT_CLASSES, "AllDisjointClasses");
owl!(ALL_DISJOINT_PROPERTIES, "AllDisjointProperties");
owl!(ANNOTATION_PROPERTY, "AnnotationProperty");
owl!(ASYMMETRIC_PROPERTY, "AsymmetricProperty");
owl!(CLASS, "Class");
owl!(DATATYPE_PROPERTY, "DatatypeProperty");
owl!(FUNCTIONAL_PROPERTY, "FunctionalProperty");
owl!(INVERSE_FUNCTIONAL_PROPERTY, "InverseFunctionalProperty");
owl!(IRREFLEXIVE_PROPERTY, "IrreflexiveProperty");
owl!(NAMED_INDIVIDUAL, "NamedIndividual");
owl!(NOTHING, "Nothing");
owl!(OBJECT_PROPERTY, "ObjectProperty");
owl!(REFLEXIVE_PROPERTY, "ReflexiveProperty");
owl!(RESTRICTION, "Restriction");
owl!(SYMMETRIC_PROPERTY, "SymmetricProperty");
owl!(THING, "Thing");
owl!(TRANSITIVE_PROPERTY, "TransitiveProperty");

owl!(ALL_VALUES_FROM, "allValuesFrom");
owl!(ASSERTION_PROPERTY, "assertionProperty");
owl!(COMPLEMENT_OF, "complementOf");
owl!(DIFFERENT_FROM, "differentFrom");
owl!(DISJOINT_WITH, "disjointWith");
owl!(DISTINCT_MEMBERS, "distinctMembers");
owl!(EQUIVALENT_CLASS, "equivalentClass");
owl!(EQUIVALENT_PROPERTY, "equivalentProperty");
owl!(HAS_KEY, "hasKey");
owl!(HAS_VALUE, "hasValue");
owl!(INTERSECTION_OF, "intersectionOf");
owl!(INVERSE_OF, "inverseOf");
owl!(MAX_CARDINALITY, "maxCardinality");
owl!(MAX_QUALIFIED_CARDINALITY, "maxQualifiedCardinality");
owl!(MIN_CARDINALITY, "minCardinality");
owl!(MEMBERS, "members");
owl!(ON_CLASS, "onClass");
owl!(ON_PROPERTY, "onProperty");
owl!(ONE_OF, "oneOf");
owl!(PROPERTY_CHAIN_AXIOM, "propertyChainAxiom");
owl!(PROPERTY_DISJOINT_WITH, "propertyDisjointWith");
owl!(SAME_AS, "sameAs");
owl!(SOME_VALUES_FROM, "someValuesFrom");
owl!(SOURCE_INDIVIDUAL, "sourceIndividual");
owl!(TARGET_INDIVIDUAL, "targetIndividual");
owl!(TARGET_VALUE, "targetValue");
owl!(UNION_OF, "unionOf");

pub(crate) const BUILT_IN_ANNOTATION_PROPERTIES: &[NamedNode] = &[
    NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#label"),
    NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#comment"),
    NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#seeAlso"),
    NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#isDefinedBy"),
    NamedNode::new_const_unchecked("http://www.w3.org/2002/07/owl#deprecated"),
    NamedNode::new_const_unchecked("http://www.w3.org/2002/07/owl#versionInfo"),
    NamedNode::new_const_unchecked("http://www.w3.org/2002/07/owl#priorVersion"),
    NamedNode::new_const_unchecked("http://www.w3.org/2002/07/owl#backwardCompatibleWith"),
    NamedNode::new_const_unchecked("http://www.w3.org/2002/07/owl#incompatibleWith"),
];
