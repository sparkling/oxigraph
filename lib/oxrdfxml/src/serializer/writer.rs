use crate::utils::is_nc_name;
use oxilangtag::LanguageTag;
use oxiri::Iri;
#[cfg(feature = "rdf-12")]
use oxrdf::BaseDirection;
use oxrdf::vocab::{rdf, xsd};
use oxrdf::{NamedNode, NamedOrBlankNode, Term, Triple};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::io;

mod xml_text;

use self::xml_text::{escape_xml_text, validate_xml_10_characters};

const RDF_NAMESPACE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const ITS_NAMESPACE: &str = "http://www.w3.org/2005/11/its";
const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE: &str = "http://www.w3.org/2000/xmlns/";

// These IRIs cannot be emitted as property elements without changing their RDF/XML meaning.
const RESERVED_PROPERTY_IRIS: [&str; 15] = [
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "Description"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "li"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "RDF"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "ID"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "about"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "annotation"),
    concat!(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "annotationNodeID"
    ),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "parseType"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "resource"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "nodeID"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "datatype"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "version"),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "aboutEach"),
    concat!(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "aboutEachPrefix"
    ),
    concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "bagID"),
];

pub(super) struct InnerRdfXmlWriter {
    current_subject: Option<NamedOrBlankNode>,
    current_resource_tag: Option<String>,
    namespaces: Namespaces,
    base_iri: Option<Iri<String>>,
}

impl InnerRdfXmlWriter {
    pub(super) fn new(
        mut prefixes: BTreeMap<String, String>,
        base_iri: Option<Iri<String>>,
    ) -> Self {
        // These prefixes have fixed meanings in the generated document.
        prefixes.remove("rdf");
        prefixes.remove("its");
        prefixes.remove("xml");
        prefixes.remove("oxprefix");
        Self {
            current_subject: None,
            current_resource_tag: None,
            namespaces: Namespaces::new(prefixes),
            base_iri,
        }
    }

