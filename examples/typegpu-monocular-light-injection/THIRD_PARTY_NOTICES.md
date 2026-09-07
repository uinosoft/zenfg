# Third-party notices

This repository example migrates the t3d-next implementation to independent
ZenFG recording and hosting. No t3d-next package is required at build or runtime.

The pinned TypeGPU upstream's complete DepthART [LICENSE](./licenses/DepthART-LICENSE)
and [NOTICE](./licenses/DepthART-NOTICE) are preserved in this example.

## Default demonstration photograph

The browser remotely loads the TypeGPU demo photo at the same fixed source commit:

<https://github.com/software-mansion/TypeGPU/blob/2adbc1b3636f2c7c1be00d242171e23c85c73898/apps/typegpu-docs/public/assets/depthart/demo.jpg>

The photograph is not redistributed in this workspace. The DepthART model
license and notices describe model artifacts, not this photograph. User images
and camera frames stay in the browser and are not sent to the model host.

## TypeGPU Monocular Light Injection example

The inference kernels, bundle runtime, relighting shaders, and interaction behavior in this package are adapted from the TypeGPU Monocular Light Injection example at commit `2adbc1b3636f2c7c1be00d242171e23c85c73898`:

<https://github.com/software-mansion/TypeGPU/tree/2adbc1b3636f2c7c1be00d242171e23c85c73898/apps/typegpu-docs/src/examples/image-processing/monocular-light-injection>

MIT License

Copyright (c) 2025 Software Mansion <swmansion.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## DepthART model bundles

No model weights are stored in this repository. The example downloads `.depthart` bundles from `reczkok/depthart-typegpu` at the fixed revision `913a7c13ddfbd48549279555d1db98172e8e5e0d`:

<https://huggingface.co/reczkok/depthart-typegpu/tree/913a7c13ddfbd48549279555d1db98172e8e5e0d>

The source model is “DepthART: Scaling Foundation Monocular Depth to Tiny Models” by Feng Xue, Wu Chen, Mingshuai Zhao, Guofeng Zhong, Anlong Ming, Haozhe Wang, Dianqiao Lei, Zhaowen Lin, Haiyang Zhang, and Nicu Sebe. The model repository metadata declares Apache License 2.0. The upstream project repository does not carry a separate LICENSE file or copyright notice.

Software Mansion converted the checkpoints into the `.depthart` container. Batch normalization and reparameterizable branches were folded, graph-only view operations were lowered, and compatible activations and channel-affine operations were fused. Balanced variants store and compute selected encoder and decoder weights and activations in FP16 while keeping recurrence, normalization, residual endpoints, public I/O, and quality-sensitive reconstruction paths in FP32. Consequently their numeric output differs from the original checkpoint.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use the model bundles except in compliance with the License. You may obtain a copy at <https://www.apache.org/licenses/LICENSE-2.0>. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
