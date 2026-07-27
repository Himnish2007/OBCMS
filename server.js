require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { init } = require("./db/db");
const simulator = require("./services/simulator");
const scheduler = require("./services/scheduler");
const { requireAuth } = require("./services/auth");

const authRoutes = require("./routes/auth");
const coachRoutes = require("./routes/coaches");
const alertRoutes = require("./routes/alerts");
const rakeRoutes = require("./routes/rakes");
const adminRoutes = require("./routes/admin");
const healthRoutes = require("./routes/health");
const predictionRoutes = require("./routes/predictions");
const analyticsRoutes = require("./routes/analytics");
const reportRoutes = require("./routes/reports");
const settingsRoutes = require("./routes/settings");
const ingestRoutes = require("./routes/ingest");

const app = express();
const PORT = process.env.PORT || 4000;
const DEMO_MODE = (process.env.DEMO_MODE || "false") === "true";

// ALLOWED_ORIGINS: comma-separated list, e.g. "https://obcms.himnish.example,https://admin.himnish.example"
// Left unset => reflects request origin (fine for a first deploy), but should be locked
// down once the real frontend domain is known.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

// Security headers. CSP is disabled because the frontend is plain inline-script HTML/JS
// served from the same origin (not a templated app with nonce support) — enabling a
// default CSP would break it outright. The other helmet protections (X-Frame-Options,
// X-Content-Type-Options, HSTS, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false }));

app.set("trust proxy", 1); // needed for correct client IPs behind Railway's proxy (rate limiting, logging)

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Brute-force protection on login: 10 attempts per 15 minutes per IP, on top of the
// per-account lockout in routes/auth.js (services/auth.js validatePassword + the
// failed_login_attempts logic in routes/auth.js).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});
app.use("/api/auth/login", loginLimiter);

// Ingestion is authenticated by per-device apiKey, not JWT — rate-limit it separately
// so a leaked/guessed device key (or a misbehaving RUT) can't flood the server.
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // generous for legitimate RUT push intervals (seconds-scale), blocks abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many ingestion requests. Please slow down." },
});

// Public routes
app.use("/api/auth", authRoutes);
app.get("/api/health-check", (req, res) => res.json({
  status: "ok",
  demoMode: DEMO_MODE,
  time: new Date().toISOString(),
  build: "2026-07-27-rut-devices-i18n-v1", // bump this string whenever you deploy, to verify Railway is serving the build you just pushed
}));

// RUT push ingestion — authenticated by per-device apiKey inside the body (see routes/ingest.js),
// not by user JWT, since the caller is a router's Lua script, not a logged-in dashboard user.
app.use("/api/ingest", ingestLimiter, ingestRoutes);

// Protected API routes (all require a valid JWT; individual admin/rake writes are further role-gated)
app.use("/api/coaches", requireAuth, coachRoutes);
app.use("/api/alerts", requireAuth, alertRoutes);
app.use("/api/rakes", requireAuth, rakeRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/health", requireAuth, healthRoutes);
app.use("/api/predictions", requireAuth, predictionRoutes);
app.use("/api/analytics", requireAuth, analyticsRoutes);
app.use("/api/reports", requireAuth, reportRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);

// Fallback to dashboard index (SPA-style)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

init().then(() => {
  // Simulator only runs its tick when Settings > Data Source = Simulated Data. In Live
  // Hardware mode, data instead arrives via RUT devices POSTing to /api/ingest/push —
  // there is no server-side polling loop, since the RUT itself pushes on its own schedule.
  simulator.start();
  console.log(`Data engine ready (env default: ${DEMO_MODE ? "demo" : "live"}). Actual mode is controlled from Settings > Data Source and can be switched at runtime.`);
  scheduler.start();
  console.log("Daily report scheduler active — checks every minute against Admin > Notifications > Daily Report Time.");
  app.listen(PORT, () => {
    console.log(`Himnish OBCMS & PICCU Dashboard running on http://localhost:${PORT}`);
  });
});
