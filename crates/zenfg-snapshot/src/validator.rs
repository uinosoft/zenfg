use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::{
    FRAME_GRAPH_SNAPSHOT_FORMAT, FRAME_GRAPH_SNAPSHOT_VERSION, FrameGraphSnapshotV1,
    SnapshotAccessKind, SnapshotAllocationReport, SnapshotGpuTimings, SnapshotIssue,
    SnapshotNodeCompileState, SnapshotNodeKind, SnapshotResourceKind, SnapshotSegmentKind,
    SnapshotUnavailableFact,
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
const ORIGINS: &[&str] = &["transient", "imported", "surface"];
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
const TEXTURE_USAGE: &[&str] = &[
    "copy-src",
    "copy-dst",
    "texture-binding",
    "storage-binding",
    "render-attachment",
];
const BUFFER_USAGE: &[&str] = &[
    "map-read",
    "map-write",
    "copy-src",
    "copy-dst",
    "index",
    "vertex",
    "uniform",
    "storage",
    "indirect",
    "query-resolve",
];
const ROOT_REASONS: &[&str] = &[
    "present",
    "output",
    "readback",
    "side-effect",
    "debug-capture",
    "persistent-state",
];
const UNAVAILABLE_FACTS: &[&str] = &[
    "graph.groups",
    "graph.textureViews",
    "graph.nodes.recordingOrder",
    "graph.accesses.regions",
];

/// Validates an arbitrary JSON value against Snapshot 1.0.
///
/// The validator checks the wire shape as well as cross-record invariants such
/// as unique IDs, references, resource/access compatibility, retained state,
/// migration availability, and JavaScript-safe integers. It accumulates issues
/// where possible instead of stopping at the first failure. An empty vector
/// means the value can be decoded as canonical ZenFG V1.
///
/// This function does not migrate legacy formats. Use
/// [`crate::decode_frame_graph_snapshot`] when migration is desired.
pub fn validate_frame_graph_snapshot(value: &Value) -> Vec<SnapshotIssue> {
    let mut issues = Vec::new();
    let Some(root) = record(Some(value), "", &mut issues) else {
        return issues;
    };
    keys(
        root,
        "",
        &[
            "format",
            "version",
            "producer",
            "capture",
            "graph",
            "memory",
            "timings",
            "diagnostics",
            "extensions",
        ],
        &[],
        &mut issues,
    );
    literal_string(
        root.get("format"),
        FRAME_GRAPH_SNAPSHOT_FORMAT,
        "/format",
        &mut issues,
    );
    if let Some(version) = record(root.get("version"), "/version", &mut issues) {
        keys(version, "/version", &["major", "minor"], &[], &mut issues);
        literal_u64(
            version.get("major"),
            FRAME_GRAPH_SNAPSHOT_VERSION.major.into(),
            "/version/major",
            &mut issues,
        );
        literal_u64(
            version.get("minor"),
            FRAME_GRAPH_SNAPSHOT_VERSION.minor.into(),
            "/version/minor",
            &mut issues,
        );
    }
    validate_producer(root.get("producer"), &mut issues);
    validate_capture(root.get("capture"), &mut issues);
    let graph = validate_graph(root.get("graph"), &mut issues);
    let memory = validate_memory(root.get("memory"), &mut issues);
    let timings = validate_timings(root.get("timings"), &mut issues);
    validate_diagnostics(root.get("diagnostics"), &mut issues);
    validate_extensions(root.get("extensions"), &mut issues);
    if graph && memory && timings && issues.is_empty() {
        let mut canonical = value.clone();
        canonicalize_integral_numbers(&mut canonical);
        match serde_json::from_value::<FrameGraphSnapshotV1>(canonical) {
            Ok(snapshot) => validate_references(&snapshot, &mut issues),
            Err(source) => issues.push(error("invalid-structure", "", source.to_string())),
        }
    }
    issues
}

fn validate_producer(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) {
    let Some(producer) = record(value, "/producer", issues) else {
        return;
    };
    keys(
        producer,
        "/producer",
        &["name"],
        &["version", "language", "runtime"],
        issues,
    );
    non_empty_string(producer.get("name"), "/producer/name", issues);
    optional_non_empty_string(producer.get("version"), "/producer/version", issues);
    optional_non_empty_string(producer.get("language"), "/producer/language", issues);
    if let Some(value) = producer.get("runtime")
        && let Some(runtime) = record(Some(value), "/producer/runtime", issues)
    {
        keys(
            runtime,
            "/producer/runtime",
            &[],
            &["implementation", "graphicsApi", "backend"],
            issues,
        );
        optional_non_empty_string(
            runtime.get("implementation"),
            "/producer/runtime/implementation",
            issues,
        );
        optional_non_empty_string(
            runtime.get("graphicsApi"),
            "/producer/runtime/graphicsApi",
            issues,
        );
        optional_non_empty_string(runtime.get("backend"), "/producer/runtime/backend", issues);
    }
}

fn validate_capture(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) {
    let Some(capture) = record(value, "/capture", issues) else {
        return;
    };
    keys(
        capture,
        "/capture",
        &["frameIndex"],
        &["capturedAt", "migration"],
        issues,
    );
    safe_integer(capture.get("frameIndex"), "/capture/frameIndex", issues);
    optional_string(capture.get("capturedAt"), "/capture/capturedAt", issues);
    if let Some(value) = capture.get("migration")
        && let Some(migration) = record(Some(value), "/capture/migration", issues)
    {
        keys(
            migration,
            "/capture/migration",
            &["sourceFormat", "unavailableFacts"],
            &[],
            issues,
        );
        enum_value(
            migration.get("sourceFormat"),
            &["legacy-v0", "t3d-v1"],
            "/capture/migration/sourceFormat",
            issues,
        );
        string_array(
            migration.get("unavailableFacts"),
            "/capture/migration/unavailableFacts",
            issues,
            false,
            Some(UNAVAILABLE_FACTS),
            None,
            false,
        );
    }
}

fn validate_graph(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) -> bool {
    let Some(graph) = record(value, "/graph", issues) else {
        return false;
    };
    let names = [
        "groups",
        "nodes",
        "resources",
        "textureViews",
        "accesses",
        "dependencies",
        "roots",
        "segments",
    ];
    keys(graph, "/graph", &names, &[], issues);
    for name in names {
        array(graph.get(name), &format!("/graph/{name}"), issues);
    }

    for_each_record(
        graph.get("groups"),
        "/graph/groups",
        issues,
        |group, path, issues| {
            keys(
                group,
                path,
                &["id", "label"],
                &["parentId", "stableKey"],
                issues,
            );
            entity_id(
                group.get("id"),
                &format!("{path}/id"),
                issues,
                Some("group"),
            );
            optional_entity_id(
                group.get("parentId"),
                &format!("{path}/parentId"),
                issues,
                "group",
            );
            non_empty_string(group.get("label"), &format!("{path}/label"), issues);
            optional_string(group.get("stableKey"), &format!("{path}/stableKey"), issues);
        },
    );
    for_each_record(
        graph.get("nodes"),
        "/graph/nodes",
        issues,
        |node, path, issues| {
            keys(
                node,
                path,
                &["id", "kind", "sideEffect", "compileState"],
                &["stableKey", "recordingOrder", "label", "groupId"],
                issues,
            );
            entity_id(node.get("id"), &format!("{path}/id"), issues, Some("node"));
            enum_value(
                node.get("kind"),
                NODE_KINDS,
                &format!("{path}/kind"),
                issues,
            );
            boolean(
                node.get("sideEffect"),
                &format!("{path}/sideEffect"),
                issues,
            );
            optional_safe_integer(
                node.get("recordingOrder"),
                &format!("{path}/recordingOrder"),
                issues,
            );
            optional_string(node.get("label"), &format!("{path}/label"), issues);
            optional_string(node.get("stableKey"), &format!("{path}/stableKey"), issues);
            optional_entity_id(
                node.get("groupId"),
                &format!("{path}/groupId"),
                issues,
                "group",
            );
            let state_path = format!("{path}/compileState");
            let Some(state) = record(node.get("compileState"), &state_path, issues) else {
                return;
            };
            match state.get("status").and_then(Value::as_str) {
                Some("retained") => {
                    keys(
                        state,
                        &state_path,
                        &["status", "executionOrder"],
                        &[],
                        issues,
                    );
                    safe_integer(
                        state.get("executionOrder"),
                        &format!("{state_path}/executionOrder"),
                        issues,
                    );
                }
                Some("culled") => {
                    keys(state, &state_path, &["status", "reason"], &[], issues);
                    non_empty_string(state.get("reason"), &format!("{state_path}/reason"), issues);
                }
                _ => issues.push(error(
                    "invalid-enum",
                    format!("{state_path}/status"),
                    "Expected retained or culled.",
                )),
            }
        },
    );
    for_each_record(
        graph.get("resources"),
        "/graph/resources",
        issues,
        validate_resource,
    );
    for_each_record(
        graph.get("textureViews"),
        "/graph/textureViews",
        issues,
        validate_texture_view,
    );
    for_each_record(
        graph.get("accesses"),
        "/graph/accesses",
        issues,
        validate_access,
    );
    for_each_record(
        graph.get("dependencies"),
        "/graph/dependencies",
        issues,
        |dependency, path, issues| {
            keys(
                dependency,
                path,
                &["fromNodeId", "toNodeId", "resourceId", "kind"],
                &[],
                issues,
            );
            entity_id(
                dependency.get("fromNodeId"),
                &format!("{path}/fromNodeId"),
                issues,
                Some("node"),
            );
            entity_id(
                dependency.get("toNodeId"),
                &format!("{path}/toNodeId"),
                issues,
                Some("node"),
            );
            entity_id(
                dependency.get("resourceId"),
                &format!("{path}/resourceId"),
                issues,
                Some("resource"),
            );
            enum_value(
                dependency.get("kind"),
                &["value", "ordering"],
                &format!("{path}/kind"),
                issues,
            );
        },
    );
    for_each_record(
        graph.get("roots"),
        "/graph/roots",
        issues,
        |root, path, issues| {
            keys(root, path, &["reason"], &["nodeId", "resourceId"], issues);
            enum_value(
                root.get("reason"),
                ROOT_REASONS,
                &format!("{path}/reason"),
                issues,
            );
            optional_entity_id(
                root.get("nodeId"),
                &format!("{path}/nodeId"),
                issues,
                "node",
            );
            optional_entity_id(
                root.get("resourceId"),
                &format!("{path}/resourceId"),
                issues,
                "resource",
            );
            if root.contains_key("nodeId") == root.contains_key("resourceId") {
                issues.push(error(
                    "invalid-root",
                    path,
                    "A root must reference exactly one node or resource.",
                ));
            }
        },
    );
    for_each_record(
        graph.get("segments"),
        "/graph/segments",
        issues,
        |segment, path, issues| {
            keys(
                segment,
                path,
                &["id", "order", "kind", "nodeIds"],
                &[],
                issues,
            );
            entity_id(
                segment.get("id"),
                &format!("{path}/id"),
                issues,
                Some("segment"),
            );
            safe_integer(segment.get("order"), &format!("{path}/order"), issues);
            enum_value(
                segment.get("kind"),
                &["frame-graph", "external-submission"],
                &format!("{path}/kind"),
                issues,
            );
            string_array(
                segment.get("nodeIds"),
                &format!("{path}/nodeIds"),
                issues,
                true,
                None,
                Some("node"),
                false,
            );
            if segment
                .get("nodeIds")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                issues.push(error(
                    "invalid-segment-sequence",
                    format!("{path}/nodeIds"),
                    "Execution segment must contain at least one node.",
                ));
            }
        },
    );
    true
}

