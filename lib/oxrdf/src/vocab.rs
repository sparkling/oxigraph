//! Provides ready to use [`NamedNodeRef`](super::NamedNodeRef)s for basic RDF vocabularies.

pub mod rdf {
    //! [RDF](https://www.w3.org/TR/rdf11-concepts/) vocabulary.
    use crate::named_node::NamedNode;

    /// The class of containers of alternatives.
    pub const ALT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#Alt");
    /// The class of unordered containers.
    pub const BAG: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag");
    /// Legacy JSON-LD class used to encode directional strings as compound values.
    pub const COMPOUND_LITERAL: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#CompoundLiteral",
    );
    /// Legacy JSON-LD property for the base-direction component of a compound literal.
    pub const DIRECTION: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#direction");
    /// The class of language-tagged string literal values with a base direction.
    #[cfg(feature = "rdf-12")]
    pub const DIR_LANG_STRING: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");
    /// The first item in the subject RDF list.
    pub const FIRST: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#first");
    /// The class of HTML literal values.
    pub const HTML: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML");
    /// The datatype of RDF literals storing JSON content.
    #[cfg(feature = "rdf-12")]
    pub const JSON: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON");
    /// Legacy JSON-LD property for the language component of a compound literal.
    pub const LANGUAGE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#language");
    /// The class of language-tagged string literal values.
    pub const LANG_STRING: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
    /// The class of RDF lists.
    pub const LIST: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#List");
    /// The empty list.
    pub const NIL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#nil");
    /// The object of the subject RDF statement.
    pub const OBJECT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#object");
    /// The predicate of the subject RDF statement.
    pub const PREDICATE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate");
    /// Deprecated datatype retained for compatibility with RIF and OWL 2.
    pub const PLAIN_LITERAL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#PlainLiteral");
    /// The class of RDF properties.
    pub const PROPERTY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#Property");
    /// The class used by RDF 1.2 Interoperability's basic proposition encoding.
    #[cfg(feature = "rdf-12")]
    pub const PROPOSITION_FORM: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#PropositionForm",
    );
    /// Object component of an RDF 1.2 basic proposition encoding.
    #[cfg(feature = "rdf-12")]
    pub const PROPOSITION_FORM_OBJECT: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#propositionFormObject",
    );
    /// Predicate component of an RDF 1.2 basic proposition encoding.
    #[cfg(feature = "rdf-12")]
    pub const PROPOSITION_FORM_PREDICATE: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#propositionFormPredicate",
    );
    /// Subject component of an RDF 1.2 basic proposition encoding.
    #[cfg(feature = "rdf-12")]
    pub const PROPOSITION_FORM_SUBJECT: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#propositionFormSubject",
    );
    /// Associate a resource (reifier) with a triple (proposition).
    pub const REIFIES: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies");
    /// The rest of the subject RDF list after the first item.
    pub const REST: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#rest");
    /// The class of ordered containers.
    pub const SEQ: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq");
    /// The class of RDF statements.
    pub const STATEMENT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement");
    /// The subject of the subject RDF statement.
    pub const SUBJECT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#subject");
    /// The subject is an instance of a class.
    pub const TYPE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    /// Idiomatic property used for structured values.
    pub const VALUE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#value");
    /// RDF 1.0 version vocabulary term.
    pub const VERSION_1_0: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#version-1.0");
    /// RDF 1.1 version vocabulary term.
    pub const VERSION_1_1: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#version-1.1");
    /// RDF 1.2 version vocabulary term.
    #[cfg(feature = "rdf-12")]
    pub const VERSION_1_2: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#version-1.2");
    /// RDF 1.2 Basic version vocabulary term.
    #[cfg(feature = "rdf-12")]
    pub const VERSION_1_2_BASIC: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#version-1.2-basic",
    );
    /// The class of XML literal values.
    pub const XML_LITERAL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral");
}

pub mod rdfs {
    //! [RDFS](https://www.w3.org/TR/rdf-schema/) vocabulary.
    use crate::named_node::NamedNode;

