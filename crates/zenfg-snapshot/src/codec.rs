use serde_json::{Map, Value, json};

use crate::{
    FRAME_GRAPH_SNAPSHOT_FORMAT, FRAME_GRAPH_SNAPSHOT_VERSION, FrameGraphSnapshotV1,
    LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT, SnapshotDecodeError, SnapshotDecodeResult,
    SnapshotDecodeSource, SnapshotIssue, validate_frame_graph_snapshot,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const NODE_KINDS: &[&str] = &[
    "render",
    "compute",
    "copy",
    "clear-buffer",
    "command",
    "external-submission",
];
const RESOURCE_KINDS: &[&str] = &["texture", "buffer"];
const RESOURCE_ORIGINS: &[&str] = &["transient", "imported", "swapchain", "surface"];
const ACCESS_KINDS: &[&str] = &[
    "texture-sampled",
    "texture-storage-read",
    "texture-storage-write",
    "texture-color-attachment-write",
    "texture-depth-read",
    "texture-depth-write",
    "texture-copy-src",
    "texture-copy-dst",
    "buffer-uniform",
    "buffer-storage-read",
    "buffer-storage-write",
    "buffer-vertex",
    "buffer-index",
    "buffer-indirect",
    "buffer-copy-src",
    "buffer-copy-dst",
];
const ROOT_REASONS: &[&str] = &[
    "present",
    "output",
    "readback",
    "side-effect",
    "debug-capture",
];

/// Parses, migrates when necessary, and validates a Snapshot JSON document.
///
/// Canonical ZenFG V1, the historical unversioned Legacy V0 shape, and the
/// pre-release Legacy Candidate V1 format are accepted. Successful legacy decodes return
/// a canonical [`FrameGraphSnapshotV1`] with migration provenance and warning
/// issues in [`SnapshotDecodeResult::issues`]. Invalid JSON, unknown formats or
/// versions, and schema/semantic validation failures return a
/// [`SnapshotDecodeError`].
pub fn parse_frame_graph_snapshot(text: &str) -> Result<SnapshotDecodeResult, SnapshotDecodeError> {
    let value = serde_json::from_str(text).map_err(|_| {
        SnapshotDecodeError::new(vec![SnapshotIssue::error(
            "invalid-json",
            "",
            "Invalid JSON.",
        )])
    })?;
    decode_frame_graph_snapshot(value)
}

/// Migrates when necessary, validates, and deserializes an arbitrary JSON value.
///
/// Use this when JSON parsing is already owned by the caller. Accepted formats
/// and result semantics are the same as [`parse_frame_graph_snapshot`]. The
/// input value is consumed so migration can avoid an unnecessary deep clone.
pub fn decode_frame_graph_snapshot(
    value: Value,
) -> Result<SnapshotDecodeResult, SnapshotDecodeError> {
    if is_legacy_v0(&value) {
        let migrated = migrate_legacy_v0(&value)?;
        return finish(
            migrated,
            SnapshotDecodeSource::LegacyV0,
            true,
            vec![SnapshotIssue::warning(
                "legacy-v0-migrated",
                "",
                "The unversioned debug capture was migrated to FrameGraph Snapshot 1.0.",
            )],
        );
    }
    let Some(root) = value.as_object() else {
        return failure(
            "unsupported-format",
            "/format",
            format!("Expected FrameGraph Snapshot format \"{FRAME_GRAPH_SNAPSHOT_FORMAT}\"."),
        );
    };
    match root.get("format").and_then(Value::as_str) {
        Some(LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT) => {
            check_version(root)?;
            finish(
                migrate_legacy_candidate_v1(value),
                SnapshotDecodeSource::LegacyCandidateV1,
                true,
                vec![SnapshotIssue::warning(
                    "legacy-candidate-v1-migrated",
                    "",
                    "Legacy Candidate V1 was migrated to ZenFG Snapshot 1.0.",
                )],
            )
        }
        Some(FRAME_GRAPH_SNAPSHOT_FORMAT) => {
            check_version(root)?;
            finish(value, SnapshotDecodeSource::V1, false, vec![])
        }
        _ => failure(
            "unsupported-format",
            "/format",
            format!("Expected FrameGraph Snapshot format \"{FRAME_GRAPH_SNAPSHOT_FORMAT}\"."),
        ),
    }
}

fn finish(
    mut value: Value,
    source: SnapshotDecodeSource,
    migrated: bool,
    warnings: Vec<SnapshotIssue>,
) -> Result<SnapshotDecodeResult, SnapshotDecodeError> {
    let issues = validate_frame_graph_snapshot(&value);
    if !issues.is_empty() {
        return Err(SnapshotDecodeError::new(issues));
    }
    canonicalize_integral_numbers(&mut value);
    let snapshot = serde_json::from_value::<FrameGraphSnapshotV1>(value).map_err(|source| {
        SnapshotDecodeError::new(vec![SnapshotIssue::error(
            "invalid-structure",
            "",
            source.to_string(),
        )])
    })?;
    Ok(SnapshotDecodeResult {
        snapshot,
        source,
        migrated,
        issues: warnings,
    })
}

fn check_version(root: &Map<String, Value>) -> Result<(), SnapshotDecodeError> {
    let version = root.get("version").and_then(Value::as_object);
    let major = version.and_then(|value| numeric_safe_integer(value.get("major")));
    let minor = version.and_then(|value| numeric_safe_integer(value.get("minor")));
    if major == Some(FRAME_GRAPH_SNAPSHOT_VERSION.major.into())
        && minor == Some(FRAME_GRAPH_SNAPSHOT_VERSION.minor.into())
    {
        return Ok(());
    }
    let actual = match (
        version.and_then(|value| value.get("major")),
        version.and_then(|value| value.get("minor")),
    ) {
        (Some(major), Some(minor)) => format!("{major}.{minor}"),
        _ => "missing".into(),
    };
    failure(
        "unsupported-version",
        "/version",
        format!("Snapshot version {actual} is not supported; this Viewer supports 1.0."),
    )
}

fn migrate_legacy_candidate_v1(mut value: Value) -> Value {
    let root = value.as_object_mut().expect("checked object");
    root.insert(
        "format".into(),
        Value::String(FRAME_GRAPH_SNAPSHOT_FORMAT.into()),
    );
    if let Some(capture) = root.get_mut("capture").and_then(Value::as_object_mut) {
        capture.insert(
            "migration".into(),
            json!({ "sourceFormat": "legacy-candidate-v1", "unavailableFacts": [] }),
        );
    }
    if let Some(resources) = root
        .get_mut("graph")
        .and_then(Value::as_object_mut)
        .and_then(|graph| graph.get_mut("resources"))
        .and_then(Value::as_array_mut)
    {
        for resource in resources {
            let Some(resource) = resource.as_object_mut() else {
                continue;
            };
            match resource.get("origin").and_then(Value::as_str) {
                Some("transient" | "surface") => {
                    resource.insert("initialContents".into(), Value::String("undefined".into()));
                }
                Some("imported") => {
                    resource.remove("initialContents");
                }
                _ => {}
            }
        }
    }
    value
}

fn is_legacy_v0(value: &Value) -> bool {
    value.as_object().is_some_and(|root| {
        !root.contains_key("format")
            && ["compilation", "gpuTiming", "resourcePool"]
                .iter()
                .any(|key| root.contains_key(*key))
    })
}

fn migrate_legacy_v0(value: &Value) -> Result<Value, SnapshotDecodeError> {
    let root = value.as_object().expect("legacy object");
    let mut legacy = Legacy::default();
    let compilation = legacy.required_record(root.get("compilation"), "/compilation");
    let timing = legacy.required_record(root.get("gpuTiming"), "/gpuTiming");
    let pool = legacy.required_record(root.get("resourcePool"), "/resourcePool");
    let (Some(compilation), Some(timing), Some(pool)) = (compilation, timing, pool) else {
        return Err(SnapshotDecodeError::new(legacy.issues));
    };

    let retained = legacy.record_array(compilation.get("nodes"), "/compilation/nodes");
    let culled = legacy.record_array(compilation.get("culledNodes"), "/compilation/culledNodes");
    let resources = legacy.record_array(compilation.get("resources"), "/compilation/resources");
    let groups_available = compilation.contains_key("debugGroups");
    let groups = if groups_available {
        legacy.record_array(compilation.get("debugGroups"), "/compilation/debugGroups")
    } else {
        vec![]
    };
    let accesses = legacy.record_array(compilation.get("accesses"), "/compilation/accesses");
    let dependencies =
        legacy.record_array(compilation.get("dependencies"), "/compilation/dependencies");
    let roots = legacy.record_array(compilation.get("roots"), "/compilation/roots");
    let allocations =
        legacy.record_array(compilation.get("allocations"), "/compilation/allocations");
    let segments = legacy.record_array(
        compilation.get("executionSegments"),
        "/compilation/executionSegments",
    );

    let mut execution_order = std::collections::HashMap::new();
    for (index, node) in retained.iter().enumerate() {
        if let Some(id) =
            legacy.required_safe_integer(node.get("id"), &format!("/compilation/nodes/{index}/id"))
        {
            execution_order.insert(id, index as u64);
        }
    }
    let mut mapped_nodes = Vec::new();
    for (index, node) in retained.iter().chain(culled.iter()).enumerate() {
        let retained_node = index < retained.len();
        let source_index = if retained_node {
            index
        } else {
            index - retained.len()
        };
        let path = if retained_node {
            format!("/compilation/nodes/{source_index}")
        } else {
            format!("/compilation/culledNodes/{source_index}")
        };
        let id = legacy.required_safe_integer(node.get("id"), &format!("{path}/id"));
        let kind = legacy
            .required_enum(node.get("kind"), NODE_KINDS, &format!("{path}/kind"))
            .map(str::to_owned);
        let side_effect =
            legacy.required_bool(node.get("sideEffect"), &format!("{path}/sideEffect"));
        let label = legacy.optional_string(node.get("label"), &format!("{path}/label"));
        let group =
            legacy.optional_safe_integer(node.get("debugGroupId"), &format!("{path}/debugGroupId"));
        let reason = if retained_node {
            None
        } else {
            legacy.optional_non_empty_string(node.get("reason"), &format!("{path}/reason"))
        };
        let (Some(id), Some(kind), Some(side_effect)) = (id, kind, side_effect) else {
            continue;
        };
        let mut output =
            json!({ "id": prefixed("node", id), "kind": kind, "sideEffect": side_effect });
        let record = output.as_object_mut().unwrap();
        insert_optional_string(record, "label", label);
        if groups_available && let Some(group) = group {
            record.insert("groupId".into(), Value::String(prefixed("group", group)));
        }
        let state = execution_order.get(&id).map_or_else(
            || json!({ "status": "culled", "reason": reason.unwrap_or_else(|| "not-reachable-from-root".into()) }),
            |order| json!({ "status": "retained", "executionOrder": order }),
        );
        record.insert("compileState".into(), state);
        mapped_nodes.push(output);
    }

    let mut mapped_resources = Vec::new();
    for (index, resource) in resources.iter().enumerate() {
        let path = format!("/compilation/resources/{index}");
        let id = legacy.required_safe_integer(resource.get("id"), &format!("{path}/id"));
        let kind = legacy
            .required_enum(
                resource.get("kind"),
                RESOURCE_KINDS,
                &format!("{path}/kind"),
            )
            .map(str::to_owned);
        let origin = legacy
            .required_enum(
                resource.get("origin"),
                RESOURCE_ORIGINS,
                &format!("{path}/origin"),
            )
            .map(str::to_owned);
        let usage = legacy.required_u32(resource.get("usage"), &format!("{path}/usage"));
        let label = legacy.optional_string(resource.get("label"), &format!("{path}/label"));
        let group = legacy.optional_safe_integer(
            resource.get("debugGroupId"),
            &format!("{path}/debugGroupId"),
        );
        let allocation = legacy.optional_safe_integer(
            resource.get("physicalAllocationId"),
            &format!("{path}/physicalAllocationId"),
        );
        let estimated = legacy.optional_safe_integer(
            resource.get("estimatedByteSize"),
            &format!("{path}/estimatedByteSize"),
        );
        let lifetime =
            legacy.migrate_lifetime(resource.get("lifetime"), &format!("{path}/lifetime"));
        let (Some(id), Some(kind), Some(origin), Some(usage)) = (id, kind, origin, usage) else {
            continue;
        };
        let descriptor = legacy.migrate_descriptor(
            &kind,
            resource.get("descriptor"),
            &format!("{path}/descriptor"),
        );
        let usage_flags = legacy.decode_usage(&kind, usage, &format!("{path}/usage"));
        let canonical_origin = if origin == "swapchain" {
            "surface"
        } else {
            &origin
        };
        let mut output = json!({ "id": prefixed("resource", id), "kind": kind, "origin": canonical_origin, "usageFlags": usage_flags });
        let record = output.as_object_mut().unwrap();
        insert_optional_string(record, "label", label);
        if origin == "transient" || origin == "swapchain" {
            record.insert("initialContents".into(), Value::String("undefined".into()));
        }
        if groups_available && let Some(group) = group {
            record.insert("groupId".into(), Value::String(prefixed("group", group)));
        }
        if let Some(lifetime) = lifetime {
            record.insert("lifetime".into(), lifetime);
        }
        if let Some(allocation) = allocation {
            record.insert(
                "allocationId".into(),
                Value::String(prefixed("allocation", allocation)),
            );
        }
        if let Some(estimated) = estimated {
            record.insert("estimatedByteSize".into(), Value::from(estimated));
        }
        if let Some(descriptor) = descriptor {
            record.insert("descriptor".into(), descriptor);
        }
        mapped_resources.push(output);
    }

    let mut mapped_accesses = Vec::new();
    for (index, access) in accesses.iter().enumerate() {
        let path = format!("/compilation/accesses/{index}");
        let id = legacy.required_safe_integer(access.get("id"), &format!("{path}/id"));
        let node = legacy.required_safe_integer(access.get("nodeId"), &format!("{path}/nodeId"));
        let resource =
            legacy.required_safe_integer(access.get("resourceId"), &format!("{path}/resourceId"));
        let kind = legacy
            .required_enum(
                access.get("access"),
                ACCESS_KINDS,
                &format!("{path}/access"),
            )
            .map(str::to_owned);
        let mode = legacy
            .required_enum(
                access.get("mode"),
                &["read", "write"],
                &format!("{path}/mode"),
            )
            .map(str::to_owned);
        let produces_value = legacy.required_bool(
            access.get("producesValue"),
            &format!("{path}/producesValue"),
        );
        legacy.optional_safe_integer(
            access.get("textureViewId"),
            &format!("{path}/textureViewId"),
        );
        let texture_region = legacy.migrate_texture_region(
            access.get("textureRegion"),
            &format!("{path}/textureRegion"),
        );
        let buffer_range =
            legacy.migrate_buffer_range(access.get("bufferRange"), &format!("{path}/bufferRange"));
        let (Some(id), Some(node), Some(resource), Some(kind), Some(mode), Some(produces_value)) =
            (id, node, resource, kind, mode, produces_value)
        else {
            continue;
        };
        let mut output = json!({
            "id": prefixed("access", id), "nodeId": prefixed("node", node),
            "resourceId": prefixed("resource", resource), "access": kind, "mode": mode,
            "producesValue": if mode == "read" { false } else { produces_value },
        });
        let record = output.as_object_mut().unwrap();
        if let Some(region) = texture_region {
            record.insert("textureRegion".into(), region);
        }
        if let Some(range) = buffer_range {
            record.insert("bufferRange".into(), range);
        }
        if mode == "read" {
            if access.contains_key("contents") {
                legacy.push(
                    "legacy-access-contents",
                    format!("{path}/contents"),
                    "Legacy read access cannot declare contents.",
                );
            }
            if produces_value {
                legacy.push(
                    "legacy-access-value",
                    format!("{path}/producesValue"),
                    "Legacy read access must set producesValue to false.",
                );
            }
        } else if let Some(contents) = legacy.required_enum(
            access.get("contents"),
            &["overwrite", "preserve"],
            &format!("{path}/contents"),
        ) {
            record.insert("contents".into(), Value::String(contents.into()));
        } else {
            continue;
        }
        mapped_accesses.push(output);
    }

    let mut mapped_groups = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let path = format!("/compilation/debugGroups/{index}");
        let id = legacy.required_safe_integer(group.get("id"), &format!("{path}/id"));
        let parent =
            legacy.optional_safe_integer(group.get("parentId"), &format!("{path}/parentId"));
        let label = legacy.required_non_empty_string(group.get("label"), &format!("{path}/label"));
        let (Some(id), Some(label)) = (id, label) else {
            continue;
        };
        let mut output = json!({ "id": prefixed("group", id), "label": label });
        if let Some(parent) = parent {
            output
                .as_object_mut()
                .unwrap()
                .insert("parentId".into(), Value::String(prefixed("group", parent)));
        }
        mapped_groups.push(output);
    }

    let mut mapped_dependencies = Vec::new();
    for (index, dependency) in dependencies.iter().enumerate() {
        let path = format!("/compilation/dependencies/{index}");
        let from = legacy
            .required_safe_integer(dependency.get("fromNodeId"), &format!("{path}/fromNodeId"));
        let to =
            legacy.required_safe_integer(dependency.get("toNodeId"), &format!("{path}/toNodeId"));
        let resource = legacy
            .required_safe_integer(dependency.get("resourceId"), &format!("{path}/resourceId"));
        let kind = legacy
            .required_enum(
                dependency.get("kind"),
                &["value", "ordering"],
                &format!("{path}/kind"),
            )
            .map(str::to_owned);
        if let (Some(from), Some(to), Some(resource), Some(kind)) = (from, to, resource, kind) {
            mapped_dependencies.push(json!({ "fromNodeId": prefixed("node", from), "toNodeId": prefixed("node", to), "resourceId": prefixed("resource", resource), "kind": kind }));
        }
    }

    let mut mapped_roots = Vec::new();
    for (index, root) in roots.iter().enumerate() {
        let path = format!("/compilation/roots/{index}");
        let reason = legacy
            .required_enum(root.get("reason"), ROOT_REASONS, &format!("{path}/reason"))
            .map(str::to_owned);
        let node = legacy.optional_safe_integer(root.get("nodeId"), &format!("{path}/nodeId"));
        let resource =
            legacy.optional_safe_integer(root.get("resourceId"), &format!("{path}/resourceId"));
        if node.is_some() == resource.is_some() {
            legacy.push(
                "legacy-root",
                &path,
                "Legacy root must reference exactly one node or resource.",
            );
        }
        let Some(reason) = reason else { continue };
        if node.is_some() == resource.is_some() {
            continue;
        }
        let mut output = json!({ "reason": reason });
        if let Some(node) = node {
            output
                .as_object_mut()
                .unwrap()
                .insert("nodeId".into(), Value::String(prefixed("node", node)));
        }
        if let Some(resource) = resource {
            output.as_object_mut().unwrap().insert(
                "resourceId".into(),
                Value::String(prefixed("resource", resource)),
            );
        }
        mapped_roots.push(output);
    }

    let mut mapped_allocations = Vec::new();
    for (index, allocation) in allocations.iter().enumerate() {
        let path = format!("/compilation/allocations/{index}");
        let id = legacy.required_safe_integer(allocation.get("id"), &format!("{path}/id"));
        let kind = legacy
            .required_enum(
                allocation.get("kind"),
                RESOURCE_KINDS,
                &format!("{path}/kind"),
            )
            .map(str::to_owned);
        let compatibility = legacy.required_safe_integer(
            allocation.get("compatibilityClassId"),
            &format!("{path}/compatibilityClassId"),
        );
        let estimated = legacy.optional_safe_integer(
            allocation.get("estimatedByteSize"),
            &format!("{path}/estimatedByteSize"),
        );
        let (Some(id), Some(kind), Some(compatibility)) = (id, kind, compatibility) else {
            continue;
        };
        let mut output = json!({ "id": prefixed("allocation", id), "kind": kind, "compatibilityClassId": prefixed("compatibility", compatibility) });
        if let Some(estimated) = estimated {
            output
                .as_object_mut()
                .unwrap()
                .insert("estimatedByteSize".into(), Value::from(estimated));
        }
        mapped_allocations.push(output);
    }

    let mut mapped_segments = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let path = format!("/compilation/executionSegments/{index}");
        let order = legacy.required_safe_integer(segment.get("index"), &format!("{path}/index"));
        let kind = legacy
            .required_enum(
                segment.get("kind"),
                &["frame-graph", "external-submission"],
                &format!("{path}/kind"),
            )
            .map(str::to_owned);
        let ids = legacy.safe_integer_array(segment.get("nodeIds"), &format!("{path}/nodeIds"));
        if let (Some(order), Some(kind), Some(ids)) = (order, kind, ids) {
            mapped_segments.push(json!({ "id": prefixed("segment", order), "order": order, "kind": kind, "nodeIds": ids.into_iter().map(|id| Value::String(prefixed("node", id))).collect::<Vec<_>>() }));
        }
    }

    let frame_index =
        legacy.required_safe_integer(timing.get("frameIndex"), "/gpuTiming/frameIndex");
    let timing_status = legacy
        .required_enum(
            timing.get("status"),
            &["available", "unavailable"],
            "/gpuTiming/status",
        )
        .map(str::to_owned);
    let gpu = match timing_status.as_deref() {
        Some("available") => {
            let span = legacy.required_finite_number(
                timing.get("frameDurationMicros"),
                "/gpuTiming/frameDurationMicros",
            );
            let timing_nodes = legacy.record_array(timing.get("nodes"), "/gpuTiming/nodes");
            let mut mapped = Vec::new();
            for (index, node) in timing_nodes.iter().enumerate() {
                let path = format!("/gpuTiming/nodes/{index}");
                let id =
                    legacy.required_safe_integer(node.get("nodeId"), &format!("{path}/nodeId"));
                let duration = legacy.required_finite_number(
                    node.get("durationMicros"),
                    &format!("{path}/durationMicros"),
                );
                if node.contains_key("kind") {
                    legacy.required_non_empty_string(node.get("kind"), &format!("{path}/kind"));
                }
                if let (Some(id), Some(duration)) = (id, duration) {
                    mapped.push(
                        json!({ "nodeId": prefixed("node", id), "durationMicros": duration }),
                    );
                }
            }
            span.map(
                |span| json!({ "status": "available", "frameSpanMicros": span, "nodes": mapped }),
            )
        }
        Some("unavailable") => legacy
            .required_non_empty_string(timing.get("reason"), "/gpuTiming/reason")
            .map(|reason| json!({ "status": "unavailable", "reason": reason })),
        _ => None,
    };

    let acquire =
        legacy.required_safe_integer(pool.get("acquireCount"), "/resourcePool/acquireCount");
    let reuse = legacy.required_safe_integer(pool.get("reuseCount"), "/resourcePool/reuseCount");
    let created =
        legacy.required_safe_integer(pool.get("createdCount"), "/resourcePool/createdCount");
    let retained_count =
        legacy.required_safe_integer(pool.get("retainedCount"), "/resourcePool/retainedCount");
    let estimated_retained = legacy.optional_safe_integer(
        pool.get("estimatedRetainedBytes"),
        "/resourcePool/estimatedRetainedBytes",
    );

    if !legacy.issues.is_empty()
        || frame_index.is_none()
        || gpu.is_none()
        || acquire.is_none()
        || reuse.is_none()
        || created.is_none()
        || retained_count.is_none()
    {
        return Err(SnapshotDecodeError::new(legacy.issues));
    }
    let mut unavailable = vec![
        Value::String("graph.textureViews".into()),
        Value::String("graph.nodes.recordingOrder".into()),
    ];
    if !groups_available {
        unavailable.insert(0, Value::String("graph.groups".into()));
    }
    if mapped_accesses.iter().any(|access| {
        let access = access.as_object().unwrap();
        if access
            .get("access")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind.starts_with("texture-"))
        {
            !access.contains_key("textureRegion")
        } else {
            !access.contains_key("bufferRange")
        }
    }) {
        unavailable.push(Value::String("graph.accesses.regions".into()));
    }
    let mut pool_report = json!({
        "status": "available", "acquireCount": acquire.unwrap(), "reuseCount": reuse.unwrap(),
        "createdCount": created.unwrap(), "retainedCount": retained_count.unwrap(),
    });
    if let Some(estimated) = estimated_retained {
        pool_report
            .as_object_mut()
            .unwrap()
            .insert("estimatedRetainedBytes".into(), Value::from(estimated));
    }
    Ok(json!({
        "format": FRAME_GRAPH_SNAPSHOT_FORMAT, "version": { "major": 1, "minor": 0 },
        "producer": { "name": "legacy-unversioned" },
        "capture": { "frameIndex": frame_index.unwrap(), "migration": { "sourceFormat": "legacy-v0", "unavailableFacts": unavailable } },
        "graph": { "groups": mapped_groups, "nodes": mapped_nodes, "resources": mapped_resources, "textureViews": [], "accesses": mapped_accesses, "dependencies": mapped_dependencies, "roots": mapped_roots, "segments": mapped_segments },
        "memory": { "allocationReport": { "status": "available", "allocations": mapped_allocations }, "poolReport": pool_report },
        "timings": { "gpu": gpu.unwrap() }, "diagnostics": [], "extensions": {},
    }))
}

