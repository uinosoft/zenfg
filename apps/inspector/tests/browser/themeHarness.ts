import { mountFrameGraphInspector } from '../../../../packages/inspector/src/FrameGraphInspector.ts';
import { tokyoNightStorm, tokyoNightLight } from '../../../../packages/inspector/src/theme.ts';
import { themePresetCss } from '../../../../packages/inspector/src/themeDefinitions.ts';

const css = document.createElement('style');
css.textContent = themePresetCss(); document.head.append(css);
const host = document.createElement('main');
host.id = 'host'; host.style.cssText = 'height:800px;width:100%;';
document.body.style.cssText = 'margin:0;'; document.body.append(host);
const inspector = mountFrameGraphInspector(host);
const snapshot = await (await fetch('/fixture.json')).json();
inspector.setSnapshot(snapshot);
Object.assign(window, { themeQA: { inspector, host, snapshot, mountFrameGraphInspector, tokyoNightStorm, tokyoNightLight } });
