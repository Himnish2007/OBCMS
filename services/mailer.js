const nodemailer = require("nodemailer");
const { db, save, nextId } = require("../db/db");

// Sends an email using the SMTP settings configured by the Admin (Admin > Notifications).
// Real delivery requires the admin to enter valid SMTP credentials — until then this
// logs the attempt as "simulated" so the rest of the reporting/alerting pipeline can be
// built and tested without a live mail server.
async function sendEmail({ toUserId, toAddress, subject, text, html, attachments }) {
  // NOTE: deliberately does NOT call db.read() here. This function can be invoked
  // as a fire-and-forget side effect from the middle of services/ingestion.js's
  // (which holds not-yet-saved changes in the shared in-memory db.data). Re-reading
  // from disk at this point would silently discard those pending changes. We rely
  // on db.data already being the live, shared, in-memory singleton kept current by
  // init() at startup and every route/service that mutates it directly.
  const smtp = db.data.settings.smtp;
  const logEntry = {
    id: nextId(db.data.notificationLog),
    ts: new Date().toISOString(),
    type: "email",
    user_id: toUserId || null,
    to: toAddress,
    subject,
    status: "pending",
    detail: "",
  };

  if (!smtp.enabled || !smtp.host || !smtp.user || !smtp.pass || !toAddress) {
    logEntry.status = "simulated";
    logEntry.detail = !smtp.enabled
      ? "SMTP not enabled in Admin > Notifications — email logged only, not sent."
      : !toAddress
      ? "Recipient has no email address configured."
      : "SMTP host/user/password incomplete — email logged only, not sent.";
    db.data.notificationLog.push(logEntry);
    await save();
    return logEntry;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port) || 587,
      secure: !!smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transporter.sendMail({
      from: `"${smtp.from_name || "Himnish OBCMS & PICCU"}" <${smtp.from_email || smtp.user}>`,
      to: toAddress,
      subject,
      text,
      html,
      attachments: attachments || [],
    });
    logEntry.status = "sent";
  } catch (err) {
    logEntry.status = "failed";
    logEntry.detail = err.message;
  }

  db.data.notificationLog.push(logEntry);
  await save();
  return logEntry;
}

module.exports = { sendEmail };