fn validate_resource(resource: &Map<String, Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    keys(
        resource,
        path,
        &["id", "kind", "origin", "usageFlags"],
        &[
            "stableKey",
            "label",
            "groupId",
            "lifetime",
            "allocationId",
            "estimatedByteSize",
            "descriptor",
            "initialContents",
        ],
        issues,
    );
    entity_id(
        resource.get("id"),
        &format!("{path}/id"),
        issues,
        Some("resource"),
    );
    let kind = enum_value(
        resource.get("kind"),
        &["texture", "buffer"],
        &format!("{path}/kind"),
        issues,
    );
    let origin = enum_value(
        resource.get("origin"),
        ORIGINS,
        &format!("{path}/origin"),
        issues,
    );
    let initial = resource.get("initialContents").and_then(|value| {
        enum_value(
            Some(value),
            &["defined", "undefined"],
            &format!("{path}/initialContents"),
            issues,
        )
    });
    if matches!(origin, Some("transient" | "surface")) && initial != Some("undefined") {
        issues.push(error(
            "invalid-initial-contents",
            format!("{path}/initialContents"),
            format!(
                "{} resources must begin with undefined contents.",
                origin.unwrap()
            ),
        ));
    }
    optional_string(
        resource.get("stableKey"),
        &format!("{path}/stableKey"),
        issues,
    );
    optional_string(resource.get("label"), &format!("{path}/label"), issues);
    optional_entity_id(
        resource.get("groupId"),
        &format!("{path}/groupId"),
        issues,
        "group",
    );
    optional_entity_id(
        resource.get("allocationId"),
        &format!("{path}/allocationId"),
        issues,
        "allocation",
    );
    optional_safe_integer(
        resource.get("estimatedByteSize"),
        &format!("{path}/estimatedByteSize"),
        issues,
    );
    if let Some(value) = resource.get("lifetime")
        && let Some(lifetime) = record(Some(value), &format!("{path}/lifetime"), issues)
    {
        let lifetime_path = format!("{path}/lifetime");
        keys(
            lifetime,
            &lifetime_path,
            &["firstUse", "lastUse"],
            &[],
            issues,
        );
        let first = safe_integer(
            lifetime.get("firstUse"),
            &format!("{lifetime_path}/firstUse"),
            issues,
        );
        let last = safe_integer(
            lifetime.get("lastUse"),
            &format!("{lifetime_path}/lastUse"),
            issues,
        );
        if first.zip(last).is_some_and(|(first, last)| last < first) {
            issues.push(error(
                "invalid-lifetime",
                lifetime_path,
                "lastUse must be greater than or equal to firstUse.",
            ));
        }
    }
    match kind {
        Some("texture") => string_array(
            resource.get("usageFlags"),
            &format!("{path}/usageFlags"),
            issues,
            false,
            Some(TEXTURE_USAGE),
            None,
            false,
        ),
        Some("buffer") => string_array(
            resource.get("usageFlags"),
            &format!("{path}/usageFlags"),
            issues,
            false,
            Some(BUFFER_USAGE),
            None,
            false,
        ),
        _ => {}
    }
    let Some(descriptor_value) = resource.get("descriptor") else {
        return;
    };
    let Some(descriptor) = record(
        Some(descriptor_value),
        &format!("{path}/descriptor"),
        issues,
    ) else {
        return;
    };
    let descriptor_path = format!("{path}/descriptor");
    match kind {
        Some("buffer") => {
            keys(descriptor, &descriptor_path, &["kind", "size"], &[], issues);
            literal_string(
                descriptor.get("kind"),
                "buffer",
                &format!("{descriptor_path}/kind"),
                issues,
            );
            safe_integer(
                descriptor.get("size"),
                &format!("{descriptor_path}/size"),
                issues,
            );
        }
        Some("texture") => {
            keys(
                descriptor,
                &descriptor_path,
                &[
                    "kind",
                    "format",
                    "size",
                    "dimension",
                    "mipLevelCount",
                    "sampleCount",
                    "viewFormats",
                ],
                &[],
                issues,
            );
            literal_string(
                descriptor.get("kind"),
                "texture",
                &format!("{descriptor_path}/kind"),
                issues,
            );
            non_empty_string(
                descriptor.get("format"),
                &format!("{descriptor_path}/format"),
                issues,
            );
            non_empty_string(
                descriptor.get("dimension"),
                &format!("{descriptor_path}/dimension"),
                issues,
            );
            positive_safe_integer(
                descriptor.get("mipLevelCount"),
                &format!("{descriptor_path}/mipLevelCount"),
                issues,
            );
            positive_safe_integer(
                descriptor.get("sampleCount"),
                &format!("{descriptor_path}/sampleCount"),
                issues,
            );
            string_array(
                descriptor.get("viewFormats"),
                &format!("{descriptor_path}/viewFormats"),
                issues,
                false,
                None,
                None,
                true,
            );
            if let Some(size) = record(
                descriptor.get("size"),
                &format!("{descriptor_path}/size"),
                issues,
            ) {
                let size_path = format!("{descriptor_path}/size");
                keys(
                    size,
                    &size_path,
                    &["width", "height", "depthOrArrayLayers"],
                    &[],
                    issues,
                );
                positive_safe_integer(size.get("width"), &format!("{size_path}/width"), issues);
                positive_safe_integer(size.get("height"), &format!("{size_path}/height"), issues);
                positive_safe_integer(
                    size.get("depthOrArrayLayers"),
                    &format!("{size_path}/depthOrArrayLayers"),
                    issues,
                );
            }
        }
        _ => {}
    }
}

