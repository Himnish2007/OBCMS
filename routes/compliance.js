const express = require("express");
const { db, SBC_PARAMETERS } = require("../db/db");
const { requireRole } = require("../services/auth");
const { accessibleCoachIds } = require("../services/access");
const { monthlyDowntimeReport, monthlyDowntimeReportAllCoaches } = require("../services/downtime");

const router = express.Router();

// ---------------- Wheel flat/shelling risk (MDTS:44415 Part A pt.11) ----------------
router.get("/wheel-defect", async (req, res) => {
  await db.read();
  const allowed = accessibleCoachIds(req);
  const axles = db.data.axles
    .filter((a) => allowed.includes(a.coach_id))
    .map((a) => {
      const coach = db.data.coaches.find((c) => c.id === a.coach_id);
      return {
        coach_id: a.coach_id,
        coach_number: coach ? coach.coach_number : null,
        axle_number: a.axle_number,
        band: a.wheel_defect_band || "GREEN",
        impact_factor: a.wheel_defect_impact_factor,
        checked_at: a.wheel_defect_checked_at,
      };
    })
    .filter((a) => a.band !== "GREEN" || req.query.all === "1");
  res.json(axles);
});

// ---------------- Self-diagnosis (Part A pt.1/23, Part B misc.) ----------------
router.get("/self-diagnosis", async (req, res) => {
  await db.read();
  const allowed = accessibleCoachIds(req);
  const axles = db.data.axles
    .filter((a) => allowed.includes(a.coach_id))
    .map((a) => {
      const coach = db.data.coaches.find((c) => c.id === a.coach_id);
      return {
        coach_id: a.coach_id,
        coach_number: coach ? coach.coach_number : null,
        axle_number: a.axle_number,
        sensor_health: a.sensor_health || "UNKNOWN",
        detail: a.sensor_health_detail,
        checked_at: a.sensor_health_checked_at,
      };
    });
  const devices = db.data.rutDevices
    .filter((d) => d.current_coach_id && allowed.includes(d.current_coach_id))
    .map((d) => {
      const coach = db.data.coaches.find((c) => c.id === d.current_coach_id);
      return {
        device_label: d.label,
        coach_id: d.current_coach_id,
        coach_number: coach ? coach.coach_number : null,
        comm_health: d.comm_health || "UNKNOWN",
        last_seen_at: d.last_seen_at,
      };
    });
  res.json({ axles, devices });
});

// ---------------- Downtime & Penalty (Part C, Clause 10) ----------------
// GET /api/compliance/downtime?year=2026&month=7&coach_id=3 (coach_id optional -> all accessible coaches)
router.get("/downtime", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const allowed = accessibleCoachIds(req);

  if (req.query.coach_id) {
    const coachId = Number(req.query.coach_id);
    if (!allowed.includes(coachId)) return res.status(404).json({ error: "Coach not found" });
    const report = monthlyDowntimeReport(coachId, year, month);
    return res.json(report ? [report] : []);
  }

  const all = monthlyDowntimeReportAllCoaches(year, month).filter((r) => allowed.includes(r.coach_id));
  res.json(all);
});

// ---------------- SBC telemetry completeness (Part B section 1(e)) ----------------
router.get("/sbc-completeness/:coach_id", async (req, res) => {
  await db.read();
  const coachId = Number(req.params.coach_id);
  const allowed = accessibleCoachIds(req);
  if (!allowed.includes(coachId)) return res.status(404).json({ error: "Coach not found" });

  const receivedParams = new Set(
    db.data.piccuTelemetry.filter((t) => t.coach_id === coachId).map((t) => t.param)
  );
  const checklist = SBC_PARAMETERS.map((p) => ({
    ...p,
    received: receivedParams.has(p.key),
  }));
  const receivedCount = checklist.filter((c) => c.received).length;
  res.json({
    coach_id: coachId,
    total_parameters: SBC_PARAMETERS.length,
    received_count: receivedCount,
    completeness_pct: Number(((receivedCount / SBC_PARAMETERS.length) * 100).toFixed(1)),
    checklist,
  });
});

module.exports = router;
