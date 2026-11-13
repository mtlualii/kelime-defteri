// "Word of the day": when the owner added no word yesterday, the morning run adds one new word
// related to the words already in the notebook. Pure helpers, unit tested in Node.
import { todayIn } from './remind.js';

const TARGET = ['en', 'de', 'tr'];
const str = (v) => (v === null || v === undefined || v === 'null') ? '' : String(v).trim();

/** Local calendar day before `today` (YYYY-MM-DD). */
export function dayBefore(today) {
  const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** True when the owner added nothing on `day` (auto words don't count). */
export function addedNothingOn(data, day, tz) {
  if ((((data.days || {})[day]) || {}).added > 0) return false;
  return !(data.words || []).some((w) => w && !w.auto && w.createdAt && todayIn(tz, new Date(w.createdAt)) === day);
}

/** Decide whether this morning's run should add a word. Returns { add, today, reason }. */
export function shouldAutoAdd({ data, settings, lastAuto, tz, now = Date.now() }) {
  const today = todayIn(tz, new Date(now));
  if (settings && settings.autoWord === false) return { add: false, today, reason: 'off' };
  if (!data || !(data.words || []).length) return { add: false, today, reason: 'no_words' };
  if (lastAuto === today) return { add: false, today, reason: 'already_today' };
  if (!addedNothingOn(data, dayBefore(today), tz)) return { add: false, today, reason: 'owner_added' };
  return { add: true, today, reason: 'ok' };
}

const FIELDS = [
  '"lang": "two-letter ISO 639-1 code of the word\'s language, e.g. en, de, ar",',
  ' "langName": "Turkish name of that language, e.g. Arapça",',
  ' "source": "only when lang is not en, de or tr: the word in its own script followed by the Latin spelling in parentheses, e.g. ممرّ (memer); otherwise empty",',
  ' "en": "English equivalent in dictionary form",',
  ' "de": "German equivalent in dictionary form; for a noun include its article, e.g. der Tisch",',
  ' "tr": "Turkish equivalent in dictionary form",',
  ' "plural": "for a German noun its plural with article; otherwise null",',
  ' "pos": "noun" | "verb" | "adjective" | "adverb" | "phrase" | "other",',
  ' "note": "one short note in Turkish (at most 12 words) about usage or register; or null",',
  ' "why": "in Turkish, at most 12 words: how this word relates to the learner\'s words",',
  ' "example": {"en": "one natural English sentence using the word", "de": "the same sentence in German", "tr": "the same sentence in Turkish"}',
].join('\n');

/** Prompt asking for one new word that fits the notebook's themes, languages and level. */
export function autoWordPrompt(words) {
  const list = words.slice(0, 300).map((w) => '- ' + str(w.term || w.typed) + ' [' + str(w.lang) + '] = ' + str(w.en || w.tr));
  const langs = {};
  words.forEach((w) => { langs[w.lang] = (langs[w.lang] || 0) + 1; });
  return [
    'You are a precise multilingual dictionary for a Turkish speaker who is learning English and German and also knows Arabic.',
    'These are the words the learner has saved so far (word [language] = meaning):',
    list.join('\n'),
    '',
    'Pick ONE new word for them to learn today. It must be related to the saved words as a whole: same themes, same register and difficulty, and in one of the languages they save words in (counts: ' + JSON.stringify(langs) + '; choose the language in roughly that proportion).',
    'It must NOT be any saved word, a form of one, or a translation of one. Prefer a genuinely useful word an educated reader meets.',
    '',
    'Reply with ONLY one JSON object and no other text, with exactly these keys:',
    '{' + FIELDS + '}',
    '',
    'Rules: en, de and tr must always be filled. Use natural, modern wording.',
  ].join('\n');
}

const norm = (s) => str(s).toLocaleLowerCase('tr-TR').replace(/^(der|die|das|to|the|a|an)\s+/, '').replace(/\s*\(.*\)\s*$/, '');

/** Turns the model's JSON into a word document like the app saves. Returns null when unusable or a duplicate. */
export function autoDoc(r, words, today, nowISO) {
  if (!r || typeof r !== 'object') return null;
  const lang = str(r.lang).toLowerCase().slice(0, 3) || 'en';
  const en = str(r.en), de = str(r.de), tr = str(r.tr);
  if (!en || !de || !tr) return null;
  const target = TARGET.includes(lang);
  const source = target ? '' : str(r.source);
  const term = target ? ({ en, de, tr })[lang] : source;
  if (!term) return null;
  const seen = new Set();
  words.forEach((w) => [w.term, w.typed, w.source, w.en, w.de, w.tr].forEach((t) => { const n = norm(t); if (n) seen.add(n); }));
  if (seen.has(norm(term)) || (!target && seen.has(norm(en)))) return null;
  const ex = r.example && typeof r.example === 'object' ? r.example : {};
  const why = str(r.why);
  return {
    id: 'auto-' + today + '-' + Math.random().toString(36).slice(2, 8),
    term, lang, langName: str(r.langName), typed: term, source,
    en, de, tr, plural: str(r.plural), pos: str(r.pos) || 'other',
    note: [why && ('Günün kelimesi: ' + why), str(r.note)].filter(Boolean).join(' · '),
    example: { en: str(ex.en), de: str(ex.de), tr: str(ex.tr) },
    createdAt: nowISO, updatedAt: nowISO,
    due: today, interval: 0, reps: 0, lapses: 0, ease: 2.5, status: 'new', auto: true,
  };
}

const stamp = (w) => String(w.updatedAt || w.createdAt || '');

/**
 * Server-side merge for POST /api/sync, the same rules as the phone's merge: union by id, the newer
 * copy wins, tombstones beat older copies, day counters take the max. Keeps words the server added
 * (the word of the day) that the phone has not pulled yet.
 */
export function mergeData(server, incoming) {
  const deleted = Object.assign({}, (server && server.deleted) || {});
  Object.entries(incoming.deleted || {}).forEach(([id, t]) => { if (!deleted[id] || t > deleted[id]) deleted[id] = t; });
  const byId = new Map();
  [...((server && server.words) || []), ...(incoming.words || [])].forEach((w) => {
    if (!w || !w.id) return;
    const cur = byId.get(w.id);
    if (!cur || stamp(w) >= stamp(cur)) byId.set(w.id, w);
  });
  // keep the phone's order, then anything only the server had
  const order = [...(incoming.words || []).map((w) => w && w.id), ...((server && server.words) || []).map((w) => w && w.id)];
  const words = [];
  const used = new Set();
  order.forEach((id) => {
    if (!id || used.has(id)) return; used.add(id);
    const w = byId.get(id);
    if (w && !(deleted[id] && deleted[id] >= stamp(w))) words.push(w);
  });
  const days = Object.assign({}, (server && server.days) || {});
  Object.entries(incoming.days || {}).forEach(([k, d]) => {
    const cur = days[k] || { date: k };
    const out = Object.assign({}, cur, d);
    ['reviewed', 'ok', 'hard', 'miss', 'added'].forEach((f) => { out[f] = Math.max(cur[f] || 0, (d && d[f]) || 0); });
    days[k] = out;
  });
  return { words, days, deleted };
}
