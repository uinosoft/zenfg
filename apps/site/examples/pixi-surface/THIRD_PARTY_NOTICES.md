# Third-party material

## PixiJS runtime

PixiJS 8.21.0: https://github.com/pixijs/pixijs/tree/v8.21.0 (MIT).
The runtime's package contains its own license.

## Egg Head sprite and tinting example

- Current example: https://pixijs.com/8.x/examples?example=container_tinting
- Current image URL: https://pixijs.com/assets/eggHead.png
- Local copy: assets/eggHead.png, retrieved 2026-09-20.
- Original distribution: PixiJS v1.6.0, commit
  f870103887510e1d04c8f2b8671dc6a556b76342.
- Historical image:
  https://github.com/pixijs/pixijs/blob/f870103887510e1d04c8f2b8671dc6a556b76342/examples/example%2017%20-%20Tinting/eggHead.png
- License in that same distribution:
  https://github.com/pixijs/pixijs/blob/f870103887510e1d04c8f2b8671dc6a556b76342/LICENSE

On 2026-09-21 the complete PNG bytes from that historical distribution were
compared with our local copy. Both have SHA-256:

    cb8576286e14b15308b11716967e60269202fee49a2c793c42a914648744f706

The original distribution carries the MIT License, copyright (c) 2013-2014
Mathew Groves. Its full license text is retained in assets/LICENSE.txt.
This establishes provenance through the original asset distribution rather than
assuming the current runtime license applies to the website's images.

The motion code adapts the original tinting example's simple sprite movement
with a fixed seed and a host-owned clock. No bone runtime, asset pack or sprite
sheet is included.
