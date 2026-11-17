import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as clock from './clock.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, x) => new HttpError(400, m, x);
const notFound = (m) => new HttpError(404, m);
const conflict = (m, x) => new HttpError(409, m, x);

export const CONFIG = {
  clinicName: 'CliniCare',
  openDays: [1, 2, 3, 4, 5, 6],        // Monday to Saturday
  dayStart: '09:00', dayEnd: '18:00',  // last slot starts 30 min before dayEnd
  lunch: { from: '13:00', to: '14:00' },
  slotMinutes: 30,
  reminderLeadDays: 1,                 // proposal: reminder 1 day before the follow-up
  reminderHour: '09:00',
  channel: 'SMS',                      // proposal: SMS first, WhatsApp later
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',
};

export const STATUSES = ['Booked', 'Checked in', 'Completed', 'Cancelled', 'No-show'];
export const TRANSITIONS = {
  Booked: ['Checked in', 'Cancelled', 'No-show'],
  'Checked in': ['Completed'],
};

export const normPhone = (raw) => {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  return (s.startsWith('+') ? '+' : '') + digits;
};
export const validPhone = (p) => p.replace('+', '').length >= 7 && p.replace('+', '').length <= 15;

const money = (n) => Math.round(n * 100) / 100;

// ───────────────────────── messaging (outbox) ─────────────────────────
export function sendMessage(db, { patientId, phone, kind, body, channel = CONFIG.channel }) {
  db.prepare('INSERT INTO outbox (patient_id, channel, to_phone, kind, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(patientId ?? null, channel, phone ?? null, kind, body, `${clock.today()}T${clock.nowTime()}`);
}

// ───────────────────────── slots & booking ─────────────────────────
export function daySlots(date) {
  if (!CONFIG.openDays.includes(clock.weekday(date))) return [];
  const out = [];
  const end = clock.minutes(CONFIG.dayEnd);
  for (let m = clock.minutes(CONFIG.dayStart); m + CONFIG.slotMinutes <= end; m += CONFIG.slotMinutes) {
    if (m >= clock.minutes(CONFIG.lunch.from) && m < clock.minutes(CONFIG.lunch.to)) continue;
    out.push(`${clock.pad(Math.floor(m / 60))}:${clock.pad(m % 60)}`);
  }
  return out;
}

const isPast = (date, time) => `${date}T${time}` <= `${clock.today()}T${clock.nowTime()}`;

export function freeSlots(db, doctorId, date) {
  const taken = new Set(db.prepare(
    "SELECT time FROM appointments WHERE doctor_id=? AND date=? AND status IN ('Booked','Checked in','Completed')"
  ).all(doctorId, date).map((r) => r.time));
  return daySlots(date).filter((t) => !taken.has(t) && !isPast(date, t));
}

/** Nearest free slots to a requested date/time (looks up to 14 days ahead). */
export function nearestSlots(db, doctorId, date, time = '12:00', n = 3) {
  const target = new Date(`${date}T${time}:00`).getTime();
  const cands = [];
  const start = date < clock.today() ? clock.today() : clock.addDays(date, -2) < clock.today() ? clock.today() : clock.addDays(date, -2);
  for (let i = 0; i < 16; i++) {
    const d = clock.addDays(start, i);
    for (const t of freeSlots(db, doctorId, d)) {
      cands.push({ date: d, time: t, dist: Math.abs(new Date(`${d}T${t}:00`).getTime() - target) });
    }
  }
  return cands.sort((a, b) => a.dist - b.dist).slice(0, n).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .map(({ date: d, time: t }) => ({ date: d, time: t }));
}

export function getDoctor(db, id) {
  const d = db.prepare("SELECT id,name,specialty,fee FROM users WHERE id=? AND role='doctor' AND active=1").get(id);
  if (!d) throw notFound('Doctor not found');
  return d;
}

export function findOrCreatePatient(db, { name, phone, email }) {
  const p = normPhone(phone);
  if (!validPhone(p)) throw bad('Please enter a valid phone number');
  const existing = db.prepare('SELECT * FROM patients WHERE phone=?').get(p);
  if (existing) return { patient: existing, created: false };
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2) throw bad('Please enter the patient name');
  const r = db.prepare('INSERT INTO patients (name, phone, email, created_at) VALUES (?,?,?,?)')
    .run(cleanName, p, email || null, clock.today());
  return { patient: db.prepare('SELECT * FROM patients WHERE id=?').get(r.lastInsertRowid), created: true };
}

