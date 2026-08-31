use crate::{
    FrameGraphSnapshotV1, SnapshotGpuTimings, SnapshotIssue, SnapshotJsonError,
    validate_frame_graph_snapshot, validator::validate_typed_extension_depths,
};

/// Validates and serializes a canonical Snapshot as compact JSON.
///
/// Encoding never writes to the filesystem. Invalid in-memory snapshots return
/// [`SnapshotJsonError::Validation`] instead of producing non-conforming JSON.
pub fn to_json(snapshot: &FrameGraphSnapshotV1) -> Result<String, SnapshotJsonError> {
    encode(snapshot, false)
}

/// Validates and serializes a canonical Snapshot as human-readable JSON.
///
/// This has the same validation and error behavior as [`to_json`]; only
/// whitespace differs.
pub fn to_json_pretty(snapshot: &FrameGraphSnapshotV1) -> Result<String, SnapshotJsonError> {
    encode(snapshot, true)
}

/// Validates a typed Snapshot without producing JSON text.
///
/// This performs the same typed-to-JSON conversion, numeric canonicalization,
/// and structural/semantic validation used by [`to_json`]. It is intended for
/// producers that need to establish the validity of an in-memory Snapshot before
/// returning it. No JSON string is allocated.
pub fn validate_typed_frame_graph_snapshot(
    snapshot: &FrameGraphSnapshotV1,
) -> Result<(), SnapshotJsonError> {
    canonicalize_and_validate(snapshot).map(|_| ())
}

fn encode(snapshot: &FrameGraphSnapshotV1, pretty: bool) -> Result<String, SnapshotJsonError> {
    let value = canonicalize_and_validate(snapshot)?;
    if pretty {
        serde_json::to_string_pretty(&value).map_err(Into::into)
    } else {
        serde_json::to_string(&value).map_err(Into::into)
    }
}

fn canonicalize_and_validate(
    snapshot: &FrameGraphSnapshotV1,
) -> Result<serde_json::Value, SnapshotJsonError> {
    let timing_issues = validate_typed_timing_numbers(snapshot);
    if !timing_issues.is_empty() {
        return Err(SnapshotJsonError::Validation {
            issues: timing_issues,
        });
    }
    let extension_issues = validate_typed_extension_depths(&snapshot.extensions);
    if !extension_issues.is_empty() {
        return Err(SnapshotJsonError::Validation {
            issues: extension_issues,
        });
    }
    let mut value = serde_json::to_value(snapshot)?;
    canonicalize_integral_numbers(&mut value);
    let issues = validate_frame_graph_snapshot(&value);
    if !issues.is_empty() {
        return Err(SnapshotJsonError::Validation { issues });
    }
    Ok(value)
}

fn validate_typed_timing_numbers(snapshot: &FrameGraphSnapshotV1) -> Vec<SnapshotIssue> {
    let mut issues = Vec::new();
    if let SnapshotGpuTimings::Available {
        frame_span_micros,
        nodes,
    } = &snapshot.timings.gpu
    {
        if !frame_span_micros.is_finite() {
            issues.push(SnapshotIssue::error(
                "invalid-json-value",
                "/timings/gpu/frameSpanMicros",
                "JSON numbers must be finite.",
            ));
        }
        for (index, node) in nodes.iter().enumerate() {
            if !node.duration_micros.is_finite() {
                issues.push(SnapshotIssue::error(
                    "invalid-json-value",
                    format!("/timings/gpu/nodes/{index}/durationMicros"),
                    "JSON numbers must be finite.",
                ));
            }
        }
    }
    issues
}

fn canonicalize_integral_numbers(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(values) => {
            values.iter_mut().for_each(canonicalize_integral_numbers);
        }
        serde_json::Value::Object(values) => {
            values.values_mut().for_each(canonicalize_integral_numbers);
        }
        serde_json::Value::Number(number) => {
            if let Some(value) = number.as_f64()
                && value.is_finite()
                && value.fract() == 0.0
            {
                if value >= 0.0 && value <= u64::MAX as f64 {
                    *number = serde_json::Number::from(value as u64);
                } else if value >= i64::MIN as f64 && value <= i64::MAX as f64 {
                    *number = serde_json::Number::from(value as i64);
                }
            }
        }
        _ => {}
    }
}
