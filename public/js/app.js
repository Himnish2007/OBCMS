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
  if (view === "settings") loadSettings();
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

  // Typing (datalist) support alongside the dropdowns
  const datalistHtml = COACHES.map((c) => `<option value="${c.coach_number}">`).join("");
  document.getElementById("obcms-coach-datalist").innerHTML = datalistHtml;
  document.getElementById("piccu-coach-datalist").innerHTML = datalistHtml;
  document.getElementById("reports-coach-datalist").innerHTML = datalistHtml;

  selectedObcmsCoach = COACHES[0] ? COACHES[0].id : null;
  selectedPiccuCoach = COACHES[0] ? COACHES[0].id : null;
  obcmsSel.onchange = (e) => {
    selectedObcmsCoach = Number(e.target.value);
    selectedAxleId = null;
    syncCoachSearchBox("obcms-coach-search", selectedObcmsCoach);
    loadObcms();
  };
  piccuSel.onchange = (e) => {
    selectedPiccuCoach = Number(e.target.value);
    syncCoachSearchBox("piccu-coach-search", selectedPiccuCoach);
    loadPiccu();
  };

  const obcmsSearch = document.getElementById("obcms-coach-search");
  syncCoachSearchBox("obcms-coach-search", selectedObcmsCoach);
  const piccuSearch = document.getElementById("piccu-coach-search");
  syncCoachSearchBox("piccu-coach-search", selectedPiccuCoach);
}

// Keep a text search box's value in sync with the currently selected coach id
function syncCoachSearchBox(searchInputId, coachId) {
  const el = document.getElementById(searchInputId);
  if (!el) return;
  const coach = COACHES.find((c) => c.id === coachId);
  el.value = coach ? coach.coach_number : "";
}

// Typing into a coach search box (with datalist) selects the matching coach
document.getElementById("obcms-coach-search").addEventListener("change", (e) => {
  const match = COACHES.find((c) => c.coach_number === e.target.value.trim());
  if (match) {
    document.getElementById("obcms-coach-select").value = match.id;
    selectedObcmsCoach = match.id;
    selectedAxleId = null;
    loadObcms();
  }
});
document.getElementById("piccu-coach-search").addEventListener("change", (e) => {
  const match = COACHES.find((c) => c.coach_number === e.target.value.trim());
  if (match) {
    document.getElementById("piccu-coach-select").value = match.id;
    selectedPiccuCoach = match.id;
    loadPiccu();
  }
});
document.getElementById("reports-coach-search").addEventListener("change", (e) => {
  const val = e.target.value.trim();
  const select = document.getElementById("reports-coach-select");
  if (!val) { select.value = ""; return; }
  const match = COACHES.find((c) => c.coach_number === val);
  if (match) select.value = match.id;
});

// ================= FLEET OVERVIEW =================
let overviewCoachQuery = "";

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
    renderOverviewCoachOptions();
    renderFleetTable();
  } catch (err) { console.error(err); }
}

function renderOverviewCoachOptions() {
  const datalist = document.getElementById("overview-coach-datalist");
  const select = document.getElementById("overview-coach-select");
  datalist.innerHTML = COACHES.map((c) => `<option value="${c.coach_number}">`).join("");
  const prevValue = select.value;
  select.innerHTML = `<option value="">All Coaches</option>` + COACHES.map((c) => `<option value="${c.coach_number}">${c.coach_number} — ${c.coach_type} (${c.rake_name})</option>`).join("");
  select.value = prevValue && COACHES.some((c) => c.coach_number === prevValue) ? prevValue : "";
}

