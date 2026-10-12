# Rust runtime concepts

## System boundary

The graph owns declared dependencies, retention, transient allocation and diagnostics.
The application owns devices, queues, surfaces, presentation, pipelines, imported
storage and device-loss policy. Snapshot is a separate portable protocol.

## Recording and execution

Compilation consumes the recording whether it succeeds or fails. Handles and
access tokens are recording-local. The compiler keeps a stable subsequence of
recording order; it does not reorder or merge nodes. Separate frames depend on
application policy and queue order, not automatic cross-frame analysis.
A compiled frame exclusively borrows its graph and execution consumes it.
Acquire and import a fresh surface texture for every presentation frame.
Callbacks are synchronous; optional GPU readback is a separate operation.

## Resources and content

Transient storage is graph-owned and pooled; imports borrow caller-owned native
storage and are never pooled or destroyed by the graph. Import shared storage
once per composition boundary. Resolved transient objects must stay inside the
callback that receives them. Results needed later require imported storage.

### Choosing resource declaration granularity

Declare resources that express dependencies, graph allocation or observable
results. Workload-private weights, uniforms and scratch may stay internally bound.
This does not relax complete access, initialization and lifetime obligations for
graph-visible resources. Inspector counts declarations, not every shader binding
or physical GPU memory allocation.

### Content validity

Transient and surface contents start undefined. Imports require an explicit
initial-content choice. Reads and preserving writes require defined contents over
the entire normalized range. Overwrite asserts a full write on every execution
path; partial, conditional, sparse or atomic writes need preserve. Attachment
clear overwrites, load preserves, and discard undefines. Omitted view layer counts
select all remaining layers; an explicit D2 view must select one layer.

## Dependencies and retention

Read-after-write dependencies carry values and can retain producers. Other ordering
hazards do not make unreachable work observable. Roots retain final ranges for
presentation, output, readback, debug capture, persistent state or real side effects.
Undefined or discarded rooted ranges fail with FG1004, even without reports.
Identity includes resource, reason and normalized range; overlapping distinct
ranges remain independent. Empty roots are rejected. Roots do not transfer ownership
or extend transient objects beyond execution.

## Lifetime and allocation

Retained first and last accesses define transient lifetimes. Compatible allocations
with disjoint lifetimes may alias. Scopes partition aliasing and cross-execution
reuse; omitted scopes use the default domain. Scopes own no resources, require no
Drop cleanup and survive clearing. Imports and surfaces are never pool candidates.
No automatic memory budget or eviction policy is provided.

Maintain the pool between executions; frame and compiled-plan graph borrows enforce
that boundary. A non-stored FnMut eviction predicate receives callback-local borrowed
physical descriptor views. Each retained physical instance is visited once in
unspecified order. Selection finishes before mutation; unwinding leaves the pool
unchanged, but external callback side effects are not rolled back. Views expose no
GPU objects, internal keys or stable instance IDs. Clear-all keeps its existing
meaning; use info.scope.is_none() to select only the default domain.

An accepted execution ages the pool once after parameter/preflight validation.
Empty executions and subsequent failures count; acquisition resets instance age.
Compilation, maintenance, application frame indices and GPU completion do not age
it. Execution returns transients on exit, including failure. Eviction destroys native
resources without waiting for completion; wgpu defers reclamation for submitted
work. Descriptor byte estimates are not driver residency or immediate VRAM release.

## Integration levels

Use structured native passes where possible, command integration for custom work
on a graph-owned encoder, and external submission for renderers owning their
encoders. A command callback must not finish or submit the graph-owned encoder.
All declared work shares a device and queue with accurate resource access.

## Execution segments

A retained external submission closes and submits the previous graph segment,
invokes its synchronous callback, then starts the next segment. Enqueue declared
external work before returning. This orders queue submissions; it is not a GPU
completion fence and cannot roll back submitted work.

## Diagnostics boundary

Reports, timing and pool counters are optional and independent. Ordinary execution
collects no timing. CPU timing is synchronous elapsed time, not thread CPU usage;
GPU coverage is limited to retained render/compute passes. Do not sum CPU and GPU
times as frame time. Export matching reports from the same execution. Snapshot
has no GPU commands or resource contents; its wire contract belongs to Snapshot.

## Continue reading

- [Usage and complete examples](./README.md)
- [Upgrade notes](./MIGRATION.md)
- [Snapshot specification](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/packages/snapshot/SPEC.md)
