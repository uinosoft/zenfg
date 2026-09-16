<!-- readme-hero:start -->
<p align="center">
  <br>
  <a href="https://uinosoft.github.io/zenfg/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/brand/zenfg-lockup-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="assets/brand/zenfg-lockup-light.svg">
      <img src="assets/brand/zenfg-lockup-light.svg" alt="ZenFG" width="280" height="73">
    </picture>
  </a>
  <br>
</p>

<p align="center">
  <strong>面向 WebGPU 与 wgpu 的可组合 FrameGraph。</strong>
</p>

<!-- generated:badges:start -->
<p align="center">
<a href="https://github.com/uinosoft/zenfg/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI main"></a>
<a href="https://uinosoft.github.io/zenfg/docs/"><img src="https://img.shields.io/badge/docs-online-blue" alt="Documentation"></a>
<a href="https://github.com/uinosoft/zenfg/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
<a href="https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md"><img src="https://img.shields.io/badge/status-released-blue" alt="Release status"></a>
</p>
<!-- generated:badges:end -->

<p align="center">
  <a href="https://uinosoft.github.io/zenfg/">官网</a> ·
  <a href="https://uinosoft.github.io/zenfg/docs/">文档</a> ·
  <a href="https://uinosoft.github.io/zenfg/playground/">示例</a> ·
  <a href="https://uinosoft.github.io/zenfg/inspector/">Inspector</a>
</p>

<p align="center">
  <a href="README.md" lang="en">English</a> · <strong lang="zh-CN">简体中文</strong>
</p>
<!-- readme-hero:end -->

# ZenFG

**自主构建渲染功能，组合不同 GPU 系统，看清每一帧的执行过程。**

ZenFG 通过显式 FrameGraph 协调渲染与计算工作。直接使用 WebGPU 或 wgpu
开发领域功能，或接入已有引擎，再把它们组合到同一帧中。
场景、材质、管线和渲染策略由你掌控；ZenFG 负责声明的依赖、执行顺序、
临时资源生命周期与诊断。TypeScript 与 Rust 运行时共享语义和可移植 Snapshot，
并提供可嵌入的 Inspector。

## 为什么选择 ZenFG

- **自主实现** — 使用原生 GPU API 或兼容的第三方库构建功能，保留自己的渲染架构。
- **组合已有成果** — 将外部引擎和图内渲染、计算模块组合使用，显式声明共享资源与执行边界。
- **看清实际流程** — 用 Inspector 检查帧图、资源和可选 CPU/GPU 计时；导出 Snapshot，结合代码进行人工或 AI 辅助分析，再次捕获以验证修改。
- **协调依赖与资源** — 保留必要工作、裁剪无效工作，管理临时资源的分配、生命周期、内存复用与资源池。

<!-- readme-showcase:start -->
<p align="center">
  <a href="https://uinosoft.github.io/zenfg/playground/?example=three-interop&amp;panel=inspector">
    <img src="apps/site/public/media/three-co-rendering.png" width="720" height="360" alt="Three.js 与 Reference Renderer 的真实渲染结果及捕获帧图">
  </a>
</p>
<!-- readme-showcase:end -->

