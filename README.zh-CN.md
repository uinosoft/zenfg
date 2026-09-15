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
  <strong>面向 WebGPU 与 wgpu 的可组合 FrameGraph 基础设施。</strong>
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

ZenFG 通过显式帧图（FrameGraph）协调渲染功能与第三方系统之间的 GPU 工作。
它提供符合 TypeScript 与 Rust 使用习惯的运行时、可移植的 Snapshot 格式、
验证与一致性工具，以及可嵌入的 Inspector。

## 为什么选择 ZenFG

- **依赖与调度** — 显式声明依赖和执行顺序，保留必要工作，裁剪不影响结果的工作。
- **资源生命周期管理** — 跟踪临时资源，管理其分配、内存复用（aliasing）与资源池。
- **验证与诊断** — 验证图的使用方式，通过可移植的 Snapshot 和 Inspector 查看执行报告。

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

## 集成层级

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

## 项目状态

ZenFG 0.1.0 是首个非预发布版本。1.0 前公共 API 仍可能变化，
集成方应锁定精确包版本并查看迁移说明。

TypeScript 与 Rust 共享语义和可移植诊断，不追求源码级 API 一致。
Snapshot 数据格式使用独立于包版本的版本体系；
详情参阅英文[兼容矩阵](docs/compatibility.md)与[更新日志](CHANGELOG.md)。

## 许可证

ZenFG 使用 [MIT License](LICENSE)。
