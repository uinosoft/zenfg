# Third-party notices

Verified September 14, 2026. ZenFG example integration code is covered by the
repository license; this does not relicense external datasets.

## Adapted code

Adapted from t3d-next, revision
`d25a49c0a1bc3f6c994b3a4698c1ef7ce0f56710`.
Copyright (c) 2026 Uinosoft. MIT license.

PlayCanvas engine and original example code: **2.21.4**, revision
`e287e0c67f3c20c689a52b7c53d2b7fedbe887da`.
Copyright (c) 2011-2026 PlayCanvas Ltd. MIT license.
[Engine license](https://github.com/playcanvas/engine/blob/v2.21.4/LICENSE).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Roman Parish scanning data — separate terms

3D scanning data created and provided by [Andrii Shramko](https://www.linkedin.com/in/andrii-shramko/), [Teleportour](https://www.linkedin.com/company/teleportour/).

[Teleportour website](http://teleportour.com).

- [Original PlayCanvas demo](https://playcanvas.github.io/#/gaussian-splatting/lod-streaming).
- [Original example source](https://github.com/playcanvas/engine/blob/v2.21.4/examples/src/examples/gaussian-splatting/lod-streaming.example.mjs).
- [CDN metadata](https://code.playcanvas.com/examples_data/example_roman_parish_02/lod-meta.json).
  Relative SOG chunk URLs resolve against this directory; do not substitute another version.
- [Original scan directory](https://drive.google.com/drive/folders/1aYPYNiZK_9oPT_h4eV5z7XKFp3Mg44Iq):
  `!s042 Roman_Catholic_Parish_of_Saints_Peter_and_Paul_Opole_2025-07-11-132459`.
- [3DGS directory](https://drive.google.com/drive/folders/1d_kvb5QRrpLuwxYpSXyaPhnSRBsWxAQ6).
- [License source](https://drive.google.com/file/d/1Z5CLOUG6mKfx9b69fE7CBP7bPLBtY2u7/view)
  in the [author's license directory](https://drive.google.com/drive/folders/1kDMcnM5ulU-fhUoq60ZV8ZyZRd_WvMvK).

The author's separate terms describe two options: without property/model releases,
and with property releases but without model releases. **Which option applies to
Roman Parish has not been confirmed.** Both describe a nonexclusive, royalty-free,
revocable grant, including research/commercial uses and distribution with source
examples, subject to attribution and other conditions. They include privacy and
identification restrictions, indemnification and termination obligations. Consult
the linked full terms; this paragraph is not a replacement license.

This dataset is not labeled MIT or CC BY and is not represented as unconditionally
cleared for commercial use. Neither the author, Teleportour nor PlayCanvas endorses
ZenFG. Code licenses do not grant dataset rights. CDN availability does not itself
grant permission or guarantee continued hosting.

ZenFG does not bundle, mirror or redistribute the church dataset in its repository
or build. The running example fetches metadata and required chunks directly from
PlayCanvas's original CDN, with normal browser caching.

Camera input mapping follows the MIT-licensed PlayCanvas 2.21.4
scripts/esm/camera-controls.mjs. Native OrbitController/FlyController and input
sources are imported from the pinned engine package; no separate controller
script or camera library is vendored.
