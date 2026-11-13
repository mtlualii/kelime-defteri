import assert from 'node:assert/strict';
import { shouldAutoAdd, addedNothingOn, dayBefore, autoDoc, mergeData, autoWordPrompt } from '../src/autoword.js';
const tz = 'Europe/Istanbul';
const now = Date.parse('2026-11-14T05:35:00Z');   // 08:35 Istanbul, Nov 14
assert.equal(dayBefore('2026-11-01'), '2026-10-31');
const w = (o) => Object.assign({ id: Math.random().toString(36), term: 'x', lang: 'en', en: 'x', de: 'y', tr: 'z' }, o);
const data = { words: [w({ createdAt: '2026-11-12T10:00:00Z' })], days: {} };
assert.deepEqual(shouldAutoAdd({ data, settings: { autoWord: true }, lastAuto: null, tz, now }).add, true, 'nothing added yesterday → add');
assert.equal(shouldAutoAdd({ data, settings: { autoWord: false }, tz, now }).reason, 'off');
assert.equal(shouldAutoAdd({ data, settings: {}, lastAuto: '2026-11-14', tz, now }).reason, 'already_today');
assert.equal(shouldAutoAdd({ data: { words: [] }, settings: {}, tz, now }).reason, 'no_words');
// a word created late yesterday in Istanbul time (22:30 UTC on the 12th is 01:30 on the 13th)
assert.equal(addedNothingOn({ words: [w({ createdAt: '2026-11-12T22:30:00Z' })] }, '2026-11-13', tz), false);
assert.equal(addedNothingOn({ words: [w({ createdAt: '2026-11-12T22:30:00Z', auto: true })] }, '2026-11-13', tz), true, 'auto words do not count');
assert.equal(addedNothingOn({ words: [], days: { '2026-11-13': { added: 2 } } }, '2026-11-13', tz), false);
// doc building + duplicate guard
const r = { lang: 'en', en: 'castigate', de: 'tadeln', tr: 'kınamak', pos: 'verb', why: 'kınama', example: { en: 'a', de: 'b', tr: 'c' } };
const d = autoDoc(r, data.words, '2026-11-14', '2026-11-14T05:35:00.000Z');
assert.equal(d.term, 'castigate'); assert.equal(d.auto, true); assert.equal(d.due, '2026-11-14'); assert.match(d.note, /^Günün kelimesi: kınama/);
assert.equal(autoDoc(r, [w({ term: 'castigate' })], '2026-11-14', 'n'), null, 'duplicate rejected');
assert.equal(autoDoc({ lang: 'ar', source: 'لوم (levm)', en: 'blame', de: 'der Tadel', tr: 'kınama' }, [], 't', 'n').term, 'لوم (levm)');
assert.equal(autoDoc({ lang: 'en', en: '', de: 'x', tr: 'y' }, [], 't', 'n'), null);
assert.match(autoWordPrompt(data.words), /Pick ONE new word/);
// merge keeps server-only words, applies tombstones and newer copies
const A = { id: 'a', updatedAt: '1' }, B = { id: 'b', updatedAt: '1' }, AUTO = { id: 'auto', updatedAt: '5' };
let m = mergeData({ words: [AUTO, A, B], days: { d: { added: 1 } }, deleted: {} }, { words: [Object.assign({}, A, { updatedAt: '3', x: 1 }), B], days: { d: { reviewed: 2 } }, deleted: {} });
assert.deepEqual(m.words.map((x) => x.id), ['a', 'b', 'auto']); assert.equal(m.words[0].x, 1); assert.deepEqual([m.days.d.added, m.days.d.reviewed], [1, 2]);
m = mergeData({ words: [AUTO, A, B] }, { words: [A], deleted: { b: '2' } });
assert.deepEqual(m.words.map((x) => x.id), ['a', 'auto'], 'tombstone removes b');
m = mergeData(null, { words: [A] }); assert.equal(m.words.length, 1);
console.log('autoword OK');
