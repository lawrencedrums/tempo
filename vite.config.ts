import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Writes dist/sw.js: a service worker that caches every built file on install,
 * so the app runs with no network. The cache name is a hash of the build, so a
 * new deploy replaces the old cache the next time the app is opened online.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tempo-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        );
      const hash = createHash('sha1');
      const files = ['./'];
      for (const path of walk(outDir).sort()) {
        const name = relative(outDir, path).split('\\').join('/');
        if (name === 'sw.js') continue;
        hash.update(name).update(readFileSync(path));
        if (name !== 'index.html') files.push(`./${name}`);
      }
      const sw = `const CACHE = 'tempo-app-${hash.digest('hex').slice(0, 12)}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('tempo-app-') || k.startsWith('downbeat-')) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error())),
    ),
  );
});
`;
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  // Relative paths, so the build works at a domain root or under /repo-name/ on GitHub Pages.
  base: './',
  plugins: [serviceWorker()],
});
