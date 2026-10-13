// VitePress interface strings belong to its locale configuration. These are
// unrelated to the adjacent Markdown translation cache or homepage copy.
export const docsUi = {
    en: {
        description: 'FrameGraph guides and API reference for WebGPU and wgpu.',
        groups: { Introduction: 'Introduction', 'Getting started': 'Getting started', Concepts: 'Concepts', 'Guides & examples': 'Guides & examples', Reference: 'Reference', 'Compatibility & migration': 'Compatibility & migration' },
        context: { label: 'Documentation version and formats', development: 'Development branch', versions: 'Package versions', sourceVersions: 'Development source: ', releases: 'Published component releases: ', unavailable: '(release tags unavailable)', markdown: 'Read Markdown', source: 'English source ↗', translation: 'Translation source ↗', pending: 'Chinese translation has not been approved. Refer to the authoritative English source.', recipe: 'This is the complete, compile-checked package recipe. The caller owns the device and application state.', api: 'API reference (English)' },
        navigation: { label: 'Project navigation', home: 'Home', inspector: 'Inspector', examples: 'Examples', docs: 'Docs' },
        light: 'Switch to light theme', dark: 'Switch to dark theme',
        languageAction: 'Choose language',
    },
    'zh-CN': {
        description: 'WebGPU 与 wgpu 的 FrameGraph 指南及 API 参考。',
        groups: { Introduction: '介绍', 'Getting started': '入门', Concepts: '概念', 'Guides & examples': '指南与示例', Reference: '参考', 'Compatibility & migration': '兼容性与迁移' },
        context: { label: '文档版本与格式', development: '开发分支', versions: '包版本', sourceVersions: '开发源码：', releases: '已发布的组件版本：', unavailable: '（发布标签不可用）', markdown: '阅读 Markdown', source: '英文源文档 ↗', translation: '中文译文源码 ↗', pending: '中文译文尚未确认，请以英文源文档为准。', recipe: '此页展示完整、经过编译检查的包内示例。设备和应用状态由调用方管理。代码保留英文。', api: 'API 参考（英文）' },
        navigation: { label: '项目导航', home: '首页', inspector: 'Inspector', examples: '示例', docs: '文档' },
        light: '切换到浅色主题', dark: '切换到深色主题',
        languageAction: '选择语言',
    },
};

export const chineseTheme = {
    outlineTitle: '本页目录', returnToTopLabel: '返回顶部', sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题', lightModeSwitchTitle: '切换到浅色主题', darkModeSwitchTitle: '切换到深色主题',
    docFooter: { prev: '上一页', next: '下一页' },
    editLink: { pattern: ({ frontmatter }: { frontmatter: Record<string, string> }) => frontmatter.editUrl, text: '编辑此页译文' },
    footer: { message: '开源 / MIT 许可' },
};

export const chineseSearch = {
    button: { buttonText: '搜索', buttonAriaLabel: '搜索文档' },
    modal: { displayDetails: '显示详细结果', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索', noResultsText: '没有结果',
        footer: { selectText: '选择', selectKeyAriaLabel: '回车', navigateText: '切换', navigateUpKeyAriaLabel: '上箭头', navigateDownKeyAriaLabel: '下箭头', closeText: '关闭', closeKeyAriaLabel: 'Esc' } },
};
