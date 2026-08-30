# Architecture

ZenFG is horizontal GPU scheduling infrastructure. It owns the declaration,
compilation, diagnostics, and execution of graph-visible work. It does not own
scene graphs, materials, pipelines, bind groups, cameras, resource contents,
surface acquisition, or presentation.

```text
renderer features / compute systems / third-party engines
                         |
                  graph declarations
                         |
          @zenfg/webgpu or zenfg runtime
                         |
               WebGPU / wgpu device + queue
```

The TypeScript and Rust runtimes intentionally expose idiomatic APIs for their
languages. Their contract is shared semantics and Snapshot projections, not
source-level API parity.

The protocol boundary is independent of either GPU runtime:

- `@zenfg/snapshot` is the normative specification, Schema, fixtures, and
  conformance corpus.
- `zenfg-snapshot` is the `wgpu`-free Rust wire model and matching codec.
- `@zenfg/inspector` consumes only Snapshot data plus Cytoscape and ELK.
- `apps/inspector` is a static, backend-free file viewer.

The two runtimes may evolve and publish independently. Snapshot compatibility
is governed separately by its `{ major, minor }` wire version.
