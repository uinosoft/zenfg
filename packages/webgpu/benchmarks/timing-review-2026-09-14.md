# CPU timing performance review — 2026-09-14

Local acceptance measurements, not CI time thresholds or release guarantees.

## Environment and protocol

- Windows 10.0.19045, Intel(R) Core(TM) i9-10940X CPU @ 3.30GHz, 28 logical processors.
- Node v24.19.0; Rust 1.98.0, release build; noop wgpu device.
- Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0; NVIDIA Turing; timestamp-query supported.
- Pre-change reference: 3cf7e0e713e60d46a8d38807791ca02106ac532b. Its five-round baseline was saved before runtime edits.
- Node and Rust: 100 warmup / 300 measured executions per round; five rounds with alternating off/on order. Four Node scenarios, compact and report compilation, 12/64/256/1024 body nodes.
- A second Node comparison loads old and current runtime bundles in one process, interleaves them for five rounds, and uses 1000 warmup / 1000 measured executions to investigate JIT and process noise.
- Browser: five alternating off/CPU/both rounds (native graph rotates modes per execution; interop rotates per RAF sample block), 50 warmup / 100 measured executions per mode. 12 native render passes (128×128), and the actual Three.js interop host (320×180), hosted on a dedicated blank page with no background application. 749 interop GPU readbacks were available; 1 were unavailable (best-effort GPU collection).
- Tables report the median of five round medians and the median of five round P95s, in microseconds. P95 uses nearest rank; percentages use rounded displayed medians only for presentation.
- Execution timers include return-object construction (a conservative caller-visible cost). Recording, compilation, UI, serialization and asynchronous waits are outside timers. Rust compiles each consumed frame before starting its timer. Browser native passes wait for GPU completion outside the timer; interop retains its real RAF submission cadence and consumes every readback Promise.

## Disabled-path verification

Deterministic private-clock tests prove zero CPU clock reads for ordinary/GPU-only execution and exactly 2N+2 for successful CPU collection. Source inspection confirms the disabled branch allocates neither CPU durations nor a CPU report; ordinary TS execution does not create a timing-result object.

The initial separate-process sweep showed some small upward movements. After additional warmup, every old/current pair below has overlapping five-round median ranges. There is no demonstrated regression outside this run's variability; this does not establish an exact zero overhead bound. Small retained-node workloads remain sensitive to clock quantization, JIT and scheduling.

