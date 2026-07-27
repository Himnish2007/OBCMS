const express = require("express");
const { db, save, nextId, AXLES_PER_COACH, PICCU_SYSTEMS } = require("../db/db");
const { requireRole } = require("../services/auth");
const { coachOverallBand } = require("./coaches");
const { accessibleCoachIds, getCurrentUser } = require("../services/access");

const router = express.Router();

router.get("/", async (req, res) => {
  await db.read();
  const user = getCurrentUser(req);
  const allowed = new Set(accessibleCoachIds(req));
  const rakes = db.data.rakes.map((r) => {
    const coaches = db.data.coaches
      .filter((c) => c.rake_id === r.id && allowed.has(c.id))
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ ...c, overall_band: coachOverallBand(c.id) }));
    return { ...r, coach_count: coaches.length, coaches };
  });
  // Non-Admin users only see rakes that actually contain at least one of their coaches
  const visible = user && user.role === "Admin" ? rakes : rakes.filter((r) => r.coach_count > 0);
  res.json(visible);
});

router.post("/", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { rake_name, rake_type, zone, depot, coaches } = req.body || {};
  if (!rake_name || !rake_type) return res.status(400).json({ error: "rake_name and rake_type are required" });
  await db.read();
  if (db.data.rakes.some((r) => r.rake_name === rake_name)) {
    return res.status(409).json({ error: "A rake with this name already exists" });
  }

  // Optional: total coaches + their positions, provided right here at rake-creation time
  if (coaches !== undefined) {
    if (!Array.isArray(coaches) || !coaches.length) {
      return res.status(400).json({ error: "coaches must be a non-empty array of { coach_number, coach_type, position }" });
    }
    for (const c of coaches) {
      if (!c.coach_number || !c.coach_type || !c.position) {
        return res.status(400).json({ error: "Every coach needs coach_number, coach_type and position" });
      }
      if (db.data.coaches.some((existing) => existing.coach_number === c.coach_number)) {
        return res.status(409).json({ error: `Coach number ${c.coach_number} already exists` });
      }
    }
    const numbers = coaches.map((c) => c.coach_number);
    if (new Set(numbers).size !== numbers.length) return res.status(400).json({ error: "Duplicate coach numbers in the request" });
    const positions = coaches.map((c) => Number(c.position));
    if (new Set(positions).size !== positions.length) return res.status(400).json({ error: "Duplicate positions in the request" });
  }

  const rake = { id: nextId(db.data.rakes), rake_name, rake_type, zone: zone || "-", depot: depot || "-" };
  db.data.rakes.push(rake);

  const createdCoaches = [];
  if (Array.isArray(coaches)) {
    coaches.forEach((c) => {
      const coach = {
        id: nextId(db.data.coaches),
        coach_number: c.coach_number,
        rake_id: rake.id,
        coach_type: c.coach_type,
        position: Number(c.position),
        status: "Active",
      };
      db.data.coaches.push(coach);
      for (let axleNo = 1; axleNo <= AXLES_PER_COACH; axleNo++) {
        db.data.axles.push({ id: nextId(db.data.axles), coach_id: coach.id, axle_number: axleNo });
      }
      PICCU_SYSTEMS.forEach((sys) => {
        db.data.piccuSystems.push({
          id: nextId(db.data.piccuSystems), coach_id: coach.id, system_name: sys, status: "No Data", last_update: new Date().toISOString(),
        });
      });
      createdCoaches.push(coach);
    });
  }

  await save();
  res.status(201).json({ ...rake, coaches: createdCoaches });
});

router.put("/:id", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const rake = db.data.rakes.find((r) => r.id === Number(req.params.id));
  if (!rake) return res.status(404).json({ error: "Rake not found" });
  const { rake_name, rake_type, zone, depot } = req.body || {};
  if (rake_name && db.data.rakes.some((r) => r.rake_name === rake_name && r.id !== rake.id)) {
    return res.status(409).json({ error: "Another rake already uses this name" });
  }
  if (rake_name) rake.rake_name = rake_name;
  if (rake_type) rake.rake_type = rake_type;
  if (zone) rake.zone = zone;
  if (depot) rake.depot = depot;
  await save();
  res.json(rake);
});

// Bulk-update coach positions within a rake (used from the Edit Rake modal)
router.put("/:id/positions", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const rakeId = Number(req.params.id);
  const rake = db.data.rakes.find((r) => r.id === rakeId);
  if (!rake) return res.status(404).json({ error: "Rake not found" });
  const { positions } = req.body || {};
  if (!Array.isArray(positions) || !positions.length) {
    return res.status(400).json({ error: "positions must be a non-empty array of { coach_id, position }" });
  }
  const rakeCoaches = db.data.coaches.filter((c) => c.rake_id === rakeId);
  for (const p of positions) {
    const coach = rakeCoaches.find((c) => c.id === Number(p.coach_id));
    if (!coach) return res.status(400).json({ error: `Coach ${p.coach_id} is not part of this rake` });
    if (!p.position || Number(p.position) < 1) return res.status(400).json({ error: "Every position must be a positive number" });
  }
  const newPositions = positions.map((p) => Number(p.position));
  if (new Set(newPositions).size !== newPositions.length) {
    return res.status(400).json({ error: "Duplicate positions — each coach in a rake needs a unique position" });
  }
  positions.forEach((p) => {
    const coach = rakeCoaches.find((c) => c.id === Number(p.coach_id));
    coach.position = Number(p.position);
  });
  await save();
  res.json({ success: true, coaches: rakeCoaches.sort((a, b) => a.position - b.position) });
});

router.delete("/:id", requireRole("Admin"), async (req, res) => {
  await db.read();
  const rakeId = Number(req.params.id);
  const exists = db.data.rakes.some((r) => r.id === rakeId);
  if (!exists) return res.status(404).json({ error: "Rake not found" });
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
  const allowed = new Set(accessibleCoachIds(req));
  const log = db.data.coachSwapLog
    .filter((l) => allowed.has(l.coach_id))
    .sort((a, b) => new Date(b.swapped_at) - new Date(a.swapped_at));
  res.json(log);
});

module.exports = router;
