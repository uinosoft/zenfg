<!-- translation: {"version":1,"source":"packages/webgpu/examples/README.md","sourceHash":"f4835e11929a9d6f92cdcc52af5643108baf73c53956f5b66a899a39e94a3e91","state":"ready"} -->

<a id="typescript-recipes"></a>

# TypeScript 示例

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

这些完整示例只从 ZenFG 支持的包入口导入内容，并在 CI 中进行类型检查。GPU 设备、canvas 上下文、管线、原生资源和外部渲染器适配器都作为显式函数参数，因此可以将文件直接复制到应用中使用，无需测试专用的模拟对象。每个文件都在 `record*` 函数中声明 FrameGraph，并提供一个简单的执行包装器，使 ZenFG Examples 等宿主能够启用诊断并编译完全相同的录制内容。

以主题命名的文件是对应示例的阅读入口；示例不会引入 `main.ts` 或浏览器运行时。每个文件开头都应包含一段简短的英文块注释，列出 `Source:`、`Demonstrates:`、`Flow:` 和 `Read next:`。注释需说明调用方负责提供哪些输入、图如何执行，并链接到相关代码而不重复其内容。Examples 适配器会通过 `entrySourceId` 显式注册同一个文件，并将浏览器初始化、捕获辅助函数和着色器放在示例代码之后。

| 示例 | 展示内容 |
| --- | --- |
| [`resource-pool-control.ts`](./resource-pool-control.ts) | 按作用域清理尺寸调整后的资源，并由应用谓词执行驱逐 |
| [`minimal-frame.ts`](./minimal-frame.ts) | 运行时与录制生命周期、导入表面资源、呈现根 |
| [`transient-to-present.ts`](./transient-to-present.ts) | 推导瞬态资源使用方式、类型化访问令牌、原生通道回调 |
| [`imported-resource.ts`](./imported-resource.ts) | 导入调用方拥有的缓冲区、图可见的 uniform 访问，以及可选的原生渲染通道扩展和 MSAA 解析/丢弃 |
| [`persistent-state.ts`](./persistent-state.ts) | 已定义/未定义的导入内容，以及跨帧状态根 |
| [`external-submission.ts`](./external-submission.ts) | 不透明的调用方提交边界，以及其后的原生工作 |
| [`snapshot-export.ts`](./snapshot-export.ts) | 将匹配的编译、计时和资源池报告编码为规范的 Snapshot 1.2 JSON，供调用方下载或存储 |
| [`gpu-timing.ts`](./gpu-timing.ts) | 可选的异步时间戳回读，以及不可用的结果 |
| [`compute-output.ts`](./compute-output.ts) | 通过输出根保留计算存储输出 |

“Imported Resource”示例有意公开只在单个通道中使用的 uniform，用于讲解资源导入、访问令牌和输入校验。复杂工作负载也可以选择在内部绑定私有参数，详情见
[选择资源声明粒度](../docs/CONCEPTS.zh-CN.md#choosing-resource-declaration-granularity).

“Imported Resource”示例还接受可选的 `webgpuDescriptor` 字段和调用方拥有的 `multisampleTexture`。请提供一张使用 `RENDER_ATTACHMENT`、格式和尺寸与后缓冲区相符的 4x MSAA 纹理，以及匹配的管线。示例会将其清除并解析到当前后缓冲区；由于后续节点不会再读取该 MSAA 源，它随后会被丢弃。省略这两个输入时，示例仍会直接绘制到单采样目标。描述符扩展会保留原生对象身份，不会转移所有权；原生功能和管线兼容性仍由应用负责。详见
[原生渲染通道描述符扩展](../docs/README.zh-CN.md#native-render-pass-descriptor-extras)
了解实验性资源表及显式图访问要求。

每个 `FrameGraph` 对应一个 `GPUDevice`，并在设备生命周期内复用。按照示例导出函数的参数先获取输入，再调用示例；设备绑定的渲染器栈销毁时，调用 `graph.destroy()`。
