const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

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
  rutDevices: [],       // physical RUT routers — reassignable to whichever coach they're currently mounted on
  rutReassignLog: [],   // audit trail of RUT <-> coach reassignments
  auditLog: [],         // admin actions: who did what, when (user mgmt, threshold/notification/data-source changes)
  thresholds: {
    vibration: { yellow: 150, orange: 250, red: 380 }, // g
    temperature: { yellow: 70, orange: 90, red: 105 }, // °C
  },
  settings: {
    log_interval_seconds: 8,
    daily_report_time: "08:00", // 24hr HH:mm, IST assumed — admin configurable
    last_daily_report_date: null, // yyyy-mm-dd, prevents double-sending same day
    min_logging_speed_kmph: 15, // MDTS:44415 speed-gating — readings below this are received but not logged
    password_min_length: 8,
    mfa_required: false, // email-OTP second factor at login — off by default until SMTP is configured
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
    // "demo" = services/simulator.js generates data. "live" = incoming pushes from RUT
    // devices (routes/ingest.js) are accepted and written for whichever coach each RUT
    // is currently assigned to (db.data.rutDevices). Switchable at runtime from the
    // Settings page — no redeploy needed to go live once hardware is wired up.
    data_source: "demo",
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

function generateDeviceKey() {
  return crypto.randomBytes(20).toString("hex"); // 40-char API key, given to the RUT's push script
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
  if (db.data.settings.min_logging_speed_kmph === undefined) db.data.settings.min_logging_speed_kmph = 15;
  if (db.data.settings.password_min_length === undefined) db.data.settings.password_min_length = 8;
  if (db.data.settings.mfa_required === undefined) db.data.settings.mfa_required = false;
  db.data.coachSwapLog ||= [];
  db.data.notificationLog ||= [];
  db.data.auditLog ||= [];
  db.data.rakes ||= [];
  db.data.axles ||= [];
  db.data.hardware ||= structuredClone(defaultData.hardware);
  if (db.data.hardware.data_source === undefined) db.data.hardware.data_source = "demo";
  delete db.data.hardware.bom;
  delete db.data.hardware.poll_interval_seconds; // obsolete: ingestion is push-based now, not polled
  db.data.rutDevices ||= [];
  db.data.rutReassignLog ||= [];
  db.data.coaches.forEach((c) => { delete c.hardware; }); // obsolete per-coach IP model — replaced by rutDevices
  db.data.users.forEach((u) => {
    if (u.assigned_coaches === undefined) u.assigned_coaches = [];
    if (u.email === undefined) u.email = "";
    if (u.phone === undefined) u.phone = "";
    if (u.must_change_password === undefined) u.must_change_password = false; // existing users unaffected
    if (u.failed_login_attempts === undefined) u.failed_login_attempts = 0;
    if (u.locked_until === undefined) u.locked_until = null;
    if (u.otp_hash === undefined) u.otp_hash = null;
    if (u.otp_expires_at === undefined) u.otp_expires_at = null;
  });

  if (!db.data.meta.seeded) {
    db.data.hardware.data_source = (process.env.DEMO_MODE || "false") === "true" ? "demo" : "live";

    // Users — Admin, Supervisor, Viewer
    const mkUser = (id, username, password, role, name, email, phone, assigned_coaches) => ({
      id, username, passwordHash: bcrypt.hashSync(password, 10), role, name, email, phone, assigned_coaches,
      must_change_password: true, // default demo credentials — force a real password on first login
      failed_login_attempts: 0,
      locked_until: null,
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
          status: "No Data",
          last_update: new Date().toISOString(),
        });
      });
    });

    db.data.meta.seeded = true;
    await db.write();
  }
  return db;
}

// lowdb has no transactions. Two concurrent callers (e.g. the simulator's tick and an
// incoming live ingestion push, or two admin requests) could otherwise interleave a
// db.read() -> mutate -> db.write() sequence and clobber each other's changes. This
// tiny promise-chain mutex serializes every save() so writes are effectively atomic
// relative to each other without needing a real database.
let writeQueue = Promise.resolve();
async function save() {
  writeQueue = writeQueue.then(() => db.write()).catch((err) => {
    console.error("db.write() failed:", err.message);
  });
  return writeQueue;
}

// Records an admin/security-relevant action. Kept lightweight and best-effort — never
// throws, so a logging failure can't block the underlying action.
function addAudit(actorUser, action, details) {
  try {
    db.data.auditLog.push({
      id: nextId(db.data.auditLog),
      ts: new Date().toISOString(),
      actor_id: actorUser ? actorUser.id : null,
      actor_username: actorUser ? actorUser.username : "system",
      action,
      details: details || {},
    });
    const MAX_AUDIT = 2000;
    if (db.data.auditLog.length > MAX_AUDIT) {
      db.data.auditLog = db.data.auditLog.slice(db.data.auditLog.length - MAX_AUDIT);
    }
  } catch (err) {
    console.error("addAudit failed:", err.message);
  }
}

module.exports = { db, init, save, nextId, AXLES_PER_COACH, PICCU_SYSTEMS, generateDeviceKey, addAudit };
