//! Simple Features boundary operation.

use crate::parse::extract_argument;
use crate::serialization::geometry_to_literal;
use geo::{
    Coord, Geometry, GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon,
    Point, Polygon,
};
use oxrdf::Term;

/// <http://www.opengis.net/def/function/geosparql/boundary>.
pub(crate) fn geof_boundary(args: &[Term]) -> Option<Term> {
    let args: &[Term; 1] = args.try_into().ok()?;
    let geometry = extract_argument(&args[0])?;
    let boundary = geometry_boundary(&geometry)?;
    Some(geometry_to_literal(&boundary, args).into())
}

/// Computes the Simple Features boundary using the MOD-2 boundary node rule.
fn geometry_boundary(geometry: &Geometry) -> Option<Geometry> {
    match geometry {
        Geometry::Point(_) | Geometry::MultiPoint(_) => Some(empty_zero_dimensional_boundary()),
        Geometry::Line(line) => Some(line_string_boundary(&LineString::from(*line))),
        Geometry::LineString(line) => Some(line_string_boundary(line)),
        Geometry::MultiLineString(lines) => Some(multi_line_string_boundary(lines)),
        Geometry::Polygon(polygon) => Some(polygon_boundary(polygon)),
        Geometry::MultiPolygon(polygons) => Some(multi_polygon_boundary(polygons)),
        Geometry::Rect(rect) => Some(polygon_boundary(&rect.to_polygon())),
        Geometry::Triangle(triangle) => Some(polygon_boundary(&triangle.to_polygon())),
        // Simple Features leaves GeometryCollection boundary unsupported. Jena
        // follows JTS here and raises an evaluation error for this input shape.
        Geometry::GeometryCollection(_) => None,
    }
}

fn empty_zero_dimensional_boundary() -> Geometry {
    Geometry::GeometryCollection(GeometryCollection::empty())
}

fn line_string_boundary(line: &LineString) -> Geometry {
    let (Some(start), Some(end)) = (line.0.first(), line.0.last()) else {
        return Geometry::MultiPoint(MultiPoint::new(Vec::new()));
    };
    if start == end {
        Geometry::MultiPoint(MultiPoint::new(Vec::new()))
    } else {
        Geometry::MultiPoint(MultiPoint::new(vec![
            Point::from(*start),
            Point::from(*end),
        ]))
    }
}

fn multi_line_string_boundary(lines: &MultiLineString) -> Geometry {
    let mut endpoint_counts: Vec<(Coord, usize)> = Vec::new();
    for line in lines {
        let (Some(start), Some(end)) = (line.0.first(), line.0.last()) else {
            continue;
        };
        increment_endpoint(&mut endpoint_counts, *start);
        increment_endpoint(&mut endpoint_counts, *end);
    }
    let mut boundary_points: Vec<Point> = endpoint_counts
        .into_iter()
        .filter(|(_, count)| count % 2 == 1)
        .map(|(coordinate, _)| Point::from(coordinate))
        .collect();
    boundary_points.sort_by(|left, right| {
        left.x()
            .total_cmp(&right.x())
            .then_with(|| left.y().total_cmp(&right.y()))
    });
    if boundary_points.len() == 1 {
        Geometry::Point(boundary_points[0])
    } else {
        Geometry::MultiPoint(MultiPoint::new(boundary_points))
    }
}

fn increment_endpoint(endpoint_counts: &mut Vec<(Coord, usize)>, endpoint: Coord) {
    if let Some((_, count)) = endpoint_counts
        .iter_mut()
        .find(|(coordinate, _)| *coordinate == endpoint)
    {
        *count += 1;
    } else {
        endpoint_counts.push((endpoint, 1));
    }
}

fn polygon_boundary(polygon: &Polygon) -> Geometry {
    if polygon.exterior().0.is_empty() {
        return Geometry::MultiLineString(MultiLineString::new(Vec::new()));
    }
    if polygon.interiors().is_empty() {
        Geometry::LineString(polygon.exterior().clone())
    } else {
        let mut rings = Vec::with_capacity(polygon.interiors().len() + 1);
        rings.push(polygon.exterior().clone());
        rings.extend_from_slice(polygon.interiors());
        Geometry::MultiLineString(MultiLineString::new(rings))
    }
}

