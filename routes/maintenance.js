const express = require("express");
const { db, save, nextId, addAudit } = require("../db/db");
const { requireRole } = require("../services/auth");
const { accessibleCoachIds, getCurrentUser } = require("../services/access");

const router = express.Router();

const EVENT_TYPES = [
  "bearing_replaced",
  "axle_replaced",
  "sensor_replaced",
  "inspection_ok",
  "inspection_flagged",
  "unplanned_failure",
  "other",
];

// Why this exists: MDTS:44415 asks for a "certified predictive algorithm", and a real
// ML model needs labeled historical failure/maintenance data to train on — which this
// system has none of yet (it's a brand-new deployment). This is how that dataset starts
// getting built: every time a bearing/axle/sensor is actually replaced or inspected, it
// gets logged here, snapshotted against the sensor readings at that moment. Once there's
// enough of this (RDSO would define what "enough" means for certification), it becomes
// the training set for a real model — replacing the linear-trend heuristic in
// routes/predictions.js. Until then, this data has a second, immediately useful purpose:
// letting Health/Prediction show "last serviced X days ago" per axle.

router.get("/", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const coachId = req.query.coach_id ? Number(req.query.coach_id) : null;
  const axleId = req.query.axle_id ? Number(req.query.axle_id) : null;
  let events = db.data.maintenanceEvents.filter((e) => allowed.has(e.coach_id));
  if (coachId) events = events.filter((e) => e.coach_id === coachId);
  if (axleId) events = events.filter((e) => e.axle_id === axleId);
  events = events.sort((a, b) => new Date(b.event_at) - new Date(a.event_at));
  res.json(events.slice(0, 500));
});

router.get("/event-types", async (req, res) => res.json(EVENT_TYPES));

router.post("/", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { axle_id, event_type, notes, event_at } = req.body || {};
  if (!axle_id || !event_type) {
    return res.status(400).json({ error: "axle_id and event_type are required" });
  }
  if (!EVENT_TYPES.includes(event_type)) {
    return res.status(400).json({ error: `event_type must be one of ${EVENT_TYPES.join(", ")}` });
  }
  await db.read();
  const axle = db.data.axles.find((a) => a.id === Number(axle_id));
  if (!axle) return res.status(404).json({ error: "Axle not found" });
  const allowed = new Set(accessibleCoachIds(req));
  if (!allowed.has(axle.coach_id)) return res.status(404).json({ error: "Axle not found" });

  // Snapshot the most recent reading at the moment of the event — this is exactly the
  // kind of (reading-at-failure, event) pair a future ML model would train on.
  const lastReading = db.data.readings
    .filter((r) => r.axle_id === axle.id)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;

  const user = getCurrentUser(req);
  const event = {
    id: nextId(db.data.maintenanceEvents),
    axle_id: axle.id,
    coach_id: axle.coach_id,
    axle_number: axle.axle_number,
    event_type,
    notes: (notes || "").trim(),
    event_at: event_at || new Date().toISOString(),
    logged_by: user ? user.username : "unknown",
    logged_at: new Date().toISOString(),
    reading_snapshot: lastReading ? {
      vibration_g: lastReading.vibration_g,
      temperature_c: lastReading.temperature_c,
      band: lastReading.band,
      ts: lastReading.ts,
    } : null,
  };
  db.data.maintenanceEvents.push(event);
  await save();
  addAudit(user, "maintenance_event_logged", { axle_id: axle.id, coach_id: axle.coach_id, event_type });
  res.status(201).json(event);
});

router.delete("/:id", requireRole("Admin"), async (req, res) => {
  await db.read();
  const id = Number(req.params.id);
  const exists = db.data.maintenanceEvents.some((e) => e.id === id);
  if (!exists) return res.status(404).json({ error: "Event not found" });
  db.data.maintenanceEvents = db.data.maintenanceEvents.filter((e) => e.id !== id);
  await save();
  addAudit(req.user, "maintenance_event_deleted", { event_id: id });
  res.json({ success: true });
});

module.exports = router;
