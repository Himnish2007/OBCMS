// ============================================================================
// LIVE HARDWARE INGESTION — polls the two Balluff BNI00L1 IO-Link masters per
// coach over Modbus TCP (reachable via the coach's Teltonika RUT200) and writes
// readings into the same DB shape as services/simulator.js, so the rest of the
// dashboard (OBCMS grid, PICCU grid, alerts, analytics, reports) needs no changes.
//
// Only runs when Settings > Data Source is set to "Live Hardware". A coach is
// skipped entirely until its Modbus IPs are filled in on Settings > Hardware
// Connectivity (Admin/Supervisor).
//
// HARDWARE MAPPING — BNI00L1 #1 (OBCMS master):
//   8x Balluff BCM0004 sensors, one per IO-Link port (Axle-1..Axle-8).
//   Each axle's vibration + temperature process data is read as 2 consecutive
//   16-bit Modbus holding registers per REGISTER_MAP.obcms below.
//
// HARDWARE MAPPING — BNI00L1 #2 (PICCU master):
//   - 13x PICCU subsystem Online/Fault signals wired into the master's built-in
//     PNP digital inputs, packed as bits 0..12 of a single holding register.
//   - Balluff BNI00AJ (8-ch analog/RTD hub) plugged into one IO-Link port,
//     exposing HVAC/Battery/WLI channels as holding registers.
//
// IMPORTANT: The exact register addresses below are placeholders following
// Balluff's common Modbus TCP process-data convention. Once the physical
// masters are configured (via Balluff's web configuration page for each
// BNI00L1), open that page's "Modbus TCP register mapping" tab and update the
// offsets in REGISTER_MAP to match exactly — nothing else in this file needs
// to change.
// ============================================================================

const ModbusRTU = require("modbus-serial");
const { db, save, nextId } = require("../db/db");
const { bandFor, worstBand } = require("./simulator");
const { notifyAlert } = require("./notify");
const { PICCU_SYSTEMS } = require("../db/db");

const MAX_READINGS_PER_AXLE = 40;
const MAX_TELEMETRY_PER_PARAM = 30;
const MODBUS_TIMEOUT_MS = 3000;

const REGISTER_MAP = {
  obcms: {
    unitId: 1,
    axleRegisterBase: 0, // holding register address of Axle-1's first word
    wordsPerAxle: 2, // [vibration_raw, temperature_raw]
    vibrationScale: 0.1, // raw * scale = g
    temperatureScale: 0.1, // raw * scale = °C
    speedRegister: 16, // single register, shared coach speed (from RUT956/GPS or an axle tacho) — 0 if unavailable
    speedScale: 0.1,
  },
  piccu: {
    unitId: 1,
    digitalStatusRegister: 0, // 1 register, bit0..bit12 = 13 subsystem flags, 1=Online 0=Fault
    analogRegisterBase: 10, // holding register address of the first BNI00AJ channel
    analogChannels: [
      { param: "HVAC_Supply_Temp_C", offset: 0, scale: 0.1, unit: "°C" },
      { param: "HVAC_Return_Temp_C", offset: 1, scale: 0.1, unit: "°C" },
      { param: "Battery_Voltage_V", offset: 2, scale: 0.1, unit: "V" },
      { param: "Battery_Current_A", offset: 3, scale: 0.01, unit: "A" },
      { param: "WLI_Tank_Level_pct", offset: 4, scale: 0.1, unit: "%" },
      { param: "Network_Power_kW", offset: 5, scale: 0.01, unit: "kW" },
    ],
  },
};

// One persistent Modbus TCP client per "host:port" so we don't reconnect every poll cycle.
const clientPool = new Map();

async function getClient(ip, port) {
  const key = `${ip}:${port}`;
  let client = clientPool.get(key);
  if (client && client.isOpen) return client;
  client = new ModbusRTU();
  client.setTimeout(MODBUS_TIMEOUT_MS);
  await client.connectTCP(ip, { port });
  clientPool.set(key, client);
  return client;
}

async function pollObcmsMaster(coach, axles) {
  const cfg = REGISTER_MAP.obcms;
  const client = await getClient(coach.hardware.obcms_master_ip, coach.hardware.obcms_master_port);
  client.setID(cfg.unitId);

  let speed = 0;
  try {
    const speedResult = await client.readHoldingRegisters(cfg.speedRegister, 1);
    speed = (speedResult.data[0] || 0) * cfg.speedScale;
  } catch (err) {
    // Speed register optional — proceed without it
  }

  const now = new Date().toISOString();
  const thresholds = db.data.thresholds;

  for (const axle of axles) {
    const base = cfg.axleRegisterBase + (axle.axle_number - 1) * cfg.wordsPerAxle;
    let result;
    try {
      result = await client.readHoldingRegisters(base, cfg.wordsPerAxle);
    } catch (err) {
      console.error(`Ingestion: OBCMS read failed for ${coach.coach_number} Axle-${axle.axle_number} @ ${coach.hardware.obcms_master_ip}: ${err.message}`);
      continue;
    }
    const vibration = result.data[0] * cfg.vibrationScale;
    const temperature = result.data[1] * cfg.temperatureScale;

    const vibBand = bandFor(vibration, thresholds.vibration);
    const tempBand = bandFor(temperature, thresholds.temperature);
    const band = worstBand(vibBand, tempBand);

    const reading = {
      id: nextId(db.data.readings),
      axle_id: axle.id,
      coach_id: coach.id,
      axle_number: axle.axle_number,
      ts: now,
      vibration_g: Number(vibration.toFixed(1)),
      temperature_c: Number(temperature.toFixed(1)),
      speed_kmph: Number(speed.toFixed(0)),
      vibration_band: vibBand,
      temperature_band: tempBand,
      band,
    };
    db.data.readings.push(reading);

    const axleReadings = db.data.readings.filter((r) => r.axle_id === axle.id);
    if (axleReadings.length > MAX_READINGS_PER_AXLE) {
      const excess = axleReadings
        .sort((a, b) => new Date(a.ts) - new Date(b.ts))
        .slice(0, axleReadings.length - MAX_READINGS_PER_AXLE)
        .map((r) => r.id);
      db.data.readings = db.data.readings.filter((r) => !excess.includes(r.id));
    }

    if (band === "ORANGE" || band === "RED") {
      const openAlert = db.data.alerts.find((a) => a.axle_id === axle.id && !a.acknowledged && a.band === band);
      if (!openAlert) {
        const causedBy = vibBand === band ? "vibration" : "temperature";
        const newAlert = {
          id: nextId(db.data.alerts),
          coach_id: coach.id,
          axle_id: axle.id,
          axle_number: axle.axle_number,
          severity: band === "RED" ? "Critical" : "High",
          band,
          parameter: causedBy,
          message: `Axle-${axle.axle_number} anomaly on ${coach.coach_number} — vibration ${reading.vibration_g}g, temp ${reading.temperature_c}°C (driven by ${causedBy}).`,
          created_at: now,
          acknowledged: false,
        };
        db.data.alerts.push(newAlert);
        notifyAlert(newAlert, coach).catch((err) => console.error("notifyAlert error:", err.message));
      }
    }
  }
}

