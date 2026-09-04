# ZenFG

English | [简体中文](README.zh-CN.md)

**Composable FrameGraph infrastructure for WebGPU and wgpu.**

ZenFG provides idiomatic TypeScript and Rust runtimes, a portable Snapshot
format, validation and conformance tooling, and an embeddable Inspector. It
coordinates GPU work across renderer features and third-party systems without
turning the FrameGraph into a renderer.

Website: <https://uinosoft.github.io/zenfg/>

## Why ZenFG

ZenFG gives applications one explicit model for dependencies, scheduling,
culling, resource lifetimes, transient allocation, validation, and diagnostics.
The application remains in control of rendering policy and can adopt the graph
at the integration depth that fits each subsystem.

| ZenFG owns | The application owns |
| --- | --- |
| Graph-visible dependencies and execution order | Scenes, materials, cameras, and renderer architecture |
| Retention roots and dead-work culling | Pipelines, bind groups, samplers, and draw/dispatch policy |
| Transient lifetimes, aliasing, and pooling | Devices, queues, surfaces, presentation, and device-loss policy |
| Validation, reports, Snapshot projection, and inspection | Long-lived resources, resource contents, and application state |

## Integration levels

- **Native render, compute, and copy** nodes provide the richest validation and
  diagnostics.
- **Command integration** lets a subsystem encode custom work into a
  FrameGraph-owned command encoder.
- **Opaque external submission** lets an existing renderer keep its encoders
  and submission model while declaring an ordered graph boundary.

The levels can be mixed in one frame. See [Core concepts](docs/core-concepts.md)
for the complete ownership, content, dependency, lifetime, and execution model.

## Packages

| Package | Purpose |
| --- | --- |
| [`@zenfg/webgpu`](packages/webgpu/README.md) | TypeScript/WebGPU FrameGraph runtime |
| [`zenfg`](crates/zenfg/README.md) | Rust/wgpu FrameGraph runtime |
| [`@zenfg/snapshot`](packages/snapshot/README.md) | Normative Snapshot 1.0 types, codec, validator, Schema, and conformance corpus |
| [`zenfg-snapshot`](crates/zenfg-snapshot/README.md) | Rust Snapshot 1.0 wire model, codec, validation, and migration |
| [`@zenfg/inspector`](packages/inspector/README.md) | Renderer-independent DOM Inspector for Snapshot data |

## Start here

- Browse the [documentation index](docs/README.md).
- Start a WebGPU integration with the [`@zenfg/webgpu` quick start](packages/webgpu/README.md#quick-start)
  and its [complete TypeScript recipes](packages/webgpu/examples/README.md).
- Start a wgpu integration with the [`zenfg` quick start](crates/zenfg/README.md#quick-start)
  and its [Cargo examples](crates/zenfg/examples/).
- Open the [hosted Inspector](https://uinosoft.github.io/zenfg/inspector/),
  which runs entirely in the browser and does not upload imported snapshots.
- Explore the [hosted Playground](https://uinosoft.github.io/zenfg/playground/?example=interactive-background&panel=inspector)
  for live WebGPU showcases and package recipes, their exact TypeScript source,
  and Inspector captures.
- Read [Contributing](CONTRIBUTING.md) before changing public semantics,
  examples, or release artifacts.

## Status

ZenFG is public beta software. Public APIs may change before 1.0, so integrations
should pin exact prerelease package versions. TypeScript and Rust share semantics
and portable diagnostics, not source-level API parity. Snapshot wire format
versioning is independent from package versions; see the
[compatibility matrix](docs/compatibility.md) and [changelog](CHANGELOG.md).

## License

ZenFG is available under the [MIT License](LICENSE).
