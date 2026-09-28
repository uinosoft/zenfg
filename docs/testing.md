# Testing Guide

ZenFG uses deterministic unit and contract tests as its required test layer.
Browser WebGPU and engine interop tests are separate acceptance tests because
they require a usable browser adapter and may depend on a particular driver,
browser channel, or external demo asset.

## Test layers

| Layer | Main coverage | Runs in pull request CI |
| --- | --- | --- |
| TypeScript Node tests | FrameGraph logic using mock WebGPU objects, Snapshot, Inspector, examples, and scripts | Yes, through `npm test` |
| Rust tests | CPU graph compilation, `wgpu::Device::noop()` execution and validation, pool, timing, UI contracts, and examples | Yes, through `cargo test --workspace --all-features` |
| Cross-language conformance | TypeScript/Rust Snapshot producers, validators, and golden projections | Yes |
| Playwright docs browser test | Documentation routes, links, search, theme, layout, responsive behavior, and page errors | Yes; this is not a WebGPU test |
| Browser WebGPU acceptance | Real `navigator.gpu`, browser resource creation, command submission, readback, device loss, and application rendering | No; run manually when relevant |
| GPU engine interop | Integration with Three.js, Babylon.js, PixiJS, PlayCanvas, and other real renderers | No; run manually for the changed integration |
| Release consumer checks | Packed npm/Cargo artifacts and installed-package consumers | Yes in release preflight; registry verification runs in publish workflow |

The Rust execution tests use wgpu's noop backend. This exercises the wgpu API
and validation path without requiring a physical GPU or driver, but it does not
test Vulkan/Metal/DX12 backend behavior, shader execution, or hardware readback.
TypeScript package tests use mock WebGPU objects and likewise do not replace the
manual browser acceptance tests.

There is currently no scheduled/nightly GPU workflow. CI's Playwright job runs
ordinary Chromium page tests; it does not request an adapter or execute WebGPU.

## Local development

Run all default Node tests:

```sh
npm test
```

Run a focused package test set:

```sh
npm test -- packages/webgpu/tests
npm test -- packages/snapshot/tests
npm test -- packages/inspector/tests
```

Run type, documentation, and build checks:

```sh
npm run typecheck
npm run docs:check
npm run docs:test
npm run build
```

Run Rust tests and static checks:

```sh
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-features
cargo test --locked --workspace --all-features --doc
cargo check --locked --workspace --all-features --examples
```

Run cross-language Snapshot conformance:

```sh
npm run test:cross-language
```

`npm test` discovers Node `.test.ts` files only. Directories named `browser`
and `gpu` are deliberately excluded and their scripts must be run explicitly.

## Pull request CI

The required checks are defined in `.github/workflows/checks.yml` and include:

- TypeScript typechecking, default Node tests, package/site build, docs checks,
  and package archive validation;
- Playwright Chromium checks for the generated documentation site;
- Rust formatting, Clippy, workspace tests, doctests, and example compilation;
- TypeScript/Rust cross-language conformance;
- release smoke, package checks, and isolated package consumers.

No job currently installs a GPU runtime or hardware runner. A passing CI run
therefore establishes deterministic graph, API-validation, contract, packaging,
and ordinary browser-page behavior, not compatibility with every native GPU
driver.

## Browser and WebGPU acceptance

For site changes, build and serve the production-like pages in one terminal:

```sh
npm run preview:pages
```

The preview is served at `http://127.0.0.1:4173/zenfg/`. Set the URL explicitly
because the general browser scripts default to the development site port:

```powershell
$env:CONTENT_URL = "http://127.0.0.1:4173/zenfg/"
$env:HOME_URL = "http://127.0.0.1:4173/zenfg/"
$env:EXAMPLES_URL = "http://127.0.0.1:4173/zenfg/playground/"
node apps/site/tests/browser/content.mjs
node apps/site/tests/browser/home.mjs
node apps/site/tests/browser/interaction.mjs
node apps/site/inspector/tests/browser/timing.mjs
```

Playground acceptance scripts use the Examples preview, normally
`http://127.0.0.1:4173/zenfg/playground/`:

```powershell
$env:EXAMPLES_URL = "http://127.0.0.1:4173/zenfg/playground/"
node apps/site/playground/tests/browser/layout.mjs
node apps/site/playground/tests/browser/runtimeStatus.mjs
node apps/site/playground/tests/browser/runtimeOverlay.mjs
node apps/site/playground/tests/browser/fullscreen.mjs
```

These tests launch a local browser with WebGPU enabled. WebGPU acceptance needs
a browser and adapter that can create a device; `--enable-unsafe-webgpu` does not
provide an adapter when the machine or browser has no usable backend. Some
example tests also fetch external models or other assets. Use `GPU_TEST_BROWSER`
or the script-specific `GPU_TEST_CHANNEL` when the default browser is unavailable.

For renderer interop changes, run the matching project test rather than every
GPU suite. Examples include:

```sh
node apps/site/examples/three-interop/tests/gpu/run.mjs
node apps/site/examples/babylon-lite-interop/tests/gpu/run.mjs
node apps/site/examples/pixi-interop/tests/gpu/run.mjs
```

See each example's `tests/gpu/README.md` for browser, adapter, environment, and
asset requirements. GPU tests are acceptance checks, not performance benchmarks
or portable CI tests.

## Release verification

The publish workflow reruns the required checks before preparing packages. To
run the local preflight and package consumers:

```sh
npm run pack:check
npm run cargo:package-check
npm run release:smoke
npm run release:check
npm run release:test
npm run release:assess
```

Registry visibility, artifact integrity, provenance, and final publication are
handled by the manually dispatched publish workflow. These checks do not run
hardware WebGPU acceptance; run the relevant browser or renderer suite before
release when GPU-facing behavior changed.

## Validation scope

ZenFG validates deterministic graph contracts and device-independent descriptor
structure before native allocation where practical. Device features, limits,
format capabilities, native render-pass compatibility, and backend-specific
behavior remain the responsibility of WebGPU or wgpu. Browser WebGPU accepts
sample counts 1 and 4; native wgpu can support additional counts when the format
and selected backend permit them, so ZenFG does not impose the browser-only
sample-count restriction on its Rust API.

`TRANSIENT_ATTACHMENT` is defined by newer WebGPU specifications and wgpu, but
is not currently part of ZenFG's supported graph usage contract. It is not the
same as a ZenFG transient resource. ZenFG does not infer or enable it, and
explicit use is rejected because Snapshot 1.2 does not encode that usage flag.
