use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;
use zenfg_snapshot::{
    SnapshotDecodeSource, SnapshotJsonError, decode_frame_graph_snapshot,
    parse_frame_graph_snapshot, to_json, validate_frame_graph_snapshot,
};

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapshot")
}

fn read(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn accepts_typescript_golden_fixtures_and_round_trips() {
    for name in [
        "minimal.fgsnapshot.json",
        "full-webgpu.fgsnapshot.json",
        "aliasing.fgsnapshot.json",
        "timing-unavailable.fgsnapshot.json",
        "stable-keys.fgsnapshot.json",
        "legacy-v0.expected.fgsnapshot.json",
    ] {
        let decoded =
            parse_frame_graph_snapshot(&read(corpus().join("fixtures").join(name))).unwrap();
        assert_eq!(decoded.source, SnapshotDecodeSource::V1, "{name}");
        assert!(!decoded.migrated, "{name}");
        assert!(decoded.issues.is_empty(), "{name}");
        let encoded = to_json(&decoded.snapshot).unwrap();
        let mut source: Value =
            serde_json::from_str(&read(corpus().join("fixtures").join(name))).unwrap();
        let mut round_trip: Value = serde_json::from_str(&encoded).unwrap();
        normalize_integral_json_numbers(&mut source);
        normalize_integral_json_numbers(&mut round_trip);
        assert_eq!(round_trip, source, "{name}");
        assert!(parse_frame_graph_snapshot(&encoded).is_ok(), "{name}");
    }
}

fn normalize_integral_json_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(normalize_integral_json_numbers),
        Value::Object(values) => values
            .values_mut()
            .for_each(normalize_integral_json_numbers),
        Value::Number(number) => {
            if let Some(value) = number.as_f64()
                && value.fract() == 0.0
                && value >= 0.0
                && value <= u64::MAX as f64
            {
                *number = serde_json::Number::from(value as u64);
            }
        }
        _ => {}
    }
}

#[test]
fn migrates_both_supported_historical_encodings() {
    let legacy =
        parse_frame_graph_snapshot(&read(corpus().join("fixtures/legacy-v0.json"))).unwrap();
    assert_eq!(legacy.source, SnapshotDecodeSource::LegacyV0);
    assert!(legacy.migrated);
    assert_eq!(legacy.issues[0].code, "legacy-v0-migrated");
    let expected: Value = serde_json::from_str(&read(
        corpus().join("fixtures/legacy-v0.expected.fgsnapshot.json"),
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(&legacy.snapshot).unwrap(), expected);

    let t3d = parse_frame_graph_snapshot(&read(
        corpus().join("fixtures/legacy-t3d-v1-canonical.json"),
    ))
    .unwrap();
    assert_eq!(t3d.source, SnapshotDecodeSource::T3dV1);
    assert!(t3d.migrated);
    assert_eq!(t3d.issues[0].code, "t3d-v1-migrated");
    let expected: Value = serde_json::from_str(&read(
        corpus().join("fixtures/legacy-t3d-v1.expected.fgsnapshot.json"),
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(&t3d.snapshot).unwrap(), expected);
}

#[test]
fn matches_the_shared_conformance_issue_tuples() {
    let manifest: Value =
        serde_json::from_str(&read(corpus().join("conformance/manifest.json"))).unwrap();
    let conformance = corpus().join("conformance");
    for case in manifest["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let file = conformance.join(case["file"].as_str().unwrap());
        let input = case["input"].as_str().unwrap();
        let text = read(file);
        let (valid, mut actual, snapshot) = if input == "validator" {
            let value: Value = serde_json::from_str(&text).unwrap();
            let issues = validate_frame_graph_snapshot(&value);
            (issues.is_empty(), issues, None)
        } else {
            let result = if input == "json-text" {
                parse_frame_graph_snapshot(&text)
            } else {
                let value: Value = serde_json::from_str(&text).unwrap();
                decode_frame_graph_snapshot(value)
            };
            match result {
                Ok(result) => (true, result.issues, Some(result.snapshot)),
                Err(error) => (false, error.issues, None),
            }
        };
        assert_eq!(valid, case["runtimeValid"] == true, "{id}");
        actual.sort_by(|left, right| {
            (&left.path, &left.code, &left.message).cmp(&(&right.path, &right.code, &right.message))
        });
        let mut expected = case
            .get("issues")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        expected.sort_by(|left, right| {
            (
                left["path"].as_str(),
                left["code"].as_str(),
                left["message"].as_str(),
            )
                .cmp(&(
                    right["path"].as_str(),
                    right["code"].as_str(),
                    right["message"].as_str(),
                ))
        });
        let actual: Vec<Value> = actual
            .iter()
            .map(|issue| {
                serde_json::json!({
                    "code": issue.code,
                    "path": issue.path,
                    "message": issue.message,
                })
            })
            .collect();
        assert_eq!(actual, expected, "{id}");
        if let Some(canonical) = case.get("canonical").and_then(Value::as_str) {
            let expected: Value = serde_json::from_str(&read(conformance.join(canonical))).unwrap();
            assert_eq!(
                serde_json::to_value(snapshot.unwrap()).unwrap(),
                expected,
                "{id}"
            );
        }
    }
}

#[test]
fn rejects_unknown_format_and_version_and_validates_programmatic_values() {
    let mut value: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    value["format"] = Value::String("unknown.snapshot".into());
    assert_eq!(
        decode_frame_graph_snapshot(value).unwrap_err().issues[0].code,
        "unsupported-format"
    );

    let mut value: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    value["version"]["minor"] = Value::from(1);
    assert_eq!(
        decode_frame_graph_snapshot(value).unwrap_err().issues[0].code,
        "unsupported-version"
    );

    let value: Value =
        serde_json::from_str(&read(corpus().join("fixtures/full-webgpu.fgsnapshot.json"))).unwrap();
    assert!(validate_frame_graph_snapshot(&value).is_empty());
}

#[test]
fn validates_before_encoding_and_accepts_json_integer_notation() {
    let mut decoded =
        parse_frame_graph_snapshot(&read(corpus().join("fixtures/minimal.fgsnapshot.json")))
            .unwrap();
    decoded.snapshot.format = "invalid.snapshot".into();
    let error = to_json(&decoded.snapshot).unwrap_err();
    assert!(matches!(error, SnapshotJsonError::Validation { .. }));
    assert_eq!(error.issues().unwrap()[0].code, "invalid-literal");

    let mut value: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    value["capture"]["frameIndex"] = Value::from(0.0);
    assert!(validate_frame_graph_snapshot(&value).is_empty());
    assert!(decode_frame_graph_snapshot(value).is_ok());
}
