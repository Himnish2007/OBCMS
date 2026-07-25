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
  coaches: [],
  sensors: [],
  readings: [],
  alerts: [],
  piccuSystems: [],
  piccuTelemetry: [],
  meta: { seeded: false },
};

const db = new Low(adapter, defaultData);

const SENSOR_TYPES = ["bearing", "suspension", "wheel", "track"];
const SENSOR_LOCATIONS = [
  "Axle1-DE", "Axle1-NDE", "Axle2-DE", "Axle2-NDE",
  "Axle3-DE", "Axle3-NDE", "Axle4-DE", "Axle4-NDE",
];

const PICCU_SYSTEMS = [
  "PAPIS & Infotainment", "WLI", "CCTV", "OBCMS",
  "WSP", "Bio-Vacuum Toilet", "FSDS", "FDSS",
  "RMPU", "EPPFS", "ETBU", "Battery Charger", "Network & Electrical",
];

const COACH_SEED = [
  { coach_number: "LHB-29045", rake_id: "RAKE-12A", depot: "Ghaziabad", zone: "NR", coach_type: "AC 3-Tier" },
  { coach_number: "LHB-29112", rake_id: "RAKE-12A", depot: "Ghaziabad", zone: "NR", coach_type: "Sleeper" },
  { coach_number: "LHB-31207", rake_id: "RAKE-07C", depot: "Kanpur", zone: "NCR", coach_type: "AC 2-Tier" },
  { coach_number: "LHB-31288", rake_id: "RAKE-07C", depot: "Kanpur", zone: "NCR", coach_type: "General" },
  { coach_number: "LHB-40561", rake_id: "RAKE-19B", depot: "Mumbai Central", zone: "WR", coach_type: "AC 3-Tier" },
  { coach_number: "LHB-40602", rake_id: "RAKE-19B", depot: "Mumbai Central", zone: "WR", coach_type: "Pantry" },
];

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1;
}

async function init() {
  await db.read();
  db.data ||= structuredClone(defaultData);

  if (!db.data.meta.seeded) {
    // Admin user
    const passwordHash = bcrypt.hashSync("Himnish@123", 8);
    db.data.users.push({
      id: 1, username: "admin", passwordHash, role: "Admin", name: "Piyush Tyagi",
    });

    // Coaches
    COACH_SEED.forEach((c, idx) => {
      const coachId = idx + 1;
      db.data.coaches.push({ id: coachId, ...c });

      // Sensors per coach
      SENSOR_LOCATIONS.forEach((loc, sIdx) => {
        db.data.sensors.push({
          id: nextId(db.data.sensors),
          coach_id: coachId,
          code: `${c.coach_number}-S${sIdx + 1}`,
          location: loc,
          type: SENSOR_TYPES[sIdx % SENSOR_TYPES.length],
        });
      });

      // PICCU systems per coach
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

module.exports = { db, init, save, nextId, SENSOR_TYPES, SENSOR_LOCATIONS, PICCU_SYSTEMS };