export const fmtNice = (date, time) => {
  const d = clock.parseDate(date);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
};

export function bookAppointment(db, { doctorId, date, time, patientId, name, phone, reason, source = 'reception' }) {
  if (!clock.isDate(date) || !clock.isTime(time)) throw bad('Invalid date or time');
  const doctor = getDoctor(db, doctorId);
  if (!daySlots(date).includes(time)) throw bad('The clinic does not take appointments at that time', { slots: nearestSlots(db, doctorId, date, time) });
  if (isPast(date, time)) throw bad('That time has already passed', { slots: nearestSlots(db, doctorId, date, time) });

  return db.tx(() => {
    let patient;
    if (patientId) {
      patient = db.prepare('SELECT * FROM patients WHERE id=?').get(patientId);
      if (!patient) throw notFound('Patient not found');
    } else {
      patient = findOrCreatePatient(db, { name, phone }).patient;
    }
    const dup = db.prepare(
      "SELECT id FROM appointments WHERE patient_id=? AND doctor_id=? AND date=? AND status IN ('Booked','Checked in')"
    ).get(patient.id, doctor.id, date);
    if (dup) throw conflict('This patient already has an appointment with this doctor on that day');
    let id;
    try {
      id = db.prepare(
        'INSERT INTO appointments (patient_id, doctor_id, date, time, fee, source, reason, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(patient.id, doctor.id, date, time, doctor.fee, source, reason || null, `${clock.today()}T${clock.nowTime()}`).lastInsertRowid;
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw conflict('That slot has just been taken', { slots: nearestSlots(db, doctorId, date, time) });
      throw e;
    }
    // A booking resolves any open follow-up so no further reminders go out.
    db.prepare("UPDATE followups SET status='Booked', booked_appointment_id=? WHERE patient_id=? AND status IN ('Scheduled','Reminded')")
      .run(id, patient.id);
    sendMessage(db, {
      patientId: patient.id, phone: patient.phone, kind: 'confirmation',
      body: `${CONFIG.clinicName}: Hi ${patient.name.split(' ')[0]}, your appointment with ${doctor.name} is confirmed for ${fmtNice(date, time)}.`,
    });
    return getAppointment(db, id);
  });
}

// ───────────────────────── appointments ─────────────────────────
const APPT_SELECT = `
  SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, u.name AS doctor_name,
         (SELECT status FROM prescriptions WHERE appointment_id=a.id) AS slip_status
  FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.doctor_id`;

export function getAppointment(db, id) {
  const a = db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(id);
  if (!a) throw notFound('Appointment not found');
  return a;
}

export function listAppointments(db, { date, from, to, status, doctorId, q, patientId }) {
  const where = []; const args = [];
  if (date) { where.push('a.date=?'); args.push(date); }
  if (from) { where.push('a.date>=?'); args.push(from); }
  if (to) { where.push('a.date<=?'); args.push(to); }
  if (status) { where.push('a.status=?'); args.push(status); }
  if (doctorId) { where.push('a.doctor_id=?'); args.push(doctorId); }
  if (patientId) { where.push('a.patient_id=?'); args.push(patientId); }
  if (q) { where.push('(p.name LIKE ? OR p.phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const sql = `${APPT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date, a.time LIMIT 1000`;
  return db.prepare(sql).all(...args);
}

export function scheduleFollowup(db, appt, dueDate) {
  db.prepare("UPDATE followups SET status='Cancelled' WHERE appointment_id=? AND status IN ('Scheduled','Reminded')").run(appt.id);
  if (!dueDate) return null;
  if (!clock.isDate(dueDate)) throw bad('Invalid follow-up date');
  if (dueDate <= clock.today()) throw bad('Follow-up date must be after today');
  const remindDate = clock.addDays(dueDate, -CONFIG.reminderLeadDays);
  const remindAt = `${remindDate < clock.today() ? clock.today() : remindDate}T${CONFIG.reminderHour}`;
  return db.prepare('INSERT INTO followups (patient_id, appointment_id, due_date, remind_at) VALUES (?,?,?,?)')
    .run(appt.patient_id, appt.id, dueDate, remindAt).lastInsertRowid;
}

export function saveConsultation(db, id, { diagnosis, notes, followupDate }) {
  const a = getAppointment(db, id);
  if (!['Checked in', 'Completed'].includes(a.status)) throw bad('Consultation notes can be saved once the patient has checked in');
  db.tx(() => {
    db.prepare('UPDATE appointments SET diagnosis=?, notes=?, followup_date=? WHERE id=?')
      .run(diagnosis ?? a.diagnosis, notes ?? a.notes, followupDate === undefined ? a.followup_date : followupDate || null, id);
    if (followupDate !== undefined) scheduleFollowup(db, a, followupDate || null);
  });
  return getAppointment(db, id);
}

export function changeStatus(db, id, status, consult = {}) {
  const a = getAppointment(db, id);
  if (!STATUSES.includes(status)) throw bad('Unknown status');
  if (!(TRANSITIONS[a.status] || []).includes(status)) {
    throw conflict(`An appointment that is "${a.status}" cannot become "${status}"`);
  }
  if (status === 'Checked in' && a.date !== clock.today()) throw bad('Patients can only be checked in on the day of the appointment');
  db.tx(() => {
    if (status === 'Completed') {
      const diagnosis = (consult.diagnosis ?? a.diagnosis ?? '').trim();
      if (!diagnosis) throw bad('Please record a diagnosis before ending the consultation');
      const followup = consult.followupDate === undefined ? a.followup_date : consult.followupDate || null;
      db.prepare('UPDATE appointments SET status=?, diagnosis=?, notes=?, followup_date=?, completed_at=? WHERE id=?')
        .run(status, diagnosis, consult.notes ?? a.notes, followup, `${clock.today()}T${clock.nowTime()}`, id);
      if (consult.followupDate !== undefined) scheduleFollowup(db, a, followup);
    } else {
      db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, id);
    }
  });
  return getAppointment(db, id);
}

// ───────────────────────── patients / EMR ─────────────────────────
export function patientRecord(db, id) {
  const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  if (!patient) throw notFound('Patient not found');
  const visits = db.prepare(`${APPT_SELECT} WHERE a.patient_id=? ORDER BY a.date DESC, a.time DESC`).all(id)
    .map((v) => ({ ...v, reports: reportsFor(db, v.id), prescription: prescriptionFor(db, v.id) }));
  const followups = db.prepare("SELECT * FROM followups WHERE patient_id=? AND status IN ('Scheduled','Reminded') ORDER BY due_date").all(id);
  return { patient, visits, followups };
}

export const reportsFor = (db, apptId) =>
  db.prepare('SELECT id, title, filename, mime, size, created_at FROM reports WHERE appointment_id=? ORDER BY id').all(apptId);

const ALLOWED_MIME = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };
export function addReport(db, uploadDir, apptId, { title, filename, mime, dataBase64 }) {
  const a = getAppointment(db, apptId);
  if (a.status === 'Cancelled' || a.status === 'No-show') throw bad('Reports cannot be added to this visit');
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw bad('Only PDF, PNG or JPG files are allowed');
  const buf = Buffer.from(dataBase64 || '', 'base64');
  if (!buf.length) throw bad('The file is empty');
  if (buf.length > 8 * 1024 * 1024) throw bad('Files can be at most 8 MB');
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadDir, stored), buf);
  const safeName = path.basename(String(filename || `report${ext}`)).slice(0, 120);
  const id = db.prepare('INSERT INTO reports (patient_id, appointment_id, title, filename, stored_as, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(a.patient_id, apptId, String(title || safeName).slice(0, 120), safeName, stored, mime, buf.length, `${clock.today()}T${clock.nowTime()}`).lastInsertRowid;
  return db.prepare('SELECT id,title,filename,mime,size,created_at FROM reports WHERE id=?').get(id);
}

