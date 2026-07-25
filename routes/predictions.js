const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

// Simple linear regression slope (least squares) over an array of {x, y}
function slope(points) {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

router.get("/", async (req, res) => {
  await db.read();
  const thresholds = db.data.thresholds;
  const intervalSeconds = Number(db.data.settings.log_interval_seconds) || 8;
  const results = [];

  db.data.axles.forEach((axle) => {
    const readings = db.data.readings
      .filter((r) => r.axle_id === axle.id)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (readings.length < 5) return; // not enough history to trend

    const coach = db.data.coaches.find((c) => c.id === axle.coach_id);
    const vibPoints = readings.map((r, i) => ({ x: i, y: r.vibration_g }));
    const tempPoints = readings.map((r, i) => ({ x: i, y: r.temperature_c }));
    const vibSlope = slope(vibPoints);
    const tempSlope = slope(tempPoints);
    const currentVib = readings[readings.length - 1].vibration_g;
    const currentTemp = readings[readings.length - 1].temperature_c;
    const currentBand = readings[readings.length - 1].band;

    function projection(current, rate, t) {
      // rate = change per reading interval. Only meaningful if trending upward.
      if (rate <= 0.01) return { target: null, readings_to_breach: null, eta_minutes: null };
      let target = null;
      if (current < t.yellow) target = t.yellow;
      else if (current < t.orange) target = t.orange;
      else if (current < t.red) target = t.red;
      else return { target: null, readings_to_breach: null, eta_minutes: null };
      const readingsToBreach = Math.ceil((target - current) / rate);
      return {
        target,
        readings_to_breach: readingsToBreach,
        eta_minutes: Math.round((readingsToBreach * intervalSeconds) / 60),
      };
    }

    const vibProjection = projection(currentVib, vibSlope, thresholds.vibration);
    const tempProjection = projection(currentTemp, tempSlope, thresholds.temperature);

    // Pick the sooner of the two projections (if any)
    let driver = null;
    if (vibProjection.eta_minutes !== null && tempProjection.eta_minutes !== null) {
      driver = vibProjection.eta_minutes <= tempProjection.eta_minutes ? "vibration" : "temperature";
    } else if (vibProjection.eta_minutes !== null) driver = "vibration";
    else if (tempProjection.eta_minutes !== null) driver = "temperature";

    const chosen = driver === "vibration" ? vibProjection : driver === "temperature" ? tempProjection : null;

    results.push({
      axle_id: axle.id,
      axle_number: axle.axle_number,
      coach_number: coach ? coach.coach_number : "-",
      current_band: currentBand,
      current_vibration_g: currentVib,
      current_temperature_c: currentTemp,
      vibration_trend: vibSlope > 0.01 ? "rising" : vibSlope < -0.01 ? "falling" : "stable",
      temperature_trend: tempSlope > 0.01 ? "rising" : tempSlope < -0.01 ? "falling" : "stable",
      driver_parameter: driver,
      predicted_next_threshold: chosen ? chosen.target : null,
      estimated_minutes_to_breach: chosen ? chosen.eta_minutes : null,
    });
  });

  results.sort((a, b) => {
    const aEta = a.estimated_minutes_to_breach ?? Infinity;
    const bEta = b.estimated_minutes_to_breach ?? Infinity;
    return aEta - bEta;
  });

  res.json({
    note: "Indicative prediction based on a linear trend over the most recent readings for each axle. Not a substitute for the certified OBCMS predictive algorithm required by MDTS:44415.",
    predictions: results,
  });
});

module.exports = router;
