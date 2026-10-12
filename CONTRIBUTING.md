# Contributing

ZenFG uses pnpm for its JavaScript workspace and Cargo for Rust. Install Node.js
24 (the CI patch version is in .node-version), pnpm 12.11.2 and Rust 1.98, then run:

```text
pnpm install --frozen-lockfile
pnpm run build
pnpm run docs:check
pnpm run typecheck
pnpm test
pnpm run test:cross-language
cargo test --locked --workspace --all-features
cargo test --locked --workspace --all-features --doc
cargo check --locked --workspace --all-features --examples
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo fmt --all --check
pnpm run pack:check
pnpm run cargo:package-check
```

Workspace Cargo checks use the committed `Cargo.lock` with `--locked`, including
the Rust producer launched by `pnpm run test:cross-language`. Intentional dependency
changes must update and commit `Cargo.lock` explicitly; do not remove `--locked`
to bypass a failure. Formatting does not resolve dependencies. The packaging
bootstrap and temporary consumer exceptions are described in
[the release process](docs/release-process.md).

See the [testing guide](docs/testing.md) for the local/CI/release test matrix,
manual browser WebGPU acceptance commands, and the coverage boundaries of the
TypeScript mock and Rust noop test layers.

## Workspace dependencies and tool ownership

Keep one JavaScript lockfile, `pnpm-lock.yaml`. Intentional dependency changes
update it explicitly; CI uses `pnpm install --frozen-lockfile`. pnpm 12 may store
multiple YAML documents in this file. Do not parse only its first document.

Internal JavaScript dependencies use exact `workspace:VERSION` references. When
Snapshot changes version, update every source workspace reference, including root
tools and private apps. Package versions and publication selection remain independent;
a dependent with changed shipped metadata needs its own version bump before publishing.

pnpm runs workspace builds in dependency order and packs the npm artifacts. The
root test runner remains a single aggregator because its output directory is shared.
The pinned npm CLI is used only for registry uploads and isolated npm consumers.
Cargo retains its lockfile, rustup toolchain, compilation and publication. Experimental
pnpm Cargo integration and pipeline task caching are disabled.

## TypeScript test coverage

`pnpm run typecheck` is the CI entrypoint. It checks the script Node tests,
package examples, each package's source/tests, and the Site source/tests once
per existing project. Site Node tests and their imported helpers share the
strict Site configuration; `vite/client` types cover `?raw` and `?url` imports.
The ES2023 library includes the array APIs used by Node 24 tests.

The Site test roots covered by that configuration are:

- `apps/site/tests`
- `apps/site/playground/tests`
- `apps/site/examples/babylon-interop/tests`
- `apps/site/examples/babylon-lite-interop/tests`
- `apps/site/examples/interactive-background/tests`
- `apps/site/examples/particles4all-framegraph/tests`
- `apps/site/examples/reference-renderer/tests`
- `apps/site/examples/reference-renderer-demo/tests`
- `apps/site/examples/refractive-flow/tests`
- `apps/site/examples/three-interop/tests`
- `apps/site/examples/typegpu-monocular-light-injection/tests`
- `apps/site/examples/typegpu-slime-mold/tests`

`apps/site/inspector/tests` is also configured for future Node tests; currently
it contains only browser acceptance files. `tests/browser/**` and
`tests/gpu/**` stay outside Node typechecking and the default test runner.
Test helpers such as `browserEnvironment.ts` still run under Node and are checked.
TypeGPU source remains typechecked as TypeScript; esbuild and the TypeGPU plugin
perform its runtime transformation during `pnpm test`. Pinned upstream JavaScript
keeps its existing explicit import boundaries rather than enabling JavaScript
checking across third-party source.

## TypeScript formatting and static rules

Keep the current TypeScript checks and test/build gates; no additional formatter
or linter is required at present. TypeScript strict and unused-symbol checks
cover type errors, while runtime tests cover asynchronous ownership and cleanup.
Neither TypeScript nor EditorConfig proves that every Promise rejection is handled.
Review detached async work for an explicit owner and failure path; `void` alone
is not error handling. Keep type-only dependencies as `import type`.

Use EditorConfig for new files. Preserve surrounding formatting for small edits
to existing files, and avoid whole-file or repository-wide formatting changes
mixed with functional fixes. Existing indentation is inconsistent; EditorConfig
is an editor preference, not an enforced formatting gate.

Reassess tooling when formatting repeatedly causes review or merge overhead,
when confirmed unhandled Promises recur despite tests/review, or when a concrete
import/API boundary repeatedly regresses. Trial one tool against that specific
problem, measure false positives and local/CI cost on Windows, and initially
scope enforcement to an agreed directory or new code. Keep formatting-only
migration separate. Preserve explicit TypeGPU shader transformation boundaries
and exclude pinned upstream code from automatic rewriting.

## Website development

Start the complete project site from a clean checkout with:

```text
pnpm run dev
```

This starts the Site Vite application and VitePress documentation service,
with the documentation proxied behind one development origin:

- project site: `http://127.0.0.1:5173/`;
- documentation: `http://127.0.0.1:5173/docs/`;
- Inspector: `http://127.0.0.1:5173/inspector/`;
- Examples: `http://127.0.0.1:5173/playground/`.

The Site resolves the publishable package sources directly, so package `dist`
directories are not required for website development. Changes to package source
are included in the same Vite module graph.

`pnpm run build` builds every publishable package and the Site. `pnpm run
build:pages` builds the directly deployable Site tree, and `pnpm run
preview:pages` rebuilds and serves that tree at
`http://127.0.0.1:4173/zenfg/` for a production-like check.

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
- use a simple package README as its usage source; complex package READMEs own
  installation and navigation to package-local guides containing the complete
  Quick Start, lifecycle, task map, patterns, common mistakes and examples;
- keep ownership, content, dependency, lifetime, integration and upgrade contracts
  beside the implementing package or crate; root docs own navigation, planning,
  contribution, testing and release maintenance;
- use TSDoc and rustdoc for exact signatures, fields, defaults, errors, and
  symbol-level behavior;
- keep Snapshot wire structure and cross-field semantics in
  [`packages/snapshot/SPEC.md`](packages/snapshot/SPEC.md), and package/toolchain
  release compatibility inventory generated from manifests in [`docs/compatibility.md`](docs/compatibility.md).

Do not add copied global API catalogs, `AI.md`, package-specific AI manifests,
or manually maintained machine indexes. Package Skills are tracked deterministic
extracts of marked package usage regions; do not edit their bodies or duplicate
reference documents. Generated per-page Markdown and
`llms.txt` are derived from the website content map and are supported formats.
See [Documentation maintenance](docs/documentation.md) for generation and source ownership. Installed package READMEs, packaged declarations and
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
critical pattern, and compiled recipe in the same change. Update the owning
package concepts when its model changes. Before publishing, verify that npm
declaration maps resolve only to relative source paths included in the tarball
and that Rust usage examples still pass as crate-level doctests.

The Site owns interactive presentation, displayed source, and embedded
Inspector integration. Package recipes and repository showcases remain
independent of the Examples shell at the source-module level. Package recipes keep their graph
declarations in host-neutral `record*` functions so Examples adapters can
compile the exact same recording with diagnostics enabled; repository showcases
may instead expose application-level start, capture, and disposal controllers.