fn validate_texture_view(view: &Map<String, Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    keys(
        view,
        path,
        &[
            "id",
            "resourceId",
            "format",
            "dimension",
            "aspect",
            "baseMipLevel",
            "mipLevelCount",
            "baseArrayLayer",
            "arrayLayerCount",
            "swizzle",
        ],
        &["stableKey", "label"],
        issues,
    );
    entity_id(view.get("id"), &format!("{path}/id"), issues, Some("view"));
    entity_id(
        view.get("resourceId"),
        &format!("{path}/resourceId"),
        issues,
        Some("resource"),
    );
    optional_string(view.get("stableKey"), &format!("{path}/stableKey"), issues);
    optional_string(view.get("label"), &format!("{path}/label"), issues);
    for name in ["format", "dimension", "aspect", "swizzle"] {
        non_empty_string(view.get(name), &format!("{path}/{name}"), issues);
    }
    safe_integer(
        view.get("baseMipLevel"),
        &format!("{path}/baseMipLevel"),
        issues,
    );
    positive_safe_integer(
        view.get("mipLevelCount"),
        &format!("{path}/mipLevelCount"),
        issues,
    );
    safe_integer(
        view.get("baseArrayLayer"),
        &format!("{path}/baseArrayLayer"),
        issues,
    );
    positive_safe_integer(
        view.get("arrayLayerCount"),
        &format!("{path}/arrayLayerCount"),
        issues,
    );
}

fn validate_access(access: &Map<String, Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    keys(
        access,
        path,
        &[
            "id",
            "nodeId",
            "resourceId",
            "access",
            "mode",
            "producesValue",
        ],
        &["textureViewId", "textureRegion", "bufferRange", "contents"],
        issues,
    );
    entity_id(
        access.get("id"),
        &format!("{path}/id"),
        issues,
        Some("access"),
    );
    entity_id(
        access.get("nodeId"),
        &format!("{path}/nodeId"),
        issues,
        Some("node"),
    );
    entity_id(
        access.get("resourceId"),
        &format!("{path}/resourceId"),
        issues,
        Some("resource"),
    );
    let access_kind = enum_value(
        access.get("access"),
        ACCESS_KINDS,
        &format!("{path}/access"),
        issues,
    );
    optional_entity_id(
        access.get("textureViewId"),
        &format!("{path}/textureViewId"),
        issues,
        "view",
    );
    boolean(
        access.get("producesValue"),
        &format!("{path}/producesValue"),
        issues,
    );
    let mode = access.get("mode").and_then(Value::as_str);
    match mode {
        Some("read") => {
            if access.contains_key("contents") {
                issues.push(error(
                    "unexpected-property",
                    format!("{path}/contents"),
                    "Read access cannot declare contents.",
                ));
            }
            if access.get("producesValue") != Some(&Value::Bool(false)) {
                issues.push(error(
                    "invalid-read",
                    format!("{path}/producesValue"),
                    "Read access must set producesValue to false.",
                ));
            }
        }
        Some("write") => {
            enum_value(
                access.get("contents"),
                &["overwrite", "preserve"],
                &format!("{path}/contents"),
                issues,
            );
        }
        _ => issues.push(error(
            "invalid-enum",
            format!("{path}/mode"),
            "Expected read or write.",
        )),
    }
    if let (Some(kind), Some(mode)) = (access_kind, mode) {
        let expected = if is_read_access(kind) {
            Some("read")
        } else if is_write_access(kind) {
            Some("write")
        } else {
            None
        };
        if expected.is_some_and(|expected| expected != mode) {
            issues.push(error(
                "invalid-access-mode",
                format!("{path}/mode"),
                format!(
                    "Access kind \"{kind}\" requires mode \"{}\".",
                    expected.unwrap()
                ),
            ));
        }
    }
    if let Some(region) = access.get("textureRegion") {
        validate_texture_region(region, &format!("{path}/textureRegion"), issues);
    }
    if let Some(value) = access.get("bufferRange")
        && let Some(range) = record(Some(value), &format!("{path}/bufferRange"), issues)
    {
        let range_path = format!("{path}/bufferRange");
        keys(range, &range_path, &["offset"], &["size"], issues);
        safe_integer(range.get("offset"), &format!("{range_path}/offset"), issues);
        optional_safe_integer(range.get("size"), &format!("{range_path}/size"), issues);
    }
    if access_kind.is_some_and(|kind| kind.starts_with("texture-")) {
        if access.contains_key("bufferRange") {
            issues.push(error(
                "invalid-access-range",
                format!("{path}/bufferRange"),
                "Texture access cannot contain bufferRange.",
            ));
        }
        if matches!(access_kind, Some("texture-copy-src" | "texture-copy-dst"))
            && access.contains_key("textureViewId")
        {
            issues.push(error(
                "invalid-access-view",
                format!("{path}/textureViewId"),
                "Texture copy access cannot reference a texture view.",
            ));
        }
    }
    if access_kind.is_some_and(|kind| kind.starts_with("buffer-")) {
        if access.contains_key("textureRegion") {
            issues.push(error(
                "invalid-access-range",
                format!("{path}/textureRegion"),
                "Buffer access cannot contain textureRegion.",
            ));
        }
        if access.contains_key("textureViewId") {
            issues.push(error(
                "invalid-access-view",
                format!("{path}/textureViewId"),
                "Buffer access cannot reference a texture view.",
            ));
        }
    }
}

