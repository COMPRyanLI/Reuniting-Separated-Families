import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Only VITE_PUBLIC_* variables may reach the browser bundle; backend secrets never use this prefix.
  envPrefix: 'VITE_PUBLIC_',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Keep the browser Origin header intact so the API's origin check sees the real page origin.
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
