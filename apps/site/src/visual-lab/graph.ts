const nodes = [
	{ id: 'input', x: 34, y: 110, width: 132, kind: 'declaration', name: 'Scene data', detail: 'Imported · buffer', shape: 'ellipse' },
	{ id: 'cull', x: 218, y: 110, width: 152, kind: 'compute', name: 'Frustum cull', detail: 'Compute pass', shape: 'box' },
	{ id: 'draw', x: 424, y: 110, width: 152, kind: 'render', name: 'Draw geometry', detail: 'Render pass', shape: 'box' },
	{ id: 'present', x: 630, y: 110, width: 138, kind: 'output', name: 'Present', detail: 'Output · texture', shape: 'tag' },
] as const;

export function graphMarkup(): string {
	return `<svg class="frame-graph" viewBox="0 25 804 216" role="group" aria-label="Illustrative frame graph. Select a node to inspect it.">
  <defs><marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 7 4 1 7" fill="none" stroke="var(--zenfg-edge)" stroke-width="1.3"/></marker></defs>
  <rect class="graph-group" x="194" y="51" width="406" height="172" rx="10"/>
  <text class="graph-group-label" x="214" y="76">▧  Main pipeline</text>
  <g class="graph-edges" marker-end="url(#flow-arrow)"><path d="M166 142H211"/><path d="M370 142H417"/><path d="M576 142H623"/></g>
  <text class="edge-label" x="181" y="100">read</text><text class="edge-label" x="397" y="100">visible IDs</text><text class="edge-label" x="606" y="100">color</text>
  ${nodes.map((node) => `<g class="graph-node" data-node="${node.id}" data-kind="${node.kind}" role="button" tabindex="0" aria-label="${node.name}, ${node.detail}" aria-pressed="${node.id === 'draw'}" transform="translate(${node.x} ${node.y})" style="--node-color:var(--zenfg-${node.kind})">
    ${node.shape === 'ellipse' ? `<ellipse class="node-shape" cx="66" cy="32" rx="66" ry="32"/>` : node.shape === 'tag' ? `<path class="node-shape" d="M0 0H119L138 32 119 64H0Z"/>` : `<rect class="node-shape" width="${node.width}" height="64" rx="6"/>`}
    <text class="node-name" x="${node.width / 2}" y="27">${node.name}</text><text class="node-detail" x="${node.width / 2}" y="46">${node.detail}</text>
  </g>`).join('')}
  <path class="ordering-edge" d="M294 181V200H500V181" marker-end="url(#flow-arrow)"/><text class="edge-label" x="397" y="216">execution order</text>
</svg>`;
}

export function describeNode(id: string): { name: string; detail: string } {
	const node = nodes.find((candidate) => candidate.id === id) ?? nodes[2];
	return { name: node.name, detail: node.detail };
}

/** Fixed geometric composition, independent of GPU availability and UI theme. */
export function sceneMarkup(): string {
	const cubes = Array.from({ length: 26 }, (_, index) => {
		const column = index % 7;
		const row = Math.floor(index / 7);
		const x = 108 + column * 67 + row * 25;
		const y = 83 + row * 47 + Math.sin(index * 2.3) * 14;
		const height = 18 + ((index * 19) % 48);
		const hue = ['#7aa2f7', '#bb9af7', '#73daca'][index % 3];
		return `<g transform="translate(${x} ${y})"><path d="M0 0 23-13 46 0 23 13Z" fill="${hue}"/><path d="M0 0 23 13V${height + 13}L0 ${height}Z" fill="${hue}" opacity=".52"/><path d="M23 13 46 0V${height}L23 ${height + 13}Z" fill="${hue}" opacity=".78"/></g>`;
	}).join('');
	return `<svg viewBox="0 0 720 350" class="scene-art" role="img" aria-label="Fixed isometric scene: blue, lavender and teal columns on a perspective grid">
  <defs><radialGradient id="scene-glow"><stop stop-color="#455280" stop-opacity=".48"/><stop offset="1" stop-color="#202437" stop-opacity="0"/></radialGradient><pattern id="scene-grid" width="46" height="26" patternUnits="userSpaceOnUse" patternTransform="translate(0 90) skewY(-16)"><path d="M46 0H0V26" fill="none" stroke="#7483b0" stroke-opacity=".16" stroke-width=".75"/></pattern></defs>
  <rect width="720" height="350" fill="#202437"/><ellipse cx="360" cy="184" rx="320" ry="155" fill="url(#scene-glow)"/><path d="M0 92 720 25V350H0Z" fill="url(#scene-grid)"/>
  <g id="scene-geometry">${cubes}</g><g fill="none" stroke="#7aa2f7" stroke-width="1" opacity=".65"><path d="M79 115V85H114M571 68H601V98M177 284V307H207M640 228V258H610"/></g>
</svg>`;
}
