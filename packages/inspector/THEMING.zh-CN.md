<!-- translation: {"version":1,"source":"packages/inspector/THEMING.md","sourceHash":"2fc8410d306444266bb7d559516d68be22e6d763bb4d22aa10afcfd6e65a65e0","state":"ready"} -->

<a id="inspector-themes"></a>

# Inspector 主题

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./THEMING.md
[documentation-zh]: ./THEMING.zh-CN.md
<!-- generated:language:end -->

公开的样式约定由 `--zfgi-*` CSS 自定义属性构成。Inspector 内置完整的 Tokyo Night Storm 默认主题，并支持宿主只覆盖部分属性；无需指定基础主题或主题名称，也不需要注册主题或使用浏览器存储。主题变更只影响单个 Inspector。Snapshot 数据不包含主题。

<a id="official-presets-and-custom-themes"></a>

## 官方预设与自定义主题

```ts
import { mountFrameGraphInspector } from '@zenfg/inspector';
import { tokyoNightStorm, tokyoNightLight, type InspectorTheme } from '@zenfg/inspector/theme';

const inspector = mountFrameGraphInspector(host, { theme: tokyoNightLight });
inspector.setTheme(tokyoNightStorm);

const brandTheme: InspectorTheme = {
  ...tokyoNightLight,
  variables: { ...tokyoNightLight.variables, '--zfgi-accent': '#2959aa' },
};
inspector.setTheme(brandTheme);
inspector.setTheme(null); // Restore host CSS and component defaults.
```

两个预设都是普通的不可变 `InspectorTheme` 对象。纯 `/theme` 入口无需 DOM 即可导入，也不会加载 Cytoscape 或 ELK。宿主还可以使用其中共享的 `visualThemes` 和 `visualMetrics` 基础定义。

`setTheme()` 会替换 `inspector.dom.style` 上当前由 API 设置的变量集合，并自动同步图。新主题中省略的属性不会沿用上一个预设的颜色。重置时会恢复原有的行内声明，不影响无关样式或之后编辑过的声明。按照常规 CSS 规则，根元素的行内变量优先于从宿主继承的变量。

`colorScheme: 'dark' | 'light'` 会映射到 `--zfgi-color-scheme`；不要再把它放进 `variables`。它控制浏览器原生外观，不负责选择配色。组件不会根据浅色背景或此提示自动推导浅色调色板。

<a id="css-only-use"></a>

## 仅使用 CSS

挂载组件和初始化图时会读取宿主上设置的静态变量：

```css
.inspector-host {
  --zfgi-accent: var(--app-accent, #7aa2f7);
  --zfgi-font-ui: system-ui, sans-serif;
  --zfgi-graph-render-stroke: #9ece6a;
}
```

无需调用 JavaScript 主题 API。未指定的变量会使用 CSS 回退值。默认挂载时，组件不会将整套主题写入行内样式，因此变量会按常规方式从父元素继承。请在同一个容器上配置彼此依赖的覆盖值：CSS 自定义属性引用会在其声明位置解析。

如需使用完整的 CSS 预设，请显式导入可选样式表：

```css
@import '@zenfg/inspector/themes.css';
```

```html
<div class="inspector-host" data-zfgi-theme="tokyo-night-light"></div>
```

另一个预设选择器是 `data-zfgi-theme="tokyo-night-storm"`。此样式表不会设置全局主题，其中的声明只对匹配的容器生效。变量值与 JavaScript 预设来自同一组定义。

<a id="dynamic-css-and-graph-synchronization"></a>

## 动态 CSS 与图同步

```ts
host.dataset.zfgiTheme = 'tokyo-night-light';
inspector.refreshTheme();
```

DOM 样式通过 CSS 更新。Cytoscape 使用解析后的值，而不会直接读取浏览器 CSS，因此修改宿主变量、类名、主题属性或媒体查询相关值后，请调用 `refreshTheme()`。JS `setTheme()` 已会执行此操作。刷新时只读取 CSS，不会重写变量。组件不会安装全局观察器或轮询；隐藏的图再次显示时也会刷新。

更改调色板不会重建图实例，也不会重置节点位置、平移/缩放、选择状态、分组展开状态、当前视图、筛选条件、详情状态或滚动位置。更改图字体时会重新测量标签并更新布局，同时保留缩放比例和锚点。

<a id="supported-variables"></a>

## 支持的变量

下列名称均带有 `--zfgi-` 前缀。`InspectorThemeVariables` 提供完整的 TypeScript 键列表。值使用 CSS 语法：例如 `13px` 这样的长度、字体族列表、包含 `var()` 和 `color-mix()` 的颜色，以及无单位的不透明度或缩放值。字体大小和宽度须为正数，不透明度须在 0–1 之间，箭头缩放值须非负。

| 分组 | 前缀后的名称 |
| --- | --- |
| 表面 | `canvas`, `background`, `surface`, `surface-raised`, `surface-hover` |
| 文本与强调色 | `text`, `text-secondary`, `muted`, `accent`, `accent-soft`, `accent-hover` |
| 边界与反馈 | `border`, `border-subtle`, `border-strong`, `success`, `warning`, `danger`, `shadow`, `backdrop` |
| 字体 | `font-ui`, `font-mono`, `font-size`, `font-size-small` |
| 尺寸 | `control-height`, `row-height`, `radius-sm`, `radius-md`, `space-1`, `space-2`, `space-3`, `space-4` |
| 原生外观 | `color-scheme` （JS 使用独立的 `colorScheme` 字段） |
| 图标签 | `graph-text`, `graph-muted`, `graph-font-family`, `graph-font-size` |
| 图类别 | `graph-{category}-stroke`, `graph-{category}-fill` |
| 图分组 | `graph-group-stroke`, `graph-group-fill`, `graph-group-alternate-fill`, `graph-group-opacity`, `graph-group-border-width` |
| 图关系 | `graph-value`, `graph-ordering`, `graph-read`, `graph-write`, `graph-edge-width`, `graph-edge-opacity`, `graph-ordering-opacity`, `graph-arrow-scale` |
| 图状态 | `graph-hover`, `graph-selected`, `graph-hover-width`, `graph-selected-width`, `graph-node-border-width`, `graph-culled-stroke`, `graph-culled-fill` |
| 图按压指示器 | `graph-active-bg`, `graph-active-bg-opacity`, `graph-active-bg-size` （半径以 CSS 像素为单位，默认 `12px`；不透明度默认 `0.08`） |
| 派生类别填充色 | `graph-tint` （Storm 为 18%，Light 为 8%） |

类别包括 `render`、`compute`、`copy`、`clear`、`command`、`external`、`declaration`、`output`、`texture` 和 `buffer`。类别颜色也用于图例、类型标签和资源条。语义形状和布局算法不属于主题参数。悬停或选择状态会突出显示轮廓，不会替换节点形状或类别填充色。

现有的 `--zenfg-inspector-*` 属性仍作为背景、表面、边框、文本、强调色、状态色、字体族和圆角的回退别名。如果新旧属性同时设置，则对应的 `--zfgi-*` 属性优先。内部 `--fgd-*` 属性和展示类名不属于公开主题约定。

官方预设的目标对比度为：节点文本至少 7:1，UI 文本至少 4.5:1，用于识别的边框和连线至少 3:1。自定义颜色也应保持这些对比度；应用主题时不会自动修正自定义调色板。
