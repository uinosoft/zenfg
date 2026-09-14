# Unified execution timing and Snapshot 1.2

This source change precedes the next package release; it does not rename or
retroactively change beta.3. Pin and upgrade producer and consumer packages together.

## Runtime calls

TypeScript replaces `compiled.execute({ gpuTiming: true })` with
`compiled.executeWithTiming({ timing: 'gpu' }).gpu!`. Choose `'cpu'` or `'both'`
to collect CPU elapsed time. The returned object is synchronous; only its GPU
Promise is asynchronous. Keep existing frameIndex and submission hooks.
Rust replaces `execute_with_gpu_timing(queue, options)` with
`execute_with_timing(queue, options, TimingMode::Gpu)`, then takes the `gpu`
readback. `TimingMode::Cpu` and `Both` provide an immediate owned CPU report.
Consume the returned GPU Promise with `await` or a rejection handler, including
during application shutdown. An asynchronous lifecycle/readback failure follows
the existing GPU contract even after synchronous execution succeeded.
No compatibility aliases or GPU overloads remain. Plain execution collects no timing.

## Snapshot inputs

TypeScript `createFrameGraphSnapshot` now requires an explicit `frameIndex`.
Both `cpuTiming` and `gpuTiming` are optional; Rust adds `cpu_timing` to its
existing explicit-frame options. Save CPU, compilation and pool counters right
after execution, before awaiting GPU readback. All provided reports must describe
the same compiled frame and carry the same caller-defined frame index.

## Files and Inspector providers

Writers emit 1.2 with required CPU and GPU availability records. Decoders validate
1.1 using its old rules before migrating to 1.2; CPU becomes not-collected.
Legacy V0 and Candidate V1 remain readable. Canonical 1.0 and unknown versions
remain rejected. Validation/stringification alone never perform migration.
Existing migration provenance and extensions survive the upgrade.

Inspector providers receive `{ timing: 'cpu' | 'gpu' | 'both' }` and must forward
it through intermediate adapters. Direct showcase capture calls default to both;
coalesced requests retain the first request's mode. Inspector's Capture action
always requests both; the UI has no timing selector. Programmatic runtime and host
APIs still accept CPU-only or GPU-only requests. Imported files keep their captured
data. CPU-only captures must work without timestamp-query support.

## Interpreting CPU values

CPU means synchronous elapsed time, including local setup/cleanup and external
submission callbacks. Shared preparation, submission and resource release appear
in execute total. Recording, compilation, GPU wait and snapshot/UI work are
outside that total. Thread preemption and GC can affect values; a microsecond
unit is not a precision guarantee. No partial report is returned after failure.
