const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds } = require("../services/access");

const router = express.Router();

// ============================================================================
// PREDICTION METHODOLOGY (upgraded from a plain two-point linear trend)
//
// This is still a statistical heuristic, NOT the certified, historical-failure-trained
// predictive model MDTS:44415 calls for — that needs a labeled failure dataset which
// does not exist yet for this fleet. services/../routes/maintenance.js is how that
// dataset starts getting built (every bearing/axle/sensor replacement or inspection is
// logged there, snapshotted against sensor readings at the time). Once there's enough of
// that history, it can train a real model to replace this. Until then, this endpoint:
//
//   1. Resets its baseline at the most recent bearing/axle/sensor replacement for that
//      axle (routes/maintenance.js) — degradation trend from before a part was replaced
//      isn't relevant to the part that's in there now.
//   2. Uses WEIGHTED least-squares regression (exponential decay — recent readings count
//      more than older ones) instead of a plain two-point slope, so a stale outlier
//      reading doesn't swing the estimate.
//   3. Reports an R²-based confidence score, so a noisy/inconsistent trend is visibly
//      flagged as low-confidence rather than presented with false precision.
//   4. Flags whether the rate of change is itself accelerating (comparing the trend in
//      the second half of the window vs the first half) — useful because real bearing
//      degradation is often non-linear (slow, then fast), which a single straight-line
//      fit alone would understate.
// ============================================================================

const DECAY = 0.90; // exponential recency weighting — most recent reading has weight 1, each older one *0.90
const MIN_READINGS = 5;

// Weighted least-squares slope + intercept + R² (weighted).
function weightedRegression(points) {
  const n = points.length;
  let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWXX = 0;
  points.forEach((p) => {
    sumW += p.w; sumWX += p.w * p.x; sumWY += p.w * p.y;
    sumWXY += p.w * p.x * p.y; sumWXX += p.w * p.x * p.x;
  });
  const denom = sumW * sumWXX - sumWX * sumWX;
  const slope = denom === 0 ? 0 : (sumW * sumWXY - sumWX * sumWY) / denom;
  const intercept = sumW === 0 ? 0 : (sumWY - slope * sumWX) / sumW;

  const yBar = sumW === 0 ? 0 : sumWY / sumW;
  let ssRes = 0, ssTot = 0;
  points.forEach((p) => {
    const predicted = intercept + slope * p.x;
    ssRes += p.w * (p.y - predicted) ** 2;
    ssTot += p.w * (p.y - yBar) ** 2;
  });
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2, n };
}

function buildWeightedPoints(readings, key) {
  const n = readings.length;
  return readings.map((r, i) => ({
    x: i,
    y: r[key],
    w: Math.pow(DECAY, n - 1 - i), // index 0 (oldest) gets the smallest weight
  }));
}

// Confidence: combines fit quality (R²) with sample size — a perfect-looking trend from
// only 5 readings is less trustworthy than the same fit from 30.
function confidenceScore(r2, n) {
  const sampleFactor = Math.min(1, n / 20);
  const score = r2 * sampleFactor;
  let label = "Low";
  if (score >= 0.7) label = "High";
  else if (score >= 0.4) label = "Medium";
  return { score: Number(score.toFixed(2)), label };
}

// Compares the trend in the second half of the window against the first half to flag
// whether degradation is accelerating — real bearing wear is often non-linear.
function accelerationFlag(readings, key) {
  if (readings.length < 6) return "insufficient_data";
  const mid = Math.floor(readings.length / 2);
  const first = readings.slice(0, mid).map((r, i) => ({ x: i, y: r[key] }));
  const second = readings.slice(mid).map((r, i) => ({ x: i, y: r[key] }));
  const s1 = simpleSlope(first);
  const s2 = simpleSlope(second);
  if (s2 > s1 * 1.3 && s2 > 0.01) return "accelerating";
  if (s2 < s1 * 0.7) return "decelerating";
  return "steady";
}

