# GPU and site acceptance

Install workspace dependencies, then run from the repository root:

```sh
node apps/site/examples/playcanvas-gsplat-shared/tests/gpu/run.mjs
```

The standalone runner serves generated PLY data on localhost. No third-party
dataset is downloaded or committed by this fixture. It requires a hardware
WebGPU adapter, checks both occlusion orders through actual pixel readback,
resizes shared attachments, verifies transparent-edge color arithmetic and
destroys a real device with a pending snapshot.

On Windows it uses installed Edge. Set GPU_TEST_BROWSER to an executable path
to override; GPU_TEST_DPR selects deviceScaleFactor (1 by default).
Results go to .test-dist/playcanvas-gsplat-gpu/result.json.

Start the Examples site or its built preview, then run:

```sh
node apps/site/examples/playcanvas-gsplat-shared/tests/gpu/examples.mjs
```

EXAMPLES_URL defaults to http://127.0.0.1:4175/playground/. Override it to test
a built deployment. This runner uses the original remote asset URLs and browser
CORS enforcement. It checks first frames, drag, budget changes after detailed
chunks arrive, new region requests, offline behavior, source entry, exported
snapshots, mobile layout, example switching and explicit first-load retry.
Network acceptance can take several minutes. Results and screenshots go to
.test-dist/playcanvas-gsplat-site. No fixture or proxy replaces the remote data.

Run npm test before these runners: the CPU runner recreates .test-dist.
Viewport emulation is not validation on a physical mobile GPU.

For native-controller interaction regression checks, run:

    node apps/site/examples/playcanvas-gsplat-shared/tests/gpu/camera.mjs

This uses EXAMPLES_URL (default http://127.0.0.1:4175/playground/) and checks
real mouse drag, static zoom, native fly keyboard movement, Reset View and
uncaught page errors for both examples.
