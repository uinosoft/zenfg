# ZenFG Playground

The Playground is a private static application deployed at `/playground/`. It
keeps a live example as the stage and opens source code or the embedded
FrameGraph Inspector in an overlay above it.

```sh
npm run dev:playground
npm run build --workspace @zenfg/playground-app
```

Production examples are explicitly registered in `src/catalog/catalog.ts`.
Catalog adapters own Playground metadata, source display, and Inspector wiring;
example implementations must not import Playground code.
