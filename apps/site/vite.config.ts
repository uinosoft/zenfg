import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	server: {
		proxy: {
			'/inspector': {
				target: 'http://127.0.0.1:5174',
				ws: true,
			},
			'/playground': {
				target: 'http://127.0.0.1:5175',
				ws: true,
			},
		},
	},
	build: {
		target: 'es2022',
	},
});