#[derive(Default)]
struct Legacy {
    issues: Vec<SnapshotIssue>,
}

impl Legacy {
    fn push(
        &mut self,
        code: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.issues.push(SnapshotIssue::error(code, path, message));
    }

    fn required_record<'a>(
        &mut self,
        value: Option<&'a Value>,
        path: &str,
    ) -> Option<&'a Map<String, Value>> {
        let result = value.and_then(Value::as_object);
        if result.is_none() {
            self.push("legacy-structure", path, "Expected an object.");
        }
        result
    }

    fn record_array<'a>(
        &mut self,
        value: Option<&'a Value>,
        path: &str,
    ) -> Vec<&'a Map<String, Value>> {
        let Some(values) = value.and_then(Value::as_array) else {
            self.push("legacy-structure", path, "Expected an array.");
            return vec![];
        };
        values
            .iter()
            .enumerate()
            .filter_map(|(index, value)| {
                let result = value.as_object();
                if result.is_none() {
                    self.push(
                        "legacy-structure",
                        format!("{path}/{index}"),
                        "Expected an object.",
                    );
                }
                result
            })
            .collect()
    }

    fn safe_integer_array(&mut self, value: Option<&Value>, path: &str) -> Option<Vec<u64>> {
        let Some(values) = value.and_then(Value::as_array) else {
            self.push("legacy-structure", path, "Expected an array.");
            return None;
        };
        let mut result = Vec::new();
        for (index, value) in values.iter().enumerate() {
            if let Some(value) = self.required_safe_integer(Some(value), &format!("{path}/{index}"))
            {
                result.push(value);
            }
        }
        Some(result)
    }

    fn non_empty_string_array(&mut self, value: Option<&Value>, path: &str) -> Option<Vec<Value>> {
        let Some(values) = value.and_then(Value::as_array) else {
            self.push("legacy-structure", path, "Expected an array.");
            return None;
        };
        let mut result = Vec::new();
        for (index, value) in values.iter().enumerate() {
            if let Some(value) =
                self.required_non_empty_string(Some(value), &format!("{path}/{index}"))
            {
                result.push(Value::String(value));
            }
        }
        Some(result)
    }

    fn required_safe_integer(&mut self, value: Option<&Value>, path: &str) -> Option<u64> {
        let result = numeric_safe_integer(value);
        if result.is_none() {
            self.push(
                "legacy-number",
                path,
                "Expected a non-negative safe integer.",
            );
        }
        result
    }

    fn required_u32(&mut self, value: Option<&Value>, path: &str) -> Option<u64> {
        let result = self.required_safe_integer(value, path);
        if result.is_some_and(|value| value > u32::MAX.into()) {
            self.push(
                "legacy-number",
                path,
                "Expected an unsigned 32-bit integer.",
            );
            None
        } else {
            result
        }
    }

    fn required_positive_safe_integer(&mut self, value: Option<&Value>, path: &str) -> Option<u64> {
        let result = self.required_safe_integer(value, path);
        if result == Some(0) {
            self.push("legacy-number", path, "Expected a positive safe integer.");
            None
        } else {
            result
        }
    }

    fn optional_safe_integer(&mut self, value: Option<&Value>, path: &str) -> Option<u64> {
        value.and_then(|value| self.required_safe_integer(Some(value), path))
    }

    fn optional_positive_safe_integer(&mut self, value: Option<&Value>, path: &str) -> Option<u64> {
        value.and_then(|value| self.required_positive_safe_integer(Some(value), path))
    }

    fn required_finite_number(&mut self, value: Option<&Value>, path: &str) -> Option<f64> {
        let result = value
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0);
        if result.is_none() {
            self.push(
                "legacy-number",
                path,
                "Expected a finite non-negative number.",
            );
        }
        result
    }

    fn required_non_empty_string(&mut self, value: Option<&Value>, path: &str) -> Option<String> {
        let result = value
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if result.is_none() {
            self.push("legacy-string", path, "Expected a non-empty string.");
        }
        result
    }

    fn optional_string(&mut self, value: Option<&Value>, path: &str) -> Option<String> {
        let value = value?;
        let result = value.as_str().map(str::to_owned);
        if result.is_none() {
            self.push("legacy-string", path, "Expected a string.");
        }
        result
    }

    fn optional_non_empty_string(&mut self, value: Option<&Value>, path: &str) -> Option<String> {
        value.and_then(|value| self.required_non_empty_string(Some(value), path))
    }

    fn required_bool(&mut self, value: Option<&Value>, path: &str) -> Option<bool> {
        let result = value.and_then(Value::as_bool);
        if result.is_none() {
            self.push("legacy-boolean", path, "Expected a boolean.");
        }
        result
    }

    fn required_enum<'a>(
        &mut self,
        value: Option<&'a Value>,
        allowed: &[&str],
        path: &str,
    ) -> Option<&'a str> {
        let result = value
            .and_then(Value::as_str)
            .filter(|value| allowed.contains(value));
        if result.is_none() {
            self.push(
                "legacy-enum",
                path,
                format!("Expected one of: {}.", allowed.join(", ")),
            );
        }
        result
    }

    fn migrate_descriptor(
        &mut self,
        kind: &str,
        value: Option<&Value>,
        path: &str,
    ) -> Option<Value> {
        let value = value?;
        let descriptor = self.required_record(Some(value), path)?;
        if kind == "buffer" {
            return self
                .required_safe_integer(descriptor.get("size"), &format!("{path}/size"))
                .map(|size| json!({ "kind": "buffer", "size": size }));
        }
        let format =
            self.required_non_empty_string(descriptor.get("format"), &format!("{path}/format"));
        let size = self.required_record(descriptor.get("size"), &format!("{path}/size"));
        let width = size.and_then(|size| {
            self.required_positive_safe_integer(size.get("width"), &format!("{path}/size/width"))
        });
        let height = size.and_then(|size| {
            self.required_positive_safe_integer(size.get("height"), &format!("{path}/size/height"))
        });
        let depth = size.and_then(|size| {
            self.required_positive_safe_integer(
                size.get("depthOrArrayLayers"),
                &format!("{path}/size/depthOrArrayLayers"),
            )
        });
        let dimension = self
            .required_non_empty_string(descriptor.get("dimension"), &format!("{path}/dimension"));
        let mip_count = self.required_positive_safe_integer(
            descriptor.get("mipLevelCount"),
            &format!("{path}/mipLevelCount"),
        );
        let sample_count = self.required_positive_safe_integer(
            descriptor.get("sampleCount"),
            &format!("{path}/sampleCount"),
        );
        let view_formats = self.non_empty_string_array(
            descriptor.get("viewFormats"),
            &format!("{path}/viewFormats"),
        );
        match (
            format,
            width,
            height,
            depth,
            dimension,
            mip_count,
            sample_count,
            view_formats,
        ) {
            (
                Some(format),
                Some(width),
                Some(height),
                Some(depth),
                Some(dimension),
                Some(mip_count),
                Some(sample_count),
                Some(view_formats),
            ) => Some(json!({
                "kind": "texture", "format": format, "size": { "width": width, "height": height, "depthOrArrayLayers": depth },
                "dimension": dimension, "mipLevelCount": mip_count, "sampleCount": sample_count, "viewFormats": view_formats,
            })),
            _ => None,
        }
    }

    fn migrate_lifetime(&mut self, value: Option<&Value>, path: &str) -> Option<Value> {
        let value = value?;
        let lifetime = self.required_record(Some(value), path)?;
        let first =
            self.required_safe_integer(lifetime.get("firstUse"), &format!("{path}/firstUse"));
        let last = self.required_safe_integer(lifetime.get("lastUse"), &format!("{path}/lastUse"));
        first
            .zip(last)
            .map(|(first, last)| json!({ "firstUse": first, "lastUse": last }))
    }

    fn migrate_texture_region(&mut self, value: Option<&Value>, path: &str) -> Option<Value> {
        let value = value?;
        let region = self.required_record(Some(value), path)?;
        let base_mip =
            self.required_safe_integer(region.get("baseMipLevel"), &format!("{path}/baseMipLevel"));
        let mip_count = self.required_positive_safe_integer(
            region.get("mipLevelCount"),
            &format!("{path}/mipLevelCount"),
        );
        let aspect =
            self.required_non_empty_string(region.get("aspect"), &format!("{path}/aspect"));
        let base_array = self.optional_safe_integer(
            region.get("baseArrayLayer"),
            &format!("{path}/baseArrayLayer"),
        );
        let array_count = self.optional_positive_safe_integer(
            region.get("arrayLayerCount"),
            &format!("{path}/arrayLayerCount"),
        );
        let base_depth = self.optional_safe_integer(
            region.get("baseDepthSlice"),
            &format!("{path}/baseDepthSlice"),
        );
        let depth_count = self.optional_positive_safe_integer(
            region.get("depthSliceCount"),
            &format!("{path}/depthSliceCount"),
        );
        let array_present =
            region.contains_key("baseArrayLayer") || region.contains_key("arrayLayerCount");
        let depth_present =
            region.contains_key("baseDepthSlice") || region.contains_key("depthSliceCount");
        if array_present == depth_present
            || (array_present && (base_array.is_none() || array_count.is_none()))
            || (depth_present && (base_depth.is_none() || depth_count.is_none()))
        {
            self.push("legacy-texture-region", path, "Legacy texture region must contain exactly one complete array-layer or depth-slice interval.");
        }
        let (Some(base_mip), Some(mip_count), Some(aspect)) = (base_mip, mip_count, aspect) else {
            return None;
        };
        if array_present == depth_present {
            return None;
        }
        let mut output =
            json!({ "baseMipLevel": base_mip, "mipLevelCount": mip_count, "aspect": aspect });
        let record = output.as_object_mut().unwrap();
        if let Some(value) = base_array {
            record.insert("baseArrayLayer".into(), Value::from(value));
        }
        if let Some(value) = array_count {
            record.insert("arrayLayerCount".into(), Value::from(value));
        }
        if let Some(value) = base_depth {
            record.insert("baseDepthSlice".into(), Value::from(value));
        }
        if let Some(value) = depth_count {
            record.insert("depthSliceCount".into(), Value::from(value));
        }
        Some(output)
    }

    fn migrate_buffer_range(&mut self, value: Option<&Value>, path: &str) -> Option<Value> {
        let value = value?;
        let range = self.required_record(Some(value), path)?;
        let offset = self.required_safe_integer(range.get("offset"), &format!("{path}/offset"));
        let size = self.optional_safe_integer(range.get("size"), &format!("{path}/size"));
        offset.map(|offset| {
            let mut output = json!({ "offset": offset });
            if let Some(size) = size {
                output
                    .as_object_mut()
                    .unwrap()
                    .insert("size".into(), Value::from(size));
            }
            output
        })
    }

    fn decode_usage(&mut self, kind: &str, bits: u64, path: &str) -> Vec<Value> {
        let definitions: &[(u64, &str)] = if kind == "texture" {
            &[
                (1, "copy-src"),
                (2, "copy-dst"),
                (4, "texture-binding"),
                (8, "storage-binding"),
                (16, "render-attachment"),
            ]
        } else {
            &[
                (1, "map-read"),
                (2, "map-write"),
                (4, "copy-src"),
                (8, "copy-dst"),
                (16, "index"),
                (32, "vertex"),
                (64, "uniform"),
                (128, "storage"),
                (256, "indirect"),
                (512, "query-resolve"),
            ]
        };
        let known = definitions.iter().fold(0, |known, (bit, _)| known | bit);
        let unknown = bits & !known;
        if unknown != 0 {
            self.push(
                "legacy-unknown-usage",
                path,
                format!("Legacy {kind} usage contains unknown bits 0x{unknown:x}."),
            );
        }
        definitions
            .iter()
            .filter(|(bit, _)| bits & bit != 0)
            .map(|(_, name)| Value::String((*name).into()))
            .collect()
    }
}

fn insert_optional_string(target: &mut Map<String, Value>, field: &str, value: Option<String>) {
    if let Some(value) = value {
        target.insert(field.into(), Value::String(value));
    }
}

fn numeric_safe_integer(value: Option<&Value>) -> Option<u64> {
    let number = value?.as_number()?;
    if let Some(value) = number.as_u64() {
        return (value <= MAX_SAFE_INTEGER).then_some(value);
    }
    let value = number.as_f64()?;
    (value.is_finite() && value >= 0.0 && value <= MAX_SAFE_INTEGER as f64 && value.fract() == 0.0)
        .then_some(value as u64)
}

fn canonicalize_integral_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(canonicalize_integral_numbers),
        Value::Object(values) => values.values_mut().for_each(canonicalize_integral_numbers),
        Value::Number(number) => {
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

fn failure<T>(
    code: impl Into<String>,
    path: impl Into<String>,
    message: impl Into<String>,
) -> Result<T, SnapshotDecodeError> {
    Err(SnapshotDecodeError::new(vec![SnapshotIssue::error(
        code, path, message,
    )]))
}

fn prefixed(prefix: &str, value: u64) -> String {
    format!("{prefix}:{value}")
}
