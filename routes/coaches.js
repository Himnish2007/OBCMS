const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

function worstBand(bands) {
  const order = ["GREEN", "YELLOW", "ORANGE", "RED"];
  return bands.reduce((worst, b) => (order.indexOf(b) > order.indexOf(worst) ? b : worst), "GREEN");
}

router.get("/", async (req, res) => {
  await db.read();
  const coaches = db.data.coaches.map((c) => {
    const sensors = db.data.sensors.filter((s) => s.coach_id === c.id);
    const latestBands = sensors.map((s) => {
      const readings = db.data.readings.filter((r) => r.sensor_id === s.id);
      const latest = readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
      return latest ? latest.band : "GREEN";
    });
    const openAlerts = db.data.alerts.filter((a) => a.coach_id === c.id && !a.acknowledged).length;
    const piccuFault = db.data.piccuSystems.filter((p) => p.coach_id === c.id && p.status !== "Online").length;
    return {
      ...c,
      overall_band: worstBand(latestBands.length ? latestBands : ["GREEN"]),
      open_alerts: openAlerts,
      piccu_faults: piccuFault,
      sensor_count: sensors.length,
    };
  });
  res.json(coaches);
});

router.get("/summary", async (req, res) => {
  await db.read();
  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  db.data.coaches.forEach((c) => {
    const sensors = db.data.sensors.filter((s) => s.coach_id === c.id);
    const bands = sensors.map((s) => {
      const readings = db.data.readings.filter((r) => r.sensor_id === s.id);
      const latest = readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
      return latest ? latest.band : "GREEN";
    });
    const worst = bands.reduce(
      (w, b) => (["GREEN", "YELLOW", "ORANGE", "RED"].indexOf(b) > ["GREEN", "YELLOW", "ORANGE", "RED"].indexOf(w) ? b : w),
      "GREEN"
    );
    bandCounts[worst]++;
  });
  res.json({
    total_coaches: db.data.coaches.length,
    total_sensors: db.data.sensors.length,
    open_alerts: db.data.alerts.filter((a) => !a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => p.status !== "Online").length,
    band_counts: bandCounts,
  });
});

router.get("/:id", async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  res.json(coach);
});

router.get("/:id/sensors", async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const sensors = db.data.sensors
    .filter((s) => s.coach_id === coachId)
    .map((s) => {
      const readings = db.data.readings
        .filter((r) => r.sensor_id === s.id)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts));
      return { ...s, latest: readings[0] || null, history: readings.slice(0, 20).reverse() };
    });
  res.json(sensors);
});

router.get("/:id/alerts", async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const alerts = db.data.alerts
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(alerts);
});

router.get("/:id/piccu", async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const systems = db.data.piccuSystems.filter((p) => p.coach_id === coachId);
  const telemetry = db.data.piccuTelemetry.filter((t) => t.coach_id === coachId);
  const latestByParam = {};
  telemetry.forEach((t) => {
    if (!latestByParam[t.param] || new Date(t.ts) > new Date(latestByParam[t.param].ts)) {
      latestByParam[t.param] = t;
    }
  });
  res.json({ systems, telemetry: Object.values(latestByParam) });
});

module.exports = router;
