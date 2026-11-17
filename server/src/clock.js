// Time helpers. All dates are local "YYYY-MM-DD", times "HH:MM" so the clinic's wall clock is what counts.
let fixed = null;
export const now = () => (fixed ? new Date(fixed) : new Date());
export const setNow = (d) => { fixed = d ? new Date(d) : null; };

export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => fmtDate(now());
export const nowTime = () => fmtTime(now());
export const parseDate = (s) => new Date(`${s}T00:00:00`);
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtDate(parseDate(s)) === s;
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const weekday = (s) => parseDate(s).getDay(); // 0 = Sunday
export const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Inclusive date range for a named period. Weeks run Monday to Sunday. */
export function periodRange(period, ref = today()) {
  const d = parseDate(ref);
  switch (period) {
    case 'today': return { from: ref, to: ref };
    case 'week': {
      const offset = (d.getDay() + 6) % 7;
      const from = addDays(ref, -offset);
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from, to: fmtDate(last) };
    }
    case 'year': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
    default: return null;
  }
}
