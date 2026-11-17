import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','pharmacist')),
  specialty TEXT, fee REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT,
  dob TEXT, gender TEXT, address TEXT, allergies TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL, time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Booked' CHECK (status IN ('Booked','Checked in','Completed','Cancelled','No-show')),
  fee REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'reception',
  reason TEXT, diagnosis TEXT, notes TEXT, followup_date TEXT,
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_slot ON appointments(doctor_id, date, time)
  WHERE status IN ('Booked','Checked in','Completed');
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date, status);
CREATE INDEX IF NOT EXISTS ix_appt_patient ON appointments(patient_id);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  title TEXT NOT NULL, filename TEXT NOT NULL, stored_as TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, unit TEXT NOT NULL DEFAULT 'strips',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0), reorder_level INTEGER NOT NULL DEFAULT 20,
  price REAL NOT NULL DEFAULT 0, expiry_date TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Collected')),
  collected_at TEXT, total REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  dose TEXT NOT NULL, duration TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  delta INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0), note TEXT
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  due_date TEXT NOT NULL, remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Reminded','Booked','Cancelled')),
  booked_appointment_id INTEGER, reminded_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, patient_id INTEGER REFERENCES patients(id), channel TEXT NOT NULL,
  to_phone TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
}