| Nodes | Scenario / compile mode | Old P50 / P95 | Current off P50 / P95 | Δ P50 | Relative | Old / current P50 ranges |
|---:|---|---:|---:|---:|---:|---|
| 12 | linear-chain / compact | 4.20 / 5.00 | 4.50 / 5.20 | 0.30 | 7.1% | 4.20–5.30 / 4.20–5.40 |
| 12 | linear-chain / report | 4.30 / 5.10 | 4.30 / 5.10 | 0.00 | 0.0% | 4.10–5.10 / 4.20–5.60 |
| 12 | buffer-ranges / compact | 2.40 / 3.00 | 2.40 / 3.00 | 0.00 | 0.0% | 2.20–2.80 / 2.30–3.10 |
| 12 | buffer-ranges / report | 2.30 / 2.90 | 2.40 / 3.00 | 0.10 | 4.3% | 2.30–2.90 / 2.30–3.10 |
| 12 | texture-subresources / compact | 3.20 / 3.80 | 3.20 / 3.80 | 0.00 | 0.0% | 3.10–4.20 / 3.10–4.00 |
| 12 | texture-subresources / report | 3.20 / 3.80 | 3.10 / 3.70 | -0.10 | -3.1% | 3.00–5.20 / 3.10–3.20 |
| 12 | allocation-aliasing / compact | 2.80 / 3.40 | 2.90 / 3.50 | 0.10 | 3.6% | 2.70–3.00 / 2.80–2.90 |
| 12 | allocation-aliasing / report | 2.90 / 3.40 | 2.80 / 3.50 | -0.10 | -3.4% | 2.70–2.90 / 2.80–3.00 |
| 64 | linear-chain / compact | 12.30 / 14.20 | 12.50 / 17.70 | 0.20 | 1.6% | 10.30–13.20 / 10.80–12.90 |
| 64 | linear-chain / report | 12.40 / 14.50 | 12.50 / 15.10 | 0.10 | 0.8% | 11.40–13.20 / 12.30–13.40 |
| 64 | buffer-ranges / compact | 8.40 / 10.30 | 8.50 / 10.20 | 0.10 | 1.2% | 7.90–8.90 / 8.00–9.10 |
| 64 | buffer-ranges / report | 8.30 / 9.70 | 8.60 / 10.10 | 0.30 | 3.6% | 8.00–8.80 / 8.20–9.00 |
| 64 | texture-subresources / compact | 9.80 / 11.40 | 9.90 / 11.70 | 0.10 | 1.0% | 9.30–10.50 / 9.50–10.50 |
| 64 | texture-subresources / report | 10.00 / 11.60 | 9.90 / 12.90 | -0.10 | -1.0% | 9.20–10.50 / 9.20–10.40 |
| 64 | allocation-aliasing / compact | 11.00 / 12.90 | 11.40 / 14.90 | 0.40 | 3.6% | 9.80–11.70 / 10.50–11.60 |
| 64 | allocation-aliasing / report | 11.30 / 13.00 | 11.10 / 13.20 | -0.20 | -1.8% | 10.60–11.50 / 10.80–11.60 |
| 256 | linear-chain / compact | 47.30 / 63.40 | 47.10 / 62.20 | -0.20 | -0.4% | 47.10–47.70 / 44.40–47.50 |
| 256 | linear-chain / report | 47.60 / 61.40 | 47.30 / 62.70 | -0.30 | -0.6% | 44.80–48.40 / 46.00–47.40 |
| 256 | buffer-ranges / compact | 33.00 / 46.20 | 32.50 / 45.10 | -0.50 | -1.5% | 32.30–33.60 / 31.40–33.90 |
| 256 | buffer-ranges / report | 31.90 / 46.20 | 32.70 / 46.70 | 0.80 | 2.5% | 30.90–33.30 / 29.50–33.20 |
| 256 | texture-subresources / compact | 35.50 / 50.30 | 37.00 / 51.20 | 1.50 | 4.2% | 32.70–36.30 / 33.10–37.00 |
| 256 | texture-subresources / report | 35.50 / 49.90 | 35.70 / 50.00 | 0.20 | 0.6% | 34.40–36.20 / 35.20–36.80 |
| 256 | allocation-aliasing / compact | 43.50 / 59.10 | 43.40 / 59.60 | -0.10 | -0.2% | 42.20–45.00 / 42.10–45.50 |
| 256 | allocation-aliasing / report | 43.70 / 59.50 | 44.10 / 59.40 | 0.40 | 0.9% | 42.40–44.40 / 42.80–45.40 |
| 1024 | linear-chain / compact | 220.40 / 250.40 | 225.90 / 256.90 | 5.50 | 2.5% | 213.30–232.10 / 215.70–232.70 |
| 1024 | linear-chain / report | 221.40 / 255.10 | 224.60 / 253.40 | 3.20 | 1.4% | 219.50–225.80 / 219.40–225.40 |
| 1024 | buffer-ranges / compact | 144.80 / 172.70 | 141.60 / 174.60 | -3.20 | -2.2% | 133.10–145.50 / 140.20–144.90 |
| 1024 | buffer-ranges / report | 138.70 / 165.80 | 145.60 / 171.00 | 6.90 | 5.0% | 135.50–145.40 / 140.60–146.10 |
| 1024 | texture-subresources / compact | 155.80 / 183.50 | 158.80 / 185.10 | 3.00 | 1.9% | 149.10–157.70 / 157.40–161.80 |
| 1024 | texture-subresources / report | 154.30 / 181.50 | 160.10 / 188.90 | 5.80 | 3.8% | 151.00–155.70 / 145.60–161.80 |
| 1024 | allocation-aliasing / compact | 218.80 / 256.80 | 213.50 / 241.30 | -5.30 | -2.4% | 206.60–240.10 / 207.50–220.80 |
| 1024 | allocation-aliasing / report | 214.50 / 243.60 | 216.10 / 247.30 | 1.60 | 0.7% | 210.00–219.70 / 212.60–232.60 |

## Enabled CPU collection

Synthetic no-op callbacks expose the fixed collection cost and can show large percentages despite small absolute deltas. They are diagnostics, not expected application slowdowns.

