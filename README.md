# Himnish OBCMS & PICCU Monitoring Dashboard

Full-stack condition-monitoring dashboard for the OBCMS (On-Board Condition Monitoring System) and
PICCU (Passenger Information Coach Computing Unit), built against MDTS:44415 Rev.02.

- **Backend:** Node.js + Express, REST API, JWT auth, role-based + **per-coach access control**
- **Storage:** lowdb (JSON file store) — zero native build dependencies
- **Data source:** `DEMO_MODE` simulator generates realistic per-axle vibration/temperature and PICCU
  telemetry on a configurable interval. Swap in a real Modbus/MQTT ingestion service in `services/`
  when hardware is connected — the API and frontend contracts do not change.
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

- **Real-time alert routing:** when the simulator (or a real ingestion service) raises an
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

## Default logins (change before real deployment)

| Username | Password | Role | Assigned coaches (demo seed) |
|---|---|---|---|
| admin | Himnish@123 | Admin | All (implicit) |
| supervisor | Himnish@123 | Supervisor | LHB-29045, LHB-29112 |
| viewer | Himnish@123 | Viewer | LHB-31207, LHB-31288 |

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

App runs on `http://localhost:4000`.

## Project structure

```
himnish-obcms-piccu-dashboard/
├── server.js                 # Express app entrypoint — starts simulator + daily-report scheduler
├── db/db.js                   # lowdb schema: rakes, coaches, axles, users (+coach assignment), thresholds, notification settings
├── services/
│   ├── auth.js                  # JWT sign/verify + requireRole()
│   ├── access.js                 # per-user coach access filtering + requireCoachAccess middleware
│   ├── simulator.js              # DEMO_MODE data generator (dynamic thresholds + log interval)
│   ├── notify.js                  # routes new alerts to the coach's assigned user(s)
│   ├── mailer.js                  # nodemailer wrapper (real SMTP sending once configured)
│   ├── sms.js                     # pluggable SMS stub — needs a real provider wired in
│   ├── pdfReport.js                # pdfkit-based coach/user report builder
│   └── scheduler.js                # daily per-user report email, once per day at Admin-set time
├── routes/
│   ├── auth.js, coaches.js, alerts.js, rakes.js, admin.js, health.js, predictions.js, analytics.js, reports.js
└── public/                      # frontend (HTML/CSS/JS + Chart.js via CDN)
```

## Known simplifications / production-readiness notes

- lowdb (JSON file) is fine for a prototype; production fleet scale should move to
  PostgreSQL/TimescaleDB. There is a narrow race-condition window if the scheduler's per-user email
  loop (which awaits inside a `for` loop) happens to overlap exactly with an in-flight simulator
  tick — low probability at demo scale (daily vs. every-few-seconds), but worth knowing about before
  scaling this up; a real database with transactions removes this class of bug entirely.
- Still outstanding versus MDTS:44415 Rev.02: GPS/GNSS location stamping, speed gating (>15 kmph)
  before logging, full SBC telemetry parameter set (currently 6 representative parameters), WLI
  tank-level percentage, MFA/OTP/DSC authentication.
- SMS delivery is not real until a provider is wired into `services/sms.js` (see above).

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
(`JWT_SECRET`, `DEMO_MODE`) → Railway auto-detects Node.js and runs `npm install` then `npm start`.
Configure SMTP (and optionally SMS) from Admin > Notifications after first login — no redeploy
needed, settings are stored in the database.

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