    pub(super) fn serialize_triple<'a>(
        &mut self,
        triple: &'a Triple,
        output: &mut Vec<Event<'a>>,
    ) -> io::Result<()> {
        // Validate the complete recursive term before mutating document state.
        self.namespaces.validate_configuration()?;
        validate_triple(triple)?;

        if self.current_subject.is_none() {
            self.write_start(output);
        }
        if self.current_subject.as_ref() != Some(&triple.subject) {
            if self.current_subject.is_some() {
                output.push(Event::End(
                    self.current_resource_tag
                        .take()
                        .map_or_else(|| BytesEnd::new("rdf:Description"), BytesEnd::new),
                ));
            }
            self.current_subject = Some(triple.subject.clone());

            let (mut description_start, with_type_tag) = self.typed_node_start(triple);
            description_start.push_attribute(subject_attribute(&triple.subject, &self.base_iri));
            output.push(Event::Start(description_start));
            if with_type_tag {
                return Ok(());
            }
        }
        self.write_predicate_object(&triple.predicate, &triple.object, output)
    }

    pub(super) fn finish(&mut self, output: &mut Vec<Event<'static>>) -> io::Result<()> {
        self.namespaces.validate_configuration()?;
        if self.current_subject.is_some() {
            output.push(Event::End(
                self.current_resource_tag
                    .take()
                    .map_or_else(|| BytesEnd::new("rdf:Description"), BytesEnd::new),
            ));
        } else {
            self.write_start(output);
        }
        output.push(Event::End(BytesEnd::new("rdf:RDF")));
        Ok(())
    }

    fn typed_node_start(&mut self, triple: &Triple) -> (BytesStart<'static>, bool) {
        if triple.predicate != rdf::TYPE {
            return (BytesStart::new("rdf:Description"), false);
        }
        let Term::NamedNode(node) = &triple.object else {
            return (BytesStart::new("rdf:Description"), false);
        };
        if RESERVED_PROPERTY_IRIS.contains(&node.as_str()) {
            return (BytesStart::new("rdf:Description"), false);
        }
        let Ok((qname, declaration)) = self.namespaces.qname(node) else {
            return (BytesStart::new("rdf:Description"), false);
        };
        let qname = qname.into_owned();
        let mut start = BytesStart::new(qname.clone());
        push_namespace_declaration(&mut start, declaration.as_ref());
        self.current_resource_tag = Some(qname);
        (start, true)
    }

    fn write_predicate_object<'a>(
        &mut self,
        predicate: &'a NamedNode,
        object: &'a Term,
        output: &mut Vec<Event<'a>>,
    ) -> io::Result<()> {
        let (qname, declaration) = self.namespaces.qname(predicate)?;
        let mut property_open = BytesStart::new(qname.clone());
        push_namespace_declaration(&mut property_open, declaration.as_ref());
        match object {
            Term::NamedNode(node) => {
                property_open
                    .push_attribute(("rdf:resource", relative_iri(node.as_str(), &self.base_iri)));
                output.push(Event::Empty(property_open));
            }
            Term::BlankNode(node) => {
                property_open.push_attribute((
                    "rdf:nodeID",
                    Cow::Owned(encoded_blank_node_id(node.as_str())),
                ));
                output.push(Event::Empty(property_open));
            }
            Term::Literal(literal) => {
                if let Some(language) = literal.language() {
                    property_open.push_attribute(("xml:lang", language));
                } else if *literal.datatype() != xsd::STRING {
                    property_open.push_attribute((
                        "rdf:datatype",
                        relative_iri(literal.datatype().as_str(), &self.base_iri),
                    ));
                }
                #[cfg(feature = "rdf-12")]
                if let Some(direction) = literal.direction() {
                    property_open.push_attribute(("rdf:version", "1.2-basic"));
                    property_open.push_attribute(("its:version", "2.0"));
                    property_open.push_attribute((
                        "its:dir",
                        match direction {
                            BaseDirection::Ltr => "ltr",
                            BaseDirection::Rtl => "rtl",
                        },
                    ));
                }
                output.push(Event::Start(property_open));
                output.push(Event::Text(BytesText::from_escaped(escape_xml_text(
                    literal.value(),
                ))));
                output.push(Event::End(BytesEnd::new(qname)));
            }
            #[cfg(feature = "rdf-12")]
            Term::Triple(triple) => {
                property_open.push_attribute(("rdf:version", "1.2"));
                property_open.push_attribute(("rdf:parseType", "Triple"));
                output.push(Event::Start(property_open));
                let mut subject_start = BytesStart::new("rdf:Description");
                subject_start.push_attribute(subject_attribute(&triple.subject, &self.base_iri));
                output.push(Event::Start(subject_start));
                self.write_predicate_object(&triple.predicate, &triple.object, output)?;
                output.push(Event::End(BytesEnd::new("rdf:Description")));
                output.push(Event::End(BytesEnd::new(qname)));
            }
        }
        Ok(())
    }

    fn write_start(&self, output: &mut Vec<Event<'_>>) {
        output.push(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)));
        let mut rdf_open = BytesStart::new("rdf:RDF");
        if let Some(base_iri) = &self.base_iri {
            rdf_open.push_attribute(("xml:base", base_iri.as_str()));
        }
        for (prefix, namespace) in &self.namespaces.root_declarations {
            let name = if prefix.is_empty() {
                "xmlns".to_owned()
            } else {
                format!("xmlns:{prefix}")
            };
            rdf_open.push_attribute((name.as_str(), namespace.as_str()));
        }
        output.push(Event::Start(rdf_open));
    }
}

struct Namespaces {
    root_declarations: Vec<(String, String)>,
    preferred_by_iri: BTreeMap<String, String>,
    fallback_by_iri: BTreeMap<String, String>,
    used_prefixes: BTreeSet<String>,
    has_default_namespace: bool,
    configuration_error: Option<String>,
}

