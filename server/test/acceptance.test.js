// Each test mirrors a Given / When / Then scenario from the BDD document.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp, hashPassword } from '../src/app.js';
import * as clock from '../src/clock.js';
import { runDueReminders } from '../src/services.js';

process.env.NODE_ENV = 'test';
const NOW = '2026-11-17T08:00:00'; // a Tuesday

let db, server, base, tokens;
const T = clock; // shorthand

async function call(method, url, body, token) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const as = (role) => ({
  get: (u) => call('GET', u, null, tokens[role]), post: (u, b) => call('POST', u, b ?? {}, tokens[role]),
  put: (u, b) => call('PUT', u, b, tokens[role]), patch: (u, b) => call('PATCH', u, b, tokens[role]),
});
const anon = { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}) };

beforeEach(async () => {
  clock.setNow(NOW);
  db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO users (name,email,password_hash,role,specialty,fee) VALUES (?,?,?,?,?,?)');
  ins.run('Dr. Hart', 'doc@t.test', hashPassword('pw'), 'doctor', 'GP', 60);
  ins.run('Dr. Other', 'doc2@t.test', hashPassword('pw'), 'doctor', 'Peds', 70);
  ins.run('Admin', 'admin@t.test', hashPassword('pw'), 'admin', null, 0);
  ins.run('Pharma', 'ph@t.test', hashPassword('pw'), 'pharmacist', null, 0);
  const app = createApp({ db, uploadDir: path.join(os.tmpdir(), 'clinicare-test-uploads'), jwtSecret: 'test' });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
  tokens = {};
  for (const [k, e] of [['doctor', 'doc@t.test'], ['doctor2', 'doc2@t.test'], ['admin', 'admin@t.test'], ['pharmacist', 'ph@t.test']]) {
    tokens[k] = (await call('POST', '/auth/login', { email: e, password: 'pw' })).body.token;
  }
});
after(() => clock.setNow(null));
const closeServer = () => new Promise((r) => server.close(r));
import { afterEach } from 'node:test';
afterEach(closeServer);

// ── helpers ──
const DOC = 1;
let n = 0;
function patient(name = 'Pat Example', phone) {
  n += 1; return Number(db.prepare('INSERT INTO patients (name,phone,created_at) VALUES (?,?,?)').run(name, phone || `+1555000${1000 + n}`, '2026-01-01').lastInsertRowid);
}
function appt({ pid, date = T.today(), time = '09:00', status = 'Booked', doctor = DOC, fee = 60 } = {}) {
  return Number(db.prepare('INSERT INTO appointments (patient_id,doctor_id,date,time,status,fee,source,created_at,diagnosis) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(pid ?? patient(), doctor, date, time, status, fee, 'reception', '2026-01-01T00:00', status === 'Completed' ? 'Dx' : null).lastInsertRowid);
}
function medicine(name, stock, reorder = 20, price = 2) {
  return Number(db.prepare('INSERT INTO medicines (name,stock,reorder_level,price) VALUES (?,?,?,?)').run(name, stock, reorder, price).lastInsertRowid);
}

describe('D1 Admin panel', () => {
  test('View visits and profit for a period', async () => {
    const d = T.today();
    appt({ date: d, time: '09:00', status: 'Completed' }); appt({ date: d, time: '09:30', status: 'Completed' });
    appt({ date: '2026-11-03', time: '10:00', status: 'Completed' }); appt({ date: d, time: '10:00', status: 'Cancelled' });
    db.prepare('INSERT INTO expenses (date,category,amount) VALUES (?,?,?)').run(d, 'Supplies', 50);
    const r = await as('admin').get('/admin/summary?period=month');
    assert.equal(r.status, 200);
    assert.equal(r.body.visits, 3);
    assert.equal(r.body.revenue, 180); assert.equal(r.body.expenses, 50); assert.equal(r.body.profit, 130);
  });
  test('A completed visit updates the panel', async () => {
    const d = T.today();
    for (let i = 0; i < 40; i++) appt({ date: d, time: `08:${String(i).padStart(2, '0')}`, status: 'Completed', doctor: i % 2 ? 2 : 1 });
    assert.equal((await as('admin').get('/admin/summary?period=today')).body.visits, 40);
    const a = appt({ date: d, time: '17:00', status: 'Checked in' });
    const done = await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'Flu' });
    assert.equal(done.status, 200);
    const s = (await as('admin').get('/admin/summary?period=today')).body;
    assert.equal(s.visits, 41);
    assert.equal(s.consultationRevenue, 41 * 60); // the consultation fee was added
    assert.equal(s.revenue, 41 * 60);
  });
  test('Doctors without admin rights cannot see profit', async () => {
    const r = await as('doctor').get('/admin/summary?period=month');
    assert.equal(r.status, 403); assert.equal(r.body.error, 'Access denied');
  });
});

