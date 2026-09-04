# ZenFG

[English](README.md) | 简体中文

**面向 WebGPU 与 wgpu 的可组合 FrameGraph 基础设施。**

ZenFG 提供符合 TypeScript 与 Rust 使用习惯的运行时、可移植 Snapshot 格式、验证与
一致性工具，以及可嵌入的 Inspector。它负责协调 renderer feature 与第三方系统的
GPU 工作，但不会把 FrameGraph 变成一套 renderer。

项目网站：<https://uinosoft.github.io/zenfg/>

## 为什么选择 ZenFG

ZenFG 使用一套明确模型管理依赖、调度、裁剪、资源生命周期、transient allocation、
验证与诊断。应用仍然掌控渲染策略，并可以为不同子系统选择适合的集成深度。

| ZenFG 负责 | 应用负责 |
| --- | --- |
| 图可见的依赖与执行顺序 | Scene、Material、Camera 与 renderer 架构 |
| Retention root 与无效工作裁剪 | Pipeline、Bind Group、Sampler 与 draw/dispatch 策略 |
| Transient 生命周期、aliasing 与 pooling | Device、Queue、Surface、present 与 device-loss 策略 |
| 验证、报告、Snapshot 投影与检查 | 长生命周期资源、资源内容与应用状态 |

## 集成层级

- **Native render、compute 与 copy** 节点提供最完整的验证和诊断。
- **Command integration** 允许子系统向 FrameGraph 持有的 command encoder 编码自定义工作。
- **Opaque external submission** 允许现有 renderer 保留自己的 encoder 与提交方式，同时声明
  一个有序的图边界。

同一帧内可以混合使用这些层级。完整的 ownership、content、dependency、lifetime 与
execution 模型请参阅英文 [Core concepts](docs/core-concepts.md)。

## 发布包

| 包 | 用途 |
| --- | --- |
| [`@zenfg/webgpu`](packages/webgpu/README.md) | TypeScript/WebGPU FrameGraph runtime |
| [`zenfg`](crates/zenfg/README.md) | Rust/wgpu FrameGraph runtime |
| [`@zenfg/snapshot`](packages/snapshot/README.md) | Snapshot 1.0 规范类型、编解码、验证、Schema 与一致性语料 |
| [`zenfg-snapshot`](crates/zenfg-snapshot/README.md) | Rust Snapshot 1.0 wire model、编解码、验证与迁移 |
| [`@zenfg/inspector`](packages/inspector/README.md) | 面向 Snapshot 数据、与 renderer 无关的 DOM Inspector |

## 从这里开始

- 浏览英文[文档索引](docs/README.md)。
- 通过 [`@zenfg/webgpu` Quick Start](packages/webgpu/README.md#quick-start) 开始 WebGPU 集成，
  并查看[完整 TypeScript recipes](packages/webgpu/examples/README.md)。
- 通过 [`zenfg` Quick Start](crates/zenfg/README.md#quick-start) 开始 wgpu 集成，
  并查看 [Cargo examples](crates/zenfg/examples/)。
- 打开[在线 Inspector](https://uinosoft.github.io/zenfg/inspector/)；它完全在浏览器中运行，
  不会上传导入的 Snapshot。
- 打开[在线 Playground](https://uinosoft.github.io/zenfg/playground/?example=interactive-background&panel=inspector)，
  查看 WebGPU 实时 showcase 与包级 recipe、对应的真实 TypeScript 源码及 Inspector 捕获结果。
- 修改公共语义、示例或发布产物前，请先阅读英文 [Contributing](CONTRIBUTING.md)。

## 项目状态

ZenFG 目前是公开 beta 软件。1.0 前公共 API 仍可能变化，集成方应锁定精确的预发布包版本。
TypeScript 与 Rust 共享语义和可移植诊断，而不追求源码级 API 一致。Snapshot wire format
使用独立于包版本的版本体系；详情参阅英文[兼容矩阵](docs/compatibility.md)与
[Changelog](CHANGELOG.md)。

## 许可证

ZenFG 使用 [MIT License](LICENSE)。
