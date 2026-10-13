# Getting started with ZenFG

<!-- generated:language:start -->
**English** | [简体中文][documentation-zh]

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

Choose a path for your application. ZenFG coordinates graph-visible GPU work;
your application owns the device, rendering policy, and presentation.

| Goal | Start here | What you will get |
| --- | --- | --- |
| Integrate TypeScript and WebGPU | [WebGPU quick start](../packages/webgpu/README.md#quick-start) | A clear-only presentation frame |
| Integrate Rust and wgpu | [Rust quick start](../crates/zenfg/README.md#quick-start) | A CPU-only compiled graph, followed by device-backed recipes |
| Read or produce Snapshot data | [TypeScript Snapshot](../packages/snapshot/README.md) or [Rust Snapshot](../crates/zenfg-snapshot/README.md) | Validated, canonical portable diagnostics |
| Embed a visual debugger | [Inspector quick start](../packages/inspector/README.md#quick-start) | A browser workbench for your captures |

<a id="before-you-start"></a>
<a id="continue-by-task"></a>

## Package documentation

Each package or crate owns its usage, concepts and upgrade instructions. Follow
the links above for version-specific guides, or browse the [online documentation](https://uinosoft.github.io/zenfg/docs/).

<a id="api-reference"></a>

For exact APIs, follow each package README to its included types/source or Rust
API documentation. The [development TypeScript API](https://uinosoft.github.io/zenfg/docs/api/)
is generated from public source comments.

## Versions and contributing

The website follows the development branch. Installed READMEs, packaged examples,
and per-package release tags preserve documentation for published versions.
Review the [migration from 0.1.0](migration-0.2.0.md) before upgrading runtime
or Inspector APIs. See the [Snapshot 1.2 timing migration](migration-timing-snapshot-1.2.md)
for older beta captures and the [changelog](../CHANGELOG.md) for per-package changes.

For repository work, read [Contributing](../CONTRIBUTING.md), the
[documentation workflow](documentation.md), and the [release process](release-process.md).
