const API = "/api";
let TOKEN = localStorage.getItem("himnish_token") || null;
let USER = JSON.parse(localStorage.getItem("himnish_user") || "null");
let COACHES = [];
let RAKES = [];
let selectedObcmsCoach = null;
let selectedPiccuCoach = null;
let selectedAxleId = null;
let obcmsChart = null;
let analyticsCharts = {};
let refreshTimer = null;
let alertsFilter = "open";

// ---------------- Helpers ----------------
function bandColor(band) {
  return { GREEN: "#2e7d32", YELLOW: "#d9a400", ORANGE: "#eb5b12", RED: "#c0392b" }[band] || "#5b6b7f";
}

function showToast(message, type = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast " + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

function openModal(html) {
  document.getElementById("modal-box").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-box").innerHTML = "";
}
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});
window.closeModal = closeModal;

// ---------------- Auth ----------------
async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired, please sign in again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(API + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    TOKEN = data.token;
    USER = data.user;
    localStorage.setItem("himnish_token", TOKEN);
    localStorage.setItem("himnish_user", JSON.stringify(USER));
    boot();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("logout-btn").addEventListener("click", logout);

function logout() {
  TOKEN = null;
  USER = null;
  localStorage.removeItem("himnish_token");
  localStorage.removeItem("himnish_user");
  clearInterval(refreshTimer);
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.body.className = "";
}

// ---------------- Navigation ----------------
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-" + view).classList.remove("hidden");
    document.getElementById("view-title").textContent = btn.textContent;
    loadView(view);
  });
});

function loadView(view) {
  if (view === "overview") loadOverview();
  if (view === "obcms") loadObcms();
  if (view === "piccu") loadPiccu();
  if (view === "health") loadHealth();
  if (view === "prediction") loadPrediction();
  if (view === "analytics") loadAnalytics();
  if (view === "alerts") loadAlerts();
  if (view === "reports") loadReports();
  if (view === "rakes") loadRakes();
  if (view === "admin") loadAdmin();
}

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    alertsFilter = tab.dataset.filter;
    loadAlerts();
  });
});

document.querySelectorAll(".sub-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sub-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".sub-view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("admin-" + tab.dataset.subtab).classList.remove("hidden");
  });
});

// ---------------- Boot ----------------
async function boot() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("user-name").textContent = `${USER.name} (${USER.role})`;
  document.body.className = "role-" + USER.role;

  try {
    COACHES = await apiFetch("/coaches");
    RAKES = await apiFetch("/rakes");
    populateCoachSelectors();
    await loadOverview();
    refreshTimer = setInterval(refreshCurrentView, 8000);
  } catch (err) {
    console.error(err);
  }
}

function refreshCurrentView() {
  const activeBtn = document.querySelector(".nav-item.active");
  const view = activeBtn ? activeBtn.dataset.view : "overview";
  loadView(view);
}

function populateCoachSelectors() {
  const obcmsSel = document.getElementById("obcms-coach-select");
  const piccuSel = document.getElementById("piccu-coach-select");
  const reportsSel = document.getElementById("reports-coach-select");
  const optionHtml = COACHES.map((c) => `<option value="${c.id}">${c.coach_number} — ${c.coach_type} (${c.rake_name})</option>`).join("");
  obcmsSel.innerHTML = optionHtml;
  piccuSel.innerHTML = optionHtml;
  reportsSel.innerHTML = `<option value="">All Coaches</option>` + optionHtml;

  selectedObcmsCoach = COACHES[0] ? COACHES[0].id : null;
  selectedPiccuCoach = COACHES[0] ? COACHES[0].id : null;
  obcmsSel.onchange = (e) => { selectedObcmsCoach = Number(e.target.value); selectedAxleId = null; loadObcms(); };
  piccuSel.onchange = (e) => { selectedPiccuCoach = Number(e.target.value); loadPiccu(); };
}

