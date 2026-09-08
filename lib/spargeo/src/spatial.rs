//! Conservative envelopes for optional candidate indexes, not exact predicates.
use crate::parse::extract_argument;
use geo::{BoundingRect, CoordsIter, Geometry, Validation};
use oxrdf::Term;

/// The same CRS84 parser used by the exact GeoSPARQL functions, followed by
/// conservative candidate-index classification. No coordinate transformation,
/// longitude wrapping, axis swap or topology repair is performed.
#[derive(Clone, Copy, Debug, PartialEq)]
#[non_exhaustive]
pub enum SpatialEnvelope {
    /// The exact parser does not accept this term. It cannot produce a true
    /// result from the existing binary geometry functions.
    Unsupported,
    /// Parsed coordinates are not finite. Never insert these in a spatial tree
    /// or pass them to exact relation evaluation; report a typed failure.
    NonFinite,
    /// Parsed finite coordinates exceed this profile's arithmetic range (1e150).
    OutOfRange,
    /// Invalid topology, including an invalid member of a geometry collection.
    Invalid,
    /// Nonempty geometry collection. The exact engine does not support every
    /// combination of members, even when each member validates independently.
    UnsupportedCollection,
    /// Empty geometry. Retain it in
    /// an always-refined bucket; absence of a usable box is not absence of a match.
    Unbounded,
    /// Inclusive Cartesian bounds in literal coordinate order.
    Bounds { lower: [f64; 2], upper: [f64; 2] },
}

/// Classifies a literal without exposing the geometry engine through the API.
/// Callers must bound input bytes before parsing. Native parsing/allocation and
/// topology validation are cooperative boundaries, not preemptible operations.
pub fn spatial_envelope(term: &Term) -> SpatialEnvelope {
    let Some(geometry) = extract_argument(term) else {
        return SpatialEnvelope::Unsupported;
    };
    let mut extreme = false;
    for coordinate in geometry.coords_iter() {
        if !coordinate.x.is_finite() || !coordinate.y.is_finite() {
            return SpatialEnvelope::NonFinite;
        }
        // Keep R-tree area/distance arithmetic finite even for out-of-range
        // literal coordinates accepted by the existing planar exact functions.
        extreme |= coordinate.x.abs() > 1e150 || coordinate.y.abs() > 1e150;
    }
    if extreme {
        return SpatialEnvelope::OutOfRange;
    }
    if !geometry.is_valid() {
        return SpatialEnvelope::Invalid;
    }
    if matches!(geometry, Geometry::GeometryCollection(_)) {
        return if geometry.coords_iter().next().is_none() {
            SpatialEnvelope::Unbounded
        } else {
            SpatialEnvelope::UnsupportedCollection
        };
    }
    let Some(bounds) = geometry.bounding_rect() else {
        return SpatialEnvelope::Unbounded;
    };
    SpatialEnvelope::Bounds {
        lower: [bounds.min().x, bounds.min().y],
        upper: [bounds.max().x, bounds.max().y],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geosparql;
    use oxrdf::Literal;

    fn wkt(value: &str) -> SpatialEnvelope {
        spatial_envelope(
            &Literal::new_typed_literal(value.to_owned(), geosparql::WKT_LITERAL).into(),
        )
    }
    #[test]
    fn raw_crs84_axes_and_dateline_are_not_normalized() {
        assert_eq!(
            wkt("POINT(12 48)"),
            SpatialEnvelope::Bounds {
                lower: [12., 48.],
                upper: [12., 48.]
            }
        );
        assert_eq!(
            wkt("LINESTRING(179 0,-179 1)"),
            SpatialEnvelope::Bounds {
                lower: [-179., 0.],
                upper: [179., 1.]
            }
        );
        assert_eq!(
            wkt("<http://www.opengis.net/def/crs/EPSG/0/4326> POINT(12 48)"),
            SpatialEnvelope::Unsupported
        );
    }
    #[test]
    fn unbounded_does_not_mean_no_match() {
        assert_eq!(wkt("POLYGON EMPTY"), SpatialEnvelope::Unbounded);
        assert_eq!(
            wkt("GEOMETRYCOLLECTION(POINT(1 2))"),
            SpatialEnvelope::UnsupportedCollection
        );
        assert_eq!(
            wkt("POLYGON((0 0,2 2,0 2,2 0,0 0))"),
            SpatialEnvelope::Invalid
        );
        assert_eq!(
            wkt("GEOMETRYCOLLECTION(LINESTRING(0 0,0 0))"),
            SpatialEnvelope::Invalid
        );
        assert_eq!(wkt("POINT(1e200 1)"), SpatialEnvelope::OutOfRange);
    }
    #[test]
    fn nonfinite_is_distinct_from_unsupported() {
        assert_eq!(wkt("POINT(NaN 2)"), SpatialEnvelope::Unsupported);
        assert_eq!(wkt("POINT(inf 2)"), SpatialEnvelope::Unsupported);
        assert_eq!(wkt("POINT(1e309 2)"), SpatialEnvelope::NonFinite);
        assert_eq!(wkt("not WKT"), SpatialEnvelope::Unsupported);
        assert_eq!(
            spatial_envelope(&Literal::from("POINT(1 2)").into()),
            SpatialEnvelope::Unsupported
        );
    }
}
