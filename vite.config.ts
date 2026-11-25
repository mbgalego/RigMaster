import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import zlib from 'zlib';
import {defineConfig, type Plugin} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const phaserMinPath = path.resolve(rootDir, 'node_modules/phaser/dist/phaser.esm.min.js');
const viteDepsDir = path.resolve(rootDir, 'node_modules/.vite/deps');

/**
 * Prevents AI Studio dev-proxy failure modes:
 * 1. Serves `phaser.esm.min.js` directly with gzip caching (366KB vs 22MB with dev sourcemap).
 * 2. Serves already-built `/node_modules/.vite/deps/*.js` files directly from disk with gzip
 *    compression and without Vite's `504 Outdated Optimize Dep` check (which the preview nginx
 *    intercepts via `error_page 504 = /warmup.html` and turns into `200 text/html`, silently
 *    breaking `<script type="module">`).
 * 3. Strips multi-hundred-KB inline base64 sourcemaps from `/src/*` dev responses (cutting cold
 *    boot payload by ~3× on mobile/Cloud Run) and sets `Cache-Control: no-store` so refreshes
 *    always load fresh module graphs.
 */
function rigmasterDevStabilityPlugin(): Plugin {
  const gzCache = new Map<string, {mtimeMs: number; gz: Buffer; raw: Buffer}>();

  const sendCachedFile = (
    fullPath: string,
    cacheControl: string,
    acceptsGzip: boolean,
    res: import('http').ServerResponse,
  ) => {
    const stat = fs.statSync(fullPath);
    let entry = gzCache.get(fullPath);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      const raw = fs.readFileSync(fullPath);
      const gz = zlib.gzipSync(raw, {level: 6});
      entry = {mtimeMs: stat.mtimeMs, gz, raw};
      gzCache.set(fullPath, entry);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Vary', 'Accept-Encoding');
    if (acceptsGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', entry.gz.length);
      res.end(entry.gz);
    } else {
      res.setHeader('Content-Length', entry.raw.length);
      res.end(entry.raw);
    }
  };

  return {
    name: 'rigmaster-dev-stability',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '';
        const [pathname] = rawUrl.split('?');
        const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');

        // 1. Serve pre-minified Phaser ESM directly with gzip compression
        if (pathname === '/node_modules/phaser/dist/phaser.esm.min.js') {
          sendCachedFile(phaserMinPath, 'public, max-age=31536000, immutable', acceptsGzip, res);
          return;
        }

        // 2. Serve pre-bundled Vite deps directly from disk with gzip (no 504 on stale ?v=)
        if (pathname.startsWith('/node_modules/.vite/deps/') && pathname.endsWith('.js')) {
          const relFile = path.basename(pathname);
          const fullPath = path.join(viteDepsDir, relFile);
          if (fullPath.startsWith(viteDepsDir + path.sep) && fs.existsSync(fullPath)) {
            sendCachedFile(fullPath, 'no-cache', acceptsGzip, res);
            return;
          }
        }

        // 3. Never allow browsers to serve stale `/` or `/src/*` modules across dev server restarts,
        //    and strip huge inline base64 sourcemaps from `/src/*.ts(x)` so mobile/proxy boots stay fast.
        if (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/src/')) {
          const origSetHeader = res.setHeader.bind(res);
          res.setHeader = ((name: string, value: number | string | readonly string[]) => {
            if (name.toLowerCase() === 'cache-control') {
              return origSetHeader(name, 'no-store, no-cache, must-revalidate');
            }
            return origSetHeader(name, value);
          }) as typeof res.setHeader;

          if (pathname.startsWith('/src/') && /\.(ts|tsx|js|jsx)$/.test(pathname)) {
            let wroteChunks = false;
            const origWrite = res.write.bind(res);
            res.write = ((...args: Parameters<typeof res.write>) => {
              wroteChunks = true;
              return origWrite(...args);
            }) as typeof res.write;

            const origEnd = res.end.bind(res);
            res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
              if (
                !wroteChunks &&
                !res.headersSent &&
                res.statusCode === 200 &&
                !res.getHeader('content-encoding') &&
                (typeof chunk === 'string' || Buffer.isBuffer(chunk))
              ) {
                const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
                const marker = '\n//# sourceMappingURL=data:';
                const idx = str.lastIndexOf(marker);
                const cleaned = idx >= 0 ? str.slice(0, idx) : str;
                const done = (typeof encoding === 'function' ? encoding : cb) as (() => void) | undefined;
                if (acceptsGzip && cleaned.length >= 4096) {
                  const gz = zlib.gzipSync(Buffer.from(cleaned, 'utf8'), {level: 5});
                  origSetHeader('Content-Encoding', 'gzip');
                  origSetHeader('Vary', 'Accept-Encoding');
                  origSetHeader('Content-Length', gz.length);
                  return done ? origEnd(gz, done) : origEnd(gz);
                }
                const buf = Buffer.from(cleaned, 'utf8');
                origSetHeader('Content-Length', buf.length);
                return done ? origEnd(buf, done) : origEnd(buf);
              }
              return origEnd(chunk as never, encoding as never, cb as never);
            }) as typeof res.end;
          }
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
