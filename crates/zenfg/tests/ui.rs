#[test]
fn lifecycle_and_typed_access_contracts() {
    let target_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(".cargo-target");
    std::fs::create_dir_all(&target_dir).unwrap();
    // This test binary owns the environment mutation and runs one trybuild suite.
    unsafe {
        std::env::set_var("CARGO_TARGET_DIR", target_dir);
    }
    let tests = trybuild::TestCases::new();
    tests.compile_fail("tests/ui/*.rs");
}
