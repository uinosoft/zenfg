import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import typegpuPlugin from 'unplugin-typegpu/vite';
import { siteShellPlugin } from './shared/shell/plugin.ts';

export default defineConfig({
	base: process.env.SITE_BASE ?? './',
	server: { proxy: { '/docs/': { target: `http://127.0.0.1:${process.env.DOCS_DEV_PORT ?? '5174'}`, ws: true } } },
	resolve: {
		tsconfigPaths: true,
		alias: {
			'@zenfg/snapshot/format': fileURLToPath(new URL('../../packages/snapshot/src/format.ts', import.meta.url)),
			'@zenfg/snapshot': fileURLToPath(new URL('../../packages/snapshot/src/index.ts', import.meta.url)),
			'@zenfg/webgpu/snapshot': fileURLToPath(new URL('../../packages/webgpu/src/snapshot.ts', import.meta.url)),
			'@zenfg/webgpu': fileURLToPath(new URL('../../packages/webgpu/src/index.ts', import.meta.url)),
			'@zenfg/inspector/theme': fileURLToPath(new URL('../../packages/inspector/src/theme.ts', import.meta.url)),
			'@zenfg/inspector': fileURLToPath(new URL('../../packages/inspector/src/index.ts', import.meta.url)),
		},
	},
	plugins: [
		siteShellPlugin(),
        {
            name: 'glyph-font-license',
            generateBundle() {
                this.emitFile({ type: 'asset', fileName: 'glyph-font-license.txt',
                    source: readFileSync(new URL('./examples/glyph-interop/assets/Inter-LICENSE.txt', import.meta.url), 'utf8') });
            },
        },
		typegpuPlugin({
			include: /apps[\\/]site[\\/]examples[\\/](?:glyph-interop|typegpu-(?:slime-mold|monocular-light-injection))[\\/]src[\\/].*\.ts$/,
		}),
	],
	build: {
		target: 'es2022',
		sourcemap: true,
		rolldownOptions: {
			input: {
				home: fileURLToPath(new URL('./index.html', import.meta.url)),
				inspector: fileURLToPath(new URL('./inspector/index.html', import.meta.url)),
				examples: fileURLToPath(new URL('./playground/index.html', import.meta.url)),
			},
		},
	},
});
