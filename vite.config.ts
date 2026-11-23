import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig, type Plugin} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const phaserMinPath = path.resolve(rootDir, 'node_modules/phaser/dist/phaser.esm.min.js');
const viteDepsDir = path.resolve(rootDir, 'node_modules/.vite/deps');

/**
 * Prevents AI Studio dev-proxy failure modes:
 * 1. Serves `phaser.esm.min.js` directly (1.31MB raw / 366KB gzipped vs 22MB with dev sourcemap).
 * 2. Serves already-built `/node_modules/.vite/deps/*.js` files directly from disk without inline
 *    sourcemaps (~70% smaller) and without Vite's `504 Outdated Optimize Dep` check (which the
 *    preview nginx intercepts via `error_page 504 = /warmup.html` and turns into `200 text/html`,
 *    silently breaking `<script type="module">`).
 * 3. Sets `Cache-Control: no-store` on `/` and `/src/*` in dev so refreshes always load fresh imports.
 */
function rigmasterDevStabilityPlugin(): Plugin {
  return {
    name: 'rigmaster-dev-stability',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '';
        const [pathname] = rawUrl.split('?');

        // 1. Serve pre-minified Phaser ESM directly without Vite sourcemap bloat
        if (pathname === '/node_modules/phaser/dist/phaser.esm.min.js') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          fs.createReadStream(phaserMinPath).pipe(res);
          return;
        }

        // 2. Serve pre-bundled Vite deps directly from disk (no 504 on stale ?v=, no multi-MB inline sourcemaps)
        if (pathname.startsWith('/node_modules/.vite/deps/') && pathname.endsWith('.js')) {
          const relFile = path.basename(pathname);
          const fullPath = path.join(viteDepsDir, relFile);
          if (fullPath.startsWith(viteDepsDir + path.sep) && fs.existsSync(fullPath)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(fullPath).pipe(res);
            return;
          }
        }

        // 3. Never allow browsers to serve stale `/` or `/src/*` modules across dev server restarts
        if (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/src/')) {
          const origSetHeader = res.setHeader.bind(res);
          res.setHeader = ((name: string, value: number | string | readonly string[]) => {
            if (name.toLowerCase() === 'cache-control') {
              return origSetHeader(name, 'no-store, no-cache, must-revalidate');
            }
            return origSetHeader(name, value);
          }) as typeof res.setHeader;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [rigmasterDevStabilityPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
        phaser: phaserMinPath,
      },
    },
    optimizeDeps: {
      exclude: ['phaser'],
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'lucide-react',
      ],
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Allow AI Studio reverse-proxied preview hosts in Vite 8+
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
    },
  };
});