fn validate_texture_region(value: &Value, path: &str, issues: &mut Vec<SnapshotIssue>) {
    let Some(region) = record(Some(value), path, issues) else {
        return;
    };
    keys(
        region,
        path,
        &["baseMipLevel", "mipLevelCount", "aspect"],
        &[
            "baseArrayLayer",
            "arrayLayerCount",
            "baseDepthSlice",
            "depthSliceCount",
        ],
        issues,
    );
    safe_integer(
        region.get("baseMipLevel"),
        &format!("{path}/baseMipLevel"),
        issues,
    );
    positive_safe_integer(
        region.get("mipLevelCount"),
        &format!("{path}/mipLevelCount"),
        issues,
    );
    non_empty_string(region.get("aspect"), &format!("{path}/aspect"), issues);
    let array_present =
        region.contains_key("baseArrayLayer") || region.contains_key("arrayLayerCount");
    let depth_present =
        region.contains_key("baseDepthSlice") || region.contains_key("depthSliceCount");
    if array_present {
        safe_integer(
            region.get("baseArrayLayer"),
            &format!("{path}/baseArrayLayer"),
            issues,
        );
        positive_safe_integer(
            region.get("arrayLayerCount"),
            &format!("{path}/arrayLayerCount"),
            issues,
        );
    }
    if depth_present {
        safe_integer(
            region.get("baseDepthSlice"),
            &format!("{path}/baseDepthSlice"),
            issues,
        );
        positive_safe_integer(
            region.get("depthSliceCount"),
            &format!("{path}/depthSliceCount"),
            issues,
        );
    }
    if array_present == depth_present {
        issues.push(error(
            "invalid-texture-region",
            path,
            "Texture region must contain exactly one array-layer or depth-slice interval.",
        ));
    }
}

fn validate_memory(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) -> bool {
    let Some(memory) = record(value, "/memory", issues) else {
        return false;
    };
    keys(
        memory,
        "/memory",
        &["allocationReport", "poolReport"],
        &[],
        issues,
    );
    if let Some(report) = record(
        memory.get("allocationReport"),
        "/memory/allocationReport",
        issues,
    ) {
        if report.get("status").and_then(Value::as_str) == Some("available") {
            keys(
                report,
                "/memory/allocationReport",
                &["status", "allocations"],
                &[],
                issues,
            );
            for_each_record(
                report.get("allocations"),
                "/memory/allocationReport/allocations",
                issues,
                |allocation, path, issues| {
                    keys(
                        allocation,
                        path,
                        &["id", "kind", "compatibilityClassId"],
                        &["estimatedByteSize"],
                        issues,
                    );
                    entity_id(
                        allocation.get("id"),
                        &format!("{path}/id"),
                        issues,
                        Some("allocation"),
                    );
                    enum_value(
                        allocation.get("kind"),
                        &["texture", "buffer"],
                        &format!("{path}/kind"),
                        issues,
                    );
                    entity_id(
                        allocation.get("compatibilityClassId"),
                        &format!("{path}/compatibilityClassId"),
                        issues,
                        Some("compatibility"),
                    );
                    optional_safe_integer(
                        allocation.get("estimatedByteSize"),
                        &format!("{path}/estimatedByteSize"),
                        issues,
                    );
                },
            );
        } else {
            validate_unavailable(report, "/memory/allocationReport", issues);
        }
    }
    if let Some(pool) = record(memory.get("poolReport"), "/memory/poolReport", issues) {
        if pool.get("status").and_then(Value::as_str) == Some("available") {
            keys(
                pool,
                "/memory/poolReport",
                &[
                    "status",
                    "acquireCount",
                    "reuseCount",
                    "createdCount",
                    "retainedCount",
                ],
                &["estimatedRetainedBytes"],
                issues,
            );
            for name in [
                "acquireCount",
                "reuseCount",
                "createdCount",
                "retainedCount",
            ] {
                safe_integer(
                    pool.get(name),
                    &format!("/memory/poolReport/{name}"),
                    issues,
                );
            }
            optional_safe_integer(
                pool.get("estimatedRetainedBytes"),
                "/memory/poolReport/estimatedRetainedBytes",
                issues,
            );
        } else {
            validate_unavailable(pool, "/memory/poolReport", issues);
        }
    }
    true
}

fn validate_timings(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) -> bool {
    let Some(timings) = record(value, "/timings", issues) else {
        return false;
    };
    keys(timings, "/timings", &["gpu"], &[], issues);
    let Some(gpu) = record(timings.get("gpu"), "/timings/gpu", issues) else {
        return true;
    };
    if gpu.get("status").and_then(Value::as_str) == Some("available") {
        keys(
            gpu,
            "/timings/gpu",
            &["status", "frameSpanMicros", "nodes"],
            &[],
            issues,
        );
        finite_number(
            gpu.get("frameSpanMicros"),
            "/timings/gpu/frameSpanMicros",
            issues,
        );
        for_each_record(
            gpu.get("nodes"),
            "/timings/gpu/nodes",
            issues,
            |timing, path, issues| {
                keys(timing, path, &["nodeId", "durationMicros"], &[], issues);
                entity_id(
                    timing.get("nodeId"),
                    &format!("{path}/nodeId"),
                    issues,
                    Some("node"),
                );
                finite_number(
                    timing.get("durationMicros"),
                    &format!("{path}/durationMicros"),
                    issues,
                );
            },
        );
    } else {
        validate_unavailable(gpu, "/timings/gpu", issues);
    }
    true
}

fn validate_diagnostics(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) {
    for_each_record(value, "/diagnostics", issues, |diagnostic, path, issues| {
        keys(
            diagnostic,
            path,
            &["severity", "code", "message"],
            &["nodeId", "resourceId"],
            issues,
        );
        enum_value(
            diagnostic.get("severity"),
            &["info", "warning", "error"],
            &format!("{path}/severity"),
            issues,
        );
        non_empty_string(diagnostic.get("code"), &format!("{path}/code"), issues);
        string(
            diagnostic.get("message"),
            &format!("{path}/message"),
            issues,
        );
        optional_entity_id(
            diagnostic.get("nodeId"),
            &format!("{path}/nodeId"),
            issues,
            "node",
        );
        optional_entity_id(
            diagnostic.get("resourceId"),
            &format!("{path}/resourceId"),
            issues,
            "resource",
        );
    });
}