| Nodes | Scenario / compile mode | Saved baseline P50 / P95 | Current off P50 / P95 | CPU on P50 / P95 | Δ P50 | Relative |
|---:|---|---:|---:|---:|---:|---:|
| 12 | linear-chain / compact | 8.20 / 20.90 | 9.10 / 21.80 | 14.10 / 31.10 | 5.00 | 54.9% |
| 12 | linear-chain / report | 9.70 / 18.50 | 9.10 / 19.40 | 12.20 / 26.60 | 3.10 | 34.1% |
| 12 | buffer-ranges / compact | 5.70 / 15.60 | 5.70 / 18.30 | 9.10 / 25.40 | 3.40 | 59.6% |
| 12 | buffer-ranges / report | 3.40 / 4.20 | 3.40 / 4.20 | 7.00 / 10.00 | 3.60 | 105.9% |
| 12 | texture-subresources / compact | 4.50 / 5.80 | 4.50 / 5.70 | 8.50 / 13.20 | 4.00 | 88.9% |
| 12 | texture-subresources / report | 4.20 / 4.70 | 4.20 / 5.00 | 7.60 / 10.40 | 3.40 | 81.0% |
| 12 | allocation-aliasing / compact | 3.60 / 4.20 | 3.70 / 4.10 | 6.80 / 9.20 | 3.10 | 83.8% |
| 12 | allocation-aliasing / report | 3.60 / 4.20 | 3.80 / 4.30 | 6.80 / 8.90 | 3.00 | 78.9% |
| 64 | linear-chain / compact | 17.40 / 53.60 | 17.80 / 48.60 | 33.60 / 92.60 | 15.80 | 88.8% |
| 64 | linear-chain / report | 15.50 / 32.70 | 16.20 / 32.10 | 30.00 / 54.20 | 13.80 | 85.2% |
| 64 | buffer-ranges / compact | 9.60 / 24.40 | 10.20 / 27.20 | 23.40 / 44.40 | 13.20 | 129.4% |
| 64 | buffer-ranges / report | 9.30 / 20.00 | 9.40 / 21.20 | 22.90 / 41.80 | 13.50 | 143.6% |
| 64 | texture-subresources / compact | 11.60 / 24.10 | 12.20 / 25.60 | 24.90 / 41.60 | 12.70 | 104.1% |
| 64 | texture-subresources / report | 11.00 / 20.40 | 11.90 / 18.00 | 24.80 / 39.70 | 12.90 | 108.4% |
| 64 | allocation-aliasing / compact | 13.00 / 16.20 | 13.90 / 19.00 | 19.00 / 33.60 | 5.10 | 36.7% |
| 64 | allocation-aliasing / report | 10.70 / 18.90 | 10.80 / 13.20 | 18.30 / 31.50 | 7.50 | 69.4% |
| 256 | linear-chain / compact | 56.40 / 154.30 | 58.80 / 157.30 | 108.90 / 218.20 | 50.10 | 85.2% |
| 256 | linear-chain / report | 56.20 / 148.20 | 57.10 / 152.70 | 107.00 / 209.10 | 49.90 | 87.4% |
| 256 | buffer-ranges / compact | 52.40 / 77.30 | 53.60 / 76.60 | 86.90 / 118.10 | 33.30 | 62.1% |
| 256 | buffer-ranges / report | 36.10 / 55.90 | 38.20 / 58.30 | 58.30 / 86.60 | 20.10 | 52.6% |
| 256 | texture-subresources / compact | 32.90 / 52.70 | 34.10 / 50.10 | 61.20 / 84.50 | 27.10 | 79.5% |
| 256 | texture-subresources / report | 33.50 / 54.20 | 33.40 / 50.20 | 60.90 / 83.40 | 27.50 | 82.3% |
| 256 | allocation-aliasing / compact | 43.00 / 61.40 | 41.80 / 58.60 | 69.60 / 88.10 | 27.80 | 66.5% |
| 256 | allocation-aliasing / report | 44.80 / 77.20 | 44.60 / 74.40 | 70.50 / 104.00 | 25.90 | 58.1% |
| 1024 | linear-chain / compact | 199.20 / 316.60 | 206.90 / 331.50 | 326.30 / 523.60 | 119.40 | 57.7% |
| 1024 | linear-chain / report | 208.60 / 328.90 | 210.90 / 339.00 | 328.60 / 492.00 | 117.70 | 55.8% |
| 1024 | buffer-ranges / compact | 142.60 / 248.10 | 142.80 / 248.70 | 260.70 / 420.80 | 117.90 | 82.6% |
| 1024 | buffer-ranges / report | 138.50 / 164.90 | 139.10 / 171.00 | 250.30 / 297.30 | 111.20 | 79.9% |
| 1024 | texture-subresources / compact | 154.70 / 189.70 | 157.30 / 188.50 | 270.90 / 306.90 | 113.60 | 72.2% |
| 1024 | texture-subresources / report | 150.30 / 180.40 | 154.20 / 180.10 | 260.70 / 301.30 | 106.50 | 69.1% |
| 1024 | allocation-aliasing / compact | 210.60 / 239.70 | 208.40 / 248.30 | 323.30 / 365.70 | 114.90 | 55.1% |
| 1024 | allocation-aliasing / report | 206.00 / 242.10 | 208.00 / 243.00 | 327.50 / 381.70 | 119.50 | 57.5% |

