import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/Yadea': {
        target: 'http://localhost',
        changeOrigin: true,
      },
      // Local dev: PHP built-in server (php -S 127.0.0.1:8080 -t <root>)
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1024,
  },
});
