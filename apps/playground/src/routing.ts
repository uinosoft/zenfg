import type { PlaygroundPanel } from './types.ts';

export const defaultExampleId = 'interactive-background';

export type PlaygroundRoute = {
	readonly exampleId: string;
	readonly panel: PlaygroundPanel;
};

export function parsePlaygroundRoute(search: string): PlaygroundRoute {
	const params = new URLSearchParams(search);
	return {
		exampleId: params.get('example') || defaultExampleId,
		panel: parsePanel(params.get('panel')),
	};
}

export function routeSearch(route: PlaygroundRoute): string {
	const params = new URLSearchParams();
	params.set('example', route.exampleId);
	params.set('panel', route.panel);
	return `?${params.toString()}`;
}

export function toggledPanel(current: PlaygroundPanel, requested: PlaygroundPanel): PlaygroundPanel {
	if (requested === 'none') return 'none';
	return current === requested ? 'none' : requested;
}

function parsePanel(value: string | null): PlaygroundPanel {
	return value === 'code' || value === 'inspector' ? value : 'none';
}
