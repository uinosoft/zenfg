# Private PlayCanvas example helpers

Shared exclusively by the Toy Cat and Roman Parish showcases. This is not a
published package or a renderer abstraction. Each showcase owns its executable
main.ts and scene. The catalog adapter owns page UI.

- graph.ts declares imported attachments, transient Reference color and external access.
- bridge.ts isolates version-coupled PlayCanvas 2.21.4 device, texture and draw-count access.
- composite.ts implements gamma-2.2 premultiplied composition and final sRGB.
- camera.ts supplies matching forward-Z projections and canvas-local input.
- loading.ts bounds asynchronous preparation and releases late results.
- host.ts owns browser scheduling, suspension and snapshot delivery.

[Validation](VALIDATION.md) · [GPU test instructions](tests/gpu/README.md).

Camera input now uses PlayCanvas 2.21.4 OrbitController/FlyController,
KeyboardMouseSource and MultiTouchSource, the same primitives used by its official
CameraControls script. The local adapter maps input, gates it on canvas focus,
and converts the resulting Pose to shared forward-Z matrices. Controllers advance
once before graph recording; no script component or second app.update is installed.
Fly motion follows the camera axes; diagonal input is normalized.
