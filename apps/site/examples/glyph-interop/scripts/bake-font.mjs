import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const font = resolve(here, '../assets/Inter-Regular.ttf');
const hash = createHash('sha256').update(readFileSync(font)).digest('hex');
if (hash !== '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82') throw new Error('Unexpected Inter font source.');
const require = createRequire(import.meta.url);
const pkg = require.resolve('@pmndrs/glyph/package.json');
if (JSON.parse(readFileSync(pkg, 'utf8')).version !== '0.1.0') throw new Error('Bake with Glyph 0.1.0.');
const result = spawnSync(process.execPath, [resolve(dirname(pkg), 'bin/glyph.js'), 'bake',
    '--input', font, '--output', resolve(here, '../assets/inter-latin.font.glb'),
    '--unicodes', 'U+0020-007E', '--bitmap', '32,64,128', '--msdf', '--slug',
    ...(process.argv.includes('--check') ? ['--check'] : []),
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
