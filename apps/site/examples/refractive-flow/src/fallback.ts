import { createRestCurves, curveCount, curveSamples, projectPoint, restSheetPoint, sheetLayers, coverFocus } from './curves.ts';

const rest = createRestCurves();

/** The actual resting ribbons, projected at the host aspect ratio without a GPU. */
export function surfaceFallbackSvg(width = 1000, height = 680, readingRegions: readonly (readonly number[])[] = []): string {
	const narrow = width < 600;
	const point = (curve: number, i: number, v: number, layer: number): string => {
		const [x, y] = projectPoint(restSheetPoint(rest, curve, i, v, layer), width / height, narrow);
		return `${(x * width).toFixed(2)},${(y * height).toFixed(2)}`;
	};
	const paths: string[] = [];
	for (let curve = 0; curve < curveCount; curve++) {
		for (let layer = sheetLayers - 1; layer >= 0; layer--) {
			const edge = (v: number) => Array.from({ length: curveSamples }, (_, i) => point(curve, i, v, layer));
			paths.push(`<g opacity="${(curve === 1 ? .35 : .85) * (1 - layer * .20)}"><path d="M${edge(-1).join(' L')} L${edge(1).reverse().join(' L')}Z" fill="url(#flow-glass)" stroke="var(--flow-edge)" stroke-width=".6" stroke-opacity=".25"/>`);
			for (const v of [-.8, -.2, .7]) paths.push(`<path d="M${edge(v).join(' L')}" fill="none" stroke="var(--flow-highlight)" stroke-width="${layer ? '.6' : '1.2'}" opacity=".45"/>`);
			paths.push('</g>');
		}
	}
	const [x, y] = projectPoint(coverFocus, width / height, narrow);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <defs>
      <linearGradient id="flow-glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--flow-glass)" stop-opacity=".03"/><stop offset=".25" stop-color="var(--flow-cyan)" stop-opacity=".24"/><stop offset=".5" stop-color="var(--flow-violet)" stop-opacity=".28"/><stop offset=".72" stop-color="var(--flow-gold)" stop-opacity=".24"/><stop offset="1" stop-color="var(--flow-glass)" stop-opacity=".10"/></linearGradient>
      <linearGradient id="flow-reading"><stop offset="${width < 900 ? '.67' : '.24'}" stop-color="white" stop-opacity=".015"/><stop offset="${width < 900 ? '.99' : '.72'}" stop-color="white"/></linearGradient>
      <linearGradient id="flow-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset=".76" stop-color="white"/><stop offset=".99" stop-color="white" stop-opacity="0"/></linearGradient>
      <filter id="flow-reading-soften" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
      <mask id="flow-reading-mask"><rect width="100%" height="100%" fill="${readingRegions.length ? 'white' : 'url(#flow-reading)'}"/>
      <g filter="url(#flow-reading-soften)">${readingRegions.map(r => `<rect x="0" y="${r[1]! * height}" width="${Math.max(0, r[2]! * width)}" height="${Math.max(0, (r[3]! - r[1]!) * height)}" fill="black" opacity=".94"/>`).join('')}</g></mask>
      <mask id="flow-bottom-mask"><rect width="100%" height="100%" fill="url(#flow-bottom)"/></mask>
    </defs>
    <g mask="url(#flow-bottom-mask)"><g mask="url(#flow-reading-mask)">${paths.join('')}<circle cx="${x * width}" cy="${y * height}" r="2.5" fill="var(--flow-spark)"/></g></g>
  </svg>`;
}
