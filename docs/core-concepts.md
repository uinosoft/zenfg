# Core concepts

ZenFG is horizontal GPU scheduling infrastructure for WebGPU and wgpu. This
document defines the model shared by the TypeScript and Rust runtimes. Each
runtime keeps idiomatic language-level APIs; use its package README and generated
API documentation for exact signatures.

## System boundary

ZenFG owns the declaration, compilation, diagnostics, and execution of
graph-visible GPU work:

- logical resources, views, accesses, and dependencies;
- retention roots and dead-work culling;
- retained execution order and opaque submission boundaries;
- transient lifetime analysis, aliasing plans, and runtime pooling;
- validation and optional diagnostic reports.

The application or renderer continues to own:

- scenes, materials, cameras, pipelines, bind groups, samplers, and shaders;
- the device, queue, surface, current-texture acquisition, and presentation;
- long-lived resource policy, resource contents, resize, and device loss;
- concrete draw, dispatch, copy, and third-party renderer behavior.

```text
renderer features / compute systems / third-party engines
                         |
                  graph declarations
                         |
          @zenfg/webgpu or zenfg runtime
                         |
               WebGPU / wgpu device + queue
```

The TypeScript and Rust runtimes share semantics and Snapshot projections, not
source-level API parity. A caller should translate intent rather than method
names when moving a workflow between languages.

Snapshot is a separate protocol boundary:

- `@zenfg/snapshot` owns the normative specification, JSON Schema, fixtures,
  and conformance corpus.
- `zenfg-snapshot` is the matching wgpu-independent Rust wire model and codec.
- `@zenfg/inspector` consumes Snapshot data and has no dependency on either GPU
  runtime.
- Runtime report objects are implementation APIs; Snapshot is the portable
  interchange format.

## Recording and execution

A long-lived runtime creates a new single-use recording for each logical frame:

```text
TypeScript: FrameGraph(device) -> beginFrame() -> recorder -> compile() -> execute()
Rust:       FrameGraph          -> begin_frame() -> Frame    -> compile() -> execute(queue)
```

Compilation consumes the recording whether it succeeds or fails. Logical
handles, views, and typed access tokens belong to that recording and cannot
cross recording boundaries.

Compilation retains a stable subsequence of recording order. ZenFG may remove
unobservable work, but it does not reorder or merge nodes. There is no automatic
cross-frame dependency analysis; separate compiled frames rely on application
policy and queue submission order.

The TypeScript runtime can conditionally re-execute a compiled frame only while
every captured callback and imported native object is still valid. Rust
execution is one-shot. A compiled frame containing a current surface texture is
normally frame-scoped in either runtime: acquire, import, compile, execute, and
present a fresh current texture on the next presentation frame.

Native work is encoded and submitted synchronously. Optional GPU timing may
complete asynchronously, but it does not turn node callbacks or external
submission callbacks into asynchronous operations.

## Resources and content

ZenFG distinguishes three ownership classes:

- **Transient resources** are logical textures or buffers whose native storage
  exists only for one compiled execution. The runtime allocates and pools them.
- **Imported resources** borrow caller-owned native storage. ZenFG never
  destroys or pools that storage.
- **Surface resources** represent a freshly acquired presentation target. They
  are imported for graph visibility, but acquisition and presentation remain
  application-owned.

Import shared native storage once at the frame-composition boundary and pass the
same logical handle to every participating subsystem. State without
graph-visible data flow, such as a camera object or pipeline cache, normally
stays outside the graph.

Content validity is tracked per normalized texture subresource or buffer byte
range:

- transient and surface contents begin undefined;
- TypeScript imports begin defined unless the caller opts into undefined
  contents;
- Rust imports require an explicit initial-content choice;
- reads and preserving writes require defined contents over their complete
  declared range;
- an overwrite fully defines the declared range without consuming its previous
  value;
- preserve is required for partial, conditional, sparse, or atomic writes;
- an attachment clear overwrites, while an attachment load preserves;
- discard leaves the affected contents undefined.

The first write to a transient range must overwrite it. Declaring overwrite is a
caller assertion that every execution path fully writes the selected range;
using it for partial work makes the graph model incorrect.

Texture dependencies use normalized mip, layer, depth-slice, and aspect regions.
Buffer dependencies use byte ranges; an omitted range covers the whole buffer.

