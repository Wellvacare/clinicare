import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './app.js';
import * as clock from './clock.js';
import { daySlots, prescriptionFor } from './services.js';

export const DEMO_USERS = [
  { name: 'Dr. Amelia Hart', email: 'doctor@clinic.test', password: 'doctor123', role: 'doctor', specialty: 'General Physician', fee: 60 },
  { name: 'Dr. Rahul Mehta', email: 'doctor2@clinic.test', password: 'doctor123', role: 'doctor', specialty: 'Pediatrician', fee: 75 },
  { name: 'Clara Admin', email: 'admin@clinic.test', password: 'admin123', role: 'admin' },
  { name: 'Peter Pharmacist', email: 'pharmacy@clinic.test', password: 'pharmacy123', role: 'pharmacist' },
];

const MEDS = [
  ['Paracetamol 500 mg', 'strips', 120, 50, 1.5], ['Amoxicillin 250 mg', 'strips', 0, 30, 4.2], ['Ibuprofen 400 mg', 'strips', 85, 40, 2.1],
  ['Cetirizine 10 mg', 'strips', 64, 30, 1.8], ['Omeprazole 20 mg', 'strips', 22, 30, 3.4], ['Azithromycin 500 mg', 'strips', 40, 20, 6.5],
  ['Metformin 500 mg', 'strips', 150, 60, 2.8], ['Amlodipine 5 mg', 'strips', 90, 40, 3.1], ['Atorvastatin 10 mg', 'strips', 48, 40, 4.4],
  ['Salbutamol Inhaler', 'units', 18, 10, 7.9], ['ORS Sachets', 'sachets', 200, 80, 0.6], ['Vitamin D3 60k', 'capsules', 75, 30, 2.5],
  ['Loratadine 10 mg', 'strips', 12, 25, 1.9], ['Cough Syrup 100 ml', 'bottles', 35, 15, 3.8], ['Diclofenac Gel 30 g', 'tubes', 28, 12, 4.9],
  ['Pantoprazole 40 mg', 'strips', 56, 30, 3.6], ['Dolo 650', 'strips', 110, 50, 1.7], ['Zinc 50 mg', 'strips', 8, 20, 1.2],
];
const NAMES = ['Olivia Brown', 'Liam Johnson', 'Emma Davis', 'Noah Wilson', 'Ava Martinez', 'Ethan Clark', 'Sophia Lewis', 'Mason Walker', 'Isabella Hall',
  'Lucas Young', 'Mia King', 'Henry Wright', 'Amelia Scott', 'Jack Green', 'Harper Adams', 'Daniel Baker', 'Ella Nelson', 'Owen Carter', 'Grace Mitchell',
  'Leo Perez', 'Chloe Roberts', 'Samuel Turner', 'Zoe Phillips', 'Aarav Sharma', 'Priya Nair', 'Vikram Rao', 'Sara Khan', 'Omar Hassan'];
const DIAGNOSES = ['Viral fever', 'Seasonal allergy', 'Acid reflux', 'Hypertension review', 'Type 2 diabetes review', 'Upper respiratory infection', 'Muscle strain',
  'Migraine', 'Skin rash', 'Routine check-up', 'Gastroenteritis', 'Vitamin D deficiency'];
