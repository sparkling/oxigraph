pub const CREATED_MARKER: &str = "created-exactly";

#[test]
fn created_control_matches_the_green_reference() {
    assert_eq!(CREATED_MARKER, "created-exactly");
}
