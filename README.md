# Himnish OBCMS & PICCU Monitoring Dashboard

Full-stack condition-monitoring dashboard for the OBCMS (On-Board Condition Monitoring System) and
PICCU (Passenger Information Coach Computing Unit), built against MDTS:44415 Rev.02.

- **Backend:** Node.js + Express, REST API, JWT auth, role-based access control (Admin / Supervisor / Viewer)
- **Storage:** lowdb (JSON file store) — zero native build dependencies
- **Data source:** `DEMO_MODE` simulator generates realistic per-axle vibration/temperature and PICCU
  telemetry on a configurable interval (Admin > Log Time Setting). Swap in a real Modbus/MQTT ingestion
  service in `services/` when hardware is connected — the API and frontend contracts do not change.
- **Frontend:** Vanilla JS + Chart.js — 10 views, role-aware navigation.

## Modules / Pages

| View | What it shows |
|---|---|
| Fleet Overview | KPI cards, Green/Yellow/Orange/Red distribution, coach-wise health table |
| OBCMS | Per-coach **8-axle** grid — each axle reports both vibration (g) and temperature (°C); dual-axis trend chart; condition band is the worse of the two parameters |
| PICCU | Integrated sub-systems (PAPIS, WLI, CCTV, WSP, Toilet, FSDS/FDSS, RMPU, EPPFS, ETBU, Battery Charger, Network) + SBC telemetry |
| Health | Fleet-wide 8-axle heatmap per coach, composite health score, worst-performing axles list |
| Prediction | Linear-trend extrapolation per axle — estimated time to next threshold breach (indicative, not a certified predictive algorithm) |
| Analytics | Band distribution, LHB vs Vande Bharat comparison, top alert-prone coaches, alert trend charts |
| Alerts | Fleet-wide alert feed with acknowledge workflow |
| Reports | Summary KPIs, CSV export (readings / alerts, optionally filtered by coach), printable summary |
| **Rake Management** | LHB / Vande Bharat rake list with assigned coaches, **Add Rake**, **Swap Coach** (move any coach between any rake — reflects real operations where coach composition changes), full swap history log |
| **Admin** *(Admin role only)* | **Users** (create/edit/delete, roles), **Coaches** (create/edit/delete — creates 8 axles + PICCU systems automatically), **Alert Thresholds** (configurable Yellow/Orange/Red for vibration & temperature), **Log Time Setting** (data logging interval) |

## Roles

| Role | Can do |
|---|---|
| Admin | Everything — user management, coach/rake management, thresholds, log settings |
| Supervisor | Create/edit rakes &amp; coaches, swap coaches, acknowledge alerts — cannot manage users or delete rakes/coaches or change thresholds |
| Viewer | Read-only across all views |

Enforced both in the UI (nav items hidden) and in the API (`requireRole` middleware) — a Viewer/Supervisor
token cannot call protected endpoints even by hitting the API directly.

## Default logins (change before real deployment)

| Username | Password | Role |
|---|---|---|
| admin | Himnish@123 | Admin |
| supervisor | Himnish@123 | Supervisor |
| viewer | Himnish@123 | Viewer |

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
├── server.js                 # Express app entrypoint
├── db/db.js                   # lowdb schema: rakes, coaches, axles, thresholds, settings, swap log
├── services/
│   ├── auth.js                  # JWT sign/verify + requireRole()
│   └── simulator.js             # DEMO_MODE data generator (dynamic thresholds + log interval)
├── routes/
│   ├── auth.js                    # POST /api/auth/login
│   ├── coaches.js                 # coaches, axles, alerts, piccu (per coach)
│   ├── alerts.js                  # fleet-wide alerts + acknowledge
│   ├── rakes.js                   # rake CRUD + coach swap + swap log
│   ├── admin.js                   # users CRUD, coaches CRUD, thresholds, log settings
│   ├── health.js                  # fleet health matrix, worst axles
│   ├── predictions.js             # trend-based breach prediction
│   ├── analytics.js               # fleet-wide aggregated stats
│   └── reports.js                 # CSV export, summary
└── public/                      # frontend (HTML/CSS/JS + Chart.js via CDN)
```

## Connecting real hardware later

Replace the simulator call in `server.js` with a real ingestion service that reads from your
Data Concentrator (Modbus TCP/RS485) or MQTT broker and writes into the same `db.data.readings`
array shape used in `services/simulator.js` (one entry per axle per log interval, with `axle_id`,
`vibration_g`, `temperature_c`). The REST API and frontend do not need to change.

## Known simplifications (see prior self-assessment)

This is a working prototype layer on top of the OBCMS/PICCU specification, not a certified
production system. Still outstanding versus MDTS:44415 Rev.02:
- GPS/GNSS location stamping on readings
- Speed gating (>15 kmph) before logging a reading
- Email/SMS alert delivery (currently in-app only)
- Full SBC telemetry parameter set (RMPU/Battery/Network — currently 6 representative parameters)
- WLI tank-level percentage (currently generic Online/Offline)
- MFA/OTP/DSC authentication (currently username + password)
- lowdb is fine for a prototype; production fleet scale should move to PostgreSQL/TimescaleDB

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
a demo, but attach a volume mounted at `/app/data` if you need data to survive restarts.
