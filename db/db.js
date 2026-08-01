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
  maintenanceEvents: [], // axle/component maintenance & failure history — foundation for a future
                          // ML-based predictive model (MDTS:44415 requires historical-failure training data,
                          // which does not exist yet; this is how it starts getting collected)
  systemStatusLog: [], // per-coach UP/DOWN transitions, used for Part C Clause 10 downtime% & penalty calc
  thresholds: {
    vibration: { yellow: 150, orange: 250, red: 380 }, // g
    temperature: { yellow: 70, orange: 90, red: 105 }, // °C
    // Wheel-flat/shelling (Part A, pt.11) is NOT a direct mm measurement — this dashboard has no
    // profilometer input, only axle vibration/temperature. What CAN be derived from vibration alone
    // is a periodic-shock signature (a flat/shelled wheel hits the rail once per revolution, producing
    // a sharp repeating spike far above the axle's own median vibration). impact_factor = peak/median
    // over a rolling window; bands below turn that ratio into the same Green/Yellow/Orange/Red concept
    // the spec uses for bearings/suspension/track, but this is a proxy risk indicator, NOT a substitute
    // for the actual profilometer/ultrasonic wheel measurement RCF uses to confirm 40mm/1.5mm shelling
    // or 50mm flat limits. Treat ORANGE/RED here as "go inspect the wheel", not as a certified reading.
    wheel_defect_impact_factor: { yellow: 2.2, orange: 2.8, red: 3.5 },
  },
  settings: {
    log_interval_seconds: 8,
    daily_report_time: "08:00", // 24hr HH:mm, IST assumed — admin configurable
    last_daily_report_date: null, // yyyy-mm-dd, prevents double-sending same day
    min_logging_speed_kmph: 15, // MDTS:44415 speed-gating — readings below this are received but not logged
    password_min_length: 8,
    mfa_required: false, // email-OTP second factor at login — off by default until SMTP is configured
    dsc_required: false, // second factor beyond OTP: DSC (Digital Signature Certificate) challenge/response,
                          // see services/dsc.js — off by default until at least one user has a certificate
                          // uploaded (Admin > Users > DSC Certificate), same safety pattern as mfa_required.
    sensor_stale_minutes: 30, // OBCMS self-diagnosis (Part A pt.viii/xxiii): an axle/DC that hasn't reported
                               // in this long is flagged STALE rather than silently showing old data.
    downtime_threshold_minutes: 30, // Part C, Clause 10: a coach's RUT device not reporting for longer
                                     // than this counts as system downtime for the monthly penalty calc.
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
      provider: "", // free-text label only, e.g. "Fast2SMS", "MSG91", "Twilio" — for the Admin UI/logs
      api_key: "",
      sender_id: "",
      // Generic REST provider wiring (services/sms.js sendViaProvider): works with any HTTP/JSON SMS
      // gateway without further code changes. {{phone}} and {{message}} are substituted at send time.
      // Example (Fast2SMS-style): method "POST", url "https://www.fast2sms.com/dev/bulkV2",
      // headers '{"authorization":"<api_key>","Content-Type":"application/json"}',
      // body_template '{"route":"q","message":"{{message}}","numbers":"{{phone}}"}'
      method: "POST",
      url: "",
      headers: "",
      body_template: "",
    },
  },
  meta: { seeded: false },
};