// ───────────────────────── medicines ─────────────────────────
export const stockState = (m) => (m.stock <= 0 ? 'out' : m.stock <= m.reorder_level ? 'low' : 'ok');
const expiringSoon = (m) => !!m.expiry_date && m.expiry_date <= clock.addDays(clock.today(), 60);
const decorate = (m) => ({ ...m, state: stockState(m), expiring: expiringSoon(m), expired: !!m.expiry_date && m.expiry_date < clock.today() });

export function listMedicines(db, { q, state } = {}) {
  const rows = db.prepare('SELECT * FROM medicines WHERE active=1 AND name LIKE ? ORDER BY name').all(`%${q || ''}%`).map(decorate);
  return state ? rows.filter((m) => (state === 'expiring' ? m.expiring : m.state === state)) : rows;
}

export function addStock(db, medicineId, qty, reason, ref) {
  const m = db.prepare('SELECT * FROM medicines WHERE id=?').get(medicineId);
  if (!m) throw notFound('Medicine not found');
  if (m.stock + qty < 0) throw conflict(`Only ${m.stock} ${m.unit} of ${m.name} available`);
  db.prepare('UPDATE medicines SET stock=stock+? WHERE id=?').run(qty, medicineId);
  db.prepare('INSERT INTO stock_movements (medicine_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)')
    .run(medicineId, qty, reason, ref ?? null, `${clock.today()}T${clock.nowTime()}`);
  return decorate(db.prepare('SELECT * FROM medicines WHERE id=?').get(medicineId));
}

