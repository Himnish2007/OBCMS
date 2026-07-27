const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds, requireCoachAccess } = require("../services/access");

const router = express.Router();
const BAND_ORDER = ["NODATA", "GREEN", "YELLOW", "ORANGE", "RED"];

function worstOf(bands) {
  return bands.reduce((w, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(w) ? b : w), "NODATA");
}

function latestReadingFor(axleId) {
  const readings = db.data.readings.filter((r) => r.axle_id === axleId);
  return readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;
}

function coachOverallBand(coachId) {
  const axles = db.data.axles.filter((a) => a.coach_id === coachId);
  const bands = axles.map((a) => {
    const latest = latestReadingFor(a.id);
    return latest ? latest.band : "NODATA";
  });
  return worstOf(bands.length ? bands : ["NODATA"]);
}

router.get("/", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const coaches = db.data.coaches
    .filter((c) => allowed.has(c.id))
    .map((c) => {
      const rake = db.data.rakes.find((r) => r.id === c.rake_id);
      const openAlerts = db.data.alerts.filter((a) => a.coach_id === c.id && !a.acknowledged).length;
      const piccuFault = db.data.piccuSystems.filter((p) => p.coach_id === c.id && p.status === "Fault").length;
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
  const allowed = new Set(accessibleCoachIds(req));
  const myCoaches = db.data.coaches.filter((c) => allowed.has(c.id));
  const bandCounts = { NODATA: 0, GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  myCoaches.forEach((c) => { bandCounts[coachOverallBand(c.id)]++; });
  const myCoachIds = myCoaches.map((c) => c.id);
  res.json({
    total_coaches: myCoaches.length,
    total_rakes: new Set(myCoaches.map((c) => c.rake_id)).size,
    total_axles: db.data.axles.filter((a) => myCoachIds.includes(a.coach_id)).length,
    open_alerts: db.data.alerts.filter((a) => myCoachIds.includes(a.coach_id) && !a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => myCoachIds.includes(p.coach_id) && p.status === "Fault").length,
    band_counts: bandCounts,
  });
});

router.get("/:id", requireCoachAccess, async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const rake = db.data.rakes.find((r) => r.id === coach.rake_id);
  res.json({ ...coach, rake_name: rake ? rake.rake_name : "Unassigned", rake_type: rake ? rake.rake_type : "-" });
});

router.get("/:id/axles", requireCoachAccess, async (req, res) => {
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

router.get("/:id/alerts", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const alerts = db.data.alerts
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(alerts);
});

router.get("/:id/piccu", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const coach = db.data.coaches.find((c) => c.id === coachId);
  const systems = db.data.piccuSystems.filter((p) => p.coach_id === coachId);
  const telemetry = db.data.piccuTelemetry.filter((t) => t.coach_id === coachId);
  const latestByParam = {};
  telemetry.forEach((t) => {
    if (!latestByParam[t.param] || new Date(t.ts) > new Date(latestByParam[t.param].ts)) {
      latestByParam[t.param] = t;
    }
  });
  res.json({
    systems,
    telemetry: Object.values(latestByParam),
    wli_tank_level_pct: coach ? (coach.wli_tank_level_pct ?? null) : null,
    wli_tank_level_updated_at: coach ? (coach.wli_tank_level_updated_at || null) : null,
  });
});

module.exports = router;
module.exports.coachOverallBand = coachOverallBand;
module.exports.worstOf = worstOf;
