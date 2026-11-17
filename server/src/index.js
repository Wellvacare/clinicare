import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { runDueReminders } from './services.js';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const db = openDb(path.join(dataDir, 'clinic.db'));
if (!db.prepare('SELECT COUNT(*) AS c FROM users').get().c) {
  console.log('Empty database, loading demo data…');
  seed(db);
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
