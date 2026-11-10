// Small helpers shared by the Worker and its tests (no Workers-only imports here).

/** Pulls the first JSON value out of a model reply (tolerates code fences and stray prose). */
export function parseJSON(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const close = t[start] === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  if (end <= start) return undefined;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return undefined; }
}
