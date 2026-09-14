# FrameGraph Compile Benchmark

This CPU-only diagnostic benchmark measures `FrameGraphRecorder.compile()`, a
production-style compile followed by one execute, or repeated execution of one
compiled frame. Fresh-graph modes record before starting the timer, so graph
declaration cost is excluded. It uses `process.hrtime.bigint()` and nearest-rank
percentiles.

Run every scenario in compact and report modes with the default realistic profile:

```sh
npm run benchmark:compile --workspace @zenfg/webgpu
```

Available options are `--profile realistic|small|medium|large`,
`--scenario linear-chain|buffer-ranges|texture-subresources|allocation-aliasing`,
`--mode compact|report|both`, `--warmup <positive integer>`, and
`--samples <positive integer>`. Use
`--operation compile-only|compile-execute|record-compile-execute|execute-repeated|all` to isolate
lifecycle stages.

The profiles contain 12, 64, 256, and 1024 body nodes respectively. The realistic
profile approximates the retained-node count of current application graphs; the
other profiles are stress diagnostics. The scenarios
exercise an ordered texture dependency chain with dead-node culling, fragmented
buffer producer ranges, texture-subresource fan-in, and transient allocation
first-fit reuse. Report mode includes diagnostic report construction; compact
mode does not.

Results are stable JSON written to stdout. They are local observations, not a
committed baseline or CI performance gate. The generated runner exists only
temporarily under the ignored `.benchmark-dist/` directory.

Use `--cpu-timing off|on` to compare ordinary execution with synchronous CPU
collection. This flag has no effect on `compile-only`. Keep GPU waiting, UI and
serialization outside execution samples. The Rust counterpart is
`cargo run --release --example cpu-timing-bench -p zenfg`; it uses a noop device.

The [CPU timing acceptance review](timing-review-2026-09-14.md) records the
five-round baseline, off/on results and hardware browser observations.
`compare-timing.mjs <baseline-ref>` compares old/current disabled runtimes without
changing the checkout. `browser-timing.mjs` uses the site server at port 5174
(or `TIMING_URL`) and saves JSON to `TIMING_OUTPUT` or a temporary directory.
