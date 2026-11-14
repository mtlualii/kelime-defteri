// Word-of-the-day plumbing against `wrangler dev` (8787) + the mock Anthropic server (9797).
import assert from 'node:assert/strict';
const BASE = 'http://127.0.0.1:8787';
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { authorization: 'Bearer test-sifre', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json() }; };
const old = { id: 'w1', term: 'reproach', lang: 'en', en: 'reproach', de: 'der Vorwurf', tr: 'sitem', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' };
const fake = { endpoint: 'https://127.0.0.1:1/push/fake', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_iQGxt6XCtW4-sZxWPZwQ8NCZAIl8yDsQNPvlb0kY5gcx2XXkE', auth: 'tBHItJI5svbpez7KI4CCXg' } };
let r;
await api('DELETE', '/api/sync');
r = await api('POST', '/api/auto-word?force=1'); assert.equal(r.json.reason, 'no_words');
await api('POST', '/api/sync', { words: [old], days: {}, deleted: {} });
r = await api('GET', '/api/me'); assert.equal(r.json.settings.autoWord, true, 'on by default');
r = await api('POST', '/api/auto-word?force=1'); assert.equal(r.json.added, true); assert.equal(r.json.word.term, 'castigate');
// a phone that hasn't pulled yet syncs: the word must survive and the phone is told to pull
r = await api('POST', '/api/sync', { words: [old], days: {}, deleted: {} }); assert.equal(r.json.words, 2); assert.equal(r.json.serverOnly, 1);
r = await api('GET', '/api/sync'); const autoId = r.json.data.words.find((w) => w.auto && w.term === 'castigate').id;
// deleting it on the phone removes it on the server
await api('POST', '/api/sync', { words: [old], days: {}, deleted: { [autoId]: new Date().toISOString() } });
r = await api('GET', '/api/sync'); assert.equal(r.json.data.words.length, 1, 'tombstone removed the auto word');
// toggle off: the morning run skips
await api('POST', '/api/settings', { autoWord: false });
r = await api('GET', '/api/me'); assert.equal(r.json.settings.autoWord, false);
await api('POST', '/api/subscribe', { subscription: fake, tz: 'Europe/Istanbul' });
await api('POST', '/api/tick?reset=1&at=' + encodeURIComponent(new Date().toISOString().slice(0, 10) + 'T18:00:00Z'));
r = await api('GET', '/api/me'); assert.equal(r.json.lastRemind.auto.reason, 'off');
await api('POST', '/api/settings', { autoWord: true });
await api('DELETE', '/api/subscribe', { endpoint: fake.endpoint });
// fresh notebook, nothing added yesterday: the morning run adds the word and names it in the push
await api('DELETE', '/api/sync');
await api('POST', '/api/sync', { words: [old], days: {}, deleted: {} });
await api('POST', '/api/subscribe', { subscription: fake, tz: 'Europe/Istanbul' });
await api('POST', '/api/tick?reset=1&at=' + encodeURIComponent(new Date().toISOString().slice(0, 10) + 'T18:00:00Z'));
r = await api('GET', '/api/me');
assert.equal(r.json.lastRemind.auto.added, true, 'scheduled run added the word');
assert.match(r.json.lastRemind.results[0].body, /Günün kelimesi: castigate = şiddetle kınamak/);
console.log('push body:', JSON.stringify(r.json.lastRemind.results[0].body));
await api('DELETE', '/api/subscribe', { endpoint: fake.endpoint });
console.log('autoword scheduled OK');
// chosen time: nothing before it, one run after it, none again the same day
await api('DELETE', '/api/sync'); await api('POST', '/api/sync', { words: [old], days: {}, deleted: {} });
r = await api('POST', '/api/settings', { remindAt: '19:30' }); assert.equal(r.json.settings.remindAt, '19:30');
assert.equal((await api('POST', '/api/settings', { remindAt: '25:00' })).json.settings.remindAt, '19:30', 'bad time ignored');
await api('POST', '/api/subscribe', { subscription: fake, tz: 'Europe/Istanbul' });
const day = '2030-03-05';
r = await api('POST', '/api/tick?reset=1&at=' + day + 'T16:00:00Z'); assert.equal(r.json.ran, false, '19:00 Istanbul: too early');
r = await api('POST', '/api/tick?at=' + day + 'T16:35:00Z'); assert.equal(r.json.ran, true, '19:35 Istanbul: runs');
r = await api('POST', '/api/tick?at=' + day + 'T17:00:00Z'); assert.equal(r.json.ran, false, 'only once a day');
r = await api('POST', '/api/tick?at=2030-03-06T16:31:00Z'); assert.equal(r.json.ran, true, 'next day again');
await api('POST', '/api/settings', { remindAt: '08:35' });
await api('DELETE', '/api/subscribe', { endpoint: fake.endpoint });
console.log('remind time OK');
