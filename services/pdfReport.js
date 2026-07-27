const PDFDocument = require("pdfkit");
const { db } = require("../db/db");

function latestReadingFor(axleId, fromTs, toTs) {
  let readings = db.data.readings.filter((r) => r.axle_id === axleId);
  if (fromTs || toTs) {
    readings = readings.filter((r) => {
      const t = new Date(r.ts);
      if (fromTs && t < fromTs) return false;
      if (toTs && t > toTs) return false;
      return true;
    });
  }
  return readings.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null;
}

// Builds a PDF report (as a Buffer) covering the given list of coach IDs.
// Used both for on-demand "Download PDF" on the Reports page and for the
// scheduled daily per-user email report.
// fromTs/toTs (optional Date objects) restrict readings & alerts to a time window
// so the report can be generated "kis time se kis time ka" for a given coach.
function buildCoachReportPdf({ title, coachIds, generatedFor, fromTs, toTs }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor("#0b3d78").fontSize(20).text("Himnish Limited", { continued: false });
    doc.fillColor("#eb5b12").fontSize(12).text("OBCMS & PICCU Condition Monitoring Report");
    doc.moveDown(0.3);
    doc.fillColor("#1c2530").fontSize(10)
      .text(`Report: ${title}`)
      .text(`Generated for: ${generatedFor}`)
      .text(`Generated at: ${new Date().toISOString()}`);
    if (fromTs || toTs) {
      doc.text(`Data period: ${fromTs ? fromTs.toLocaleString() : "Beginning"}  to  ${toTs ? toTs.toLocaleString() : "Now"}`);
    }
    doc.moveDown(0.8);

    const coaches = db.data.coaches.filter((c) => coachIds.includes(c.id));
    if (!coaches.length) {
      doc.fontSize(11).fillColor("#5b6b7f").text("No coaches are assigned to this account yet.");
      doc.end();
      return;
    }

    coaches.forEach((coach, idx) => {
      if (idx > 0) doc.moveDown(0.6);
      const rake = db.data.rakes.find((r) => r.id === coach.rake_id);
      doc.moveDown(0.4);
      doc.fillColor("#0b3d78").fontSize(13).text(`${coach.coach_number}  (${coach.coach_type})`);
      doc.fillColor("#5b6b7f").fontSize(9).text(`Rake: ${rake ? rake.rake_name : "Unassigned"}  |  Status: ${coach.status}`);
      doc.moveDown(0.3);

      const axles = db.data.axles.filter((a) => a.coach_id === coach.id).sort((a, b) => a.axle_number - b.axle_number);
      doc.fontSize(9).fillColor("#1c2530");
      const colX = [40, 100, 180, 270, 360, 440];
      doc.text("Axle", colX[0], doc.y, { continued: false });
      let headerY = doc.y - doc.currentLineHeight();
      doc.text("Vibration (g)", colX[1], headerY);
      doc.text("Temp (°C)", colX[2], headerY);
      doc.text("Band", colX[3], headerY);
      doc.text("Speed (kmph)", colX[4], headerY);
      doc.moveDown(0.2);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#d7e1ee").stroke();
      doc.moveDown(0.2);

      axles.forEach((a) => {
        const latest = latestReadingFor(a.id, fromTs, toTs);
        const rowY = doc.y;
        doc.fillColor("#1c2530").text(`Axle-${a.axle_number}`, colX[0], rowY);
        doc.text(latest ? String(latest.vibration_g) : "-", colX[1], rowY);
        doc.text(latest ? String(latest.temperature_c) : "-", colX[2], rowY);
        doc.fillColor(bandColor(latest ? latest.band : "NODATA")).text(latest ? latest.band : "No Data", colX[3], rowY);
        doc.fillColor("#1c2530").text(latest ? String(latest.speed_kmph) : "-", colX[4], rowY);
        doc.moveDown(0.15);
      });

      let alerts = db.data.alerts.filter((al) => al.coach_id === coach.id);
      if (fromTs || toTs) {
        alerts = alerts.filter((al) => {
          const t = new Date(al.created_at);
          if (fromTs && t < fromTs) return false;
          if (toTs && t > toTs) return false;
          return true;
        });
      }
      const openAlerts = alerts.filter((al) => !al.acknowledged);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#5b6b7f").text(`Total alerts: ${alerts.length}   |   Open: ${openAlerts.length}   |   Acknowledged: ${alerts.length - openAlerts.length}`);

      if (openAlerts.length) {
        doc.moveDown(0.2);
        doc.fillColor("#c0392b").fontSize(9);
        openAlerts.slice(0, 5).forEach((al) => {
          doc.text(`• [${al.severity}] ${al.message}`, { width: 515 });
        });
      }

      if (doc.y > 700 && idx < coaches.length - 1) doc.addPage();
    });

    doc.end();
  });
}

function bandColor(band) {
  return { NODATA: "#8a97a8", GREEN: "#2e7d32", YELLOW: "#b8860b", ORANGE: "#c0530f", RED: "#c0392b" }[band] || "#1c2530";
}

module.exports = { buildCoachReportPdf };
