import { stormVariables } from './themeDefinitions.ts';
import type { InspectorThemeVariables } from './theme.ts';
type Variable = keyof InspectorThemeVariables;
export function mixHex(front: string, back: string, amount: number): string {
    return '#' + [1, 3, 5].map(offset => Math.round(parseInt(front.slice(offset, offset + 2), 16) * amount + parseInt(back.slice(offset, offset + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('');
}
export function defaultThemeValue(key: Variable, variables: InspectorThemeVariables = stormVariables): string {
    let value: string = variables[key];
    value = value.replace(/var\((--zfgi-[\w-]+), ([^()]+)\)/g, (_match, name: Variable) => defaultThemeValue(name, variables));
    const mix = /^color-mix\(in srgb, (#[\da-f]+) ([\d.]+)%, (#[\da-f]+)\)$/i.exec(value);
    return mix ? mixHex(mix[1]!, mix[3]!, Number(mix[2]) / 100) : value;
}
export function createGraphVisualTheme(read: (key: Variable) => string = defaultThemeValue) {
    const category = (kind: 'render' | 'compute' | 'copy' | 'clear' | 'command' | 'external' | 'declaration' | 'output' | 'texture' | 'buffer') => ({
        stroke: read(('--zfgi-graph-' + kind + '-stroke') as Variable), fill: read(('--zfgi-graph-' + kind + '-fill') as Variable),
    });
    const number = (key: Variable) => parseFloat(read(key));
    return {
        canvas: read('--zfgi-canvas'), surface: read('--zfgi-surface'), surfaceRaised: read('--zfgi-surface-raised'),
        text: read('--zfgi-graph-text'), muted: read('--zfgi-graph-muted'),
        render: category('render'), compute: category('compute'), copy: category('copy'), clear: category('clear'),
        command: category('command'), external: category('external'), declaration: category('declaration'), output: category('output'), texture: category('texture'), buffer: category('buffer'),
        group: { stroke: read('--zfgi-graph-group-stroke'), fill: read('--zfgi-graph-group-fill'), alternateFill: read('--zfgi-graph-group-alternate-fill') },
        dependency: { value: read('--zfgi-graph-value'), ordering: read('--zfgi-graph-ordering') },
        access: { read: read('--zfgi-graph-read'), write: read('--zfgi-graph-write') },
        selected: read('--zfgi-graph-selected'), hover: read('--zfgi-graph-hover'),
        activeBackground: { color: read('--zfgi-graph-active-bg'), opacity: number('--zfgi-graph-active-bg-opacity'), size: number('--zfgi-graph-active-bg-size') },
        culled: { stroke: read('--zfgi-graph-culled-stroke'), fill: read('--zfgi-graph-culled-fill') },
        fontFamily: read('--zfgi-graph-font-family'), fontSize: number('--zfgi-graph-font-size'),
        nodeBorderWidth: number('--zfgi-graph-node-border-width'), groupBorderWidth: number('--zfgi-graph-group-border-width'),
        edgeWidth: number('--zfgi-graph-edge-width'), edgeOpacity: number('--zfgi-graph-edge-opacity'), orderingOpacity: number('--zfgi-graph-ordering-opacity'), groupOpacity: number('--zfgi-graph-group-opacity'),
        arrowScale: number('--zfgi-graph-arrow-scale'), hoverWidth: number('--zfgi-graph-hover-width'), selectedWidth: number('--zfgi-graph-selected-width'),
    };
}
export type GraphVisualTheme = ReturnType<typeof createGraphVisualTheme>;
export const GRAPH_VISUAL_THEME = createGraphVisualTheme();
export const FRAME_GRAPH_DEBUG_VISUAL_THEME = {
    canvas: defaultThemeValue('--zfgi-canvas'), panel: defaultThemeValue('--zfgi-background'), surface: defaultThemeValue('--zfgi-surface'), surfaceRaised: defaultThemeValue('--zfgi-surface-raised'), surfaceHover: defaultThemeValue('--zfgi-surface-hover'), text: defaultThemeValue('--zfgi-text'), textSecondary: defaultThemeValue('--zfgi-text-secondary'), muted: defaultThemeValue('--zfgi-muted'),
};
