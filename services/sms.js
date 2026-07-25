const { db, save, nextId } = require("../db/db");

// PLUGGABLE SMS INTERFACE
// -------------------------------------------------------------------------
// There is no SMS gateway account configured in this project. Sending real
// SMS requires a paid provider (Twilio, MSG91, AWS SNS, etc.) and API
// credentials that only Himnish/the Railway can provide. This function
// builds the message and logs it to notificationLog so the alert-routing
// and daily-report pipeline can be fully wired and tested end-to-end —
// but it does NOT deliver a real text message until a provider's HTTP call
// is added in the `sendViaProvider()` block below with real credentials.
async function sendSms({ toUserId, toPhone, message }) {
  // See services/mailer.js for why db.read() is deliberately NOT called here.
  const sms = db.data.settings.sms;
  const logEntry = {
    id: nextId(db.data.notificationLog),
    ts: new Date().toISOString(),
    type: "sms",
    user_id: toUserId || null,
    to: toPhone,
    subject: message.slice(0, 40),
    status: "pending",
    detail: "",
  };

  if (!sms.enabled || !sms.provider || !sms.api_key || !toPhone) {
    logEntry.status = "simulated";
    logEntry.detail = !sms.enabled
      ? "SMS not enabled in Admin > Notifications — message logged only, not sent."
      : !toPhone
      ? "Recipient has no phone number configured."
      : "SMS provider/API key not configured — message logged only, not sent.";
    db.data.notificationLog.push(logEntry);
    await save();
    return logEntry;
  }

  try {
    await sendViaProvider(sms, toPhone, message);
    logEntry.status = "sent";
  } catch (err) {
    logEntry.status = "failed";
    logEntry.detail = err.message;
  }

  db.data.notificationLog.push(logEntry);
  await save();
  return logEntry;
}

// Wire a real provider here once Himnish has an account. Example shape for Twilio/MSG91
// style REST APIs is sketched below — replace with the exact contract of the chosen
// provider before relying on this in production.
async function sendViaProvider(smsSettings, toPhone, message) {
  throw new Error(
    `No SMS provider integration implemented for "${smsSettings.provider}". ` +
    `Add the provider's API call in services/sms.js sendViaProvider().`
  );
}

module.exports = { sendSms };
