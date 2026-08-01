const express = require("express");
const { db } = require("../db/db");
const { accessibleCoachIds, requireCoachAccess } = require("../services/access");

const router = express.Router();
const BAND_ORDER = ["NODATA", "GREEN", "YELLOW", "ORANGE", "RED"];

function worstOf(bands) {
  return bands.reduce((w, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(w) ? b : w), "NODATA");
}

function latestReadingFor(axleId) {
  const readings = db.data.readings.filter((r) => r.axle_id === axleId);
  return readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;
}

function coachOverallBand(coachId) {
  const axles = db.data.axles.filter((a) => a.coach_id === coachId);
  const bands = axles.map((a) => {
    const latest = latestReadingFor(a.id);
    return latest ? latest.band : "NODATA";
  });
  return worstOf(bands.length ? bands : ["NODATA"]);
}

router.get("/", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const coaches = db.data.coaches
    .filter((c) => allowed.has(c.id))
    .map((c) => {
      const rake = db.data.rakes.find((r) => r.id === c.rake_id);
      const openAlerts = db.data.alerts.filter((a) => a.coach_id === c.id && !a.acknowledged).length;
      const piccuFault = db.data.piccuSystems.filter((p) => p.coach_id === c.id && p.status === "Fault").length;
      return {
        ...c,
        rake_name: rake ? rake.rake_name : "Unassigned",
        rake_type: rake ? rake.rake_type : "-",
        overall_band: coachOverallBand(c.id),
        open_alerts: openAlerts,
        piccu_faults: piccuFault,
        axle_count: db.data.axles.filter((a) => a.coach_id === c.id).length,
      };
    });
  res.json(coaches);
});

const SCORE_BY_BAND = { GREEN: 100, YELLOW: 75, ORANGE: 40, RED: 10 };

// Composite fleet health % + a Novius-style quick-glance subsystem checklist, both scoped
// to the requesting user's accessible coaches. Every checklist item is backed by data this
// platform actually collects — no category is shown unless there's a real signal behind it.
router.get("/health-summary", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const myCoaches = db.data.coaches.filter((c) => allowed.has(c.id));
  const myCoachIds = myCoaches.map((c) => c.id);

  // ---- Overall composite % — average of each coach's worst-axle band, scored 0-100 ----
  const coachBands = myCoaches.map((c) => coachOverallBand(c.id));
  const scored = coachBands.map((b) => SCORE_BY_BAND[b]).filter((s) => s !== undefined);
  const overallHealthPct = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;
  const overallBand = worstOf(coachBands.length ? coachBands : ["NODATA"]);

  const myAxles = db.data.axles.filter((a) => myCoachIds.includes(a.coach_id));

  // ---- 1. Axle Vibration & Temperature ----
  const vibrationBandCounts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
  coachBands.forEach((b) => { if (vibrationBandCounts[b] !== undefined) vibrationBandCounts[b]++; });
  const vibrationWorst = worstOf(coachBands.length ? coachBands : ["NODATA"]);
  const vibrationAffected = vibrationBandCounts.RED + vibrationBandCounts.ORANGE;

  // ---- 2. Wheel Condition (flat/shelling risk proxy) ----
  const wheelFlaggedAxles = myAxles.filter((a) => a.wheel_defect_band === "RED" || a.wheel_defect_band === "ORANGE");
  const wheelWorstBand = wheelFlaggedAxles.some((a) => a.wheel_defect_band === "RED") ? "RED"
    : wheelFlaggedAxles.length ? "ORANGE"
    : myAxles.some((a) => a.wheel_defect_band === "YELLOW") ? "YELLOW"
    : myAxles.some((a) => a.wheel_defect_band) ? "GREEN" : "NODATA";

  // ---- 3. Onboard Sub-Systems (PICCU) ----
  const piccuRows = db.data.piccuSystems.filter((p) => myCoachIds.includes(p.coach_id));
  const piccuFaults = piccuRows.filter((p) => p.status === "Fault").length;
  const piccuNoData = piccuRows.filter((p) => p.status === "No Data").length;
  const piccuBand = piccuFaults > 0 ? "RED" : piccuNoData > 0 ? "YELLOW" : piccuRows.length ? "GREEN" : "NODATA";

  // ---- 4. Sensor & Communication Health (self-diagnosis) ----
  const faultAxles = myAxles.filter((a) => a.sensor_health === "FAULT").length;
  const staleAxles = myAxles.filter((a) => a.sensor_health === "STALE").length;
  const myDeviceCommFaults = db.data.rutDevices.filter((d) => d.current_coach_id && myCoachIds.includes(d.current_coach_id) && d.comm_health === "FAULT").length;
  const sensorBand = (faultAxles + myDeviceCommFaults) > 0 ? "RED" : staleAxles > 0 ? "YELLOW"
    : myAxles.some((a) => a.sensor_health === "OK") ? "GREEN" : "NODATA";

  // ---- 5. Open Critical Alerts ----
  const openAlerts = db.data.alerts.filter((a) => myCoachIds.includes(a.coach_id) && !a.acknowledged);
  const openRed = openAlerts.filter((a) => a.band === "RED").length;
  const openOrange = openAlerts.filter((a) => a.band === "ORANGE").length;
  const alertsBand = openRed > 0 ? "RED" : openOrange > 0 ? "ORANGE" : openAlerts.length > 0 ? "YELLOW" : "GREEN";

  res.json({
    overall_health_pct: overallHealthPct,
    overall_band: overallBand,
    coach_count: myCoaches.length,
    checklist: [
      {
        key: "axle", label: "Axle Vibration & Temperature", band: vibrationWorst,
        detail: vibrationWorst === "NODATA" ? "No axle readings received yet"
          : vibrationAffected > 0 ? `${vibrationAffected} coach(es) need attention` : "All axles within normal range",
      },
      {
        key: "wheel", label: "Wheel Condition (Flat/Shelling Risk)", band: wheelWorstBand,
        detail: wheelWorstBand === "NODATA" ? "No wheel-defect data yet"
          : wheelFlaggedAxles.length > 0 ? `${wheelFlaggedAxles.length} axle(s) flagged` : "No periodic-shock signature detected",
      },
      {
        key: "piccu", label: "Onboard Sub-Systems (PICCU)", band: piccuBand,
        detail: piccuBand === "NODATA" ? "No PICCU sub-systems configured"
          : piccuFaults > 0 ? `${piccuFaults} sub-system fault(s)` : piccuNoData > 0 ? `${piccuNoData} sub-system(s) not reporting` : "All sub-systems reporting",
      },
      {
        key: "sensor", label: "Sensor & Communication Health", band: sensorBand,
        detail: sensorBand === "NODATA" ? "No sensor health data yet"
          : (faultAxles + myDeviceCommFaults) > 0 ? `${faultAxles + myDeviceCommFaults} fault(s) detected` : staleAxles > 0 ? `${staleAxles} sensor(s) stale` : "All sensors/links healthy",
      },
      {
        key: "alerts", label: "Open Critical Alerts", band: alertsBand,
        detail: openAlerts.length > 0 ? `${openAlerts.length} unacknowledged alert(s)` : "No open alerts",
      },
    ],
  });
});

