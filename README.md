# CliniCare – Clinic & Pharmacy Platform

Implements the eight services from the *Flow and BDD* document (D1–D6, P1–P2, plus a proposed P3).

## Run it

```bash
npm run setup      # installs root, server and client dependencies (once)
npm run seed       # loads demo data (resets the database)
npm run dev        # API on :3001, web app on http://localhost:5173
npm test           # 38 acceptance tests, one per BDD scenario
```

Production: `npm run build`, then `NODE_ENV=production JWT_SECRET=<long random string> npm start`
(serves the API and the built web app on one port, default 3001). Requires Node 22.13+.

| Role | Login | Password | Sees |
|---|---|---|---|
| Clinic admin | admin@clinic.test | admin123 | D1, D4 |
| Doctor | doctor@clinic.test | doctor123 | D2–D5 |
| Pharmacist | pharmacy@clinic.test | pharmacy123 | P1–P3 |
| Patient | – | – | `/book` (chat or voice, D6) |

**Change or delete the demo accounts before going live.**

## Stack

React 19 + Vite + Tailwind CSS 4 (web) · Node.js + Express 5 (API) · SQLite via `node:sqlite` · Zod validation · JWT + scrypt auth · `node:test` acceptance tests.

## Decisions taken on the open points (all easy to change)

| Point | What is built |
|---|---|
| P3 | Expiry tracking: expiry date per medicine, "Expiring soon" / "Expired" flags |
| D1 profit | Revenue = consultation fees of completed visits + pharmacy sales; minus recorded expenses |
| D6 voice | Voice booking in the browser (speech recognition + speech synthesis). Dictating notes is not included |
| D6 channels | Website chat and voice. WhatsApp / phone line need a provider (Twilio, Meta) and plug into the same `/api/public/bot` |
| D5 | SMS-style message, 1 day before at 09:00. Messages are written to a log; connect a provider in `sendMessage` (`server/src/services.js`) |
| D4 | The five statuses as written, with enforced transitions |
| P1 | Pharmacist sets the reorder level per medicine. Low stock is also shown to the doctor |

## Layout

```
server/src   app.js (routes, auth) · services.js (business rules) · bot.js (booking assistant) · db.js · seed.js
server/test  acceptance.test.js
client/src   pages/ · ui.jsx · charts.jsx · api.js
```

## Deploy on Render

1. Push this repo to GitHub, then in Render choose **New + > Blueprint** and select it (`render.yaml` is picked up).
2. Fill in `PUBLIC_URL` (your final address), `ADMIN_EMAIL` and `ADMIN_PASSWORD` (10+ characters).
3. First start creates that admin account only (no demo data). Note: there is no staff-management screen yet, so doctor and pharmacist accounts cannot be added from the UI until that is built.
4. Add your subdomain under **Settings > Custom Domains** and create the CNAME Render shows you.

The persistent disk at `/var/data` holds the database and uploaded reports; it requires a paid instance. Back it up with Render disk snapshots.
Leave `ADMIN_EMAIL` unset to load demo data instead (testing only). Do not run `npm run seed` on a live server, it wipes the database.
