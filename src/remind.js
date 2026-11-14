// Pure helpers for the morning reminder. Kept dependency-free so they can be unit tested in Node.

/** YYYY-MM-DD for `date` in the IANA time zone `tz` (falls back to Europe/Istanbul, UTC+3, no DST). */
export function todayIn(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (e) {
    return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

/** HH:MM wall-clock time for `date` in `tz`. */
export function timeIn(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('hour')}:${get('minute')}`;
  } catch (e) {
    return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(11, 16);
  }
}

/** The morning run for one phone is due once its local time has reached `remindAt` and it hasn't had today's run. */
export function remindDue(nowHM, remindAt, lastDay, today) {
  return lastDay !== today && nowHM >= (remindAt || '08:35');
}

export const validTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Words whose review date has arrived (a word without `due` counts as due). */
export function dueWords(words, today) {
  return (Array.isArray(words) ? words : []).filter((w) => w && typeof w === 'object' && (!w.due || String(w.due) <= today));
}

/** Oldest due first, then oldest created, so the names shown are the ones waiting longest. */
function byUrgency(a, b) {
  return String(a.due || '').localeCompare(String(b.due || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

/** One-line Turkish reminder naming up to three words. */
export function reminderText(due) {
  const n = due.length;
  const names = due.slice().sort(byUrgency).map((w) => String(w.term || w.typed || '').trim()).filter(Boolean).slice(0, 3);
  const list = names.join(', ') + (n > names.length ? '…' : '');
  return n === 1
    ? `Günaydın! Bugün tekrar edilecek 1 kelimen var: ${list}`
    : `Günaydın! Bugün tekrar edilecek ${n} kelimen var: ${list}`;
}
