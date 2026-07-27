//! GeoSPARQL function vocabulary constants.

use oxrdf::NamedNode;

pub const AREA: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/area");
pub const AS_GEO_JSON: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/asGeoJSON");
pub const BOUNDARY: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/boundary");
pub const CENTROID: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/centroid");
pub const CONVEX_HULL: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/convexHull");
pub const COORDINATE_DIMENSION: NamedNode = NamedNode::new_const_unchecked(
    "http://www.opengis.net/def/function/geosparql/coordinateDimension",
);
pub const DIFFERENCE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/difference");
pub const DIMENSION: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/dimension");
pub const DISTANCE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/distance");
pub const EH_CONTAINS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehContains");
pub const EH_COVERED_BY: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehCoveredBy");
pub const EH_COVERS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehCovers");
pub const EH_DISJOINT: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehDisjoint");
pub const EH_EQUALS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehEquals");
pub const EH_INSIDE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehInside");
pub const EH_MEET: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehMeet");
pub const EH_OVERLAP: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/ehOverlap");
pub const ENVELOPE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/envelope");
pub const GET_SRID: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/getSRID");
pub const INTERSECTION: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/intersection");
pub const IS_EMPTY: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/isEmpty");
pub const IS_SIMPLE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/isSimple");
pub const LENGTH: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/length");
pub const PERIMETER: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/perimeter");
pub const RCC8_DC: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8dc");
pub const RCC8_EC: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8ec");
pub const RCC8_EQ: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8eq");
pub const RCC8_NTPP: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8ntpp");
pub const RCC8_NTPPI: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8ntppi");
pub const RCC8_PO: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8po");
pub const RCC8_TPP: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8tpp");
pub const RCC8_TPPI: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/rcc8tppi");
pub const RELATE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/relate");
pub const SF_CONTAINS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfContains");
pub const SF_CROSSES: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfCrosses");
pub const SF_DISJOINT: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfDisjoint");
pub const SF_EQUALS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfEquals");
pub const SF_INTERSECTS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfIntersects");
pub const SF_OVERLAPS: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfOverlaps");
pub const SF_TOUCHES: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfTouches");
pub const SF_WITHIN: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/sfWithin");
pub const SPATIAL_DIMENSION: NamedNode = NamedNode::new_const_unchecked(
    "http://www.opengis.net/def/function/geosparql/spatialDimension",
);
pub const SYM_DIFFERENCE: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/symDifference");
pub const UNION: NamedNode =
    NamedNode::new_const_unchecked("http://www.opengis.net/def/function/geosparql/union");