// ================= FLEET OVERVIEW =================
async function loadOverview() {
  try {
    const summary = await apiFetch("/coaches/summary");
    document.getElementById("kpi-coaches").textContent = summary.total_coaches;
    document.getElementById("kpi-rakes").textContent = summary.total_rakes;
    document.getElementById("kpi-alerts").textContent = summary.open_alerts;
    document.getElementById("kpi-piccu").textContent = summary.piccu_faults;
    document.getElementById("band-green").textContent = summary.band_counts.GREEN;
    document.getElementById("band-yellow").textContent = summary.band_counts.YELLOW;
    document.getElementById("band-orange").textContent = summary.band_counts.ORANGE;
    document.getElementById("band-red").textContent = summary.band_counts.RED;

    COACHES = await apiFetch("/coaches");
    const tbody = document.getElementById("fleet-table-body");
    tbody.innerHTML = COACHES.map((c) => `
      <tr>
        <td><b>${c.coach_number}</b></td>
        <td>${c.coach_type}</td>
        <td>${c.rake_name} <span class="rake-type-tag ${c.rake_type.replace(/\s/g, "")}">${c.rake_type}</span></td>
        <td><span class="band-pill ${c.overall_band}">${c.overall_band}</span></td>
        <td>${c.open_alerts}</td>
        <td>${c.piccu_faults}</td>
        <td><button class="btn-small" onclick="jumpToCoach(${c.id})">View OBCMS</button></td>
      </tr>
    `).join("");
  } catch (err) { console.error(err); }
}

function jumpToCoach(coachId) {
  selectedObcmsCoach = coachId;
  document.querySelector('[data-view="obcms"]').click();
  document.getElementById("obcms-coach-select").value = coachId;
}
window.jumpToCoach = jumpToCoach;