    /// The class of classes.
    pub const CLASS: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Class");
    /// A description of the subject resource.
    pub const COMMENT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#comment");
    /// The class of RDF containers.
    pub const CONTAINER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Container");
    /// The class of container membership properties, `rdf:_1`, `rdf:_2`, ..., all of which are sub-properties of `member`.
    pub const CONTAINER_MEMBERSHIP_PROPERTY: NamedNode = NamedNode::new_const_unchecked(
        "http://www.w3.org/2000/01/rdf-schema#ContainerMembershipProperty",
    );
    /// The class of RDF datatypes.
    pub const DATATYPE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Datatype");
    /// A domain of the subject property.
    pub const DOMAIN: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#domain");
    /// The definition of the subject resource.
    pub const IS_DEFINED_BY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#isDefinedBy");
    /// A human-readable name for the subject.
    pub const LABEL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#label");
    /// The class of literal values, e.g. textual strings and integers.
    pub const LITERAL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Literal");
    /// A member of the subject resource.
    pub const MEMBER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#member");
    /// The class of propositions denoted by RDF triples and triple terms.
    pub const PROPOSITION: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Proposition");
    /// A range of the subject property.
    pub const RANGE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#range");
    /// The class resource, everything.
    pub const RESOURCE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#Resource");
    /// Further information about the subject resource.
    pub const SEE_ALSO: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#seeAlso");
    /// The subject is a subclass of a class.
    pub const SUB_CLASS_OF: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#subClassOf");
    /// The subject is a subproperty of a property.
    pub const SUB_PROPERTY_OF: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2000/01/rdf-schema#subPropertyOf");
}

pub mod xsd {
    //! [RDF compatible XSD datatypes](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-compatible-xsd-types).
    use crate::named_node::NamedNode;

    /// Absolute or relative URIs and IRIs.
    pub const ANY_URI: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#anyURI");
    /// Base64-encoded binary data.
    pub const BASE_64_BINARY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#base64Binary");
    /// true, false.
    pub const BOOLEAN: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#boolean");
    /// 128…+127 (8 bit).
    pub const BYTE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#byte");
    /// Dates (yyyy-mm-dd) with or without timezone.
    pub const DATE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#date");
    /// Duration of time (days, hours, minutes, seconds only).
    pub const DAY_TIME_DURATION: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
    /// Date and time with or without timezone.
    pub const DATE_TIME: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#dateTime");
    /// Date and time with required timezone.
    pub const DATE_TIME_STAMP: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#dateTimeStamp");
    /// Arbitrary-precision decimal numbers.
    pub const DECIMAL: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#decimal");
    /// 64-bit floating point numbers incl. ±Inf, ±0, NaN.
    pub const DOUBLE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#double");
    /// Duration of time.
    pub const DURATION: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#duration");
    /// 32-bit floating point numbers incl. ±Inf, ±0, NaN.
    pub const FLOAT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#float");
    /// Gregorian calendar day of the month.
    pub const G_DAY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#gDay");
    /// Gregorian calendar month.
    pub const G_MONTH: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#gMonth");
    /// Gregorian calendar month and day.
    pub const G_MONTH_DAY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#gMonthDay");
    /// Gregorian calendar year.
    pub const G_YEAR: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#gYear");
    /// Gregorian calendar year and month.
    pub const G_YEAR_MONTH: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#gYearMonth");
    /// Hex-encoded binary data.
    pub const HEX_BINARY: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#hexBinary");
    /// -2147483648…+2147483647 (32 bit).
    pub const INT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#int");
    /// Arbitrary-size integer numbers.
    pub const INTEGER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#integer");
    /// Language tags per [BCP47](http://tools.ietf.org/html/bcp47).
    pub const LANGUAGE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#language");
    /// -9223372036854775808…+9223372036854775807 (64 bit).
    pub const LONG: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#long");
    /// XML Names.
    pub const NAME: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#Name");
    /// XML NCName.
    pub const NC_NAME: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#NCName");
    /// Integer numbers <0.
    pub const NEGATIVE_INTEGER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#negativeInteger");
    /// XML NMTOKENs.
    pub const NMTOKEN: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#NMTOKEN");
    /// Integer numbers ≥0.
    pub const NON_NEGATIVE_INTEGER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#nonNegativeInteger");
    /// Integer numbers ≤0.
    pub const NON_POSITIVE_INTEGER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#nonPositiveInteger");
    /// Whitespace-normalized strings.
    pub const NORMALIZED_STRING: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#normalizedString");
    /// Integer numbers >0.
    pub const POSITIVE_INTEGER: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#positiveInteger");
    /// Times (hh:mm:ss.sss…) with or without timezone.
    pub const TIME: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#time");
    /// -32768…+32767 (16 bit).
    pub const SHORT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#short");
    /// Character strings (but not all Unicode character strings).
    pub const STRING: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#string");
    /// Tokenized strings.
    pub const TOKEN: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#token");
    /// 0…255 (8 bit).
    pub const UNSIGNED_BYTE: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#unsignedByte");
    /// 0…4294967295 (32 bit).
    pub const UNSIGNED_INT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#unsignedInt");
    /// 0…18446744073709551615 (64 bit).
    pub const UNSIGNED_LONG: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#unsignedLong");
    /// 0…65535 (16 bit).
    pub const UNSIGNED_SHORT: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#unsignedShort");
    /// Duration of time (months and years only).
    pub const YEAR_MONTH_DURATION: NamedNode =
        NamedNode::new_const_unchecked("http://www.w3.org/2001/XMLSchema#yearMonthDuration");
}

