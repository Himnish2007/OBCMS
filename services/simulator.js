const { db, save, nextId } = require("../db/db");

const MAX_READINGS_PER_SENSOR = 40;
const MAX_TELEMETRY_PER_PARAM = 30;

function bandFromVibration(g) {
  if (g < 150) return "GREEN";
  if (g < 250) return "YELLOW";
  if (g < 380) return "ORANGE";
  return "RED";
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickBiasedSensorIndexes(total) {
  // Occasionally bias one sensor towards deterioration to create realistic alerts
  if (Math.random() < 0.12) {
    return Math.floor(Math.random() * total);
  }
  return -1;
}

async function tick() {
  await db.read();
  const now = new Date().toISOString();

  const coaches = db.data.coaches;
  coaches.forEach((coach) => {
    const sensors = db.data.sensors.filter((s) => s.coach_id === coach.id);
    const biasedIdx = pickBiasedSensorIndexes(sensors.length);

    sensors.forEach((sensor, idx) => {
      let vibration;
      if (idx === biasedIdx) {
        vibration = randBetween(260, 480); // push towards Orange/Red occasionally
      } else {
        vibration = randBetween(20, 180); // mostly healthy
      }
      const temperature = randBetween(28, 78) + (vibration > 300 ? randBetween(5, 20) : 0);
      const band = bandFromVibration(vibration);
      const speed = randBetween(0, 130);

      const reading = {
        id: nextId(db.data.readings),
        sensor_id: sensor.id,
        coach_id: coach.id,
        ts: now,
        vibration_g: Number(vibration.toFixed(1)),
        temperature_c: Number(temperature.toFixed(1)),
        speed_kmph: Number(speed.toFixed(0)),
        band,
      };
      db.data.readings.push(reading);

      // Trim history per sensor
      const sensorReadings = db.data.readings.filter((r) => r.sensor_id === sensor.id);
      if (sensorReadings.length > MAX_READINGS_PER_SENSOR) {
        const excess = sensorReadings
          .sort((a, b) => new Date(a.ts) - new Date(b.ts))
          .slice(0, sensorReadings.length - MAX_READINGS_PER_SENSOR)
          .map((r) => r.id);
        db.data.readings = db.data.readings.filter((r) => !excess.includes(r.id));
      }

      // Raise alert for Orange/Red bands
      if (band === "ORANGE" || band === "RED") {
        const openAlert = db.data.alerts.find(
          (a) => a.sensor_id === sensor.id && !a.acknowledged && a.band === band
        );
        if (!openAlert) {
          db.data.alerts.push({
            id: nextId(db.data.alerts),
            coach_id: coach.id,
            sensor_id: sensor.id,
            severity: band === "RED" ? "Critical" : "High",
            band,
            message: `${sensor.type.toUpperCase()} anomaly detected at ${sensor.location} (${coach.coach_number}) — vibration ${reading.vibration_g}g, temp ${reading.temperature_c}°C.`,
            created_at: now,
            acknowledged: false,
          });
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
      target.status = Math.random() < 0.5 ? "Fault" : "Offline";
      target.last_update = now;
    } else {
      const systems = db.data.piccuSystems.filter((p) => p.coach_id === coach.id && p.status !== "Online");
      systems.forEach((s) => {
        if (Math.random() < 0.3) {
          s.status = "Online";
          s.last_update = now;
        }
      });
    }
  });

  await save();
}

function start(intervalMs = 8000) {
  tick(); // run once immediately
  return setInterval(() => {
    tick().catch((err) => console.error("Simulator tick error:", err.message));
  }, intervalMs);
}

module.exports = { start, tick };
