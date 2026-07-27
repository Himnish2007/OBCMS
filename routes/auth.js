const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { db, save, addAudit } = require("../db/db");
const { signToken, requireAuth, validatePassword } = require("../services/auth");
const { sendEmail } = require("../services/mailer");

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const OTP_VALID_MINUTES = 5;

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  await db.read();
  const user = db.data.users.find((u) => u.username === username);

  // Same generic error whether the username doesn't exist or the password is wrong —
  // avoids leaking which usernames are valid.
  const genericError = () => res.status(401).json({ error: "Invalid credentials" });

  if (!user) return genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(423).json({ error: `Account locked due to repeated failed logins. Try again in ${minsLeft} minute(s).` });
  }

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    user.failed_login_attempts = (user.failed_login_attempts || 0) + 1;
    if (user.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
      user.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
      user.failed_login_attempts = 0;
      addAudit(user, "account_locked", { reason: "too many failed login attempts" });
    }
    await save();
    return genericError();
  }

  user.failed_login_attempts = 0;
  user.locked_until = null;

  // Optional MFA: Admin > Notifications-adjacent security setting. Off by default since
  // it depends on SMTP being configured — turning it on with no SMTP would lock everyone
  // out, so routes/admin.js only allows enabling it after a successful test-email.
  if (db.data.settings.mfa_required) {
    if (!user.email) {
      await save();
      return res.status(400).json({ error: "MFA is required but this account has no email on file. Contact an Admin." });
    }
    const otp = String(crypto.randomInt(100000, 999999));
    user.otp_hash = hashOtp(otp);
    user.otp_expires_at = new Date(Date.now() + OTP_VALID_MINUTES * 60 * 1000).toISOString();
    await save();
    await sendEmail({
      toUserId: user.id,
      toAddress: user.email,
      subject: "Himnish OBCMS & PICCU — Your login code",
      text: `Your one-time login code is ${otp}. It expires in ${OTP_VALID_MINUTES} minutes. If you did not request this, ignore this email.`,
    });
    return res.json({ otp_required: true, user_id: user.id });
  }

  await save();
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, name: user.name },
    must_change_password: !!user.must_change_password,
  });
});

// Second step when Admin > Security > "Require email OTP at login" is enabled.
router.post("/verify-otp", async (req, res) => {
  const { user_id, otp } = req.body || {};
  if (!user_id || !otp) return res.status(400).json({ error: "user_id and otp are required" });
  await db.read();
  const user = db.data.users.find((u) => u.id === Number(user_id));
  if (!user || !user.otp_hash || !user.otp_expires_at) {
    return res.status(401).json({ error: "No login code pending for this account. Please log in again." });
  }
  if (new Date(user.otp_expires_at) < new Date()) {
    user.otp_hash = null;
    user.otp_expires_at = null;
    await save();
    return res.status(401).json({ error: "Login code expired. Please log in again." });
  }
  if (hashOtp(String(otp)) !== user.otp_hash) {
    return res.status(401).json({ error: "Incorrect login code" });
  }
  user.otp_hash = null;
  user.otp_expires_at = null;
  await save();
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, name: user.name },
    must_change_password: !!user.must_change_password,
  });
});

// Any authenticated user can change their own password. Required before doing anything
// else if must_change_password is set (default seeded demo accounts, or after an Admin
// reset). Also clears must_change_password once a real password is chosen.
router.post("/change-password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "current_password and new_password are required" });
  }
  await db.read();
  const user = db.data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!bcrypt.compareSync(current_password, user.passwordHash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const policyError = validatePassword(new_password);
  if (policyError) return res.status(400).json({ error: policyError });

  user.passwordHash = bcrypt.hashSync(new_password, 10);
  user.must_change_password = false;
  await save();
  addAudit(user, "password_changed", { self_service: true });
  res.json({ success: true });
});

module.exports = router;
