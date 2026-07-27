// ============================================================================
// LIVE HARDWARE INGESTION — PUSH MODEL
//
// RUT routers are mobile hardware: the same physical unit gets moved between
// trains as rakes are reshuffled, so we never hardcode "this coach lives at
// this IP". Instead, each RUT is registered once in Settings > RUT Device
// Assignment with a fixed device_key. A Lua script on the RUT (same pattern
// as the LOCO TM CMS / EMU TM push scripts) polls the coach's local BNI00L1
// masters over Modbus TCP and HTTP-POSTs the readings up to this server.
// Whichever coach that device_key is CURRENTLY assigned to (Settings > RUT
// Device Assignment) is where the data gets logged — reassigning a device
// there is all that's needed after the router physically moves to another
// train, no redeploy, no touching the RUT's own config.
//
// Push contract — POST /api/ingest/push
// {
//   "apiKey": "<device_key from Settings > RUT Device Assignment>",
//   "speed_kmph": 62,                                  // optional, shared across axles
//   "gps": { "lat": 28.6692, "lon": 77.4538 },          // optional — GNSS fix at time of reading (MDTS:44415)
//   "axles": [                                          // optional, 1-8 entries
//     { "axle_number": 1, "vibration_g": 0.42, "temperature_c": 38.5 }
//   ],
//   "piccu_status": { "WLI": "Online", "CCTV": "Fault" },   // optional, system_name -> "Online"|"Fault"
//   "wli_tank_level_pct": 62.5,                          // optional — WLI tank fill %, 0-100
//   "telemetry": [                                      // optional, HVAC/Battery/WLI etc via BNI00AJ
//     { "param": "Battery_Voltage_V", "value": 110.2, "unit": "V" }
//   ]
// }
//
// Only writes data when Settings > Data Source is set to "Live Hardware" —
// while in "Simulated Data" mode, pushes are accepted (200 OK) but ignored,
// so a RUT that's already live in the field never sees errors either way.
//
// Speed gating (MDTS:44415 Rev.02): axle readings are only logged when
// speed_kmph is at/above Settings > min_logging_speed_kmph (default 15 kmph).
// GPS and PICCU/telemetry data are logged regardless of speed, since those
// aren't spec-gated the same way axle vibration/temperature readings are.
// ============================================================================

const { db, save, nextId } = require("../db/db");
const { bandFor, worstBand } = require("./simulator");
const { notifyAlert } = require("./notify");

const MAX_READINGS_PER_AXLE = 40;
const MAX_TELEMETRY_PER_PARAM = 30;

class IngestionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function processPush(payload) {
  await db.read();

  const apiKey = payload && payload.apiKey;
  if (!apiKey) throw new IngestionError(400, "apiKey is required");

  const device = db.data.rutDevices.find((d) => d.device_key === apiKey);
  if (!device) throw new IngestionError(401, "Unknown device API key");

  device.last_seen_at = new Date().toISOString();

  if (!device.current_coach_id) {
    await save();
    throw new IngestionError(409, `RUT "${device.label}" is not currently assigned to any coach — assign it from Settings > RUT Device Assignment.`);
  }

  const coach = db.data.coaches.find((c) => c.id === device.current_coach_id);
  if (!coach) {
    await save();
    throw new IngestionError(409, `RUT "${device.label}" is assigned to a coach that no longer exists.`);
  }

  // Demo mode: acknowledge but don't write, so a live RUT in the field never errors out
  // just because Settings > Data Source hasn't been flipped to "Live Hardware" yet.
  if (db.data.hardware.data_source !== "live") {
    await save();
    return { accepted: false, reason: "Data Source is set to Simulated Data — push ignored.", coach_number: coach.coach_number };
  }

  const now = new Date().toISOString();
  const thresholds = db.data.thresholds;
  const speed = Number(payload.speed_kmph) || 0;
  const minLoggingSpeed = Number(db.data.settings.min_logging_speed_kmph) || 0;
  const gps = payload.gps && Number.isFinite(Number(payload.gps.lat)) && Number.isFinite(Number(payload.gps.lon))
    ? { lat: Number(payload.gps.lat), lon: Number(payload.gps.lon) }
    : null;
  let axlesLogged = 0;
  let axlesSuppressedBySpeed = 0;

  // Speed gating per MDTS:44415: below the configured minimum speed, axle vibration/
  // temperature readings are not logged at all (a stationary/slow coach's vibration
  // signature isn't meaningful and would pollute trend/alert data). GPS, PICCU status
  // and general telemetry are NOT speed-gated and are still processed below.
  const speedGateOpen = speed >= minLoggingSpeed;
  if (Array.isArray(payload.axles) && !speedGateOpen) {
    axlesSuppressedBySpeed = payload.axles.length;
  }

  if (Array.isArray(payload.axles) && speedGateOpen) {
    for (const entry of payload.axles) {
      const axle = db.data.axles.find((a) => a.coach_id === coach.id && a.axle_number === Number(entry.axle_number));
      if (!axle) continue;
      const vibration = Number(entry.vibration_g);
      const temperature = Number(entry.temperature_c);
      if (Number.isNaN(vibration) || Number.isNaN(temperature)) continue;
      // (GPS is attached to each reading below via the `gps` var captured from the payload.)

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
        lat: gps ? gps.lat : null,
        lon: gps ? gps.lon : null,
        vibration_band: vibBand,
        temperature_band: tempBand,
        band,
      };
      db.data.readings.push(reading);
      axlesLogged++;

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

  if (payload.wli_tank_level_pct !== undefined) {
    const pct = Number(payload.wli_tank_level_pct);
    if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
      coach.wli_tank_level_pct = Number(pct.toFixed(1));
      coach.wli_tank_level_updated_at = now;
    }
  }

  if (payload.piccu_status && typeof payload.piccu_status === "object") {
    const systems = db.data.piccuSystems.filter((p) => p.coach_id === coach.id);
    Object.entries(payload.piccu_status).forEach(([systemName, status]) => {
      const system = systems.find((s) => s.system_name === systemName);
      if (!system) return;
      const newStatus = status === "Online" || status === "Fault" ? status : "Fault";
      if (system.status !== newStatus) { system.status = newStatus; system.last_update = now; }
    });
  }

  if (Array.isArray(payload.telemetry)) {
    for (const item of payload.telemetry) {
      if (!item || !item.param) continue;
      const value = Number(item.value);
      if (Number.isNaN(value)) continue;
      db.data.piccuTelemetry.push({
        id: nextId(db.data.piccuTelemetry), coach_id: coach.id, param: item.param, value, unit: item.unit || "", ts: now,
      });
      const history = db.data.piccuTelemetry.filter((p) => p.coach_id === coach.id && p.param === item.param);
      if (history.length > MAX_TELEMETRY_PER_PARAM) {
        const excess = history.sort((a, b) => new Date(a.ts) - new Date(b.ts)).slice(0, history.length - MAX_TELEMETRY_PER_PARAM).map((p) => p.id);
        db.data.piccuTelemetry = db.data.piccuTelemetry.filter((p) => !excess.includes(p.id));
      }
    }
  }

  await save();
  return {
    accepted: true,
    coach_number: coach.coach_number,
    axles_logged: axlesLogged,
    axles_suppressed_by_speed: axlesSuppressedBySpeed,
    gps: gps || undefined,
    logged_at: now,
  };
}

module.exports = { processPush, IngestionError };
