from __future__ import annotations

import unittest
from io import BytesIO

from pyoxigraph import BlankNode, Dataset, NamedNode, RdfFormat, Store, parse_dataset, serialize

EMPTY = NamedNode("http://example.com/empty")
FULL = NamedNode("http://example.com/full")
TRIG = b"""
    <http://example.com/empty> {}
    <http://example.com/full> {
        <http://example.com/s> <http://example.com/p> <http://example.com/o>
    }
"""
JSON_LD = b"""[
    {"@id":"http://example.com/empty","@graph":[]},
    {"@id":"_:empty-blank","@graph":[]}
]"""


class TestDatasetTopology(unittest.TestCase):
    def test_dataset_exposes_empty_named_graph_topology(self) -> None:
        dataset = Dataset(named_graphs=[EMPTY])
        self.assertEqual([EMPTY], dataset.named_graphs())
        self.assertTrue(dataset.contains_named_graph(EMPTY))
        self.assertEqual(0, len(dataset))
        self.assertFalse(dataset)

        dataset.add_graph(FULL)
        self.assertTrue(dataset.contains_named_graph(FULL))
        dataset.clear_graph(FULL)
        self.assertTrue(dataset.contains_named_graph(FULL))
        dataset.remove_graph(FULL)
        self.assertFalse(dataset.contains_named_graph(FULL))

    def test_parse_and_serialize_dataset_preserve_topology(self) -> None:
        dataset = parse_dataset(input=BytesIO(TRIG), format=RdfFormat.TRIG)
        self.assertEqual(1, len(dataset))
        self.assertEqual({EMPTY, FULL}, set(dataset.named_graphs()))

        output = serialize(dataset, format=RdfFormat.TRIG)
        self.assertIsNotNone(output)
        restored = parse_dataset(input=output, format=RdfFormat.TRIG)
        self.assertTrue(dataset.is_isomorphic_to(restored))

    def test_serialize_fails_closed_for_quad_only_format(self) -> None:
        dataset = Dataset(named_graphs=[EMPTY])
        with self.assertRaises(OSError):
            serialize(dataset, format=RdfFormat.N_QUADS)

    def test_json_ld_parse_and_serialize_preserve_topology(self) -> None:
        dataset = parse_dataset(input=JSON_LD, format=RdfFormat.JSON_LD)
        self.assertEqual(
            {EMPTY, BlankNode("empty-blank")},
            set(dataset.named_graphs()),
        )
        self.assertEqual(0, len(dataset))

        output = serialize(dataset, format=RdfFormat.JSON_LD)
        self.assertIsNotNone(output)
        restored = parse_dataset(input=output, format=RdfFormat.JSON_LD)
        self.assertTrue(dataset.is_isomorphic_to(restored))


class TestStoreTopologyIo(unittest.TestCase):
    def test_store_load_dump_round_trip(self) -> None:
        store = Store()
        store.load(input=BytesIO(TRIG), format=RdfFormat.TRIG)
        self.assertEqual({EMPTY, FULL}, set(store.named_graphs()))

        output = store.dump(format=RdfFormat.TRIG)
        restored = parse_dataset(input=output, format=RdfFormat.TRIG)
        self.assertEqual({EMPTY, FULL}, set(restored.named_graphs()))
        self.assertEqual(1, len(restored))

    def test_store_bulk_load_preserves_empty_graph_and_dump_fails_closed(self) -> None:
        store = Store()
        store.bulk_load(input=b"<http://example.com/empty> {}", format=RdfFormat.TRIG)
        self.assertTrue(store.contains_named_graph(EMPTY))
        self.assertEqual(0, len(store))
        with self.assertRaises(OSError):
            store.dump(format=RdfFormat.N_QUADS)


if __name__ == "__main__":
    unittest.main()
