# ZenFG

ZenFG 是一个面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链，提供
TypeScript 与 Rust runtime、可移植 Snapshot 协议、验证与一致性测试，以及可嵌入
应用或独立运行的 Inspector。

ZenFG 只管理图可见的 GPU 工作：依赖、顺序、内容有效性、裁剪、资源生命周期、
transient allocation、执行分段与诊断。Scene、Material、Pipeline、Bind Group、
Camera、surface presentation 和业务策略始终由调用方持有。

开发者与 AI 集成请从英文
[Quick Reference](docs/quick-reference.md) 开始；它是包与 feature 选择、生命周期、
ownership/content 语义、双语言 API 映射、常见错误和完整示例索引的单一事实源。

## 发布物

| 包 | 用途 |
| --- | --- |
| `@zenfg/webgpu` | WebGPU FrameGraph runtime |
| `@zenfg/snapshot` | Snapshot V1 类型、编解码、验证器、Schema 与 conformance corpus |
| `@zenfg/inspector` | 与 renderer 无关的 DOM Inspector |
| `zenfg` | wgpu FrameGraph runtime |
| `zenfg-snapshot` | Rust Snapshot V1 编解码与验证器 |

所有包当前处于初始开发（`0.1.x`）阶段；发布后，`0.1.x` 将作为注册表中的普通版本，
但公共 API 仍可按 SemVer 的 `0.x` 规则演进。两种语言实现共享语义与诊断协议，但
保持各自惯用的公共 API。

私有 workspace `apps/inspector` 会构建无需后端的静态查看器，支持文件选择、拖放、
验证错误反馈与旧格式迁移。本仓库只构建它，不负责部署。

本地安装依赖后，可从干净 checkout 直接执行 `npm run dev:inspector` 启动独立
Inspector；执行 `npm run test:cross-language` 可运行 TypeScript/Rust 双向 producer
一致性验收。

进一步说明请参阅 [架构](docs/architecture.md)、[语义模型](docs/semantic-model.md)、
[集成层级](docs/integration.md)、[兼容矩阵](docs/compatibility.md)与
[迁移基线](docs/migration-baseline.md)。发布变更记录在 [CHANGELOG](CHANGELOG.md)，
首版候选的验收过程见 [0.1.0 发布清单](docs/release-checklist-0.1.0.md)。英文文档是
规范正文。