fn validate_extensions(value: Option<&Value>, issues: &mut Vec<SnapshotIssue>) {
    let Some(extensions) = record(value, "/extensions", issues) else {
        return;
    };
    for name in extensions.keys() {
        if !extension_name_is_qualified(name) {
            issues.push(error(
                "invalid-extension-name",
                format!("/extensions/{}", pointer(name)),
                "Extension names must be namespace-qualified.",
            ));
        }
    }
}

fn validate_references(snapshot: &FrameGraphSnapshotV1, issues: &mut Vec<SnapshotIssue>) {
    let unavailable = snapshot
        .capture
        .migration
        .as_ref()
        .map(|migration| migration.unavailable_facts.as_slice())
        .unwrap_or(&[]);
    let mut ids = HashMap::<String, String>::new();
    let mut register = |id: &str, path: String, issues: &mut Vec<SnapshotIssue>| {
        if let Some(existing) = ids.get(id) {
            issues.push(error(
                "duplicate-id",
                path,
                format!("Entity id \"{id}\" is already declared at {existing}."),
            ));
        } else {
            ids.insert(id.to_owned(), path);
        }
    };
    for (index, entry) in snapshot.graph.groups.iter().enumerate() {
        register(&entry.id, format!("/graph/groups/{index}/id"), issues);
    }
    for (index, entry) in snapshot.graph.nodes.iter().enumerate() {
        register(&entry.id, format!("/graph/nodes/{index}/id"), issues);
    }
    for (index, entry) in snapshot.graph.resources.iter().enumerate() {
        register(&entry.id, format!("/graph/resources/{index}/id"), issues);
    }
    for (index, entry) in snapshot.graph.texture_views.iter().enumerate() {
        register(&entry.id, format!("/graph/textureViews/{index}/id"), issues);
    }
    for (index, entry) in snapshot.graph.accesses.iter().enumerate() {
        register(&entry.id, format!("/graph/accesses/{index}/id"), issues);
    }
    for (index, entry) in snapshot.graph.segments.iter().enumerate() {
        register(&entry.id, format!("/graph/segments/{index}/id"), issues);
    }
    if let SnapshotAllocationReport::Available { allocations } = &snapshot.memory.allocation_report
    {
        for (index, entry) in allocations.iter().enumerate() {
            register(
                &entry.id,
                format!("/memory/allocationReport/allocations/{index}/id"),
                issues,
            );
        }
    }

    let group_ids: HashSet<&str> = snapshot
        .graph
        .groups
        .iter()
        .map(|group| group.id.as_str())
        .collect();
    let node_by_id: HashMap<&str, _> = snapshot
        .graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let resource_by_id: HashMap<&str, _> = snapshot
        .graph
        .resources
        .iter()
        .map(|resource| (resource.id.as_str(), resource))
        .collect();
    let view_by_id: HashMap<&str, _> = snapshot
        .graph
        .texture_views
        .iter()
        .map(|view| (view.id.as_str(), view))
        .collect();
    let allocation_by_id: HashMap<&str, _> = match &snapshot.memory.allocation_report {
        SnapshotAllocationReport::Available { allocations } => allocations
            .iter()
            .map(|allocation| (allocation.id.as_str(), allocation))
            .collect(),
        SnapshotAllocationReport::Unavailable { .. } => HashMap::new(),
    };
    validate_migration_availability(snapshot, unavailable, issues);

    for (index, group) in snapshot.graph.groups.iter().enumerate() {
        if let Some(parent_id) = group.parent_id.as_deref() {
            if !group_ids.contains(parent_id) {
                missing(
                    &format!("/graph/groups/{index}/parentId"),
                    "group",
                    parent_id,
                    issues,
                );
            }
            if snapshot
                .graph
                .groups
                .iter()
                .position(|candidate| candidate.id == parent_id)
                .is_some_and(|parent_index| parent_index >= index)
            {
                issues.push(error(
                    "invalid-group-order",
                    format!("/graph/groups/{index}/parentId"),
                    "A group parent must appear before its child.",
                ));
            }
            let mut seen = HashSet::from([group.id.as_str()]);
            let mut current = Some(parent_id);
            while let Some(id) = current {
                if !seen.insert(id) {
                    issues.push(error(
                        "group-cycle",
                        format!("/graph/groups/{index}/parentId"),
                        "Group parent references form a cycle.",
                    ));
                    break;
                }
                current = snapshot
                    .graph
                    .groups
                    .iter()
                    .find(|candidate| candidate.id == id)
                    .and_then(|candidate| candidate.parent_id.as_deref());
            }
        }
    }

    let mut retained = Vec::new();
    for (index, node) in snapshot.graph.nodes.iter().enumerate() {
        if let Some(group_id) = node.group_id.as_deref()
            && !group_ids.contains(group_id)
        {
            missing(
                &format!("/graph/nodes/{index}/groupId"),
                "group",
                group_id,
                issues,
            );
        }
        if let SnapshotNodeCompileState::Retained { execution_order } = node.compile_state {
            retained.push((execution_order, index, node));
        }
    }
    retained.sort_by_key(|(order, _, _)| *order);
    for (expected_order, (actual_order, index, _)) in retained.iter().enumerate() {
        if *actual_order != expected_order as u64 {
            issues.push(error(
                "invalid-execution-order",
                format!("/graph/nodes/{index}/compileState/executionOrder"),
                "Retained node executionOrder values must form the contiguous range 0..N-1.",
            ));
        }
    }

    for (index, resource) in snapshot.graph.resources.iter().enumerate() {
        if snapshot.capture.migration.is_none() && resource.initial_contents.is_none() {
            issues.push(error(
                "missing-initial-contents",
                format!("/graph/resources/{index}/initialContents"),
                "ZenFG producers must declare the resource initial contents.",
            ));
        }
        if let Some(group_id) = resource.group_id.as_deref()
            && !group_ids.contains(group_id)
        {
            missing(
                &format!("/graph/resources/{index}/groupId"),
                "group",
                group_id,
                issues,
            );
        }
        if let Some(allocation_id) = resource.allocation_id.as_deref() {
            match allocation_by_id.get(allocation_id) {
                None => missing(
                    &format!("/graph/resources/{index}/allocationId"),
                    "allocation",
                    allocation_id,
                    issues,
                ),
                Some(allocation) if allocation.kind != resource.kind => issues.push(error(
                    "reference-kind",
                    format!("/graph/resources/{index}/allocationId"),
                    "Resource and allocation kinds must match.",
                )),
                _ => {}
            }
        }
        if resource
            .lifetime
            .is_some_and(|lifetime| lifetime.last_use >= retained.len() as u64)
        {
            issues.push(error(
                "invalid-lifetime",
                format!("/graph/resources/{index}/lifetime"),
                "Resource lifetime must use retained execution-order indices.",
            ));
        }
    }

    for (index, view) in snapshot.graph.texture_views.iter().enumerate() {
        match resource_by_id.get(view.resource_id.as_str()) {
            None => missing(
                &format!("/graph/textureViews/{index}/resourceId"),
                "resource",
                &view.resource_id,
                issues,
            ),
            Some(resource) if resource.kind != SnapshotResourceKind::Texture => issues.push(error(
                "reference-kind",
                format!("/graph/textureViews/{index}/resourceId"),
                "Texture view must reference a texture resource.",
            )),
            _ => {}
        }
    }
    for (index, access) in snapshot.graph.accesses.iter().enumerate() {
        if !node_by_id.contains_key(access.node_id.as_str()) {
            missing(
                &format!("/graph/accesses/{index}/nodeId"),
                "node",
                &access.node_id,
                issues,
            );
        }
        let resource = resource_by_id.get(access.resource_id.as_str()).copied();
        if resource.is_none() {
            missing(
                &format!("/graph/accesses/{index}/resourceId"),
                "resource",
                &access.resource_id,
                issues,
            );
        }
        if resource
            .is_some_and(|resource| !access_kind_matches_resource(access.access, resource.kind))
        {
            issues.push(error(
                "reference-kind",
                format!("/graph/accesses/{index}/access"),
                "Access kind does not match the referenced resource kind.",
            ));
        }
        if let Some(view_id) = access.texture_view_id.as_deref() {
            match view_by_id.get(view_id) {
                None => missing(
                    &format!("/graph/accesses/{index}/textureViewId"),
                    "texture view",
                    view_id,
                    issues,
                ),
                Some(view) if view.resource_id != access.resource_id => issues.push(error(
                    "reference-mismatch",
                    format!("/graph/accesses/{index}/textureViewId"),
                    "Texture view and access must reference the same resource.",
                )),
                _ => {}
            }
        }
        let regions_unavailable =
            unavailable.contains(&SnapshotUnavailableFact::GraphAccessRegions);
        match resource.map(|resource| resource.kind) {
            Some(SnapshotResourceKind::Texture)
                if access.texture_region.is_none() && !regions_unavailable =>
            {
                issues.push(error(
                    "invalid-access-range",
                    format!("/graph/accesses/{index}/textureRegion"),
                    "Texture access requires textureRegion when access regions are available.",
                ))
            }
            Some(SnapshotResourceKind::Buffer)
                if access.buffer_range.is_none() && !regions_unavailable =>
            {
                issues.push(error(
                    "invalid-access-range",
                    format!("/graph/accesses/{index}/bufferRange"),
                    "Buffer access requires bufferRange when access regions are available.",
                ))
            }
            _ => {}
        }
    }

    let mut dependencies = HashSet::new();
    for (index, dependency) in snapshot.graph.dependencies.iter().enumerate() {
        let mut from_order = None;
        let mut to_order = None;
        for (name, id) in [
            ("fromNodeId", dependency.from_node_id.as_str()),
            ("toNodeId", dependency.to_node_id.as_str()),
        ] {
            match node_by_id.get(id) {
                None => missing(
                    &format!("/graph/dependencies/{index}/{name}"),
                    "node",
                    id,
                    issues,
                ),
                Some(node) => match node.compile_state {
                    SnapshotNodeCompileState::Retained { execution_order } => {
                        if name == "fromNodeId" {
                            from_order = Some(execution_order);
                        } else {
                            to_order = Some(execution_order);
                        }
                    }
                    SnapshotNodeCompileState::Culled { .. } => issues.push(error(
                        "reference-state",
                        format!("/graph/dependencies/{index}/{name}"),
                        "Dependency nodes must be retained.",
                    )),
                },
            }
        }
        if !resource_by_id.contains_key(dependency.resource_id.as_str()) {
            missing(
                &format!("/graph/dependencies/{index}/resourceId"),
                "resource",
                &dependency.resource_id,
                issues,
            );
        }
        if from_order
            .zip(to_order)
            .is_some_and(|(from, to)| from >= to)
        {
            issues.push(error("invalid-dependency-order", format!("/graph/dependencies/{index}/toNodeId"), "Dependency edges must point from an earlier retained node to a later retained node."));
        }
        let key = (
            &dependency.from_node_id,
            &dependency.to_node_id,
            &dependency.resource_id,
            matches!(dependency.kind, crate::SnapshotDependencyKind::Ordering),
        );
        if !dependencies.insert(key) {
            issues.push(error(
                "duplicate-dependency",
                format!("/graph/dependencies/{index}"),
                "Duplicate dependency tuple.",
            ));
        }
    }
    for (index, root) in snapshot.graph.roots.iter().enumerate() {
        if let Some(node_id) = root.node_id.as_deref()
            && !node_by_id.contains_key(node_id)
        {
            missing(
                &format!("/graph/roots/{index}/nodeId"),
                "node",
                node_id,
                issues,
            );
        }
        if let Some(resource_id) = root.resource_id.as_deref()
            && !resource_by_id.contains_key(resource_id)
        {
            missing(
                &format!("/graph/roots/{index}/resourceId"),
                "resource",
                resource_id,
                issues,
            );
        }
    }

    let mut segmented_nodes = HashSet::new();
    let mut segmented_sequence = Vec::new();
    for (index, segment) in snapshot.graph.segments.iter().enumerate() {
        if segment.order != index as u64 {
            issues.push(error(
                "invalid-segment-order",
                format!("/graph/segments/{index}/order"),
                "Segment order must equal its array index.",
            ));
        }
        if segment.kind == SnapshotSegmentKind::ExternalSubmission && segment.node_ids.len() != 1 {
            issues.push(error(
                "invalid-segment-kind",
                format!("/graph/segments/{index}/nodeIds"),
                "External-submission segment must contain exactly one node.",
            ));
        }
        for (node_index, id) in segment.node_ids.iter().enumerate() {
            let path = format!("/graph/segments/{index}/nodeIds/{node_index}");
            match node_by_id.get(id.as_str()) {
                None => missing(&path, "node", id, issues),
                Some(node) => match node.compile_state {
                    SnapshotNodeCompileState::Culled { .. } => issues.push(error(
                        "reference-state",
                        &path,
                        "Execution segment may only reference retained nodes.",
                    )),
                    SnapshotNodeCompileState::Retained { .. }
                        if segment.kind == SnapshotSegmentKind::ExternalSubmission
                            && node.kind != SnapshotNodeKind::ExternalSubmission =>
                    {
                        issues.push(error(
                            "invalid-segment-kind",
                            &path,
                            "External-submission segment must contain an external-submission node.",
                        ))
                    }
                    SnapshotNodeCompileState::Retained { .. }
                        if segment.kind == SnapshotSegmentKind::FrameGraph
                            && node.kind == SnapshotNodeKind::ExternalSubmission =>
                    {
                        issues.push(error(
                            "invalid-segment-kind",
                            &path,
                            "FrameGraph segment cannot contain an external-submission node.",
                        ))
                    }
                    _ => {}
                },
            }
            if !segmented_nodes.insert(id.as_str()) {
                issues.push(error(
                    "duplicate-segment-node",
                    &path,
                    "Retained node may appear in only one execution segment.",
                ));
            }
            segmented_sequence.push(id.as_str());
        }
    }
    for node in &snapshot.graph.nodes {
        if matches!(
            node.compile_state,
            SnapshotNodeCompileState::Retained { .. }
        ) && !segmented_nodes.contains(node.id.as_str())
        {
            issues.push(error(
                "missing-segment-node",
                "/graph/segments",
                format!(
                    "Retained node \"{}\" is not assigned to an execution segment.",
                    node.id
                ),
            ));
        }
    }
    let expected_sequence: Vec<&str> = retained
        .iter()
        .map(|(_, _, node)| node.id.as_str())
        .collect();
    if segmented_sequence.len() == expected_sequence.len()
        && segmented_sequence
            .iter()
            .zip(&expected_sequence)
            .any(|(actual, expected)| actual != expected)
    {
        issues.push(error(
            "invalid-segment-sequence",
            "/graph/segments",
            "Concatenated segment nodes must follow retained execution order.",
        ));
    }

    if let SnapshotGpuTimings::Available { nodes, .. } = &snapshot.timings.gpu {
        let mut timed = HashSet::new();
        for (index, timing) in nodes.iter().enumerate() {
            match node_by_id.get(timing.node_id.as_str()) {
                None => missing(
                    &format!("/timings/gpu/nodes/{index}/nodeId"),
                    "node",
                    &timing.node_id,
                    issues,
                ),
                Some(node)
                    if !matches!(
                        node.compile_state,
                        SnapshotNodeCompileState::Retained { .. }
                    ) || !matches!(
                        node.kind,
                        SnapshotNodeKind::Render | SnapshotNodeKind::Compute
                    ) =>
                {
                    issues.push(error(
                        "reference-state",
                        format!("/timings/gpu/nodes/{index}/nodeId"),
                        "GPU timing must reference a retained render or compute node.",
                    ))
                }
                _ => {}
            }
            if !timed.insert(timing.node_id.as_str()) {
                issues.push(error(
                    "duplicate-timing",
                    format!("/timings/gpu/nodes/{index}/nodeId"),
                    "A node may have only one GPU timing.",
                ));
            }
        }
    }
    for (index, diagnostic) in snapshot.diagnostics.iter().enumerate() {
        if let Some(node_id) = diagnostic.node_id.as_deref()
            && !node_by_id.contains_key(node_id)
        {
            missing(
                &format!("/diagnostics/{index}/nodeId"),
                "node",
                node_id,
                issues,
            );
        }
        if let Some(resource_id) = diagnostic.resource_id.as_deref()
            && !resource_by_id.contains_key(resource_id)
        {
            missing(
                &format!("/diagnostics/{index}/resourceId"),
                "resource",
                resource_id,
                issues,
            );
        }
    }
}

