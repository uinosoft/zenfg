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
		summary: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu—with TypeScript and Rust runtimes, portable Snapshots, built-in validation, and an embeddable Inspector.',
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
	},
	'zh-CN': {
		description: 'ZenFG 是面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		ogDescription: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		title: 'ZenFG | 面向 WebGPU 与 wgpu 的 FrameGraph 工具链',
		home: '首页',
		docs: '文档',
		eyebrow: '面向 WebGPU 与 wgpu 的 FrameGraph',
		summary: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链，提供 TypeScript 与 Rust 运行时、可移植 Snapshot、内置验证和可嵌入 Inspector。',
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
