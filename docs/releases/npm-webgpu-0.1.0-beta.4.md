# @zenfg/webgpu 0.1.0-beta.4

Date: 2026-09-15

### Changes

- Add explicit CPU, GPU and combined execution timing, including synchronous execution total and timings for all executed node kinds.
- Export Snapshot 1.2 and capture CPU/pool counters before asynchronous GPU readback.
- Refresh packaged examples and documentation.

### Breaking API changes

- Replace the GPU-timing execute overload with executeWithTiming({ timing: "cpu" | "gpu" | "both" }). GPU results remain asynchronous.
- createFrameGraphSnapshot now requires an explicit frameIndex and accepts separate CPU/GPU reports.
- Depend exactly on @zenfg/snapshot 0.1.0-beta.4.

[Migration guide](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0-beta.4/docs/migration-timing-snapshot-1.2.md).
