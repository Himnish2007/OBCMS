const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds } = require("../services/access");

const router = express.Router();
const SCORE_BY_BAND = { GREEN: 100, YELLOW: 75, ORANGE: 40, RED: 10 };

function latestReadingFor(axleId) {
  const readings = db.data.readings.filter((r) => r.axle_id === axleId);
  return readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;
}

router.get("/fleet", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const coaches = db.data.coaches
    .filter((c) => allowed.has(c.id))
    .map((c) => {
      const rake = db.data.rakes.find((r) => r.id === c.rake_id);
      const axles = db.data.axles
        .filter((a) => a.coach_id === c.id)
        .sort((a, b) => a.axle_number - b.axle_number)
        .map((a) => {
          const latest = latestReadingFor(a.id);
          return {
            axle_id: a.id,
            axle_number: a.axle_number,
            band: latest ? latest.band : "NODATA",
            vibration_g: latest ? latest.vibration_g : null,
            temperature_c: latest ? latest.temperature_c : null,
          };
        });
      const scores = axles.map((a) => SCORE_BY_BAND[a.band]).filter((s) => s !== undefined);
      const healthScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
      return {
        coach_id: c.id,
        coach_number: c.coach_number,
        coach_type: c.coach_type,
        rake_name: rake ? rake.rake_name : "Unassigned",
        rake_type: rake ? rake.rake_type : "-",
        status: c.status,
        axles,
        health_score: healthScore,
      };
    });
  res.json(coaches.sort((a, b) => {
    if (a.health_score === null && b.health_score === null) return 0;
    if (a.health_score === null) return 1; // No Data sinks to the bottom of the "worst first" list
    if (b.health_score === null) return -1;
    return a.health_score - b.health_score;
  }));
});

router.get("/worst-axles", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const limit = Number(req.query.limit) || 10;
  const rows = [];
  db.data.axles.filter((a) => allowed.has(a.coach_id)).forEach((a) => {
    const latest = latestReadingFor(a.id);
    if (!latest) return;
    const coach = db.data.coaches.find((c) => c.id === a.coach_id);
    rows.push({
      axle_id: a.id,
      axle_number: a.axle_number,
      coach_number: coach ? coach.coach_number : "-",
      band: latest.band,
      vibration_g: latest.vibration_g,
      temperature_c: latest.temperature_c,
      ts: latest.ts,
    });
  });
  const order = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
  rows.sort((a, b) => order[a.band] - order[b.band] || b.vibration_g - a.vibration_g);
  res.json(rows.slice(0, limit));
});

module.exports = router;