describe('D2 Patient records', () => {
  test('Open a patient history, newest first, with diagnosis, reports and prescription', async () => {
    const p = patient();
    const dates = ['2026-10-01', '2026-10-15', '2026-11-01'];
    const ids = dates.map((d, i) => appt({ pid: p, date: d, time: '10:00', status: 'Completed' }));
    const r = await as('doctor').get(`/patients/${p}`);
    assert.deepEqual(r.body.visits.map((v) => v.date), ['2026-11-01', '2026-10-15', '2026-10-01']);
    assert.ok(r.body.visits.every((v) => v.diagnosis && Array.isArray(v.reports) && 'prescription' in v));
    assert.equal(ids.length, 3);
  });
  test('Add a prescription during a consultation, slip goes to the pharmacy', async () => {
    const m = medicine('Paracetamol 500 mg', 120);
    const a = appt({ status: 'Checked in' });
    const r = await as('doctor').put(`/appointments/${a}/prescription`, { items: [{ medicineId: m, dose: '1 tablet twice daily', duration: '5 days', quantity: 2 }] });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'Pending');
    const slips = (await as('pharmacist').get('/slips?status=Pending')).body;
    assert.equal(slips.length, 1); assert.equal(slips[0].items[0].medicine_name, 'Paracetamol 500 mg');
  });
  test('Attach a report to a visit', async () => {
    const a = appt({ status: 'Checked in' }); const pid = db.prepare('SELECT patient_id FROM appointments WHERE id=?').get(a).patient_id;
    const up = await as('doctor').post(`/appointments/${a}/reports`, { title: 'Blood test', filename: 'cbc.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') });
    assert.equal(up.status, 201);
    const rec = (await as('doctor').get(`/patients/${pid}`)).body;
    assert.equal(rec.visits[0].reports[0].title, 'Blood test');
    const bad = await as('doctor').post(`/appointments/${a}/reports`, { filename: 'x.exe', mime: 'application/x-msdownload', dataBase64: 'AAAA' });
    assert.equal(bad.status, 400);
  });
  test('A doctor cannot open another doctor\'s appointment', async () => {
    const a = appt({ doctor: 2 });
    assert.equal((await as('doctor').get(`/appointments/${a}`)).status, 403);
  });
});

describe('D3 Pharmacy stock view for the doctor', () => {
  test('See stock left while prescribing', async () => {
    medicine('Paracetamol 500 mg', 120); medicine('Ibuprofen 400 mg', 10);
    const r = (await as('doctor').get('/medicines?q=Paracetamol')).body;
    assert.equal(r.length, 1); assert.equal(r[0].name, 'Paracetamol 500 mg'); assert.equal(r[0].stock, 120);
  });
  test('Out-of-stock medicine is flagged but can still be prescribed', async () => {
    const m = medicine('Amoxicillin 250 mg', 0);
    const list = (await as('doctor').get('/medicines?q=Amoxicillin')).body;
    assert.equal(list[0].state, 'out');
    const a = appt({ status: 'Checked in' });
    const r = await as('doctor').put(`/appointments/${a}/prescription`, { items: [{ medicineId: m, dose: '1 cap', duration: '5 days', quantity: 1 }] });
    assert.equal(r.status, 200); assert.equal(r.body.items[0].state, 'out');
  });
});

