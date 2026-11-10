import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'tr-TR' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript(() => { localStorage.setItem('kd.token', 'test-sifre'); localStorage.setItem('kd.settings', JSON.stringify({ quiz: 'card', mode: 'word', limit: 20 })); });
await p.goto('http://127.0.0.1:8787/#tekrar', { waitUntil: 'networkidle' });
await p.click('#startBtn');
await p.waitForSelector('#writeBox input');
const front = await p.textContent('.rcard .big'); console.log('front:', front);
const langs = await p.$$eval('#writeBox input', (xs) => xs.map((x) => x.dataset.l)); console.log('asks:', langs);
await p.screenshot({ path: 'test/out/write-1.png' });
// card 1 (ta'n): en right with a typo-free alternative, de wrong, tr blank -> Zor suggested
await p.fill('#writeBox input[data-l="en"]', 'Reproach');
await p.fill('#writeBox input[data-l="de"]', 'yanlis');
await p.click('#writeBox button[type=submit]');
await p.waitForSelector('.arow.ok');
assert.equal(await p.locator('.arow.ok').count(), 1); assert.equal(await p.locator('.arow.no').count(), 2);
assert.ok(!(await p.getAttribute('#hardBtn', 'class')).includes('dim'), 'Zor suggested');
await p.screenshot({ path: 'test/out/write-2.png' });
await p.click('#hardBtn');
// card 2: fill all with exact-ish values and diacritics dropped -> all ok locally
await p.waitForSelector('#writeBox input');
console.log('front2:', await p.textContent('.rcard .big'));
const w = await p.evaluate(() => JSON.parse(localStorage.getItem('kd.data')).words.find((x) => document.querySelector('.rcard .big').textContent === x.term));
const plain = (s) => s.split(/[,;/]/)[0].replace(/ş/g,'s').replace(/ı/g,'i').replace(/ä/g,'a').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/ğ/g,'g');
for (const l of langs.length ? await p.$$eval('#writeBox input', (xs) => xs.map((x) => x.dataset.l)) : []) await p.fill(`#writeBox input[data-l="${l}"]`, plain(w[l]));
await p.press('#writeBox input:last-of-type', 'Enter').catch(() => {});
await p.click('#writeBox button[type=submit]').catch(() => {});
await p.waitForSelector('.answer');
console.log('ok rows:', await p.locator('.arow.ok').count(), 'no rows:', await p.locator('.arow.no').count());
assert.equal(await p.locator('.arow.no').count(), 0);
await p.screenshot({ path: 'test/out/write-3.png' });
// "Bilmiyorum" path
await p.click('#okBtn'); await p.waitForSelector('#revealBtn'); await p.click('#revealBtn'); await p.waitForSelector('.answer');
assert.equal(await p.locator('.arow.ok, .arow.no').count(), 0);
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.equal(overflow, 0);
const ctxD = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'tr-TR' });
const d = await ctxD.newPage(); await d.addInitScript(() => localStorage.setItem('kd.token', 'test-sifre'));
await d.goto('http://127.0.0.1:8787/#tekrar', { waitUntil: 'networkidle' }); await d.click('#startBtn'); await d.waitForSelector('#writeBox input'); await d.screenshot({ path: 'test/out/write-dark.png' });
await b.close();
if (errs.length) { console.log(errs); process.exit(1); }
console.log('write-review OK');