## Dependencies and retention

A logical handle identifies recording-local storage. The value visible to a
node is selected by the resource range and the node's position in recording
order.

- A read-after-write (RAW) dependency carries a produced value to a consumer.
- Write-after-read (WAR) and write-after-write (WAW) dependencies preserve
  ordering.
- Value dependencies can retain producers; ordering hazards alone do not make
  otherwise unreachable work observable.

Roots describe why a final value matters. Presentation, application output,
readback, debug capture, imported persistent state, and genuine side effects
can retain work. Compilation walks backward from those roots and culls nodes
that contribute to no observable result.

A root retains the final producer for its selected resource range. It does not
transfer ownership, extend a transient allocation beyond execution, or make a
transient native object safe to cache. Results needed after execution must live
in caller-owned imported storage.

## Lifetime and allocation

The first and last retained accesses define each transient logical lifetime.
Compatible transient resources whose lifetimes do not overlap may share one
physical allocation. The runtime materializes one native object per retained
physical allocation and returns it to the runtime pool after execution.

Imported resources never participate in transient pooling. Resolved transient
objects are valid only inside the synchronous callback that received them; they
must not escape that callback or be retained across frames.

Pool byte counts and Snapshot allocation sizes are estimates derived from ZenFG
descriptors and pool buckets. They are intended for comparison and alias
analysis, not as measurements of driver allocation, residency, alignment,
metadata, or physical video-memory use.

The pool has no automatic memory budget or eviction policy. Applications may
clear retained allocations after resize or highly dynamic descriptor phases,
and should release runtime-owned resources when the device-bound renderer stack
is destroyed.

## Integration levels

ZenFG supports three integration depths, which may be mixed in one frame.

### Native render, compute, and copy

Structured nodes describe attachments, typed resource access, and declarative
copy or clear operations. They provide the richest validation, content tracking,
and diagnostics while leaving pipelines and concrete commands caller-owned.

### Command integration

A command node lets a subsystem record custom commands into a
FrameGraph-owned encoder. The subsystem must declare every graph-visible access
and must not finish or submit that encoder. Use this for work that does not fit a
structured node but can participate in the graph-owned submission.

### Opaque external submission

An external node is for a renderer that owns its command encoders and submits
through the shared device queue. It declares graph-visible resource access but
keeps its internal commands opaque to ZenFG.

Cross-renderer composition still requires a shared device and queue, one logical
import for each shared native resource, and accurate declarations for every
graph-visible access. ZenFG does not make unrelated engine resource models
interoperable automatically.

## Execution segments

Native render, compute, copy, clear, and command nodes are encoded into
FrameGraph-owned command segments. A retained external submission closes and
submits the preceding graph segment, invokes the caller-owned submission, and
starts a new graph segment for later native work.

This boundary guarantees queue submission order. It is not a GPU-completion
fence, does not reveal the number or contents of native submissions made by the
external renderer, and cannot roll back work that was already submitted.

All graph-visible external work must be enqueued on the shared queue before the
synchronous external callback returns. Work queued later or on another queue is
outside the declared ordering model. The graphics API's completion mechanism is
still required when the CPU must wait for GPU completion.

## Diagnostics boundary

Compilation reports, optional GPU timing, and resource-pool statistics are
independent observations. Requesting reports does not change the execution plan.
Runtime report types may contain implementation-oriented details and can evolve
with that runtime.

Snapshot adapters explicitly project compatible report data into the portable
Snapshot 1.0 model. Snapshot contains graph structure, diagnostics, allocation
facts, and optional timing or pool facts; it does not contain GPU commands or
resource contents and cannot replay a frame.

The Snapshot specification and Schema define portable structure and semantics.
The Inspector is a renderer-independent consumer that builds its own indices,
views, and UI state from canonical Snapshot data. Filesystem storage, capture
naming, transport, and retention policy remain caller-owned.

## Continue reading

- [`@zenfg/webgpu` quick start and API task map](../packages/webgpu/README.md)
- [`zenfg` quick start and API task map](../crates/zenfg/README.md)
- [Snapshot 1.0 specification](../packages/snapshot/SPEC.md)
- [Compatibility](compatibility.md)
