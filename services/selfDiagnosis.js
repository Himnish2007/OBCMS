// ============================================================================
// SELF-DIAGNOSIS — MDTS:44415 Part A pt.1 ("shall incorporate self-diagnostic
// capability to monitor its own health") and pt.23 ("analysis software should be
// smart enough to do self-diagnosis... recheck shall be done ... to avoid false
// positive"), and Part B miscellaneous ("PICCU shall have self-diagnosis function
// to detect any error related to transfer data from individual electronic systems").
//
// Two independent checks, run every minute from services/scheduler.js:
//
// 1. STALENESS — an axle (WSN) or PICCU sub-system that hasn't produced a fresh
//    reading in longer than Settings > sensor_stale_minutes is flagged STALE.
//    This is the practical, always-available form of "self-diagnosis" for a
//    push-model system: the sensor/DC itself can't phone home to say "I'm dying",
//    but silence past the expected interval is the signal we can act on.
//
// 2. STUCK-AT VALUE — if the last N vibration/temperature readings from an axle are
//    all numerically identical (zero variance) while the coach was moving above the
//    logging speed gate, that's the classic failure mode of a sensor stuck at its
//    last valid value rather than actually failing silent. Flagged as FAULT.
//
// A DC (data concentrator / RUT device) itself is diagnosed the same way via
// rutDevices[].last_seen_at, which is already updated on every successful push.
// ============================================================================

const { db, save, nextId } = require("../db/db");

const STUCK_SAMPLE_COUNT = 5;

function minutesSince(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / 60000;
}

function diagnoseAxle(axle, staleMinutes) {
  const readings = db.data.readings
    .filter((r) => r.axle_id === axle.id)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const last = readings[readings.length - 1];
  const now = new Date().toISOString();

  if (!last) {
    axle.sensor_health = "UNKNOWN";
    axle.sensor_health_detail = "No readings received yet.";
    axle.sensor_health_checked_at = now;
    return null;
  }

  const ageMin = minutesSince(last.ts);
  if (ageMin > staleMinutes) {
    const changed = axle.sensor_health !== "STALE";
    axle.sensor_health = "STALE";
    axle.sensor_health_detail = `No reading for ${Math.round(ageMin)} min (threshold ${staleMinutes} min).`;
    axle.sensor_health_checked_at = now;
    return changed ? { type: "stale", axle } : null;
  }

  const recent = readings.slice(-STUCK_SAMPLE_COUNT);
  if (recent.length >= STUCK_SAMPLE_COUNT) {
    const vibVariance = new Set(recent.map((r) => r.vibration_g)).size === 1;
    const tempVariance = new Set(recent.map((r) => r.temperature_c)).size === 1;
    const movingWhileFlat = recent.some((r) => (r.speed_kmph || 0) > 5) && (vibVariance || tempVariance);
    if (movingWhileFlat) {
      const changed = axle.sensor_health !== "FAULT";
      axle.sensor_health = "FAULT";
      axle.sensor_health_detail =
        `Last ${STUCK_SAMPLE_COUNT} readings show a stuck-at value while coach was moving ` +
        `(${vibVariance ? "vibration" : "temperature"} unchanged) — possible sensor fault.`;
      axle.sensor_health_checked_at = now;
      return changed ? { type: "fault", axle } : null;
    }
  }

  // Recovered / healthy — clear any stale FAULT/STALE state. No alert needed for a recovery.
  axle.sensor_health = "OK";
  axle.sensor_health_detail = null;
  axle.sensor_health_checked_at = now;
  return null;
}

async function runSelfDiagnosisSweep() {
  await db.read();
  const staleMinutes = Number(db.data.settings.sensor_stale_minutes) || 30;
  let raised = 0;

  for (const axle of db.data.axles) {
    const coach = db.data.coaches.find((c) => c.id === axle.coach_id);
    if (!coach) continue;
    const result = diagnoseAxle(axle, staleMinutes);
    if (!result) continue;

    const openAlert = db.data.alerts.find(
      (a) => a.axle_id === axle.id && !a.acknowledged && a.parameter === "self_diagnosis"
    );
    if (openAlert) continue;

    db.data.alerts.push({
      id: nextId(db.data.alerts),
      coach_id: coach.id,
      axle_id: axle.id,
      axle_number: axle.axle_number,
      severity: result.type === "fault" ? "High" : "Medium",
      band: result.type === "fault" ? "ORANGE" : "YELLOW",
      parameter: "self_diagnosis",
      message: `Axle-${axle.axle_number} on ${coach.coach_number}: self-diagnosis flagged ${axle.sensor_health} — ${axle.sensor_health_detail}`,
      created_at: new Date().toISOString(),
      acknowledged: false,
    });
    raised++;
  }

  // DC-level: any RUT device silent past the same threshold is a communication-hub fault,
  // separate from an individual axle sensor fault (Part A pt.10: "damage to wireless sensors...
  // warning shall be generated").
  for (const device of db.data.rutDevices) {
    if (!device.current_coach_id) continue;
    const ageMin = minutesSince(device.last_seen_at);
    device.comm_health = ageMin > staleMinutes ? "FAULT" : "OK";
  }

  if (raised > 0) await save();
  else await save(); // still persist updated sensor_health/comm_health fields even with no new alert
  return { raised };
}

module.exports = { runSelfDiagnosisSweep, diagnoseAxle };
