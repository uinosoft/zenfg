import { startZenBackground } from './background.ts';

type Language = 'en' | 'zh-CN';

const preferenceKey = 'zenfg-language';
const chineseLanguagePattern = /^(zh|cmn)(?:[-_]|$)/i;

const translations: Record<Language, Record<string, string>> = {
	en: {
		description: 'ZenFG is an independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		ogDescription: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		title: 'ZenFG | FrameGraph for WebGPU and wgpu',
		docs: 'Docs',
		eyebrow: 'FrameGraph for WebGPU & wgpu',
		summary: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu, with TypeScript and Rust runtimes, a portable Snapshot format, validation, and an embeddable Inspector.',
		inspector: 'Open Inspector',
		documentation: 'Documentation',
		github: 'GitHub',
		note: 'Open source / MIT licensed',
		projectLinks: 'Project resources',
		languageLabel: '中文',
		languageAction: 'Switch to Simplified Chinese',
	},
	'zh-CN': {
		description: 'ZenFG 是面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		ogDescription: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		title: 'ZenFG | 面向 WebGPU 与 wgpu 的 FrameGraph 工具链',
		docs: '文档',
		eyebrow: '面向 WebGPU 与 wgpu 的 FrameGraph',
		summary: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链，提供 TypeScript 和 Rust 运行时、可移植 Snapshot 格式、验证工具与可嵌入 Inspector。',
		inspector: '打开 Inspector',
		documentation: '文档索引',
		github: 'GitHub',
		note: '开源 / 采用 MIT 许可证',
		projectLinks: '项目资源',
		languageLabel: 'EN',
		languageAction: '切换到英文',
	},
};

function getStoredLanguage(): Language | undefined {
	try {
		const stored = window.localStorage.getItem(preferenceKey);
		return stored === 'en' || stored === 'zh-CN' ? stored : undefined;
	} catch {
		return undefined;
	}
}

function getSystemLanguage(): Language {
	const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
	for (const language of languages) {
		if (chineseLanguagePattern.test(language)) return 'zh-CN';
		if (/^en(?:[-_]|$)/i.test(language)) return 'en';
	}
	return 'en';
}

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
}

const toggle = document.querySelector<HTMLButtonElement>('[data-language-toggle]');
let language = getStoredLanguage() ?? getSystemLanguage();
applyLanguage(language);

toggle?.addEventListener('click', () => {
	language = language === 'en' ? 'zh-CN' : 'en';
	setStoredLanguage(language);
	applyLanguage(language);
});

const backgroundCanvas = document.querySelector<HTMLCanvasElement>('[data-zenfg-background]');
if (backgroundCanvas) void startZenBackground(backgroundCanvas);
