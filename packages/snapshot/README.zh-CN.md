<!-- translation: {"version":1,"source":"packages/snapshot/README.md","sourceHash":"c67f0ce3906a8706005c9fe6af9efacc38085e7f0d83d467f5942226637155c3","state":"ready"} -->

# @zenfg/snapshot

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<!-- generated:badges:start -->
[![@zenfg/snapshot published latest version](https://img.shields.io/npm/v/%40zenfg%2Fsnapshot/latest?label=npm)](https://www.npmjs.com/package/@zenfg/snapshot)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/snapshot/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.1/LICENSE)
<!-- generated:badges:end -->

`@zenfg/snapshot` 负责定义可移植、带版本的诊断约定，以便
在数据生成方和查看器之间传递已编译的 FrameGraph 帧。它提供
Snapshot 1.2 线协议类型、编解码器、验证器、JSON Schema、测试夹具、迁移工具和
一致性测试集，且不依赖 DOM、WebGPU 或 FrameGraph 运行时。

Snapshot 文件包含图结构和诊断信息，不包含 GPU 命令或
资源内容，因此无法重放帧。Snapshot 线协议版本与
此包的 API 版本相互独立。

Snapshot 1.1 输入会在迁移到 1.2 前先通过验证；其 CPU 计时
会标记为 `not-collected`。写入方和独立验证器只接受规范版 1.2。已有的 Legacy 来源信息和扩展字段会予以保留。

<a id="installation"></a>

## 安装

<!-- generated:installation:start -->
```sh
npm install @zenfg/snapshot@0.1.1
```
<!-- generated:installation:end -->

<!-- skill:description:start -->
使用 @zenfg/snapshot 解析或验证不可信的 FrameGraph 捕获数据、规范化受支持的历史输入、完成生产者草稿的校验与分离，或序列化规范 Snapshot JSON。
<!-- skill:description:end -->

<!-- skill:quick-start:start -->
<a id="quick-start"></a>

## 快速入门

请使用目标为 ES2022 或更高版本的 ESM TypeScript 项目。此包不需要
DOM 或 GPU 对象。将捕获的 Snapshot JSON 传给 `normalizeSnapshot(jsonText)`；
输入有效时会返回格式化后的规范 JSON，输入无效时会报告相应问题。

处理不可信的 JSON 文本时，请使用 `parseFrameGraphSnapshot()`。受支持的旧
格式会迁移为独立的规范 Snapshot 1.2 值：

```ts
import {
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
} from '@zenfg/snapshot';

export function normalizeSnapshot(jsonText: string): string {
	const decoded = parseFrameGraphSnapshot(jsonText);
	if (!decoded.ok) {
		throw new Error(decoded.issues.map((issue) => issue.message).join('\n'));
	}
	return stringifyFrameGraphSnapshot(decoded.snapshot, { pretty: true });
}
```

解码和验证遇到不可信输入时会返回结构化问题，而不是
抛出原生 JSON 或克隆错误。序列化和生成方
收尾操作会在调用方试图写入无效规范数据时抛出 `FrameGraphSnapshotValidationError`，以拒绝
该数据。

解码、解析和收尾后的 Snapshot 中，对象均使用 null 原型，
包括扩展对象；数组仍是普通数组。继承的字段
和 getter 会被忽略。请使用 `Object.hasOwn(object, key)`，不要使用
`object.hasOwnProperty(key)`。这一变化只影响 JavaScript 对象原型，不会改变
Snapshot 字段或 JSON 线协议格式。
<!-- skill:quick-start:end -->

<a id="common-tasks"></a>

## 常见任务

| 任务 | 公共 API |
| --- | --- |
| 解析不可信 JSON 文本 | `parseFrameGraphSnapshot()` |
| 解码已解析但类型未知的值 | `decodeFrameGraphSnapshot()` |
| 验证程序构造的规范数据 | `validateFrameGraphSnapshot()` |
| 完成生产者草稿校验并返回独立副本 | `finalizeFrameGraphSnapshot()` |
| 序列化规范 Snapshot 数据 | `stringifyFrameGraphSnapshot()` |
| 处理生产者侧验证失败 | `FrameGraphSnapshotValidationError` |
| 读取规范格式和版本 | `FRAME_GRAPH_SNAPSHOT_FORMAT`, `FRAME_GRAPH_SNAPSHOT_VERSION` |
| 读取扩展深度上限 | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |
| 导入 JSON Schema | `@zenfg/snapshot/schema/v1.json` |

准确的返回联合类型、问题类型、线协议字段、默认值和失败条件
见随包源代码及类型声明保留的 TSDoc。

<!-- skill:boundaries:start -->
<a id="consumer-and-producer-boundaries"></a>

## 消费方与生成方的职责边界

- 消费方应使用 `parseFrameGraphSnapshot()` 处理文本，或使用
  `decodeFrameGraphSnapshot()` 处理未知类型的值。两者都接受规范版 1.2 和
  受支持的历史格式，会执行迁移并返回带判别字段的
  结果。
- 在内存中组装草稿的生成方应使用
  `finalizeFrameGraphSnapshot()`。 它会移除值为 `undefined` 的可选属性，
  验证 JSON 安全性和 Snapshot 语义，并返回独立的规范
  数据。
- `validateFrameGraphSnapshot()` 只检查规范数据，不会迁移
  历史输入。
- 未知格式和版本会被拒绝，直到实现明确的迁移逻辑。
  读取方不得猜测其他线协议版本兼容。
- 程序传入的输入按只读处理。解码、迁移和
  收尾操作都不会修改调用方拥有的值。

完整的结构及跨字段约定见
[`SPEC.md`](SPEC.zh-CN.md) 。JSON Schema 规定结构约束；
规范文档和一致性测试集则定义
引用关系、跨字段语义、迁移规则及稳定的问题报告行为。
<!-- skill:boundaries:end -->

<a id="schema-and-fixtures"></a>

## Schema 与测试夹具

通过 import attribute 导入已发布的 Draft 2020-12 Schema：

```ts
import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' };
```

消费方需要配置 JSON 模块解析，并使用支持 import
attributes 的模块模式。已发布的测试夹具和一致性用例覆盖规范文档、
旧格式迁移、无效结构、无效语义、稳定键、分配、
计时及扩展深度边界。

Snapshot 文件通常使用 `.fgsnapshot.json` 扩展名。实体 ID
是带类型前缀的字符串；计数、大小和帧索引均为非负的
JavaScript 安全整数。

<!-- skill:mistakes:start -->
<a id="common-mistakes"></a>

## 常见错误

| 现象 | 解决方法 |
| --- | --- |
| 将解析后的 JSON 当作可信 Snapshot 数据 | 先通过 `parseFrameGraphSnapshot()` 或 `decodeFrameGraphSnapshot()` 处理。 |
| 旧格式输入未通过规范数据验证 | 先解码以执行显式迁移；单独进行规范验证不会触发迁移。 |
| 生成方写入 `undefined`、非有限数或不受支持的值 | 序列化前先收尾草稿，并处理 `FrameGraphSnapshotValidationError` 。 |
| 未知版本的字段看起来似乎兼容 | 在读取方实现并测试显式迁移前拒绝该版本。 |
| 期望线协议模型中存在反向关系 | 在消费方本地构建索引；协议只存储规范的单向引用。 |
| 期望通过 Snapshot 重放 GPU 工作 | 改用应用负责的机制捕获命令或资源内容。 |
<!-- skill:mistakes:end -->

<a id="further-reading"></a>

## 延伸阅读

- [Snapshot 1.2 规范](SPEC.zh-CN.md)
- [`@zenfg/webgpu` Snapshot 生成方](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.1/packages/webgpu/README.md#diagnostics-and-snapshot)
- [`zenfg-snapshot`](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.1/crates/zenfg-snapshot/README.md)
- [`@zenfg/inspector`](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.1/packages/inspector/README.md)

<a id="documentation-and-versions"></a>

## 文档与版本

<!-- generated:documentation:start -->
包清单声明 **@zenfg/snapshot 0.1.1**. 注册表徽章显示当前发布渠道，并非已安装版本。

- 已安装版本的准确 API：查看 `package.json` → `exports` → `dist/*.d.ts`; 声明映射指向包内的 `src/`. 只有声明的导出路径属于公共 API。
- [在线指南（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/packages/snapshot.html). 网站可能包含晚于此包版本的变更。
- [TypeScript API（开发分支，英文）](https://uinosoft.github.io/zenfg/docs/api/snapshot/).
- [此发布版本的源码与文档](https://github.com/uinosoft/zenfg/tree/npm/snapshot/v0.1.1/packages/snapshot).
- 使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。
- [包升级说明](docs/MIGRATION.zh-CN.md).
- [纯 Markdown 文档索引（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/llms.txt).
- 包内数据格式约定： [SPEC.md](SPEC.zh-CN.md), `schema/`, `fixtures/` and `conformance/`.
<!-- generated:documentation:end -->

<!-- skill:reading:start -->
<a id="usage-references"></a>

## 使用参考

- [线协议规范](SPEC.zh-CN.md)
- [升级说明](docs/MIGRATION.zh-CN.md)
- [Schema](./schema/frame-graph-snapshot-v1.schema.json)
<!-- skill:reading:end -->
