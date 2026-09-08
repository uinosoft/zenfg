# Third-Party Notices

## Particles4All

The JavaScript simulation, scene generation, rendering implementation, WGSL,
and INI presets derive from
[matsuoka-601/Particles4All](https://github.com/matsuoka-601/Particles4All/tree/58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0),
pinned to commit `58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0`.

Copyright (c) 2026 matsuoka-601. Licensed under the MIT License. The full license
is included in [LICENSE.upstream](./LICENSE.upstream) and available
[at the pinned upstream revision](https://github.com/matsuoka-601/Particles4All/blob/58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/LICENSE).

The earlier t3d-next integration provided a reference for graph stage recording.
This adaptation removes its package dependencies, restores upstream depth and
presentation conventions, and integrates resource declarations, frame settlement,
and browser lifecycle with ZenFG. See [README.md](./README.md) for the integration
boundary. Vendored source is modified; it is not an unmodified upstream distribution.

Necessary adaptations include graph-owned pass encoding and transient scratch,
explicit persistent/readback roots, submission settlement, and asynchronous
resource cleanup. Sparse surface vertices are initialized before their preserving
write, drag indices are rebuilt before their first use in a frame, and wall
resize binds the position parity selected after grid priming.

The `soraverage` INI key remains supported as an extension inherited from the
earlier integration; the pinned upstream INI parser did not consume that key.

## Quarry Cloudy environment

The bundled Quarry Cloudy panorama is from
[Poly Haven](https://polyhaven.com/a/quarry_cloudy) and distributed under
[CC0](https://polyhaven.com/license). The asset is included locally so the default
environment does not depend on a third-party download at runtime.