fn validate_migration_availability(
    snapshot: &FrameGraphSnapshotV1,
    unavailable: &[SnapshotUnavailableFact],
    issues: &mut Vec<SnapshotIssue>,
) {
    let migrated = snapshot.capture.migration.is_some();
    if unavailable.contains(&SnapshotUnavailableFact::GraphGroups) {
        if !migrated || !snapshot.graph.groups.is_empty() {
            issues.push(error(
                "invalid-migration-availability",
                "/graph/groups",
                "Unavailable groups require Legacy migration provenance and an empty groups table.",
            ));
        }
        for (index, node) in snapshot.graph.nodes.iter().enumerate() {
            if node.group_id.is_some() {
                issues.push(error(
                    "invalid-migration-availability",
                    format!("/graph/nodes/{index}/groupId"),
                    "Group references must be absent when groups are unavailable.",
                ));
            }
        }
        for (index, resource) in snapshot.graph.resources.iter().enumerate() {
            if resource.group_id.is_some() {
                issues.push(error(
                    "invalid-migration-availability",
                    format!("/graph/resources/{index}/groupId"),
                    "Group references must be absent when groups are unavailable.",
                ));
            }
        }
    }
    if unavailable.contains(&SnapshotUnavailableFact::GraphTextureViews) {
        if !migrated || !snapshot.graph.texture_views.is_empty() {
            issues.push(error("invalid-migration-availability", "/graph/textureViews", "Unavailable texture views require Legacy migration provenance and an empty textureViews table."));
        }
        for (index, access) in snapshot.graph.accesses.iter().enumerate() {
            if access.texture_view_id.is_some() {
                issues.push(error(
                    "invalid-migration-availability",
                    format!("/graph/accesses/{index}/textureViewId"),
                    "Texture view references must be absent when texture views are unavailable.",
                ));
            }
        }
    }
    let recording_unavailable =
        unavailable.contains(&SnapshotUnavailableFact::GraphNodeRecordingOrder);
    for (index, node) in snapshot.graph.nodes.iter().enumerate() {
        if recording_unavailable {
            if node.recording_order.is_some() {
                issues.push(error(
                    "invalid-migration-availability",
                    format!("/graph/nodes/{index}/recordingOrder"),
                    "recordingOrder must be absent when recording order is unavailable.",
                ));
            }
        } else if node.recording_order != Some(index as u64) {
            issues.push(error(
                "invalid-recording-order",
                format!("/graph/nodes/{index}/recordingOrder"),
                "Node recordingOrder must equal its array index.",
            ));
        }
    }
    if unavailable.contains(&SnapshotUnavailableFact::GraphAccessRegions) {
        if !migrated {
            issues.push(error(
                "invalid-migration-availability",
                "/capture/migration/unavailableFacts",
                "Unavailable access regions require Legacy migration provenance.",
            ));
        }
        let has_missing = snapshot.graph.accesses.iter().any(|access| {
            if access_kind_is_texture(access.access) {
                access.texture_region.is_none()
            } else {
                access.buffer_range.is_none()
            }
        });
        if !has_missing {
            issues.push(error("invalid-migration-availability", "/capture/migration/unavailableFacts", "Access regions may be marked unavailable only when at least one access region is missing."));
        }
    }
}

