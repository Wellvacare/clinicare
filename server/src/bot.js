// Rule-based booking assistant shared by the chat widget and the voice agent.
// It is stateless: the client sends back the `state` it received, so no server session is needed.
import * as clock from './clock.js';
import { freeSlots, nearestSlots, bookAppointment, getDoctor, fmtNice, normPhone, validPhone, HttpError } from './services.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PARTS = { morning: ['09:00', '12:59'], afternoon: ['12:00', '16:59'], evening: ['17:00', '19:00'], noon: ['12:00', '14:00'] };

export function parseDate(text, ref = clock.today()) {
  const t = text.toLowerCase();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m && clock.isDate(m[0])) return { date: m[0], span: m[0] };
  if (/\bday after tomorrow\b/.test(t)) return { date: clock.addDays(ref, 2), span: 'day after tomorrow' };
  if (/\btomorrow\b/.test(t)) return { date: clock.addDays(ref, 1), span: 'tomorrow' };
  if (/\b(today|tonight)\b/.test(t)) return { date: ref, span: t.match(/\b(today|tonight)\b/)[0] };
  m = t.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = DAYS.indexOf(m[1]); const cur = clock.weekday(ref);
    let diff = (target - cur + 7) % 7;
    if (diff === 0 && /next/.test(m[0])) diff = 7;
    return { date: clock.addDays(ref, diff), span: m[0] };
  }
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (m) return { date: rollYear(Number(m[1]), MONTHS.indexOf(m[2]), ref), span: m[0] };
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) return { date: rollYear(Number(m[2]), MONTHS.indexOf(m[1]), ref), span: m[0] };
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})\b/);
  if (m) return { date: rollYear(Number(m[1]), Number(m[2]) - 1, ref), span: m[0] };
  return null;
}
function rollYear(day, month, ref) {
  const y = clock.parseDate(ref).getFullYear();
  let d = `${y}-${clock.pad(month + 1)}-${clock.pad(day)}`;
  if (!clock.isDate(d)) return null;
  if (d < ref) d = `${y + 1}-${clock.pad(month + 1)}-${clock.pad(day)}`;
  return clock.isDate(d) ? d : null;
}

export function parseTime(text) {
  const HOURS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const t = text.toLowerCase().replace(/a\.m\./g, 'am').replace(/p\.m\./g, 'pm')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s*(am|pm|o'?clock))/g, (w) => HOURS[w])
    .replace(/\b(\d{1,2})\s*o'?clock\b/g, 'at $1');
  let m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?/);
  if (!m) m = t.match(/\b(1[0-2]|0?[1-9])()\s*(am|pm)\b/);
  if (!m) m = t.match(/\bat\s+(1[0-2]|0?[1-9])()()\b/);
  if (m) {
    let h = Number(m[1]); const min = Number(m[2] || 0); const ap = m[3] || '';
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 8) h += 12; // clinic hours: "at 5" means 17:00
    return `${clock.pad(h)}:${clock.pad(min)}`;
  }
  return null;
}
export const parsePart = (text) => { const k = Object.keys(PARTS).find((p) => text.toLowerCase().includes(p)); return k || null; };

const yes = (t) => /\b(yes|yeah|yep|yup|confirm|ok|okay|sure|correct|please do|go ahead|book it)\b/i.test(t);
const no = (t) => /\b(no|nope|cancel|stop|change|different|another)\b/i.test(t);

const chips = (opts) => opts.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
const slotChips = (slots) => slots.map((s) => ({ label: fmtNice(s.date, s.time), value: `${s.date} ${s.time}` }));

function offerSlots(db, st, reply) {
  const base = st.date || clock.today();
  let slots;
  const part = st.part && PARTS[st.part];
  const inPart = (t) => !part || (t >= part[0] && t <= part[1]);
  if (st.time) {
    slots = nearestSlots(db, st.doctorId, base, st.time, 3);
  } else {
    slots = [];
    for (let i = 0; i < 14 && slots.length < 3; i++) {
      const d = clock.addDays(base, i);
      for (const t of freeSlots(db, st.doctorId, d).filter(inPart)) { slots.push({ date: d, time: t }); if (slots.length >= 3) break; }
      if (!st.date && slots.length) break; // no date given: soonest day with space
      if (st.date && slots.length) break;
    }
  }
  if (!slots.length) return { state: { ...st, step: 'when' }, reply: 'Sorry, I could not find a free slot around then. Which other day would suit you?', options: chips(['Tomorrow', 'Next Monday']) };
  return { state: { ...st, step: 'pick', offered: slots }, reply, options: slotChips(slots) };
}

