# Contributing

ZenFG is a mixed npm and Cargo workspace. Install Node.js 24 with npm 11 and
Rust 1.98, then run:

```text
npm install
npm run build
npm run docs:check
npx tsc --project packages/webgpu/examples/tsconfig.json --noEmit
npm test
npm run test:cross-language
cargo test --workspace --all-features
cargo test --workspace --all-features --doc
cargo check --workspace --all-features --examples
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo fmt --all --check
npm run pack:check
npm run cargo:package-check
```

## Website development

Start the complete project site from a clean checkout with:

```text
npm run dev
```

This starts the single Site Vite application. It serves all MPA pages with hot
module replacement behind one development origin:

- project site: `http://127.0.0.1:5173/`;
- Inspector: `http://127.0.0.1:5173/inspector/`;
- Playground: `http://127.0.0.1:5173/playground/`.

The Site resolves the publishable package sources directly, so package `dist`
directories are not required for website development. Changes to package source
are included in the same Vite module graph.

`npm run build` builds every publishable package and the Site. `npm run
build:pages` builds the directly deployable Site tree, and `npm run
preview:pages` rebuilds and serves that tree at
`http://127.0.0.1:4173/` for a production-like check.

Keep engine-specific scene, material, pipeline, and application policy outside
the core packages. Changes to shared semantics or Snapshot V1 must update both
implementations, the normative specification, and the conformance corpus.

## Public documentation and examples

Public types, package-root exports, and callable members must have concise API
documentation that explains behavior not already evident from the signature:
ownership, lifecycle, defaults, failure conditions, and supported entrypoints.

Documentation has one primary source for each responsibility:

- keep the root `README.md` and `README.zh-CN.md` structurally aligned as the
  bilingual brand, ownership-boundary, integration-level, and navigation entry;
- maintain all package READMEs, technical documents, API documentation, and
  examples in English;
- use each published package or crate README for installation, one complete
  Quick Start, a task-oriented public API map, critical patterns, common
  mistakes, and links to complete examples;
- keep shared ownership, content, dependency, lifetime, and integration rules
  in [`docs/core-concepts.md`](docs/core-concepts.md);
- use TSDoc and rustdoc for exact signatures, fields, defaults, errors, and
  symbol-level behavior;
- keep Snapshot wire structure and cross-field semantics in
  [`packages/snapshot/SPEC.md`](packages/snapshot/SPEC.md), and package/toolchain
  support in [`docs/compatibility.md`](docs/compatibility.md).

Do not add copied global API catalogs, `AI.md`, package-specific AI manifests,
or custom machine indexes. Installed package READMEs, packaged declarations and
source, generated API documentation, and compiled examples are the supported
human and coding-agent inputs.

Examples are maintained as executable contracts, not illustrative pseudocode:

- use only public package/crate entrypoints and include every import;
- accept device-, surface-, pipeline-, and application-owned state explicitly;
- do not use test mocks, omitted-code markers, or undocumented subpaths;
- keep the eight TypeScript and Rust runtime recipes aligned by workflow while
  allowing each language to remain idiomatic;
- type-check or compile every recipe, and execute CPU-only recipes in CI.

When a public workflow changes, update its API docs, package README task map or
critical pattern, and compiled recipe in the same change. Update Core Concepts
only when the shared model changes. Before publishing, verify that npm
declaration maps resolve only to relative source paths included in the tarball
and that Rust README examples still pass as doctests.

The Site owns interactive presentation, displayed source, and embedded
Inspector integration. Package recipes and repository showcases remain
independent of the Playground shell at the source-module level. Package recipes keep their graph
declarations in host-neutral `record*` functions so Playground adapters can
compile the exact same recording with diagnostics enabled; repository showcases
may instead expose application-level start, capture, and disposal controllers.
