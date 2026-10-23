import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';

const backend = 'http://127.0.0.1:3000';
const buildId = randomUUID();

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId) },
  plugins: [react(), { name: 'release-info', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ buildId }) });
  } }],
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/socket.io': {
        target: backend,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/client/test/setup.js'],
    css: true,
    globals: true,
    include: ['src/client/test/**/*.test.{js,jsx}'],
    maxWorkers: 1,
  },
});
