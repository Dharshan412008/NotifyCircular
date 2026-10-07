import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
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
