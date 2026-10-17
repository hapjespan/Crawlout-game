import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  worker: { format: 'es' },
  build: {
    // The client needs WebGPU-era browsers anyway; the demos use top-level await, which Vite's default es2020
    // target refuses (the production build failed on hud-demo since the HUD skin, client 0.7.2).
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        renderDemo: resolve(__dirname, 'render-demo.html'),
        hudDemo: resolve(__dirname, 'hud-demo.html'),
      },
    },
  },
});
