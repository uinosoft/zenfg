# Particles4All FrameGraph

This private showcase adapts [Particles4All](https://github.com/matsuoka-601/Particles4All)
to native ZenFG compute, render, and copy nodes. Its purpose is to demonstrate
FrameGraph scheduling, resource contents, persistent state, transient allocation,
and inspection while preserving the upstream fluid simulation and appearance.

The four display modes are Particles, Surface mesh, Ray march, and SSFR. Small,
Medium, and Large presets, rigid bodies, pouring, pointer forces, body dragging,
INI import, and environment upload are retained. The default is Small with SSFR
at a render scale of 0.4. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
for the fixed source revision and asset licenses.

## Ownership and recording

`new Particles4All({ device, viewport, outputFormat, initialSettings })` creates
the workload. It owns its camera, pipelines, bind groups, simulation state,
environment, and readback buffers. It accepts a caller-owned device and never
requests a device, acquires a canvas texture, or submits work itself.

`recordFrameGraph(recording, { color, deltaTime })` records one frame and returns
`{ transientResourceKey, commit(), discard() }`. Compile and execute synchronously, and call `commit()`
from ZenFG's successful `afterSubmit` callback. Call `discard()` when abandoning
a recorded frame or after compilation, encoding, or submission fails. Recording
errors release pending state internally. Settlement methods are idempotent and
scoped to their frame. Settings, resize, reset, camera operations, body dragging,
pour toggles, and environment changes require an idle workload; they reject calls
while a recorded frame is pending. Pointer impulses may accumulate for the next
frame. Workload `dispose()` leaves the caller-owned device alive.

The returned `transientResourceKey` describes the resources prepared for that
recording. The browser host compares it with the previous frame and calls
`graph.clearResourcePool()` when it changes, after recording and before compilation.
At that point execution has not begun, so obsolete retained allocations can be
released safely. This handles every intermediate box size and newly poured
particle count, even without another UI change, while stable frames reuse their
allocations. Callers embedding the workload should follow the same pattern.

Simulation initialization, prediction, spatial grid construction, constraint
iterations, rigid body updates, velocity, and pouring remain individually named
nodes under diagnostic groups. Render branches add surface reconstruction,
anisotropy, SSFR splats and filtering, or ray compositing as needed. All commands
are encoded into graph-provided passes; there is no private simulation submission.

Resource registration occurs inside the corresponding diagnostic scope:
shared persistent imports remain outside the stage groups, solver scratch and pour
uploads to Simulation, statistics and pose readbacks to Diagnostics, and branch
intermediates and triangle readbacks to Render. Initialization and drag preparation
are part of Simulation. The host's backbuffer remains outside the workload scope.
Simulation, Diagnostics, and Render are top-level groups; there is no outer
Particles4All group to expand before exploring the stages. Shared state stays
visible between them. Collapsing a stage also collapses its resource declarations. Groups
do not restrict execution, retention, or transient reuse across stages.

Resource declarations follow the
[resource granularity guidance](../../docs/core-concepts.md#choosing-resource-declaration-granularity):

- GPU-written data shared between nodes is explicitly declared. Particle state
  uses `markPersistentState()` with active byte ranges; unused pour capacity is
  not a retention root. Readback buffers use `markReadback()`.
- Simulation scratch, surface buffers, and screen-space intermediate textures
  are graph transient resources. Their lifetimes and physical allocation are
  visible in Inspector. Resolved transient resources and their bind groups are
  used only during execution.
- CPU-written uniforms, fixed geometry, boundary samples, and environment maps
  stay internal bindings. These are still allocated, updated, and released by
  the workload, but add no dependencies between graph nodes.

Content declarations distinguish full overwrite from preserving sparse/atomic
writes. Grid scans overwrite only their generated prefixes: `(nCells + 1) * 4`
bytes for cell starts and `(ceil(nCells / 256) + 1) * 4` bytes for scan blocks.
Their internal dispatches do not require a graph read of the previous scan's
values. Native allocation padding stays outside these accesses and roots.
Render nodes read active particle, rigid-body, and grid ranges, including newly
poured particles. A preserving storage write already consumes prior contents,
so it does not need a duplicate storage read over the same range.

State parity, simulation time, particle count, pouring, and pointer
impulses settle only after submission. Readback starts afterward; scene replacement
and disposal invalidate results from older generations.

Surface fields declare only the cells written by the shaders. The surface vertex
count is GPU-generated, so the transient vertex buffer is cleared before its
preserving write; indirect drawing consumes the generated prefix. This additional
clear makes the graph's declared contents valid and adds buffer bandwidth cost
to the surface mesh paths.

## Upstream fidelity

The vendored JavaScript and WGSL stay reviewable against upstream. Integration
uses TypeScript and has no `@t3d-next/*` or TypeGPU dependency. Presets derive from
the bundled upstream INI files instead of manually duplicated preset tables.

The renderer preserves the upstream `depth24plus`, forward depth comparison,
clear value 1, projection, and reconstruction conventions. Rendering targets
the caller's canvas format directly. The migration adds no reverse-z conversion,
HDR presentation stage, or extra tone mapping. SSFR floating-point working
textures retain the formats required by the original algorithm.

The simulation preserves fixed timesteps and a time bank. The host limits raw
frame gaps before the workload applies `timeScale`. Pouring is recorded after
each advancing simulation substep so subsequent substeps see newly added particles.
Repository adaptations concern graph integration, resource lifecycle, browser
hosting, and error handling rather than a redesign of the rendering algorithms.

## Browser host and Playground

`startParticles4All(canvas, options)` provides a standalone browser host and
returns a controller for settings, scene operations, statistics, Snapshot capture,
and disposal. The host owns its device, RAF loop, current canvas texture, resize,
visibility handling, and execution. Playground owns Tweakpane, file pickers, and
the source viewer; this package has no Playground dependency.

Open `/playground/?example=particles4all-framegraph`. Orbit, pan, and zoom use
the canvas controls; Space toggles pause. Pointer forces, pouring, and body
dragging can be adjusted in the controls. Advanced simulation and optical
parameters are grouped separately from scene controls.

INI input is parsed and validated before changing the scene. Unsupported fields
and environment filenames are reported; a filename in an INI file does not
start a network request. A programmatic sky is available immediately. The bundled
Quarry Cloudy panorama loads in the background, and users can replace or clear it.
Failed environment loads preserve the current environment; obsolete async results
are ignored.

WebGPU and workgroups of 256 threads are required. The host requests buffer limits
up to the device's capabilities and a 1 GiB ceiling; actual scene and surface
capacity are checked before replacement. Box resizing also checks intermediate
shapes where the longest axis changes. A discarded resize frame retains its
pending deformation until successful submission before advancing another step.
The upstream scatter split does not
require a 16-storage-buffer device. GPU timestamps are optional.

Inspector captures a real frame, including while simulation is paused. Native
node labels, access ranges, retention roots, and transient lifetimes provide the
primary evidence of the integration. Rendering does not continuously create a
full compilation report unless capture requests it.

## Validation

See [VALIDATION.md](./VALIDATION.md) for the migration run, browser coverage,
upstream comparisons, and hardware configurations still to verify.

```sh
npm run test --workspace @zenfg-example/particles4all-framegraph
npm run typecheck
npm test
npm run build:pages
npm run docs:check
```

Workload tests use the real FrameGraph compiler and a fake WebGPU device that
executes encode callbacks and checks host buffer operations. They cover all four
render branches, initial/stable/paused frames, odd/even constraint iterations,
no-body scenes, pouring, filter controls, roots and byte ranges, frame settlement,
single-particle and sparse-write ranges, failure recovery, and device-capacity
rejection. These tests do not execute WGSL or establish visual or numerical
equivalence.

Browser acceptance must compare the original and migrated demo with matching
preset, camera, environment, and effective render resolution. Check all four
modes, rigid body buoyancy, pouring, pointer interaction, resize, pause/resume,
environment replacement, and repeated Playground/Inspector switching. Record
actual hardware and WebGPU validation errors; do not infer GPU results from the
fake-device tests.
