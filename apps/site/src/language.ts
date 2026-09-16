type Language = 'en' | 'zh-CN';

const preferenceKey = 'zenfg-language';

const translations: Record<Language, Record<string, string>> = {
	en: {
		composeEyebrow: "YOUR FRAME, YOUR DESIGN",
		composeTitle: "Build independently. Bring it together.",
		composeLead: "Keep control of scenes, materials, pipelines, and rendering policy. Give ZenFG explicit dependencies and resource accesses to coordinate the frame.",
		engineTitle: "Connect an existing engine",
		engineBody: "Let a renderer keep its own commands and submissions. Declare its shared inputs and outputs as an external node, then combine it with work before and after that boundary.",
		moduleTitle: "Build graph-native modules",
		moduleBody: "Use native WebGPU or compatible libraries to build domain-specific rendering and compute. Record nodes into the graph so their declared passes and resource flow can be inspected.",
		modelCompute: "Compute",
		modelComputeDetail: "Graph-visible work",
		modelEngine: "External renderer",
		modelOpaque: "Internal passes stay opaque",
		modelRender: "Render / composite",
		modelRenderDetail: "Graph-visible work",
		modelOutput: "Output",
		modelCaption: "Conceptual composition on a shared device and queue. Edges represent declared resource flow and ordering; the application supplies compatible resources and access declarations.",
		integrationLink: "Explore the three integration levels →",
		examplesEyebrow: "RUNNING EXAMPLES",
		featuredTitle: "See composition in practice.",
		featuredLead: "Each example connects real GPU work to an inspectable frame graph. Open the result, follow its resources, and read the source.",
		referenceLabel: "NATIVE WEBGPU",
		referenceTitle: "Reference Renderer",
		referenceBody: "GPU culling and indirect drawing, built without an engine dependency. A teaching renderer with an explicit Reset → Cull → Draw flow.",
		referenceAction: "Open example ↗",
		threeLabel: "SHARED COLOR + DEPTH",
		threeTitle: "Three.js Co-rendering",
		threeBody: "Three.js and a custom renderer draw into shared color and depth attachments. Their objects occlude each other in one scene.",
		threeAction: "Open example ↗",
		playcanvasLabel: "EXTERNAL ENGINE · NETWORK REQUIRED",
		playcanvasTitle: "PlayCanvas Streaming GSplat",
		playcanvasBody: "Combine streaming Gaussian splats with custom drawing and compositing. Scene data loads from a remote host.",
		playcanvasAction: "Open example ↗",
		typegpuLabel: "COMPUTE + RENDER",
		typegpuTitle: "TypeGPU · Slime Mold",
		typegpuBody: "TypeGPU defines shaders and pipelines; ZenFG connects native compute and render nodes through persistent simulation resources.",
		typegpuAction: "Open example ↗",
		moreExamples: "More integration examples:",
		allExamples: "All examples →",
		examplesBoundary: "Each example documents its dependency versions and integration details.",
		inspectEyebrow: "SNAPSHOT + INSPECTOR",
		inspectTitle: "Understand the frame you actually built.",
		inspectLead: "Follow declared dependencies, resource lifetimes, and diagnostics. Inspect optional CPU/GPU timings alongside the structure that explains them.",
		captureCaption: "Three.js Co-rendering — a real rendered scene and its captured graph. The external renderer appears as a boundary, alongside visible native passes.",
		workflowCapture: "Capture",
		workflowCaptureBody: "Capture an actual frame and locate the passes and resources that matter.",
		workflowAnalyze: "Analyze with context",
		workflowAnalyzeBody: "Export Snapshot JSON with relevant code for human or AI-assisted analysis. Use the Inspector to give precise feedback about the flow.",
		workflowVerify: "Change and verify",
		workflowVerifyBody: "Capture again after changes. Check the resulting graph and available timings rather than assuming an optimization worked.",
		inspectBoundary: "External-engine internals stay opaque. GPU timing depends on device support and node coverage. Snapshots describe declared work; they contain neither replayable GPU commands nor resource contents.",
		inspectGuide: "Read the Inspector workflow →",
		nextTitle: "Start with your GPU stack.",
		runtimeBoundary: "The runtimes share semantics and portable snapshots, with idiomatic APIs for each language.",
		visionTitle: "Toward reusable rendering building blocks",
		visionBody: "We are exploring reusable GPU-driven mesh, particle, and post-processing modules: independently built features that can come together in real applications.",
		modelLabel: "Conceptual frame composition",
		captureAlt: "Three.js and the Reference Renderer sharing a scene, alongside their actual captured ZenFG frame graph",
		description: 'Build rendering features, compose GPU systems, and understand every frame with ZenFG.',
		ogDescription: 'A composable FrameGraph for WebGPU and wgpu.',
		title: 'ZenFG | FrameGraph for WebGPU and wgpu',
		home: 'Home',
		docs: 'Docs',
		summary: 'A composable FrameGraph for WebGPU and wgpu.',
		value: 'Build rendering features, compose GPU systems, and understand every frame.',
		capabilities: 'Capabilities',
		runtimeTitle: 'TypeScript / Rust',
		runtimeDescription: 'One toolchain. Two ecosystems.',
		runtimeDetail: 'Idiomatic runtimes with shared semantics and portable diagnostics.',
		validationTitle: 'Resource management',
		validationDescription: 'Manage resources. Catch issues early.',
		validationDetail: 'Track dependencies, manage lifetimes, and reuse transient resources.',
		inspectionTitle: 'Snapshot & Inspector',
		inspectionDescription: 'Understand every frame.',
		inspectionDetail: 'Capture, navigate, and inspect your frame graph.',
		inspector: 'Inspector',
		examples: 'Examples',
		openExamples: 'Browse examples',
		getStarted: 'Get started',
		github: 'GitHub',
		note: 'Open source / MIT licensed',
		projectLinks: 'Project resources',
		languageAction: 'Choose language',
		coverStory: 'Explore this example',
		explore: 'Explore',
	},
	'zh-CN': {
		composeEyebrow: "你的帧，你来设计",
		composeTitle: "自主构建，让各部分协同工作。",
		composeLead: "场景、材质、管线与渲染策略由你掌控。向 ZenFG 声明依赖和资源访问，让它协调帧内的工作。",
		engineTitle: "接入已有引擎",
		engineBody: "让渲染器保留自己的命令与提交方式，以外部节点声明共享的输入与输出，再与边界前后的其他工作组合。",
		moduleTitle: "构建图内渲染模块",
		moduleBody: "使用原生 WebGPU 或兼容的第三方库，实现领域渲染与计算功能。把节点记录到帧图中，让已声明的 pass 与资源流转清晰可见。",
		modelCompute: "计算",
		modelComputeDetail: "图内可见工作",
		modelEngine: "外部渲染器",
		modelOpaque: "内部 pass 保持不透明",
		modelRender: "渲染 / 合成",
		modelRenderDetail: "图内可见工作",
		modelOutput: "输出",
		modelCaption: "同一 device 与 queue 上的组合示意。连线表示声明的资源流转与执行顺序；应用负责提供兼容资源并正确声明访问。",
		integrationLink: "了解三种集成层级 →",
		examplesEyebrow: "运行中的实例",
		featuredTitle: "看看实际的组合。",
		featuredLead: "每个示例都把真实 GPU 工作连接到可检查的帧图。打开渲染结果，追踪资源，并阅读对应源码。",
		referenceLabel: "原生 WEBGPU",
		referenceTitle: "Reference Renderer",
		referenceBody: "不依赖引擎，实现 GPU 裁剪与间接绘制。通过教学渲染器查看清晰的 Reset → Cull → Draw 流程。",
		referenceAction: "打开示例 ↗",
		threeLabel: "共享颜色与深度",
		threeTitle: "Three.js 协同渲染",
		threeBody: "Three.js 与自研渲染器共同绘制到颜色和深度附件中，两个系统的物体在同一场景中互相遮挡。",
		threeAction: "打开示例 ↗",
		playcanvasLabel: "外部引擎 · 需要网络",
		playcanvasTitle: "PlayCanvas 流式 GSplat",
		playcanvasBody: "组合流式 Gaussian Splat、自研绘制与合成。场景数据从远程站点加载。",
		playcanvasAction: "打开示例 ↗",
		typegpuLabel: "计算与渲染",
		typegpuTitle: "TypeGPU · Slime Mold",
		typegpuBody: "TypeGPU 定义 shader 与管线；ZenFG 通过持久化模拟资源，连接图内计算与渲染节点。",
		typegpuAction: "打开示例 ↗",
		moreExamples: "更多集成示例：",
		allExamples: "全部示例 →",
		examplesBoundary: "各示例的源码与说明记录了依赖版本和接入细节。",
		inspectEyebrow: "SNAPSHOT + INSPECTOR",
		inspectTitle: "看清你实际构建的这一帧。",
		inspectLead: "追踪已声明的依赖、资源生命周期与诊断信息，结合帧图结构查看可选的 CPU/GPU 计时。",
		captureCaption: "Three.js 协同渲染：真实场景及其捕获的帧图。外部渲染器显示为边界，与可见的原生 pass 一同参与执行。",
		workflowCapture: "捕获",
		workflowCaptureBody: "捕获实际帧，定位需要关注的 pass 和资源。",
		workflowAnalyze: "结合上下文分析",
		workflowAnalyzeBody: "导出 Snapshot JSON，结合相关代码进行人工或 AI 辅助分析。借助 Inspector，对执行流程给出具体反馈。",
		workflowVerify: "修改并验证",
		workflowVerifyBody: "修改后再次捕获，检查实际帧图与可用计时，验证优化是否有效。",
		inspectBoundary: "外部引擎内部流程保持不透明。GPU 计时取决于设备支持和节点覆盖范围。Snapshot 描述已声明的工作，不包含可重放的 GPU 命令或资源内容。",
		inspectGuide: "阅读 Inspector 使用指南 →",
		nextTitle: "从你的 GPU 技术栈开始。",
		runtimeBoundary: "两个运行时共享语义和可移植快照，各自提供符合语言习惯的 API。",
		visionTitle: "迈向可复用的渲染模块",
		visionBody: "我们正在探索可复用的 GPU-Driven Mesh、粒子与后处理模块，让独立构建的功能更容易组合并用于实际项目。",
		modelLabel: "帧内组合示意",
		captureAlt: "Three.js 与 Reference Renderer 共同绘制的场景，以及实际捕获的 ZenFG 帧图",
		description: '自主构建渲染功能，组合不同 GPU 系统，看清每一帧的执行过程。',
		ogDescription: '面向 WebGPU 与 wgpu 的可组合 FrameGraph。',
		title: 'ZenFG | 面向 WebGPU 与 wgpu 的 FrameGraph 工具链',
		home: '首页',
		docs: '文档',
		summary: '面向 WebGPU 与 wgpu 的可组合 FrameGraph。',
		value: '自主构建渲染功能，组合不同 GPU 系统，看清每一帧的执行过程。',
		capabilities: '核心能力',
		runtimeTitle: 'TypeScript / Rust',
		runtimeDescription: '一套工具链，连接两种生态。',
		runtimeDetail: '符合各自语言习惯的运行时，共享语义与可移植诊断。',
		validationTitle: '资源管理',
		validationDescription: '管理资源，提前发现问题。',
		validationDetail: '追踪依赖、管理生命周期，复用临时资源。',
		inspectionTitle: 'Snapshot 与 Inspector',
		inspectionDescription: '看清每一帧。',
		inspectionDetail: '捕获帧快照，浏览并检查渲染流程。',
		inspector: 'Inspector',
		examples: '示例',
		openExamples: '浏览示例',
		getStarted: '快速开始',
		github: 'GitHub',
		note: '开源 / 采用 MIT 许可证',
		projectLinks: '项目资源',
		languageAction: '选择语言',
		coverStory: '探索此示例',
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

	for (const element of document.querySelectorAll<HTMLImageElement>('[data-i18n-alt]')) {
		const key = element.dataset.i18nAlt;
		if (key && content[key]) element.alt = content[key];
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
