import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    // Prefer IPv4 loopback so the proxy matches Express on 0.0.0.0:5000 (avoids ::1 ECONNREFUSED noise on Windows).
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/health': 'http://127.0.0.1:5000'
    }
  }
});
