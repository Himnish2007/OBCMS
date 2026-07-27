require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

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
const DEMO_MODE = (process.env.DEMO_MODE || "true") === "true";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Public routes
app.use("/api/auth", authRoutes);
app.get("/api/health-check", (req, res) => res.json({ status: "ok", demoMode: DEMO_MODE, time: new Date().toISOString() }));

// RUT push ingestion — authenticated by per-device apiKey inside the body (see routes/ingest.js),
// not by user JWT, since the caller is a router's Lua script, not a logged-in dashboard user.
app.use("/api/ingest", ingestRoutes);

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
