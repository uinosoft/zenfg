# PixiJS · Tinted Screen

Open Examples → **PixiJS · Tinted Screen** (id: pixi-surface).

Twenty tinted sprites move on a static 2:1 cylindrical screen. Drag to orbit,
scroll to zoom, and use Pause / Reset in the external Tweakpane controls. Pause freezes the
sprites and orbiting sphere while the camera stays interactive.

## Read the integration

Start with src/main.ts, then src/graph.ts. The host owns one GPUDevice, the
visible canvas, FrameGraph and a persistent 2048×1024 animation texture. Pixi
borrows the device and wraps that texture in ExternalSource. Its detached setup
canvas is never presented; renderer.render({ container, target }) writes the
shared target exactly once per graph execution. No Pixi ticker is started.

    Pixi External Submission → animation texture ───────────┐
                                                           ↓
    Reference Reset → Cull → Draw → scene color/depth → Draw Screen → Present

Each physical texture is imported once per frame. The external node declares an
overwrite write, screen rendering declares sampling plus attachment loads, and
Present is the only root. Omitting markPresent culls the complete graph. Pixi's
private MSAA passes remain inside its single external node.

Reference Renderer lights the base and sphere. The example's small static-mesh
shader loads the same scene color and reads the stored reverse-Z depth. It does
not need to write depth because no geometry follows it. No public renderer or
FrameGraph API is extended.

## Color and resolution

Pixi writes encoded RGB to bgra8unorm. Screen sampling uses a bgra8unorm-srgb
view, decoding to linear RGB in the rgba16float scene attachment. Present uses
normalized UVs and linear filtering to downsample, then encodes sRGB once.
The opaque Pixi background avoids premultiplied-alpha ambiguity.

Pixi's external target enables its built-in 4× MSAA. The 3D color/depth targets
are twice the canvas backing dimensions, capped proportionally at a longest
edge of min(4096, device limit). Canvas DPR is capped at 2. Resizing changes
temporary scene attachments and camera framing; the Pixi target stays fixed.

## Lifecycle and tests

host.ts handles snapshots, visibility, cancellation, device loss and idempotent
disposal. controls.ts owns input and its DOM; screen.ts owns mesh/uniform buffers;
Pixi owns its scene, sprite image and internal attachments. Dispose Pixi before
destroying the borrowed target and device.

Node graph/motion/sizing checks run with npm test. Hardware checks:

    node apps/site/examples/pixi-surface/tests/gpu/run.mjs
    npm run build:pages
    node apps/site/examples/pixi-surface/tests/gpu/production.mjs

See tests/gpu/README.md and THIRD_PARTY_NOTICES.md.