export function receiveDelivery(db, medicineId, qty) {
  if (!Number.isInteger(qty) || qty <= 0) throw bad('Delivery quantity must be a whole number above zero');
  return db.tx(() => addStock(db, medicineId, qty, 'delivery'));
}

// ───────────────────────── prescriptions & slips ─────────────────────────
export function prescriptionFor(db, apptId) {
  const p = db.prepare('SELECT * FROM prescriptions WHERE appointment_id=?').get(apptId);
  if (!p) return null;
  const items = db.prepare(`SELECT i.*, m.name AS medicine_name, m.unit, m.stock, m.reorder_level
    FROM prescription_items i JOIN medicines m ON m.id=i.medicine_id WHERE i.prescription_id=? ORDER BY i.id`).all(p.id)
    .map((i) => ({ ...i, state: stockState({ stock: i.stock, reorder_level: i.reorder_level }) }));
  return { ...p, items };
}

export function savePrescription(db, apptId, items, doctorUserId) {
  const a = getAppointment(db, apptId);
  if (a.status !== 'Checked in') throw bad('Prescriptions can only be written during a consultation');
  if (doctorUserId && a.doctor_id !== doctorUserId) throw new HttpError(403, 'This appointment belongs to another doctor');
  const existing = db.prepare('SELECT * FROM prescriptions WHERE appointment_id=?').get(apptId);
  if (existing?.status === 'Collected') throw conflict('This prescription has already been collected');
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.medicineId)) throw bad('A medicine appears twice in the prescription');
    seen.add(it.medicineId);
    if (!db.prepare('SELECT 1 FROM medicines WHERE id=? AND active=1').get(it.medicineId)) throw notFound('Medicine not found');
  }
  return db.tx(() => {
    if (existing) {
      db.prepare('DELETE FROM prescription_items WHERE prescription_id=?').run(existing.id);
      if (!items.length) db.prepare('DELETE FROM prescriptions WHERE id=?').run(existing.id);
    }
    if (!items.length) return null;
    const pid = existing?.id ?? db.prepare('INSERT INTO prescriptions (appointment_id, patient_id, doctor_id, issued_at) VALUES (?,?,?,?)')
      .run(apptId, a.patient_id, a.doctor_id, `${clock.today()}T${clock.nowTime()}`).lastInsertRowid;
    const ins = db.prepare('INSERT INTO prescription_items (prescription_id, medicine_id, dose, duration, quantity) VALUES (?,?,?,?,?)');
    for (const it of items) ins.run(pid, it.medicineId, it.dose, it.duration, it.quantity);
    return prescriptionFor(db, apptId);
  });
}

