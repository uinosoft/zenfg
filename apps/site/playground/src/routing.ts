import type { ExamplesPanel } from './types.ts';

export const defaultExampleId = 'reference-renderer';

export type ExamplesRoute = {
	readonly exampleId: string;
	readonly panel: ExamplesPanel;
	readonly full: boolean;
};

export function parseExamplesRoute(search: string): ExamplesRoute {
	const params = new URLSearchParams(search);
	return {
		exampleId: params.get('example') || defaultExampleId,
		panel: parsePanel(params.get('panel')),
		full: params.get('full') === 'true',
	};
}

export function routeSearch(route: ExamplesRoute, search = ''): string {
	const params = new URLSearchParams(search);
	params.set('example', route.exampleId);
	params.set('panel', route.panel);
	if (route.full) params.set('full', 'true');
	else params.delete('full');
	return `?${params.toString()}`;
}

function parsePanel(value: string | null): ExamplesPanel {
	return value === 'code' ? 'code' : 'inspector';
}
