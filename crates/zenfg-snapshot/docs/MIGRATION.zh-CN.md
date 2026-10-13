<!-- translation: {"version":1,"source":"crates/zenfg-snapshot/docs/MIGRATION.md","sourceHash":"bef9a3b3eb777f627361ed25d59c785423754d060d98b5d58dc64f53cf6fc65a","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

<a id="zenfg-snapshot-upgrade-notes"></a>

# zenfg-snapshot 升级说明

各包 API 版本与 Snapshot 线协议版本相互独立。下文所述历史变更适用于列出的版本，不代表所有当前集成方式。

<a id="snapshot-12-and-package-011"></a>

## Snapshot 1.2 与包版本 0.1.1

Snapshot 1.2 仍是规范格式。包版本 0.1.1 修正了祖先关系校验，不会改变有效捕获数据或编解码器 API。受支持的 1.1 输入会在迁移前先校验；CPU 计时会变为 not-collected。Legacy V0 和 Candidate V1 仍可读取。规范版 1.0 和未知版本仍会被拒绝。单独进行校验或序列化不会触发迁移。保留来源信息和扩展字段；不要通过改版本号来伪造缺失的捕获事实。

<a id="release-history"></a>

## 发布历史

各包版本和历史验收依据见[组件发布说明](https://github.com/uinosoft/zenfg/tree/cargo/zenfg-snapshot/v0.1.1/docs/releases)。
