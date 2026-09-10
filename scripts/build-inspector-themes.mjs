import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { themePresetCss } from '../packages/inspector/src/themeDefinitions.ts';

writeFileSync(resolve(import.meta.dirname, '../packages/inspector/dist/themes.css'), themePresetCss());