router.get("/summary", async (req, res) => {
  await db.read();
  const allowed = new Set(accessibleCoachIds(req));
  const myCoaches = db.data.coaches.filter((c) => allowed.has(c.id));
  const bandCounts = { NODATA: 0, GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
  myCoaches.forEach((c) => { bandCounts[coachOverallBand(c.id)]++; });
  const myCoachIds = myCoaches.map((c) => c.id);
  res.json({
    total_coaches: myCoaches.length,
    total_rakes: new Set(myCoaches.map((c) => c.rake_id)).size,
    total_axles: db.data.axles.filter((a) => myCoachIds.includes(a.coach_id)).length,
    open_alerts: db.data.alerts.filter((a) => myCoachIds.includes(a.coach_id) && !a.acknowledged).length,
    piccu_faults: db.data.piccuSystems.filter((p) => myCoachIds.includes(p.coach_id) && p.status === "Fault").length,
    band_counts: bandCounts,
  });
});

router.get("/:id", requireCoachAccess, async (req, res) => {
  await db.read();
  const coach = db.data.coaches.find((c) => c.id === Number(req.params.id));
  if (!coach) return res.status(404).json({ error: "Coach not found" });
  const rake = db.data.rakes.find((r) => r.id === coach.rake_id);
  res.json({ ...coach, rake_name: rake ? rake.rake_name : "Unassigned", rake_type: rake ? rake.rake_type : "-" });
});

router.get("/:id/axles", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const axles = db.data.axles
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => a.axle_number - b.axle_number)
    .map((a) => {
      const readings = db.data.readings
        .filter((r) => r.axle_id === a.id)
        .sort((x, y) => new Date(y.ts) - new Date(x.ts));
      return { ...a, latest: readings[0] || null, history: readings.slice(0, 20).reverse() };
    });
  res.json(axles);
});

router.get("/:id/alerts", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const alerts = db.data.alerts
    .filter((a) => a.coach_id === coachId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 300); // single-coach view — capped defensively, same reasoning as /api/alerts
  res.json(alerts);
});

router.get("/:id/piccu", requireCoachAccess, async (req, res) => {
  await db.read();
  const coachId = Number(req.params.id);
  const coach = db.data.coaches.find((c) => c.id === coachId);
  const systems = db.data.piccuSystems.filter((p) => p.coach_id === coachId);
  const telemetry = db.data.piccuTelemetry.filter((t) => t.coach_id === coachId);
  const latestByParam = {};
  telemetry.forEach((t) => {
    if (!latestByParam[t.param] || new Date(t.ts) > new Date(latestByParam[t.param].ts)) {
      latestByParam[t.param] = t;
    }
  });
  res.json({
    systems,
    telemetry: Object.values(latestByParam),
    wli_tank_level_pct: coach ? (coach.wli_tank_level_pct ?? null) : null,
    wli_tank_level_updated_at: coach ? (coach.wli_tank_level_updated_at || null) : null,
  });
});

module.exports = router;
module.exports.coachOverallBand = coachOverallBand;
module.exports.worstOf = worstOf;