const REASONS = ['Fever and cough', 'Follow-up', 'Headache', 'Stomach pain', 'Check-up', 'Skin issue', 'Back pain', 'Allergy symptoms'];

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function seed(db) {
  const rand = rng(42); const pick = (a) => a[Math.floor(rand() * a.length)];
  const today = clock.today(); const stamp = (d, t) => `${d}T${t}`;
  db.tx(() => {
    for (const u of DEMO_USERS) {
      db.prepare('INSERT INTO users (name,email,password_hash,role,specialty,fee) VALUES (?,?,?,?,?,?)').run(u.name, u.email, hashPassword(u.password), u.role, u.specialty ?? null, u.fee ?? 0);
    }
    const doctors = db.prepare("SELECT id, fee FROM users WHERE role='doctor'").all();
    const exp = new Date(); const expiry = (months) => { const d = new Date(exp); d.setMonth(d.getMonth() + months); return clock.fmtDate(d); };
    MEDS.forEach(([name, unit, stock, reorder, price], i) => {
      const r = db.prepare('INSERT INTO medicines (name,unit,stock,reorder_level,price,expiry_date) VALUES (?,?,?,?,?,?)').run(name, unit, stock, reorder, price, expiry(i === 4 ? 1 : 6 + (i % 14)));
      db.prepare('INSERT INTO stock_movements (medicine_id,delta,reason,created_at) VALUES (?,?,?,?)').run(r.lastInsertRowid, stock, 'opening stock', stamp(clock.addDays(today, -40), '09:00'));
    });
    const medIds = db.prepare('SELECT id, price FROM medicines').all();
    const patientIds = NAMES.map((n, i) => db.prepare('INSERT INTO patients (name,phone,email,gender,dob,created_at) VALUES (?,?,?,?,?,?)')
      .run(n, `+1555010${String(100 + i)}`, `${n.split(' ')[0].toLowerCase()}@example.com`, i % 2 ? 'Male' : 'Female', `${1960 + Math.floor(rand() * 45)}-0${1 + (i % 9)}-1${i % 9}`, clock.addDays(today, -Math.floor(rand() * 90))).lastInsertRowid);

    const insAppt = db.prepare('INSERT INTO appointments (patient_id,doctor_id,date,time,status,fee,source,reason,diagnosis,notes,followup_date,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insRx = db.prepare('INSERT INTO prescriptions (appointment_id,patient_id,doctor_id,issued_at,status,collected_at,total) VALUES (?,?,?,?,?,?,?)');
    const insItem = db.prepare('INSERT INTO prescription_items (prescription_id,medicine_id,dose,duration,quantity,unit_price) VALUES (?,?,?,?,?,?)');
    const doses = ['1 tablet twice daily', '1 tablet once daily', '1 tablet after meals', '2 puffs when needed'];
    const durs = ['3 days', '5 days', '7 days', '14 days'];

    const makeRx = (apptId, pid, did, date, collect) => {
      const n = 1 + Math.floor(rand() * 2); const chosen = new Set(); let total = 0;
      while (chosen.size < n) chosen.add(pick(medIds));
      const rx = insRx.run(apptId, pid, did, stamp(date, '11:00'), collect ? 'Collected' : 'Pending', collect ? stamp(date, '12:15') : null, 0).lastInsertRowid;
      for (const m of chosen) { const q = 1 + Math.floor(rand() * 3); insItem.run(rx, m.id, pick(doses), pick(durs), q, collect ? m.price : null); total += q * m.price; }
      if (collect) db.prepare('UPDATE prescriptions SET total=? WHERE id=?').run(Math.round(total * 100) / 100, rx);
    };

    // 30 days of history
    for (let back = 30; back >= 1; back--) {
      const date = clock.addDays(today, -back);
      for (const doc of doctors) {
        const slots = daySlots(date); if (!slots.length) continue;
        const count = 3 + Math.floor(rand() * 4);
        const used = new Set();
        for (let k = 0; k < count; k++) {
          const t = pick(slots); if (used.has(t)) continue; used.add(t);
          const pid = pick(patientIds); const roll = rand();
          const status = roll < 0.82 ? 'Completed' : roll < 0.92 ? 'Cancelled' : 'No-show';
          const dx = status === 'Completed' ? pick(DIAGNOSES) : null;
          const fu = status === 'Completed' && rand() < 0.25 ? clock.addDays(date, 7) : null;
          const id = insAppt.run(pid, doc.id, date, t, status, doc.fee, pick(['chat', 'voice', 'reception', 'web']), pick(REASONS), dx, dx ? 'Advised rest and fluids.' : null, fu, stamp(clock.addDays(date, -2), '10:00'), status === 'Completed' ? stamp(date, t) : null).lastInsertRowid;
          if (status === 'Completed' && rand() < 0.7) makeRx(id, pid, doc.id, date, rand() < 0.9);
        }
      }
      if (rand() < 0.5) db.prepare('INSERT INTO expenses (date,category,amount,note) VALUES (?,?,?,?)').run(date, pick(['Supplies', 'Utilities', 'Equipment', 'Cleaning']), Math.round(20 + rand() * 120), null);
    }
    for (const [cat, amt, note] of [['Rent', 1500, 'Monthly rent'], ['Salaries', 3200, 'Staff payroll'], ['Utilities', 240, 'Electricity and internet']]) {
      db.prepare('INSERT INTO expenses (date,category,amount,note) VALUES (?,?,?,?)').run(today.slice(0, 8) + '01', cat, amt, note);
    }

    // Today: 12 appointments across both doctors
    const slots = daySlots(today); const todayStatuses = ['Completed', 'Completed', 'Completed', 'Completed', 'Checked in', 'Checked in', 'Cancelled', 'No-show', 'Booked', 'Booked', 'Booked', 'Booked'];
    const day = clock.weekday(today) === 0 ? clock.addDays(today, 1) : today;
    const daySl = daySlots(day);
    todayStatuses.forEach((status, i) => {
      const doc = doctors[i % 2]; const t = daySl[Math.floor(i / 2) * 2 % daySl.length];
      const pid = patientIds[(i * 3) % patientIds.length];
      const id = insAppt.run(pid, doc.id, day, t, status, doc.fee, pick(['chat', 'voice', 'reception']), pick(REASONS), status === 'Completed' ? pick(DIAGNOSES) : null, null, null, stamp(today, '07:30'), status === 'Completed' ? stamp(day, t) : null).lastInsertRowid;
      if (status === 'Completed') makeRx(id, pid, doc.id, day, i % 2 === 0);
    });
    // Tomorrow
    const tmr = clock.addDays(day, 1);
    daySlots(tmr).slice(2, 6).forEach((t, i) => insAppt.run(patientIds[10 + i], doctors[i % 2].id, tmr, t, 'Booked', doctors[i % 2].fee, 'chat', pick(REASONS), null, null, null, stamp(today, '08:00'), null));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(process.env.DATA_DIR || path.join(here, '..', 'data'), 'clinic.db');
  if (process.argv.includes('--reset')) for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  const db = openDb(file);
  seed(db);
  console.log('Demo data loaded.\n' + DEMO_USERS.map((u) => `  ${u.role.padEnd(10)} ${u.email}  /  ${u.password}`).join('\n'));
}
