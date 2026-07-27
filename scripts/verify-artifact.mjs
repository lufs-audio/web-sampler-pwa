#!/usr/bin/env node
// Fail-closed build verify — the web equivalent of the Workchain verifier rule:
// "exit 0 is not enough." A build that ran but produced the wrong bytes must
// never ship. Also emits provenance (artifact.json + SHA256SUMS) into the dist,
// matching the LUFS catalog + Workchain content-hash convention.
//
// Checks map to website-portability 01 "Required verification". Exit 0 = passed,
// 1 = a check failed. Nothing here may downgrade silently.
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = 'packages/app/dist';
const MAX_BYTES = 26214400; // 25 MiB — lowest active host (Cloudflare Pages)
const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// Required routes come from site/routes.txt — the neutral manifest is the single
// source of truth. A second hardcoded copy here could drift, and a verifier
// checking a stale list is worse than no verifier at all.
const ROUTES = existsSync('site/routes.txt')
  ? readFileSync('site/routes.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : null;
need(ROUTES !== null, 'site/routes.txt missing (neutral route manifest is required)');

// Origins the artifact may reference at runtime, from site/external-origins.yaml.
// The sampler declares NONE: all DSP is local and the type is self-hosted.
const DECLARED_ORIGINS = (() => {
  if (!existsSync('site/external-origins.yaml')) return null;
  const body = readFileSync('site/external-origins.yaml', 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  if (/external_origins:\s*\[\s*\]/.test(body)) return [];
  return [...body.matchAll(/url:\s*["']?(https?:\/\/[^\s"']+)/g)].map((m) => new URL(m[1]).origin);
})();
need(DECLARED_ORIGINS !== null, 'site/external-origins.yaml missing');

need(existsSync(DIST), `dist dir missing: ${DIST}`);

const indexPath = join(DIST, 'index.html');
need(existsSync(indexPath), 'index.html missing');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  need(html.length > 200, 'index.html suspiciously small');
  need(/<script[^>]+src=/.test(html), 'index.html references no bundled script');
  need(/<\/html>/i.test(html), 'index.html does not close <html> (truncated build?)');
}

// the realtime worklet + PWA files must survive into the build verbatim
for (const f of ['sampler-processor.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'fonts.css']) {
  need(existsSync(join(DIST, f)), `missing public asset in dist: ${f}`);
}

// there must be at least one hashed JS bundle in assets/
const assetsDir = join(DIST, 'assets');
let jsBundles = [];
if (existsSync(assetsDir)) jsBundles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
need(jsBundles.length > 0, 'no JS bundle emitted in assets/');

// walk the artifact once; everything below reuses this inventory
const allFiles = [];
const walkAll = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkAll(p);
    else allFiles.push(p);
  }
};
walkAll(DIST);

// every declared route is backed by a real file (SPA fallback aside)
if (ROUTES) {
  for (const route of ROUTES) {
    const rel = route === '/' ? 'index.html' : route.replace(/^\//, '');
    need(existsSync(join(DIST, rel)), `declared route has no file: ${route}`);
  }
}

// self-hosted fonts actually shipped and are real woff2 — the offline claim
// depends on these bytes being in the artifact, so prove it.
for (const f of ['host-grotesk-var-latin.woff2', 'public-sans-var-latin.woff2',
                 'space-mono-400-latin.woff2', 'space-mono-700-latin.woff2']) {
  const p = join(DIST, 'fonts', f);
  if (!existsSync(p) || statSync(p).size === 0) { need(false, `missing/empty font: ${f}`); continue; }
  need(readFileSync(p).subarray(0, 4).toString('latin1') === 'wOF2', `not woff2: ${f}`);
}

// the base64 font snapshot must NOT ship — it is a build input, not an asset
need(!existsSync(join(DIST, 'fonts.b64.json')), 'fonts.b64.json leaked into the artifact (build input, not an asset)');

// no asset over the lowest host's per-file limit
for (const f of allFiles) {
  if (statSync(f).size > MAX_BYTES) need(false, `asset over ${MAX_BYTES} bytes: ${relative(DIST, f)}`);
}

// NO UNDECLARED EXTERNAL ORIGIN in the shipped bytes. This is the check that
// catches an "offline: true" lie: a Google Fonts <link> precaches the shell but
// not the type, so an offline launch silently degrades while site.yaml claims
// the artifact is self-contained. Only resource references count — an <a href>
// a user clicks is not a runtime dependency.
if (DECLARED_ORIGINS) {
  const allow = new Set(DECLARED_ORIGINS);
  for (const f of allFiles) {
    if (/\.(png|jpg|jpeg|gif|webp|avif|woff2?|ttf|otf|wasm|mp3|wav|map)$/i.test(f)) continue;
    let t = '';
    try { t = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/\bhttps?:\/\/[^\s"'`)<>\\]+/g)) {
      let origin;
      try { origin = new URL(m[0]).origin; } catch { continue; }
      if (allow.has(origin)) continue;
      const before = t.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
      const isResource =
        /<link\b[^>]*\bhref=["']?$/i.test(before) ||
        /<script\b[^>]*\bsrc=["']?$/i.test(before) ||
        /<img\b[^>]*\bsrc=["']?$/i.test(before) ||
        /\burl\(\s*["']?$/i.test(before) ||
        /\b(fetch|importScripts|import)\s*\(\s*["']?$/i.test(before);
      if (isResource) need(false, `undeclared external origin ${origin} referenced in ${relative(DIST, f)}`);
    }
  }
}

// no secret material baked into browser-delivered files
{
  const pats = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/,
                /\bAIza[0-9A-Za-z_\-]{35}\b/, /xox[baprs]-[0-9A-Za-z-]{10,}/];
  for (const f of allFiles) {
    let t = '';
    try { t = readFileSync(f, 'utf8'); } catch { continue; }
    if (pats.some((p) => p.test(t))) need(false, `possible secret material in ${relative(DIST, f)}`);
  }
}

// The service worker MUST handle navigations explicitly. Navigation requests use
// redirect mode "manual", so a SW answering one with a redirected response gets
// ERR_FAILED. Cloudflare Pages 308s /index.html -> /, which hard-failed that URL
// on the live deploy once the SW was active. Neither the artifact bytes nor a
// source read reveal this — it only exists in the SW/host-redirect interaction.
{
  const swPath = join(DIST, 'sw.js');
  const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
  need(/req(uest)?\.mode\s*===\s*['"]navigate['"]/.test(sw),
       "sw.js has no `mode === 'navigate'` branch; a host redirect on a navigation surfaces as ERR_FAILED");
  // A navigate branch alone is NOT enough — a redirected response stays flagged
  // after being stored in the Cache API (w3c/ServiceWorker#737), so precaching
  // a URL the host 308s poisons the cached shell too.
  const shellBlock = (sw.match(/const SHELL\s*=\s*\[[\s\S]*?\]/) || [''])[0];
  need(!/index\.html/.test(shellBlock),
       'SHELL precaches ./index.html, which the host 308s; the cached response keeps its redirected flag and cannot satisfy a navigation');
  need(/\.redirected/.test(sw) && /new Response\(/.test(sw),
       'navigate path does not rebuild a redirected response; a flagged response reaching respondWith is ERR_FAILED');
}

// The manifest's start_url must not be a path the host redirects, or the
// INSTALLED app launches into a redirect (and, with a SW active, an error page).
{
  const mp = join(DIST, 'manifest.webmanifest');
  if (existsSync(mp)) {
    try {
      const su = JSON.parse(readFileSync(mp, 'utf8')).start_url;
      need(typeof su === 'string' && !/\.html?$/i.test(su),
           `manifest start_url ${JSON.stringify(su)} points at a .html path the host will redirect`);
    } catch { /* manifest validity is reported elsewhere */ }
  }
}

// generated host adapters must be present — if the renderer no-ops, the
// no-cache intent on sw.js never reaches the host and clients pin stale logic.
{
  const h = join(DIST, '_headers');
  need(existsSync(h) && statSync(h).size > 0, '_headers not rendered into the artifact');
  if (existsSync(h)) need(/^\/sw\.js$/m.test(readFileSync(h, 'utf8')), '_headers has no /sw.js rule');
  const r = join(DIST, '_redirects');
  need(existsSync(r) && /\/index\.html\s+200/.test(readFileSync(r, 'utf8')),
       '_redirects missing the SPA fallback rule (runtime.spa_fallback is true)');
}

if (failures.length) {
  console.error('✖ artifact verify FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

// provenance
const sums = [];
const walk = (dir, rel = '') => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(p).isDirectory()) walk(p, r);
    else if (name !== 'SHA256SUMS' && name !== 'artifact.json') {
      sums.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${r}`);
    }
  }
};
walk(DIST);
sums.sort();
writeFileSync(join(DIST, 'SHA256SUMS'), sums.join('\n') + '\n');
const digest = createHash('sha256').update(sums.join('\n')).digest('hex');
writeFileSync(
  join(DIST, 'artifact.json'),
  JSON.stringify({
    schema_version: 1,
    site_id: 'lufs-web-sampler',
    source: { repository: 'lufs-audio/web-sampler-pwa', commit: process.env.GITHUB_SHA || 'unknown' },
    build: { builder: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local', command: 'npm run ci', builtAt: new Date().toISOString() },
    artifact: { files: sums.length, contentId: 'lws-' + digest.slice(0, 8), sha256: digest },
  }, null, 2) + '\n'
);
console.log(`✔ artifact verify passed — ${sums.length} files, contentId lws-${digest.slice(0, 8)}`);
