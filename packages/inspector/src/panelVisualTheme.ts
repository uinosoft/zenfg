export const FRAME_GRAPH_DEBUG_VISUAL_THEME = {
	canvas: '#0b0f14',
	panel: '#0f151d',
	surface: '#131b24',
	surfaceRaised: '#18222d',
	surfaceHover: '#1d2935',
	border: '#263341',
	text: '#e6edf3',
	textSecondary: '#b4beca',
	muted: '#8b98a5',
	accent: '#38bdf8',
	success: '#34d399',
	warning: '#fbbf24',
	danger: '#fb7185',
	fontUi: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	fontMono: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
} as const;

function category(stroke: string) {
	const canvas = FRAME_GRAPH_DEBUG_VISUAL_THEME.canvas;
	const fill = '#' + [1, 3, 5].map((offset) => Math.round(
		parseInt(stroke.slice(offset, offset + 2), 16) * 0.18
		+ parseInt(canvas.slice(offset, offset + 2), 16) * 0.82,
	).toString(16).padStart(2, '0')).join('');
	return { stroke, fill };
}

export const GRAPH_VISUAL_THEME = {
	canvas: FRAME_GRAPH_DEBUG_VISUAL_THEME.canvas,
	surface: FRAME_GRAPH_DEBUG_VISUAL_THEME.surface,
	surfaceRaised: FRAME_GRAPH_DEBUG_VISUAL_THEME.surfaceRaised,
	text: FRAME_GRAPH_DEBUG_VISUAL_THEME.text,
	muted: FRAME_GRAPH_DEBUG_VISUAL_THEME.muted,
	render: category('#57C785'),
	compute: category('#9AA5FF'),
	copy: category('#F2CD60'),
	clear: category('#C4CF89'),
	command: category('#CF91E8'),
	external: category('#F29A67'),
	declaration: category('#B9AB94'),
	output: category('#EC91AE'),
	texture: { stroke: '#f472b6', fill: '#3c1f32' },
	buffer: { stroke: '#2dd4bf', fill: '#123632' },
	group: { stroke: '#64748b', fill: '#141c29', alternateFill: '#172033' },
	dependency: { value: '#94a3b8', ordering: '#8593a6' },
	access: { read: '#2dd4bf', write: '#f59e0b' },
	selected: FRAME_GRAPH_DEBUG_VISUAL_THEME.accent,
	hover: '#cbd5e1',
	culled: { stroke: '#64748b', fill: '#171d24' },
} as const;
