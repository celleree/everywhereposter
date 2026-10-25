import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'tests/design-preview', plugins: [react()], server: { host: '127.0.0.1', port: 4317, strictPort: true, fs: { allow: ['.'] } }, build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 2_000_000 } });