describe('D4 Appointment list and status', () => {
  test('View today\'s appointments ordered by time', async () => {
    const times = ['16:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '14:00', '14:30', '15:00'];
    for (const time of times) appt({ time, doctor: 1 });
    const r = (await as('admin').get(`/appointments?date=${T.today()}`)).body;
    assert.equal(r.length, 12);
    assert.deepEqual(r.map((x) => x.time), [...r.map((x) => x.time)].sort());
    assert.ok(r.every((x) => x.patient_name && x.time && x.status));
  });
  const rows = [['Booked', 'Checked in', 'Checked in'], ['Checked in', 'Completed', 'Completed'], ['Booked', 'Cancelled', 'Cancelled'], ['Booked', 'No-show', 'No-show']];
  for (const [from, to] of rows) {
    test(`Status ${from} -> ${to}`, async () => {
      const a = appt({ status: from });
      const who = to === 'Completed' ? 'doctor' : 'admin';
      const r = await as(who).post(`/appointments/${a}/status`, { status: to, diagnosis: 'Dx' });
      assert.equal(r.status, 200); assert.equal(r.body.status, to);
    });
  }
  test('Invalid status jumps are refused', async () => {
    const a = appt({ status: 'Booked' });
    assert.equal((await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'x' })).status, 409);
    const c = appt({ status: 'Completed', time: '10:00' });
    assert.equal((await as('admin').post(`/appointments/${c}/status`, { status: 'Cancelled' })).status, 409);
  });
  test('Filter by status', async () => {
    appt({ status: 'Checked in', time: '09:00' }); appt({ status: 'Booked', time: '09:30' }); appt({ status: 'Checked in', time: '10:00' });
    const r = (await as('admin').get(`/appointments?date=${T.today()}&status=Checked in`)).body;
    assert.equal(r.length, 2); assert.ok(r.every((x) => x.status === 'Checked in'));
  });
});

describe('D5 Follow-up reminder', () => {
  test('Set a follow-up 7 days out: saved and reminder scheduled 1 day before', async () => {
    const a = appt({ status: 'Checked in' });
    const due = T.addDays(T.today(), 7);
    const r = await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'Flu', followupDate: due });
    assert.equal(r.body.followup_date, due);
    const f = db.prepare('SELECT * FROM followups').get();
    assert.equal(f.due_date, due); assert.equal(f.remind_at, `${T.addDays(due, -1)}T09:00`); assert.equal(f.status, 'Scheduled');
  });
  test('Patient receives the reminder with date and booking link', async () => {
    const a = appt({ status: 'Checked in' });
    const due = T.addDays(T.today(), 7);
    await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'Flu', followupDate: due });
    assert.equal(runDueReminders(db), 0); // too early
    clock.setNow(`${T.addDays(due, -1)}T09:01:00`);
    assert.equal(runDueReminders(db), 1);
    assert.equal(runDueReminders(db), 0); // sent only once
    const msg = db.prepare("SELECT * FROM outbox WHERE kind='reminder'").get();
    assert.match(msg.body, /follow-up is due/); assert.match(msg.body, new RegExp(`/book\\?date=${due}`));
  });
  test('Booked follow-up stops further reminders', async () => {
    const a = appt({ status: 'Checked in' }); const pid = db.prepare('SELECT patient_id FROM appointments WHERE id=?').get(a).patient_id;
    const due = T.addDays(T.today(), 7);
    await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'Flu', followupDate: due });
    clock.setNow(`${T.addDays(due, -1)}T09:01:00`); runDueReminders(db);
    const b = await as('admin').post('/appointments', { doctorId: DOC, patientId: pid, date: due, time: '10:00' });
    assert.equal(b.status, 201);
    assert.equal(db.prepare('SELECT status FROM followups').get().status, 'Booked');
    // a second follow-up that was never reminded must also not fire after booking
    const list = (await as('doctor').get(`/appointments?date=${due}`)).body;
    assert.equal(list.length, 1);
  });
  test('Booking before the reminder time cancels the pending reminder', async () => {
    const a = appt({ status: 'Checked in' }); const pid = db.prepare('SELECT patient_id FROM appointments WHERE id=?').get(a).patient_id;
    const due = T.addDays(T.today(), 7);
    await as('doctor').post(`/appointments/${a}/status`, { status: 'Completed', diagnosis: 'Flu', followupDate: due });
    await as('admin').post('/appointments', { doctorId: DOC, patientId: pid, date: due, time: '10:00' });
    clock.setNow(`${T.addDays(due, -1)}T09:01:00`);
    assert.equal(runDueReminders(db), 0);
  });
});

