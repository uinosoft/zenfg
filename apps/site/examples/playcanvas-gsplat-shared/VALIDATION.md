# Validation record

Validated September 14–15, 2026 on Windows, Microsoft Edge **153.0.4234.32**,
headless with `--enable-unsafe-webgpu`. WebGPU reported a non-fallback NVIDIA
Turing adapter. The adapter did not expose a precise model/driver description.

## Repository checks

- `npm test`: **701 passed**, no failures or skips.
- `npm run typecheck`: passed.
- `npm run build:pages`: passed; 188 built HTML pages/deep links verified.
- `npm run docs:check`: passed.
- `git diff --check`: passed.

CPU fixtures cover single imports and attachment validation, declared depth/color
access, output-root culling, native/external/native execution, forward-Z projection,
bounded preparation, late cancellation, snapshots, hidden-page suspension, device
loss, resize and teardown order. Scene tests check pinned asset URLs and the
deterministic 32-instance streaming layout.

## Hardware checks

The seven standalone GPU checks pass at DPR 1 and DPR 2:

- Hardware adapter availability.
- Foreground splats over Reference geometry.
- Background splats rejected by shared depth.
- A real pixel difference when occlusion order changes.
- Cancelled preparation.
- Gamma-2.2 premultiplied transparent-edge/color arithmetic (within two 8-bit levels).
- Real device loss settling a pending capture and stopping the host.

The two occlusion fixtures return center pixels `[12,215,250,255]` and
`[227,82,35,255]`. Shared targets resize 64×48 → 48×64 → 64×48 during both
fixtures. These generated PLY fixtures do not depend on the CDN.

## Browser and network checks

Tested the real catalog first on the development origin and then the Pages build
at `http://127.0.0.1:4176/zenfg/playground/`, preserving its deployment prefix.

Toy Cat's immutable GitHub URL and Roman Parish's original PlayCanvas metadata,
environment SOG and relative LOD metadata/WebP requests return 200 and render
under normal browser CORS enforcement. No proxy or mirrored dataset is involved.

Both examples pass first-frame, real drag, source-entry, Snapshot export and
desktop/mobile viewport checks. The exported snapshots contain five actual nodes
and three execution segments (frame-graph, external-submission, frame-graph).
The static composition and fully loaded church composition were visually reviewed.

At the initial church view, reducing the budget from 4 M to 0.5 M changed a
measured draw count from **1,200,183 to 804,373**. This is an LOD target; discrete
chunks and the environment explain why a low target need not be a hard draw cap.
At the default budget, flying produced additional region requests
(**33 → 38** distinct URLs in the recorded run). Offline movement retained already
rendered content without page exceptions. Initial Toy Cat failure displayed an
explicit retry button; unblocking the URL and retrying restored rendering. The
retry case also passed on the built site at a 390×844 CSS viewport and DPR 2.

Switching via the current sidebar from PlayCanvas to Three.js and back passed
without page exceptions. Both examples use the same existing page/status/source/
Inspector surfaces; no independent debug UI was introduced.

The CDN can be slow: the low-detail environment arrives before church detail.
Network tests wait for detail to arrive before comparing budgets. Early attempts
that compared only the environment correctly showed no budget difference and
were replaced with a readiness threshold. Test selectors were updated to the
current sidebar; final network assertions count issued requests rather than
waiting for response completion.

## Reproduction and limits

See [GPU/browser runners](tests/gpu/README.md). Their JSON results, screenshots
and exported snapshots are written under `.test-dist`; the CPU runner recreates
that directory, so run GPU/browser checks after CPU tests.

Mobile coverage is viewport/DPR emulation on this desktop GPU, not a physical
mobile device. The public hosted ZenFG origin was not deployed or changed during
this work; rerun EXAMPLES_URL against it after deployment. CDN availability and
resource terms are separate from GPU correctness. The dataset's unresolved
license-option selection is documented in the streaming example's notices.

## Native controller follow-up — September 15, 2026

Replaced local orbit/fly motion with PlayCanvas 2.21.4 OrbitController and
FlyController plus KeyboardMouseSource/MultiTouchSource. Controllers update once
before graph recording. Focus loss discards held keys and residual damping.
Native fly motion follows camera axes and diagonal input is normalized.

All 703 CPU tests and typechecking pass. The seven hardware GPU checks pass;
real browser checks for both examples pass mouse drag, zoom/keyboard flight,
Reset View and page-error assertions. The focused CPU tests cover actual native
controller invocation, unfocused keys, equal-speed diagonals and stopping on blur.
