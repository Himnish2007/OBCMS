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

  if (!sms.enabled || !sms.url || !toPhone) {
    logEntry.status = "simulated";
    logEntry.detail = !sms.enabled
      ? "SMS not enabled in Admin > Notifications — message logged only, not sent."
      : !toPhone
      ? "Recipient has no phone number configured."
      : "SMS gateway URL not configured in Admin > Notifications — message logged only, not sent.";
    db.data.notificationLog.push(logEntry);
    await save();
    return logEntry;
  }

  try {
    const responseSnippet = await sendViaProvider(sms, toPhone, message);
    logEntry.status = "sent";
    logEntry.detail = responseSnippet;
  } catch (err) {
    logEntry.status = "failed";
    logEntry.detail = err.message;
  }

  db.data.notificationLog.push(logEntry);
  await save();
  return logEntry;
}

// Generic REST-provider bridge — works with any HTTP/JSON SMS gateway (Fast2SMS, MSG91,
// Twilio, AWS SNS via API Gateway, a company's own SMPP-to-HTTP relay, etc.) purely through
// Admin > Notifications configuration, with no further code changes needed:
//   method            "POST" (default) or "GET"
//   url               the gateway's send-SMS endpoint
//   headers           JSON string, e.g. {"authorization":"<api_key>","Content-Type":"application/json"}
//   body_template     JSON/form string with {{phone}} and {{message}} placeholders
//   api_key           available as {{api_key}} inside headers/body_template too
async function sendViaProvider(smsSettings, toPhone, message) {
  const substitute = (str) =>
    (str || "")
      .replaceAll("{{phone}}", toPhone)
      .replaceAll("{{message}}", message.replace(/"/g, '\\"'))
      .replaceAll("{{api_key}}", smsSettings.api_key || "")
      .replaceAll("{{sender_id}}", smsSettings.sender_id || "");

  let headers = { "Content-Type": "application/json" };
  if (smsSettings.headers) {
    try {
      headers = JSON.parse(substitute(smsSettings.headers));
    } catch (err) {
      throw new Error("SMS headers template is not valid JSON: " + err.message);
    }
  }

  const method = (smsSettings.method || "POST").toUpperCase();
  const url = substitute(smsSettings.url);
  const body = smsSettings.body_template ? substitute(smsSettings.body_template) : undefined;

  const res = await fetch(url, { method, headers, body: method === "GET" ? undefined : body });
  const text = await res.text();
  if (!res.ok) throw new Error(`SMS gateway responded ${res.status}: ${text.slice(0, 200)}`);
  return text.slice(0, 200);
}

module.exports = { sendSms };
