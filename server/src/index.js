import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp, hashPassword } from './app.js';
import { runDueReminders } from './services.js';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const db = openDb(path.join(dataDir, 'clinic.db'));
if (!db.prepare('SELECT COUNT(*) AS c FROM users').get().c) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    if (ADMIN_PASSWORD.length < 10) { console.error('ADMIN_PASSWORD must be at least 10 characters'); process.exit(1); }
    db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(process.env.ADMIN_NAME || 'Clinic Admin', ADMIN_EMAIL.toLowerCase(), hashPassword(ADMIN_PASSWORD), 'admin');
    console.log(`Created admin account ${ADMIN_EMAIL}`);
  } else {
    console.log('Empty database, loading demo data…');
    seed(db);
  }
}
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production'); process.exit(1);
}
const app = createApp({
  db, uploadDir: path.join(dataDir, 'uploads'), clientDir: path.join(here, '..', '..', 'client', 'dist'),
  trustProxy: process.env.TRUST_PROXY === '1',
});
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`CliniCare API on http://localhost:${port}`));
setInterval(() => { try { runDueReminders(db); } catch (e) { console.error('reminder job failed', e); } }, 60_000);
runDueReminders(db);