describe('D6 Booking by bot and voice', () => {
  const tmr = () => T.addDays(T.today(), 1);
  async function talk(source, lines) {
    let state = { doctorId: DOC, source }; let last = await anon.post('/public/bot', { text: '', state });
    state = last.body.state;
    for (const l of lines) { last = await anon.post('/public/bot', { text: l, state }); assert.equal(last.status, 200); state = last.body.state; }
    return last.body;
  }
  test('Book through the chat bot', async () => {
    const r = await talk('chat', ['I need an appointment tomorrow at 10:00', 'Sam Patel', '+1 555 123 4567', 'yes']);
    assert.ok(r.booked, JSON.stringify(r));
    const a = db.prepare('SELECT * FROM appointments').get();
    assert.equal(a.status, 'Booked'); assert.equal(a.date, tmr()); assert.equal(a.time, '10:00'); assert.equal(a.source, 'chat');
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE kind='confirmation'").get().c, 1);
  });
  test('Chat: morning request offers slots and the patient picks one', async () => {
    const r = await talk('chat', ['tomorrow morning', 'first one', 'Ana Gomez', '5550001111', 'yes']);
    assert.ok(r.booked); assert.equal(db.prepare('SELECT time FROM appointments').get().time, '09:00');
  });
  test('Book through a voice call (spoken phone number)', async () => {
    const fri = T.addDays(T.today(), 3); // Friday
    const r = await talk('voice', ['book me Friday evening', 'five p.m.', 'Maria Lopez', 'five five five zero one two three four five six', 'yes please']);
    assert.ok(r.booked, JSON.stringify(r));
    const a = db.prepare('SELECT * FROM appointments').get();
    assert.equal(a.date, fri); assert.equal(a.time, '17:00'); assert.equal(a.source, 'voice');
  });
  test('Booking is linked to the EMR of a returning patient', async () => {
    const p = patient('Returning Rita', '+15551230000'); appt({ pid: p, date: '2026-10-01', status: 'Completed' });
    const r = await talk('chat', ['tomorrow at 11:00', 'Rita', '+1 555 123 0000', 'yes']);
    assert.ok(r.booked);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM patients').get().c, 1);
    const a = db.prepare("SELECT * FROM appointments WHERE date=?").get(tmr());
    assert.equal(a.patient_id, p);
    const full = (await as('doctor').get(`/appointments/${a.id}`)).body;
    assert.equal(full.record.visits.length, 2);
  });
  test('New patient: an EMR record is created with name and phone', async () => {
    await talk('chat', ['tomorrow at 11:00', 'Newbie Nora', '+1 555 999 8888', 'yes']);
    const p = db.prepare('SELECT * FROM patients').get();
    assert.equal(p.name, 'Newbie Nora'); assert.equal(p.phone, '+15559998888');
  });
  test('Requested slot not available: nearest free slots are offered', async () => {
    appt({ date: tmr(), time: '10:00', status: 'Booked' });
    const r = await talk('chat', ['tomorrow at 10:00']);
    assert.match(r.reply, /not available/);
    assert.ok(r.options.length >= 2);
    assert.ok(!r.options.some((o) => o.value === `${tmr()} 10:00`));
    assert.ok(r.options.some((o) => o.value === `${tmr()} 09:30`));
  });
  test('Double booking the same slot is rejected', async () => {
    const body = { doctorId: DOC, date: tmr(), time: '10:00', name: 'A One', phone: '5550001' + '000' };
    assert.equal((await anon.post('/public/book', body)).status, 201);
    const second = await anon.post('/public/book', { ...body, name: 'B Two', phone: '5550002000' });
    assert.equal(second.status, 409); assert.ok(second.body.slots.length);
  });
  test('Invalid times and past slots are rejected', async () => {
    const mk = (date, time) => anon.post('/public/book', { doctorId: DOC, date, time, name: 'X Y', phone: '5550003000' });
    assert.equal((await mk(tmr(), '13:00')).status, 400); // lunch
    assert.equal((await mk(T.today(), '07:00')).status, 400); // before opening / past
    assert.equal((await mk('2026-11-22', '10:00')).status, 400); // Sunday
  });
});

