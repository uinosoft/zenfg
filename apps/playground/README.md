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

Package recipes are executed from `packages/webgpu/examples` and displayed from
the same files through Vite raw imports. Their `record*` functions let the
Playground request compilation reports without changing the normal recipe
execution path. Adapter, host, and shader files appear as secondary source tabs
so the boundary remains visible.
