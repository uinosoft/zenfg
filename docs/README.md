# ZenFG documentation

ZenFG documentation is organized by responsibility. Package READMEs are the
installed quick references for their own public APIs; this directory owns the
shared model, compatibility, and maintainer-facing guides.

## Start by goal

| Goal | Start here |
| --- | --- |
| Understand what ZenFG owns and how a frame is modeled | [Core concepts](core-concepts.md) |
| Build with TypeScript and WebGPU | [`@zenfg/webgpu` README](../packages/webgpu/README.md) |
| Build with Rust and wgpu | [`zenfg` README](../crates/zenfg/README.md) |
| Produce, validate, or migrate Snapshot data | [`@zenfg/snapshot` README](../packages/snapshot/README.md) or [`zenfg-snapshot` README](../crates/zenfg-snapshot/README.md) |
| Embed or open the Inspector | [`@zenfg/inspector` README](../packages/inspector/README.md) or the [hosted Inspector](https://uinosoft.github.io/zenfg/inspector/) |
| Explore live WebGPU showcases and package recipes, their source, and captures | [Hosted Playground](https://uinosoft.github.io/zenfg/playground/?example=interactive-background&panel=inspector) |
| Check supported versions and toolchains | [Compatibility](compatibility.md) |
| Contribute or publish a release | [Contributing](../CONTRIBUTING.md) and [release process](release-process.md) |

## Sources of truth

| Information | Canonical source |
| --- | --- |
| Package installation, common tasks, and first-use pitfalls | The package or crate README shipped with that artifact |
| Complete supported workflows | The TypeScript and Cargo examples shipped with the runtime packages |
| Exact signatures, fields, defaults, and errors | Public TSDoc in packaged declarations/source and rustdoc on docs.rs |
| Ownership, content, dependency, lifetime, and integration semantics | [Core concepts](core-concepts.md) |
| Snapshot wire structure and cross-field rules | [`@zenfg/snapshot` specification](../packages/snapshot/SPEC.md) |
| Supported package, wire, and toolchain versions | [Compatibility](compatibility.md) |
| Release verification and history | [Release validation](release-validation.md) and the [changelog](../CHANGELOG.md) |

Additional maintainer documents cover the
[release process](release-process.md), the current
[release checklist](release-checklist-0.1.0-beta.2.md), and Snapshot or runtime
conformance procedures referenced by those guides.

## Documentation policy

The repository root README is maintained in English and Simplified Chinese.
Technical documents, package READMEs, API documentation, and examples are
maintained in English so semantic changes have one normative explanation.

Application-like showcases, cross-package workflows, and third-party
integrations live in private workspaces under `examples/`. Focused public API
recipes live with and ship in their owning package. The hosted Playground owns
presentation, exact-source display, and Inspector integration through
application-local catalog adapters; example implementations do not import the
Playground. See [`examples/README.md`](../examples/README.md) for the ownership
boundary.
