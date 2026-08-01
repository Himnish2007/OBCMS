// ============================================================================
// BREAK-GLASS PASSWORD RESET — for when nobody can get into the dashboard at all
// (e.g. the only Admin account is locked out, or its password was lost and there's
// no other Admin to reset it from the UI).
//
// Run directly against the deployed environment so it edits the real database, not a
// local one:
//
//   railway run node scripts/reset-admin-password.js <username> <new-password>
//
// Example:
//   railway run node scripts/reset-admin-password.js admin "NewStrongPass#2026"
//
// This bypasses login, OTP, DSC and account lockout entirely — it edits the database
// file directly, the same way seed.js does. Treat it like a physical master key: anyone
// who can run it already has full Railway/deploy access to this project, so it isn't a
// new privilege, just a recovery path that doesn't depend on being logged in already.
// ============================================================================

const { db, init, addAudit } = require("../db/db");
const { validatePassword } = require("../services/auth");
const bcrypt = require("bcryptjs");

async function main() {
  const [username, newPassword] = process.argv.slice(2);
  if (!username || !newPassword) {
    console.error("Usage: node scripts/reset-admin-password.js <username> <new-password>");
    process.exit(1);
  }

  await init();

  const user = db.data.users.find((u) => u.username === username);
  if (!user) {
    console.error(`No user found with username "${username}". Existing usernames: ${db.data.users.map((u) => u.username).join(", ")}`);
    process.exit(1);
  }

  const policyError = validatePassword(newPassword);
  if (policyError) {
    console.error(`Password rejected: ${policyError}`);
    process.exit(1);
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.must_change_password = false;
  user.failed_login_attempts = 0;
  user.locked_until = null;
  user.otp_hash = null;
  user.otp_expires_at = null;
  user.dsc_challenge = null;
  user.dsc_challenge_expires_at = null;

  addAudit(user, "password_reset_via_breakglass_script", {});
  await db.write();

  console.log(`✅ Password for "${username}" has been reset, and the account has been unlocked.`);
  console.log("   You can log in with the new password immediately.");
}

main().catch((err) => {
  console.error("Break-glass reset failed:", err);
  process.exit(1);
});