impl Namespaces {
    fn new(mut prefixes: BTreeMap<String, String>) -> Self {
        let configuration_error = prefixes
            .iter()
            .find_map(|(prefix, namespace)| validate_prefix_binding(prefix, namespace).err());
        prefixes.insert("rdf".to_owned(), RDF_NAMESPACE.to_owned());
        prefixes.insert("its".to_owned(), ITS_NAMESPACE.to_owned());

        let has_default_namespace = prefixes.contains_key("");
        let mut preferred_by_iri = BTreeMap::new();
        for (prefix, namespace) in &prefixes {
            preferred_by_iri
                .entry(namespace.clone())
                .or_insert_with(|| prefix.clone());
        }
        preferred_by_iri.insert(RDF_NAMESPACE.to_owned(), "rdf".to_owned());
        preferred_by_iri.insert(ITS_NAMESPACE.to_owned(), "its".to_owned());
        preferred_by_iri.insert(XML_NAMESPACE.to_owned(), "xml".to_owned());

        let mut root_declarations = prefixes
            .iter()
            .map(|(prefix, namespace)| (prefix.clone(), namespace.clone()))
            .collect::<Vec<_>>();
        root_declarations.sort_by(|left, right| (&left.1, &left.0).cmp(&(&right.1, &right.0)));
        let mut used_prefixes = prefixes.into_keys().collect::<BTreeSet<_>>();
        used_prefixes.insert("xml".to_owned());
        Self {
            root_declarations,
            preferred_by_iri,
            fallback_by_iri: BTreeMap::new(),
            used_prefixes,
            has_default_namespace,
            configuration_error,
        }
    }

    fn validate_configuration(&self) -> io::Result<()> {
        if let Some(message) = &self.configuration_error {
            Err(io::Error::new(io::ErrorKind::InvalidInput, message.clone()))
        } else {
            Ok(())
        }
    }

    fn qname<'a>(
        &mut self,
        iri: &'a NamedNode,
    ) -> io::Result<(Cow<'a, str>, Option<(String, String)>)> {
        let (namespace, local_name) = qname_parts(iri)?;
        if let Some(prefix) = self.preferred_by_iri.get(namespace) {
            return Ok((
                if prefix.is_empty() {
                    Cow::Borrowed(local_name)
                } else {
                    Cow::Owned(format!("{prefix}:{local_name}"))
                },
                None,
            ));
        }
        if !self.has_default_namespace {
            return Ok((
                Cow::Borrowed(local_name),
                Some(("xmlns".to_owned(), namespace.to_owned())),
            ));
        }

        let prefix = if let Some(prefix) = self.fallback_by_iri.get(namespace) {
            prefix.clone()
        } else {
            let prefix = self.next_fallback_prefix();
            self.fallback_by_iri
                .insert(namespace.to_owned(), prefix.clone());
            prefix
        };
        Ok((
            Cow::Owned(format!("{prefix}:{local_name}")),
            Some((format!("xmlns:{prefix}"), namespace.to_owned())),
        ))
    }

    fn next_fallback_prefix(&mut self) -> String {
        for index in 0.. {
            let candidate = if index == 0 {
                "oxprefix".to_owned()
            } else {
                format!("oxprefix{index}")
            };
            if self.used_prefixes.insert(candidate.clone()) {
                return candidate;
            }
        }
        unreachable!("the namespace prefix counter is unbounded")
    }
}

fn validate_prefix_binding(prefix: &str, namespace: &str) -> Result<(), String> {
    if !prefix.is_empty() && (!is_nc_name(prefix) || prefix.to_ascii_lowercase().starts_with("xml"))
    {
        return Err(format!("'{prefix}' is not a usable XML namespace prefix"));
    }
    if namespace == XML_NAMESPACE || namespace == XMLNS_NAMESPACE {
        return Err(format!(
            "The namespace IRI '{namespace}' is reserved by Namespaces in XML"
        ));
    }
    validate_namespace(namespace).map_err(|error| error.to_string())
}