export function botTurn(db, input) {
  const text = String(input.text || '').trim().slice(0, 300);
  let st = { step: 'start', source: 'chat', ...(input.state || {}) };
  st.source = st.source === 'voice' ? 'voice' : 'chat';
  if (!st.doctorId) throw new HttpError(400, 'Please choose a doctor first');
  const doctor = getDoctor(db, st.doctorId);

  if (st.step === 'start' || !text) {
    const first = `Hello! I'm the ${'CliniCare'} booking assistant for ${doctor.name}. When would you like to come in? For example "tomorrow morning" or "Friday at 5 pm".`;
    if (!text || st.step === 'start') {
      if (st.prefillDate && !text) {
        const next = { ...st, step: 'when', date: st.prefillDate };
        return offerSlots(db, next, `Hello! Here are the nearest openings from ${fmtNice(st.prefillDate, '').replace(' at ', '')}:`);
      }
      if (!text) return { state: { ...st, step: 'when' }, reply: first, options: chips(['Tomorrow morning', 'Today', 'Next Monday']) };
      st = { ...st, step: 'when' };
    }
  }

  if (st.step === 'when') {
    const d = parseDate(text); const time = parseTime(text.replace(d?.span || '', '')); const part = parsePart(text);
    if (!d && !time && !part) {
      return { state: st, reply: 'I did not catch a day or time. You can say things like "tomorrow morning", "Friday evening" or "20 Nov at 10:30".', options: chips(['Tomorrow morning', 'Today', 'Next Monday']) };
    }
    const next = { ...st, date: d?.date || null, time: time || null, part: part || null };
    if (next.date && next.date < clock.today()) return { state: st, reply: 'That date has passed. Which upcoming day works for you?' };
    if (next.time && next.date && freeSlots(db, st.doctorId, next.date).includes(next.time)) {
      const slot = { date: next.date, time: next.time };
      return askContact({ ...next, step: 'contact', slot, offered: [slot] }, `${fmtNice(slot.date, slot.time)} is free.`);
    }
    const taken = next.time && next.date;
    return offerSlots(db, next, taken
      ? `Sorry, ${fmtNice(next.date, next.time)} is not available. The nearest free slots are:`
      : 'These slots are free. Which one would you like?');
  }

  if (st.step === 'pick') {
    let slot = null;
    const iso = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (iso) slot = st.offered.find((s) => s.date === iso[1] && s.time === iso[2]);
    if (!slot) { const t = parseTime(text); if (t) slot = st.offered.filter((s) => s.time === t)[0]; }
    if (!slot) {
      const ord = text.toLowerCase().match(/\b(first|1st|one|second|2nd|two|third|3rd|three|1|2|3)\b/);
      const idx = ord ? { first: 0, '1st': 0, one: 0, 1: 0, second: 1, '2nd': 1, two: 1, 2: 1, third: 2, '3rd': 2, three: 2, 3: 2 }[ord[1]] : -1;
      if (idx >= 0) slot = st.offered[idx];
      else if (yes(text) && st.offered.length === 1) slot = st.offered[0];
    }
    if (slot) return askContact({ ...st, step: 'contact', slot }, `Great, ${fmtNice(slot.date, slot.time)}.`);
    if (no(text) || parseDate(text) || parsePart(text)) return botTurn(db, { text, state: { ...st, step: 'when' } });
    return { state: st, reply: 'Please pick one of the times above, or tell me another day.', options: slotChips(st.offered) };
  }

  if (st.step === 'contact') {
    if (!st.name) {
      const name = text.replace(/^(my name is|i am|i'm|this is|it's)\s+/i, '').replace(/[^\p{L}\s.'-]/gu, '').trim();
      if (name.length < 2 || name.split(/\s+/).length > 5) return { state: st, reply: 'Sorry, could you tell me your full name?' };
      return { state: { ...st, name: titleCase(name) }, reply: `Thanks, ${titleCase(name).split(' ')[0]}. What phone number should I use for the confirmation?` };
    }
    const phone = normPhone(spokenDigits(text));
    if (!validPhone(phone)) return { state: st, reply: 'That does not look like a phone number. Please say or type it again, digits only.' };
    const next = { ...st, step: 'confirm', phone };
    return { state: next, reply: `To confirm: ${doctor.name} on ${fmtNice(st.slot.date, st.slot.time)} for ${st.name} (${phone}). Shall I book it?`, options: chips(['Yes, book it', 'No, change time']) };
  }

  if (st.step === 'confirm') {
    if (yes(text) && !no(text)) {
      try {
        const a = bookAppointment(db, { doctorId: st.doctorId, date: st.slot.date, time: st.slot.time, name: st.name, phone: st.phone, source: st.source });
        return { state: { ...st, step: 'done' }, booked: { id: a.id, date: a.date, time: a.time, doctor: a.doctor_name, patient: a.patient_name },
          reply: `You're booked! ${a.doctor_name}, ${fmtNice(a.date, a.time)}. A confirmation has been sent to ${st.phone}. See you then!` };
      } catch (e) {
        if (e instanceof HttpError && e.status === 409 && e.extra.slots) {
          return offerSlots(db, { ...st, step: 'pick', date: st.slot.date, time: st.slot.time }, 'Sorry, that slot has just been taken. Nearest free slots:');
        }
        if (e instanceof HttpError) return { state: st, reply: e.message };
        throw e;
      }
    }
    return botTurn(db, { text: '', state: { ...st, step: 'when', slot: null } });
  }

  return { state: { ...st, step: 'when' }, reply: 'Would you like to book another appointment? Tell me the day.', options: chips(['Tomorrow morning']) };
}

function askContact(st, lead) {
  if (st.name && st.phone) return { state: { ...st, step: 'confirm' }, reply: `${lead} Shall I book it for ${st.name} (${st.phone})?`, options: chips(['Yes, book it', 'No, change time']) };
  return { state: st, reply: `${lead} May I have your full name?` };
}
const titleCase = (s) => s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const spokenDigits = (s) => s.toLowerCase().replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => WORDS[w]);
