const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

router.get("/overview", async (req, res) => {
  await db.read();

  // Band distribution across all axles (latest reading each)
  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  const byRakeType = {}; // { LHB: {vibSum, tempSum, count}, "Vande Bharat": {...} }

  db.data.axles.forEach((axle) => {
    const readings = db.data.readings.filter((r) => r.axle_id === axle.id);
    const latest = readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
    if (!latest) return;
    bandCounts[latest.band] = (bandCounts[latest.band] || 0) + 1;

    const coach = db.data.coaches.find((c) => c.id === axle.coach_id);
    const rake = coach ? db.data.rakes.find((r) => r.id === coach.rake_id) : null;
    const type = rake ? rake.rake_type : "Unknown";
    byRakeType[type] ||= { vibSum: 0, tempSum: 0, count: 0 };
    byRakeType[type].vibSum += latest.vibration_g;
    byRakeType[type].tempSum += latest.temperature_c;
    byRakeType[type].count += 1;
  });

  const rakeTypeComparison = Object.entries(byRakeType).map(([type, v]) => ({
    rake_type: type,
    avg_vibration_g: v.count ? Number((v.vibSum / v.count).toFixed(1)) : 0,
    avg_temperature_c: v.count ? Number((v.tempSum / v.count).toFixed(1)) : 0,
    axle_count: v.count,
  }));

  // Alerts by coach (top alert-prone coaches)
  const alertsByCoach = {};
  db.data.alerts.forEach((a) => {
    alertsByCoach[a.coach_id] = (alertsByCoach[a.coach_id] || 0) + 1;
  });
  const topAlertCoaches = Object.entries(alertsByCoach)
    .map(([coachId, count]) => {
      const coach = db.data.coaches.find((c) => c.id === Number(coachId));
      return { coach_number: coach ? coach.coach_number : "-", alert_count: count };
    })
    .sort((a, b) => b.alert_count - a.alert_count)
    .slice(0, 8);

  // Alert trend bucketed by minute (demo-scale time window)
  const bucket = {};
  db.data.alerts.forEach((a) => {
    const key = new Date(a.created_at).toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
    bucket[key] = (bucket[key] || 0) + 1;
  });
  const alertTrend = Object.entries(bucket)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .slice(-20)
    .map(([minute, count]) => ({ minute, count }));

  res.json({
    band_counts: bandCounts,
    rake_type_comparison: rakeTypeComparison,
    top_alert_coaches: topAlertCoaches,
    alert_trend: alertTrend,
    total_readings_logged: db.data.readings.length,
  });
});

module.exports = router;