// ================= OBCMS (8-axle) =================
async function loadObcms() {
  if (!selectedObcmsCoach) return;
  document.getElementById("obcms-coach-select").value = selectedObcmsCoach;
  try {
    const axles = await apiFetch(`/coaches/${selectedObcmsCoach}/axles`);
    if (!selectedAxleId && axles.length) selectedAxleId = axles[0].id;

    const grid = document.getElementById("obcms-sensor-grid");
    grid.innerHTML = axles.map((a) => {
      const band = a.latest ? a.latest.band : "GREEN";
      const vib = a.latest ? a.latest.vibration_g : "-";
      const temp = a.latest ? a.latest.temperature_c : "-";
      return `
        <div class="sensor-card ${a.id === selectedAxleId ? "selected" : ""}" onclick="selectAxle(${a.id})">
          <div class="sensor-card-top">
            <div>
              <div class="sensor-loc">Axle-${a.axle_number}</div>
              <div class="sensor-type">Bearing / Vibration + Temp</div>
            </div>
            <span class="band-pill ${band}">${band}</span>
          </div>
          <div class="sensor-metrics">
            <div>Vib: <b>${vib}g</b></div>
            <div>Temp: <b>${temp}°C</b></div>
          </div>
        </div>
      `;
    }).join("");

    const selected = axles.find((a) => a.id === selectedAxleId) || axles[0];
    if (selected) renderObcmsChart(selected);

    const alerts = await apiFetch(`/coaches/${selectedObcmsCoach}/alerts`);
    const tbody = document.getElementById("obcms-alerts-body");
    tbody.innerHTML = alerts.slice(0, 15).map((a) => `
      <tr>
        <td>${new Date(a.created_at).toLocaleTimeString()}</td>
        <td>Axle-${a.axle_number ?? "-"}</td>
        <td>${a.severity}</td>
        <td>${a.message}</td>
        <td>${a.acknowledged ? '<span class="status-pill Online">Acknowledged</span>' : '<span class="status-pill Fault">Open</span>'}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="color:#5b6b7f;">No alerts for this coach.</td></tr>`;
  } catch (err) { console.error(err); }
}

function selectAxle(axleId) {
  selectedAxleId = axleId;
  loadObcms();
}
window.selectAxle = selectAxle;

function renderObcmsChart(axle) {
  const ctx = document.getElementById("obcms-chart").getContext("2d");
  const labels = axle.history.map((r) => new Date(r.ts).toLocaleTimeString());
  const vibData = axle.history.map((r) => r.vibration_g);
  const tempData = axle.history.map((r) => r.temperature_c);
  if (obcmsChart) obcmsChart.destroy();
  obcmsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: `Vibration (g) — Axle-${axle.axle_number}`, data: vibData, borderColor: "#eb5b12", backgroundColor: "rgba(235,91,18,0.08)", tension: 0.3, fill: true, pointRadius: 2, yAxisID: "y" },
        { label: `Temperature (°C) — Axle-${axle.axle_number}`, data: tempData, borderColor: "#0b3d78", backgroundColor: "rgba(11,61,120,0.06)", tension: 0.3, fill: true, pointRadius: 2, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: "g" } },
        y1: { beginAtZero: true, position: "right", title: { display: true, text: "°C" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

// ================= PICCU =================
async function loadPiccu() {
  if (!selectedPiccuCoach) return;
  document.getElementById("piccu-coach-select").value = selectedPiccuCoach;
  try {
    const { systems, telemetry } = await apiFetch(`/coaches/${selectedPiccuCoach}/piccu`);
    const grid = document.getElementById("piccu-systems-grid");
    grid.innerHTML = systems.map((s) => `
      <div class="piccu-item">
        <span class="piccu-item-name">${s.system_name}</span>
        <span class="status-pill ${s.status}">${s.status}</span>
      </div>
    `).join("");

    const tGrid = document.getElementById("piccu-telemetry-grid");
    tGrid.innerHTML = telemetry.map((t) => `
      <div class="telemetry-card">
        <div class="telemetry-label">${t.param.replace(/_/g, " ")}</div>
        <div class="telemetry-value">${t.value} <span style="font-size:0.9rem;color:#5b6b7f;">${t.unit}</span></div>
      </div>
    `).join("");
  } catch (err) { console.error(err); }
}

// ================= HEALTH =================
async function loadHealth() {
  try {
    const fleet = await apiFetch("/health/fleet");
    const tbody = document.getElementById("health-table-body");
    tbody.innerHTML = fleet.map((c) => `
      <tr>
        <td><b>${c.coach_number}</b><br/><span class="muted">${c.coach_type}</span></td>
        <td>${c.rake_name}</td>
        <td><span class="health-score-pill" style="background:${c.health_score >= 85 ? "#2e7d32" : c.health_score >= 60 ? "#d9a400" : c.health_score >= 35 ? "#eb5b12" : "#c0392b"}">${c.health_score}</span></td>
        <td><div class="axle-heatmap">${c.axles.map((a) => `<div class="axle-cell ${a.band}" title="Axle-${a.axle_number}: ${a.band}">${a.axle_number}</div>`).join("")}</div></td>
      </tr>
    `).join("");

    const worst = await apiFetch("/health/worst-axles?limit=10");
    const wbody = document.getElementById("worst-axles-body");
    wbody.innerHTML = worst.map((r) => `
      <tr>
        <td>${r.coach_number}</td>
        <td>Axle-${r.axle_number}</td>
        <td><span class="band-pill ${r.band}">${r.band}</span></td>
        <td>${r.vibration_g}</td>
        <td>${r.temperature_c}</td>
        <td>${new Date(r.ts).toLocaleTimeString()}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" style="color:#5b6b7f;">No data yet.</td></tr>`;
  } catch (err) { console.error(err); }
}

// ================= PREDICTION =================
async function loadPrediction() {
  try {
    const { note, predictions } = await apiFetch("/predictions");
    document.getElementById("prediction-note").textContent = note;
    const tbody = document.getElementById("prediction-table-body");
    tbody.innerHTML = predictions.slice(0, 40).map((p) => `
      <tr>
        <td>${p.coach_number}</td>
        <td>Axle-${p.axle_number}</td>
        <td><span class="band-pill ${p.current_band}">${p.current_band}</span></td>
        <td>${p.vibration_trend}</td>
        <td>${p.temperature_trend}</td>
        <td>${p.driver_parameter || "-"}</td>
        <td>${p.estimated_minutes_to_breach != null ? p.estimated_minutes_to_breach + " min (to " + p.predicted_next_threshold + (p.driver_parameter === "vibration" ? "g" : "°C") + ")" : "Stable"}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">Not enough history yet — check back shortly.</td></tr>`;
  } catch (err) { console.error(err); }
}

// ================= ANALYTICS =================
async function loadAnalytics() {
  try {
    const data = await apiFetch("/analytics/overview");

    const bandCtx = document.getElementById("chart-band-dist").getContext("2d");
    if (analyticsCharts.band) analyticsCharts.band.destroy();
    analyticsCharts.band = new Chart(bandCtx, {
      type: "doughnut",
      data: {
        labels: Object.keys(data.band_counts),
        datasets: [{ data: Object.values(data.band_counts), backgroundColor: Object.keys(data.band_counts).map(bandColor) }],
      },
      options: { responsive: true },
    });

    const rakeCtx = document.getElementById("chart-rake-comparison").getContext("2d");
    if (analyticsCharts.rake) analyticsCharts.rake.destroy();
    analyticsCharts.rake = new Chart(rakeCtx, {
      type: "bar",
      data: {
        labels: data.rake_type_comparison.map((r) => r.rake_type),
        datasets: [
          { label: "Avg Vibration (g)", data: data.rake_type_comparison.map((r) => r.avg_vibration_g), backgroundColor: "#eb5b12" },
          { label: "Avg Temperature (°C)", data: data.rake_type_comparison.map((r) => r.avg_temperature_c), backgroundColor: "#0b3d78" },
        ],
      },
      options: { responsive: true },
    });

    const alertCtx = document.getElementById("chart-top-alerts").getContext("2d");
    if (analyticsCharts.topAlerts) analyticsCharts.topAlerts.destroy();
    analyticsCharts.topAlerts = new Chart(alertCtx, {
      type: "bar",
      data: {
        labels: data.top_alert_coaches.map((c) => c.coach_number),
        datasets: [{ label: "Alerts", data: data.top_alert_coaches.map((c) => c.alert_count), backgroundColor: "#c0392b" }],
      },
      options: { responsive: true, indexAxis: "y" },
    });

    const trendCtx = document.getElementById("chart-alert-trend").getContext("2d");
    if (analyticsCharts.trend) analyticsCharts.trend.destroy();
    analyticsCharts.trend = new Chart(trendCtx, {
      type: "line",
      data: {
        labels: data.alert_trend.map((t) => new Date(t.minute).toLocaleTimeString()),
        datasets: [{ label: "Alerts per minute", data: data.alert_trend.map((t) => t.count), borderColor: "#2e7d32", backgroundColor: "rgba(46,125,50,0.1)", fill: true, tension: 0.3 }],
      },
      options: { responsive: true },
    });
  } catch (err) { console.error(err); }
}

// ================= ALERTS =================
async function loadAlerts() {
  try {
    const alerts = await apiFetch(`/alerts?status=${alertsFilter}`);
    const tbody = document.getElementById("alerts-table-body");
    tbody.innerHTML = alerts.map((a) => `
      <tr>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td>${a.coach_number}</td>
        <td>${a.axle_label}</td>
        <td>${a.severity}</td>
        <td>${a.message}</td>
        <td>${a.acknowledged ? '<span class="status-pill Online">Acknowledged</span>' : '<span class="status-pill Fault">Open</span>'}</td>
        <td>${a.acknowledged ? "" : `<button class="btn-small" onclick="ackAlert(${a.id})">Acknowledge</button>`}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">No alerts to show.</td></tr>`;
  } catch (err) { console.error(err); }
}

async function ackAlert(id) {
  try {
    await apiFetch(`/alerts/${id}/ack`, { method: "POST" });
    loadAlerts();
    loadOverview();
  } catch (err) { console.error(err); }
}
window.ackAlert = ackAlert;

// ================= REPORTS =================
async function loadReports() {
  try {
    const s = await apiFetch("/reports/summary");
    document.getElementById("reports-summary-grid").innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Coaches</div><div class="kpi-value">${s.total_coaches}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Rakes</div><div class="kpi-value">${s.total_rakes}</div></div>
      <div class="kpi-card alert"><div class="kpi-label">Open Alerts</div><div class="kpi-value">${s.open_alerts}</div></div>
      <div class="kpi-card"><div class="kpi-label">Acknowledged Alerts</div><div class="kpi-value">${s.acknowledged_alerts}</div></div>
    `;
  } catch (err) { console.error(err); }
}

async function downloadCsv(path, filename) {
  try {
    const res = await fetch(API + path, { headers: { Authorization: "Bearer " + TOKEN } });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { showToast(err.message, "error"); }
}

document.getElementById("download-readings-csv").addEventListener("click", () => {
  const coachId = document.getElementById("reports-coach-select").value;
  downloadCsv(`/reports/readings.csv${coachId ? "?coach_id=" + coachId : ""}`, "obcms_readings.csv");
});
document.getElementById("download-alerts-csv").addEventListener("click", () => {
  const coachId = document.getElementById("reports-coach-select").value;
  downloadCsv(`/reports/alerts.csv${coachId ? "?coach_id=" + coachId : ""}`, "obcms_alerts.csv");
});
document.getElementById("print-summary").addEventListener("click", () => window.print());

// ================= RAKE MANAGEMENT =================
async function loadRakes() {
  try {
    RAKES = await apiFetch("/rakes");
    const container = document.getElementById("rakes-container");
    container.innerHTML = RAKES.map((r) => `
      <div class="rake-card">
        <div class="rake-card-top">
          <div>
            <span class="rake-title">${r.rake_name}</span>
            <span class="rake-type-tag ${r.rake_type.replace(/\s/g, "")}">${r.rake_type}</span>
          </div>
          <div class="rake-meta">${r.depot} · ${r.zone} · ${r.coach_count} coach(es)</div>
        </div>
        <div class="rake-coach-list">
          ${r.coaches.map((c) => `
            <div class="rake-coach-chip">
              <span class="coach-no">${c.coach_number}</span>
              <span class="muted">${c.coach_type}</span>
              <span class="band-pill ${c.overall_band}" style="width:fit-content;">${c.overall_band}</span>
            </div>
          `).join("") || '<span class="muted">No coaches assigned</span>'}
        </div>
      </div>
    `).join("");

    const log = await apiFetch("/rakes/swap-log");
    document.getElementById("swap-log-body").innerHTML = log.map((l) => `
      <tr>
        <td>${new Date(l.swapped_at).toLocaleString()}</td>
        <td>${l.coach_number}</td>
        <td>${l.from_rake_name}</td>
        <td>${l.to_rake_name}</td>
        <td>${l.reason}</td>
        <td>${l.swapped_by}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" style="color:#5b6b7f;">No swaps recorded yet.</td></tr>`;
  } catch (err) { console.error(err); }
}

document.getElementById("add-rake-btn").addEventListener("click", () => {
  openModal(`
    <h3>Add Rake</h3>
    <form id="rake-form">
      <label>Rake Name</label><input type="text" id="rake-name" required placeholder="e.g. RAKE-15D" />
      <label>Rake Type</label>
      <select id="rake-type"><option value="LHB">LHB</option><option value="Vande Bharat">Vande Bharat</option></select>
      <label>Zone</label><input type="text" id="rake-zone" placeholder="e.g. NR" />
      <label>Depot</label><input type="text" id="rake-depot" placeholder="e.g. Ghaziabad" />
      <p class="modal-error" id="rake-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create Rake</button>
      </div>
    </form>
  `);
  document.getElementById("rake-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/rakes", {
        method: "POST",
        body: JSON.stringify({
          rake_name: document.getElementById("rake-name").value.trim(),
          rake_type: document.getElementById("rake-type").value,
          zone: document.getElementById("rake-zone").value.trim(),
          depot: document.getElementById("rake-depot").value.trim(),
        }),
      });
      closeModal();
      showToast("Rake created", "success");
      loadRakes();
    } catch (err) { document.getElementById("rake-form-error").textContent = err.message; }
  });
});

document.getElementById("swap-coach-btn").addEventListener("click", () => {
  const coachOptions = COACHES.map((c) => `<option value="${c.id}">${c.coach_number} (currently ${c.rake_name})</option>`).join("");
  const rakeOptions = RAKES.map((r) => `<option value="${r.id}">${r.rake_name} (${r.rake_type})</option>`).join("");
  openModal(`
    <h3>Swap Coach Between Rakes</h3>
    <form id="swap-form">
      <label>Coach</label><select id="swap-coach">${coachOptions}</select>
      <label>Move to Rake</label><select id="swap-rake">${rakeOptions}</select>
      <label>Reason (optional)</label><input type="text" id="swap-reason" placeholder="e.g. Maintenance reshuffle" />
      <p class="modal-error" id="swap-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Swap Coach</button>
      </div>
    </form>
  `);
  document.getElementById("swap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/rakes/swap-coach", {
        method: "POST",
        body: JSON.stringify({
          coach_id: Number(document.getElementById("swap-coach").value),
          to_rake_id: Number(document.getElementById("swap-rake").value),
          reason: document.getElementById("swap-reason").value.trim(),
        }),
      });
      closeModal();
      showToast("Coach swapped successfully", "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadRakes();
    } catch (err) { document.getElementById("swap-form-error").textContent = err.message; }
  });
});