async function pollPiccuMaster(coach) {
  const cfg = REGISTER_MAP.piccu;
  const client = await getClient(coach.hardware.piccu_master_ip, coach.hardware.piccu_master_port);
  client.setID(cfg.unitId);
  const now = new Date().toISOString();

  // 13 subsystem status bits
  try {
    const statusResult = await client.readHoldingRegisters(cfg.digitalStatusRegister, 1);
    const bits = statusResult.data[0];
    const systems = db.data.piccuSystems.filter((p) => p.coach_id === coach.id);
    PICCU_SYSTEMS.forEach((sysName, idx) => {
      const system = systems.find((s) => s.system_name === sysName);
      if (!system) return;
      const online = ((bits >> idx) & 1) === 1;
      const newStatus = online ? "Online" : "Fault";
      if (system.status !== newStatus) { system.status = newStatus; system.last_update = now; }
    });
  } catch (err) {
    console.error(`Ingestion: PICCU status read failed for ${coach.coach_number} @ ${coach.hardware.piccu_master_ip}: ${err.message}`);
  }

  // Analog telemetry via BNI00AJ
  try {
    const width = Math.max(...cfg.analogChannels.map((c) => c.offset)) + 1;
    const analogResult = await client.readHoldingRegisters(cfg.analogRegisterBase, width);
    cfg.analogChannels.forEach((ch) => {
      const raw = analogResult.data[ch.offset];
      const value = Number((raw * ch.scale).toFixed(2));
      db.data.piccuTelemetry.push({ id: nextId(db.data.piccuTelemetry), coach_id: coach.id, param: ch.param, value, unit: ch.unit, ts: now });
      const history = db.data.piccuTelemetry.filter((p) => p.coach_id === coach.id && p.param === ch.param);
      if (history.length > MAX_TELEMETRY_PER_PARAM) {
        const excess = history.sort((a, b) => new Date(a.ts) - new Date(b.ts)).slice(0, history.length - MAX_TELEMETRY_PER_PARAM).map((p) => p.id);
        db.data.piccuTelemetry = db.data.piccuTelemetry.filter((p) => !excess.includes(p.id));
      }
    });
  } catch (err) {
    console.error(`Ingestion: PICCU analog read failed for ${coach.coach_number} @ ${coach.hardware.piccu_master_ip}: ${err.message}`);
  }
}

async function tick() {
  await db.read();
  if ((db.data.hardware && db.data.hardware.data_source) !== "live") return; // Settings > Data Source is set to Demo

  const coaches = db.data.coaches.filter((c) => c.hardware && (c.hardware.obcms_master_ip || c.hardware.piccu_master_ip));
  for (const coach of coaches) {
    if (coach.hardware.obcms_master_ip) {
      const axles = db.data.axles.filter((a) => a.coach_id === coach.id);
      try {
        await pollObcmsMaster(coach, axles);
      } catch (err) {
        console.error(`Ingestion: OBCMS master unreachable for ${coach.coach_number} @ ${coach.hardware.obcms_master_ip}: ${err.message}`);
      }
    }
    if (coach.hardware.piccu_master_ip) {
      try {
        await pollPiccuMaster(coach);
      } catch (err) {
        console.error(`Ingestion: PICCU master unreachable for ${coach.coach_number} @ ${coach.hardware.piccu_master_ip}: ${err.message}`);
      }
    }
  }

  await save();
}

let timer = null;
let running = false;

async function loop() {
  if (!running) return;
  try {
    await tick();
  } catch (err) {
    console.error("Ingestion tick error:", err.message);
  }
  await db.read();
  const intervalMs = Math.max(2, Number(db.data.hardware.poll_interval_seconds) || 10) * 1000;
  timer = setTimeout(loop, intervalMs);
}

function start() {
  if (running) return;
  running = true;
  loop();
}

function stop() {
  running = false;
  if (timer) clearTimeout(timer);
  for (const client of clientPool.values()) {
    try { client.close(() => {}); } catch (err) { /* ignore */ }
  }
  clientPool.clear();
}

module.exports = { start, stop, tick };
