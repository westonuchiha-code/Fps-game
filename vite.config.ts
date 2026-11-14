import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only endpoints the level editor uses to save straight into the project:
 *   GET  /__editor/list          -> [{ id, title, number }]
 *   POST /__editor/save?id=<id>  -> writes public/levels/<id>.json and refreshes index.json
 * On a static host these do not exist and the editor falls back to browser storage + download.
 */
function levelFiles(): Plugin {
  const dir = path.resolve(__dirname, 'public/levels');
  const reindex = () => {
    fs.mkdirSync(dir, { recursive: true });
    const list = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { id: d.id ?? f.replace(/\.json$/, ''), title: d.title ?? '', number: d.number ?? '' };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(list, null, 2) + '\n');
    return list;
  };
  return {
    name: 'emg-level-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/list', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(reindex()));
      });
      server.middlewares.use('/__editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (!/^[a-z0-9_-]{1,40}$/i.test(id)) {
          res.statusCode = 400;
          res.end('bad id');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(data, null, 1) + '\n');
            reindex();
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// Relative base so the build runs from any sub-path (GitHub Pages, file hosts, previews).
export default defineConfig({
  base: './',
  plugins: [levelFiles()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), editor: path.resolve(__dirname, 'editor.html') } },
  },
});