// ================= ADMIN =================
async function loadAdmin() {
  if (USER.role !== "Admin") {
    document.getElementById("view-admin").innerHTML = `<div class="card"><p>You do not have permission to view this page.</p></div>`;
    return;
  }
  await loadAdminUsers();
  await loadAdminCoaches();
  await loadAdminThresholds();
  await loadAdminLogSettings();
}

async function loadAdminUsers() {
  const users = await apiFetch("/admin/users");
  document.getElementById("users-table-body").innerHTML = users.map((u) => `
    <tr>
      <td>${u.username}</td>
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td>
        <button class="btn-small" onclick="editUser(${u.id})">Edit</button>
        <button class="btn-danger" onclick="deleteUser(${u.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("add-user-btn").addEventListener("click", () => {
  openModal(`
    <h3>Add User</h3>
    <form id="user-form">
      <label>Username</label><input type="text" id="u-username" required />
      <label>Full Name</label><input type="text" id="u-name" required />
      <label>Password</label><input type="password" id="u-password" required minlength="6" />
      <label>Role</label>
      <select id="u-role"><option value="Viewer">Viewer</option><option value="Supervisor">Supervisor</option><option value="Admin">Admin</option></select>
      <p class="modal-error" id="user-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create User</button>
      </div>
    </form>
  `);
  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("u-username").value.trim(),
          name: document.getElementById("u-name").value.trim(),
          password: document.getElementById("u-password").value,
          role: document.getElementById("u-role").value,
        }),
      });
      closeModal();
      showToast("User created", "success");
      loadAdminUsers();
    } catch (err) { document.getElementById("user-form-error").textContent = err.message; }
  });
});

async function editUser(id) {
  const users = await apiFetch("/admin/users");
  const u = users.find((x) => x.id === id);
  if (!u) return;
  openModal(`
    <h3>Edit User — ${u.username}</h3>
    <form id="user-edit-form">
      <label>Full Name</label><input type="text" id="ue-name" value="${u.name}" required />
      <label>Role</label>
      <select id="ue-role">
        <option value="Viewer" ${u.role === "Viewer" ? "selected" : ""}>Viewer</option>
        <option value="Supervisor" ${u.role === "Supervisor" ? "selected" : ""}>Supervisor</option>
        <option value="Admin" ${u.role === "Admin" ? "selected" : ""}>Admin</option>
      </select>
      <label>New Password (leave blank to keep unchanged)</label><input type="password" id="ue-password" minlength="6" />
      <p class="modal-error" id="user-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save Changes</button>
      </div>
    </form>
  `);
  document.getElementById("user-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = { name: document.getElementById("ue-name").value.trim(), role: document.getElementById("ue-role").value };
      const pw = document.getElementById("ue-password").value;
      if (pw) payload.password = pw;
      await apiFetch(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      closeModal();
      showToast("User updated", "success");
      loadAdminUsers();
    } catch (err) { document.getElementById("user-edit-error").textContent = err.message; }
  });
}
window.editUser = editUser;

async function deleteUser(id) {
  if (!confirm("Delete this user? This cannot be undone.")) return;
  try {
    await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
    showToast("User deleted", "success");
    loadAdminUsers();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteUser = deleteUser;

async function loadAdminCoaches() {
  const coaches = await apiFetch("/coaches");
  document.getElementById("admin-coaches-table-body").innerHTML = coaches.map((c) => `
    <tr>
      <td>${c.coach_number}</td>
      <td>${c.rake_name}</td>
      <td>${c.coach_type}</td>
      <td>${c.status}</td>
      <td>
        <button class="btn-small" onclick="editCoach(${c.id})">Edit</button>
        <button class="btn-danger" onclick="deleteCoach(${c.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("add-coach-btn").addEventListener("click", async () => {
  const rakes = await apiFetch("/rakes");
  const rakeOptions = rakes.map((r) => `<option value="${r.id}">${r.rake_name} (${r.rake_type})</option>`).join("");
  openModal(`
    <h3>Add Coach</h3>
    <form id="coach-form">
      <label>Coach Number</label><input type="text" id="c-number" required placeholder="e.g. LHB-50231" />
      <label>Rake</label><select id="c-rake">${rakeOptions}</select>
      <label>Coach Type</label><input type="text" id="c-type" required placeholder="e.g. AC 3-Tier" />
      <p class="modal-error" id="coach-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create Coach (auto-creates 8 axles)</button>
      </div>
    </form>
  `);
  document.getElementById("coach-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/coaches", {
        method: "POST",
        body: JSON.stringify({
          coach_number: document.getElementById("c-number").value.trim(),
          rake_id: Number(document.getElementById("c-rake").value),
          coach_type: document.getElementById("c-type").value.trim(),
        }),
      });
      closeModal();
      showToast("Coach created with 8 axles", "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadAdminCoaches();
    } catch (err) { document.getElementById("coach-form-error").textContent = err.message; }
  });
});

