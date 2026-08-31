use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;
use zenfg_snapshot::{
    FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH, SnapshotDecodeSource, SnapshotJsonError,
    decode_frame_graph_snapshot, parse_frame_graph_snapshot, to_json, to_json_pretty,
    validate_frame_graph_snapshot, validate_typed_frame_graph_snapshot,
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

    let legacy_candidate = parse_frame_graph_snapshot(&read(
        corpus().join("fixtures/legacy-candidate-v1-canonical.json"),
    ))
    .unwrap();
    assert_eq!(
        legacy_candidate.source,
        SnapshotDecodeSource::LegacyCandidateV1
    );
    assert!(legacy_candidate.migrated);
    assert_eq!(
        legacy_candidate.issues[0].code,
        "legacy-candidate-v1-migrated"
    );
    let expected: Value = serde_json::from_str(&read(
        corpus().join("fixtures/legacy-candidate-v1.expected.fgsnapshot.json"),
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(&legacy_candidate.snapshot).unwrap(),
        expected
    );
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

#[test]
fn typed_validation_reuses_encoding_validation_without_serializing_text() {
    let snapshot =
        parse_frame_graph_snapshot(&read(corpus().join("fixtures/minimal.fgsnapshot.json")))
            .unwrap()
            .snapshot;
    assert!(validate_typed_frame_graph_snapshot(&snapshot).is_ok());

    let mut invalid = snapshot.clone();
    invalid.producer.name.clear();
    let error = validate_typed_frame_graph_snapshot(&invalid).unwrap_err();
    assert!(matches!(error, SnapshotJsonError::Validation { .. }));
    assert_eq!(error.issues().unwrap()[0].code, "empty-string");

    let mut invalid_timing = snapshot;
    invalid_timing.timings.gpu = zenfg_snapshot::SnapshotGpuTimings::Available {
        frame_span_micros: f64::NAN,
        nodes: Vec::new(),
    };
    let error = validate_typed_frame_graph_snapshot(&invalid_timing).unwrap_err();
    assert!(matches!(error, SnapshotJsonError::Validation { .. }));
    assert_eq!(
        error.issues().unwrap()[0].path,
        "/timings/gpu/frameSpanMicros"
    );
    assert!(matches!(
        to_json(&invalid_timing),
        Err(SnapshotJsonError::Validation { .. })
    ));
}

#[test]
fn enforces_extension_depth_across_validation_decoding_parsing_and_encoding() {
    assert_eq!(FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH, 64);

    let mut valid: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    valid["extensions"]["dev.zenfg.deep"] = nested_extension(64);
    assert!(validate_frame_graph_snapshot(&valid).is_empty());
    assert!(decode_frame_graph_snapshot(valid.clone()).is_ok());
    assert!(parse_frame_graph_snapshot(&serde_json::to_string(&valid).unwrap()).is_ok());

    let mut typed = decode_frame_graph_snapshot(valid).unwrap().snapshot;
    assert!(to_json(&typed).is_ok());
    assert!(to_json_pretty(&typed).is_ok());

    let mut valid_empty: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    valid_empty["extensions"]["dev.zenfg.empty"] = wrapped_empty_container(63);
    assert!(validate_frame_graph_snapshot(&valid_empty).is_empty());
    let valid_empty_typed = decode_frame_graph_snapshot(valid_empty).unwrap().snapshot;
    assert!(to_json(&valid_empty_typed).is_ok());
    assert!(to_json_pretty(&valid_empty_typed).is_ok());

    typed.extensions.insert(
        "dev.zenfg.deep/~".into(),
        nested_extension(FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH + 1),
    );
    let compact = to_json(&typed).unwrap_err();
    assert_extension_depth_issue(compact.issues().unwrap());
    let pretty = to_json_pretty(&typed).unwrap_err();
    assert_extension_depth_issue(pretty.issues().unwrap());

    let mut invalid: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    invalid["extensions"]["dev.zenfg.deep/~"] =
        nested_extension(FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH + 1);
    assert_extension_depth_issue(&validate_frame_graph_snapshot(&invalid));
    assert_extension_depth_issue(
        &decode_frame_graph_snapshot(invalid.clone())
            .unwrap_err()
            .issues,
    );
    assert_extension_depth_issue(
        &parse_frame_graph_snapshot(&serde_json::to_string(&invalid).unwrap())
            .unwrap_err()
            .issues,
    );

    let mut invalid_empty: Value =
        serde_json::from_str(&read(corpus().join("fixtures/minimal.fgsnapshot.json"))).unwrap();
    invalid_empty["extensions"]["dev.zenfg.deep/~"] = wrapped_empty_container(64);
    assert_extension_depth_issue(&validate_frame_graph_snapshot(&invalid_empty));
    assert_extension_depth_issue(
        &decode_frame_graph_snapshot(invalid_empty)
            .unwrap_err()
            .issues,
    );
}

fn nested_extension(depth: usize) -> Value {
    (0..depth).fold(Value::String("leaf".into()), |value, index| {
        if index % 2 == 0 {
            serde_json::json!({ "value": value })
        } else {
            serde_json::json!([value])
        }
    })
}

fn wrapped_empty_container(wrapper_count: usize) -> Value {
    (0..wrapper_count).fold(serde_json::json!({}), |value, index| {
        if index % 2 == 0 {
            serde_json::json!([value])
        } else {
            serde_json::json!({ "value": value })
        }
    })
}

fn assert_extension_depth_issue(issues: &[zenfg_snapshot::SnapshotIssue]) {
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, "extension-depth-exceeded");
    assert_eq!(issues[0].path, "/extensions/dev.zenfg.deep~1~0");
    assert_eq!(
        issues[0].message,
        "Extension JSON nesting depth must not exceed 64 container levels."
    );
}
