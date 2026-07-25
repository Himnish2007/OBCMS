const { db, save, nextId } = require("../db/db");
const { notifyAlert } = require("./notify");

const MAX_READINGS_PER_AXLE = 40;
const MAX_TELEMETRY_PER_PARAM = 30;

const BAND_ORDER = ["GREEN", "YELLOW", "ORANGE", "RED"];

function bandFor(value, t) {
  if (value < t.yellow) return "GREEN";
  if (value < t.orange) return "YELLOW";
  if (value < t.red) return "ORANGE";
  return "RED";
}

function worstBand(a, b) {
  return BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b;
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function tick() {
  await db.read();
  if ((db.data.hardware && db.data.hardware.data_source) !== "demo") return; // Settings > Data Source is set to Live — let ingestion.js drive data instead
  const now = new Date().toISOString();
  const thresholds = db.data.thresholds;

  const coaches = db.data.coaches;
  coaches.forEach((coach) => {
    const axles = db.data.axles.filter((a) => a.coach_id === coach.id);
    // Occasionally bias one axle towards deterioration to create realistic alerts
    const biasedIdx = Math.random() < 0.12 ? Math.floor(Math.random() * axles.length) : -1;

    axles.forEach((axle, idx) => {
      let vibration, temperature;
      if (idx === biasedIdx) {
        vibration = randBetween(260, 480);
        temperature = randBetween(88, 112);
      } else {
        vibration = randBetween(20, 180);
        temperature = randBetween(28, 68);
      }
      const speed = randBetween(0, 130);

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

      // Trim history per axle
      const axleReadings = db.data.readings.filter((r) => r.axle_id === axle.id);
      if (axleReadings.length > MAX_READINGS_PER_AXLE) {
        const excess = axleReadings
          .sort((a, b) => new Date(a.ts) - new Date(b.ts))
          .slice(0, axleReadings.length - MAX_READINGS_PER_AXLE)
          .map((r) => r.id);
        db.data.readings = db.data.readings.filter((r) => !excess.includes(r.id));
      }

      // Raise alert for Orange/Red bands
      if (band === "ORANGE" || band === "RED") {
        const openAlert = db.data.alerts.find(
          (a) => a.axle_id === axle.id && !a.acknowledged && a.band === band
        );
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
          // Fire-and-forget: route the alert to whichever user(s) have this coach assigned.
          // Real delivery depends on SMTP/SMS being configured in Admin > Notifications.
          notifyAlert(newAlert, coach).catch((err) => console.error("notifyAlert error:", err.message));
        }
      }
    });

    // PICCU telemetry simulation
    const telemetryParams = [
      { param: "HVAC_Supply_Temp_C", value: randBetween(22, 26), unit: "°C" },
      { param: "HVAC_Return_Temp_C", value: randBetween(24, 30), unit: "°C" },
      { param: "Battery_Voltage_V", value: randBetween(108, 118), unit: "V" },
      { param: "Battery_Current_A", value: randBetween(5, 22), unit: "A" },
      { param: "Network_Power_kW", value: randBetween(4, 9), unit: "kW" },
      { param: "Insulation_Status", value: Math.random() > 0.03 ? 1 : 0, unit: "OK=1" },
    ];
    telemetryParams.forEach((t) => {
      db.data.piccuTelemetry.push({
        id: nextId(db.data.piccuTelemetry),
        coach_id: coach.id,
        param: t.param,
        value: Number(Number(t.value).toFixed(2)),
        unit: t.unit,
        ts: now,
      });
      const paramHistory = db.data.piccuTelemetry.filter(
        (p) => p.coach_id === coach.id && p.param === t.param
      );
      if (paramHistory.length > MAX_TELEMETRY_PER_PARAM) {
        const excess = paramHistory
          .sort((a, b) => new Date(a.ts) - new Date(b.ts))
          .slice(0, paramHistory.length - MAX_TELEMETRY_PER_PARAM)
          .map((p) => p.id);
        db.data.piccuTelemetry = db.data.piccuTelemetry.filter((p) => !excess.includes(p.id));
      }
    });

    // Occasionally flip a PICCU system to Fault/Offline then recover
    if (Math.random() < 0.02) {
      const systems = db.data.piccuSystems.filter((p) => p.coach_id === coach.id);
      const target = systems[Math.floor(Math.random() * systems.length)];
      if (target) { target.status = Math.random() < 0.5 ? "Fault" : "Offline"; target.last_update = now; }
    } else {
      const systems = db.data.piccuSystems.filter((p) => p.coach_id === coach.id && p.status !== "Online");
      systems.forEach((s) => {
        if (Math.random() < 0.3) { s.status = "Online"; s.last_update = now; }
      });
    }
  });

  await save();
}

let timer = null;
let running = false;

async function loop() {
  if (!running) return;
  try {
    await tick();
  } catch (err) {
    console.error("Simulator tick error:", err.message);
  }
  await db.read();
  const intervalMs = Math.max(2, Number(db.data.settings.log_interval_seconds) || 8) * 1000;
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
}

module.exports = { start, stop, tick, bandFor, worstBand };
