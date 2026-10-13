import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        renderDemo: resolve(__dirname, 'render-demo.html'),
        hudDemo: resolve(__dirname, 'hud-demo.html'),
      },
    },
  },
});
