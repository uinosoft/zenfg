# Getting started with ZenFG

Choose a path for your application. ZenFG coordinates graph-visible GPU work;
your application owns the device, rendering policy, and presentation.

| Goal | Start here | What you will get |
| --- | --- | --- |
| Integrate TypeScript and WebGPU | [WebGPU quick start](../packages/webgpu/README.md#quick-start) | A clear-only presentation frame |
| Integrate Rust and wgpu | [Rust quick start](../crates/zenfg/README.md#quick-start) | A CPU-only compiled graph, followed by device-backed recipes |
| Read or produce Snapshot data | [TypeScript Snapshot](../packages/snapshot/README.md) or [Rust Snapshot](../crates/zenfg-snapshot/README.md) | Validated, canonical portable diagnostics |
| Embed a visual debugger | [Inspector quick start](../packages/inspector/README.md#quick-start) | A browser workbench for your captures |

## Before you start

Read [Compatibility](compatibility.md) for package and toolchain requirements.
Browser FrameGraph execution needs native WebGPU on HTTPS or localhost. Snapshot
processing and the Inspector do not require a GPU. Pin exact beta package
versions and check that your producer and consumer agree on the Snapshot wire version.

## Continue by task

- Understand [Core concepts](core-concepts.md): recording, content validity, dependencies, retention, and resource lifetimes.
- Follow the [complete TypeScript recipes](../packages/webgpu/examples/README.md) for transient resources, imported storage, persistent state, external submissions, snapshots, and GPU timing.
- Use the [Inspector workbench guide](../packages/inspector/GUIDE.md) and [theme guide](../packages/inspector/THEMING.md).
- Read the [Snapshot specification](../packages/snapshot/SPEC.md) for the portable wire contract.
- Explore the [Examples](https://uinosoft.github.io/zenfg/playground/) or open the [standalone Inspector](https://uinosoft.github.io/zenfg/inspector/).

## API reference

[TypeScript API](https://uinosoft.github.io/zenfg/docs/api/) is generated from
public source comments. For an installed version, follow its package manifest's
`exports` to the included declarations and source. Rust API reference is on
docs.rs; each crate README links its exact version.

## Versions and contributing

The website follows the development branch. Installed READMEs, packaged examples,
and per-package release tags preserve documentation for published versions.
See [migration guidance](migration-0.1.0-beta.3.md) and the [changelog](../CHANGELOG.md).

For repository work, read [Contributing](../CONTRIBUTING.md), the
[documentation workflow](documentation.md), and the [release process](release-process.md).
