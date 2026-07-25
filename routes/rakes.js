const express = require("express");
const { db, save, nextId } = require("../db/db");
const { requireRole } = require("../services/auth");
const { coachOverallBand } = require("./coaches");

const router = express.Router();

router.get("/", async (req, res) => {
  await db.read();
  const rakes = db.data.rakes.map((r) => {
    const coaches = db.data.coaches
      .filter((c) => c.rake_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ ...c, overall_band: coachOverallBand(c.id) }));
    return { ...r, coach_count: coaches.length, coaches };
  });
  res.json(rakes);
});

router.post("/", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { rake_name, rake_type, zone, depot } = req.body || {};
  if (!rake_name || !rake_type) return res.status(400).json({ error: "rake_name and rake_type are required" });
  await db.read();
  if (db.data.rakes.some((r) => r.rake_name === rake_name)) {
    return res.status(409).json({ error: "A rake with this name already exists" });
  }
  const rake = { id: nextId(db.data.rakes), rake_name, rake_type, zone: zone || "-", depot: depot || "-" };
  db.data.rakes.push(rake);
  await save();
  res.status(201).json(rake);
});

router.put("/:id", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const rake = db.data.rakes.find((r) => r.id === Number(req.params.id));
  if (!rake) return res.status(404).json({ error: "Rake not found" });
  const { rake_name, rake_type, zone, depot } = req.body || {};
  if (rake_name) rake.rake_name = rake_name;
  if (rake_type) rake.rake_type = rake_type;
  if (zone) rake.zone = zone;
  if (depot) rake.depot = depot;
  await save();
  res.json(rake);
});

router.delete("/:id", requireRole("Admin"), async (req, res) => {
  await db.read();
  const rakeId = Number(req.params.id);
  const hasCoaches = db.data.coaches.some((c) => c.rake_id === rakeId);
  if (hasCoaches) {
    return res.status(400).json({ error: "Cannot delete a rake that still has coaches assigned. Swap coaches out first." });
  }
  db.data.rakes = db.data.rakes.filter((r) => r.id !== rakeId);
  await save();
  res.json({ success: true });
});

// Coach swap — move a coach from its current rake to another rake
router.post("/swap-coach", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { coach_id, to_rake_id, reason } = req.body || {};
  if (!coach_id || !to_rake_id) return res.status(400).json({ error: "coach_id and to_rake_id are required" });
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(coach_id));
  const toRake = db.data.rakes.find((r) => r.id === Number(to_rake_id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  if (!toRake) return res.status(404).json({ error: "Destination rake not found" });

  const fromRake = db.data.rakes.find((r) => r.id === coach.rake_id);
  const maxPosition = Math.max(0, ...db.data.coaches.filter((c) => c.rake_id === toRake.id).map((c) => c.position || 0));

  db.data.coachSwapLog.push({
    id: nextId(db.data.coachSwapLog),
    coach_id: coach.id,
    coach_number: coach.coach_number,
    from_rake_id: fromRake ? fromRake.id : null,
    from_rake_name: fromRake ? fromRake.rake_name : "Unassigned",
    to_rake_id: toRake.id,
    to_rake_name: toRake.rake_name,
    swapped_by: req.user ? req.user.username : "system",
    swapped_at: new Date().toISOString(),
    reason: reason || "-",
  });

  coach.rake_id = toRake.id;
  coach.position = maxPosition + 1;
  await save();
  res.json({ success: true, coach });
});

router.get("/swap-log", async (req, res) => {
  await db.read();
  const log = [...db.data.coachSwapLog].sort((a, b) => new Date(b.swapped_at) - new Date(a.swapped_at));
  res.json(log);
});

module.exports = router;
