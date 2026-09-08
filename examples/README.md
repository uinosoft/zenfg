# Repository examples

This directory contains private, application-like showcases, cross-package
workflows, and integrations with third-party libraries. They may be shared by
website surfaces, but they do not define a common example runtime contract or a
recommended package-level recipe structure.

Focused examples that teach one package's public API belong with that package
and may ship in its artifact. Larger applications and examples whose value
comes from a third-party integration remain here even when one ZenFG package is
their primary dependency.

Both repository examples and package recipes must remain independent of the
Playground. The Playground executes and displays their real source through
application-local catalog adapters.

`reference-renderer` is a private reusable GPU module. Its basic showcase lives
in `reference-renderer-demo`, which depends on the renderer's package entrypoint.
Future integrations can depend on that same module while owning their device,
shared attachments, host and presentation policy independently.

`three-interop` demonstrates that composition with Three.js: the external
renderer and Reference Renderer share color and depth on one device, with
forward-Z and reverse-Z modes. Its host and adapter remain local to the showcase.

`babylon-interop` demonstrates an engine-owned device and graph-visible resource
adaptation: Babylon.js writes native attachments, a native pass normalizes both
color and depth orientation, and the Reference Renderer continues drawing.
Its Reverse Z control changes convention on the same engine and shared device.

`babylon-lite-interop` uses Babylon Lite 1.28 with native reverse depth. A graph
pass decodes Lite color while Reference Renderer loads the original depth
attachment. It uses the same procedural composition without configurable effects.
