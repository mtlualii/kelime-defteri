// End-to-end run against `wrangler dev` (port 8787) + the mock Anthropic server (port 9797).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright');

const BASE = 'http://127.0.0.1:8787';
const TOKEN = 'test-sifre';
const out = 'test/out';
fs.mkdirSync(out, { recursive: true });
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ---- API without the app
assert.equal((await fetch(BASE + '/api/me')).status, 401, 'no token → 401');
assert.equal((await fetch(BASE + '/api/me', { headers: { authorization: 'Bearer nope' } })).status, 401, 'wrong token → 401');
let me = await api('GET', '/api/me');
assert.equal(me.status, 200); assert.match(me.json.vapid, /^[A-Za-z0-9_-]{87}$/, 'VAPID public key is 65 bytes base64url');
const vapid1 = me.json.vapid;
me = await api('GET', '/api/me'); assert.equal(me.json.vapid, vapid1, 'VAPID key is stable');
// wipe server data so the browser run starts clean
await api('DELETE', '/api/sync');
const sync0 = await api('GET', '/api/sync'); assert.equal(sync0.json.data.words.length, 0);

// ---- browser
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1, locale: 'tr-TR', serviceWorkers: 'allow', permissions: ['notifications'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push('console: ' + m.text()); });   // the deliberate wrong-password request logs a 401

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('6 kelime'), null, { timeout: 10000 });
assert.equal(await page.isVisible('#tokenCard'), true, 'token card shown on first run');
await page.screenshot({ path: out + '/e2e-01-first-run.png' });

// wrong password, then the right one
await page.fill('#tokenInput', 'yanlis'); await page.click('#tokenForm button');
await page.waitForFunction(() => /yanlış/i.test(document.querySelector('#tokenMsg').textContent), null, { timeout: 5000 });
await page.fill('#tokenInput', TOKEN); await page.click('#tokenForm button');
await page.waitForSelector('#tokenCard', { state: 'hidden', timeout: 5000 });
assert.equal(await page.evaluate(() => localStorage.getItem('kd.token')), TOKEN);
// seed got synced to the server
await page.waitForTimeout(2500);
let s = await api('GET', '/api/sync'); assert.equal(s.json.data.words.length, 6, 'seed words mirrored to server');

// translate + save a word through the mock
await page.fill('#term', 'Gelassenheit'); await page.click('#translateBtn');
await page.waitForSelector('#result:not([hidden])', { timeout: 15000 });
assert.equal(await page.inputValue('#rEn'), 'serenity');
assert.equal(await page.inputValue('#rDe'), 'die Gelassenheit');
await page.screenshot({ path: out + '/e2e-02-translated.png' });
await page.click('#saveBtn');
await page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('7 kelime'), null, { timeout: 5000 });
const seen = await (await fetch('http://127.0.0.1:9797/__seen')).json();
const last = seen[seen.length - 1]; assert.ok(last, 'mock saw the request'); assert.equal(last.model, 'claude-opus-5-5'); assert.equal(last.fallbacks, 'default'); assert.equal(last.effort, 'low');
assert.match(last.betas, /server-side-fallback-2026-07-01/);
await page.waitForTimeout(2500);
s = await api('GET', '/api/sync'); assert.equal(s.json.data.words.length, 7, 'new word mirrored');
assert.ok(s.json.data.words.find((w) => w.term === 'die Gelassenheit' || w.de === 'die Gelassenheit'));

// review: grade one word, counters move
await page.goto(BASE + '/#tekrar', { waitUntil: 'networkidle' });
await page.waitForSelector('#rev', { timeout: 5000 });
const startBtn = page.locator('#rev button.primary').first();
await startBtn.click();
await page.waitForTimeout(500);
const reveal = page.locator('#rev button', { hasText: /Göster|Cevabı/i }).first();
if (await reveal.count()) await reveal.click();
await page.waitForTimeout(300);
await page.locator('#rev button', { hasText: /Bildim/ }).first().click();
await page.waitForTimeout(2500);
s = await api('GET', '/api/sync');
const graded = s.json.data.words.filter((w) => w.lastReview);
assert.ok(graded.some((w) => w.lastReview === new Date().toISOString().slice(0, 10) || w.lastResult === 'ok'), 'a grade reached the server');
await page.screenshot({ path: out + '/e2e-03-review.png' });

