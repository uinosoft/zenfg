# @zenfg/snapshot

<!-- generated:badges:start -->
[![@zenfg/snapshot published next version](https://img.shields.io/npm/v/%40zenfg%2Fsnapshot/next?label=npm)](https://www.npmjs.com/package/@zenfg/snapshot)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/snapshot/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/LICENSE)
<!-- generated:badges:end -->

`@zenfg/snapshot` owns the portable, versioned diagnostic contract used to move
one compiled FrameGraph frame between producers and viewers. It provides the
Snapshot 1.1 wire types, codec, validator, JSON Schema, fixtures, migration, and
conformance corpus without depending on DOM, WebGPU, or a FrameGraph runtime.

Snapshot files contain graph structure and diagnostics, not GPU commands or
resource contents, and cannot replay a frame. Snapshot wire-format versioning is
independent from this package's beta API version.

## Installation

<!-- generated:installation:start -->
```sh
npm install @zenfg/snapshot@0.1.0-beta.3
```
<!-- generated:installation:end -->

## Quick start

Use an ESM TypeScript project targeting ES2022 or later. This package works without
DOM or GPU objects. Call `normalizeSnapshot(jsonText)` with captured Snapshot JSON;
a valid input returns formatted canonical JSON, and an invalid input reports its issues.

Use `parseFrameGraphSnapshot()` for untrusted JSON text. Supported legacy
formats are migrated to a detached canonical Snapshot 1.1 value:

```ts
import {
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
} from '@zenfg/snapshot';

export function normalizeSnapshot(jsonText: string): string {
	const decoded = parseFrameGraphSnapshot(jsonText);
	if (!decoded.ok) {
		throw new Error(decoded.issues.map((issue) => issue.message).join('\n'));
	}
	return stringifyFrameGraphSnapshot(decoded.snapshot, { pretty: true });
}
```

Decode and validation return structured issues for untrusted input instead of
throwing native JSON or cloning failures. Serialization and producer
finalization throw `FrameGraphSnapshotValidationError` when a caller attempts to
write invalid canonical data.

## Common tasks

| Task | Public API |
| --- | --- |
| Parse untrusted JSON text | `parseFrameGraphSnapshot()` |
| Decode an already-parsed unknown value | `decodeFrameGraphSnapshot()` |
| Validate canonical programmatic data | `validateFrameGraphSnapshot()` |
| Finalize and detach a producer draft | `finalizeFrameGraphSnapshot()` |
| Serialize canonical Snapshot data | `stringifyFrameGraphSnapshot()` |
| Handle producer-side validation failures | `FrameGraphSnapshotValidationError` |
| Read the canonical format and version | `FRAME_GRAPH_SNAPSHOT_FORMAT`, `FRAME_GRAPH_SNAPSHOT_VERSION` |
| Read the extension depth limit | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |
| Import the JSON Schema | `@zenfg/snapshot/schema/v1.json` |

Exact result unions, issue types, wire fields, defaults, and failure conditions
are documented by the TSDoc preserved in the packaged source and declarations.

## Consumer and producer boundaries

- Consumers should use `parseFrameGraphSnapshot()` for text or
  `decodeFrameGraphSnapshot()` for unknown values. Both accept canonical 1.1 and
  supported historical formats, perform migration, and return a discriminated
  result.
- Producers assembling an in-memory draft should use
  `finalizeFrameGraphSnapshot()`. It removes optional `undefined` properties,
  validates JSON safety and Snapshot semantics, and returns detached canonical
  data.
- `validateFrameGraphSnapshot()` checks canonical data; it does not migrate
  historical input.
- Unknown formats and versions are rejected until an explicit migration exists.
  Readers must not guess that another wire version is compatible.
- Programmatic inputs are treated as read-only. Decode, migration, and
  finalization do not mutate caller-owned values.

The complete structural and cross-field contract is the
[`SPEC.md`](./SPEC.md) specification. The JSON Schema is normative for
structural constraints; the specification and conformance corpus define
references, cross-field semantics, migration, and stable issue behavior.

## Schema and fixtures

Import the published Draft 2020-12 Schema with an import attribute:

```ts
import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' };
```

Consumers need JSON module resolution and a module mode supporting import
attributes. Published fixtures and conformance cases cover canonical documents,
legacy migration, invalid structure, invalid semantics, stable keys, allocation,
timing, and the extension-depth boundary.

Snapshot files conventionally use the `.fgsnapshot.json` extension. Entity IDs
are type-prefixed strings; counts, sizes, and frame indices are non-negative
JavaScript safe integers.

## Common mistakes

| Symptom | Fix |
| --- | --- |
| Parsed JSON is treated as trusted Snapshot data | Pass it through `parseFrameGraphSnapshot()` or `decodeFrameGraphSnapshot()` first. |
| Legacy input fails canonical validation | Decode it so the explicit migration runs; canonical validation alone does not migrate. |
| A producer writes `undefined`, non-finite numbers, or unsupported values | Finalize the draft and handle `FrameGraphSnapshotValidationError` before serialization. |
| An unknown version appears to have compatible fields | Reject it until a reader implements and tests an explicit migration. |
| Reverse relationships are expected in the wire model | Build consumer indices locally; the protocol stores canonical one-way references. |
| A Snapshot is expected to replay GPU work | Capture commands or resource contents through an application-owned mechanism instead. |

## Further reading

- [Snapshot 1.1 specification](./SPEC.md)
- [ZenFG Core concepts](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/docs/core-concepts.md)
- [`@zenfg/webgpu` Snapshot producer](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/packages/webgpu/README.md#diagnostics-and-snapshot)
- [`zenfg-snapshot`](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/crates/zenfg-snapshot/README.md)
- [`@zenfg/inspector`](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/packages/inspector/README.md)

## Documentation and versions

<!-- generated:documentation:start -->
This README describes **@zenfg/snapshot 0.1.0-beta.3**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/snapshot.html). The site may describe changes newer than this package.
- [TypeScript API (development branch)](https://uinosoft.github.io/zenfg/docs/api/snapshot/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/npm/snapshot/v0.1.0-beta.3/packages/snapshot).
- [Shared concepts for this release](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/docs/core-concepts.md) and [compatibility](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.3/docs/compatibility.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Local wire contract: [SPEC.md](./SPEC.md), `schema/`, `fixtures/` and `conformance/`.
<!-- generated:documentation:end -->
