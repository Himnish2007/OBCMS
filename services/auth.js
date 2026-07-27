const jwt = require("jsonwebtoken");

const DEV_FALLBACK_SECRET = "himnish-obcms-piccu-dev-secret";
const IS_PRODUCTION = (process.env.NODE_ENV || "").toLowerCase() === "production";

if (!process.env.JWT_SECRET) {
  if (IS_PRODUCTION) {
    // Refuse to boot with a guessable, hardcoded secret in production — a predictable
    // JWT_SECRET means anyone can forge an Admin token.
    throw new Error(
      "JWT_SECRET environment variable is required when NODE_ENV=production. " +
      "Set a strong random secret (e.g. `openssl rand -hex 32`) in Railway > Variables."
    );
  }
  console.warn(
    "[WARN] JWT_SECRET not set — using an insecure development fallback. " +
    "This is only acceptable for local/demo use. Set JWT_SECRET before deploying."
  );
}

const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Usage: requireRole("Admin") or requireRole(["Admin", "Supervisor"])
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires role: ${allowed.join(" or ")}` });
    }
    next();
  };
}

// Password policy: at least 8 chars, and at least one letter + one digit.
// Kept intentionally simple (not requiring special characters) so it's usable by
// non-technical depot staff while still ruling out trivial passwords like "123456".
function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number";
  }
  return null; // valid
}

module.exports = { signToken, requireAuth, requireRole, validatePassword, JWT_SECRET };
