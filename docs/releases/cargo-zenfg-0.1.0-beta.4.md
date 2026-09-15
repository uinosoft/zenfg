# zenfg 0.1.0-beta.4

Date: 2026-09-15

### Changes

- Add CPU, GPU and combined execution timing with an immediate owned CPU report.
- Export Snapshot 1.2 and preserve same-frame CPU/pool facts before GPU readback.
- Update public examples and documentation.

### Breaking API changes

- Replace execute_with_gpu_timing with execute_with_timing and TimingMode; take the optional GPU readback from its result.
- Snapshot export options add cpu_timing. Every supplied timing report must describe the same frame.
- Depend exactly on zenfg-snapshot 0.1.0-beta.4 when the snapshot feature is enabled.

[Migration guide](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0-beta.4/docs/migration-timing-snapshot-1.2.md).
