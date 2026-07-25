# Himnish OBCMS & PICCU Monitoring Dashboard

Full-stack condition-monitoring dashboard for the OBCMS (On-Board Condition Monitoring System) and
PICCU (Passenger Information Coach Computing Unit), built against MDTS:44415 Rev.02.

- **Backend:** Node.js + Express, REST API, JWT auth
- **Storage:** lowdb (JSON file store) — zero native build dependencies, drop-in swap to Postgres/TimescaleDB later
- **Data source:** `DEMO_MODE` simulator generates realistic vibration/temperature/PICCU telemetry
  every 8 seconds. Swap in a real Modbus/MQTT ingestion service in `services/` when hardware is
  connected, without changing the API or frontend contracts.
- **Frontend:** Vanilla JS + Chart.js — Fleet Overview, OBCMS (sensor/condition-band monitoring),
  PICCU (integrated sub-system status + SBC telemetry), Alerts.

## Modules

| View | What it shows |
|---|---|
| Fleet Overview | KPI cards, Green/Yellow/Orange/Red band distribution, coach-wise health table |
| OBCMS | Per-coach sensor grid (axle bearing / suspension / wheel / track), live vibration trend chart, alerts |
| PICCU | Integrated sub-systems (PAPIS, WLI, CCTV, WSP, Toilet, FSDS/FDSS, RMPU, EPPFS, ETBU, Battery Charger, Network) + SBC telemetry (HVAC, battery, network) |
| Alerts | Fleet-wide alert feed with acknowledge workflow |

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

App runs on `http://localhost:4000`. Default login: **admin / Himnish@123**

## Project structure

```
himnish-obcms-piccu-dashboard/
├── server.js              # Express app entrypoint
├── db/db.js                # lowdb schema, seed data
├── services/
│   ├── auth.js              # JWT sign/verify
│   └── simulator.js         # DEMO_MODE data generator (replace with real ingestion later)
├── routes/
│   ├── auth.js               # POST /api/auth/login
│   ├── coaches.js            # coaches, sensors, alerts, piccu (per coach)
│   └── alerts.js             # fleet-wide alerts + acknowledge
└── public/                  # frontend (HTML/CSS/JS + Chart.js via CDN)
```

## Connecting real hardware later

Replace the simulator call in `server.js` with a real ingestion service that reads from your
Data Concentrator (Modbus TCP/RS485) or MQTT broker and calls the same `db.data` write pattern
used in `services/simulator.js`. The REST API and frontend do not need to change.

## Deploying to Railway.app (GitHub-integrated — Himnish's standard workflow)

```bash
# 1. Initialize git and commit
cd himnish-obcms-piccu-dashboard
git init
git add .
git commit -m "Initial commit: Himnish OBCMS & PICCU monitoring dashboard"

# 2. Create a GitHub repo (via gh CLI, or manually on github.com) then:
git remote add origin https://github.com/<your-org>/himnish-obcms-piccu-dashboard.git
git branch -M main
git push -u origin main

# 3. On Railway.app:
#    - New Project -> Deploy from GitHub repo -> select this repo
#    - Set environment variables in Railway dashboard:
#        JWT_SECRET=<a strong random string>
#        DEMO_MODE=true   (set to false once real hardware ingestion is wired in)
#    - Railway auto-detects Node.js, runs `npm install` then `npm start`
#    - Attach a persistent volume mounted at /app/data if you need db.json to survive redeploys

# For subsequent updates (matches existing HIMNISH-RAIP workflow):
#    - Do NOT delete the project folder between updates — copy new files over the existing folder
#    - git add .
#    - git commit -m "<describe change>"
#    - git push
#    Railway redeploys automatically on push to the connected branch.
```

## Security notes before production use

- Change `JWT_SECRET` and the seeded admin password before any real deployment.
- lowdb (JSON file) is fine for a prototype/demo; for production-scale fleet data move to
  PostgreSQL/TimescaleDB as already planned for the EMU monitoring platform.
- Add RBAC roles (Admin / Depot / Zone / Viewer) the same way it was implemented in the
  EMU Traction Motor Temperature Monitoring project once real users are onboarded.
