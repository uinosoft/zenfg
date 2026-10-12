# @zenfg/webgpu

<!-- usage-source: docs/README.md -->

<!-- generated:badges:start -->
[![@zenfg/webgpu published latest version](https://img.shields.io/npm/v/%40zenfg%2Fwebgpu/latest?label=npm)](https://www.npmjs.com/package/@zenfg/webgpu)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/webgpu/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/LICENSE)
<!-- generated:badges:end -->

`@zenfg/webgpu` is a lightweight WebGPU FrameGraph for declaring and executing
per-frame GPU work. It orders graph nodes, validates resource access, culls
unused work, derives WebGPU usage, tracks lifetimes, and reuses transient
textures and buffers.

## Installation

<!-- generated:installation:start -->
```sh
npm install @zenfg/webgpu@0.2.0
```
<!-- generated:installation:end -->

## Quick start

Read the [complete Quick Start](./docs/README.md#quick-start) for imports, caller-owned inputs and the execution lifecycle.

## Guides

<!-- generated:usage:start -->
<a id="lifecycle"></a>

- [Lifecycle](./docs/README.md#lifecycle)

<a id="diagnostic-grouping"></a>

- [Diagnostic grouping](./docs/README.md#diagnostic-grouping)

<a id="bloom-grouping-adapter"></a>

- [Bloom grouping adapter](./docs/README.md#bloom-grouping-adapter)

<a id="common-tasks"></a>

- [Common tasks](./docs/README.md#common-tasks)

<a id="key-pattern-declare-list-and-unwrap-access"></a>

- [Key pattern: declare, list, and unwrap access](./docs/README.md#key-pattern-declare-list-and-unwrap-access)

<a id="native-render-pass-descriptor-extras"></a>

- [Native render-pass descriptor extras](./docs/README.md#native-render-pass-descriptor-extras)

<a id="resource-and-integration-choices"></a>

- [Resource and integration choices](./docs/README.md#resource-and-integration-choices)

<a id="error-handling"></a>

- [Error handling](./docs/README.md#error-handling)

<a id="diagnostics-and-snapshot"></a>

- [Diagnostics and Snapshot](./docs/README.md#diagnostics-and-snapshot)

<a id="download-a-snapshot-for-inspector"></a>

- [Download a Snapshot for Inspector](./docs/README.md#download-a-snapshot-for-inspector)

<a id="common-mistakes"></a>

- [Common mistakes](./docs/README.md#common-mistakes)

<a id="complete-recipes"></a>

- [Complete recipes](./docs/README.md#complete-recipes)

<a id="resource-pool-maintenance"></a>

- [Resource pool maintenance](./docs/README.md#resource-pool-maintenance)

<a id="further-reading"></a>

- [Further reading](./docs/README.md#further-reading)

<a id="usage-references"></a>

- [Usage references](./docs/README.md#usage-references)
<!-- generated:usage:end -->

- [Complete usage guide](./docs/README.md)
- [Ownership, contents and integration](./docs/CONCEPTS.md)
- [Complete examples](./examples/)
- [Upgrade notes](./docs/MIGRATION.md)

## Documentation and versions

<!-- generated:documentation:start -->
The package manifest declares **@zenfg/webgpu 0.2.0**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/webgpu.html). The site may describe changes newer than this package.
- [TypeScript API (development branch)](https://uinosoft.github.io/zenfg/docs/api/webgpu/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/npm/webgpu/v0.2.0/packages/webgpu).
- Usage contracts are maintained in this package; follow its local guides. Historical source links describe the named release, which may precede current development changes.
- [Package upgrade notes](./docs/MIGRATION.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Local complete recipes: [examples](./examples/README.md).
<!-- generated:documentation:end -->
