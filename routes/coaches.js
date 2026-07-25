const express = require("express");
const { db } = require("../db/db");

const router = express.Router();
const BAND_ORDER = ["GREEN", "YELLOW", "ORANGE", "RED"];

function worstOf(bands) {
  return bands.reduce((w, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(w) ? b : w), "GREEN");
}

function latestReadingFor(axleId) {
  const readings = db.data.readings.filter((r) => r.axle_id === axleId);
  return readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;
}

function coachOverallBand(coachId) {
  const axles = db.data.axles.filter((a) => a.coach_id === coachId);
  const bands = axles.map((a) => {
    const latest = latestReadingFor(a.id);
    return latest ? latest.band : "GREEN";
  });
  return worstOf(bands.length ? bands : ["GREEN"]);
}

router.get("/", async (req, res) => {
  await db.read();
  const coaches = db.data.coaches.map((c) => {
    const rake = db.data.rakes.find((r) => r.id === c.rake_id);
    const openAlerts = db.data.alerts.filter((a) => a.coach_id === c.id && !a.acknowledged).length;
    const piccuFault = db.data.piccuSystems.filter((p) => p.coach_id === c.id && p.status !== "Online").length;
    return {
      ...c,
      rake_name: rake ? rake.rake_name : "Unassigned",
      rake_type: rake ? rake.rake_type : "-",
      overall_band: coachOverallBand(c.id),
      open_alerts: openAlerts,
      piccu_faults: piccuFault,
      axle_count: db.data.axles.filter((a) => a.coach_id === c.id).length,
    };
  });
  res.json(coaches);
});

router.get("/summary", async (req, res) => {
  await db.read();
  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  db.data.coaches.forEach((c) => { bandCounts[coachOverallBand(c.id)]++; });
  res.json({
    total_coaches: db.data.coaches.length,
    total_rakes: db.data.rakes.length,
    total_axles: db.data.axles.length,
    open_alerts: db.data.alerts.filter((a) => !a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => p.status !== "Online").length,
    band_counts: bandCounts,
  });
});

router.get("/:id", async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const rake = db.data.rakes.find((r) => r.id === coach.rake_id);
  res.json({ ...coach, rake_name: rake ? rake.rake_name : "Unassigned", rake_type: rake ? rake.rake_type : "-" });
});

router.get("/:id/axles", async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const axles = db.data.axles
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => a.axle_number - b.axle_number)
    .map((a) => {
      const readings = db.data.readings
        .filter((r) => r.axle_id === a.id)
        .sort((x, y) => new Date(y.ts) - new Date(x.ts));
      return { ...a, latest: readings[0] || null, history: readings.slice(0, 20).reverse() };
    });
  res.json(axles);
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
module.exports.coachOverallBand = coachOverallBand;
module.exports.worstOf = worstOf;
