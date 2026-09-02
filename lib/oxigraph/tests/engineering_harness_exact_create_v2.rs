mod engineering_harness_exact_create_v2_created;
mod engineering_harness_exact_create_v2_present;

#[test]
fn exact_create_and_modify_complete_the_control() {
    assert_eq!(
        engineering_harness_exact_create_v2_created::CREATED_MARKER,
        "created-exactly"
    );
    assert_eq!(
        engineering_harness_exact_create_v2_present::PRESENT_MARKER,
        "modified-present"
    );
}
