import assert from 'node:assert/strict';
import { todayIn, dueWords, reminderText } from '../src/remind.js';
import { parseJSON } from '../src/util.js';

// 05:35 UTC is 08:35 in Istanbul (UTC+3, no DST) → same calendar day; 22:30 UTC is already tomorrow there.
assert.equal(todayIn('Europe/Istanbul', new Date('2026-11-09T05:35:00Z')), '2026-11-09');
assert.equal(todayIn('Europe/Istanbul', new Date('2026-11-09T22:30:00Z')), '2026-11-10');
assert.equal(todayIn('America/New_York', new Date('2026-11-09T03:30:00Z')), '2026-11-08');
assert.equal(todayIn('', new Date('2026-11-09T05:35:00Z')), '2026-11-09');

const words = [
  { id: 'a', term: 'perennial', due: '2026-11-03', createdAt: '2026-10-30T10:08:33Z' },
  { id: 'b', term: 'طعن (ta\'n)', due: '2026-11-01', createdAt: '2026-10-30T10:09:54Z' },
  { id: 'c', term: 'later', due: '2026-12-01', createdAt: '2026-10-30T10:00:00Z' },
  { id: 'd', term: 'nodue', createdAt: '2026-11-01T00:00:00Z' },
  { id: 'e', term: 'ممرّ (memer)', due: '2026-11-03', createdAt: '2026-10-30T10:08:03Z' },
  { id: 'f', term: 'congregation', due: '2026-11-09', createdAt: '2026-10-30T10:11:51Z' },
];
const due = dueWords(words, '2026-11-09');
assert.deepEqual(due.map((w) => w.id).sort(), ['a', 'b', 'd', 'e', 'f']);
assert.equal(reminderText(due), 'Günaydın! Bugün tekrar edilecek 5 kelimen var: nodue, طعن (ta\'n), ممرّ (memer)…');
assert.equal(reminderText([words[0]]), 'Günaydın! Bugün tekrar edilecek 1 kelimen var: perennial');
assert.equal(reminderText(due.slice(0, 3)), 'Günaydın! Bugün tekrar edilecek 3 kelimen var: nodue, طعن (ta\'n), perennial');
assert.deepEqual(dueWords(null, '2026-11-09'), []);

assert.deepEqual(parseJSON('{"a":1}'), { a: 1 });
assert.deepEqual(parseJSON('```json\n[{"x":"y"}]\n```'), [{ x: 'y' }]);
assert.deepEqual(parseJSON('Sure! Here it is: {"en":"a","tr":"b"} hope that helps'), { en: 'a', tr: 'b' });
assert.equal(parseJSON('no json here'), undefined);
assert.equal(parseJSON(''), undefined);
console.log('remind + parseJSON OK');