async function editCoach(id) {
  const coaches = await apiFetch("/coaches");
  const c = coaches.find((x) => x.id === id);
  if (!c) return;
  openModal(`
    <h3>Edit Coach — ${c.coach_number}</h3>
    <form id="coach-edit-form">
      <label>Coach Type</label><input type="text" id="ce-type" value="${c.coach_type}" required />
      <label>Status</label>
      <select id="ce-status">
        <option value="Active" ${c.status === "Active" ? "selected" : ""}>Active</option>
        <option value="Maintenance" ${c.status === "Maintenance" ? "selected" : ""}>Maintenance</option>
        <option value="Withdrawn" ${c.status === "Withdrawn" ? "selected" : ""}>Withdrawn</option>
      </select>
      <p class="modal-error" id="coach-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save Changes</button>
      </div>
    </form>
  `);
  document.getElementById("coach-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/admin/coaches/${id}`, {
        method: "PUT",
        body: JSON.stringify({ coach_type: document.getElementById("ce-type").value.trim(), status: document.getElementById("ce-status").value }),
      });
      closeModal();
      showToast("Coach updated", "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadAdminCoaches();
    } catch (err) { document.getElementById("coach-edit-error").textContent = err.message; }
  });
}
window.editCoach = editCoach;

async function deleteCoach(id) {
  if (!confirm("Delete this coach and all its axle/PICCU data? This cannot be undone.")) return;
  try {
    await apiFetch(`/admin/coaches/${id}`, { method: "DELETE" });
    showToast("Coach deleted", "success");
    COACHES = await apiFetch("/coaches");
    populateCoachSelectors();
    loadAdminCoaches();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteCoach = deleteCoach;

async function loadAdminThresholds() {
  const t = await apiFetch("/admin/thresholds");
  document.getElementById("th-vib-yellow").value = t.vibration.yellow;
  document.getElementById("th-vib-orange").value = t.vibration.orange;
  document.getElementById("th-vib-red").value = t.vibration.red;
  document.getElementById("th-temp-yellow").value = t.temperature.yellow;
  document.getElementById("th-temp-orange").value = t.temperature.orange;
  document.getElementById("th-temp-red").value = t.temperature.red;
}

document.getElementById("thresholds-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/thresholds", {
      method: "PUT",
      body: JSON.stringify({
        vibration: {
          yellow: Number(document.getElementById("th-vib-yellow").value),
          orange: Number(document.getElementById("th-vib-orange").value),
          red: Number(document.getElementById("th-vib-red").value),
        },
        temperature: {
          yellow: Number(document.getElementById("th-temp-yellow").value),
          orange: Number(document.getElementById("th-temp-orange").value),
          red: Number(document.getElementById("th-temp-red").value),
        },
      }),
    });
    showToast("Alert thresholds updated", "success");
  } catch (err) { showToast(err.message, "error"); }
});

async function loadAdminLogSettings() {
  const s = await apiFetch("/admin/settings");
  document.getElementById("log-interval-input").value = s.log_interval_seconds;
}

document.getElementById("logsettings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ log_interval_seconds: Number(document.getElementById("log-interval-input").value) }),
    });
    showToast("Log interval updated", "success");
  } catch (err) { showToast(err.message, "error"); }
});

// ---------------- Init ----------------
if (TOKEN && USER) {
  boot();
}
