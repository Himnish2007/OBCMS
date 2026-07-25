const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

// Ensure the data directory exists. Git does not track empty folders, so on a
// fresh clone/deploy (e.g. Railway) this directory may not exist at all —
// without this, lowdb's write-temp-file-then-rename fails with ENOENT.
fs.mkdirSync(DATA_DIR, { recursive: true });

const file = path.join(DATA_DIR, "db.json");
const adapter = new JSONFile(file);

const defaultData = {
  users: [],
  rakes: [],
  coaches: [],
  axles: [],
  readings: [],
  alerts: [],
  piccuSystems: [],
  piccuTelemetry: [],
  coachSwapLog: [],
  notificationLog: [],
  thresholds: {
    vibration: { yellow: 150, orange: 250, red: 380 }, // g
    temperature: { yellow: 70, orange: 90, red: 105 }, // °C
  },
  settings: {
    log_interval_seconds: 8,
    daily_report_time: "08:00", // 24hr HH:mm, IST assumed — admin configurable
    last_daily_report_date: null, // yyyy-mm-dd, prevents double-sending same day
    smtp: {
      enabled: false,
      host: "",
      port: 587,
      secure: false,
      user: "",
      pass: "",
      from_name: "Himnish OBCMS & PICCU",
      from_email: "",
    },
    sms: {
      enabled: false,
      provider: "", // e.g. "twilio", "msg91" — pluggable, see services/sms.js
      api_key: "",
      sender_id: "",
    },
  },
  hardware: {
    // "demo" = services/simulator.js generates data. "live" = services/ingestion.js polls
    // real Modbus TCP hardware per-coach (see coach.hardware below). Switchable at runtime
    // from the Settings page — no redeploy needed to go live once hardware is wired up.
    data_source: "demo",
    poll_interval_seconds: 10,
  },
  meta: { seeded: false },
};

const db = new Low(adapter, defaultData);

const AXLES_PER_COACH = 8;

const PICCU_SYSTEMS = [
  "PAPIS & Infotainment", "WLI", "CCTV", "OBCMS",
  "WSP", "Bio-Vacuum Toilet", "FSDS", "FDSS",
  "RMPU", "EPPFS", "ETBU", "Battery Charger", "Network & Electrical",
];

const RAKE_SEED = [
  { rake_name: "RAKE-12A", rake_type: "LHB", zone: "NR", depot: "Ghaziabad" },
  { rake_name: "RAKE-07C", rake_type: "LHB", zone: "NCR", depot: "Kanpur" },
  { rake_name: "VB-RAKE-03", rake_type: "Vande Bharat", zone: "WR", depot: "Mumbai Central" },
];

const COACH_SEED = [
  { coach_number: "LHB-29045", rake_name: "RAKE-12A", coach_type: "AC 3-Tier", position: 1 },
  { coach_number: "LHB-29112", rake_name: "RAKE-12A", coach_type: "Sleeper", position: 2 },
  { coach_number: "LHB-31207", rake_name: "RAKE-07C", coach_type: "AC 2-Tier", position: 1 },
  { coach_number: "LHB-31288", rake_name: "RAKE-07C", coach_type: "General", position: 2 },
  { coach_number: "VB-40561", rake_name: "VB-RAKE-03", coach_type: "Executive Chair Car", position: 1 },
  { coach_number: "VB-40602", rake_name: "VB-RAKE-03", coach_type: "Chair Car", position: 2 },
];

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1;
}

// Per-coach Modbus TCP connectivity for the two BNI00L1 IO-Link masters (OBCMS + PICCU)
// plus the RUT200 that backhauls them. Left blank until the hardware is physically wired —
// the ingestion service simply skips a coach whose IPs are not yet filled in.
function defaultCoachHardware() {
  return {
    obcms_master_ip: "",
    obcms_master_port: 502,
    piccu_master_ip: "",
    piccu_master_port: 502,
    rut200_ip: "",
  };
}

async function init() {
  await db.read();
  db.data ||= structuredClone(defaultData);
  db.data.thresholds ||= structuredClone(defaultData.thresholds);
  db.data.settings ||= structuredClone(defaultData.settings);
  db.data.settings.smtp ||= structuredClone(defaultData.settings.smtp);
  db.data.settings.sms ||= structuredClone(defaultData.settings.sms);
  if (db.data.settings.daily_report_time === undefined) db.data.settings.daily_report_time = "08:00";
  if (db.data.settings.last_daily_report_date === undefined) db.data.settings.last_daily_report_date = null;
  db.data.coachSwapLog ||= [];
  db.data.notificationLog ||= [];
  db.data.rakes ||= [];
  db.data.axles ||= [];
  db.data.hardware ||= structuredClone(defaultData.hardware);
  if (db.data.hardware.data_source === undefined) db.data.hardware.data_source = "demo";
  if (db.data.hardware.poll_interval_seconds === undefined) db.data.hardware.poll_interval_seconds = 10;
  delete db.data.hardware.bom;
  db.data.coaches.forEach((c) => { c.hardware ||= defaultCoachHardware(); });
  db.data.users.forEach((u) => {
    if (u.assigned_coaches === undefined) u.assigned_coaches = [];
    if (u.email === undefined) u.email = "";
    if (u.phone === undefined) u.phone = "";
  });

  if (!db.data.meta.seeded) {
    db.data.hardware.data_source = (process.env.DEMO_MODE || "true") === "true" ? "demo" : "live";

    // Users — Admin, Supervisor, Viewer
    const mkUser = (id, username, password, role, name, email, phone, assigned_coaches) => ({
      id, username, passwordHash: bcrypt.hashSync(password, 8), role, name, email, phone, assigned_coaches,
    });
    db.data.users.push(
      mkUser(1, "admin", "Himnish@123", "Admin", "Piyush Tyagi", "admin@himnish.example", "", []),
      mkUser(2, "supervisor", "Himnish@123", "Supervisor", "Depot Supervisor", "supervisor@himnish.example", "", [1, 2]),
      mkUser(3, "viewer", "Himnish@123", "Viewer", "Zonal Viewer", "viewer@himnish.example", "", [3, 4])
    );

    // Rakes
    const rakeIdByName = {};
    RAKE_SEED.forEach((r) => {
      const id = nextId(db.data.rakes);
      db.data.rakes.push({ id, ...r });
      rakeIdByName[r.rake_name] = id;
    });

    // Coaches + Axles
    COACH_SEED.forEach((c) => {
      const coachId = nextId(db.data.coaches);
      db.data.coaches.push({
        id: coachId,
        coach_number: c.coach_number,
        rake_id: rakeIdByName[c.rake_name],
        coach_type: c.coach_type,
        position: c.position,
        status: "Active",
        hardware: defaultCoachHardware(),
      });

      for (let axleNo = 1; axleNo <= AXLES_PER_COACH; axleNo++) {
        db.data.axles.push({
          id: nextId(db.data.axles),
          coach_id: coachId,
          axle_number: axleNo,
        });
      }

      PICCU_SYSTEMS.forEach((sys) => {
        db.data.piccuSystems.push({
          id: nextId(db.data.piccuSystems),
          coach_id: coachId,
          system_name: sys,
          status: "Online",
          last_update: new Date().toISOString(),
        });
      });
    });

    db.data.meta.seeded = true;
    await db.write();
  }
  return db;
}

async function save() {
  await db.write();
}

module.exports = { db, init, save, nextId, AXLES_PER_COACH, PICCU_SYSTEMS, defaultCoachHardware };