export function listSlips(db, { status, from, to, q }) {
  const where = []; const args = [];
  if (status) { where.push('s.status=?'); args.push(status); }
  if (from) { where.push("substr(COALESCE(s.collected_at, s.issued_at),1,10) >= ?"); args.push(from); }
  if (to) { where.push("substr(COALESCE(s.collected_at, s.issued_at),1,10) <= ?"); args.push(to); }
  if (q) { where.push('p.name LIKE ?'); args.push(`%${q}%`); }
  const rows = db.prepare(`SELECT s.*, p.name AS patient_name, p.phone AS patient_phone, u.name AS doctor_name
    FROM prescriptions s JOIN patients p ON p.id=s.patient_id JOIN users u ON u.id=s.doctor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.issued_at DESC LIMIT 500`).all(...args);
  return rows.map((r) => ({ ...r, ...prescriptionFor(db, r.appointment_id), id: r.id }));
}

/** Pharmacist hands over the medicines: checks stock, deducts it and marks the slip collected. */
export function collectSlip(db, slipId) {
  return db.tx(() => {
    const slip = db.prepare('SELECT * FROM prescriptions WHERE id=?').get(slipId);
    if (!slip) throw notFound('Slip not found');
    if (slip.status === 'Collected') throw conflict('This slip has already been collected');
    const items = db.prepare('SELECT i.*, m.name, m.stock, m.unit, m.price FROM prescription_items i JOIN medicines m ON m.id=i.medicine_id WHERE prescription_id=?').all(slipId);
    const short = items.filter((i) => i.quantity > i.stock)
      .map((i) => ({ medicine: i.name, requested: i.quantity, available: i.stock, unit: i.unit }));
    if (short.length) {
      const s = short[0];
      throw conflict(`Only ${s.available} ${s.unit} of ${s.medicine} available (${s.requested} requested)`, { short });
    }
    let total = 0;
    for (const i of items) {
      addStock(db, i.medicine_id, -i.quantity, 'sale', `slip:${slipId}`);
      db.prepare('UPDATE prescription_items SET unit_price=? WHERE id=?').run(i.price, i.id);
      total += i.price * i.quantity;
    }
    db.prepare("UPDATE prescriptions SET status='Collected', collected_at=?, total=? WHERE id=?")
      .run(`${clock.today()}T${clock.nowTime()}`, money(total), slipId);
    return listSlips(db, {}).find((s) => s.id === slipId);
  });
}

export function slipStats(db, { from, to }) {
  const rows = db.prepare(`SELECT substr(collected_at,1,10) AS date, COUNT(*) AS count FROM prescriptions
    WHERE status='Collected' AND substr(collected_at,1,10) BETWEEN ? AND ? GROUP BY date`).all(from, to);
  const map = new Map(rows.map((r) => [r.date, r.count]));
  const byDay = clock.dateRange(from, to).map((d) => ({ date: d, count: map.get(d) || 0 }));
  const pending = db.prepare("SELECT COUNT(*) AS c FROM prescriptions WHERE status='Pending'").get().c;
  return { from, to, total: byDay.reduce((s, d) => s + d.count, 0), byDay, pending, today: map.get(clock.today()) || 0 };
}

