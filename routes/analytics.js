const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds, requireCoachAccess } = require("../services/access");

const router = express.Router();

router.get("/overview", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));

  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  db.data.axles.filter((a) => allowed.has(a.coach_id)).forEach((axle) => {
    const readings = db.data.readings.filter((r) => r.axle_id === axle.id);
    const latest = readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
    if (!latest) return;
    bandCounts[latest.band] = (bandCounts[latest.band] || 0) + 1;
  });

  const alertsByCoach = {};
  db.data.alerts.filter((a) => allowed.has(a.coach_id)).forEach((a) => {
    alertsByCoach[a.coach_id] = (alertsByCoach[a.coach_id] || 0) + 1;
  });
  const topAlertCoaches = Object.entries(alertsByCoach)
    .map(([coachId, count]) => {
      const coach = db.data.coaches.find((c) => c.id === Number(coachId));
      return { coach_id: Number(coachId), coach_number: coach ? coach.coach_number : "-", alert_count: count };
    })
    .sort((a, b) => b.alert_count - a.alert_count)
    .slice(0, 8);

  const bucket = {};
  db.data.alerts.filter((a) => allowed.has(a.coach_id)).forEach((a) => {
    const key = new Date(a.created_at).toISOString().slice(0, 16);
    bucket[key] = (bucket[key] || 0) + 1;
  });
  const alertTrend = Object.entries(bucket)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .slice(-20)
    .map(([minute, count]) => ({ minute, count }));

  const myCoaches = db.data.coaches.filter((c) => allowed.has(c.id));

  res.json({
    band_counts: bandCounts,
    top_alert_coaches: topAlertCoaches,
    alert_trend: alertTrend,
    total_readings_logged: db.data.readings.filter((r) => allowed.has(r.coach_id)).length,
    coaches: myCoaches.map((c) => ({ id: c.id, coach_number: c.coach_number, coach_type: c.coach_type })),
  });
});

// Detailed per-coach analysis — vibration/temp history for all 8 axles, band distribution, alert summary
router.get("/coach/:id", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const coach = db.data.coaches.find((c) => c.id === coachId);
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const rake = db.data.rakes.find((r) => r.id === coach.rake_id);

  const axles = db.data.axles
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => a.axle_number - b.axle_number)
    .map((a) => {
      const readings = db.data.readings
        .filter((r) => r.axle_id === a.id)
        .sort((x, y) => new Date(x.ts) - new Date(y.ts));
      const latest = readings[readings.length - 1] || null;
      return {
        axle_id: a.id,
        axle_number: a.axle_number,
        latest,
        history: readings.slice(-20),
      };
    });

  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  axles.forEach((a) => { if (a.latest) bandCounts[a.latest.band]++; });

  const alerts = db.data.alerts.filter((a) => a.coach_id === coachId);
  const alertsBySeverity = { Critical: 0, High: 0 };
  alerts.forEach((a) => { alertsBySeverity[a.severity] = (alertsBySeverity[a.severity] || 0) + 1; });

  const avgVibration = axles.filter((a) => a.latest).reduce((s, a) => s + a.latest.vibration_g, 0) / (axles.filter((a) => a.latest).length || 1);
  const avgTemperature = axles.filter((a) => a.latest).reduce((s, a) => s + a.latest.temperature_c, 0) / (axles.filter((a) => a.latest).length || 1);

  res.json({
    coach: { ...coach, rake_name: rake ? rake.rake_name : "Unassigned", rake_type: rake ? rake.rake_type : "-" },
    axles,
    band_counts: bandCounts,
    avg_vibration_g: Number(avgVibration.toFixed(1)),
    avg_temperature_c: Number(avgTemperature.toFixed(1)),
    total_alerts: alerts.length,
    open_alerts: alerts.filter((a) => !a.acknowledged).length,
    alerts_by_severity: alertsBySeverity,
  });
});

module.exports = router;
