# Cross-language producer corpus

The seven cases in `manifest.json` are recorded independently through the
public TypeScript/WebGPU and Rust/wgpu FrameGraph APIs. The harness validates
both raw Snapshot V1 files in both language implementations, checks each
producer for deterministic output, and compares a language-neutral semantic
projection with the reviewed golden files.

The projection deliberately omits producer, capture, timing, pool history,
estimated byte sizes, compatibility-key spelling, and graph-local numeric IDs.
It preserves descriptor semantics, debug-group hierarchy and membership,
compile state, exact access ranges, dependencies, roots, execution segments,
retained lifetimes, and physical-allocation equivalence classes.
Redundant ordering edges are folded into a value edge for the same
source/target/resource tuple because the value edge already imposes that order.

Run the corpus from the workspace root with `npm run test:cross-language`.
Generated raw files, projections, and failure diagnostics live only under
`.test-dist/cross-language`.
