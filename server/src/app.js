import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as clock from './clock.js';
import * as S from './services.js';
import { botTurn } from './bot.js';

const { HttpError } = S;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'); const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const id = z.coerce.number().int().positive();
const dateStr = z.string().refine(clock.isDate, 'Invalid date');
const timeStr = z.string().refine(clock.isTime, 'Invalid time');
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));
  return r.data;
};

function rangeFromQuery(q) {
  if (q.from && q.to) {
    parse(z.object({ from: dateStr, to: dateStr }), q);
    if (q.from > q.to) throw new HttpError(400, 'Start date must not be after end date');
    if (clock.dateRange(q.from, q.to).length > 400) throw new HttpError(400, 'Please choose a range of at most 400 days');
    return { from: q.from, to: q.to };
  }
  const r = clock.periodRange(q.period || 'today', q.date || clock.today());
  if (!r) throw new HttpError(400, 'Unknown period');
  return r;
}

export function createApp({ db, uploadDir, jwtSecret = process.env.JWT_SECRET || 'dev-only-secret-change-me', clientDir, trustProxy = false }) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], frameSrc: ["'self'", 'blob:'], objectSrc: ["'self'", 'blob:'] } } }));
  app.use(express.json({ limit: '12mb' }));

  const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests, please try again shortly' }) });

  const auth = (req, _res, next) => {
    const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return next(new HttpError(401, 'Please sign in'));
    try {
      const p = jwt.verify(token, jwtSecret);
      const user = db.prepare('SELECT id,name,email,role,specialty,fee FROM users WHERE id=? AND active=1').get(p.id);
      if (!user) return next(new HttpError(401, 'Please sign in again'));
      req.user = user; next();
    } catch { next(new HttpError(401, 'Your session has expired, please sign in again')); }
  };
  const role = (...roles) => (req, _res, next) => (roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Access denied')));
  const api = express.Router();
  app.use('/api', api);

  // ── auth ──
  api.post('/auth/login', limiter(15 * 60_000, 30), wrap((req, res) => {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase());
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
    const token = jwt.sign({ id: u.id, role: u.role }, jwtSecret, { expiresIn: '12h' });
    res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role, specialty: u.specialty } });
  }));
  api.get('/auth/me', auth, (req, res) => res.json({ user: req.user }));
  api.get('/meta', (_req, res) => res.json({ clinicName: S.CONFIG.clinicName, statuses: S.STATUSES, today: clock.today() }));

  // ── public: doctors, slots, booking, bot ──
  const pub = express.Router();
  api.use('/public', limiter(60_000, 120), pub);
  pub.get('/doctors', (_req, res) => res.json(db.prepare("SELECT id,name,specialty,fee FROM users WHERE role='doctor' AND active=1 ORDER BY name").all()));
  pub.get('/slots', wrap((req, res) => {
    const q = parse(z.object({ doctorId: id, date: dateStr }), req.query);
    S.getDoctor(db, q.doctorId);
    res.json({ date: q.date, slots: S.freeSlots(db, q.doctorId, q.date) });
  }));
  const bookSchema = z.object({ doctorId: id, date: dateStr, time: timeStr, name: z.string().trim().min(2).max(80), phone: z.string().max(25), reason: z.string().max(300).optional() });
  pub.post('/book', limiter(60_000, 20), wrap((req, res) => {
    const b = parse(bookSchema, req.body);
    const a = S.bookAppointment(db, { ...b, source: 'web' });
    res.status(201).json({ id: a.id, date: a.date, time: a.time, doctor: a.doctor_name, patient: a.patient_name });
  }));
  pub.post('/bot', limiter(60_000, 60), wrap((req, res) => {
    const b = parse(z.object({ text: z.string().max(400).default(''), state: z.record(z.string(), z.any()).optional() }), req.body);
    if (b.state && typeof b.state.doctorId !== 'undefined') b.state.doctorId = Number(b.state.doctorId);
    res.json(botTurn(db, b));
  }));

  // ── everything below needs a signed-in user ──
  api.use(auth);

  // admin panel (D1)
  api.get('/admin/summary', role('admin'), wrap((req, res) => res.json(S.summary(db, rangeFromQuery(req.query)))));
  api.get('/admin/expenses', role('admin'), wrap((req, res) => {
    const r = rangeFromQuery(req.query);
    res.json(db.prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC').all(r.from, r.to));
  }));
  api.post('/admin/expenses', role('admin'), wrap((req, res) => {
    const b = parse(z.object({ date: dateStr, category: z.string().trim().min(2).max(40), amount: z.number().min(0).max(10_000_000), note: z.string().max(200).optional() }), req.body);
    const r = db.prepare('INSERT INTO expenses (date, category, amount, note) VALUES (?,?,?,?)').run(b.date, b.category, b.amount, b.note || null);
    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id=?').get(r.lastInsertRowid));
  }));
  api.delete('/admin/expenses/:id', role('admin'), wrap((req, res) => {
    db.prepare('DELETE FROM expenses WHERE id=?').run(parse(id, req.params.id)); res.status(204).end();
  }));

  // appointments (D4)
  api.get('/doctors', role('admin', 'doctor'), (_req, res) => res.json(db.prepare("SELECT id,name,specialty,fee FROM users WHERE role='doctor' AND active=1 ORDER BY name").all()));
  api.get('/appointments', role('admin', 'doctor'), wrap((req, res) => {
    const q = parse(z.object({ date: dateStr.optional(), from: dateStr.optional(), to: dateStr.optional(), status: z.enum(S.STATUSES).optional(), q: z.string().max(60).optional(), doctorId: id.optional(), patientId: id.optional() }), req.query);
    if (req.user.role === 'doctor') q.doctorId = req.user.id;
    res.json(S.listAppointments(db, q));
  }));
  api.post('/appointments', role('admin', 'doctor'), wrap((req, res) => {
    const b = parse(z.object({ doctorId: id.optional(), patientId: id.optional(), name: z.string().max(80).optional(), phone: z.string().max(25).optional(), date: dateStr, time: timeStr, reason: z.string().max(300).optional() }), req.body);
    const doctorId = req.user.role === 'doctor' ? req.user.id : b.doctorId;
    if (!doctorId) throw new HttpError(400, 'Choose a doctor');
    res.status(201).json(S.bookAppointment(db, { ...b, doctorId, source: 'reception' }));
  }));
  api.get('/slots', role('admin', 'doctor'), wrap((req, res) => {
    const q = parse(z.object({ doctorId: id, date: dateStr }), req.query);
    res.json({ date: q.date, slots: S.freeSlots(db, q.doctorId, q.date) });
  }));
  const ownAppt = (req) => {
    const a = S.getAppointment(db, parse(id, req.params.id));
    if (req.user.role === 'doctor' && a.doctor_id !== req.user.id) throw new HttpError(403, 'This appointment belongs to another doctor');
    return a;
  };
  api.get('/appointments/:id', role('admin', 'doctor'), wrap((req, res) => {
    const a = ownAppt(req);
    res.json({ ...a, reports: S.reportsFor(db, a.id), prescription: S.prescriptionFor(db, a.id), record: S.patientRecord(db, a.patient_id) });
  }));
  api.post('/appointments/:id/status', role('admin', 'doctor'), wrap((req, res) => {
    const a = ownAppt(req);
    const b = parse(z.object({ status: z.enum(S.STATUSES), diagnosis: z.string().max(2000).optional(), notes: z.string().max(5000).optional(), followupDate: z.string().nullable().optional() }), req.body);
    if (b.status === 'Completed' && req.user.role !== 'doctor') throw new HttpError(403, 'Only the doctor can end a consultation');
    if (b.followupDate) parse(dateStr, b.followupDate);
    res.json(S.changeStatus(db, a.id, b.status, b));
  }));
  api.patch('/appointments/:id/consultation', role('doctor'), wrap((req, res) => {
    const a = ownAppt(req);
    const b = parse(z.object({ diagnosis: z.string().max(2000).optional(), notes: z.string().max(5000).optional(), followupDate: z.string().nullable().optional() }), req.body);
    if (b.followupDate) parse(dateStr, b.followupDate);
    res.json(S.saveConsultation(db, a.id, b));
  }));
  api.put('/appointments/:id/prescription', role('doctor'), wrap((req, res) => {
    const a = ownAppt(req);
    const b = parse(z.object({ items: z.array(z.object({ medicineId: id, dose: z.string().trim().min(1).max(80), duration: z.string().trim().min(1).max(60), quantity: z.number().int().min(1).max(10000) })).max(30) }), req.body);
    res.json(S.savePrescription(db, a.id, b.items, req.user.id));
  }));
  api.post('/appointments/:id/reports', role('doctor'), wrap((req, res) => {
    const a = ownAppt(req);
    const b = parse(z.object({ title: z.string().max(120).optional(), filename: z.string().max(200), mime: z.string(), dataBase64: z.string() }), req.body);
    res.status(201).json(S.addReport(db, uploadDir, a.id, b));
  }));
  api.get('/reports/:id/file', role('admin', 'doctor'), wrap((req, res) => {
    const r = db.prepare('SELECT r.*, a.doctor_id FROM reports r JOIN appointments a ON a.id=r.appointment_id WHERE r.id=?').get(parse(id, req.params.id));
    if (!r) throw new HttpError(404, 'Report not found');
    const file = path.join(uploadDir, path.basename(r.stored_as));
    if (!fs.existsSync(file)) throw new HttpError(404, 'File missing');
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `inline; filename="${r.filename.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
  }));

  // patients / EMR (D2)
  api.get('/patients', role('admin', 'doctor'), wrap((req, res) => {
    const q = String(req.query.q || '').slice(0, 60);
    res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM appointments WHERE patient_id=p.id AND status='Completed') AS visits,
      (SELECT MAX(date) FROM appointments WHERE patient_id=p.id AND status='Completed') AS last_visit
      FROM patients p WHERE p.name LIKE ? OR p.phone LIKE ? ORDER BY p.name LIMIT 300`).all(`%${q}%`, `%${q}%`));
  }));
  api.get('/patients/:id', role('admin', 'doctor'), wrap((req, res) => res.json(S.patientRecord(db, parse(id, req.params.id)))));
  api.patch('/patients/:id', role('admin', 'doctor'), wrap((req, res) => {
    const pid = parse(id, req.params.id);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().email().or(z.literal('')).optional(), dob: dateStr.or(z.literal('')).optional(), gender: z.enum(['Female', 'Male', 'Other', '']).optional(), allergies: z.string().max(300).optional(), address: z.string().max(300).optional() }), req.body);
    const cur = S.patientRecord(db, pid).patient;
    const m = { ...cur, ...b };
    db.prepare('UPDATE patients SET name=?, email=?, dob=?, gender=?, allergies=?, address=? WHERE id=?').run(m.name, m.email || null, m.dob || null, m.gender || null, m.allergies || null, m.address || null, pid);
    res.json(S.patientRecord(db, pid).patient);
  }));

  // medicines (D3, P1)
  api.get('/medicines', role('admin', 'doctor', 'pharmacist'), wrap((req, res) => res.json(S.listMedicines(db, { q: String(req.query.q || ''), state: req.query.state }))));
  api.post('/medicines', role('pharmacist', 'admin'), wrap((req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), unit: z.string().trim().min(1).max(20).default('strips'), stock: z.number().int().min(0).default(0), reorderLevel: z.number().int().min(0).default(20), price: z.number().min(0).default(0), expiryDate: dateStr.nullable().optional() }), req.body);
    try {
      const r = db.prepare('INSERT INTO medicines (name, unit, stock, reorder_level, price, expiry_date) VALUES (?,?,?,?,?,?)').run(b.name, b.unit, b.stock, b.reorderLevel, b.price, b.expiryDate || null);
      if (b.stock) db.prepare('INSERT INTO stock_movements (medicine_id, delta, reason, created_at) VALUES (?,?,?,?)').run(r.lastInsertRowid, b.stock, 'opening stock', `${clock.today()}T${clock.nowTime()}`);
      res.status(201).json(S.listMedicines(db, { q: b.name }).find((m) => m.id === Number(r.lastInsertRowid)));
    } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'A medicine with this name already exists'); throw e; }
  }));
  api.patch('/medicines/:id', role('pharmacist', 'admin'), wrap((req, res) => {
    const mid = parse(id, req.params.id);
    const b = parse(z.object({ reorderLevel: z.number().int().min(0).optional(), price: z.number().min(0).optional(), expiryDate: dateStr.nullable().optional() }), req.body);
    const m = db.prepare('SELECT * FROM medicines WHERE id=?').get(mid);
    if (!m) throw new HttpError(404, 'Medicine not found');
    db.prepare('UPDATE medicines SET reorder_level=?, price=?, expiry_date=? WHERE id=?').run(b.reorderLevel ?? m.reorder_level, b.price ?? m.price, b.expiryDate === undefined ? m.expiry_date : b.expiryDate, mid);
    res.json(S.listMedicines(db, { q: m.name }).find((x) => x.id === mid));
  }));
  api.post('/medicines/:id/deliveries', role('pharmacist', 'admin'), wrap((req, res) => {
    const b = parse(z.object({ quantity: z.number() }), req.body);
    res.status(201).json(S.receiveDelivery(db, parse(id, req.params.id), b.quantity));
  }));
  api.get('/medicines/:id/movements', role('pharmacist', 'admin'), wrap((req, res) =>
    res.json(db.prepare('SELECT * FROM stock_movements WHERE medicine_id=? ORDER BY id DESC LIMIT 50').all(parse(id, req.params.id)))));

  // slips (P2)
  api.get('/slips', role('admin', 'doctor', 'pharmacist'), wrap((req, res) => {
    const q = parse(z.object({ status: z.enum(['Pending', 'Collected']).optional(), from: dateStr.optional(), to: dateStr.optional(), q: z.string().max(60).optional() }), req.query);
    res.json(S.listSlips(db, q));
  }));
  api.get('/slips/stats', role('admin', 'pharmacist'), wrap((req, res) => res.json(S.slipStats(db, rangeFromQuery(req.query)))));
  api.post('/slips/:id/collect', role('pharmacist'), wrap((req, res) => res.json(S.collectSlip(db, parse(id, req.params.id)))));

  // notifications / follow-ups (D5)
  api.get('/outbox', role('admin', 'doctor'), (_req, res) => res.json(db.prepare('SELECT o.*, p.name AS patient_name FROM outbox o LEFT JOIN patients p ON p.id=o.patient_id ORDER BY o.id DESC LIMIT 200').all()));
  api.get('/followups', role('admin', 'doctor'), (_req, res) => res.json(S.listFollowups(db)));
  api.post('/followups/run', role('admin'), (_req, res) => res.json({ sent: S.runDueReminders(db) }));

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  api.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large' });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }
  return app;
}
