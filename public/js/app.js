const API = "/api";
let TOKEN = localStorage.getItem("himnish_token") || null;
let USER = JSON.parse(localStorage.getItem("himnish_user") || "null");
let COACHES = [];
let selectedObcmsCoach = null;
let selectedPiccuCoach = null;
let selectedSensorId = null;
let obcmsChart = null;
let refreshTimer = null;
let alertsFilter = "open";

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
    if (view === "obcms") loadObcms();
    if (view === "piccu") loadPiccu();
    if (view === "alerts") loadAlerts();
  });
});

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    alertsFilter = tab.dataset.filter;
    loadAlerts();
  });
});

// ---------------- Boot ----------------
async function boot() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("user-name").textContent = `${USER.name} (${USER.role})`;

  try {
    COACHES = await apiFetch("/coaches");
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
  if (view === "overview") loadOverview();
  if (view === "obcms") loadObcms();
  if (view === "piccu") loadPiccu();
  if (view === "alerts") loadAlerts();
}

function populateCoachSelectors() {
  const obcmsSel = document.getElementById("obcms-coach-select");
  const piccuSel = document.getElementById("piccu-coach-select");
  [obcmsSel, piccuSel].forEach((sel) => {
    sel.innerHTML = COACHES.map((c) => `<option value="${c.id}">${c.coach_number} — ${c.coach_type} (${c.depot})</option>`).join("");
  });
  selectedObcmsCoach = COACHES[0] ? COACHES[0].id : null;
  selectedPiccuCoach = COACHES[0] ? COACHES[0].id : null;
  obcmsSel.addEventListener("change", (e) => { selectedObcmsCoach = Number(e.target.value); selectedSensorId = null; loadObcms(); });
  piccuSel.addEventListener("change", (e) => { selectedPiccuCoach = Number(e.target.value); loadPiccu(); });
}

// ---------------- Overview ----------------
async function loadOverview() {
  try {
    const summary = await apiFetch("/coaches/summary");
    document.getElementById("kpi-coaches").textContent = summary.total_coaches;
    document.getElementById("kpi-sensors").textContent = summary.total_sensors;
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
        <td>${c.rake_id}</td>
        <td>${c.depot} / ${c.zone}</td>
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

// ---------------- OBCMS ----------------
async function loadObcms() {
  if (!selectedObcmsCoach) return;
  document.getElementById("obcms-coach-select").value = selectedObcmsCoach;
  try {
    const sensors = await apiFetch(`/coaches/${selectedObcmsCoach}/sensors`);
    if (!selectedSensorId && sensors.length) selectedSensorId = sensors[0].id;

    const grid = document.getElementById("obcms-sensor-grid");
    grid.innerHTML = sensors.map((s) => {
      const band = s.latest ? s.latest.band : "GREEN";
      const vib = s.latest ? s.latest.vibration_g : "-";
      const temp = s.latest ? s.latest.temperature_c : "-";
      return `
        <div class="sensor-card ${s.id === selectedSensorId ? "selected" : ""}" onclick="selectSensor(${s.id})">
          <div class="sensor-card-top">
            <div>
              <div class="sensor-loc">${s.location}</div>
              <div class="sensor-type">${s.type}</div>
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

    const selected = sensors.find((s) => s.id === selectedSensorId) || sensors[0];
    if (selected) renderObcmsChart(selected);

    const alerts = await apiFetch(`/coaches/${selectedObcmsCoach}/alerts`);
    const tbody = document.getElementById("obcms-alerts-body");
    tbody.innerHTML = alerts.slice(0, 15).map((a) => `
      <tr>
        <td>${new Date(a.created_at).toLocaleTimeString()}</td>
        <td>${a.sensor_id}</td>
        <td>${a.severity}</td>
        <td>${a.message}</td>
        <td>${a.acknowledged ? '<span class="status-pill Online">Acknowledged</span>' : '<span class="status-pill Fault">Open</span>'}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="color:#5b6b7f;">No alerts for this coach.</td></tr>`;
  } catch (err) { console.error(err); }
}

function selectSensor(sensorId) {
  selectedSensorId = sensorId;
  loadObcms();
}
window.selectSensor = selectSensor;

function renderObcmsChart(sensor) {
  const ctx = document.getElementById("obcms-chart").getContext("2d");
  const labels = sensor.history.map((r) => new Date(r.ts).toLocaleTimeString());
  const data = sensor.history.map((r) => r.vibration_g);
  if (obcmsChart) obcmsChart.destroy();
  obcmsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `Vibration (g) — ${sensor.location}`,
        data,
        borderColor: "#eb5b12",
        backgroundColor: "rgba(235,91,18,0.08)",
        tension: 0.3,
        fill: true,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "g" } } },
    },
  });
}

// ---------------- PICCU ----------------
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

// ---------------- Alerts ----------------
async function loadAlerts() {
  try {
    const alerts = await apiFetch(`/alerts?status=${alertsFilter}`);
    const tbody = document.getElementById("alerts-table-body");
    tbody.innerHTML = alerts.map((a) => `
      <tr>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td>${a.coach_number}</td>
        <td>${a.sensor_location}</td>
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

// ---------------- Init ----------------
if (TOKEN && USER) {
  boot();
}
