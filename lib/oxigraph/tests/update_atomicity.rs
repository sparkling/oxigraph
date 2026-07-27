#[cfg(test)]
mod tests {
    use oxigraph::model::{GraphName, NamedNode, Quad};
    use oxigraph::sparql::SparqlEvaluator;
    use oxigraph::store::Store;
    use std::error::Error;
    use std::io;

    fn quad(subject: &'static str) -> Quad {
        Quad::new(
            NamedNode::new_unchecked(subject),
            NamedNode::new_unchecked("http://example.com/p"),
            NamedNode::new_unchecked("http://example.com/o"),
            GraphName::DefaultGraph,
        )
    }

    fn store_with_existing_graph() -> Result<Store, Box<dyn Error>> {
        let store = Store::new()?;
        store.insert_named_graph(NamedNode::new_unchecked("http://example.com/existing"))?;
        Ok(store)
    }

    #[test]
    fn whole_update_request_rolls_back_when_a_later_operation_fails() -> Result<(), Box<dyn Error>>
    {
        let store = store_with_existing_graph()?;
        let inserted = quad("http://example.com/first");
        let update = concat!(
            "INSERT DATA { <http://example.com/first> ",
            "<http://example.com/p> <http://example.com/o> };",
            "CREATE GRAPH <http://example.com/existing>"
        );

        if SparqlEvaluator::new()
            .parse_update(update)?
            .on_store(&store)
            .execute()
            .is_ok()
        {
            return Err(io::Error::other("the failing update request succeeded").into());
        }
        if store.contains(&inserted)? {
            return Err(io::Error::other(
                "an operation preceding the failure leaked outside the request transaction",
            )
            .into());
        }
        Ok(())
    }

    #[test]
    fn failing_update_operation_aborts_all_following_operations() -> Result<(), Box<dyn Error>> {
        let store = store_with_existing_graph()?;
        let following = quad("http://example.com/following");
        let update = concat!(
            "CREATE GRAPH <http://example.com/existing>;",
            "INSERT DATA { <http://example.com/following> ",
            "<http://example.com/p> <http://example.com/o> }"
        );

        if SparqlEvaluator::new()
            .parse_update(update)?
            .on_store(&store)
            .execute()
            .is_ok()
        {
            return Err(io::Error::other("the failing update request succeeded").into());
        }
        if store.contains(&following)? {
            return Err(
                io::Error::other("an operation following the failure was evaluated").into(),
            );
        }
        Ok(())
    }
}
