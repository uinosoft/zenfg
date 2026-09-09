import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import typegpuPlugin from 'unplugin-typegpu/vite';

export default defineConfig(({ mode }) => ({
	base: './',
	plugins: [
		typegpuPlugin({
			include: /examples[\\/]typegpu-(?:slime-mold|monocular-light-injection)[\\/]src[\\/].*\.ts$/,
		}),
	],
	optimizeDeps: {
		exclude: ['@zenfg-example/typegpu-slime-mold', '@zenfg-example/typegpu-monocular-light-injection'],
	},
	build: {
		target: 'es2022',
		sourcemap: true,
		...(mode === 'visual-lab' ? {
			outDir: '../../.test-dist/visual-lab',
			emptyOutDir: true,
			rolldownOptions: {
				input: fileURLToPath(new URL('./visual-lab/index.html', import.meta.url)),
			},
		} : {}),
	},
}));
