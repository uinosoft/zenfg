<!-- translation: {"version":1,"source":"packages/snapshot/docs/MIGRATION.md","sourceHash":"b87ad3468891da9eec7c344d6d3c014bdd528ed36ad87d008ee3feffe544bd04","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

<a id="zenfgsnapshot-upgrade-notes"></a>

# @zenfg/snapshot 升级说明

各包 API 版本与 Snapshot 线协议版本相互独立。下文所述历史变更适用于列出的版本，不代表所有当前集成方式。

<a id="snapshot-12-and-package-011"></a>

## Snapshot 1.2 与包版本 0.1.1

Snapshot 1.2 仍是规范格式。包版本 0.1.1 修正了祖先关系校验，不会改变有效捕获数据或编解码器 API。受支持的 1.1 输入会在迁移前先校验；CPU 计时会变为 not-collected。Legacy V0 和 Candidate V1 仍可读取。规范版 1.0 和未知版本仍会被拒绝。单独进行校验或序列化不会触发迁移。保留来源信息和扩展字段；不要通过改版本号来伪造缺失的捕获事实。

<a id="snapshot-readers-and-producers"></a>

## Snapshot 读取方与生成方

Beta.2 生成并读取规范版 Snapshot 1.0。Beta.3 生成并读取规范版 Snapshot 1.1。两者都不接受对方的规范版本。已有的 Legacy V0 和 Legacy Candidate V1 迁移不会迁移规范版 1.0 捕获数据。归档的 1.0 文件请继续使用 beta.2 读取方，或使用 beta.3 重新生成捕获数据。不要直接替换旧文件中的版本号：通常无法根据图的可达性还原所需的根事实。

原生资源根必须包含 `resourceId`、非空的规范化 `range`，以及 `resolution: { producerNodeIds, usesInitialContents }`。相反，`side-effect` 根应包含 `nodeId`，且不包含资源、范围或解析信息。自定义生成方、测试夹具和报告适配器都应更新为这个带判别字段的模型。只有显式的旧版迁移来源信息可以允许资源根事实缺失；缺失代表未知，不代表没有生产者或值为 `false`。

<a id="release-history"></a>

## 发布历史

各包版本和历史验收依据见[组件发布说明](https://github.com/uinosoft/zenfg/tree/npm/snapshot/v0.1.1/docs/releases)。
