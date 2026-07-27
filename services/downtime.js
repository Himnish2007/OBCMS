// ============================================================================
// DOWNTIME & PENALTY — MDTS:44415 Part C, Clause 10
//
// "Downtime shall be calculated as percentage of total downtime hours for the
// month." Penalty slabs on the contractor's monthly proportionate bill:
//   <=1.5%        -> Nil
//   >1.5% to 3%   -> 2%
//   >3% to 5%     -> 5%
//   >5% to 10%    -> 10%
//   >10%          -> 20%
//
// "Downtime" here is defined as a coach's assigned RUT device (its OBCMS/PICCU
// data link) not reporting for longer than Settings > downtime_threshold_minutes.
// Every UP<->DOWN transition is logged in db.data.systemStatusLog so the monthly
// hours figure is a real integral over logged intervals, not a live-only snapshot.
// ============================================================================

const { db, save, nextId } = require("../db/db");

const PENALTY_SLABS = [
  { maxPct: 1.5, penaltyPct: 0 },
  { maxPct: 3, penaltyPct: 2 },
  { maxPct: 5, penaltyPct: 5 },
  { maxPct: 10, penaltyPct: 10 },
  { maxPct: Infinity, penaltyPct: 20 },
];

function penaltyPctForDowntime(downtimePct) {
  const slab = PENALTY_SLABS.find((s) => downtimePct <= s.maxPct);
  return slab ? slab.penaltyPct : 20;
}

// Called every minute from services/scheduler.js. Opens a DOWN log entry the moment a
// device crosses the staleness threshold, and closes it (logs UP) the instant a push
// arrives from a device with an open DOWN period (see markDeviceUp() below, called from
// services/ingestion.js).
async function runDowntimeSweep() {
  await db.read();
  const thresholdMin = Number(db.data.settings.downtime_threshold_minutes) || 30;
  let changed = false;

  for (const device of db.data.rutDevices) {
    if (!device.current_coach_id) continue;
    const ageMin = device.last_seen_at ? (Date.now() - new Date(device.last_seen_at).getTime()) / 60000 : Infinity;
    const isDown = ageMin > thresholdMin;
    const openDown = db.data.systemStatusLog.find(
      (s) => s.coach_id === device.current_coach_id && s.status === "DOWN" && !s.closed_at
    );

    if (isDown && !openDown) {
      db.data.systemStatusLog.push({
        id: nextId(db.data.systemStatusLog),
        coach_id: device.current_coach_id,
        device_key: device.device_key,
        status: "DOWN",
        started_at: new Date().toISOString(),
        closed_at: null,
      });
      changed = true;
    }
  }

  if (changed) await save();
  return { changed };
}

// Called from services/ingestion.js on every accepted push — closes any open DOWN period
// for this coach the moment fresh data arrives.
function markDeviceUp(coachId) {
  const open = db.data.systemStatusLog.find((s) => s.coach_id === coachId && s.status === "DOWN" && !s.closed_at);
  if (open) open.closed_at = new Date().toISOString();
}

// Computes downtime hours for a coach within [rangeStart, rangeEnd) by intersecting every
// logged DOWN interval with the requested range. An interval still open (closed_at===null)
// is treated as ongoing until "now" (or the range end, whichever is earlier).
function downtimeHoursForCoach(coachId, rangeStart, rangeEnd) {
  const now = new Date();
  let totalMs = 0;
  for (const entry of db.data.systemStatusLog) {
    if (entry.coach_id !== coachId || entry.status !== "DOWN") continue;
    const start = new Date(entry.started_at);
    const end = entry.closed_at ? new Date(entry.closed_at) : now;
    const overlapStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));
    if (overlapEnd > overlapStart) totalMs += overlapEnd.getTime() - overlapStart.getTime();
  }
  return totalMs / (1000 * 60 * 60);
}

// year: e.g. 2026, month: 1-12
function monthlyDowntimeReport(coachId, year, month) {
  const coach = db.data.coaches.find((c) => c.id === coachId);
  if (!coach) return null;
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1); // first of next month, exclusive
  const totalHoursInMonth = (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60);
  const downtimeHours = downtimeHoursForCoach(coachId, rangeStart, rangeEnd);
  const downtimePct = totalHoursInMonth > 0 ? (downtimeHours / totalHoursInMonth) * 100 : 0;
  const penaltyPct = penaltyPctForDowntime(downtimePct);
  const monthlyBill = Number(coach.monthly_bill_amount) || 0;
  const penaltyAmount = monthlyBill * (penaltyPct / 100);

  return {
    coach_id: coach.id,
    coach_number: coach.coach_number,
    year,
    month,
    total_hours_in_month: Number(totalHoursInMonth.toFixed(1)),
    downtime_hours: Number(downtimeHours.toFixed(2)),
    downtime_pct: Number(downtimePct.toFixed(3)),
    penalty_pct: penaltyPct,
    monthly_bill_amount: monthlyBill,
    penalty_amount: Number(penaltyAmount.toFixed(2)),
  };
}

function monthlyDowntimeReportAllCoaches(year, month) {
  return db.data.coaches.map((c) => monthlyDowntimeReport(c.id, year, month)).filter(Boolean);
}

module.exports = {
  runDowntimeSweep,
  markDeviceUp,
  downtimeHoursForCoach,
  monthlyDowntimeReport,
  monthlyDowntimeReportAllCoaches,
  penaltyPctForDowntime,
  PENALTY_SLABS,
};
