// Kelime Defteri — Cloudflare Worker.
// Serves the PWA from ./public (static assets) and a small JSON API under /api/*:
//   translate  → Anthropic API (claude-opus-5-5) returns the JSON the app asked for
//   sync       → mirror of the phone's word list (backup + source for the morning push)
//   subscribe  → Web Push subscriptions
//   remind     → cron (08:35 Europe/Istanbul) sends "Günaydın! Bugün N kelimen var…"
// All state lives in one Durable Object (SQLite-backed, free plan). VAPID keys are generated
// on first use and kept there, so the only secrets the owner sets are APP_TOKEN and ANTHROPIC_API_KEY.

import { DurableObject } from 'cloudflare:workers';
import Anthropic from '@anthropic-ai/sdk';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { todayIn, dueWords, reminderText } from './remind.js';
import { parseJSON } from './util.js';
import { shouldAutoAdd, autoWordPrompt, autoDoc, mergeData } from './autoword.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const fail = (status, code, message) => json({ error: code, message }, status);

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export class Store extends DurableObject {
  async getData() { return (await this.ctx.storage.get('data')) || null; }

  async putData(data) {
    const incoming = {
      words: Array.isArray(data.words) ? data.words : [],
      days: data.days && typeof data.days === 'object' ? data.days : {},
      deleted: data.deleted && typeof data.deleted === 'object' ? data.deleted : {},
    };
    // merge instead of overwrite, so a word the server added this morning survives a sync from a phone that hasn't pulled yet
    const rec = Object.assign(mergeData(await this.getData(), incoming), { syncedAt: new Date().toISOString() });
    await this.ctx.storage.put('data', rec);
    return { syncedAt: rec.syncedAt, words: rec.words.length, serverOnly: rec.words.length - incoming.words.length };
  }

  async wipe() { await this.ctx.storage.put('data', { words: [], days: {}, deleted: {}, syncedAt: new Date().toISOString() }); await this.ctx.storage.delete('lastAuto'); }

  async getSettings() { return Object.assign({ autoWord: true }, (await this.ctx.storage.get('settings')) || {}); }
  async setSettings(patch) {
    const cur = await this.getSettings();
    if (typeof patch.autoWord === 'boolean') cur.autoWord = patch.autoWord;
    await this.ctx.storage.put('settings', cur);
    return cur;
  }

  /** Word of the day: adds one related word when the owner added none yesterday. force skips the day checks. */
  async autoWord({ force = false, now = Date.now(), tz } = {}) {
    const data = await this.getData();
    const settings = await this.getSettings();
    const subs = Object.values(await this.listSubs());
    tz = tz || (subs[0] && subs[0].tz) || 'Europe/Istanbul';
    const decision = shouldAutoAdd({ data, settings: force ? {} : settings, lastAuto: force ? null : await this.ctx.storage.get('lastAuto'), tz, now });
    if (!decision.add && !(force && decision.reason !== 'no_words')) return { added: false, reason: decision.reason };
    let doc = null;
    for (let attempt = 0; attempt < 2 && !doc; attempt++) {
      const r = await callModel(this.env, autoWordPrompt(data.words));
      doc = autoDoc(r, data.words, decision.today, new Date(now).toISOString());
    }
    if (!doc) return { added: false, reason: 'no_usable_word' };
    const fresh = await this.getData();   // re-read: a sync may have landed while the model was thinking
    fresh.words = [doc, ...(fresh.words || [])];
    fresh.syncedAt = new Date().toISOString();
    await this.ctx.storage.put('data', fresh);
    await this.ctx.storage.put('lastAuto', decision.today);
    return { added: true, word: doc };
  }

  /** VAPID key pair, generated once. publicKey = base64url raw P-256 point, privateKey = JWK `d`. */
  async getVapid() {
    let v = await this.ctx.storage.get('vapid');
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      v = { publicKey: b64url(pub), privateKey: jwk.d, createdAt: new Date().toISOString() };
      await this.ctx.storage.put('vapid', v);
    }
    return v;
  }

  async listSubs() { return (await this.ctx.storage.get('subs')) || {}; }

  async addSub(sub, meta) {
    const subs = await this.listSubs();
    subs[sub.endpoint] = { sub, tz: meta.tz || 'Europe/Istanbul', origin: meta.origin || '', ua: (meta.ua || '').slice(0, 200), createdAt: new Date().toISOString() };
    await this.ctx.storage.put('subs', subs);
    return Object.keys(subs).length;
  }

  async removeSub(endpoint) {
    const subs = await this.listSubs();
    delete subs[endpoint];
    await this.ctx.storage.put('subs', subs);
    return Object.keys(subs).length;
  }

  async lastRemind() { return (await this.ctx.storage.get('lastRemind')) || null; }

  async sendTo(entry, message) {
    const vapid = await this.getVapid();
    const payload = await buildPushPayload(
      { data: message, options: { ttl: 6 * 3600, urgency: 'normal' } },
      entry.sub,
      { subject: entry.origin || 'https://workers.dev', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    );
    const res = await fetch(entry.sub.endpoint, payload);
    return res.status;
  }

  /**
   * Sends the reminder to every subscription whose local date has due words.
   * dry: compute only. force: send even with nothing due (test notification).
   */
  async remind({ dry = false, force = false, auto = false, now = Date.now() } = {}) {
    let autoRes = null;
    if (auto && !dry) {
      try { autoRes = await this.autoWord({ now }); } catch (e) { autoRes = { added: false, reason: 'error', error: String((e && e.message) || e) }; }
    }
    const daily = autoRes && autoRes.added ? autoRes.word : null;
    const data = await this.getData();
    const subs = await this.listSubs();
    const words = data ? data.words : [];
    const out = { at: new Date(now).toISOString(), subs: Object.keys(subs).length, sent: 0, skipped: 0, removed: 0, results: [], auto: autoRes ? { added: autoRes.added, reason: autoRes.reason, term: daily ? daily.term : undefined } : undefined };
    for (const [endpoint, entry] of Object.entries(subs)) {
      const today = todayIn(entry.tz, new Date(now));
      const due = dueWords(words, today);
      const short = endpoint.replace(/^https?:\/\//, '').slice(0, 48);
      if (!due.length && !force) { out.skipped++; out.results.push({ endpoint: short, today, due: 0, status: 'nothing_due' }); continue; }
      const message = {
        title: 'Kelime Defteri',
        body: (due.length ? reminderText(due) : 'Test bildirimi: bildirimler çalışıyor 🎉') + (daily ? '\n✨ Günün kelimesi: ' + daily.term + ' = ' + daily.tr : ''),
        url: '/#tekrar',
        tag: 'kd-' + today,
      };
      if (dry) { out.results.push({ endpoint: short, today, due: due.length, status: 'dry', body: message.body }); continue; }
      try {
        const status = await this.sendTo(entry, message);
        out.results.push({ endpoint: short, today, due: due.length, status, body: message.body });
        if (status === 404 || status === 410) { await this.removeSub(endpoint); out.removed++; }
        else if (status >= 200 && status < 300) out.sent++;
      } catch (e) {
        out.results.push({ endpoint: short, today, due: due.length, status: 'error', body: message.body, error: String((e && e.message) || e) });
      }
    }
    if (!dry) await this.ctx.storage.put('lastRemind', out);
    return out;
  }
}

function store(env) { return env.STORE.get(env.STORE.idFromName('main')); }

function auth(req, env) {
  if (!env.APP_TOKEN) return 'setup';
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const t = m ? m[1].trim() : '';
  return t && safeEqual(t, env.APP_TOKEN) ? 'ok' : 'unauthorized';
}

async function readBody(req) {
  try { return await req.json(); } catch (e) { return null; }
}

/** One model call that must answer with JSON; throws the SDK's errors. Used by the morning word of the day. */
async function callModel(env, prompt) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 90_000 });
  const res = await client.beta.messages.create({
    model: env.MODEL || 'claude-opus-5-5',
    max_tokens: Number(env.MAX_TOKENS) || 4096,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: env.EFFORT || 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return undefined;
  return parseJSON((res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
}
const SYSTEM = 'You are the translation engine behind a personal vocabulary app (English, German, Turkish; the input may be in any language). Reply with exactly the JSON the user asks for: no prose, no markdown, no code fences.';

async function translate(req, env) {
  if (!env.ANTHROPIC_API_KEY) return fail(503, 'no_api_key', 'ANTHROPIC_API_KEY Cloudflare\'de ayarlanmamış.');
  const body = await readBody(req);
  const prompt = body && typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return fail(400, 'bad_request', 'prompt gerekli');
  if (prompt.length > 20000) return fail(413, 'bad_request', 'prompt çok uzun');

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 90_000 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: env.MODEL || 'claude-opus-5-5',
      max_tokens: Number(env.MAX_TOKENS) || 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: env.EFFORT || 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    console.error('anthropic error', e && e.constructor && e.constructor.name, e && e.status, e && e.message);
    if (e instanceof Anthropic.RateLimitError) return fail(429, 'rate_limited', 'Çok sık istek gitti.');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail(502, 'bad_api_key', 'Anthropic API anahtarı geçersiz.');
    if (e instanceof Anthropic.APIConnectionError) return fail(502, 'upstream', 'Anthropic API\'ye ulaşılamadı.');
    if (e instanceof Anthropic.APIError) return fail(502, 'upstream', `Anthropic API hatası (${e.status || '?'}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') return fail(422, 'refused', 'Bu girdi çevrilemedi.');
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const result = parseJSON(text);
  if (result === undefined) return fail(502, 'invalid_json', 'Çeviri okunamadı.');
  return json({ result, model: res.model, usage: res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens } : undefined });
}

async function api(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method.toUpperCase();

  // Setup check, no auth: tells the owner which secrets are still missing.
  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, configured: { APP_TOKEN: !!env.APP_TOKEN, ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY }, model: env.MODEL || 'claude-opus-5-5' });
  }

  const a = auth(req, env);
  if (a === 'setup') return fail(503, 'setup', 'Sunucuda APP_TOKEN ayarlanmamış. Cloudflare → Worker → Settings → Variables and Secrets.');
  if (a !== 'ok') return fail(401, 'unauthorized', 'Erişim şifresi yanlış.');

  const s = store(env);
  if (path === '/api/me' && method === 'GET') {
    const [vapid, subs, data, last, settings] = await Promise.all([s.getVapid(), s.listSubs(), s.getData(), s.lastRemind(), s.getSettings()]);
    return json({ ok: true, settings, vapid: vapid.publicKey, subs: Object.keys(subs).length, anthropic: !!env.ANTHROPIC_API_KEY, model: env.MODEL || 'claude-opus-5-5', syncedAt: data ? data.syncedAt : null, words: data ? data.words.length : 0, lastRemind: last });
  }
  if (path === '/api/translate' && method === 'POST') return translate(req, env);
  if (path === '/api/sync' && method === 'GET') return json({ data: await s.getData() });
  if (path === '/api/sync' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.words)) return fail(400, 'bad_request', 'words gerekli');
    if (JSON.stringify(body).length > 4_000_000) return fail(413, 'too_large', 'Veri çok büyük');
    return json(await s.putData(body));
  }
  if (path === '/api/sync' && method === 'DELETE') { await s.wipe(); return json({ ok: true }); }
  if (path === '/api/settings' && method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return fail(400, 'bad_request', 'ayar gerekli');
    return json({ ok: true, settings: await s.setSettings(body) });
  }
  if (path === '/api/auto-word' && method === 'POST') {
    try { return json(await s.autoWord({ force: url.searchParams.get('force') === '1' })); }
    catch (e) { console.error('auto-word error', e && e.message); return fail(502, 'upstream', 'Günün kelimesi üretilemedi.'); }
  }
  if (path === '/api/subscribe' && method === 'POST') {
    const body = await readBody(req);
    const sub = body && body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return fail(400, 'bad_request', 'subscription gerekli');
    if (!/^https:\/\//.test(sub.endpoint)) return fail(400, 'bad_request', 'endpoint https olmalı');
    const n = await s.addSub({ endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, { tz: typeof body.tz === 'string' ? body.tz : '', origin: url.origin, ua: req.headers.get('user-agent') || '' });
    return json({ ok: true, subs: n });
  }
  if (path === '/api/subscribe' && method === 'DELETE') {
    const body = await readBody(req);
    if (!body || typeof body.endpoint !== 'string') return fail(400, 'bad_request', 'endpoint gerekli');
    return json({ ok: true, subs: await s.removeSub(body.endpoint) });
  }
  if (path === '/api/remind' && method === 'GET') return json(await s.remind({ dry: true, force: url.searchParams.get('force') === '1' }));
  if (path === '/api/remind' && method === 'POST') return json(await s.remind({ force: url.searchParams.get('force') === '1' }));
  if (path === '/api/test-push' && method === 'POST') return json(await s.remind({ force: true }));
  return fail(404, 'not_found', 'Böyle bir uç yok');
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e) {
      console.error('api error', e);
      return fail(500, 'internal', String((e && e.message) || e));
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(store(env).remind({ auto: true }).then((r) => console.log('remind', JSON.stringify(r))));
  },
};
