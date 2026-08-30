# Contributing

ZenFG is a mixed npm and Cargo workspace. Install Node.js 24 with npm 11 and
Rust 1.98, then run:

```text
npm install
npm run build
npm test
npm run test:cross-language
cargo test --workspace --all-features
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
