# @zenfg/snapshot

[![npm](https://img.shields.io/npm/v/%40zenfg%2Fsnapshot?include_prereleases&label=npm)](https://www.npmjs.com/package/@zenfg/snapshot)
[![status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

`@zenfg/snapshot` defines the portable, versioned diagnostic
contract used to move one compiled FrameGraph frame between producers and
viewers. It contains no DOM, WebGPU, FrameGraph, or runtime third-party
dependency.

This is a public beta package. Public APIs may change before 1.0; integration
projects should pin the exact beta version. Snapshot wire format version 1.0 is
versioned independently from the package API.

For package selection, Snapshot/runtime boundaries, TypeScript/Rust API mapping,
and common integration failures, see the
[ZenFG quick reference](https://github.com/uinosoft/zenfg/blob/main/docs/quick-reference.md).

Snapshot V1 is UTF-8 JSON and conventionally uses the
`.fgsnapshot.json` extension. It describes compilation, logical resources and
views, central accesses, retention, execution segments, memory allocation,
resource-pool statistics, GPU timing availability, diagnostics, and
namespaced extensions. It does not contain GPU commands or resource contents
and cannot replay a frame.

[`SPEC.md`](./SPEC.md) is the language-neutral normative contract. The JSON
Schema is normative for structural constraints; reference and cross-field
semantics are defined by the specification and conformance corpus.

## Public API

```ts
import {
  FRAME_GRAPH_SNAPSHOT_FORMAT,
  FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH,
  FRAME_GRAPH_SNAPSHOT_VERSION,
  decodeFrameGraphSnapshot,
  finalizeFrameGraphSnapshot,
  parseFrameGraphSnapshot,
  stringifyFrameGraphSnapshot,
  validateFrameGraphSnapshot,
  type FrameGraphSnapshot,
} from '@zenfg/snapshot';
```

`decodeFrameGraphSnapshot()` accepts canonical V1 data, the historical
unversioned `{ compilation, gpuTiming, resourcePool }` shape, and the
`zenfg.frame-graph-snapshot-candidate` Legacy Candidate V1 format. Legacy numeric
IDs, usage masks, split retained/culled nodes, and `swapchain` origins are
migrated to V1. Missing historical facts remain absent (Unknown); the adapter
does not invent descriptors, texture views, estimates, groups, access regions,
recording order, or stable keys. The Legacy Candidate V1 adapter preserves
existing stable keys and namespaced extensions while discarding imported `initialContents`,
whose historical meaning cannot be recovered reliably. Persistent
`capture.migration` metadata keeps Unknown table-level facts distinguishable
from known-empty arrays.
Every successful decode returns a canonical JSON-compatible V1 value, so later
serialization never writes Legacy V0.
Programmatic decode inputs are treated as read-only: migration never mutates
the supplied value, and malformed programmatic values are returned as stable
validation issues instead of leaking native cloning or serialization errors.

`finalizeFrameGraphSnapshot()` is for Snapshot producers that assemble an
in-memory draft. It removes `undefined` object properties from optional fields,
then performs the same JSON-safety and Snapshot V1 semantic checks before
returning a detached canonical value or throwing `FrameGraphSnapshotValidationError`.
Use `validateFrameGraphSnapshot()` or `decodeFrameGraphSnapshot()` for externally
supplied values, where own `undefined` properties remain invalid JSON values.

Unknown versions are rejected. Viewers must add an explicit migration before
accepting another version rather than guessing at compatible fields.

Extension primitives have container depth 0; a root array or object has depth
1, including when empty, and each nested container adds one. Snapshot 1.0
accepts at most `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` (64) container
levels. A deeper value is rejected with `extension-depth-exceeded` at the
extension root, for example `/extensions/dev.zenfg.deep`. The fixed limit keeps
validation, canonical cloning, and serialization deterministic across the
TypeScript and Rust implementations.

## Installation

```sh
npm install @zenfg/snapshot@0.1.0-beta.1
```

## Schema and fixtures

The normative structural schema is exported as:

```ts
import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' };
```

TypeScript consumers importing the JSON Schema must enable JSON module
resolution and use a module mode that supports import attributes. For example:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true
  }
}
```

The source schema is Draft 2020-12 and lives under `schema/`. Golden fixtures
under `fixtures/` cover minimal data, a complete WebGPU capture, aliasing,
unavailable timing, all four `stableKey` locations, the accepted 64-level
extension boundary, and exact Legacy V0/Legacy Candidate V1 canonical migration.
`conformance/manifest.json` classifies valid,
structural-invalid, semantic-invalid, and malformed Legacy cases, records the
required public issue-code coverage, and compares the complete issue multiset
without treating issue array order as part of the protocol. The runtime uses an explicit
TypeScript validator to keep issue codes, JSON Pointers, and messages stable;
Ajv is used only by tests to check the published schema.

Entity IDs are type-prefixed strings. Counts, byte sizes, and frame indices are
non-negative JavaScript safe integers. Duration values are finite numbers.
Accesses exist only in the central access table, resources point one way to
allocations, and segments list nodes one way. Consumers build reverse indices
and summaries locally.