[Three.js 协同渲染](https://uinosoft.github.io/zenfg/playground/?example=three-interop&panel=inspector)：两个渲染器共享颜色与深度附件，在同一场景中互相遮挡。

也可以查看 [Reference Renderer](https://uinosoft.github.io/zenfg/playground/?example=reference-renderer&panel=inspector) 的 GPU 裁剪与间接绘制、
[PlayCanvas 流式 GSplat](https://uinosoft.github.io/zenfg/playground/?example=playcanvas-gsplat-streaming-interop&panel=inspector)（需要网络）和
[TypeGPU Slime Mold](https://uinosoft.github.io/zenfg/playground/?example=typegpu-slime-mold&panel=inspector) 的计算与渲染节点。
这些是针对特定版本的集成示例，不是通用兼容承诺。

## 从这里开始

- **WebGPU / TypeScript** — 从
  [`@zenfg/webgpu` 快速入门](packages/webgpu/README.md#quick-start)开始，
  再查看[完整 TypeScript 示例](packages/webgpu/examples/README.md)。
- **wgpu / Rust** — 阅读
  [`zenfg` 快速入门](crates/zenfg/README.md#quick-start)和
  [Cargo 示例](crates/zenfg/examples/)。
- **在线体验** — 浏览[实时示例](https://uinosoft.github.io/zenfg/playground/?example=interactive-background&panel=inspector)、
  对应的 TypeScript 源码与 Inspector 捕获结果，或在
  [Inspector](https://uinosoft.github.io/zenfg/inspector/) 中打开 Snapshot。
  Inspector 完全在浏览器中运行，不会上传导入的快照。

更多指南和参考资料见英文[文档索引](docs/README.md)。
修改公共语义、示例或发布产物前，请阅读英文[贡献指南](CONTRIBUTING.md)。

## 集成层级

可以接入保留自身提交方式的已有引擎，也可以构建将工作记录到帧图中的模块；两者可以组合使用。
技术上，ZenFG 提供下述三种集成深度。

互操作需要共享 device 与 queue、兼容的资源格式和使用约定，以及准确的访问声明。
每个共享原生资源在同一次 recording 中应只导入一次。外部引擎内部 pass 保持不透明，
GPU 计时取决于设备支持与节点覆盖；Snapshot 不包含可重放的命令或资源内容。

应用掌控渲染策略，并为每个子系统选择合适的集成深度。ZenFG 负责协调工作，
场景、材质和渲染器架构仍由应用管理。

| ZenFG 负责 | 应用负责 |
| --- | --- |
| 图可见的依赖与执行顺序 | 场景、材质、相机与渲染器架构 |
| 保留根（retention roots）与无效工作裁剪 | 管线、绑定组、采样器与绘制／计算派发策略 |
| 临时资源生命周期、内存复用与资源池 | 设备、队列、呈现表面、呈现与设备丢失处理策略 |
| 验证、报告、Snapshot 投影与检查 | 长生命周期资源、资源内容与应用状态 |

同一帧内可以混合使用以下三种集成层级：

- **原生渲染、计算与复制节点（Native render, compute, and copy）** 提供最完整的验证和诊断。
- **命令集成（Command integration）** 允许子系统向 FrameGraph 持有的命令编码器写入自定义工作。
- **不透明外部提交（Opaque external submission）** 允许现有渲染器保留自己的命令编码器与提交方式，
  同时声明一个有序的图边界。

完整的归属、内容、依赖、生命周期与执行模型，参阅英文[核心概念](docs/core-concepts.md)。

## 发布包

<!-- generated:packages:start -->
| 包 | 用途 | 发布版本 | 文档 |
| --- | --- | --- | --- |
| [`@zenfg/webgpu`](packages/webgpu/README.md) | TypeScript/WebGPU FrameGraph 运行时 | [![@zenfg/webgpu published latest version](https://img.shields.io/npm/v/%40zenfg%2Fwebgpu/latest?label=npm)](https://www.npmjs.com/package/@zenfg/webgpu) | [指南](https://uinosoft.github.io/zenfg/docs/packages/webgpu.html) |
| [`@zenfg/snapshot`](packages/snapshot/README.md) | Snapshot 1.2 类型、编解码、验证与规范 | [![@zenfg/snapshot published latest version](https://img.shields.io/npm/v/%40zenfg%2Fsnapshot/latest?label=npm)](https://www.npmjs.com/package/@zenfg/snapshot) | [指南](https://uinosoft.github.io/zenfg/docs/packages/snapshot.html) |
| [`@zenfg/inspector`](packages/inspector/README.md) | 可嵌入的 DOM Inspector | [![@zenfg/inspector published latest version](https://img.shields.io/npm/v/%40zenfg%2Finspector/latest?label=npm)](https://www.npmjs.com/package/@zenfg/inspector) | [指南](https://uinosoft.github.io/zenfg/docs/packages/inspector.html) |
| [`zenfg`](crates/zenfg/README.md) | Rust/wgpu FrameGraph 运行时 | [![zenfg published version](https://img.shields.io/crates/v/zenfg?include_prereleases)](https://crates.io/crates/zenfg) | [指南](https://uinosoft.github.io/zenfg/docs/packages/zenfg.html) |
| [`zenfg-snapshot`](crates/zenfg-snapshot/README.md) | Rust Snapshot 1.2 编解码、验证与迁移 | [![zenfg-snapshot published version](https://img.shields.io/crates/v/zenfg-snapshot?include_prereleases)](https://crates.io/crates/zenfg-snapshot) | [指南](https://uinosoft.github.io/zenfg/docs/packages/zenfg-snapshot.html) |
<!-- generated:packages:end -->

## 方向

我们正在探索可复用的 GPU-Driven Mesh、粒子与后处理模块，让独立渲染功能更容易组合并进入实际项目。
这是探索方向，不是交付时间表或稳定的模块协议。当前 Reference Renderer 用于教学与展示，并非已发布的生产渲染模块。

## 项目状态

ZenFG 0.1.0 是首个非预发布版本。1.0 前公共 API 仍可能变化，
集成方应锁定精确包版本并查看迁移说明。

TypeScript 与 Rust 共享语义和可移植诊断，不追求源码级 API 一致。
Snapshot 数据格式使用独立于包版本的版本体系；
详情参阅英文[兼容矩阵](docs/compatibility.md)与[更新日志](CHANGELOG.md)。

## 许可证

ZenFG 使用 [MIT License](LICENSE)。
