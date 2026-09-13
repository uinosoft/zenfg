type Language = 'en' | 'zh-CN';

const preferenceKey = 'zenfg-language';

const translations: Record<Language, Record<string, string>> = {
	en: {
		description: 'ZenFG is an independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		ogDescription: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		title: 'ZenFG | FrameGraph for WebGPU and wgpu',
		home: 'Home',
		docs: 'Docs',
		eyebrow: 'FrameGraph for WebGPU & wgpu',
		summary: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		value: 'Organize rendering. Validate resource dependencies. Inspect every frame.',
		capabilities: 'Capabilities',
		runtimeTitle: 'TypeScript / Rust',
		runtimeDescription: 'Compose rendering workflows for WebGPU and wgpu with dedicated runtimes.',
		validationTitle: 'Resource validation',
		validationDescription: 'Declare resource access and validate dependencies before execution.',
		inspectionTitle: 'Snapshot & Inspector',
		inspectionDescription: 'Capture portable Snapshots and explore each frame with an embeddable Inspector.',
		inspector: 'Inspector',
		playground: 'Playground',
		openPlayground: 'Open Playground',
		documentation: 'Read the docs',
		github: 'GitHub',
		note: 'Open source / MIT licensed',
		projectLinks: 'Project resources',
		languageLabel: '中文',
		languageAction: 'Switch to Simplified Chinese',
		coverStory: 'Explore the cover story',
		explore: 'Explore',
	},
	'zh-CN': {
		description: 'ZenFG 是面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		ogDescription: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		title: 'ZenFG | 面向 WebGPU 与 wgpu 的 FrameGraph 工具链',
		home: '首页',
		docs: '文档',
		eyebrow: '面向 WebGPU 与 wgpu 的 FrameGraph',
		summary: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		value: '组织渲染流程，验证资源依赖，检查每一帧。',
		capabilities: '核心能力',
		runtimeTitle: 'TypeScript / Rust 运行时',
		runtimeDescription: '通过各自的运行时，为 WebGPU 与 wgpu 组合渲染流程。',
		validationTitle: '资源验证',
		validationDescription: '声明资源访问，在执行前验证依赖关系。',
		inspectionTitle: 'Snapshot 与 Inspector',
		inspectionDescription: '捕获可移植 Snapshot，通过可嵌入的 Inspector 探索每一帧。',
		inspector: 'Inspector',
		playground: 'Playground',
		openPlayground: '打开 Playground',
		documentation: '查看文档',
		github: 'GitHub',
		note: '开源 / 采用 MIT 许可证',
		projectLinks: '项目资源',
		languageLabel: 'EN',
		languageAction: '切换到英文',
		coverStory: '探索封面故事',
		explore: '探索',
	},
};

function setStoredLanguage(language: Language): void {
	try {
		window.localStorage.setItem(preferenceKey, language);
	} catch {
		// Private browsing and blocked storage should not prevent language switching.
	}
}

function applyLanguage(language: Language): void {
	const content = translations[language];
	document.documentElement.lang = language;
	document.title = content.title;

	for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
		const key = element.dataset.i18n;
		if (key && content[key]) element.textContent = content[key];
	}
	for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
		const key = element.dataset.i18nAria;
		if (key && content[key]) element.setAttribute('aria-label', content[key]);
	}
	for (const element of document.querySelectorAll<HTMLMetaElement>('meta[data-i18n]')) {
		const key = element.dataset.i18n;
		if (key && content[key]) element.content = content[key];
	}

	const toggle = document.querySelector<HTMLButtonElement>('[data-language-toggle]');
	const label = document.querySelector<HTMLElement>('[data-language-label]');
	if (toggle) {
		toggle.dataset.language = language;
		toggle.setAttribute('aria-label', content.languageAction);
		toggle.title = content.languageAction;
	}
	if (label) label.textContent = content.languageLabel;
	document.documentElement.removeAttribute('data-language-pending');
}

/** Homepage-only language preference; shared navigation labels use data attributes. */
export function installHomeLanguage(): { restore(): void; destroy(): void } {
	const toggle = document.querySelector<HTMLButtonElement>('[data-language-toggle]');
	let language: Language = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
	applyLanguage(language);
	const onClick = () => {
		language = language === 'en' ? 'zh-CN' : 'en';
		setStoredLanguage(language);
		applyLanguage(language);
	};
	toggle?.addEventListener('click', onClick);
	return { restore: () => applyLanguage(language), destroy: () => toggle?.removeEventListener('click', onClick) };
}
