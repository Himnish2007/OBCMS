const express = require("express");
const { db, save } = require("../db/db");

const router = express.Router();

router.get("/", async (req, res) => {
  await db.read();
  const { status } = req.query;
  let alerts = db.data.alerts.map((a) => {
    const coach = db.data.coaches.find((c) => c.id === a.coach_id);
    const sensor = db.data.sensors.find((s) => s.id === a.sensor_id);
    return { ...a, coach_number: coach ? coach.coach_number : "-", sensor_location: sensor ? sensor.location : "-" };
  });
  if (status === "open") alerts = alerts.filter((a) => !a.acknowledged);
  if (status === "acknowledged") alerts = alerts.filter((a) => a.acknowledged);
  alerts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(alerts);
});

router.post("/:id/ack", async (req, res) => {
  await db.read();
  const alert = db.data.alerts.find((a) => a.id === Number(req.params.id));
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  alert.acknowledged = true;
  alert.acknowledged_by = req.user ? req.user.username : "system";
  alert.acknowledged_at = new Date().toISOString();
  await save();
  res.json(alert);
});

module.exports = router;
