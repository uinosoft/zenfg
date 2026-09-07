import { defineConfig } from 'vite';
import typegpuPlugin from 'unplugin-typegpu/vite';

export default defineConfig({
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
	},
});
