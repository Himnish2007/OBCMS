const express = require("express");
const { processPush, IngestionError } = require("../services/ingestion");

const router = express.Router();

// Called by the Lua push script running on each RUT — not by the browser dashboard,
// so this route is mounted OUTSIDE the requireAuth (JWT) middleware in server.js and
// instead trusts the per-device apiKey inside the JSON body. See services/ingestion.js
// for the full payload contract.
router.post("/push", async (req, res) => {
  try {
    const result = await processPush(req.body || {});
    res.json(result);
  } catch (err) {
    if (err instanceof IngestionError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Ingest push error:", err);
    res.status(500).json({ error: "Internal error while processing push" });
  }
});

module.exports = router;
