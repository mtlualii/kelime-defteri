// Tiny stand-in for api.anthropic.com used by the local end-to-end test.
// Answers /v1/messages with JSON shaped like the app's prompts expect.
import http from 'node:http';

const port = Number(process.argv[2] || 9797);
const seen = [];

function answerFor(prompt) {
  if (/Pick ONE new word/.test(prompt)) {
    return { lang: 'en', langName: 'İngilizce', source: '', en: 'castigate', de: 'tadeln', tr: 'şiddetle kınamak', plural: null, pos: 'verb', note: 'Resmî bir kelime.', why: 'ta\'n ve itab gibi kınama anlatıyor', example: { en: 'He was castigated for his remarks.', de: 'Er wurde für seine Worte getadelt.', tr: 'Sözleri yüzünden şiddetle kınandı.' } };
  }
  if (/typed its meaning from memory/.test(prompt)) {
    // answer check: anything containing "yanlis" is wrong, the rest is accepted as a synonym
    const out = {};
    for (const m of prompt.matchAll(/\n- (\w+) \([A-Za-z]+\): "([^"]*)"/g)) out[m[1]] = { ok: !/yanlis/.test(m[2]), note: /yanlis/.test(m[2]) ? 'başka bir anlam' : '' };
    return out;
  }
  if (/JSON array/i.test(prompt) || /"input"/.test(prompt) && /array/i.test(prompt)) {
    // bulk: echo each listed term as an English word
    const m = prompt.match(/\n- (.+)/g) || [];
    const terms = m.map((s) => s.replace(/^\n- /, '').trim());
    return terms.map((t) => ({ input: t, lang: 'en', langName: 'İngilizce', source: '', en: t, de: 'der Test', tr: 'deneme', plural: '', pos: 'noun', note: '', example: { en: `${t} example.`, de: 'Beispiel.', tr: 'Örnek.' } }));
  }
  if (/example sentence/i.test(prompt) && !/"lang"/.test(prompt)) {
    return { en: 'A fresh example.', de: 'Ein frisches Beispiel.', tr: 'Taze bir örnek.' };
  }
  if (/Gelassenheit/.test(prompt)) {
    return { lang: 'de', langName: 'Almanca', source: '', en: 'serenity', de: 'die Gelassenheit', tr: 'sükûnet', plural: '', pos: 'noun', note: '', example: { en: 'She faced it with serenity.', de: 'Sie begegnete dem mit Gelassenheit.', tr: 'Onu sükûnetle karşıladı.' }, alternatives: [] };
  }
  if (/memer/i.test(prompt)) {
    return { lang: 'ar', langName: 'Arapça', source: 'ممرّ (memer)', en: 'passage, corridor', de: 'der Durchgang', tr: 'geçit, koridor', plural: '', pos: 'noun', note: 'Arapça.', example: { en: 'A long passage.', de: 'Ein langer Durchgang.', tr: 'Uzun bir geçit.' }, alternatives: [] };
  }
  return { lang: 'de', langName: 'Almanca', source: '', en: 'serenity', de: 'die Gelassenheit', tr: 'sükûnet', plural: '', pos: 'noun', note: '', example: { en: 'She faced it with serenity.', de: 'Sie begegnete dem mit Gelassenheit.', tr: 'Onu sükûnetle karşıladı.' }, alternatives: [] };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/__seen') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(seen)); return; }
    if (!/\/v1\/messages/.test(req.url || '')) { res.statusCode = 404; res.end('{}'); return; }
    const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (key !== 'sk-ant-test') { console.log('bad key header:', JSON.stringify(req.headers)); res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
    let j = {}; try { j = JSON.parse(body); } catch (e) { /* ignore */ }
    const prompt = (((j.messages || [])[0] || {}).content) || '';
    seen.push({ model: j.model, betas: req.headers['anthropic-beta'], fallbacks: j.fallbacks, effort: j.output_config && j.output_config.effort, len: String(prompt).length });
    const text = '```json\n' + JSON.stringify(answerFor(String(prompt))) + '\n```';   // fences on purpose: parser must cope
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 50 } }));
  });
}).listen(port, '127.0.0.1', () => console.log('mock anthropic on', port));
