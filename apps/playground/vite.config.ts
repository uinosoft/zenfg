import { defineConfig } from 'vite';
import typegpuPlugin from 'unplugin-typegpu/vite';

export default defineConfig({
	base: './',
	plugins: [
		typegpuPlugin({
			include: /examples[\\/]typegpu-slime-mold[\\/]src[\\/].*\.ts$/,
		}),
	],
	optimizeDeps: {
		exclude: ['@zenfg-example/typegpu-slime-mold'],
	},
	build: {
		target: 'es2022',
		sourcemap: true,
	},
});