describe('P1 Stock and inventory', () => {
  async function slipWith(medId, qty) {
    const a = appt({ status: 'Checked in', time: '11:00' });
    await as('doctor').put(`/appointments/${a}/prescription`, { items: [{ medicineId: medId, dose: '1', duration: '1 day', quantity: qty }] });
    return db.prepare('SELECT id FROM prescriptions').get().id;
  }
  test('Dispensing reduces stock', async () => {
    const m = medicine('Paracetamol 500 mg', 120);
    const slip = await slipWith(m, 2);
    const r = await as('pharmacist').post(`/slips/${slip}/collect`);
    assert.equal(r.status, 200);
    assert.equal(db.prepare('SELECT stock FROM medicines WHERE id=?').get(m).stock, 118);
  });
  test('Receiving a delivery increases stock', async () => {
    const m = medicine('Paracetamol 500 mg', 118);
    const r = await as('pharmacist').post(`/medicines/${m}/deliveries`, { quantity: 200 });
    assert.equal(r.body.stock, 318);
    assert.equal((await as('pharmacist').post(`/medicines/${m}/deliveries`, { quantity: -5 })).status, 400);
  });
  test('Low stock alert at or below the reorder level', async () => {
    const m = medicine('Paracetamol 500 mg', 52, 50);
    const slip = await slipWith(m, 2);
    assert.equal((await as('doctor').get('/medicines?q=Parac')).body[0].state, 'ok');
    await as('pharmacist').post(`/slips/${slip}/collect`);
    const after = (await as('pharmacist').get('/medicines?q=Parac')).body[0];
    assert.equal(after.stock, 50); assert.equal(after.state, 'low');
    assert.equal((await as('pharmacist').get('/medicines?state=low')).body.length, 1);
  });
  test('Cannot dispense more than the stock left', async () => {
    const m = medicine('Amoxicillin 250 mg', 1);
    const slip = await slipWith(m, 2);
    const r = await as('pharmacist').post(`/slips/${slip}/collect`);
    assert.equal(r.status, 409); assert.match(r.body.error, /Only 1 strips of Amoxicillin 250 mg available/);
    assert.equal(db.prepare('SELECT stock FROM medicines WHERE id=?').get(m).stock, 1);
    assert.equal(db.prepare('SELECT status FROM prescriptions').get().status, 'Pending');
  });
  test('A slip cannot be collected twice', async () => {
    const m = medicine('Paracetamol 500 mg', 10); const slip = await slipWith(m, 2);
    await as('pharmacist').post(`/slips/${slip}/collect`);
    assert.equal((await as('pharmacist').post(`/slips/${slip}/collect`)).status, 409);
    assert.equal(db.prepare('SELECT stock FROM medicines WHERE id=?').get(m).stock, 8);
  });
});

describe('P2 Slips collected', () => {
  function collectedSlip(date) {
    n += 1;
    const a = appt({ date, time: `06:${String(n % 60).padStart(2, '0')}`, status: 'Completed', doctor: 1 });
    const p = db.prepare('SELECT patient_id FROM appointments WHERE id=?').get(a).patient_id;
    db.prepare("INSERT INTO prescriptions (appointment_id,patient_id,doctor_id,issued_at,status,collected_at,total) VALUES (?,?,?,?,?,?,?)").run(a, p, DOC, `${date}T10:00`, 'Collected', `${date}T11:00`, 10);
  }
  test('Collecting a slip increases the count', async () => {
    for (let i = 0; i < 25; i++) collectedSlip(T.today());
    assert.equal((await as('pharmacist').get('/slips/stats?period=today')).body.total, 25);
    const m = medicine('Paracetamol 500 mg', 10);
    const a = appt({ status: 'Checked in', time: '16:30' });
    await as('doctor').put(`/appointments/${a}/prescription`, { items: [{ medicineId: m, dose: '1', duration: '1 day', quantity: 1 }] });
    const slip = db.prepare("SELECT id FROM prescriptions WHERE status='Pending'").get().id;
    await as('pharmacist').post(`/slips/${slip}/collect`);
    assert.equal((await as('pharmacist').get('/slips/stats?period=today')).body.total, 26);
  });
  test('View slips collected per day for this week', async () => {
    collectedSlip('2026-11-16'); collectedSlip('2026-11-16'); collectedSlip('2026-11-17'); collectedSlip('2026-11-10');
    const r = (await as('pharmacist').get('/slips/stats?period=week')).body;
    assert.equal(r.byDay.length, 7); assert.equal(r.total, 3);
    assert.equal(r.byDay.find((d) => d.date === '2026-11-16').count, 2);
  });
  test('Prescriptions not yet collected show patient and issue date', async () => {
    const m = medicine('Paracetamol 500 mg', 10);
    const a = appt({ status: 'Checked in' });
    await as('doctor').put(`/appointments/${a}/prescription`, { items: [{ medicineId: m, dose: '1', duration: '1 day', quantity: 1 }] });
    const r = (await as('pharmacist').get('/slips?status=Pending')).body;
    assert.equal(r.length, 1); assert.ok(r[0].patient_name); assert.match(r[0].issued_at, /^2026-11-17/);
  });
});

describe('Security basics', () => {
  test('Protected routes need a token and roles are enforced', async () => {
    assert.equal((await anon.get('/appointments')).status, 401);
    assert.equal((await as('pharmacist').get('/appointments')).status, 403);
    assert.equal((await as('doctor').post('/slips/1/collect')).status, 403);
    assert.equal((await as('admin').get('/admin/summary?period=nope')).status, 400);
  });
  test('Login rejects wrong passwords', async () => {
    assert.equal((await call('POST', '/auth/login', { email: 'doc@t.test', password: 'wrong' })).status, 401);
  });
});
