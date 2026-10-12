# zenfg

<!-- usage-source: docs/README.md -->

<!-- generated:badges:start -->
[![zenfg published version](https://img.shields.io/crates/v/zenfg?include_prereleases)](https://crates.io/crates/zenfg)
[![docs.rs](https://img.shields.io/docsrs/zenfg/0.2.0)](https://docs.rs/zenfg/0.2.0/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/LICENSE)
<!-- generated:badges:end -->

`zenfg` is a renderer-agnostic FrameGraph compiler and transient-resource
executor for wgpu. It records logical resources and accesses, validates content
flow, builds dependencies, culls dead work, derives usage, plans transient
aliasing, and optionally materializes retained work on a caller-owned device and
queue.

## Installation

<!-- generated:installation:start -->
```sh
cargo add zenfg@=0.2.0
```
<!-- generated:installation:end -->

## Quick start

Read the [complete Quick Start](./docs/README.md#quick-start) for imports, caller-owned inputs and the execution lifecycle.

## Guides

<!-- generated:usage:start -->
<a id="features"></a>

- [Features](./docs/README.md#features)

<a id="lifecycle"></a>

- [Lifecycle](./docs/README.md#lifecycle)

<a id="diagnostic-grouping"></a>

- [Diagnostic grouping](./docs/README.md#diagnostic-grouping)

<a id="bloom-grouping-adapter"></a>

- [Bloom grouping adapter](./docs/README.md#bloom-grouping-adapter)

<a id="validation-boundary"></a>

- [Validation Boundary](./docs/README.md#validation-boundary)

<a id="common-tasks"></a>

- [Common tasks](./docs/README.md#common-tasks)

<a id="key-pattern-bind-and-resolve-typed-access"></a>

- [Key pattern: bind and resolve typed access](./docs/README.md#key-pattern-bind-and-resolve-typed-access)

<a id="resource-and-integration-choices"></a>

- [Resource and integration choices](./docs/README.md#resource-and-integration-choices)

<a id="common-mistakes"></a>

- [Common mistakes](./docs/README.md#common-mistakes)

<a id="complete-examples"></a>

- [Complete examples](./docs/README.md#complete-examples)

<a id="resource-pool-maintenance"></a>

- [Resource pool maintenance](./docs/README.md#resource-pool-maintenance)

<a id="further-reading"></a>

- [Further reading](./docs/README.md#further-reading)

<a id="execution-timing"></a>

- [Execution timing](./docs/README.md#execution-timing)

<a id="usage-references"></a>

- [Usage references](./docs/README.md#usage-references)
<!-- generated:usage:end -->

- [Complete usage guide](./docs/README.md)
- [Ownership, contents and integration](./docs/CONCEPTS.md)
- [Complete examples](./examples/)
- [Upgrade notes](./docs/MIGRATION.md)

## Documentation and versions

<!-- generated:documentation:start -->
The package manifest declares **zenfg 0.2.0**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: read the included `src/`, or run `cargo doc --open` in your consuming project.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/zenfg.html). The site may describe changes newer than this package.
- [Rust API for this version](https://docs.rs/zenfg/0.2.0/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/cargo/zenfg/v0.2.0/crates/zenfg).
- Usage contracts are maintained in this package; follow its local guides. Historical source links describe the named release, which may precede current development changes.
- [Package upgrade notes](./docs/MIGRATION.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Complete Cargo recipes are included in `examples/`.
<!-- generated:documentation:end -->
