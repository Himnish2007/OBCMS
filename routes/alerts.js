const express = require("express");
const { db, save } = require("../db/db");
const { accessibleCoachIds } = require("../services/access");

const router = express.Router();

router.get("/", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const { status } = req.query;
  let alerts = db.data.alerts
    .filter((a) => allowed.has(a.coach_id))
    .map((a) => {
      const coach = db.data.coaches.find((c) => c.id === a.coach_id);
      const rake = coach ? db.data.rakes.find((r) => r.id === coach.rake_id) : null;
      return {
        ...a,
        coach_number: coach ? coach.coach_number : "-",
        rake_name: rake ? rake.rake_name : "-",
        axle_label: a.axle_number ? `Axle-${a.axle_number}` : "-",
      };
    });
  if (status === "open") alerts = alerts.filter((a) => !a.acknowledged);
  if (status === "acknowledged") alerts = alerts.filter((a) => a.acknowledged);
  alerts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Paginated on purpose: the alert-generating modules (wheel-defect, self-diagnosis) mean
  // this list only grows over months of operation, and the frontend polls it every 8s —
  // an unbounded response here gets slower for everyone as the fleet accumulates history.
  const total = alerts.length;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const page = alerts.slice(offset, offset + limit);

  res.json({ alerts: page, total, limit, offset });
});

router.post("/:id/ack", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const alert = db.data.alerts.find((a) => a.id === Number(req.params.id));
  if (!alert || !allowed.has(alert.coach_id)) return res.status(404).json({ error: "Alert not found" });
  alert.acknowledged = true;
  alert.acknowledged_by = req.user ? req.user.username : "system";
  alert.acknowledged_at = new Date().toISOString();
  await save();
  res.json(alert);
});

module.exports = router;
