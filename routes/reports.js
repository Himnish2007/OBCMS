const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds, getCurrentUser } = require("../services/access");
const { buildCoachReportPdf } = require("../services/pdfReport");
const { sendEmail } = require("../services/mailer");

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

function resolveCoachIds(req) {
  const allowed = new Set(accessibleCoachIds(req));
  const { coach_id } = req.query;
  if (coach_id) {
    const id = Number(coach_id);
    return allowed.has(id) ? [id] : [];
  }
  return [...allowed];
}

// Reads ?from= and ?to= (ISO datetime strings) from the query string.
// Either or both may be omitted, in which case that side of the range is unbounded.
function resolveDateRange(req) {
  const { from, to } = req.query;
  const fromTs = from ? new Date(from) : null;
  const toTs = to ? new Date(to) : null;
  return {
    fromTs: fromTs && !isNaN(fromTs) ? fromTs : null,
    toTs: toTs && !isNaN(toTs) ? toTs : null,
  };
}

function withinRange(tsValue, fromTs, toTs) {
  const t = new Date(tsValue);
  if (fromTs && t < fromTs) return false;
  if (toTs && t > toTs) return false;
  return true;
}

router.get("/readings.csv", async (req, res) => {
  await db.read();
  const coachIds = resolveCoachIds(req);
  const { fromTs, toTs } = resolveDateRange(req);
  let readings = db.data.readings.filter((r) => coachIds.includes(r.coach_id) && withinRange(r.ts, fromTs, toTs));
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
  const coachIds = resolveCoachIds(req);
  const { fromTs, toTs } = resolveDateRange(req);
  let alerts = db.data.alerts.filter((a) => coachIds.includes(a.coach_id) && withinRange(a.created_at, fromTs, toTs));
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

router.get("/report.pdf", async (req, res) => {
  await db.read();
  const coachIds = resolveCoachIds(req);
  const { fromTs, toTs } = resolveDateRange(req);
  const user = getCurrentUser(req);
  try {
    const pdfBuffer = await buildCoachReportPdf({
      title: req.query.coach_id ? "Single Coach Report" : "Fleet Report",
      coachIds,
      generatedFor: user ? `${user.name} (${user.username})` : "Unknown",
      fromTs,
      toTs,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="obcms_report_${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate PDF: " + err.message });
  }
});

router.get("/summary", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const myCoaches = db.data.coaches.filter((c) => allowed.has(c.id));
  const bandCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  myCoaches.forEach((c) => {
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
  const myCoachIds = myCoaches.map((c) => c.id);
  res.json({
    generated_at: new Date().toISOString(),
    total_coaches: myCoaches.length,
    total_axles: db.data.axles.filter((a) => myCoachIds.includes(a.coach_id)).length,
    open_alerts: db.data.alerts.filter((a) => myCoachIds.includes(a.coach_id) && !a.acknowledged).length,
    acknowledged_alerts: db.data.alerts.filter((a) => myCoachIds.includes(a.coach_id) && a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => myCoachIds.includes(p.coach_id) && p.status !== "Online").length,
    band_counts: bandCounts,
    thresholds: db.data.thresholds,
    daily_report_time: db.data.settings.daily_report_time,
  });
});

// On-demand: email the current user their own report right now (uses same PDF builder
// as the scheduled daily job). Useful for testing SMTP configuration end-to-end.
router.post("/send-test-report", async (req, res) => {
  await db.read();
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const coachIds = user.role === "Admin" ? db.data.coaches.map((c) => c.id) : (user.assigned_coaches || []);
  if (!coachIds.length) return res.status(400).json({ error: "No coaches assigned to this account yet." });
  if (!user.email) return res.status(400).json({ error: "This account has no email address set — add one in Admin > Users." });

  try {
    const pdfBuffer = await buildCoachReportPdf({
      title: "On-Demand Test Report",
      coachIds,
      generatedFor: `${user.name} (${user.username})`,
    });
    const logEntry = await sendEmail({
      toUserId: user.id,
      toAddress: user.email,
      subject: "Himnish OBCMS & PICCU — Test Report",
      text: `This is a test report covering ${coachIds.length} assigned coach(es).`,
      attachments: [{ filename: "test-report.pdf", content: pdfBuffer }],
    });
    res.json({ success: true, log: logEntry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
