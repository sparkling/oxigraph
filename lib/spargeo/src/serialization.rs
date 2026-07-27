//! Output serialization selection for geometry-returning functions.

use crate::geosparql;
use crate::parse::{result_to_geojson_literal, result_to_wkt_literal};
use geo::Geometry;
use oxrdf::{Literal, Term};

/// Geometry literal datatype observed on an input argument.
#[derive(Copy, Clone)]
enum GeometryLiteralKind {
    Wkt,
    GeoJson,
}

fn detect_literal_kind(term: &Term) -> Option<GeometryLiteralKind> {
    let Term::Literal(literal) = term else {
        return None;
    };
    if *literal.datatype() == geosparql::WKT_LITERAL {
        Some(GeometryLiteralKind::Wkt)
    } else if *literal.datatype() == geosparql::GEO_JSON_LITERAL {
        Some(GeometryLiteralKind::GeoJson)
    } else {
        None
    }
}

/// Picks the output serialization used by a geometry-returning function.
///
/// WKT inputs produce WKT output, GeoJSON inputs produce GeoJSON output, and
/// any mix or unrecognised datatype falls back to WKT.
pub(crate) fn geometry_to_literal(geom: &Geometry, args: &[Term]) -> Literal {
    let mut seen_geojson = false;
    for term in args {
        match detect_literal_kind(term) {
            Some(GeometryLiteralKind::Wkt) => return result_to_wkt_literal(geom),
            Some(GeometryLiteralKind::GeoJson) => seen_geojson = true,
            None => {}
        }
    }
    if seen_geojson {
        result_to_geojson_literal(geom)
    } else {
        result_to_wkt_literal(geom)
    }
}
