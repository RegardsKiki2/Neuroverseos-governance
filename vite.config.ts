import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/viz',
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist/viz'),
    emptyDirBeforeWrite: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
});