fn validate_unavailable(value: &Map<String, Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    if value.get("status").and_then(Value::as_str) != Some("unavailable") {
        issues.push(error(
            "invalid-enum",
            format!("{path}/status"),
            "Expected available or unavailable.",
        ));
        return;
    }
    keys(value, path, &["status", "reason"], &[], issues);
    non_empty_string(value.get("reason"), &format!("{path}/reason"), issues);
}

fn for_each_record<F>(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
    mut callback: F,
) where
    F: FnMut(&Map<String, Value>, &str, &mut Vec<SnapshotIssue>),
{
    let Some(entries) = array(value, path, issues) else {
        return;
    };
    for (index, entry) in entries.iter().enumerate() {
        let entry_path = format!("{path}/{index}");
        if let Some(item) = record(Some(entry), &entry_path, issues) {
            callback(item, &entry_path, issues);
        }
    }
}

fn record<'a>(
    value: Option<&'a Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<&'a Map<String, Value>> {
    let result = value.and_then(Value::as_object);
    if result.is_none() {
        issues.push(error("invalid-type", path, "Expected an object."));
    }
    result
}

fn array<'a>(
    value: Option<&'a Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<&'a Vec<Value>> {
    let result = value.and_then(Value::as_array);
    if result.is_none() {
        issues.push(error("invalid-type", path, "Expected an array."));
    }
    result
}

fn keys(
    value: &Map<String, Value>,
    path: &str,
    required: &[&str],
    optional: &[&str],
    issues: &mut Vec<SnapshotIssue>,
) {
    for key in required {
        if !value.contains_key(*key) {
            issues.push(error(
                "missing-property",
                format!("{path}/{}", pointer(key)),
                format!("Required property \"{key}\" is missing."),
            ));
        }
    }
    for key in value.keys() {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            issues.push(error(
                "unexpected-property",
                format!("{path}/{}", pointer(key)),
                format!("Property \"{key}\" is not part of Snapshot 1.0."),
            ));
        }
    }
}

