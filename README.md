# Himnish OBCMS & PICCU Monitoring Dashboard

Full-stack condition-monitoring dashboard for the OBCMS (On-Board Condition Monitoring System) and
PICCU (Passenger Information Coach Computing Unit), built against MDTS:44415 Rev.02.

- **Backend:** Node.js + Express, REST API, JWT auth, role-based + **per-coach access control**
- **Storage:** lowdb (JSON file store) — zero native build dependencies
- **Data source:** **live hardware only.** RUT devices push readings to `/api/ingest/push`
  (see `services/ingestion.js` for the payload contract). There is no simulator or demo
  mode — until a RUT device is registered (Settings > RUT Device Assignment) and starts
  pushing, every coach correctly shows "No Data".
- **Frontend:** Vanilla JS + Chart.js — 10 views, role-and-coach-aware navigation.

## Modules / Pages

| View | What it shows |
|---|---|
| Fleet Overview | KPI cards, Green/Yellow/Orange/Red distribution, coach-wise health table (scoped to the logged-in user's assigned coaches) |
| OBCMS | Per-coach **8-axle** grid — vibration (g) + temperature (°C) per axle; dual-axis trend chart; band = worse of the two parameters |
| PICCU | Integrated sub-systems (PAPIS, WLI, CCTV, WSP, Toilet, FSDS/FDSS, RMPU, EPPFS, ETBU, Battery Charger, Network) + SBC telemetry |
| Health | Fleet-wide 8-axle heatmap per coach, composite health score, worst-performing axles list |
| Prediction | Linear-trend extrapolation per axle — estimated time to next threshold breach (indicative, not a certified predictive algorithm) |
| Analytics | Band distribution, top alert-prone coaches, alert trend — plus **per-coach detailed analysis** (search or dropdown to pick any one coach) |
| Alerts | Alert feed scoped to the user's coaches, with acknowledge workflow |
| Reports | Summary KPIs, CSV export, **PDF export**, **"Send Me a Test Report Now"** button |
| Rake Management | LHB / Vande Bharat rakes, **Add / Edit / Delete Rake**, **Swap Coach** (move any coach to any rake), full swap history log |
| Admin *(Admin role only)* | **Users** (create/edit/delete, email, phone, role, **coach assignment checkboxes**), **Coaches** (create/edit/delete), **Alert Thresholds & Logging** (Yellow/Orange/Red for vibration & temperature + data log interval, one combined form), **Notifications** (daily report time, SMTP config + test-email, SMS config) |

## Per-user coach access control

Every user (except Admin) only ever sees the coaches assigned to them in Admin > Users — across
every page: Fleet Overview, OBCMS, PICCU, Health, Prediction, Analytics, Alerts, Reports, Rake
Management. This is enforced in the API itself (`services/access.js` + `requireCoachAccess`
middleware), not just hidden in the UI — a Viewer's token cannot fetch another coach's data even by
calling the API directly (returns 404, not 403, to avoid confirming the coach exists).

## Roles

| Role | Can do |
|---|---|
| Admin | Everything — sees all coaches, manages users, rakes, coaches, thresholds, notifications |
| Supervisor | Create/edit rakes & coaches, swap coaches, acknowledge alerts — scoped to assigned coaches; cannot manage users, delete rakes/coaches, or change thresholds/notifications |
| Viewer | Read-only, scoped to assigned coaches |

## Alerts & Reports delivery

- **Real-time alert routing:** when a live RUT push raises an
  ORANGE/RED alert for a coach, `services/notify.js` automatically emails (and, if configured,
  SMS's) every non-Admin user who has that coach assigned.
- **Daily report email:** `services/scheduler.js` checks once a minute; at the Admin-configured
  `daily_report_time` it emails every user a PDF report covering only their assigned coaches, once
  per day (tracked via `settings.last_daily_report_date` so it never double-sends).
- **PDF reports** are built with `pdfkit` in `services/pdfReport.js` — real, working PDF generation,
  no external dependency beyond the npm package.
- **Email (SMTP)** uses `nodemailer` in `services/mailer.js` — this **will genuinely send email**
  once valid SMTP credentials are entered in Admin > Notifications (e.g. a company mail relay, a
  Gmail account with an App Password, or a transactional provider's SMTP endpoint like SendGrid).
  Until configured, attempts are logged as "simulated" rather than silently failing.
- **SMS is a pluggable stub**, honestly labelled as such: `services/sms.js` has the config UI and
  logging wired end-to-end, but sending a real text message requires a paid SMS gateway account
  (Twilio, MSG91, AWS SNS, etc.). Add the provider's HTTP call in `sendViaProvider()` once Himnish
  has an account — nothing else in the app needs to change.
- All delivery attempts (sent / failed / simulated) are recorded in `db.data.notificationLog` for
  audit purposes.

## Default logins (change on first login — enforced)

| Username | Password | Role | Assigned coaches (demo seed) |
|---|---|---|---|
| admin | Himnish@123 | Admin | All (implicit) |
| supervisor | Himnish@123 | Supervisor | LHB-29045, LHB-29112 |
| viewer | Himnish@123 | Viewer | LHB-31207, LHB-31288 |

All three seeded accounts are flagged `must_change_password` — the app forces a real
password (min 8 chars, at least one letter + one number) on first login before anything
else is usable. Same flag is set whenever an Admin resets someone's password from
Admin > Users.

## Security

- **Brute-force protection:** 10 login attempts / 15 min per IP (`express-rate-limit`),
  plus a per-account lockout (5 wrong passwords → 15-minute lock), both in
  `routes/auth.js` / `server.js`.
- **JWT_SECRET is mandatory in production** — `services/auth.js` refuses to boot if
  `NODE_ENV=production` and `JWT_SECRET` isn't set, instead of silently falling back to
  a hardcoded dev secret.
- **Password policy:** min 8 characters, at least one letter and one digit, enforced both
  on self-service change and Admin-driven create/reset (`services/auth.js` `validatePassword`).
- **Security headers:** `helmet` is applied in `server.js` (CSP left off since the frontend
  is plain inline-script HTML, not nonce-aware — the rest of helmet's protections still apply).
- **CORS:** restrict to your real frontend domain via `ALLOWED_ORIGINS` in `.env` before a
  real deployment; left open (reflects request origin) for local/demo use.
- **Ingestion rate limiting:** `/api/ingest/push` is separately rate-limited (60 req/min)
  so a leaked or guessed device key can't flood the server.
- **Optional email-OTP MFA:** Admin > Notifications > Security — "Require email OTP at
  login". Off by default (needs working SMTP first, checked server-side before it can be
  turned on, so nobody gets locked out). This covers the "OTP" part of the MDTS:44415
  MFA/OTP/DSC requirement; **DSC (Digital Signature Certificate) hardware-token auth is
  still not implemented** — it needs a specific DSC vendor/library decision (eToken, USB
  crypto token, etc.) before it can be wired in.
- **Audit log:** Admin > Notifications > Security > "View Audit Log" — records user
  create/update/delete, password resets, threshold/notification/MFA setting changes, and
  account lockouts. `services/db.js` `addAudit()` / `GET /api/admin/audit-log`.

## MDTS:44415 Rev.02 spec coverage

- **GPS/GNSS location stamping** — every logged axle reading now carries `lat`/`lon`
  (from the RUT push payload's `gps` field; requires a GNSS-capable RUT/module in the field).
- **Speed gating** — axle vibration/temperature readings below
  Settings > `min_logging_speed_kmph` (default 15 kmph, Admin-configurable via
  `PUT /api/settings/logging-speed`) are received but not logged. GPS/PICCU/telemetry are not speed-gated.
- **WLI tank-level %** — `wli_tank_level_pct` on the coach record, set via the
  `wli_tank_level_pct` field in a push payload.
- **SBC telemetry** — expanded from 6 to ~14 representative parameters (HVAC, battery,
  brake pressure, coupler force, smoke detector, PA system, passenger count, axle bearing
  temp, underframe vibration). Still short of the full 20+ parameter Annexure list — that
  depends on the actual BNI00AJ point map for each coach variant, which needs RDSO/OEM
  confirmation before it can be finalized.

## Known simplifications / production-readiness notes

- lowdb (JSON file) is fine for a prototype; production fleet scale should move to
  PostgreSQL/TimescaleDB. A lightweight write-mutex (`db/db.js` `save()`) now serializes
  all writes so concurrent RUT pushes/admin requests can't interleave and corrupt data — this
  closes the race-condition window, but a real database with transactions is still the
  right long-term answer at scale.
- **Railway persistent volume is still a manual infra step, not something code alone can
  fix:** without a volume attached at `DATA_DIR` (see `.env.example`), `data/db.json`
  resets on every redeploy — including users, coach assignments, RUT device keys, and
  notification settings. Attach a volume before relying on this in production.
- SMS delivery is not real until a provider is wired into `services/sms.js`
  `sendViaProvider()` — needs a paid gateway account (Twilio, MSG91, AWS SNS, etc.) that
  only Himnish/the Railway can provide.
- DSC (Digital Signature Certificate) authentication is not implemented (see Security
  section above) — needs a vendor/library decision first.

## MDTS:44415 Rev.02/03 gap-closure additions (v2)

Everything below was added on top of the original build to close the gaps identified in the
spec-vs-app compliance review (Rev.02 and Rev.03 — Part B/PICCU is unchanged between the two
revisions, so this closes both):

- **Wheel flat/shelling risk (Part A pt.11)** — `services/wheelDefect.js`. Real limitation, stated
  honestly: this dashboard has no profilometer, so it cannot measure an actual flat/shelling size in
  mm. What it does instead is flag the *vibration signature* of one (a periodic per-revolution impact
  spike far above the axle's rolling median) as a Green/Yellow/Orange/Red risk proxy, same banding
  concept as the rest of OBCMS. Treat Orange/Red as "go inspect the wheel", not a certified reading.
- **Self-diagnosis (Part A pt.1/23, Part B misc.)** — `services/selfDiagnosis.js`, swept every minute.
  Flags an axle STALE if it's gone silent past Settings > Sensor Stale Threshold, or FAULT if it's
  reporting a stuck-at value while the coach is moving. RUT/DC communication health is tracked the
  same way from `rutDevices[].last_seen_at`.
- **Downtime & Penalty (Part C, Clause 10)** — `services/downtime.js`. Logs every UP/DOWN transition
  per coach, computes monthly downtime % and maps it to the Clause 10 penalty slabs (≤1.5% Nil,
  >1.5–3% 2%, >3–5% 5%, >5–10% 10%, >10% 20%), and turns that into a ₹ figure using each coach's
  Monthly Bill Amount (Admin > Coach Management > Edit).
- **DSC (Digital Signature Certificate) login** — `services/dsc.js` + `/api/auth/dsc-verify`. Real
  X.509 challenge/response verification via Node's `crypto`, the same pattern used by IREPS/GST/
  e-Tendering portals: Admin uploads the user's existing DSC token's public certificate, the server
  issues a nonce, the user's own DSC signer software (outside this app — that's how DSC always
  works, the private key never leaves their token) signs it, and the signature is verified here.
- **SMS is now a generic REST bridge**, not a single hardcoded vendor — `services/sms.js`. Any
  HTTP/JSON SMS gateway (Fast2SMS, MSG91, Twilio, a company relay, etc.) can be wired purely through
  Admin > Notifications > SMS (method/URL/headers/body template with `{{phone}}`/`{{message}}`
  placeholders) with zero code changes.
- **SBC telemetry completeness checklist (Part B section 1(e))** — canonical 21-parameter reference
  list (`db/db.js` `SBC_PARAMETERS`, matching HVAC/RMPU, Battery Charger, Network, Electrical exactly)
  with a live "X / 21 received" view per coach (MDTS Compliance tab). Actual data still depends on
  the real BNI00AJ point map being wired per coach variant — this gives visibility, not the wiring.
- **New "MDTS Compliance" dashboard tab** — wheel-defect risk table, self-diagnosis + comm-health
  tables, downtime/penalty report (month/year picker), SBC completeness checklist per coach.
- **New/changed API routes**: `GET/PUT /api/admin/security` (now includes `dsc_required`,
  `sensor_stale_minutes`, `downtime_threshold_minutes`), `PUT/DELETE /api/admin/users/:id/dsc-certificate`,
  `PUT /api/admin/thresholds` (now includes `wheel_defect_impact_factor`), `PUT /api/admin/coaches/:id`
  (now includes `monthly_bill_amount`), `POST /api/admin/notifications/test-sms`, and the whole new
  `/api/compliance/*` router (`wheel-defect`, `self-diagnosis`, `downtime`, `sbc-completeness/:coach_id`).

**Still explicitly out of scope / needs a decision beyond code:**
- Native Android/iOS apps for passengers and railway users (Part B g/h) — a separate mobile project,
  not something that fits inside this Node/web codebase.
- IEC 62443 accredited-body certification, ISO 9001, country-of-origin declarations — organizational/
  bidding paperwork, not application code.
- The real BNI00AJ SBC point map per coach variant (RDSO/OEM confirmation needed) — the 21-parameter
  checklist above is ready to receive it once known.

## Run locally

```bash
npm install
cp .env.example .env
# edit .env: set JWT_SECRET to a real random value (openssl rand -hex 32)
npm start
```

App runs on `http://localhost:4000`.

## Project structure

```
himnish-obcms-piccu-dashboard/
├── server.js                 # Express app entrypoint — helmet, CORS, rate limiters, live-only ingestion + scheduler
├── db/db.js                   # lowdb schema: rakes, coaches, axles, users, thresholds, notification/security settings, audit log
├── services/
│   ├── auth.js                  # JWT sign/verify, requireRole(), password policy, prod JWT_SECRET enforcement
│   ├── access.js                 # per-user coach access filtering + requireCoachAccess middleware
│   ├── bands.js                    # shared vibration/temperature threshold-banding helpers
│   ├── ingestion.js               # live RUT push handler (speed gating, GPS, WLI %, alerts) — the only data path
│   ├── notify.js                  # routes new alerts to the coach's assigned user(s)
│   ├── mailer.js                  # nodemailer wrapper (real SMTP sending once configured; also used for OTP emails)
│   ├── sms.js                     # pluggable SMS stub — needs a real provider wired in
│   ├── pdfReport.js                # pdfkit-based coach/user report builder
│   └── scheduler.js                # daily per-user report email, once per day at Admin-set time
├── routes/
│   ├── auth.js                    # login, OTP verify, change-password (with lockout + policy)
│   ├── admin.js                    # users, coaches, thresholds, notifications, security (MFA), audit log
│   ├── settings.js, coaches.js, alerts.js, rakes.js, health.js, predictions.js, analytics.js, reports.js
└── public/                      # frontend (HTML/CSS/JS + Chart.js via CDN)
```

## Deploying to Railway.app (GitHub-integrated)

```bash
cd himnish-obcms-piccu-dashboard
git init
git add .
git commit -m "Initial commit: Himnish OBCMS & PICCU monitoring dashboard"
git remote add origin https://github.com/Himnish2007/OBCMS.git
git branch -M main
git push -u origin main
```

On Railway.app: New Project → Deploy from GitHub repo → set environment variables
(`JWT_SECRET` — required, `NODE_ENV=production`, `ALLOWED_ORIGINS` once you
know the real frontend domain) → **attach a persistent volume mounted at the path you set
as `DATA_DIR`** (e.g. `/app/data`) so users, coach assignments, RUT device keys and
notification settings survive redeploys → Railway auto-detects Node.js and runs
`npm install` then `npm start`.
Configure SMTP (and optionally SMS, and MFA once SMTP is confirmed working) from
Admin > Notifications after first login — no redeploy needed, settings are stored in the
database.

For subsequent updates:
```bash
git add .
git commit -m "<describe change>"
git push
```
Railway redeploys automatically on push to the connected branch.

### Note on the `data/` folder

`db/db.js` creates the `data/` directory at startup (`fs.mkdirSync(..., { recursive: true })`) so a
fresh clone or container never crashes with `ENOENT` even though Git does not track empty folders.
On Railway, without an attached persistent volume, `data/db.json` resets on every redeploy — fine for
a demo, but attach a volume mounted at `/app/data` if you need data (including user accounts, coach
assignments and notification settings) to survive restarts.
