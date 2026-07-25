const express = require("express");
const { db, save, defaultCoachHardware } = require("../db/db");
const { requireRole } = require("../services/auth");

const router = express.Router();

// ---------------- Hardware Bill of Materials ----------------
router.get("/hardware-bom", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json(db.data.hardware.bom);
});

router.put("/hardware-bom", requireRole("Admin"), async (req, res) => {
  const { bom } = req.body || {};
  if (!Array.isArray(bom)) return res.status(400).json({ error: "bom must be an array" });
  for (const row of bom) {
    if (!row.component || !row.model) return res.status(400).json({ error: "Every BOM row needs a component and a model" });
  }
  await db.read();
  db.data.hardware.bom = bom.map((row, idx) => ({
    id: row.id || idx + 1,
    component: row.component,
    model: row.model,
    qty_per_coach: Number(row.qty_per_coach) || 0,
    purpose: row.purpose || "",
  }));
  await save();
  res.json(db.data.hardware.bom);
});

// ---------------- Data source: demo simulator vs live Modbus TCP ingestion ----------------
router.get("/data-source", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json({
    data_source: db.data.hardware.data_source,
    poll_interval_seconds: db.data.hardware.poll_interval_seconds,
  });
});

router.put("/data-source", requireRole("Admin"), async (req, res) => {
  const { data_source, poll_interval_seconds } = req.body || {};
  await db.read();
  if (data_source) {
    if (!["demo", "live"].includes(data_source)) return res.status(400).json({ error: "data_source must be 'demo' or 'live'" });
    db.data.hardware.data_source = data_source;
  }
  if (poll_interval_seconds !== undefined) {
    const n = Number(poll_interval_seconds);
    if (!n || n < 2 || n > 3600) return res.status(400).json({ error: "poll_interval_seconds must be a number between 2 and 3600" });
    db.data.hardware.poll_interval_seconds = n;
  }
  await save();
  res.json({ data_source: db.data.hardware.data_source, poll_interval_seconds: db.data.hardware.poll_interval_seconds });
});

// ---------------- Per-coach hardware connectivity (Modbus TCP IPs for the two BNI00L1 masters) ----------------
router.get("/coach-hardware", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json(db.data.coaches.map((c) => ({
    id: c.id,
    coach_number: c.coach_number,
    hardware: c.hardware || defaultCoachHardware(),
  })));
});

router.put("/coach-hardware/:id", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const { obcms_master_ip, obcms_master_port, piccu_master_ip, piccu_master_port, rut200_ip } = req.body || {};
  coach.hardware = coach.hardware || defaultCoachHardware();
  if (obcms_master_ip !== undefined) coach.hardware.obcms_master_ip = String(obcms_master_ip).trim();
  if (obcms_master_port !== undefined) coach.hardware.obcms_master_port = Number(obcms_master_port) || 502;
  if (piccu_master_ip !== undefined) coach.hardware.piccu_master_ip = String(piccu_master_ip).trim();
  if (piccu_master_port !== undefined) coach.hardware.piccu_master_port = Number(piccu_master_port) || 502;
  if (rut200_ip !== undefined) coach.hardware.rut200_ip = String(rut200_ip).trim();
  await save();
  res.json({ id: coach.id, coach_number: coach.coach_number, hardware: coach.hardware });
});

module.exports = router;
