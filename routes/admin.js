const express = require("express");
const bcrypt = require("bcryptjs");
const { db, save, nextId, AXLES_PER_COACH, PICCU_SYSTEMS, defaultCoachHardware } = require("../db/db");
const { requireRole } = require("../services/auth");
const { sendEmail } = require("../services/mailer");

const router = express.Router();
const VALID_ROLES = ["Admin", "Supervisor", "Viewer"];

// ---------------- Users ----------------
router.get("/users", requireRole(["Admin"]), async (req, res) => {
  await db.read();
  res.json(db.data.users.map((u) => ({
    id: u.id, username: u.username, name: u.name, role: u.role,
    email: u.email || "", phone: u.phone || "", assigned_coaches: u.assigned_coaches || [],
  })));
});

router.post("/users", requireRole(["Admin"]), async (req, res) => {
  const { username, password, name, role, email, phone, assigned_coaches } = req.body || {};
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: "username, password, name and role are required" });
  }
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(", ")}` });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  await db.read();
  if (db.data.users.some((u) => u.username === username)) {
    return res.status(409).json({ error: "Username already exists" });
  }
  const user = {
    id: nextId(db.data.users),
    username, passwordHash: bcrypt.hashSync(password, 8), name, role,
    email: email || "", phone: phone || "",
    assigned_coaches: Array.isArray(assigned_coaches) ? assigned_coaches.map(Number) : [],
  };
  db.data.users.push(user);
  await save();
  res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role, email: user.email, phone: user.phone, assigned_coaches: user.assigned_coaches });
});

router.put("/users/:id", requireRole(["Admin"]), async (req, res) => {
  await db.read();
  const user = db.data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  const { name, role, password, email, phone, assigned_coaches } = req.body || {};
  if (name) user.name = name;
  if (role) {
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(", ")}` });
    user.role = role;
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    user.passwordHash = bcrypt.hashSync(password, 8);
  }
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (assigned_coaches !== undefined) user.assigned_coaches = Array.isArray(assigned_coaches) ? assigned_coaches.map(Number) : [];
  await save();
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, email: user.email, phone: user.phone, assigned_coaches: user.assigned_coaches });
});

router.delete("/users/:id", requireRole(["Admin"]), async (req, res) => {
  await db.read();
  const userId = Number(req.params.id);
  if (req.user.id === userId) return res.status(400).json({ error: "You cannot delete your own account while logged in" });
  const exists = db.data.users.some((u) => u.id === userId);
  if (!exists) return res.status(404).json({ error: "User not found" });
  db.data.users = db.data.users.filter((u) => u.id !== userId);
  await save();
  res.json({ success: true });
});

// ---------------- Coaches ----------------
router.post("/coaches", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  const { coach_number, rake_id, coach_type, position, status } = req.body || {};
  if (!coach_number || !rake_id || !coach_type) {
    return res.status(400).json({ error: "coach_number, rake_id and coach_type are required" });
  }
  await db.read();
  if (db.data.coaches.some((c) => c.coach_number === coach_number)) {
    return res.status(409).json({ error: "A coach with this number already exists" });
  }
  const rake = db.data.rakes.find((r) => r.id === Number(rake_id));
  if (!rake) return res.status(404).json({ error: "Rake not found" });

  const coach = {
    id: nextId(db.data.coaches),
    coach_number,
    rake_id: rake.id,
    coach_type,
    position: position || (Math.max(0, ...db.data.coaches.filter((c) => c.rake_id === rake.id).map((c) => c.position || 0)) + 1),
    status: status || "Active",
    hardware: defaultCoachHardware(),
  };
  db.data.coaches.push(coach);

  for (let axleNo = 1; axleNo <= AXLES_PER_COACH; axleNo++) {
    db.data.axles.push({ id: nextId(db.data.axles), coach_id: coach.id, axle_number: axleNo });
  }
  PICCU_SYSTEMS.forEach((sys) => {
    db.data.piccuSystems.push({
      id: nextId(db.data.piccuSystems), coach_id: coach.id, system_name: sys, status: "Online", last_update: new Date().toISOString(),
    });
  });

  await save();
  res.status(201).json(coach);
});

router.put("/coaches/:id", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const { coach_type, status, position } = req.body || {};
  if (coach_type) coach.coach_type = coach_type;
  if (status) coach.status = status;
  if (position) coach.position = position;
  await save();
  res.json(coach);
});

