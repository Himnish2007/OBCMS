const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => {
      const val = row[c.key] ?? "";
      const str = String(val).replace(/"/g, '""');
      return /[",\n]/.test(str) ? `"${str}"` : str;
    }).join(",")
  );
  return [header, ...lines].join("\n");
}

router.get("/readings.csv", async (req, res) => {
  await db.read();
  const { coach_id } = req.query;
  let readings = db.data.readings;
  if (coach_id) readings = readings.filter((r) => r.coach_id === Number(coach_id));
  readings = readings
    .map((r) => {
      const coach = db.data.coaches.find((c) => c.id === r.coach_id);
      return { ...r, coach_number: coach ? coach.coach_number : "-" };
    })
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const csv = toCsv(readings, [
    { key: "ts", label: "Timestamp" },
    { key: "coach_number", label: "Coach Number" },
    { key: "axle_number", label: "Axle" },
    { key: "vibration_g", label: "Vibration (g)" },
    { key: "temperature_c", label: "Temperature (C)" },
    { key: "speed_kmph", label: "Speed (kmph)" },
    { key: "band", label: "Condition Band" },
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="obcms_readings_${Date.now()}.csv"`);
  res.send(csv);
});

router.get("/alerts.csv", async (req, res) => {
  await db.read();
  const { coach_id } = req.query;
  let alerts = db.data.alerts;
  if (coach_id) alerts = alerts.filter((a) => a.coach_id === Number(coach_id));
  alerts = alerts
    .map((a) => {
      const coach = db.data.coaches.find((c) => c.id === a.coach_id);
      return { ...a, coach_number: coach ? coach.coach_number : "-" };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const csv = toCsv(alerts, [
    { key: "created_at", label: "Created At" },
    { key: "coach_number", label: "Coach Number" },
    { key: "axle_number", label: "Axle" },
    { key: "severity", label: "Severity" },
    { key: "band", label: "Band" },
    { key: "parameter", label: "Driven By" },
    { key: "message", label: "Message" },
    { key: "acknowledged", label: "Acknowledged" },
    { key: "acknowledged_by", label: "Acknowledged By" },
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="obcms_alerts_${Date.now()}.csv"`);
  res.send(csv);
});

router.get("/summary", async (req, res) => {
  await db.read();
  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  db.data.coaches.forEach((c) => {
    const axles = db.data.axles.filter((a) => a.coach_id === c.id);
    const bands = axles.map((a) => {
      const readings = db.data.readings.filter((r) => r.axle_id === a.id);
      const latest = readings.sort((x, y) => new Date(y.ts) - new Date(x.ts))[0];
      return latest ? latest.band : "GREEN";
    });
    const order = ["GREEN", "YELLOW", "ORANGE", "RED"];
    const worst = bands.reduce((w, b) => (order.indexOf(b) > order.indexOf(w) ? b : w), "GREEN");
    bandCounts[worst]++;
  });
  res.json({
    generated_at: new Date().toISOString(),
    total_coaches: db.data.coaches.length,
    total_rakes: db.data.rakes.length,
    total_axles: db.data.axles.length,
    open_alerts: db.data.alerts.filter((a) => !a.acknowledged).length,
    acknowledged_alerts: db.data.alerts.filter((a) => a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => p.status !== "Online").length,
    band_counts: bandCounts,
    thresholds: db.data.thresholds,
  });
});

module.exports = router;
