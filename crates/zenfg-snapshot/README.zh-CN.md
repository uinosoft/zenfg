<!-- translation: {"version":1,"source":"crates/zenfg-snapshot/README.md","sourceHash":"2139ca9d15c0c8b9a48aca5d8e04e5aa01df79a28f672eb2a122f6a408649f8d","state":"ready"} -->

# zenfg-snapshot

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<!-- generated:badges:start -->
[![zenfg-snapshot published version](https://img.shields.io/crates/v/zenfg-snapshot?include_prereleases)](https://crates.io/crates/zenfg-snapshot)
[![docs.rs](https://img.shields.io/docsrs/zenfg-snapshot/0.1.1)](https://docs.rs/zenfg-snapshot/0.1.1/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/LICENSE)
<!-- generated:badges:end -->

`zenfg-snapshot` 提供可移植且独立于 wgpu 的 Snapshot 1.2 线协议类型、
JSON 编解码、验证和旧格式迁移。它是
规范包 `@zenfg/snapshot` 的 Rust 对应实现，只依赖 Serde、`serde_json` 和
`thiserror`。

Snapshot 文档包含图结构和诊断信息，不包含 GPU 命令或
资源内容，因此无法重放帧。线协议版本与
此 crate 的 API 版本相互独立。

Snapshot 1.1 输入会在迁移到 1.2 前先通过验证；其 CPU 计时
会标记为 `not-collected`。写入方和独立验证器只接受规范版 1.2。已有的 Legacy 来源信息和扩展字段会予以保留。

<a id="installation"></a>

## 安装

<!-- generated:installation:start -->
```sh
cargo add zenfg-snapshot@=0.1.1
```
<!-- generated:installation:end -->

<a id="quick-start"></a>

## 快速入门

在 Cargo 应用中使用此示例，并添加 `serde_json` 以进行 JSON 值转换。
将代码放在 `fn main() -> Result<(), Box<dyn std::error::Error>>`
中，并以 `Ok(())` 结束。运行 `cargo run`；无需 GPU，所有断言都会通过。
以 `#` 开头的行是 rustdoc 测试框架代码，不要复制到应用中。

解析不可信 JSON 文本，以验证并规范化 Snapshot：

```rust
use zenfg_snapshot::{
    decode_frame_graph_snapshot, parse_frame_graph_snapshot, to_json_pretty,
    validate_frame_graph_snapshot, validate_typed_frame_graph_snapshot,
};

let json_text = r#"{
  "format": "zenfg.frame-graph-snapshot",
  "version": { "major": 1, "minor": 1 },
  "producer": { "name": "example" },
  "capture": { "frameIndex": 0 },
  "graph": {
    "groups": [], "nodes": [], "resources": [], "textureViews": [],
    "accesses": [], "dependencies": [], "roots": [], "segments": []
  },
  "memory": {
    "allocationReport": { "status": "available", "allocations": [] },
    "poolReport": { "status": "unavailable", "reason": "not captured" }
  },
  "timings": {
    "gpu": { "status": "unavailable", "reason": "not captured" }
  },
  "diagnostics": [],
  "extensions": {}
}"#;

let decoded = parse_frame_graph_snapshot(json_text)?;
let value = serde_json::to_value(&decoded.snapshot)?;
assert!(validate_frame_graph_snapshot(&value).is_empty());

let decoded_from_value = decode_frame_graph_snapshot(value)?;
assert_eq!(decoded_from_value.snapshot, decoded.snapshot);
assert!(validate_typed_frame_graph_snapshot(&decoded.snapshot).is_ok());

let canonical_json = to_json_pretty(&decoded.snapshot)?;
assert!(canonical_json.contains("zenfg.frame-graph-snapshot"));
# Ok::<(), Box<dyn std::error::Error>>(())
```

解码成功后会返回规范的 Snapshot 1.2 值；
升级了历史输入时还会显式记录迁移来源。未知格式和
版本会被拒绝。

<a id="common-tasks"></a>

## 常见任务

| 任务 | 公共 API |
| --- | --- |
| 解析不可信 JSON 文本 | `parse_frame_graph_snapshot()` |
| 解码已解析的 `serde_json::Value` | `decode_frame_graph_snapshot()` |
| 验证符合 JSON 结构的规范数据 | `validate_frame_graph_snapshot()` |
| 验证内存中的类型化 Snapshot | `validate_typed_frame_graph_snapshot()` |
| 序列化经过验证的类型化数据 | `to_json()`, `to_json_pretty()` |
| 处理解码失败 | `SnapshotDecodeError` |
| 查看结构化问题 | `SnapshotIssue`, `SnapshotIssueSeverity` |
| 读取格式、版本和深度限制 | `FRAME_GRAPH_SNAPSHOT_FORMAT`, `FRAME_GRAPH_SNAPSHOT_VERSION`, `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |

此 crate 导出 `FrameGraphSnapshotV1` 及全部线协议类型，均实现 `Serialize` 和 `Deserialize`。准确字段和错误变体见 [docs.rs](https://docs.rs/zenfg-snapshot)。

<a id="consumer-and-producer-boundaries"></a>

## 消费方与生成方的职责边界

- 对不可信输入使用解析或解码操作。接受规范版 Snapshot 1.2、Legacy V0
  和 Legacy Candidate V1；受支持的历史数据会显式迁移
  。
- 返回类型化的生产者数据前，使用 `validate_typed_frame_graph_snapshot()` 验证。`to_json()` 和 `to_json_pretty()` 会在写入线协议数据前执行相同检查。
- 验证会返回包含稳定代码、JSON Pointer 路径
  和消息的结构化问题。
- 实现并测试显式迁移前，未知版本都会被拒绝。
  缺失的旧版事实会继续缺失，不会凭空补造。
- 此 crate 不依赖 wgpu。运行时到 Snapshot 的投影由
  `zenfg` 在其 `snapshot` feature 下负责。

规范性的 Schema、规范文档、测试夹具和一致性清单由
`@zenfg/snapshot` 发布。完整约定见
[Snapshot 1.2 规范](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/packages/snapshot/SPEC.md)
。

<a id="common-mistakes"></a>

## 常见错误

| 现象 | 解决方法 |
| --- | --- |
| 旧格式输入未通过类型化或规范验证 | 先解码，以执行显式迁移。 |
| 序列化拒绝某个类型化值 | 写入 JSON 前先验证数据并检查结构化问题。 |
| 未知版本的结构看起来相似 | 在读取方实现并测试迁移前拒绝该版本。 |
| 生成方期望验证器补齐缺失事实 | 显式填入必需事实；验证器不会虚构诊断数据。 |
| 期望通过 Snapshot 重放 GPU 工作 | 改用应用负责的命令/资源捕获机制。 |

<a id="complete-example"></a>

## 完整示例

此 crate 随附经过编译检查的 [`examples/basic.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/crates/zenfg-snapshot/examples/basic.rs) 工作流。跨语言测试夹具和生产者投影位于规范包 `@zenfg/snapshot` 的一致性测试集中。

<a id="further-reading"></a>

## 延伸阅读

- [Snapshot 1.2 规范](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/packages/snapshot/SPEC.md)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/packages/snapshot/README.md)
- [`zenfg`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/crates/zenfg/README.md)
- [兼容性](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.1/docs/compatibility.md)

<a id="documentation-and-versions"></a>

## 文档与版本

<!-- generated:documentation:start -->
包清单声明 **zenfg-snapshot 0.1.1**. 注册表徽章显示当前发布渠道，并非已安装版本。

- 已安装版本的准确 API：阅读包内的 `src/`, 或运行 `cargo doc --open` （在使用该包的项目中）。
- [在线指南（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/packages/zenfg-snapshot.html). 网站可能包含晚于此包版本的变更。
- [此版本的 Rust API（英文）](https://docs.rs/zenfg-snapshot/0.1.1/).
- [此发布版本的源码与文档](https://github.com/uinosoft/zenfg/tree/cargo/zenfg-snapshot/v0.1.1/crates/zenfg-snapshot).
- 使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。
- [包升级说明][zenfg-snapshot-migration].
- [纯 Markdown 文档索引（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/llms.txt).
- 完整 Cargo 示例位于 `examples/`.
<!-- generated:documentation:end -->

[zenfg-snapshot-migration]: docs/MIGRATION.zh-CN.md
