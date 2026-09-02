pub const PRESENT_MARKER: &str = "modified-present";

#[test]
fn present_control_matches_the_green_reference() {
    assert_eq!(PRESENT_MARKER, "modified-present");
}
