import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    open: '/embed-example.html',
  },
  build: {
    lib: {
      entry: 'src/main.tsx',
      name: 'EstimatorWidget',
      formats: ['iife'],
      fileName: () => 'widget.iife.js',
    },
    rollupOptions: {
      // Bundle everything — no external deps for the embed
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