pub mod geosparql {
    //! [GeoSpatial](https://opengeospatial.github.io/ogc-geosparql/) vocabulary.
    use crate::named_node::NamedNode;

    /// Geospatial datatype like `"Point({longitude} {latitude})"^^geo:wktLiteral`
    pub const WKT_LITERAL: NamedNode =
        NamedNode::new_const_unchecked("http://www.opengis.net/ont/geosparql#wktLiteral");
}

#[cfg(test)]
mod tests {
    use super::{rdf, rdfs};

    #[test]
    fn current_rdf_schema_registry_terms_have_exact_iris() {
        let rdf_terms = [
            (&rdf::COMPOUND_LITERAL, "CompoundLiteral"),
            (&rdf::DIRECTION, "direction"),
            (&rdf::LANGUAGE, "language"),
            (&rdf::PLAIN_LITERAL, "PlainLiteral"),
            (&rdf::REIFIES, "reifies"),
            (&rdf::VERSION_1_0, "version-1.0"),
            (&rdf::VERSION_1_1, "version-1.1"),
        ];
        for (term, local_name) in rdf_terms {
            assert_eq!(
                term.as_str(),
                format!("http://www.w3.org/1999/02/22-rdf-syntax-ns#{local_name}")
            );
        }
        assert_eq!(
            rdfs::PROPOSITION.as_str(),
            "http://www.w3.org/2000/01/rdf-schema#Proposition"
        );
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn current_rdf12_interoperability_registry_terms_have_exact_iris() {
        let terms = [
            (&rdf::PROPOSITION_FORM, "PropositionForm"),
            (&rdf::PROPOSITION_FORM_OBJECT, "propositionFormObject"),
            (&rdf::PROPOSITION_FORM_PREDICATE, "propositionFormPredicate"),
            (&rdf::PROPOSITION_FORM_SUBJECT, "propositionFormSubject"),
            (&rdf::VERSION_1_2, "version-1.2"),
            (&rdf::VERSION_1_2_BASIC, "version-1.2-basic"),
        ];
        for (term, local_name) in terms {
            assert_eq!(
                term.as_str(),
                format!("http://www.w3.org/1999/02/22-rdf-syntax-ns#{local_name}")
            );
        }
    }
}
