import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Portal build (vite build --mode crazygames): no install-as-app files or links. Portals don't allow
// install prompts, and the game is served from their domain, so absolute /manifest, /icons paths would 404.
const portal = (mode) => mode === 'crazygames';
const stripAppLinks = {
  name: 'strip-app-links',
  transformIndexHtml(html) {
    return html
      .replace(/\s*<link rel="(?:manifest|apple-touch-icon|icon)"[^>]*>/g, '')
      .replace(/\s*<meta name="(?:apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>/g, '')
      .replace(/\s*<button[^>]*id="btn-install"[^>]*>[\s\S]*?<\/button>/, '')
      .replace(/\s*<!-- install pop-up[\s\S]*?(?=\s*<div class="menu-footer">)/, '');
  },
};

export default defineConfig(({ mode }) => ({
  root: '.',
  publicDir: portal(mode) ? false : 'public',
  plugins: portal(mode) ? [stripAppLinks] : [],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
}));
