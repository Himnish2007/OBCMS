// Shared vibration/temperature threshold-banding helpers, used by the live ingestion
// pipeline (services/ingestion.js) to classify each reading as GREEN/YELLOW/ORANGE/RED.
const BAND_ORDER = ["GREEN", "YELLOW", "ORANGE", "RED"];

function bandFor(value, t) {
  if (value < t.yellow) return "GREEN";
  if (value < t.orange) return "YELLOW";
  if (value < t.red) return "ORANGE";
  return "RED";
}

function worstBand(a, b) {
  return BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b;
}

module.exports = { bandFor, worstBand, BAND_ORDER };