// Canonical SBC (Switch Board Cabinet) telemetry parameter list — MDTS:44415 Rev.03, Part B section
// 1(e). This is the reference checklist against which incoming `telemetry[]` push data is matched so
// the PICCU view can show "X / 21 SBC parameters received" instead of silently accepting whatever a
// RUT sends. The actual live values still depend on the real BNI00AJ point map for each coach variant
// (per Piyush's earlier gap-audit note) — this list gives the completeness visibility, not the wiring.
const SBC_PARAMETERS = [
  // 1. HVAC/RMPU status
  { key: "hvac_temp_supply_air_c", label: "HVAC — Supply Air Temperature", group: "HVAC/RMPU" },
  { key: "hvac_temp_return_air_c", label: "HVAC — Return Air Temperature", group: "HVAC/RMPU" },
  { key: "hvac_temp_fresh_air_c", label: "HVAC — Fresh Air Temperature", group: "HVAC/RMPU" },
  { key: "hvac_humidity_pct", label: "HVAC — Humidity", group: "HVAC/RMPU" },
  { key: "hvac_compressor_status", label: "HVAC — Compressor ON/OFF", group: "HVAC/RMPU" },
  { key: "hvac_heater_status", label: "HVAC — Heater ON/OFF", group: "HVAC/RMPU" },
  { key: "hvac_lp_hp_trip_status", label: "HVAC — LP/HP Trip Status", group: "HVAC/RMPU" },
  // 2. Under-slung Regulated Battery Charger status
  { key: "battery_voltage_v", label: "Battery Voltage", group: "Battery Charger" },
  { key: "battery_current_a", label: "Battery Current", group: "Battery Charger" },
  { key: "rbc_ebc_status", label: "RBC OK / EBC ON", group: "Battery Charger" },
  { key: "battery_health_status", label: "Battery Health Status", group: "Battery Charger" },
  { key: "dc_insulation_fault", label: "DC Insulation Failure (+/-)", group: "Battery Charger" },
  { key: "output_overvoltage", label: "Output Overvoltage", group: "Battery Charger" },
  { key: "output_overcurrent", label: "Output Overcurrent / Short Circuit", group: "Battery Charger" },
  { key: "charger_over_temperature", label: "Charger Over Temperature", group: "Battery Charger" },
  { key: "input_phase_voltage_fault", label: "Input Single-Phasing/Over/Under Voltage", group: "Battery Charger" },
  // 3. Network status
  { key: "network_selected", label: "Selected Network (Net-1/Net-2)", group: "Network" },
  { key: "coach_power_consumption_kw", label: "Coach-level Current/Voltage/Power", group: "Network" },
  // 4. Other electrical parameters
  { key: "hv_phase_fault_750_415", label: "Over/Under Voltage, Phase Sequence — 750V/415V", group: "Electrical" },
  { key: "insulation_fault_415_110", label: "Insulation Failure — 415V/110V AC", group: "Electrical" },
  { key: "water_pump_status", label: "Water Pump ON/OFF", group: "Electrical" },
];

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
  const dbFileExistedBeforeRead = fs.existsSync(file);
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
  if (db.data.settings.dsc_required === undefined) db.data.settings.dsc_required = false;
  if (db.data.settings.sensor_stale_minutes === undefined) db.data.settings.sensor_stale_minutes = 30;
  if (db.data.settings.downtime_threshold_minutes === undefined) db.data.settings.downtime_threshold_minutes = 30;
  if (db.data.thresholds.wheel_defect_impact_factor === undefined) {
    db.data.thresholds.wheel_defect_impact_factor = structuredClone(defaultData.thresholds.wheel_defect_impact_factor);
  }
  if (db.data.settings.sms.method === undefined) db.data.settings.sms.method = "POST";
  if (db.data.settings.sms.url === undefined) db.data.settings.sms.url = "";
  if (db.data.settings.sms.headers === undefined) db.data.settings.sms.headers = "";
  if (db.data.settings.sms.body_template === undefined) db.data.settings.sms.body_template = "";
  db.data.coachSwapLog ||= [];
  db.data.notificationLog ||= [];
  db.data.auditLog ||= [];
  db.data.maintenanceEvents ||= [];
  db.data.systemStatusLog ||= [];
  db.data.rakes ||= [];
  db.data.axles ||= [];
  db.data.axles.forEach((a) => {
    if (a.wheel_defect_band === undefined) a.wheel_defect_band = null;
    if (a.wheel_defect_impact_factor === undefined) a.wheel_defect_impact_factor = null;
    if (a.wheel_defect_checked_at === undefined) a.wheel_defect_checked_at = null;
    if (a.sensor_health === undefined) a.sensor_health = "UNKNOWN"; // OK | STALE | FAULT | UNKNOWN
    if (a.sensor_health_detail === undefined) a.sensor_health_detail = null;
    if (a.sensor_health_checked_at === undefined) a.sensor_health_checked_at = null;
  });
  db.data.coaches.forEach((c) => {
    if (c.monthly_bill_amount === undefined) c.monthly_bill_amount = 0; // Admin-entered, used for penalty ₹ calc
  });
  // Old demo/live toggle removed — the app is now live-hardware-only. Clean up any
  // leftover fields from a pre-existing db.json so we don't carry dead state around.
  if (db.data.hardware) { delete db.data.hardware.data_source; delete db.data.hardware.bom; delete db.data.hardware.poll_interval_seconds; }
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
    if (u.dsc_cert_pem === undefined) u.dsc_cert_pem = null; // uploaded by Admin, see services/dsc.js
    if (u.dsc_challenge === undefined) u.dsc_challenge = null;
    if (u.dsc_challenge_expires_at === undefined) u.dsc_challenge_expires_at = null;
  });

  if (!db.data.meta.seeded) {
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
        monthly_bill_amount: 0,
      });

      for (let axleNo = 1; axleNo <= AXLES_PER_COACH; axleNo++) {
        db.data.axles.push({
          id: nextId(db.data.axles),
          coach_id: coachId,
          axle_number: axleNo,
          wheel_defect_band: null,
          wheel_defect_impact_factor: null,
          wheel_defect_checked_at: null,
          sensor_health: "UNKNOWN",
          sensor_health_detail: null,
          sensor_health_checked_at: null,
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

    if (!dbFileExistedBeforeRead) {
      console.warn(
        "\n" +
        "⚠️  ⚠️  ⚠️  NO EXISTING DATABASE FOUND — FRESH DEFAULT DATA WAS JUST SEEDED  ⚠️  ⚠️  ⚠️\n" +
        `   DATA_DIR = ${DATA_DIR}\n` +
        "   This means every user account (including any password you already changed),\n" +
        "   coach assignment, RUT device key, and notification setting was just RESET to\n" +
        "   factory defaults (admin / Himnish@123, etc). This is expected on a brand-new\n" +
        "   deploy — but if you have deployed before and expected your data to still be\n" +
        "   here, it means DATA_DIR is NOT pointing at a persistent volume, and it will\n" +
        "   keep resetting on every restart/redeploy until you fix that.\n" +
        "   Railway.app fix: Settings > Volumes > New Volume, mount path = DATA_DIR above,\n" +
        "   then set the DATA_DIR env var to that same path and redeploy.\n"
      );
    }
  }
  return db;
}

// lowdb has no transactions. Two concurrent callers (e.g. two RUT devices pushing at the
// same moment, or an ingestion push overlapping an admin request) could otherwise
// interleave a db.read() -> mutate -> db.write() sequence and clobber each other's
// changes. This tiny promise-chain mutex serializes every save() so writes are
// effectively atomic relative to each other without needing a real database.
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

module.exports = { db, init, save, nextId, AXLES_PER_COACH, PICCU_SYSTEMS, SBC_PARAMETERS, generateDeviceKey, addAudit };
