import type { ExamplesPanel } from './types.ts';

export const defaultExampleId = 'reference-renderer';

export type ExamplesRoute = {
	readonly exampleId: string;
	readonly panel: ExamplesPanel;
};

export function parseExamplesRoute(search: string): ExamplesRoute {
	const params = new URLSearchParams(search);
	return {
		exampleId: params.get('example') || defaultExampleId,
		panel: parsePanel(params.get('panel')),
	};
}

export function routeSearch(route: ExamplesRoute): string {
	const params = new URLSearchParams();
	params.set('example', route.exampleId);
	params.set('panel', route.panel);
	return `?${params.toString()}`;
}

function parsePanel(value: string | null): ExamplesPanel {
	return value === 'code' ? 'code' : 'inspector';
}
