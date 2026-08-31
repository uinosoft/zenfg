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

Start the standalone Inspector development page from a clean checkout with
`npm run dev:inspector`.

Keep engine-specific scene, material, pipeline, and application policy outside
the core packages. Changes to shared semantics or Snapshot V1 must update both
implementations, the normative specification, and the conformance corpus.

## Public documentation and examples

Public types, package-root exports, and callable members must have concise API
documentation that explains behavior not already evident from the signature:
ownership, lifecycle, defaults, failure conditions, and supported entrypoints.
Keep [`docs/quick-reference.md`](docs/quick-reference.md) as the compact shared
semantic and name-mapping source; package READMEs must remain usable on their
own after publication and link back to it for cross-language guidance.

Examples are maintained as executable contracts, not illustrative pseudocode:

- use only public package/crate entrypoints and include every import;
- accept device-, surface-, pipeline-, and application-owned state explicitly;
- do not use test mocks, omitted-code markers, or undocumented subpaths;
- keep the seven TypeScript and Rust recipes aligned by workflow while allowing
  each language to remain idiomatic;
- type-check or compile every recipe, and execute CPU-only recipes in CI.

When a public workflow changes, update its API docs, relevant README or Quick
Reference entry, and compiled recipe in the same change. Before publishing,
verify that npm declaration maps resolve only to relative source paths included
in the tarball and that Rust README examples still pass as doctests.
