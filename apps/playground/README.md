# ZenFG Playground

The Playground is a private static application deployed at `/playground/`. It
keeps a live example as the stage and opens source code or the embedded
FrameGraph Inspector in an overlay above it.

```sh
npm run dev:playground
npm run build --workspace @zenfg/playground-app
```

For the integrated Site, Inspector, and Playground development workflow, see
the website development section in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Production examples are explicitly registered in `src/catalog/catalog.ts` and
grouped as repository showcases or `@zenfg/webgpu` basics. Catalog adapters own
Playground metadata, source display, WebGPU hosting, and Inspector wiring;
example implementations must not import Playground code.

The Monocular Light Injection showcase lives in
`examples/typegpu-monocular-light-injection`. It lazy-loads TypeGPU inference,
offers optional camera/image input and model controls, and reports download and
compilation progress through the mount context's optional `onLoading` callback.
The optional mount `signal` cancels initialization and releases browser resources
when the page is discarded. Existing examples may omit both fields.
Once an example has rendered, later loading or error messages keep its last
frame visible so recoverable model/source failures do not blank the stage.

`captureSnapshot()` requests the next real rendered frame. A runtime that is
still preparing its model or input retains the request through those stages,
so the Inspector's initial capture can complete without a manual retry.
Failures, page suspension, and disposal settle pending requests with no snapshot;
callers can request another capture after recovery. Capturing does not force
extra inference or synthesize a frame graph for display.

Package recipes are executed from `packages/webgpu/examples` and displayed from
the same files through Vite raw imports. Their `record*` functions let the
Playground request compilation reports without changing the normal recipe
execution path. Adapter, host, and shader files appear as secondary source tabs
so the boundary remains visible.
