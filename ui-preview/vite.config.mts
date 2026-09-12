import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  build: { outDir: '.build', emptyOutDir: true },
});