router.delete("/coaches/:id", requireRole(["Admin"]), async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const exists = db.data.coaches.some((c) => c.id === coachId);
  if (!exists) return res.status(404).json({ error: "Coach not found" });

  const axleIds = db.data.axles.filter((a) => a.coach_id === coachId).map((a) => a.id);
  db.data.coaches = db.data.coaches.filter((c) => c.id !== coachId);
  db.data.axles = db.data.axles.filter((a) => a.coach_id !== coachId);
  db.data.readings = db.data.readings.filter((r) => !axleIds.includes(r.axle_id));
  db.data.alerts = db.data.alerts.filter((a) => a.coach_id !== coachId);
  db.data.piccuSystems = db.data.piccuSystems.filter((p) => p.coach_id !== coachId);
  db.data.piccuTelemetry = db.data.piccuTelemetry.filter((t) => t.coach_id !== coachId);
  // Remove the coach from anyone's assignment list too
  db.data.users.forEach((u) => { u.assigned_coaches = (u.assigned_coaches || []).filter((id) => id !== coachId); });

  await save();
  res.json({ success: true });
});

// ---------------- Alert Thresholds + Log Interval (combined, per Admin > Alert Thresholds page) ----------------
router.get("/thresholds", requireRole(["Admin", "Supervisor"]), async (req, res) => {
  await db.read();
  res.json({ ...db.data.thresholds, log_interval_seconds: db.data.settings.log_interval_seconds });
});

router.put("/thresholds", requireRole(["Admin"]), async (req, res) => {
  const { vibration, temperature, log_interval_seconds } = req.body || {};
  await db.read();
  if (vibration) {
    const { yellow, orange, red } = vibration;
    if ([yellow, orange, red].some((v) => typeof v !== "number") || !(yellow < orange && orange < red)) {
      return res.status(400).json({ error: "Vibration thresholds must be numeric and increasing: yellow < orange < red" });
    }
    db.data.thresholds.vibration = { yellow, orange, red };
  }
  if (temperature) {
    const { yellow, orange, red } = temperature;
    if ([yellow, orange, red].some((v) => typeof v !== "number") || !(yellow < orange && orange < red)) {
      return res.status(400).json({ error: "Temperature thresholds must be numeric and increasing: yellow < orange < red" });
    }
    db.data.thresholds.temperature = { yellow, orange, red };
  }
  if (log_interval_seconds !== undefined) {
    if (typeof log_interval_seconds !== "number" || log_interval_seconds < 2 || log_interval_seconds > 3600) {
      return res.status(400).json({ error: "log_interval_seconds must be a number between 2 and 3600" });
    }
    db.data.settings.log_interval_seconds = log_interval_seconds;
  }
  await save();
  res.json({ ...db.data.thresholds, log_interval_seconds: db.data.settings.log_interval_seconds });
});

// ---------------- Notifications: SMTP / SMS / Daily Report Time ----------------
router.get("/notifications", requireRole(["Admin"]), async (req, res) => {
  await db.read();
  const { smtp, sms, daily_report_time } = db.data.settings;
  // Never send the raw password back to the client
  res.json({
    daily_report_time,
    smtp: { ...smtp, pass: smtp.pass ? "••••••••" : "" },
    sms: { ...sms, api_key: sms.api_key ? "••••••••" : "" },
  });
});

router.put("/notifications", requireRole(["Admin"]), async (req, res) => {
  const { daily_report_time, smtp, sms } = req.body || {};
  await db.read();
  if (daily_report_time) {
    if (!/^\d{2}:\d{2}$/.test(daily_report_time)) return res.status(400).json({ error: "daily_report_time must be in HH:mm format" });
    db.data.settings.daily_report_time = daily_report_time;
  }
  if (smtp) {
    db.data.settings.smtp = {
      enabled: !!smtp.enabled,
      host: smtp.host ?? db.data.settings.smtp.host,
      port: smtp.port ?? db.data.settings.smtp.port,
      secure: !!smtp.secure,
      user: smtp.user ?? db.data.settings.smtp.user,
      pass: smtp.pass && smtp.pass !== "••••••••" ? smtp.pass : db.data.settings.smtp.pass,
      from_name: smtp.from_name ?? db.data.settings.smtp.from_name,
      from_email: smtp.from_email ?? db.data.settings.smtp.from_email,
    };
  }
  if (sms) {
    db.data.settings.sms = {
      enabled: !!sms.enabled,
      provider: sms.provider ?? db.data.settings.sms.provider,
      api_key: sms.api_key && sms.api_key !== "••••••••" ? sms.api_key : db.data.settings.sms.api_key,
      sender_id: sms.sender_id ?? db.data.settings.sms.sender_id,
    };
  }
  await save();
  res.json({ success: true });
});

router.post("/notifications/test-email", requireRole(["Admin"]), async (req, res) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: "Provide a 'to' email address" });
  const log = await sendEmail({
    toAddress: to,
    subject: "Himnish OBCMS & PICCU — SMTP Test",
    text: "This is a test email confirming your SMTP configuration is working.",
  });
  res.json(log);
});

module.exports = router;
