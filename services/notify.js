const { db } = require("../db/db");
const { sendEmail } = require("./mailer");
const { sendSms } = require("./sms");

// Called whenever a new ORANGE/RED alert is raised for a coach. Finds every
// user who has that coach in their assigned_coaches and routes the alert to
// them by email and (if configured) SMS. Admins are not auto-notified here —
// they see everything on the dashboard directly.
async function notifyAlert(alert, coach) {
  const recipients = db.data.users.filter(
    (u) => u.role !== "Admin" && (u.assigned_coaches || []).includes(coach.id)
  );

  for (const user of recipients) {
    const subject = `[${alert.severity}] ${coach.coach_number} — ${alert.band} alert on Axle-${alert.axle_number}`;
    const text = `${alert.message}\n\nCoach: ${coach.coach_number}\nAxle: ${alert.axle_number}\nBand: ${alert.band}\nTime: ${alert.created_at}\n\n— Himnish OBCMS & PICCU Monitoring`;
    await sendEmail({ toUserId: user.id, toAddress: user.email, subject, text });
    await sendSms({ toUserId: user.id, toPhone: user.phone, message: `${subject} — ${alert.message}` });
  }
}

module.exports = { notifyAlert };