### Rust noop execution

| Nodes | Off P50 / P95 | CPU on P50 / P95 | Δ P50 | Relative |
|---:|---:|---:|---:|---:|
| 12 | 3.40 / 3.70 | 5.90 / 6.50 | 2.50 | 73.5% |
| 64 | 8.40 / 9.80 | 17.40 / 21.10 | 9.00 | 107.1% |
| 256 | 30.80 / 52.60 | 66.90 / 91.30 | 36.10 | 117.2% |
| 1024 | 106.40 / 137.10 | 243.40 / 310.70 | 137.00 | 128.8% |

### Hardware browser

| Scene | Mode | P50 | P95 | Δ P50 vs off | Relative | Five-round P50 range |
|---|---|---:|---:|---:|---:|---:|
| 12-render-passes | off | 75.00 | 170.00 | 0.00 | 0.0% | 75.00–115.00 |
| 12-render-passes | cpu | 90.00 | 205.00 | 15.00 | 20.0% | 85.00–140.00 |
| 12-render-passes | both | 120.00 | 245.00 | 45.00 | 60.0% | 105.00–210.00 |
| three-interop | off | 260.00 | 455.00 | 0.00 | 0.0% | 225.00–345.00 |
| three-interop | cpu | 265.00 | 485.00 | 5.00 | 1.9% | 250.00–295.00 |
| three-interop | both | 325.00 | 515.00 | 65.00 | 25.0% | 240.00–390.00 |

The initial non-isolated page exposed approximately 100 µs clock steps, insufficient to resolve small increments. This final table uses a dedicated cross-origin-isolated benchmark page (true), with a measured minimum positive clock step of 5.00 µs. Isolation is confined to the benchmark page; application hosting requirements are unchanged. Equal medians do not establish zero collection cost. Both includes GPU query setup/resolve/readback initiation, so its cost cannot be attributed solely to CPU sampling. The first high-resolution native-graph run using separate mode blocks had off/CPU/both medians of 85/140/95 µs, with substantial overlapping ranges and an implausible CPU/both reversal. The final native-graph table rotates modes per execution to reduce that bias. CPU-only adds 15 µs (20.0%) for the small native graph and 5 µs (1.9%) for interop in this run. These are small absolute capture costs, not a zero-overhead claim; synthetic high-node-count overhead is separately visible above. No CPU/GPU ratio is used to infer bottlenecks.

## Reproduce

```sh
npm run benchmark:webgpu -- --operation execute-repeated --profile realistic --warmup 100 --samples 300 --cpu-timing off
npm run benchmark:webgpu -- --operation execute-repeated --profile realistic --warmup 100 --samples 300 --cpu-timing on
node packages/webgpu/benchmarks/compare-timing.mjs 3cf7e0e713e60d46a8d38807791ca02106ac532b
cargo run --release --example cpu-timing-bench -p zenfg
# Start the site development server at port 5174 first.
node packages/webgpu/benchmarks/browser-timing.mjs
```

Repeat Node off/on commands in alternating order for five rounds and for realistic/small/medium/large profiles. `compile-only` ignores the timing flag by construction. JSON/log evidence from this run remains in the local temporary `zenfg-timing-baseline` and `zenfg-timing-acceptance` directories; the tables above preserve the review results. No timing threshold was added to CI.
