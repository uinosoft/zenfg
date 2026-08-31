# FrameGraph Snapshot 1.0 Specification

## 1. Status and terminology

This document is the language-neutral normative definition of FrameGraph
Snapshot 1.0. The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and
MAY are requirements on producers and consumers.

A Snapshot is a diagnostic description of one compiled FrameGraph frame. It
does not contain GPU commands, shaders, resource contents, screenshots, or UI
workspace state and MUST NOT be treated as a replay format.

The JSON Schema is normative for structural validation. This document is
normative for references, ordering, availability, and other cross-field
semantics. A Snapshot is valid only when it satisfies both layers.

## 2. Encoding, format, and versions

- Files MUST be UTF-8 JSON and conventionally use `.fgsnapshot.json`.
- `format` MUST be `zenfg.frame-graph-snapshot`.
- Version 1.0 is `{ "major": 1, "minor": 0 }`.
- Readers MUST reject unknown major or minor versions and MUST NOT guess that
  an unknown version is compatible.
- Canonical V1 means the current V1 data model. It does not prescribe object-key
  order, insignificant whitespace, or byte-for-byte canonical JSON.
- Every count, byte size, frame index, ordering index, offset, and length MUST
  be a non-negative JavaScript safe integer (`0..9007199254740991`). Texture
  dimensions, mip counts, sample counts, array-layer counts, and depth-slice
  counts MUST be positive.
- Durations use microseconds and MUST be finite, non-negative JSON numbers.

## 3. Identifiers and strings

Declared entity IDs MUST be non-empty strings with the following exact prefix:

| Entity | Prefix |
| --- | --- |
| group | `group:` |
| node | `node:` |
| resource | `resource:` |
| texture view | `view:` |
| access | `access:` |
| segment | `segment:` |
| allocation | `allocation:` |

All declared entity IDs are globally unique within one Snapshot. A
`compatibility:` ID is an equivalence-class token, not a declared entity; the
same token is intentionally reusable by compatible allocations.

`stableKey` is optional. A producer MUST omit it when it cannot provide a
reliable identity. Texture formats, dimensions, aspects, swizzles, producer
metadata, and runtime metadata are non-empty opaque strings unless the Schema
states otherwise. Producers SHOULD use WebGPU spellings. Consumers MUST
preserve and display unknown opaque values. Resource origins, usage flags,
node kinds, access kinds, root reasons, and segment kinds are closed V1 enums.

## 4. Capture metadata and Unknown facts

`capture.frameIndex` identifies the captured frame. `capturedAt`, when present,
is producer metadata and does not affect graph semantics.

Every new producer writes `resource.initialContents` as `defined` or
`undefined`. Transient and surface resources MUST be `undefined`; imported
resources may use either value. Historical migration may omit this field for an
imported resource when its original initial state cannot be recovered. That
omission means Unknown.

An absent optional scalar or object means that fact is Unknown; it does not mean
zero or empty. Required arrays are known, including when empty, except when a
Legacy migration explicitly marks a table-level fact unavailable:

```json
{
  "migration": {
    "sourceFormat": "legacy-v0",
    "unavailableFacts": ["graph.textureViews", "graph.nodes.recordingOrder"]
  }
}
```

The allowed unavailable facts and their invariants are:

- `graph.groups`: `groups` is empty and node/resource `groupId` fields are absent.
- `graph.textureViews`: `textureViews` is empty and access `textureViewId` fields are absent.
- `graph.nodes.recordingOrder`: every `recordingOrder` field is absent; the node
  array order MUST NOT be interpreted as original recording order.
- `graph.accesses.regions`: one or more accesses lack their matching range.
  Present ranges remain authoritative and MUST be valid.

Without the corresponding unavailable fact, normal V1 completeness rules
apply. Migration metadata is part of canonical V1 and MUST survive re-encoding.

## 5. Graph tables and ordering

- `groups` is in group creation/open order. A parent MUST appear before its
  child. Parent references MUST exist and MUST NOT form a cycle.
- Native `nodes` is in recording order. Every node has `recordingOrder` equal to
  its array index. Retained and culled nodes share this table.
- Retained `executionOrder` values form the contiguous range `0..N-1`.
- Resource, texture-view, access, dependency, root, and allocation array order
  has no semantic meaning unless stated elsewhere.
- Every reference MUST resolve to the declared entity kind required by its field.
- A texture view MUST reference a texture resource. An access view and resource
  MUST identify the same resource. A resource and its allocation MUST have the
  same kind.
- A root MUST reference exactly one node or resource.

Resource `lifetime.firstUse` and `lastUse`, when present, use retained execution
order indices, satisfy `firstUse <= lastUse`, and lie inside `0..N-1`.

Dependencies reference retained nodes and an existing resource. They MUST point
from an earlier execution order to a later execution order. Duplicate tuples of
`fromNodeId`, `toNodeId`, `resourceId`, and `kind` are invalid.