function simpleSlope(points) {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function projection(current, rate, t) {
  if (rate <= 0.01) return { target: null, readings_to_breach: null, eta_minutes: null };
  let target = null;
  if (current < t.yellow) target = t.yellow;
  else if (current < t.orange) target = t.orange;
  else if (current < t.red) target = t.red;
  else return { target: null, readings_to_breach: null, eta_minutes: null };
  const readingsToBreach = Math.ceil((target - current) / rate);
  return { target, readings_to_breach: readingsToBreach };
}

router.get("/", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const thresholds = db.data.thresholds;
  const intervalSeconds = Number(db.data.settings.log_interval_seconds) || 8;
  const results = [];

  db.data.axles.filter((a) => allowed.has(a.coach_id)).forEach((axle) => {
    let readings = db.data.readings
      .filter((r) => r.axle_id === axle.id)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    // Reset the baseline at the most recent part replacement — degradation trend from a
    // bearing/axle/sensor that's no longer in service isn't relevant to the one now fitted.
    const lastReplacement = db.data.maintenanceEvents
      .filter((e) => e.axle_id === axle.id && ["bearing_replaced", "axle_replaced", "sensor_replaced"].includes(e.event_type))
      .sort((a, b) => new Date(b.event_at) - new Date(a.event_at))[0];
    if (lastReplacement) {
      readings = readings.filter((r) => new Date(r.ts) >= new Date(lastReplacement.event_at));
    }

    if (readings.length < MIN_READINGS) return;

    const coach = db.data.coaches.find((c) => c.id === axle.coach_id);
    const vibReg = weightedRegression(buildWeightedPoints(readings, "vibration_g"));
    const tempReg = weightedRegression(buildWeightedPoints(readings, "temperature_c"));
    const currentVib = readings[readings.length - 1].vibration_g;
    const currentTemp = readings[readings.length - 1].temperature_c;
    const currentBand = readings[readings.length - 1].band;

    const vibProjection = projection(currentVib, vibReg.slope, thresholds.vibration);
    const tempProjection = projection(currentTemp, tempReg.slope, thresholds.temperature);
    const vibConfidence = confidenceScore(vibReg.r2, vibReg.n);
    const tempConfidence = confidenceScore(tempReg.r2, tempReg.n);

    const vibEta = vibProjection.readings_to_breach !== null ? Math.round((vibProjection.readings_to_breach * intervalSeconds) / 60) : null;
    const tempEta = tempProjection.readings_to_breach !== null ? Math.round((tempProjection.readings_to_breach * intervalSeconds) / 60) : null;

    let driver = null;
    if (vibEta !== null && tempEta !== null) driver = vibEta <= tempEta ? "vibration" : "temperature";
    else if (vibEta !== null) driver = "vibration";
    else if (tempEta !== null) driver = "temperature";

    const chosenEta = driver === "vibration" ? vibEta : driver === "temperature" ? tempEta : null;
    const chosenTarget = driver === "vibration" ? vibProjection.target : driver === "temperature" ? tempProjection.target : null;
    const chosenConfidence = driver === "vibration" ? vibConfidence : driver === "temperature" ? tempConfidence : null;

    results.push({
      axle_id: axle.id,
      axle_number: axle.axle_number,
      coach_number: coach ? coach.coach_number : "-",
      current_band: currentBand,
      current_vibration_g: currentVib,
      current_temperature_c: currentTemp,
      readings_since_last_service: readings.length,
      baseline_reset_at: lastReplacement ? lastReplacement.event_at : null,
      vibration_trend: vibReg.slope > 0.01 ? "rising" : vibReg.slope < -0.01 ? "falling" : "stable",
      temperature_trend: tempReg.slope > 0.01 ? "rising" : tempReg.slope < -0.01 ? "falling" : "stable",
      vibration_acceleration: accelerationFlag(readings, "vibration_g"),
      temperature_acceleration: accelerationFlag(readings, "temperature_c"),
      driver_parameter: driver,
      predicted_next_threshold: chosenTarget,
      estimated_minutes_to_breach: chosenEta,
      confidence: chosenConfidence,
    });
  });

  results.sort((a, b) => (a.estimated_minutes_to_breach ?? Infinity) - (b.estimated_minutes_to_breach ?? Infinity));

  res.json({
    note: "Indicative prediction using weighted linear-trend regression (recent readings weighted more heavily), reset at the last logged part replacement, with acceleration detection and an R²-based confidence score. This is a statistical heuristic, not the certified, historical-failure-trained predictive algorithm required by MDTS:44415 — maintenance/failure events are now being logged (see Maintenance Log) to build the dataset a real model would need.",
    methodology: {
      regression: "weighted least-squares, exponential recency decay (0.90^age)",
      confidence: "R\u00b2 \u00d7 min(1, readings/20), thresholded Low/Medium/High",
      acceleration: "second-half trend vs first-half trend over the current window",
      baseline_reset: "windows restart at the most recent bearing/axle/sensor replacement logged for that axle",
    },
    predictions: results,
  });
});

module.exports = router;
