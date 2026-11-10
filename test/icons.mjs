// Renders the app icons with headless Chromium (uses the app's display font).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright');
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'public/icons');
fs.mkdirSync(out, { recursive: true });

function page(size, { pad = 0, bg = '#0B6B63', fg = '#FFFFFF', radius = 0.22, text = 'Ke', transparent = false } = {}) {
  const inner = size - pad * 2;
  return `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap">
<style>
html,body{margin:0;background:${transparent ? 'transparent' : bg};width:${size}px;height:${size}px;overflow:hidden}
.tile{position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px;border-radius:${transparent ? 0 : Math.round(inner * radius)}px;background:${transparent ? 'transparent' : bg};display:grid;place-items:center}
.t{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;color:${fg};font-size:${Math.round(inner * 0.58)}px;letter-spacing:-0.04em;line-height:1;transform:translateY(-2%)}
.dot{position:absolute;right:${Math.round(inner * 0.17)}px;bottom:${Math.round(inner * 0.2)}px;width:${Math.round(inner * 0.11)}px;height:${Math.round(inner * 0.11)}px;border-radius:50%;background:#E3B341}
</style></head><body><div class="tile"><div class="t">${text}</div>${transparent ? '' : '<div class="dot"></div>'}</div></body></html>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();
async function shot(name, size, opts) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(page(size, opts), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, name), omitBackground: !!(opts && opts.transparent) });
}
await shot('icon-512.png', 512);
await shot('icon-192.png', 192);
await shot('apple-touch-icon.png', 180, { radius: 0 });          // iOS rounds the corners itself
await shot('maskable-512.png', 512, { pad: 0, radius: 0 });       // full-bleed; OS applies its mask
await shot('badge-96.png', 96, { transparent: true, text: 'K' }); // monochrome status-bar badge
await browser.close();
console.log('icons written to', out, fs.readdirSync(out));
