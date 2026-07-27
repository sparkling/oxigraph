#![cfg(feature = "sparql-12")]
#![expect(
    clippy::expect_used,
    clippy::panic,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module
)]

use oxrdf::{Literal, NamedNode, Term, Triple, Variable};
use sparesults::{
    QueryResultsFormat, QueryResultsParser, QueryResultsSerializer, SliceQueryResultsParserOutput,
};
use std::error::Error;
use std::iter::once;

fn nested_triple_term() -> Term {
    let inner = Triple::new(
        NamedNode::new_unchecked("http://example.com/inner"),
        NamedNode::new_unchecked("http://example.com/p"),
        Literal::new_simple_literal("deep"),
    );
    Triple::new(
        NamedNode::new_unchecked("http://example.com/outer"),
        NamedNode::new_unchecked("http://example.com/contains"),
        inner,
    )
    .into()
}

fn serialize(format: QueryResultsFormat, value: &Term) -> Result<String, Box<dyn Error>> {
    let variable = Variable::new("value")?;
    let mut serializer = QueryResultsSerializer::from_format(format)
        .serialize_solutions_to_writer(Vec::new(), vec![variable.clone()])?;
    serializer.serialize(once((&variable, value)))?;
    Ok(String::from_utf8(serializer.finish()?)?)
}

#[test]
fn csv_and_tsv_serialize_nested_triple_terms_recursively() -> Result<(), Box<dyn Error>> {
    let value = nested_triple_term();
    let csv = serialize(QueryResultsFormat::Csv, &value)?;
    assert_eq!(
        csv,
        concat!(
            "value\r\n",
            "\"<<( http://example.com/outer http://example.com/contains ",
            "<<( http://example.com/inner http://example.com/p \"\"deep\"\" )>> )>>\"\r\n"
        )
    );

    let tsv = serialize(QueryResultsFormat::Tsv, &value)?;
    assert_eq!(
        tsv,
        concat!(
            "?value\n",
            "<<( <http://example.com/outer> <http://example.com/contains> ",
            "<<( <http://example.com/inner> <http://example.com/p> \"deep\" )>> )>>\n"
        )
    );
    let SliceQueryResultsParserOutput::Solutions(mut solutions) =
        QueryResultsParser::from_format(QueryResultsFormat::Tsv).for_slice(&tsv)?
    else {
        panic!("expected a solution sequence");
    };
    let solution = solutions.next().expect("one solution")?;
    assert_eq!(solution.get("value"), Some(&value));
    assert!(solutions.next().is_none());
    Ok(())
}