// delete + tombstone
await page.goto(BASE + '/#liste', { waitUntil: 'networkidle' });
await page.waitForSelector('#all .word', { timeout: 5000 });
const before = await page.locator('#all .word').count();
const first = page.locator('#all .word').first();
await first.locator('.top .term').click();                       // expand the card
await first.locator('button.del').click();                       // ask
await first.locator('button.yes').click();                       // confirm
await page.waitForTimeout(2500);
s = await api('GET', '/api/sync'); assert.equal(s.json.data.words.length, before - 1, 'delete mirrored'); assert.equal(Object.keys(s.json.data.deleted).length, 1, 'tombstone stored');
assert.equal(await page.locator('#all .word').count(), before - 1);

// settings card + service worker
const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && (r.active || r.waiting || r.installing) ? 'registered' : 'none'; });
assert.equal(swState, 'registered', 'service worker registered');
await page.click('#gearBtn'); await page.waitForSelector('#settings', { state: 'visible' });
assert.equal(await page.isVisible('#view-liste'), false, 'settings is its own screen');
console.log('push hint:', await page.textContent('#pushHint'), '| button visible:', await page.isVisible('#pushBtn'));
if (await page.isVisible('#pushBtn')) {   // headless Chromium has no push service: the app must fail softly
  await page.click('#pushBtn'); await page.waitForTimeout(3000);
  console.log('after enable click → toast:', (await page.textContent('#toast')).trim(), '| hint:', await page.textContent('#pushHint'));
}
await page.screenshot({ path: out + '/e2e-04-settings.png' });
await page.click('#setBack'); await page.waitForSelector('#view-liste', { state: 'visible' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.equal(overflow, 0, 'no horizontal overflow at 400px');

// a second device with empty storage restores from the server (no seed)
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 800 }, locale: 'tr-TR' });
const p2 = await ctx2.newPage();
await p2.addInitScript((t) => { localStorage.setItem('kd.token', t); }, TOKEN);
await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
await p2.waitForFunction((n) => document.querySelector('#count').textContent.startsWith(n + ' kelime'), s.json.data.words.length, { timeout: 10000 });
assert.equal(await p2.isVisible('#tokenCard'), false);
await ctx2.close();

// dark mode screenshot
const ctx3 = await browser.newContext({ viewport: { width: 400, height: 800 }, colorScheme: 'dark', locale: 'tr-TR' });
const p3 = await ctx3.newPage();
await p3.goto(BASE + '/#liste', { waitUntil: 'networkidle' });
await p3.waitForTimeout(800);
await p3.screenshot({ path: out + '/e2e-05-dark.png' });
await ctx3.close();
await browser.close();

// ---- push plumbing on the server: fake subscription, dry run, scheduled handler
const fake = { endpoint: 'https://127.0.0.1:1/push/fake', expirationTime: null, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_iQGxt6XCtW4-sZxWPZwQ8NCZAIl8yDsQNPvlb0kY5gcx2XXkE', auth: 'tBHItJI5svbpez7KI4CCXg' } };
let r = await api('POST', '/api/subscribe', { subscription: fake, tz: 'Europe/Istanbul' }); assert.equal(r.json.subs, 1);
r = await api('GET', '/api/remind'); assert.equal(r.json.subs, 1); assert.ok(r.json.results[0].due >= 1, 'seeded words are due'); assert.match(r.json.results[0].body, /^Günaydın! Bugün tekrar edilecek \d+ kelimen var: /);
console.log('dry reminder:', r.json.results[0].body);
const sched = await fetch(BASE + '/__scheduled?cron=35+5+*+*+*'); assert.equal(sched.status, 200);
await new Promise((res) => setTimeout(res, 1500));
me = await api('GET', '/api/me');
assert.ok(me.json.lastRemind && me.json.lastRemind.results[0].status === 'error', 'scheduled run attempted delivery to the unreachable fake endpoint');
r = await api('DELETE', '/api/subscribe', { endpoint: fake.endpoint }); assert.equal(r.json.subs, 0);
assert.equal((await api('POST', '/api/subscribe', { subscription: { endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } } })).status, 400);

if (errors.length) { console.log('browser errors:', errors); process.exit(1); }
console.log('e2e OK');
