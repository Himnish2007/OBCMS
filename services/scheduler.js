const { db, save } = require("../db/db");
const { buildCoachReportPdf } = require("./pdfReport");
const { sendEmail } = require("./mailer");
const { runSelfDiagnosisSweep } = require("./selfDiagnosis");
const { runDowntimeSweep } = require("./downtime");

function todayStr() {
  return new Date().toISOString().slice(0, 10); // yyyy-mm-dd
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function runDailyReportsIfDue() {
  await db.read();
  const settings = db.data.settings;
  const target = settings.daily_report_time || "08:00";
  const today = todayStr();

  if (settings.last_daily_report_date === today) return; // already ran today
  if (nowHHMM() !== target) return; // not the configured minute yet

  const recipients = db.data.users.filter((u) => u.role !== "Admin" && (u.assigned_coaches || []).length > 0);

  for (const user of recipients) {
    try {
      const pdfBuffer = await buildCoachReportPdf({
        title: `Daily Coach Report — ${today}`,
        coachIds: user.assigned_coaches,
        generatedFor: `${user.name} (${user.username})`,
      });
      await sendEmail({
        toUserId: user.id,
        toAddress: user.email,
        subject: `Himnish OBCMS & PICCU — Daily Report (${today})`,
        text: `Attached is your daily condition-monitoring report for ${user.assigned_coaches.length} assigned coach(es).`,
        attachments: [{ filename: `daily-report-${today}.pdf`, content: pdfBuffer }],
      });
    } catch (err) {
      console.error(`Daily report failed for user ${user.username}:`, err.message);
    }
  }

  db.data.settings.last_daily_report_date = today;
  await save();
}

function start() {
  // Check once a minute — cheap, and only actually does work once per day per user for the
  // report; the self-diagnosis and downtime sweeps run every tick since staleness/downtime
  // both need to be caught close to real-time (MDTS:44415 self-diagnosis + Part C Clause 10).
  return setInterval(() => {
    runDailyReportsIfDue().catch((err) => console.error("Daily report scheduler error:", err.message));
    runSelfDiagnosisSweep().catch((err) => console.error("Self-diagnosis sweep error:", err.message));
    runDowntimeSweep().catch((err) => console.error("Downtime sweep error:", err.message));
  }, 60 * 1000);
}

module.exports = { start, runDailyReportsIfDue };
