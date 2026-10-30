import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * Serves the Vercel functions in /api during `vite dev` and `vite preview`, so
 * the full stack runs locally without the Vercel CLI. Production uses Vercel's
 * own function runtime with the same handler files.
 */
function devApi(): Plugin {
  const mount = (server: { middlewares: ViteDevServer['middlewares'] }, load: (file: string) => Promise<Record<string, unknown>>) => {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return next();
      const file = resolve(import.meta.dirname, `.${url.pathname.replace(/\/$/, '')}.ts`);
      let mod: Record<string, unknown>;
      try {
        mod = await load(file);
      } catch {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const fn = mod[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined;
      if (!fn) {
        res.statusCode = 405;
        return res.end('Method not allowed');
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      headers.set('x-real-ip', req.socket.remoteAddress ?? '127.0.0.1');
      const response = await fn(new Request(url, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : Buffer.concat(chunks),
      }));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  };
  return {
    name: 'innovexa-dev-api',
    configureServer(server) {
      mount(server, (file) => server.ssrLoadModule(file));
    },
    async configurePreviewServer(server) {
      const { createServer } = await import('vite');
      const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false });
      mount(server, (file) => vite.ssrLoadModule(file));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make server-side variables from .env.local available to the dev API.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''), process.env);
  return {
    plugins: [devApi()],
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          admin: resolve(import.meta.dirname, 'admin/index.html'),
        },
      },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
