import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import typegpuPlugin from 'unplugin-typegpu/vite';

export default defineConfig(({ mode }) => ({
	base: './',
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
		typegpuPlugin({
			include: /apps[\\/]site[\\/]examples[\\/]typegpu-(?:slime-mold|monocular-light-injection)[\\/]src[\\/].*\.ts$/,
		}),
	],
	build: {
		target: 'es2022',
		sourcemap: true,
		...(mode === 'visual-lab' ? {
			outDir: '../../.test-dist/visual-lab',
			emptyOutDir: true,
			rolldownOptions: {
				input: fileURLToPath(new URL('./visual-lab/index.html', import.meta.url)),
			},
		} : {
			rolldownOptions: {
				input: {
					home: fileURLToPath(new URL('./index.html', import.meta.url)),
					inspector: fileURLToPath(new URL('./inspector/index.html', import.meta.url)),
					playground: fileURLToPath(new URL('./playground/index.html', import.meta.url)),
				},
			},
		}),
	},
}));