fn literal_string(
    value: Option<&Value>,
    expected: &str,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) {
    if value.and_then(Value::as_str) != Some(expected) {
        issues.push(error(
            "invalid-literal",
            path,
            format!("Expected \"{expected}\"."),
        ));
    }
}

fn literal_u64(value: Option<&Value>, expected: u64, path: &str, issues: &mut Vec<SnapshotIssue>) {
    if numeric_safe_integer(value) != Some(expected) {
        issues.push(error(
            "invalid-literal",
            path,
            format!("Expected {expected}."),
        ));
    }
}

fn string<'a>(
    value: Option<&'a Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<&'a str> {
    let result = value.and_then(Value::as_str);
    if result.is_none() {
        issues.push(error("invalid-type", path, "Expected a string."));
    }
    result
}

fn non_empty_string<'a>(
    value: Option<&'a Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<&'a str> {
    let result = string(value, path, issues);
    if result == Some("") {
        issues.push(error("empty-string", path, "Expected a non-empty string."));
    }
    result
}

fn optional_string(value: Option<&Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    if value.is_some() {
        string(value, path, issues);
    }
}

fn optional_non_empty_string(value: Option<&Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    if value.is_some() {
        non_empty_string(value, path, issues);
    }
}

fn entity_id<'a>(
    value: Option<&'a Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
    expected_prefix: Option<&str>,
) -> Option<&'a str> {
    let id = non_empty_string(value, path, issues);
    if let Some(id) = id {
        if !valid_entity_id(id) {
            issues.push(error(
                "invalid-id",
                path,
                "Entity id must use a type-prefixed string such as \"node:1\".",
            ));
        } else if expected_prefix.is_some_and(|prefix| !id.starts_with(&format!("{prefix}:"))) {
            issues.push(error(
                "invalid-id",
                path,
                format!(
                    "Entity id must use the \"{}:\" prefix.",
                    expected_prefix.unwrap()
                ),
            ));
        }
    }
    id
}

fn optional_entity_id(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
    prefix: &str,
) {
    if value.is_some() {
        entity_id(value, path, issues, Some(prefix));
    }
}

fn boolean(value: Option<&Value>, path: &str, issues: &mut Vec<SnapshotIssue>) -> Option<bool> {
    let result = value.and_then(Value::as_bool);
    if result.is_none() {
        issues.push(error("invalid-type", path, "Expected a boolean."));
    }
    result
}

fn safe_integer(value: Option<&Value>, path: &str, issues: &mut Vec<SnapshotIssue>) -> Option<u64> {
    let result = numeric_safe_integer(value);
    if result.is_none() {
        issues.push(error(
            "invalid-integer",
            path,
            "Expected a non-negative safe integer.",
        ));
    }
    result
}

fn positive_safe_integer(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<u64> {
    let result = safe_integer(value, path, issues);
    if result == Some(0) {
        issues.push(error(
            "invalid-integer",
            path,
            "Expected a positive safe integer.",
        ));
    }
    result
}

fn optional_safe_integer(value: Option<&Value>, path: &str, issues: &mut Vec<SnapshotIssue>) {
    if value.is_some() {
        safe_integer(value, path, issues);
    }
}

fn finite_number(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<f64> {
    let result = value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0);
    if result.is_none() {
        issues.push(error(
            "invalid-number",
            path,
            "Expected a finite non-negative number.",
        ));
    }
    result
}

fn enum_value<'a>(
    value: Option<&'a Value>,
    allowed: &[&str],
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
) -> Option<&'a str> {
    let result = value
        .and_then(Value::as_str)
        .filter(|value| allowed.contains(value));
    if result.is_none() {
        issues.push(error(
            "invalid-enum",
            path,
            format!("Expected one of: {}.", allowed.join(", ")),
        ));
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn string_array(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<SnapshotIssue>,
    entities: bool,
    allowed: Option<&[&str]>,
    entity_prefix: Option<&str>,
    non_empty: bool,
) {
    let Some(entries) = array(value, path, issues) else {
        return;
    };
    let mut seen = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        let entry_path = format!("{path}/{index}");
        let text = if entities {
            entity_id(Some(entry), &entry_path, issues, entity_prefix)
        } else if non_empty {
            non_empty_string(Some(entry), &entry_path, issues)
        } else {
            string(Some(entry), &entry_path, issues)
        };
        let Some(text) = text else { continue };
        if allowed.is_some_and(|allowed| !allowed.contains(&text)) {
            issues.push(error(
                "invalid-enum",
                &entry_path,
                format!("Expected one of: {}.", allowed.unwrap().join(", ")),
            ));
        }
        if !seen.insert(text) {
            issues.push(error(
                "duplicate-value",
                &entry_path,
                format!("Duplicate value \"{text}\"."),
            ));
        }
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

fn valid_entity_id(value: &str) -> bool {
    let Some((prefix, suffix)) = value.split_once(':') else {
        return false;
    };
    !suffix.is_empty()
        && prefix
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && prefix.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn extension_name_is_qualified(value: &str) -> bool {
    value
        .char_indices()
        .any(|(index, character)| character == '.' && index > 0 && index + 1 < value.len())
}

fn access_kind_matches_resource(access: SnapshotAccessKind, kind: SnapshotResourceKind) -> bool {
    access_kind_is_texture(access) == (kind == SnapshotResourceKind::Texture)
}

fn access_kind_is_texture(access: SnapshotAccessKind) -> bool {
    matches!(
        access,
        SnapshotAccessKind::TextureSampled
            | SnapshotAccessKind::TextureStorageRead
            | SnapshotAccessKind::TextureStorageWrite
            | SnapshotAccessKind::TextureColorAttachmentWrite
            | SnapshotAccessKind::TextureDepthRead
            | SnapshotAccessKind::TextureDepthWrite
            | SnapshotAccessKind::TextureCopySrc
            | SnapshotAccessKind::TextureCopyDst
    )
}

fn is_read_access(value: &str) -> bool {
    matches!(
        value,
        "texture-sampled"
            | "texture-storage-read"
            | "texture-depth-read"
            | "texture-copy-src"
            | "buffer-uniform"
            | "buffer-storage-read"
            | "buffer-vertex"
            | "buffer-index"
            | "buffer-indirect"
            | "buffer-copy-src"
    )
}

fn is_write_access(value: &str) -> bool {
    matches!(
        value,
        "texture-storage-write"
            | "texture-color-attachment-write"
            | "texture-depth-write"
            | "texture-copy-dst"
            | "buffer-storage-write"
            | "buffer-copy-dst"
    )
}

fn missing(path: &str, kind: &str, id: &str, issues: &mut Vec<SnapshotIssue>) {
    issues.push(error(
        "missing-reference",
        path,
        format!("Unknown {kind} id \"{id}\"."),
    ));
}

fn pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn error(
    code: impl Into<String>,
    path: impl Into<String>,
    message: impl Into<String>,
) -> SnapshotIssue {
    SnapshotIssue::error(code, path, message)
}
