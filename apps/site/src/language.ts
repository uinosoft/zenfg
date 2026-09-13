type Language = 'en' | 'zh-CN';

const preferenceKey = 'zenfg-language';

const translations: Record<Language, Record<string, string>> = {
	en: {
		description: 'ZenFG is an independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		ogDescription: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		title: 'ZenFG | FrameGraph for WebGPU and wgpu',
		home: 'Home',
		docs: 'Docs',
		summary: 'An independent, composable FrameGraph toolchain for WebGPU and wgpu.',
		value: 'Organize rendering. Inspect every frame.',
		capabilities: 'Capabilities',
		runtimeTitle: 'TypeScript / Rust',
		runtimeDescription: 'One toolchain. Two ecosystems.',
		runtimeDetail: 'Connect different renderers in a shared frame graph.',
		validationTitle: 'Resource management',
		validationDescription: 'Manage resources. Catch issues early.',
		validationDetail: 'Track dependencies, manage lifetimes, and reuse transient resources.',
		inspectionTitle: 'Snapshot & Inspector',
		inspectionDescription: 'Understand every frame.',
		inspectionDetail: 'Capture, navigate, and inspect your frame graph.',
		inspector: 'Inspector',
		playground: 'Playground',
		openPlayground: 'Open Playground',
		documentation: 'Read the docs',
		github: 'GitHub',
		note: 'Open source / MIT licensed',
		projectLinks: 'Project resources',
		languageAction: 'Choose language',
		coverStory: 'Explore the cover story',
		explore: 'Explore',
	},
	'zh-CN': {
		description: 'ZenFG 是面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		ogDescription: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		title: 'ZenFG | 面向 WebGPU 与 wgpu 的 FrameGraph 工具链',
		home: '首页',
		docs: '文档',
		summary: '面向 WebGPU 与 wgpu 的独立、可组合 FrameGraph 工具链。',
		value: '组织渲染，洞察每一帧。',
		capabilities: '核心能力',
		runtimeTitle: 'TypeScript / Rust',
		runtimeDescription: '一套工具链，连接两种生态。',
		runtimeDetail: '在同一帧图中连接不同渲染器。',
		validationTitle: '资源管理',
		validationDescription: '管理资源，提前发现问题。',
		validationDetail: '追踪依赖、管理生命周期，复用临时资源。',
		inspectionTitle: 'Snapshot 与 Inspector',
		inspectionDescription: '看清每一帧。',
		inspectionDetail: '捕获帧快照，浏览并检查渲染流程。',
		inspector: 'Inspector',
		playground: 'Playground',
		openPlayground: '打开 Playground',
		documentation: '查看文档',
		github: 'GitHub',
		note: '开源 / 采用 MIT 许可证',
		projectLinks: '项目资源',
		languageAction: '选择语言',
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

	if (toggle) {
		toggle.dataset.language = language;
		toggle.setAttribute('aria-label', content.languageAction);
		toggle.title = content.languageAction;
	}
	for (const choice of document.querySelectorAll<HTMLButtonElement>('[data-language-choice]')) {
		choice.setAttribute('aria-checked', String(choice.dataset.languageChoice === language));
	}
	document.querySelector('[role="menu"][id="site-language-menu"]')?.setAttribute('aria-label', content.languageAction);
	document.documentElement.removeAttribute('data-language-pending');
}

/** Homepage-only language preference; shared navigation labels use data attributes. */
export function installHomeLanguage(): { restore(): void; destroy(): void } {
	const root = document.querySelector<HTMLElement>('[data-language-root]')!;
	const toggle = root.querySelector<HTMLButtonElement>('[data-language-toggle]')!;
	const menu = root.querySelector<HTMLElement>('[role=menu]')!;
	const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-language-choice]')];
	let language: Language = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
	applyLanguage(language);
	const close = (returnFocus = false) => {
		menu.hidden = true;
		toggle.setAttribute('aria-expanded', 'false');
		if (returnFocus) toggle.focus();
	};
	const open = (index = choices.findIndex(choice => choice.dataset.languageChoice === language)) => {
		menu.hidden = false;
		toggle.setAttribute('aria-expanded', 'true');
		choices[index]?.focus();
	};
	const click = (event: MouseEvent) => {
		const target = event.target as Element;
		if (toggle.contains(target)) { if (menu.hidden) open(); else close(true); return; }
		const choice = target.closest<HTMLButtonElement>('[data-language-choice]');
		if (!choice || !choices.includes(choice)) return;
		language = choice.dataset.languageChoice === 'zh-CN' ? 'zh-CN' : 'en';
		setStoredLanguage(language);
		applyLanguage(language);
		close(true);
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); return; }
		if (event.key === 'Tab') { close(true); return; }
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		if (menu.hidden) { open(event.key === 'ArrowUp' || event.key === 'End' ? choices.length - 1 : 0); return; }
		const index = choices.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
		choices[next]?.focus();
	};
	const outside = (event: PointerEvent) => { if (!event.composedPath().includes(root)) close(); };
	const focusout = (event: FocusEvent) => { if (!root.contains(event.relatedTarget as Node | null)) close(); };
	root.addEventListener('click', click);
	root.addEventListener('keydown', keydown);
	root.addEventListener('focusout', focusout);
	window.addEventListener('pointerdown', outside);
	return {
		restore() { close(); applyLanguage(language); },
		destroy() {
			close();
			root.removeEventListener('click', click);
			root.removeEventListener('keydown', keydown);
			root.removeEventListener('focusout', focusout);
			window.removeEventListener('pointerdown', outside);
		},
	};
}
