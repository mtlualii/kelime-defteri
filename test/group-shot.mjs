import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright');
const b = await chromium.launch(); const errs = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'tr-TR', colorScheme: scheme });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('kd.settings', JSON.stringify({ sort: 'new' })));   // old save without v:2
  await p.goto('http://127.0.0.1:8787/#liste', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
  // put words on different steps
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kd.data'));
    const set = [{ reps: 0 }, { reps: 1, interval: 1, lastReview: '2026-11-10', due: '2026-11-12' }, { reps: 2, interval: 3, lastReview: '2026-11-10', due: '2026-11-13' }, { reps: 0, interval: 0, lapses: 1, lastReview: '2026-11-11', due: '2026-11-11' }, { reps: 1, interval: 1, lastReview: '2026-11-10', due: '2026-11-11' }, { reps: 5, interval: 30, lastReview: '2026-11-01', due: '2026-12-01' }];
    d.words.forEach((w, i) => Object.assign(w, set[i % set.length]));
    localStorage.setItem('kd.data', JSON.stringify(d));
  });
  await p.addInitScript(() => {}); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  assert.equal(await p.inputValue('#sort'), 'stage');
  const names = await p.$$eval('.grp .gname', (xs) => xs.map((x) => x.firstChild.textContent)); console.log(scheme, names);
  await p.locator('#all').scrollIntoViewIfNeeded(); await p.evaluate(() => document.querySelector('#listCount').scrollIntoView());
  await p.screenshot({ path: `test/out/group-${scheme}.png` });
  await ctx.close();
}
await b.close(); if (errs.length) { console.log(errs); process.exit(1); } console.log('ok');
