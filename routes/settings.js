const express = require("express");
const { db, save, nextId, generateDeviceKey } = require("../db/db");
const { requireRole } = require("../services/auth");
const { getCurrentUser } = require("../services/access");

const router = express.Router();

// ---------------- Data source: demo simulator vs live push-based ingestion ----------------
router.get("/data-source", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json({ data_source: db.data.hardware.data_source });
});

router.put("/data-source", requireRole("Admin"), async (req, res) => {
  const { data_source } = req.body || {};
  if (!["demo", "live"].includes(data_source)) return res.status(400).json({ error: "data_source must be 'demo' or 'live'" });
  await db.read();
  db.data.hardware.data_source = data_source;
  await save();
  res.json({ data_source: db.data.hardware.data_source });
});

// ---------------- RUT device registry ----------------
// A RUT device is physical, mobile hardware — it does NOT belong permanently to one coach.
// Each device has a fixed device_key (given to the Lua push script running on the RUT) and
// a current_coach_id that can be reassigned whenever the router is moved to a different train.
function serializeDevice(d) {
  const coach = db.data.coaches.find((c) => c.id === d.current_coach_id);
  return {
    id: d.id,
    label: d.label,
    device_key: d.device_key,
    current_coach_id: d.current_coach_id,
    current_coach_number: coach ? coach.coach_number : null,
    last_seen_at: d.last_seen_at,
    created_at: d.created_at,
  };
}

router.get("/rut-devices", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json(db.data.rutDevices.map(serializeDevice));
});

router.post("/rut-devices", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { label, coach_id } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: "label is required" });
  await db.read();
  let coach = null;
  if (coach_id !== undefined && coach_id !== null && coach_id !== "") {
    coach = db.data.coaches.find((c) => c.id === Number(coach_id));
    if (!coach) return res.status(400).json({ error: "coach_id does not match any coach" });
  }
  const device = {
    id: nextId(db.data.rutDevices),
    label: label.trim(),
    device_key: generateDeviceKey(),
    current_coach_id: coach ? coach.id : null,
    last_seen_at: null,
    created_at: new Date().toISOString(),
  };
  db.data.rutDevices.push(device);
  if (coach) {
    db.data.rutReassignLog.push({
      id: nextId(db.data.rutReassignLog),
      device_id: device.id,
      device_label: device.label,
      from_coach_id: null,
      from_coach_number: null,
      to_coach_id: coach.id,
      to_coach_number: coach.coach_number,
      reason: "Initial assignment at registration",
      reassigned_by: (getCurrentUser(req) || {}).username || "unknown",
      reassigned_at: new Date().toISOString(),
    });
  }
  await save();
  res.status(201).json(serializeDevice(device));
});

router.put("/rut-devices/:id/reassign", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const device = db.data.rutDevices.find((d) => d.id === Number(req.params.id));
  if (!device) return res.status(404).json({ error: "RUT device not found" });
  const { to_coach_id, reason } = req.body || {};
  const toCoach = to_coach_id ? db.data.coaches.find((c) => c.id === Number(to_coach_id)) : null;
  if (to_coach_id && !toCoach) return res.status(400).json({ error: "to_coach_id does not match any coach" });

  const fromCoach = db.data.coaches.find((c) => c.id === device.current_coach_id);
  db.data.rutReassignLog.push({
    id: nextId(db.data.rutReassignLog),
    device_id: device.id,
    device_label: device.label,
    from_coach_id: fromCoach ? fromCoach.id : null,
    from_coach_number: fromCoach ? fromCoach.coach_number : null,
    to_coach_id: toCoach ? toCoach.id : null,
    to_coach_number: toCoach ? toCoach.coach_number : null,
    reason: (reason || "").trim() || "-",
    reassigned_by: (getCurrentUser(req) || {}).username || "unknown",
    reassigned_at: new Date().toISOString(),
  });
  device.current_coach_id = toCoach ? toCoach.id : null;
  await save();
  res.json(serializeDevice(device));
});

router.delete("/rut-devices/:id", requireRole("Admin"), async (req, res) => {
  await db.read();
  const device = db.data.rutDevices.find((d) => d.id === Number(req.params.id));
  if (!device) return res.status(404).json({ error: "RUT device not found" });
  db.data.rutDevices = db.data.rutDevices.filter((d) => d.id !== device.id);
  await save();
  res.json({ success: true });
});

router.get("/rut-reassign-log", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const log = [...db.data.rutReassignLog].sort((a, b) => new Date(b.reassigned_at) - new Date(a.reassigned_at));
  res.json(log.slice(0, 100));
});

module.exports = router;