fn multi_polygon_boundary(polygons: &MultiPolygon) -> Geometry {
    let mut rings = Vec::new();
    for polygon in polygons {
        if polygon.exterior().0.is_empty() {
            continue;
        }
        rings.push(polygon.exterior().clone());
        rings.extend_from_slice(polygon.interiors());
    }
    Geometry::MultiLineString(MultiLineString::new(rings))
}

#[cfg(test)]
mod tests {
    #![expect(clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::geosparql;
    use crate::parse::parse_wkt_literal;
    use oxrdf::{Literal, OxString};

    fn wkt_term(value: &str) -> Term {
        Literal::new_typed_literal(OxString::new_owned(value), geosparql::WKT_LITERAL).into()
    }

    fn boundary_wkt(value: &str) -> Geometry {
        let result = geof_boundary(&[wkt_term(value)]).expect("boundary result");
        let Term::Literal(literal) = result else {
            panic!("expected literal");
        };
        assert_eq!(*literal.datatype(), geosparql::WKT_LITERAL);
        parse_wkt_literal(literal.value()).expect("valid WKT result")
    }

    #[test]
    fn polygon_boundary_matches_jena_reference_case() {
        let result = boundary_wkt("POLYGON((30 40,30 70,90 70,90 40,30 40))");
        let expected =
            parse_wkt_literal("LINESTRING(30 40,30 70,90 70,90 40,30 40)").expect("valid WKT");
        assert_eq!(result, expected);
    }

    #[test]
    fn polygon_with_hole_returns_all_rings() {
        let result = boundary_wkt("POLYGON((0 0,10 0,10 10,0 10,0 0),(2 2,2 4,4 4,4 2,2 2))");
        assert!(matches!(
            &result,
            Geometry::MultiLineString(MultiLineString(rings)) if rings.len() == 2
        ));
    }

    #[test]
    fn open_and_closed_line_boundaries_follow_mod_two_rule() {
        let open = boundary_wkt("LINESTRING(0 0,1 1,2 0)");
        assert!(matches!(
            &open,
            Geometry::MultiPoint(MultiPoint(points)) if points.len() == 2
        ));

        let closed = boundary_wkt("LINESTRING(0 0,1 1,0 0)");
        assert!(matches!(
            &closed,
            Geometry::MultiPoint(MultiPoint(points)) if points.is_empty()
        ));
    }

    #[test]
    fn multi_line_shared_endpoints_cancel_mod_two() {
        let result = boundary_wkt("MULTILINESTRING((0 0,1 1),(1 1,2 0))");
        let Geometry::MultiPoint(points) = result else {
            panic!("expected multipoint");
        };
        assert_eq!(points.0, vec![Point::new(0.0, 0.0), Point::new(2.0, 0.0)]);
    }

    #[test]
    fn point_boundary_is_empty_geometry_collection() {
        let result = boundary_wkt("POINT(1 2)");
        assert!(matches!(
            &result,
            Geometry::GeometryCollection(GeometryCollection(geometries))
                if geometries.is_empty()
        ));
    }

    #[test]
    fn geojson_input_preserves_output_datatype() {
        let input = Literal::new_typed_literal(
            r#"{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]}"#,
            geosparql::GEO_JSON_LITERAL,
        );
        let result = geof_boundary(&[input.into()]).expect("boundary result");
        let Term::Literal(literal) = result else {
            panic!("expected literal");
        };
        assert_eq!(*literal.datatype(), geosparql::GEO_JSON_LITERAL);
        assert!(literal.value().contains(r#""type":"LineString""#));
    }

    #[test]
    fn rejects_wrong_arity_and_geometry_collections() {
        assert!(geof_boundary(&[]).is_none());
        assert!(geof_boundary(&[wkt_term("POINT(0 0)"), wkt_term("POINT(1 1)")]).is_none());
        assert!(geof_boundary(&[wkt_term("GEOMETRYCOLLECTION(POINT(0 0))")]).is_none());
    }

    #[test]
    fn public_registry_exposes_boundary_function() {
        let (_, function) = crate::GEOSPARQL_EXTENSION_FUNCTIONS
            .into_iter()
            .find(|(name, _)| {
                name.as_str() == "http://www.opengis.net/def/function/geosparql/boundary"
            })
            .expect("boundary registration");
        assert!(function(&[wkt_term("POLYGON((0 0,2 0,2 2,0 0))")]).is_some());
    }
}