function renderFleetTable() {
  const tbody = document.getElementById("fleet-table-body");
  const q = overviewCoachQuery.trim().toLowerCase();
  const filtered = q ? COACHES.filter((c) => c.coach_number.toLowerCase().includes(q)) : COACHES;
  tbody.innerHTML = filtered.map((c) => `
    <tr>
      <td><b>${c.coach_number}</b></td>
      <td>${c.coach_type}</td>
      <td>${c.rake_name} <span class="rake-type-tag ${c.rake_type.replace(/\s/g, "")}">${c.rake_type}</span></td>
      <td><span class="band-pill ${c.overall_band}">${c.overall_band}</span></td>
      <td>${c.open_alerts}</td>
      <td>${c.piccu_faults}</td>
      <td><button class="btn-small" onclick="jumpToCoach(${c.id})">View OBCMS</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">No coach matches "${overviewCoachQuery}".</td></tr>`;
}

document.getElementById("overview-coach-search").addEventListener("input", (e) => {
  overviewCoachQuery = e.target.value;
  document.getElementById("overview-coach-select").value = "";
  renderFleetTable();
});
document.getElementById("overview-coach-select").addEventListener("change", (e) => {
  overviewCoachQuery = e.target.value;
  document.getElementById("overview-coach-search").value = e.target.value;
  renderFleetTable();
});

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
let predictionCoachQuery = "";
let predictionDataCache = [];

async function loadPrediction() {
  try {
    const { note, predictions } = await apiFetch("/predictions");
    predictionDataCache = predictions;
    document.getElementById("prediction-note").textContent = note;
    renderPredictionCoachOptions();
    renderPredictionTable();
  } catch (err) { console.error(err); }
}

function renderPredictionCoachOptions() {
  const uniqueCoaches = [...new Map(predictionDataCache.map((p) => [p.coach_number, p])).values()];
  const datalist = document.getElementById("prediction-coach-datalist");
  datalist.innerHTML = uniqueCoaches.map((c) => `<option value="${c.coach_number}">`).join("");
  const select = document.getElementById("prediction-coach-select");
  const prevValue = select.value;
  select.innerHTML = `<option value="">All Coaches</option>` + uniqueCoaches.map((c) => `<option value="${c.coach_number}">${c.coach_number}</option>`).join("");
  select.value = prevValue && uniqueCoaches.some((c) => c.coach_number === prevValue) ? prevValue : "";
}

function renderPredictionTable() {
  const tbody = document.getElementById("prediction-table-body");
  const q = predictionCoachQuery.trim().toLowerCase();
  const filtered = q ? predictionDataCache.filter((p) => p.coach_number.toLowerCase().includes(q)) : predictionDataCache;
  tbody.innerHTML = filtered.slice(0, 40).map((p) => `
    <tr>
      <td>${p.coach_number}</td>
      <td>Axle-${p.axle_number}</td>
      <td><span class="band-pill ${p.current_band}">${p.current_band}</span></td>
      <td>${p.vibration_trend}</td>
      <td>${p.temperature_trend}</td>
      <td>${p.driver_parameter || "-"}</td>
      <td>${p.estimated_minutes_to_breach != null ? p.estimated_minutes_to_breach + " min (to " + p.predicted_next_threshold + (p.driver_parameter === "vibration" ? "g" : "°C") + ")" : "Stable"}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">${predictionCoachQuery ? `No coach matches "${predictionCoachQuery}".` : "Not enough history yet — check back shortly."}</td></tr>`;
}

document.getElementById("prediction-coach-search").addEventListener("input", (e) => {
  predictionCoachQuery = e.target.value;
  document.getElementById("prediction-coach-select").value = "";
  renderPredictionTable();
});
document.getElementById("prediction-coach-select").addEventListener("change", (e) => {
  predictionCoachQuery = e.target.value;
  document.getElementById("prediction-coach-search").value = e.target.value;
  renderPredictionTable();
});

// ================= ANALYTICS =================
let analyticsCoachesCache = [];

async function loadAnalytics() {
  try {
    const data = await apiFetch("/analytics/overview");
    analyticsCoachesCache = data.coaches || [];

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

    // Populate coach dropdown + datalist for search
    const select = document.getElementById("analytics-coach-select");
    select.innerHTML = analyticsCoachesCache.map((c) => `<option value="${c.id}">${c.coach_number} — ${c.coach_type}</option>`).join("");
    const datalist = document.getElementById("analytics-coach-datalist");
    datalist.innerHTML = analyticsCoachesCache.map((c) => `<option value="${c.coach_number}">`).join("");

    if (analyticsCoachesCache.length) {
      const firstId = select.value || analyticsCoachesCache[0].id;
      loadCoachAnalyticsDetail(firstId);
    } else {
      document.getElementById("analytics-coach-detail").innerHTML = `<p class="muted">No coaches assigned to this account yet.</p>`;
    }
  } catch (err) { console.error(err); }
}

document.getElementById("analytics-coach-select").addEventListener("change", (e) => {
  loadCoachAnalyticsDetail(e.target.value);
});
document.getElementById("analytics-coach-search").addEventListener("change", (e) => {
  const match = analyticsCoachesCache.find((c) => c.coach_number === e.target.value);
  if (match) {
    document.getElementById("analytics-coach-select").value = match.id;
    loadCoachAnalyticsDetail(match.id);
  }
});

async function loadCoachAnalyticsDetail(coachId) {
  try {
    const d = await apiFetch(`/analytics/coach/${coachId}`);
    const container = document.getElementById("analytics-coach-detail");

    container.innerHTML = `
      <div class="kpi-grid" style="margin:1rem 0;">
        <div class="kpi-card"><div class="kpi-label">Avg Vibration</div><div class="kpi-value">${d.avg_vibration_g}g</div></div>
        <div class="kpi-card"><div class="kpi-label">Avg Temperature</div><div class="kpi-value">${d.avg_temperature_c}°C</div></div>
        <div class="kpi-card alert"><div class="kpi-label">Open Alerts</div><div class="kpi-value">${d.open_alerts}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Alerts</div><div class="kpi-value">${d.total_alerts}</div></div>
      </div>
      <canvas id="coach-analytics-chart" height="90"></canvas>
    `;

    const ctx = document.getElementById("coach-analytics-chart").getContext("2d");
    if (analyticsCharts.coachDetail) analyticsCharts.coachDetail.destroy();
    const labels = d.axles.map((a) => `Axle-${a.axle_number}`);
    analyticsCharts.coachDetail = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Vibration (g)", data: d.axles.map((a) => (a.latest ? a.latest.vibration_g : 0)), backgroundColor: "#eb5b12", yAxisID: "y" },
          { label: "Temperature (°C)", data: d.axles.map((a) => (a.latest ? a.latest.temperature_c : 0)), backgroundColor: "#0b3d78", yAxisID: "y1" },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, position: "left", title: { display: true, text: "g" } },
          y1: { beginAtZero: true, position: "right", title: { display: true, text: "°C" }, grid: { drawOnChartArea: false } },
        },
      },
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

// Builds the shared query string (coach + from/to timestamp range) used by all report downloads
function buildReportsQuery() {
  const coachId = document.getElementById("reports-coach-select").value;
  const fromVal = document.getElementById("reports-from-datetime").value;
  const toVal = document.getElementById("reports-to-datetime").value;
  const params = [];
  if (coachId) params.push("coach_id=" + encodeURIComponent(coachId));
  if (fromVal) params.push("from=" + encodeURIComponent(new Date(fromVal).toISOString()));
  if (toVal) params.push("to=" + encodeURIComponent(new Date(toVal).toISOString()));
  return params.length ? "?" + params.join("&") : "";
}

document.getElementById("reports-clear-range-btn").addEventListener("click", () => {
  document.getElementById("reports-from-datetime").value = "";
  document.getElementById("reports-to-datetime").value = "";
});

document.getElementById("download-readings-csv").addEventListener("click", () => {
  downloadCsv(`/reports/readings.csv${buildReportsQuery()}`, "obcms_readings.csv");
});
document.getElementById("download-alerts-csv").addEventListener("click", () => {
  downloadCsv(`/reports/alerts.csv${buildReportsQuery()}`, "obcms_alerts.csv");
});
document.getElementById("download-report-pdf").addEventListener("click", () => {
  downloadCsv(`/reports/report.pdf${buildReportsQuery()}`, "obcms_report.pdf");
});
document.getElementById("print-summary").addEventListener("click", () => window.print());

document.getElementById("send-test-report-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("send-test-report-result");
  resultEl.textContent = "Sending...";
  resultEl.style.color = "";
  try {
    const res = await apiFetch("/reports/send-test-report", { method: "POST" });
    if (res.log.status === "sent") {
      resultEl.style.color = "var(--green)";
      resultEl.textContent = `Sent to your email successfully.`;
    } else if (res.log.status === "simulated") {
      resultEl.style.color = "var(--orange)";
      resultEl.textContent = `Not actually sent — ${res.log.detail} (configure SMTP in Admin > Notifications)`;
    } else {
      resultEl.style.color = "var(--red)";
      resultEl.textContent = `Failed: ${res.log.detail}`;
    }
  } catch (err) {
    resultEl.style.color = "var(--red)";
    resultEl.textContent = err.message;
  }
});

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
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <div class="rake-meta">${r.depot} · ${r.zone} · ${r.coach_count} coach(es)</div>
            <button class="btn-small admin-supervisor-only" onclick="editRake(${r.id})">Edit</button>
            <button class="btn-danger admin-only" onclick="deleteRake(${r.id})">Delete</button>
          </div>
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
    `).join("") || `<div class="card"><p class="muted">No rakes to show.</p></div>`;

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

async function editRake(id) {
  const rake = RAKES.find((r) => r.id === id);
  if (!rake) return;
  const rakeCoaches = [...(rake.coaches || [])].sort((a, b) => a.position - b.position);
  openModal(`
    <h3>Edit Rake — ${rake.rake_name}</h3>
    <form id="rake-edit-form">
      <label>Rake Name</label><input type="text" id="re-name" value="${rake.rake_name}" required />
      <label>Rake Type</label>
      <select id="re-type">
        <option value="LHB" ${rake.rake_type === "LHB" ? "selected" : ""}>LHB</option>
        <option value="Vande Bharat" ${rake.rake_type === "Vande Bharat" ? "selected" : ""}>Vande Bharat</option>
      </select>
      <label>Zone</label><input type="text" id="re-zone" value="${rake.zone}" />
      <label>Depot</label><input type="text" id="re-depot" value="${rake.depot}" />
      <p class="modal-error" id="rake-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Save Changes</button>
      </div>
    </form>

    <h3 style="margin-top:1.2rem;">Coach Positions — Total: ${rakeCoaches.length}</h3>
    <table class="table" id="re-positions-table">
      <thead><tr><th>Coach</th><th>Type</th><th>Position</th></tr></thead>
      <tbody>
        ${rakeCoaches.map((c) => `
          <tr data-coach-id="${c.id}">
            <td>${c.coach_number}</td>
            <td>${c.coach_type}</td>
            <td><input type="number" class="re-position-input" min="1" value="${c.position}" style="width:80px;" /></td>
          </tr>
        `).join("") || `<tr><td colspan="3" style="color:#5b6b7f;">No coaches in this rake yet.</td></tr>`}
      </tbody>
    </table>
    <button type="button" class="btn-primary" id="re-save-positions-btn" style="margin-top:0.5rem;">Save Positions</button>
    <p class="modal-error" id="re-positions-error"></p>

    <h3 style="margin-top:1.2rem;">+ Add Coach to this Rake</h3>
    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;">
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">Coach Number</label><input type="text" id="re-new-coach-number" placeholder="e.g. LHB-50231" /></div>
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">Coach Type</label><input type="text" id="re-new-coach-type" placeholder="e.g. AC 3-Tier" /></div>
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">Position</label><input type="number" id="re-new-coach-position" min="1" value="${rakeCoaches.length + 1}" style="width:90px;" /></div>
      <button type="button" class="btn-primary" id="re-add-coach-btn">Add</button>
    </div>
    <p class="modal-error" id="re-add-coach-error"></p>
  `);

  document.getElementById("rake-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/rakes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          rake_name: document.getElementById("re-name").value.trim(),
          rake_type: document.getElementById("re-type").value,
          zone: document.getElementById("re-zone").value.trim(),
          depot: document.getElementById("re-depot").value.trim(),
        }),
      });
      closeModal();
      showToast("Rake updated", "success");
      loadRakes();
    } catch (err) { document.getElementById("rake-edit-error").textContent = err.message; }
  });

  document.getElementById("re-save-positions-btn").addEventListener("click", async () => {
    const errEl = document.getElementById("re-positions-error");
    errEl.textContent = "";
    const rows = [...document.querySelectorAll("#re-positions-table tbody tr[data-coach-id]")];
    const positions = rows.map((row) => ({
      coach_id: Number(row.dataset.coachId),
      position: Number(row.querySelector(".re-position-input").value),
    }));
    if (!positions.length) return;
    try {
      await apiFetch(`/rakes/${id}/positions`, { method: "PUT", body: JSON.stringify({ positions }) });
      showToast("Coach positions updated", "success");
      loadRakes();
      closeModal();
    } catch (err) { errEl.textContent = err.message; }
  });

  document.getElementById("re-add-coach-btn").addEventListener("click", async () => {
    const errEl = document.getElementById("re-add-coach-error");
    errEl.textContent = "";
    const coach_number = document.getElementById("re-new-coach-number").value.trim();
    const coach_type = document.getElementById("re-new-coach-type").value.trim();
    const position = Number(document.getElementById("re-new-coach-position").value);
    if (!coach_number || !coach_type) { errEl.textContent = "Coach number and type are required."; return; }
    try {
      await apiFetch("/admin/coaches", {
        method: "POST",
        body: JSON.stringify({ coach_number, coach_type, rake_id: id, position }),
      });
      showToast("Coach added to rake", "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      await loadRakes();
      editRake(id); // re-open with the fresh coach list
    } catch (err) { errEl.textContent = err.message; }
  });
}
window.editRake = editRake;

async function deleteRake(id) {
  if (!confirm("Delete this rake? It must have no coaches assigned.")) return;
  try {
    await apiFetch(`/rakes/${id}`, { method: "DELETE" });
    showToast("Rake deleted", "success");
    loadRakes();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteRake = deleteRake;

document.getElementById("add-rake-btn").addEventListener("click", () => {
  openModal(`
    <h3>Add Rake</h3>
    <form id="rake-form">
      <label>Rake Name</label><input type="text" id="rake-name" required placeholder="e.g. RAKE-15D" />
      <label>Rake Type</label>
      <select id="rake-type"><option value="LHB">LHB</option><option value="Vande Bharat">Vande Bharat</option></select>
      <label>Zone</label><input type="text" id="rake-zone" placeholder="e.g. NR" />
      <label>Depot</label><input type="text" id="rake-depot" placeholder="e.g. Ghaziabad" />
      <label>Total Coaches in this Rake</label>
      <input type="number" id="rake-total-coaches" min="1" max="24" value="2" />
      <div id="rake-coach-slots" style="margin-top:0.6rem;"></div>
      <p class="modal-error" id="rake-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn-primary">Create Rake</button>
      </div>
    </form>
  `);

  function renderRakeCoachSlots() {
    const total = Math.max(1, Math.min(24, Number(document.getElementById("rake-total-coaches").value) || 1));
    const container = document.getElementById("rake-coach-slots");
    // Preserve any already-typed values when the count changes
    const existing = [...container.querySelectorAll("tr[data-position]")].map((row) => ({
      coach_number: row.querySelector(".slot-coach-number")?.value || "",
      coach_type: row.querySelector(".slot-coach-type")?.value || "",
    }));
    let rowsHtml = "";
    for (let pos = 1; pos <= total; pos++) {
      const prev = existing[pos - 1] || { coach_number: "", coach_type: "" };
      rowsHtml += `
        <tr data-position="${pos}">
          <td style="padding:0.3rem 0.5rem;font-weight:700;">Position ${pos}</td>
          <td style="padding:0.3rem 0.5rem;"><input type="text" class="slot-coach-number" placeholder="Coach Number e.g. LHB-50231" value="${prev.coach_number}" required style="width:100%;" /></td>
          <td style="padding:0.3rem 0.5rem;"><input type="text" class="slot-coach-type" placeholder="Coach Type e.g. AC 3-Tier" value="${prev.coach_type}" required style="width:100%;" /></td>
        </tr>
      `;
    }
    container.innerHTML = `<table class="table"><thead><tr><th>Position</th><th>Coach Number</th><th>Coach Type</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }
  renderRakeCoachSlots();
  document.getElementById("rake-total-coaches").addEventListener("input", renderRakeCoachSlots);

  document.getElementById("rake-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const slotRows = [...document.querySelectorAll("#rake-coach-slots tr[data-position]")];
    const coaches = slotRows.map((row) => ({
      position: Number(row.dataset.position),
      coach_number: row.querySelector(".slot-coach-number").value.trim(),
      coach_type: row.querySelector(".slot-coach-type").value.trim(),
    }));
    try {
      await apiFetch("/rakes", {
        method: "POST",
        body: JSON.stringify({
          rake_name: document.getElementById("rake-name").value.trim(),
          rake_type: document.getElementById("rake-type").value,
          zone: document.getElementById("rake-zone").value.trim(),
          depot: document.getElementById("rake-depot").value.trim(),
          coaches,
        }),
      });
      closeModal();
      showToast("Rake created with " + coaches.length + " coach(es)", "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
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
  await loadAdminNotifications();
}

function coachCheckboxListHtml(selectedIds) {
  const selected = new Set((selectedIds || []).map(Number));
  return `<div class="coach-checkbox-list">${COACHES.map((c) => `
    <label><input type="checkbox" class="coach-assign-cb" value="${c.id}" ${selected.has(c.id) ? "checked" : ""} /> ${c.coach_number} — ${c.coach_type} (${c.rake_name})</label>
  `).join("") || '<span class="muted">No coaches exist yet — create one first.</span>'}</div>`;
}

function collectCheckedCoachIds() {
  return [...document.querySelectorAll(".coach-assign-cb:checked")].map((el) => Number(el.value));
}

async function loadAdminUsers() {
  const users = await apiFetch("/admin/users");
  document.getElementById("users-table-body").innerHTML = users.map((u) => `
    <tr>
      <td>${u.username}</td>
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td>${u.email || '<span class="muted">-</span>'}</td>
      <td>${u.phone || '<span class="muted">-</span>'}</td>
      <td>${u.role === "Admin" ? '<span class="muted">All coaches</span>' : (u.assigned_coaches.length ? u.assigned_coaches.length + " coach(es)" : '<span class="muted">None</span>')}</td>
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
      <label>Email (for alerts &amp; reports)</label><input type="email" id="u-email" placeholder="user@example.com" />
      <label>Phone (for SMS alerts)</label><input type="text" id="u-phone" placeholder="+91XXXXXXXXXX" />
      <label>Role</label>
      <select id="u-role"><option value="Viewer">Viewer</option><option value="Supervisor">Supervisor</option><option value="Admin">Admin</option></select>
      <label>Assigned Coaches — this user will ONLY see these coaches</label>
      ${coachCheckboxListHtml([])}
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
          email: document.getElementById("u-email").value.trim(),
          phone: document.getElementById("u-phone").value.trim(),
          role: document.getElementById("u-role").value,
          assigned_coaches: collectCheckedCoachIds(),
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
      <label>Email (for alerts &amp; reports)</label><input type="email" id="ue-email" value="${u.email || ""}" placeholder="user@example.com" />
      <label>Phone (for SMS alerts)</label><input type="text" id="ue-phone" value="${u.phone || ""}" placeholder="+91XXXXXXXXXX" />
      <label>Role</label>
      <select id="ue-role">
        <option value="Viewer" ${u.role === "Viewer" ? "selected" : ""}>Viewer</option>
        <option value="Supervisor" ${u.role === "Supervisor" ? "selected" : ""}>Supervisor</option>
        <option value="Admin" ${u.role === "Admin" ? "selected" : ""}>Admin</option>
      </select>
      <label>New Password (leave blank to keep unchanged)</label><input type="password" id="ue-password" minlength="6" />
      <label>Assigned Coaches — this user will ONLY see these coaches</label>
      ${coachCheckboxListHtml(u.assigned_coaches)}
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
      const payload = {
        name: document.getElementById("ue-name").value.trim(),
        role: document.getElementById("ue-role").value,
        email: document.getElementById("ue-email").value.trim(),
        phone: document.getElementById("ue-phone").value.trim(),
        assigned_coaches: collectCheckedCoachIds(),
      };
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

// ---- Alert Thresholds + Log Interval (combined) ----
async function loadAdminThresholds() {
  const t = await apiFetch("/admin/thresholds");
  document.getElementById("th-vib-yellow").value = t.vibration.yellow;
  document.getElementById("th-vib-orange").value = t.vibration.orange;
  document.getElementById("th-vib-red").value = t.vibration.red;
  document.getElementById("th-temp-yellow").value = t.temperature.yellow;
  document.getElementById("th-temp-orange").value = t.temperature.orange;
  document.getElementById("th-temp-red").value = t.temperature.red;
  document.getElementById("log-interval-input").value = t.log_interval_seconds;
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
        log_interval_seconds: Number(document.getElementById("log-interval-input").value),
      }),
    });
    showToast("Thresholds & logging interval updated", "success");
  } catch (err) { showToast(err.message, "error"); }
});

// ---- Notifications: Daily Report Time + SMTP + SMS ----
async function loadAdminNotifications() {
  const n = await apiFetch("/admin/notifications");
  document.getElementById("daily-report-time-input").value = n.daily_report_time;

  document.getElementById("smtp-enabled").checked = n.smtp.enabled;
  document.getElementById("smtp-host").value = n.smtp.host;
  document.getElementById("smtp-port").value = n.smtp.port;
  document.getElementById("smtp-secure").checked = n.smtp.secure;
  document.getElementById("smtp-user").value = n.smtp.user;
  document.getElementById("smtp-pass").value = "";
  document.getElementById("smtp-pass").placeholder = n.smtp.pass ? "•••••••• (unchanged)" : "Leave blank to keep unchanged";
  document.getElementById("smtp-from-name").value = n.smtp.from_name;
  document.getElementById("smtp-from-email").value = n.smtp.from_email;

  document.getElementById("sms-enabled").checked = n.sms.enabled;
  document.getElementById("sms-provider").value = n.sms.provider;
  document.getElementById("sms-api-key").value = "";
  document.getElementById("sms-api-key").placeholder = n.sms.api_key ? "•••••••• (unchanged)" : "Leave blank to keep unchanged";
  document.getElementById("sms-sender-id").value = n.sms.sender_id;
}

document.getElementById("daily-report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({ daily_report_time: document.getElementById("daily-report-time-input").value }),
    });
    showToast("Daily report time updated", "success");
  } catch (err) { showToast(err.message, "error"); }
});

document.getElementById("smtp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({
        smtp: {
          enabled: document.getElementById("smtp-enabled").checked,
          host: document.getElementById("smtp-host").value.trim(),
          port: Number(document.getElementById("smtp-port").value) || 587,
          secure: document.getElementById("smtp-secure").checked,
          user: document.getElementById("smtp-user").value.trim(),
          pass: document.getElementById("smtp-pass").value,
          from_name: document.getElementById("smtp-from-name").value.trim(),
          from_email: document.getElementById("smtp-from-email").value.trim(),
        },
      }),
    });
    showToast("SMTP settings saved", "success");
    loadAdminNotifications();
  } catch (err) { showToast(err.message, "error"); }
});

document.getElementById("sms-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({
        sms: {
          enabled: document.getElementById("sms-enabled").checked,
          provider: document.getElementById("sms-provider").value.trim(),
          api_key: document.getElementById("sms-api-key").value,
          sender_id: document.getElementById("sms-sender-id").value.trim(),
        },
      }),
    });
    showToast("SMS settings saved", "success");
    loadAdminNotifications();
  } catch (err) { showToast(err.message, "error"); }
});

document.getElementById("send-test-email-btn").addEventListener("click", async () => {
  const to = document.getElementById("test-email-to").value.trim();
  const resultEl = document.getElementById("test-email-result");
  if (!to) { resultEl.style.color = "var(--red)"; resultEl.textContent = "Enter a recipient email address."; return; }
  resultEl.textContent = "Sending...";
  resultEl.style.color = "";
  try {
    const log = await apiFetch("/admin/notifications/test-email", { method: "POST", body: JSON.stringify({ to }) });
    if (log.status === "sent") { resultEl.style.color = "var(--green)"; resultEl.textContent = "Test email sent successfully."; }
    else if (log.status === "simulated") { resultEl.style.color = "var(--orange)"; resultEl.textContent = "Not sent — " + log.detail; }
    else { resultEl.style.color = "var(--red)"; resultEl.textContent = "Failed: " + log.detail; }
  } catch (err) { resultEl.style.color = "var(--red)"; resultEl.textContent = err.message; }
});

// ================= SETTINGS =================
let bomCache = [];

async function loadSettings() {
  try {
    const [ds, bom, coachHw] = await Promise.all([
      apiFetch("/settings/data-source"),
      apiFetch("/settings/hardware-bom"),
      apiFetch("/settings/coach-hardware"),
    ]);
    document.getElementById("data-source-select").value = ds.data_source;
    document.getElementById("data-source-poll-interval").value = ds.poll_interval_seconds;

    bomCache = bom;
    renderBomTable();

    renderCoachHardwareTable(coachHw);
  } catch (err) { console.error(err); }
}

document.getElementById("data-source-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("data-source-result");
  resultEl.textContent = "";
  try {
    const res = await apiFetch("/settings/data-source", {
      method: "PUT",
      body: JSON.stringify({
        data_source: document.getElementById("data-source-select").value,
        poll_interval_seconds: Number(document.getElementById("data-source-poll-interval").value),
      }),
    });
    resultEl.style.color = "var(--green)";
    resultEl.textContent = `Saved — data source is now "${res.data_source === "live" ? "Live Hardware Mode" : "Demo Mode"}" (poll every ${res.poll_interval_seconds}s).`;
    showToast("Data source updated", "success");
  } catch (err) {
    resultEl.style.color = "var(--red)";
    resultEl.textContent = err.message;
  }
});

function renderBomTable() {
  const tbody = document.getElementById("bom-table-body");
  tbody.innerHTML = bomCache.map((row, idx) => `
    <tr>
      <td><input type="text" class="bom-component" data-idx="${idx}" value="${row.component}" style="width:100%;" /></td>
      <td><input type="text" class="bom-model" data-idx="${idx}" value="${row.model}" style="width:100%;" /></td>
      <td><input type="number" class="bom-qty" data-idx="${idx}" value="${row.qty_per_coach}" min="0" style="width:80px;" /></td>
      <td><input type="text" class="bom-purpose" data-idx="${idx}" value="${row.purpose || ""}" style="width:100%;" /></td>
      <td><button class="btn-danger" type="button" onclick="removeBomRow(${idx})">Remove</button></td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="color:#5b6b7f;">No BOM rows yet — add one.</td></tr>`;
}

function collectBomFromTable() {
  const rows = [...document.querySelectorAll("#bom-table-body tr")];
  return rows.map((row) => ({
    component: row.querySelector(".bom-component")?.value.trim() || "",
    model: row.querySelector(".bom-model")?.value.trim() || "",
    qty_per_coach: Number(row.querySelector(".bom-qty")?.value) || 0,
    purpose: row.querySelector(".bom-purpose")?.value.trim() || "",
  })).filter((r) => r.component && r.model);
}

function removeBomRow(idx) {
  bomCache = collectBomFromTable();
  bomCache.splice(idx, 1);
  renderBomTable();
}
window.removeBomRow = removeBomRow;

document.getElementById("bom-add-row-btn").addEventListener("click", () => {
  bomCache = collectBomFromTable();
  bomCache.push({ component: "", model: "", qty_per_coach: 1, purpose: "" });
  renderBomTable();
});

document.getElementById("bom-save-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("bom-save-result");
  resultEl.textContent = "";
  const bom = collectBomFromTable();
  try {
    bomCache = await apiFetch("/settings/hardware-bom", { method: "PUT", body: JSON.stringify({ bom }) });
    renderBomTable();
    resultEl.style.color = "var(--green)";
    resultEl.textContent = "BOM saved.";
    showToast("Hardware BOM saved", "success");
  } catch (err) {
    resultEl.style.color = "var(--red)";
    resultEl.textContent = err.message;
  }
});

function renderCoachHardwareTable(coachHw) {
  const tbody = document.getElementById("coach-hardware-table-body");
  tbody.innerHTML = coachHw.map((c) => `
    <tr data-coach-id="${c.id}">
      <td><b>${c.coach_number}</b></td>
      <td><input type="text" class="ch-obcms-ip" value="${c.hardware.obcms_master_ip}" placeholder="e.g. 10.10.10.11" style="width:140px;" /></td>
      <td><input type="number" class="ch-obcms-port" value="${c.hardware.obcms_master_port}" style="width:80px;" /></td>
      <td><input type="text" class="ch-piccu-ip" value="${c.hardware.piccu_master_ip}" placeholder="e.g. 10.10.10.12" style="width:140px;" /></td>
      <td><input type="number" class="ch-piccu-port" value="${c.hardware.piccu_master_port}" style="width:80px;" /></td>
      <td><input type="text" class="ch-rut200-ip" value="${c.hardware.rut200_ip}" placeholder="e.g. 10.10.10.1" style="width:140px;" /></td>
      <td><button class="btn-small" type="button" onclick="saveCoachHardware(${c.id})">Save</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">No coaches yet.</td></tr>`;
}

async function saveCoachHardware(coachId) {
  const row = document.querySelector(`#coach-hardware-table-body tr[data-coach-id="${coachId}"]`);
  if (!row) return;
  try {
    await apiFetch(`/settings/coach-hardware/${coachId}`, {
      method: "PUT",
      body: JSON.stringify({
        obcms_master_ip: row.querySelector(".ch-obcms-ip").value.trim(),
        obcms_master_port: Number(row.querySelector(".ch-obcms-port").value) || 502,
        piccu_master_ip: row.querySelector(".ch-piccu-ip").value.trim(),
        piccu_master_port: Number(row.querySelector(".ch-piccu-port").value) || 502,
        rut200_ip: row.querySelector(".ch-rut200-ip").value.trim(),
      }),
    });
    showToast("Hardware connectivity saved", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}
window.saveCoachHardware = saveCoachHardware;

// ---------------- Init ----------------
if (TOKEN && USER) {
  boot();
}
