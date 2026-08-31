use crate::{FrameGraphSnapshotV1, SnapshotJsonError, validate_frame_graph_snapshot};

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

fn encode(snapshot: &FrameGraphSnapshotV1, pretty: bool) -> Result<String, SnapshotJsonError> {
    let mut value = serde_json::to_value(snapshot)?;
    canonicalize_integral_numbers(&mut value);
    let issues = validate_frame_graph_snapshot(&value);
    if !issues.is_empty() {
        return Err(SnapshotJsonError::Validation { issues });
    }
    if pretty {
        serde_json::to_string_pretty(&value).map_err(Into::into)
    } else {
        serde_json::to_string(&value).map_err(Into::into)
    }
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
