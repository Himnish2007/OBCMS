const { db } = require("../db/db");

function getCurrentUser(req) {
  return db.data.users.find((u) => u.id === req.user.id);
}

// Returns the list of coach IDs this user is allowed to see.
// Admin => all coaches. Everyone else => only their assigned_coaches.
function accessibleCoachIds(req) {
  const user = getCurrentUser(req);
  if (!user) return [];
  if (user.role === "Admin") return db.data.coaches.map((c) => c.id);
  return user.assigned_coaches || [];
}

function canAccessCoach(req, coachId) {
  return accessibleCoachIds(req).includes(Number(coachId));
}

// Middleware: 404s (not 403, to avoid leaking coach existence) if the user
// cannot access the :id coach param on a route.
function requireCoachAccess(req, res, next) {
  const coachId = Number(req.params.id || req.params.coach_id);
  if (!canAccessCoach(req, coachId)) {
    return res.status(404).json({ error: "Coach not found" });
  }
  next();
}

module.exports = { getCurrentUser, accessibleCoachIds, canAccessCoach, requireCoachAccess };
