// ============================================================================
// WHEEL FLAT / SHELLING RISK DETECTION — MDTS:44415 Part A, deliverable pt.11
//
// Spec text: "The wheel condition monitoring system must be able to detect defects
// arising of Rolling contact fatigue like wheel shelling/wheel flats/subsurface
// defects/thermal crack in wheel. It should give actionable alerts in advance
// before reaching the limit of wheel shelling (40mm & 1.5mm length & depth) &
// wheel flat (50mm)."
//
// IMPORTANT HONEST LIMITATION: this dashboard only receives per-axle vibration_g /
// temperature_c readings over a wireless push — it has no profilometer, ultrasonic
// probe, or raw high-rate waveform capture. It CANNOT measure an actual flat/shelling
// size in mm. What it CAN do from vibration alone is flag the *signature* of a
// flat/shelled wheel: instead of smooth, evenly-distributed vibration, a damaged
// wheel produces a sharp, periodic impact once per wheel revolution, so the peak
// reading in a short rolling window is much higher than the window's median.
//
// impact_factor = peak(window) / median(window)
//
// This is used as a proxy risk index, banded the same way the spec bands bearing/
// suspension/track condition (Green/Yellow/Orange/Red), so the operator response
// workflow (visualize -> band -> alert -> inspect) stays consistent across all
// axle-related checks. Treat ORANGE/RED as "schedule a wheel inspection", not as a
// certified mm measurement — RCF's own wheel-lathe/profilometer reading is still the
// authority on actual shelling/flat size.
// ============================================================================

const { db, nextId } = require("../db/db");

const WINDOW_SIZE = 8; // rolling window of most-recent readings per axle
const MIN_SAMPLES = 5; // don't judge on too few points

function median(sortedArr) {
  const n = sortedArr.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedArr[mid - 1] + sortedArr[mid]) / 2 : sortedArr[mid];
}

// Pure calculation — exported separately so it's unit-testable without touching the db.
function computeImpactFactor(vibrationReadingsAsc) {
  if (!Array.isArray(vibrationReadingsAsc) || vibrationReadingsAsc.length < MIN_SAMPLES) return null;
  const window = vibrationReadingsAsc.slice(-WINDOW_SIZE);
  const sorted = [...window].sort((a, b) => a - b);
  const med = median(sorted);
  const peak = sorted[sorted.length - 1];
  if (!med || med <= 0) return null;
  return { impactFactor: peak / med, peak, median: med, sampleCount: window.length };
}

function bandForImpactFactor(impactFactor, cfg) {
  const t = cfg || { yellow: 2.2, orange: 2.8, red: 3.5 };
  if (impactFactor >= t.red) return "RED";
  if (impactFactor >= t.orange) return "ORANGE";
  if (impactFactor >= t.yellow) return "YELLOW";
  return "GREEN";
}

// Called from services/ingestion.js right after a new reading is stored for an axle.
// Returns the newly-created alert (if any) so the caller can notify() it, same as the
// existing vibration/temperature alert path.
function evaluateWheelDefect(axle, coach) {
  const readings = db.data.readings
    .filter((r) => r.axle_id === axle.id)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .map((r) => r.vibration_g);

  const result = computeImpactFactor(readings);
  const now = new Date().toISOString();

  if (!result) {
    axle.wheel_defect_checked_at = now;
    return null;
  }

  const band = bandForImpactFactor(result.impactFactor, db.data.thresholds.wheel_defect_impact_factor);
  axle.wheel_defect_band = band;
  axle.wheel_defect_impact_factor = Number(result.impactFactor.toFixed(2));
  axle.wheel_defect_checked_at = now;

  if (band !== "ORANGE" && band !== "RED") return null;

  const openAlert = db.data.alerts.find(
    (a) => a.axle_id === axle.id && !a.acknowledged && a.parameter === "wheel_defect" && a.band === band
  );
  if (openAlert) return null;

  const alert = {
    id: nextId(db.data.alerts),
    coach_id: coach.id,
    axle_id: axle.id,
    axle_number: axle.axle_number,
    severity: band === "RED" ? "Critical" : "High",
    band,
    parameter: "wheel_defect",
    message:
      `Axle-${axle.axle_number} on ${coach.coach_number}: periodic vibration shock pattern detected ` +
      `(impact factor ${result.impactFactor.toFixed(2)}x rolling median) — signature consistent with a ` +
      `wheel flat/shelling per MDTS:44415 Part A pt.11. This is a vibration-signature proxy, not a mm ` +
      `measurement — schedule a wheel-profile inspection before the 40mm/1.5mm shelling or 50mm flat limit.`,
    created_at: now,
    acknowledged: false,
  };
  db.data.alerts.push(alert);
  return alert;
}

module.exports = { evaluateWheelDefect, computeImpactFactor, bandForImpactFactor, WINDOW_SIZE, MIN_SAMPLES };
