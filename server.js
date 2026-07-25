require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { init } = require("./db/db");
const simulator = require("./services/simulator");
const { requireAuth } = require("./services/auth");

const authRoutes = require("./routes/auth");
const coachRoutes = require("./routes/coaches");
const alertRoutes = require("./routes/alerts");

const app = express();
const PORT = process.env.PORT || 4000;
const DEMO_MODE = (process.env.DEMO_MODE || "true") === "true";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Public routes
app.use("/api/auth", authRoutes);
app.get("/api/health", (req, res) => res.json({ status: "ok", demoMode: DEMO_MODE, time: new Date().toISOString() }));

// Protected API routes
app.use("/api/coaches", requireAuth, coachRoutes);
app.use("/api/alerts", requireAuth, alertRoutes);

// Fallback to dashboard index (SPA-style)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

init().then(() => {
  if (DEMO_MODE) {
    simulator.start(8000);
    console.log("DEMO_MODE active — simulated OBCMS/PICCU data generator running every 8s.");
  } else {
    console.log("DEMO_MODE disabled — connect a real Modbus/MQTT ingestion service in services/ingestion.js");
  }
  app.listen(PORT, () => {
    console.log(`Himnish OBCMS & PICCU Dashboard running on http://localhost:${PORT}`);
  });
});