// ───────────────────────── reminders ─────────────────────────
export function runDueReminders(db) {
  const nowKey = `${clock.today()}T${clock.nowTime()}`;
  const due = db.prepare(`SELECT f.*, p.name, p.phone FROM followups f JOIN patients p ON p.id=f.patient_id
    WHERE f.status='Scheduled' AND f.remind_at <= ?`).all(nowKey);
  for (const f of due) {
    db.tx(() => {
      const upd = db.prepare("UPDATE followups SET status='Reminded', reminded_at=? WHERE id=? AND status='Scheduled'").run(nowKey, f.id);
      if (!upd.changes) return;
      sendMessage(db, {
        patientId: f.patient_id, phone: f.phone, kind: 'reminder',
        body: `${CONFIG.clinicName}: Hi ${f.name.split(' ')[0]}, your follow-up is due on ${clock.parseDate(f.due_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}. Book your visit: ${CONFIG.publicUrl}/book?date=${f.due_date}`,
      });
    });
  }
  return due.length;
}

export function listFollowups(db) {
  return db.prepare(`SELECT f.*, p.name AS patient_name, p.phone AS patient_phone FROM followups f
    JOIN patients p ON p.id=f.patient_id ORDER BY f.due_date DESC LIMIT 200`).all();
}

// ───────────────────────── admin summary ─────────────────────────
export function summary(db, { from, to }) {
  const visitsRows = db.prepare(`SELECT date, COUNT(*) AS visits, COALESCE(SUM(fee),0) AS fees FROM appointments
    WHERE status='Completed' AND date BETWEEN ? AND ? GROUP BY date`).all(from, to);
  const pharmRows = db.prepare(`SELECT substr(collected_at,1,10) AS date, COALESCE(SUM(total),0) AS sales FROM prescriptions
    WHERE status='Collected' AND substr(collected_at,1,10) BETWEEN ? AND ? GROUP BY date`).all(from, to);
  const expRows = db.prepare('SELECT date, COALESCE(SUM(amount),0) AS amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date').all(from, to);
  const V = new Map(visitsRows.map((r) => [r.date, r])); const P = new Map(pharmRows.map((r) => [r.date, r.sales]));
  const E = new Map(expRows.map((r) => [r.date, r.amount]));
  const byDay = clock.dateRange(from, to).map((date) => {
    const consultation = V.get(date)?.fees || 0; const pharmacy = P.get(date) || 0; const expenses = E.get(date) || 0;
    return { date, visits: V.get(date)?.visits || 0, consultation, pharmacy, revenue: money(consultation + pharmacy), expenses, profit: money(consultation + pharmacy - expenses) };
  });
  const sum = (k) => money(byDay.reduce((s, d) => s + d[k], 0));
  const status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS c FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status').all(from, to)) status[r.status] = r.c;
  const byDoctor = db.prepare(`SELECT u.name, COUNT(*) AS visits, COALESCE(SUM(a.fee),0) AS fees FROM appointments a
    JOIN users u ON u.id=a.doctor_id WHERE a.status='Completed' AND a.date BETWEEN ? AND ? GROUP BY u.id ORDER BY visits DESC`).all(from, to);
  const newPatients = db.prepare('SELECT COUNT(*) AS c FROM patients WHERE created_at BETWEEN ? AND ?').get(from, to).c;
  return {
    from, to, visits: sum('visits'), consultationRevenue: sum('consultation'), pharmacyRevenue: sum('pharmacy'),
    revenue: sum('revenue'), expenses: sum('expenses'), profit: sum('profit'), status, byDay, byDoctor, newPatients,
  };
}
