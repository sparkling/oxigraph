pub const PRESENT_MARKER: &str = "baseline-present";

#[test]
fn present_control_starts_at_the_frozen_baseline() {
    assert_eq!(PRESENT_MARKER, "baseline-present");
}