fn validate_triple(triple: &Triple) -> io::Result<()> {
    if let NamedOrBlankNode::NamedNode(subject) = &triple.subject {
        validate_iri(subject, "subject")?;
    }
    validate_predicate(&triple.predicate)?;
    match &triple.object {
        Term::NamedNode(node) => validate_iri(node, "object")?,
        Term::BlankNode(_) => {}
        Term::Literal(literal) => {
            validate_xml_10_characters(literal.value(), "literal lexical form")?;
            validate_iri(literal.datatype(), "literal datatype")?;
            if let Some(language) = literal.language() {
                LanguageTag::parse(language).map_err(|error| {
                    invalid_input(format!(
                        "The literal language tag '{language}' is invalid: {error}"
                    ))
                })?;
                if !language
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || !byte.is_ascii_alphabetic())
                {
                    return Err(invalid_input(format!(
                        "The literal language tag '{language}' is not lowercase"
                    )));
                }
            }
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => validate_triple(triple)?,
    }
    Ok(())
}

fn validate_predicate(predicate: &NamedNode) -> io::Result<()> {
    validate_iri(predicate, "predicate")?;
    if RESERVED_PROPERTY_IRIS.contains(&predicate.as_str()) {
        return Err(invalid_input(format!(
            "The RDF/XML reserved syntax IRI '{}' cannot be used as a property",
            predicate.as_str()
        )));
    }
    qname_parts(predicate)?;
    Ok(())
}

fn validate_iri(node: &NamedNode, context: &str) -> io::Result<()> {
    validate_xml_10_characters(node.as_str(), &format!("{context} IRI"))?;
    Iri::parse(node.as_str()).map(|_| ()).map_err(|error| {
        invalid_input(format!(
            "The {context} IRI '{}' is invalid: {error}",
            node.as_str()
        ))
    })
}

fn qname_parts(iri: &NamedNode) -> io::Result<(&str, &str)> {
    let (namespace, local_name) = split_iri(iri.as_str());
    if !is_nc_name(local_name) {
        return Err(qname_serialization_error(iri));
    }
    validate_namespace(namespace)?;
    Ok((namespace, local_name))
}

fn validate_namespace(namespace: &str) -> io::Result<()> {
    if namespace == XMLNS_NAMESPACE
        || (namespace.starts_with(RDF_NAMESPACE) && namespace != RDF_NAMESPACE)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("The namespace IRI '{namespace}' is not permitted in RDF/XML"),
        ));
    }
    Ok(())
}

fn qname_serialization_error(iri: &NamedNode) -> io::Error {
    invalid_input(format!(
        "The IRI '{}' cannot be represented as an RDF/XML XML QName",
        iri.as_str()
    ))
}

fn subject_attribute<'a>(
    subject: &'a NamedOrBlankNode,
    base_iri: &Option<Iri<String>>,
) -> (&'static str, Cow<'a, str>) {
    match subject {
        NamedOrBlankNode::NamedNode(node) => ("rdf:about", relative_iri(node.as_str(), base_iri)),
        NamedOrBlankNode::BlankNode(node) => (
            "rdf:nodeID",
            Cow::Owned(encoded_blank_node_id(node.as_str())),
        ),
    }
}

fn push_namespace_declaration(
    element: &mut BytesStart<'_>,
    declaration: Option<&(String, String)>,
) {
    if let Some((name, value)) = declaration {
        element.push_attribute((name.as_str(), value.as_str()));
    }
}

fn encoded_blank_node_id(id: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(1 + id.len() * 2);
    encoded.push('b');
    for byte in id.bytes() {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

pub(super) fn split_iri(iri: &str) -> (&str, &str) {
    // Select the longest legal NCName suffix whose preceding namespace is itself a valid IRI.
    // Checking the namespace avoids splitting inside a percent escape (e.g. before `E` in `%E9`).
    for (position, _) in iri.char_indices() {
        let (namespace, local_name) = iri.split_at(position);
        if is_nc_name(local_name) && Iri::parse(namespace).is_ok() {
            return (namespace, local_name);
        }
    }
    (iri, "")
}

fn relative_iri<'a>(iri: &'a str, base_iri: &Option<Iri<String>>) -> Cow<'a, str> {
    if let Some(base_iri) = base_iri {
        if let Ok(relative) = base_iri.relativize(&Iri::parse_unchecked(iri)) {
            return relative.into_inner().into();
        }
    }
    iri.into()
}

fn invalid_input(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}
