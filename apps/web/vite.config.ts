import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Пакет из workspace лежит исходниками на TypeScript — предбандлить его не нужно.
  optimizeDeps: { exclude: ['@tracker/shared'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://api:3000',
        changeOrigin: false,
      },
    },
  },
});