Segments are in execution order, and `segment.order` equals its array index.
Every segment contains at least one retained node. Concatenating all segment
`nodeIds` produces exactly the retained nodes in execution order, with each node
appearing once. An `external-submission` segment contains exactly one
`external-submission` node. A `frame-graph` segment contains no such node.

## 6. Accesses and regions

Accesses exist only in the central `graph.accesses` table. Resources and nodes
MUST NOT duplicate access lists.

| Access kind | Required mode |
| --- | --- |
| `texture-sampled` | read |
| `texture-storage-read` | read |
| `texture-depth-read` | read |
| `texture-copy-src` | read |
| `buffer-uniform` | read |
| `buffer-storage-read` | read |
| `buffer-vertex` | read |
| `buffer-index` | read |
| `buffer-indirect` | read |
| `buffer-copy-src` | read |
| `texture-storage-write` | write |
| `texture-color-attachment-write` | write |
| `texture-depth-write` | write |
| `texture-copy-dst` | write |
| `buffer-storage-write` | write |
| `buffer-copy-dst` | write |

A read access sets `producesValue` to false and omits `contents`. A write access
has `contents` (`overwrite` or `preserve`) and a boolean `producesValue`.
`contents` describes whether the write depends on prior contents;
`producesValue` describes whether the resulting logical value is available to
later readers. They are independent.

A texture access requires `textureRegion` and forbids `bufferRange`. A buffer
access requires `bufferRange` and forbids `textureRegion` and `textureViewId`.
Texture copy accesses also forbid `textureViewId`. Other texture accesses MAY
reference an explicit logical view. An omitted buffer-range `size` means through
the end of the buffer; it is not Unknown.

A texture region has a positive mip count and exactly one complete interval:
`baseArrayLayer` plus `arrayLayerCount`, or `baseDepthSlice` plus
`depthSliceCount`. It MUST NOT contain both interval forms.

## 7. Memory, timing, diagnostics, and extensions

Resources point one way to allocations; allocations do not repeat resource IDs.
Segments likewise list nodes one way. Consumers construct reverse indices.

Allocation and pool reports, and GPU timings, use explicit `available` or
`unavailable` variants. An unavailable reason is non-empty. An available GPU
timing references each retained render or compute node at most once.

Diagnostic codes are non-empty. Optional node/resource references MUST resolve.

Extension names match `^.+\..+$`. Extension values MUST be JSON values: no
non-finite numbers, undefined values, holes, host objects, or cycles. A
primitive extension value has container depth 0. An array or object used as an
extension root has container depth 1, and each nested array or object increases
that depth by 1. Empty containers count. Extension values MUST NOT exceed 64
container levels; the public TypeScript and Rust bindings expose this limit as
`FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH`.

A depth violation produces at most one `extension-depth-exceeded` issue for
each over-limit extension. Its path is the JSON Pointer to that extension root
(with the extension name escaped as a JSON Pointer token), and its exact
message is `Extension JSON nesting depth must not exceed 64 container levels.`
Consumers MUST preserve extensions they do not understand.

## 8. Historical migration

Readers recognize the unversioned `{ compilation, gpuTiming, resourcePool }`
Legacy V0 capture and the `zenfg.frame-graph-snapshot-candidate` Legacy
Candidate V1 format. A Legacy V0 migration converts numeric
IDs to prefixed strings, joins retained and culled nodes, converts WebGPU usage
bits to V1 tokens, and converts `swapchain` origin to `surface`.

Legacy Candidate V1 retains its graph facts, stable keys, and namespaced
extensions, changes the format identifier, sets transient/surface contents to
`undefined`, and removes any imported `initialContents` value so that the
historical state is represented as Unknown. Successful migration records
`capture.migration.sourceFormat` as `legacy-v0` or `legacy-candidate-v1`. A
historical Rust capture that already encoded persistent state as `side-effect`
remains unchanged because that intent cannot be reconstructed.

Migration MUST validate source values before conversion and MUST reject unknown
usage bits or malformed fields. It MUST NOT invent stable keys, descriptors,
estimates, group tables, view tables, recording order, or access regions.
Re-encoding always writes V1 with persistent `capture.migration` provenance.

## 9. Conformance

`conformance/manifest.json` is the portable test index. V1 valid cases pass the
Schema and semantic validator. Structural-invalid cases fail both. Semantic-
invalid cases may pass the Schema but fail semantic validation; that distinction
is recorded intentionally. Legacy cases are not evaluated against the V1
Schema and must match the declared decode result and canonical output. Every
case compares the complete multiset of `(code, path, message)` issues. The
depth-64 and depth-65 cases define the shared extension nesting boundary. Issue
array order is not protocol-significant; conformance implementations sort both
expected and actual issues by `path`, then `code`, then `message` before
comparison. The manifest's `requiredIssueCodes` table records shared coverage;
programmatic JavaScript values that JSON cannot represent remain explicitly
TypeScript-only.
