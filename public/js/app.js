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
    throw new Error(t("common.sessionExpired"));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || t("common.requestFailed"));
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
    if (!res.ok) throw new Error(data.error || t("common.loginFailed"));
    if (data.otp_required) {
      promptForOtp(data.user_id);
      return;
    }
    if (data.dsc_required) {
      promptForDsc(data.user_id, data.challenge);
      return;
    }
    completeLogin(data);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function completeLogin(data) {
  TOKEN = data.token;
  USER = data.user;
  localStorage.setItem("himnish_token", TOKEN);
  localStorage.setItem("himnish_user", JSON.stringify(USER));
  if (data.must_change_password) {
    promptForPasswordChange();
  } else {
    boot();
  }
}

function promptForOtp(userId) {
  openModal(`
    <h3>${t("auth.otpTitle") || "Enter login code"}</h3>
    <p class="muted">${t("auth.otpBody") || "We emailed you a one-time 6-digit code. It expires in 5 minutes."}</p>
    <form id="otp-form">
      <input type="text" id="otp-code" maxlength="6" pattern="[0-9]{6}" placeholder="123456" autofocus required />
      <div class="modal-error" id="otp-error"></div>
      <button type="submit" class="btn-primary">${t("common.verify") || "Verify"}</button>
    </form>
  `);
  document.getElementById("otp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const otp = document.getElementById("otp-code").value.trim();
    const errEl = document.getElementById("otp-error");
    try {
      const res = await fetch(API + "/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("common.requestFailed"));
      closeModal();
      if (data.dsc_required) {
        promptForDsc(data.user_id, data.challenge);
        return;
      }
      completeLogin(data);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

// DSC (Digital Signature Certificate) step — only reached if Admin > Security > "Require DSC
// at login" is on AND this account has a certificate on file. The user signs the challenge with
// their own DSC token's signer software (outside this app, same as e-Tendering/GST portals) and
// pastes the resulting Base64 signature here.
function promptForDsc(userId, challenge) {
  openModal(`
    <h3>DSC Signature Required</h3>
    <p class="muted">Sign the challenge below with your DSC token's signer utility (using the private key on your USB token), then paste the resulting Base64 signature here.</p>
    <div class="code-block" style="word-break:break-all;font-size:0.8em;">${challenge}</div>
    <form id="dsc-form">
      <textarea id="dsc-signature" rows="4" placeholder="Paste Base64 signature here" required></textarea>
      <div class="modal-error" id="dsc-error"></div>
      <button type="submit" class="btn-primary">Verify &amp; Sign In</button>
    </form>
  `);
  document.getElementById("dsc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const signature = document.getElementById("dsc-signature").value.trim();
    const errEl = document.getElementById("dsc-error");
    try {
      const res = await fetch(API + "/auth/dsc-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("common.requestFailed"));
      closeModal();
      completeLogin(data);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function promptForPasswordChange() {
  openModal(`
    <h3>${t("auth.mustChangeTitle") || "Set a new password"}</h3>
    <p class="muted">${t("auth.mustChangeBody") || "This account is using a temporary password. Choose your own before continuing (min 8 characters, at least one letter and one number)."}</p>
    <form id="pwchange-form">
      <input type="password" id="pw-current" placeholder="${t("auth.currentPassword") || "Current password"}" required />
      <input type="password" id="pw-new" placeholder="${t("auth.newPassword") || "New password"}" required />
      <input type="password" id="pw-confirm" placeholder="${t("auth.confirmPassword") || "Confirm new password"}" required />
      <div class="modal-error" id="pwchange-error"></div>
      <button type="submit" class="btn-primary">${t("common.save") || "Save"}</button>
    </form>
  `);
  document.getElementById("pwchange-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const current_password = document.getElementById("pw-current").value;
    const new_password = document.getElementById("pw-new").value;
    const confirm = document.getElementById("pw-confirm").value;
    const errEl = document.getElementById("pwchange-error");
    if (new_password !== confirm) { errEl.textContent = t("auth.passwordMismatch") || "Passwords do not match"; return; }
    try {
      const res = await fetch(API + "/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
        body: JSON.stringify({ current_password, new_password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("common.requestFailed"));
      USER.must_change_password = false;
      localStorage.setItem("himnish_user", JSON.stringify(USER));
      closeModal();
      showToast(t("auth.passwordChanged") || "Password updated", "success");
      boot();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

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
    const titleEl = document.getElementById("view-title");
    titleEl.setAttribute("data-i18n", "nav." + view);
    titleEl.textContent = t("nav." + view);
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
  if (view === "compliance") loadCompliance();
  if (view === "rakes") loadRakes();
  if (view === "coach-mgmt") loadCoachManagement();
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
  document.getElementById("user-name").textContent = `${USER.name} (${t("role." + USER.role)})`;
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
  reportsSel.innerHTML = `<option value="">${t("reports.allMyCoaches")}</option>` + optionHtml;

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
    document.getElementById("band-nodata").textContent = summary.band_counts.NODATA;
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
  select.innerHTML = `<option value="">${t("common.allCoaches")}</option>` + COACHES.map((c) => `<option value="${c.coach_number}">${c.coach_number} — ${c.coach_type} (${c.rake_name})</option>`).join("");
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
      <td><span class="band-pill ${c.overall_band}">${t("common.band." + c.overall_band)}</span></td>
      <td>${c.open_alerts}</td>
      <td>${c.piccu_faults}</td>
      <td><button class="btn-small" onclick="jumpToCoach(${c.id})">${t("overview.table.viewObcms")}</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">${t("overview.table.noMatch", { q: overviewCoachQuery })}</td></tr>`;
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
      const band = a.latest ? a.latest.band : "NODATA";
      const vib = a.latest ? a.latest.vibration_g : "-";
      const temp = a.latest ? a.latest.temperature_c : "-";
      return `
        <div class="sensor-card ${a.id === selectedAxleId ? "selected" : ""}" onclick="selectAxle(${a.id})">
          <div class="sensor-card-top">
            <div>
              <div class="sensor-loc">${t("common.axlePrefix")}${a.axle_number}</div>
              <div class="sensor-type">${t("obcms.sensorType")}</div>
            </div>
            <span class="band-pill ${band}">${t("common.band." + band)}</span>
          </div>
          <div class="sensor-metrics">
            <div>${t("common.vibShort")} <b>${vib}g</b></div>
            <div>${t("common.tempShort")} <b>${temp}°C</b></div>
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
        <td>${t("common.axlePrefix")}${a.axle_number ?? "-"}</td>
        <td>${a.severity === "Critical" ? t("common.critical") : a.severity === "High" ? t("common.high") : a.severity}</td>
        <td>${a.message}</td>
        <td>${a.acknowledged ? `<span class="status-pill Online">${t("common.acknowledged")}</span>` : `<span class="status-pill Fault">${t("common.open")}</span>`}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="color:#5b6b7f;">${t("obcms.noAlerts")}</td></tr>`;
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
        { label: `${t("obcms.chart.vibrationLabel")}${axle.axle_number}`, data: vibData, borderColor: "#eb5b12", backgroundColor: "rgba(235,91,18,0.08)", tension: 0.3, fill: true, pointRadius: 2, yAxisID: "y" },
        { label: `${t("obcms.chart.temperatureLabel")}${axle.axle_number}`, data: tempData, borderColor: "#0b3d78", backgroundColor: "rgba(11,61,120,0.06)", tension: 0.3, fill: true, pointRadius: 2, yAxisID: "y1" },
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
        <span class="piccu-item-name">${t("piccuSystem." + s.system_name)}</span>
        <span class="status-pill ${s.status.replace(/\s/g, "")}">${s.status === "Online" ? t("common.online") : s.status === "Fault" ? t("common.fault") : t("common.noDataShort")}</span>
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
        <td><span class="health-score-pill" style="background:${c.health_score === null ? "#64748a" : c.health_score >= 85 ? "#2e7d32" : c.health_score >= 60 ? "#d9a400" : c.health_score >= 35 ? "#eb5b12" : "#c0392b"}">${c.health_score === null ? t("common.noDataShort") : c.health_score}</span></td>
        <td><div class="axle-heatmap">${c.axles.map((a) => `<div class="axle-cell ${a.band}" title="${t("common.axlePrefix")}${a.axle_number}: ${t("common.band." + a.band)}">${a.axle_number}</div>`).join("")}</div></td>
      </tr>
    `).join("");

    const worst = await apiFetch("/health/worst-axles?limit=10");
    const wbody = document.getElementById("worst-axles-body");
    wbody.innerHTML = worst.map((r) => `
      <tr>
        <td>${r.coach_number}</td>
        <td>${t("common.axlePrefix")}${r.axle_number}</td>
        <td><span class="band-pill ${r.band}">${t("common.band." + r.band)}</span></td>
        <td>${r.vibration_g}</td>
        <td>${r.temperature_c}</td>
        <td>${new Date(r.ts).toLocaleTimeString()}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" style="color:#5b6b7f;">${t("health.noData")}</td></tr>`;
  } catch (err) { console.error(err); }
}

// ================= PREDICTION =================
let predictionCoachQuery = "";
let predictionDataCache = [];

async function loadPrediction() {
  try {
    const { predictions } = await apiFetch("/predictions");
    predictionDataCache = predictions;
    document.getElementById("prediction-note").textContent = t("prediction.noteText");
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
  select.innerHTML = `<option value="">${t("common.allCoaches")}</option>` + uniqueCoaches.map((c) => `<option value="${c.coach_number}">${c.coach_number}</option>`).join("");
  select.value = prevValue && uniqueCoaches.some((c) => c.coach_number === prevValue) ? prevValue : "";
}

function accelerationBadge(flag) {
  if (flag === "accelerating") return ` <span class="accel-badge accel-up" title="${t("prediction.accel.accelerating")}">&#9650;&#9650;</span>`;
  if (flag === "decelerating") return ` <span class="accel-badge accel-down" title="${t("prediction.accel.decelerating")}">&#9660;</span>`;
  return "";
}

function confidenceBadge(conf) {
  if (!conf) return "-";
  const cls = conf.label === "High" ? "confidence-high" : conf.label === "Medium" ? "confidence-medium" : "confidence-low";
  return `<span class="confidence-pill ${cls}">${t("prediction.confidence." + conf.label.toLowerCase())} (${Math.round(conf.score * 100)}%)</span>`;
}

function renderPredictionTable() {
  const tbody = document.getElementById("prediction-table-body");
  const q = predictionCoachQuery.trim().toLowerCase();
  const filtered = q ? predictionDataCache.filter((p) => p.coach_number.toLowerCase().includes(q)) : predictionDataCache;
  tbody.innerHTML = filtered.slice(0, 40).map((p) => `
    <tr>
      <td>${p.coach_number}</td>
      <td>${t("common.axlePrefix")}${p.axle_number}</td>
      <td><span class="band-pill ${p.current_band}">${t("common.band." + p.current_band)}</span></td>
      <td>${t("trend." + p.vibration_trend)}${accelerationBadge(p.vibration_acceleration)}</td>
      <td>${t("trend." + p.temperature_trend)}${accelerationBadge(p.temperature_acceleration)}</td>
      <td>${p.driver_parameter ? t("driver." + p.driver_parameter) : "-"}</td>
      <td>${p.estimated_minutes_to_breach != null ? p.estimated_minutes_to_breach + " " + t("common.minAbbrev") + " (" + t("prediction.toLabel") + " " + p.predicted_next_threshold + (p.driver_parameter === "vibration" ? "g" : "°C") + ")" : t("common.stable")}</td>
      <td>${confidenceBadge(p.confidence)}</td>
      <td><button class="btn-small admin-supervisor-only" onclick="openLogMaintenanceModal(${p.axle_id}, '${p.coach_number}', ${p.axle_number})">${t("prediction.logEventBtn")}</button></td>
    </tr>
  `).join("") || `<tr><td colspan="9" style="color:#5b6b7f;">${predictionCoachQuery ? t("prediction.noMatch", { q: predictionCoachQuery }) : t("prediction.noHistory")}</td></tr>`;
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

// ---------------- Maintenance / failure event logging ----------------
// This is the historical dataset MDTS:44415's "certified predictive algorithm" would
// need to be trained on — see routes/maintenance.js and routes/predictions.js for how
// it's used today (baseline reset) and what it's for longer-term (future ML training).
const MAINTENANCE_EVENT_TYPES = [
  "bearing_replaced", "axle_replaced", "sensor_replaced",
  "inspection_ok", "inspection_flagged", "unplanned_failure", "other",
];

function openLogMaintenanceModal(axleId, coachNumber, axleNumber) {
  const options = MAINTENANCE_EVENT_TYPES.map((et) => `<option value="${et}">${t("maintenance.eventType." + et)}</option>`).join("");
  openModal(`
    <h3>${t("maintenance.modal.title", { coach: coachNumber, axle: axleNumber })}</h3>
    <form id="maintenance-event-form">
      <label>${t("maintenance.modal.eventType")}</label>
      <select id="me-type">${options}</select>
      <label>${t("maintenance.modal.notes")}</label>
      <textarea id="me-notes" rows="3" placeholder="${t("maintenance.modal.notesPlaceholder")}"></textarea>
      <p class="modal-error" id="maintenance-event-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("maintenance.modal.saveBtn")}</button>
      </div>
    </form>
  `);
  document.getElementById("maintenance-event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/maintenance", {
        method: "POST",
        body: JSON.stringify({
          axle_id: axleId,
          event_type: document.getElementById("me-type").value,
          notes: document.getElementById("me-notes").value.trim(),
        }),
      });
      closeModal();
      showToast(t("maintenance.toast.logged"), "success");
      loadPrediction();
    } catch (err) { document.getElementById("maintenance-event-error").textContent = err.message; }
  });
}
window.openLogMaintenanceModal = openLogMaintenanceModal;

document.getElementById("view-maintenance-log-btn").addEventListener("click", async () => {
  try {
    const events = await apiFetch("/maintenance");
    const rows = events.map((ev) => `
      <tr>
        <td>${new Date(ev.event_at).toLocaleString()}</td>
        <td>${ev.coach_id != null ? (COACHES.find((c) => c.id === ev.coach_id)?.coach_number || "-") : "-"}</td>
        <td>${t("common.axlePrefix")}${ev.axle_number}</td>
        <td>${t("maintenance.eventType." + ev.event_type)}</td>
        <td>${ev.notes || "-"}</td>
        <td>${ev.reading_snapshot ? `${ev.reading_snapshot.vibration_g}g / ${ev.reading_snapshot.temperature_c}°C` : "-"}</td>
        <td>${ev.logged_by}</td>
      </tr>
    `).join("");
    openModal(`
      <h3>${t("maintenance.logTitle")}</h3>
      <p class="muted">${t("maintenance.logNote")}</p>
      <div style="max-height:60vh;overflow:auto;">
        <table class="table">
          <thead><tr>
            <th>${t("maintenance.log.when")}</th><th>${t("maintenance.log.coach")}</th><th>${t("maintenance.log.axle")}</th>
            <th>${t("maintenance.log.eventType")}</th><th>${t("maintenance.log.notes")}</th>
            <th>${t("maintenance.log.readingAtEvent")}</th><th>${t("maintenance.log.loggedBy")}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">${t("maintenance.logEmpty")}</td></tr>`}</tbody>
        </table>
      </div>
    `);
  } catch (err) { showToast(err.message, "error"); }
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
        datasets: [{ label: t("alerts.datasetLabel"), data: data.top_alert_coaches.map((c) => c.alert_count), backgroundColor: "#c0392b" }],
      },
      options: { responsive: true, indexAxis: "y" },
    });

    const trendCtx = document.getElementById("chart-alert-trend").getContext("2d");
    if (analyticsCharts.trend) analyticsCharts.trend.destroy();
    analyticsCharts.trend = new Chart(trendCtx, {
      type: "line",
      data: {
        labels: data.alert_trend.map((t) => new Date(t.minute).toLocaleTimeString()),
        datasets: [{ label: t("analytics.chart.alertsPerMinute"), data: data.alert_trend.map((t) => t.count), borderColor: "#2e7d32", backgroundColor: "rgba(46,125,50,0.1)", fill: true, tension: 0.3 }],
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
      document.getElementById("analytics-coach-detail").innerHTML = `<p class="muted">${t("analytics.noCoaches")}</p>`;
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
        <div class="kpi-card"><div class="kpi-label">${t("analytics.kpi.avgVibration")}</div><div class="kpi-value">${d.avg_vibration_g === null ? t("common.noDataShort") : d.avg_vibration_g + "g"}</div></div>
        <div class="kpi-card"><div class="kpi-label">${t("analytics.kpi.avgTemperature")}</div><div class="kpi-value">${d.avg_temperature_c === null ? t("common.noDataShort") : d.avg_temperature_c + "°C"}</div></div>
        <div class="kpi-card alert"><div class="kpi-label">${t("analytics.kpi.openAlerts")}</div><div class="kpi-value">${d.open_alerts}</div></div>
        <div class="kpi-card"><div class="kpi-label">${t("analytics.kpi.totalAlerts")}</div><div class="kpi-value">${d.total_alerts}</div></div>
      </div>
      <canvas id="coach-analytics-chart" height="90"></canvas>
    `;

    const ctx = document.getElementById("coach-analytics-chart").getContext("2d");
    if (analyticsCharts.coachDetail) analyticsCharts.coachDetail.destroy();
    const labels = d.axles.map((a) => `${t("common.axlePrefix")}${a.axle_number}`);
    analyticsCharts.coachDetail = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: t("analytics.chart.datasetVibration"), data: d.axles.map((a) => (a.latest ? a.latest.vibration_g : 0)), backgroundColor: "#eb5b12", yAxisID: "y" },
          { label: t("analytics.chart.datasetTemperature"), data: d.axles.map((a) => (a.latest ? a.latest.temperature_c : 0)), backgroundColor: "#0b3d78", yAxisID: "y1" },
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
        <td>${a.severity === "Critical" ? t("common.critical") : a.severity === "High" ? t("common.high") : a.severity}</td>
        <td>${a.message}</td>
        <td>${a.acknowledged ? `<span class="status-pill Online">${t("common.acknowledged")}</span>` : `<span class="status-pill Fault">${t("common.open")}</span>`}</td>
        <td>${a.acknowledged ? "" : `<button class="btn-small" onclick="ackAlert(${a.id})">${t("alerts.action.acknowledge")}</button>`}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" style="color:#5b6b7f;">${t("alerts.noAlerts")}</td></tr>`;
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
      <div class="kpi-card"><div class="kpi-label">${t("overview.kpi.totalCoaches")}</div><div class="kpi-value">${s.total_coaches}</div></div>
      <div class="kpi-card"><div class="kpi-label">${t("overview.kpi.totalRakes")}</div><div class="kpi-value">${s.total_rakes}</div></div>
      <div class="kpi-card alert"><div class="kpi-label">${t("overview.kpi.openAlerts")}</div><div class="kpi-value">${s.open_alerts}</div></div>
      <div class="kpi-card"><div class="kpi-label">${t("reports.kpi.acknowledgedAlerts")}</div><div class="kpi-value">${s.acknowledged_alerts}</div></div>
    `;
  } catch (err) { console.error(err); }
}

// ---------------- MDTS:44415 Compliance (wheel-defect / self-diagnosis / downtime / SBC) ----------------
async function loadCompliance() {
  await Promise.all([
    loadComplianceWheelDefect(),
    loadComplianceDiagnosis(),
    loadComplianceDowntime(),
    loadComplianceSbc(),
  ]);
}

async function loadComplianceWheelDefect() {
  try {
    const rows = await apiFetch("/compliance/wheel-defect");
    const body = document.getElementById("compliance-wheel-table-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted">No Yellow/Orange/Red wheel-defect risk currently flagged on any accessible coach.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.coach_number || "-")}</td>
        <td>${r.axle_number}</td>
        <td><span class="band-pill" style="background:${bandColor(r.band)};color:#fff;">${r.band}</span></td>
        <td>${r.impact_factor != null ? r.impact_factor + "x" : "-"}</td>
        <td>${r.checked_at ? new Date(r.checked_at).toLocaleString() : "-"}</td>
      </tr>
    `).join("");
  } catch (err) { console.error(err); }
}

async function loadComplianceDiagnosis() {
  try {
    const { axles, devices } = await apiFetch("/compliance/self-diagnosis");
    const flagged = axles.filter((a) => a.sensor_health !== "OK");
    const diagBody = document.getElementById("compliance-diag-table-body");
    diagBody.innerHTML = flagged.length
      ? flagged.map((a) => `
        <tr>
          <td>${escapeHtml(a.coach_number || "-")}</td>
          <td>${a.axle_number}</td>
          <td><span class="band-pill" style="background:${a.sensor_health === "FAULT" ? bandColor("ORANGE") : a.sensor_health === "STALE" ? bandColor("YELLOW") : "#5b6b7f"};color:#fff;">${a.sensor_health}</span></td>
          <td>${escapeHtml(a.detail || "-")}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="muted">All accessible axle sensors reporting OK.</td></tr>`;

    const commBody = document.getElementById("compliance-comm-table-body");
    commBody.innerHTML = devices.length
      ? devices.map((d) => `
        <tr>
          <td>${escapeHtml(d.device_label)}</td>
          <td>${escapeHtml(d.coach_number || "-")}</td>
          <td><span class="band-pill" style="background:${d.comm_health === "FAULT" ? bandColor("RED") : "#2e7d32"};color:#fff;">${d.comm_health}</span></td>
          <td>${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "Never"}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="muted">No RUT devices assigned to any accessible coach.</td></tr>`;
  } catch (err) { console.error(err); }
}

function populateComplianceDowntimePeriodSelectors() {
  const monthSel = document.getElementById("compliance-downtime-month");
  const yearSel = document.getElementById("compliance-downtime-year");
  if (monthSel.options.length) return; // already populated once
  const now = new Date();
  monthSel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>`).join("");
  monthSel.value = now.getMonth() + 1;
  yearSel.innerHTML = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => `<option value="${y}">${y}</option>`).join("");
  yearSel.value = now.getFullYear();
  monthSel.addEventListener("change", loadComplianceDowntime);
  yearSel.addEventListener("change", loadComplianceDowntime);
}

async function loadComplianceDowntime() {
  const card = document.getElementById("compliance-downtime-card");
  if (USER.role === "Viewer") { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  populateComplianceDowntimePeriodSelectors();
  const month = document.getElementById("compliance-downtime-month").value;
  const year = document.getElementById("compliance-downtime-year").value;
  try {
    const rows = await apiFetch(`/compliance/downtime?year=${year}&month=${month}`);
    const body = document.getElementById("compliance-downtime-table-body");
    body.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.coach_number)}</td>
          <td>${r.downtime_hours}</td>
          <td>${r.downtime_pct}%</td>
          <td>${r.penalty_pct}%</td>
          <td>${r.monthly_bill_amount.toLocaleString("en-IN")}</td>
          <td>${r.penalty_amount.toLocaleString("en-IN")}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6" class="muted">No data for this period.</td></tr>`;
  } catch (err) { console.error(err); }
}

async function loadComplianceSbc() {
  const sel = document.getElementById("compliance-sbc-coach-select");
  if (!sel.options.length) {
    sel.innerHTML = COACHES.map((c) => `<option value="${c.id}">${escapeHtml(c.coach_number)}</option>`).join("");
    sel.addEventListener("change", loadComplianceSbc);
  }
  const coachId = sel.value || (COACHES[0] && COACHES[0].id);
  if (!coachId) return;
  try {
    const result = await apiFetch(`/compliance/sbc-completeness/${coachId}`);
    document.getElementById("compliance-sbc-summary").textContent =
      `${result.received_count} / ${result.total_parameters} parameters received (${result.completeness_pct}%)`;
    document.getElementById("compliance-sbc-table-body").innerHTML = result.checklist.map((p) => `
      <tr>
        <td>${escapeHtml(p.label)}</td>
        <td>${escapeHtml(p.group)}</td>
        <td>${p.received ? "✅" : "—"}</td>
      </tr>
    `).join("");
  } catch (err) { console.error(err); }
}

async function downloadCsv(path, filename) {
  try {
    const res = await fetch(API + path, { headers: { Authorization: "Bearer " + TOKEN } });
    if (!res.ok) throw new Error(t("common.exportFailed"));
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
  resultEl.textContent = t("reports.sending");
  resultEl.style.color = "";
  try {
    const res = await apiFetch("/reports/send-test-report", { method: "POST" });
    if (res.log.status === "sent") {
      resultEl.style.color = "var(--green)";
      resultEl.textContent = t("reports.sentSuccess");
    } else if (res.log.status === "simulated") {
      resultEl.style.color = "var(--orange)";
      resultEl.textContent = t("reports.notSent", { detail: res.log.detail });
    } else {
      resultEl.style.color = "var(--red)";
      resultEl.textContent = t("reports.failed", { detail: res.log.detail });
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
            <div class="rake-meta">${r.depot} · ${r.zone} · ${r.coach_count} ${t("rakes.coachCount")}</div>
            <button class="btn-small admin-supervisor-only" onclick="editRake(${r.id})">${t("common.edit")}</button>
            <button class="btn-danger admin-only" onclick="deleteRake(${r.id})">${t("common.delete")}</button>
          </div>
        </div>
        <div class="rake-coach-list">
          ${r.coaches.map((c) => `
            <div class="rake-coach-chip">
              <span class="coach-no">${c.coach_number}</span>
              <span class="muted">${c.coach_type}</span>
              <span class="band-pill ${c.overall_band}" style="width:fit-content;">${t("common.band." + c.overall_band)}</span>
            </div>
          `).join("") || `<span class="muted">${t("rakes.noCoachesInRake")}</span>`}
        </div>
      </div>
    `).join("") || `<div class="card"><p class="muted">${t("rakes.noRakes")}</p></div>`;

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
    `).join("") || `<tr><td colspan="6" style="color:#5b6b7f;">${t("rakes.noSwaps")}</td></tr>`;
  } catch (err) { console.error(err); }
}

async function editRake(id) {
  const rake = RAKES.find((r) => r.id === id);
  if (!rake) return;
  const rakeCoaches = [...(rake.coaches || [])].sort((a, b) => a.position - b.position);
  openModal(`
    <h3>${t("rakes.modal.editTitle", { name: rake.rake_name })}</h3>
    <form id="rake-edit-form">
      <label>${t("rakes.modal.rakeName")}</label><input type="text" id="re-name" value="${rake.rake_name}" required />
      <label>${t("rakes.modal.rakeType")}</label>
      <select id="re-type">
        <option value="LHB" ${rake.rake_type === "LHB" ? "selected" : ""}>LHB</option>
        <option value="Vande Bharat" ${rake.rake_type === "Vande Bharat" ? "selected" : ""}>Vande Bharat</option>
      </select>
      <label>${t("rakes.modal.zone")}</label><input type="text" id="re-zone" value="${rake.zone}" />
      <label>${t("rakes.modal.depot")}</label><input type="text" id="re-depot" value="${rake.depot}" />
      <p class="modal-error" id="rake-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("common.saveChanges")}</button>
      </div>
    </form>

    <h3 style="margin-top:1.2rem;">${t("rakes.modal.coachPositionsTitle", { n: rakeCoaches.length })}</h3>
    <table class="table" id="re-positions-table">
      <thead><tr><th>${t("rakes.modal.coach")}</th><th>${t("rakes.modal.coachType")}</th><th>${t("rakes.modal.position")}</th></tr></thead>
      <tbody>
        ${rakeCoaches.map((c) => `
          <tr data-coach-id="${c.id}">
            <td>${c.coach_number}</td>
            <td>${c.coach_type}</td>
            <td><input type="number" class="re-position-input" min="1" value="${c.position}" style="width:80px;" /></td>
          </tr>
        `).join("") || `<tr><td colspan="3" style="color:#5b6b7f;">${t("rakes.noCoachesInRake")}</td></tr>`}
      </tbody>
    </table>
    <button type="button" class="btn-primary" id="re-save-positions-btn" style="margin-top:0.5rem;">${t("rakes.modal.savePositions")}</button>
    <p class="modal-error" id="re-positions-error"></p>

    <h3 style="margin-top:1.2rem;">${t("rakes.modal.addCoachTitle")}</h3>
    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;">
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">${t("rakes.modal.coachNumber")}</label><input type="text" id="re-new-coach-number" placeholder="${t("rakes.modal.egCoachNumber")}" /></div>
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">${t("rakes.modal.coachType")}</label><input type="text" id="re-new-coach-type" placeholder="${t("rakes.modal.egCoachType")}" /></div>
      <div><label style="display:block;font-size:0.8rem;font-weight:700;">${t("rakes.modal.position")}</label><input type="number" id="re-new-coach-position" min="1" value="${rakeCoaches.length + 1}" style="width:90px;" /></div>
      <button type="button" class="btn-primary" id="re-add-coach-btn">${t("common.add")}</button>
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
      showToast(t("rakes.toast.updated"), "success");
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
      showToast(t("rakes.toast.positionsUpdated"), "success");
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
    if (!coach_number || !coach_type) { errEl.textContent = t("rakes.error.coachNumberTypeRequired"); return; }
    try {
      await apiFetch("/admin/coaches", {
        method: "POST",
        body: JSON.stringify({ coach_number, coach_type, rake_id: id, position }),
      });
      showToast(t("rakes.toast.coachAdded"), "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      await loadRakes();
      editRake(id); // re-open with the fresh coach list
    } catch (err) { errEl.textContent = err.message; }
  });
}
window.editRake = editRake;

async function deleteRake(id) {
  if (!confirm(t("rakes.confirmDelete"))) return;
  try {
    await apiFetch(`/rakes/${id}`, { method: "DELETE" });
    showToast(t("rakes.toast.deleted"), "success");
    loadRakes();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteRake = deleteRake;

document.getElementById("add-rake-btn").addEventListener("click", () => {
  openModal(`
    <h3>${t("rakes.modal.addTitle")}</h3>
    <form id="rake-form">
      <label>${t("rakes.modal.rakeName")}</label><input type="text" id="rake-name" required placeholder="${t("rakes.modal.egRakeName")}" />
      <label>${t("rakes.modal.rakeType")}</label>
      <select id="rake-type"><option value="LHB">LHB</option><option value="Vande Bharat">Vande Bharat</option></select>
      <label>${t("rakes.modal.zone")}</label><input type="text" id="rake-zone" placeholder="${t("rakes.modal.egZone")}" />
      <label>${t("rakes.modal.depot")}</label><input type="text" id="rake-depot" placeholder="${t("rakes.modal.egDepot")}" />
      <label>${t("rakes.modal.totalCoaches")}</label>
      <input type="number" id="rake-total-coaches" min="1" max="24" value="2" />
      <div id="rake-coach-slots" style="margin-top:0.6rem;"></div>
      <p class="modal-error" id="rake-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("rakes.modal.createRake")}</button>
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
          <td style="padding:0.3rem 0.5rem;font-weight:700;">${t("rakes.modal.position")} ${pos}</td>
          <td style="padding:0.3rem 0.5rem;"><input type="text" class="slot-coach-number" placeholder="${t("rakes.modal.coachNumber")} ${t("rakes.modal.egCoachNumber")}" value="${prev.coach_number}" required style="width:100%;" /></td>
          <td style="padding:0.3rem 0.5rem;"><input type="text" class="slot-coach-type" placeholder="${t("rakes.modal.coachType")} ${t("rakes.modal.egCoachType")}" value="${prev.coach_type}" required style="width:100%;" /></td>
        </tr>
      `;
    }
    container.innerHTML = `<table class="table"><thead><tr><th>${t("rakes.modal.position")}</th><th>${t("rakes.modal.coachNumber")}</th><th>${t("rakes.modal.coachType")}</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
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
      showToast(t("rakes.toast.created", { n: coaches.length }), "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadRakes();
    } catch (err) { document.getElementById("rake-form-error").textContent = err.message; }
  });
});

document.getElementById("swap-coach-btn").addEventListener("click", () => {
  const coachOptions = COACHES.map((c) => `<option value="${c.id}">${c.coach_number} (${t("rakes.swap.currentlyIn", { rake: c.rake_name })})</option>`).join("");
  const rakeOptions = RAKES.map((r) => `<option value="${r.id}">${r.rake_name} (${r.rake_type})</option>`).join("");
  openModal(`
    <h3>${t("rakes.modal.swapTitle")}</h3>
    <form id="swap-form">
      <label>${t("rakes.modal.coach")}</label><select id="swap-coach">${coachOptions}</select>
      <label>${t("rakes.modal.moveToRake")}</label><select id="swap-rake">${rakeOptions}</select>
      <label>${t("rakes.modal.reasonOptional")}</label><input type="text" id="swap-reason" placeholder="${t("rakes.modal.egReason")}" />
      <p class="modal-error" id="swap-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("rakes.btn.swapCoach")}</button>
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
      showToast(t("rakes.toast.swapped"), "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadRakes();
    } catch (err) { document.getElementById("swap-form-error").textContent = err.message; }
  });
});

// ================= ADMIN =================
async function loadAdmin() {
  if (USER.role !== "Admin") {
    document.getElementById("view-admin").innerHTML = `<div class="card"><p>${t("admin.noPermission")}</p></div>`;
    return;
  }
  await loadAdminUsers();
  await loadAdminThresholds();
  await loadAdminNotifications();
  await loadAdminSecurity();
}

async function loadCoachManagement() {
  await loadAdminCoaches();
}

function coachCheckboxListHtml(selectedIds) {
  const selected = new Set((selectedIds || []).map(Number));
  return `<div class="coach-checkbox-list">${COACHES.map((c) => `
    <label><input type="checkbox" class="coach-assign-cb" value="${c.id}" ${selected.has(c.id) ? "checked" : ""} /> ${c.coach_number} — ${c.coach_type} (${c.rake_name})</label>
  `).join("") || `<span class="muted">${t("admin.users.table.noCoachesExist")}</span>`}</div>`;
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
      <td>${t("role." + u.role)}</td>
      <td>${u.email || '<span class="muted">-</span>'}</td>
      <td>${u.phone || '<span class="muted">-</span>'}</td>
      <td>${u.role === "Admin" ? `<span class="muted">${t("admin.users.allCoaches")}</span>` : (u.assigned_coaches.length ? u.assigned_coaches.length + " " + t("rakes.coachCount") : `<span class="muted">${t("admin.users.none")}</span>`)}</td>
      <td>
        <button class="btn-small" onclick="editUser(${u.id})">${t("common.edit")}</button>
        <button class="btn-danger" onclick="deleteUser(${u.id})">${t("common.delete")}</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("add-user-btn").addEventListener("click", () => {
  openModal(`
    <h3>${t("admin.users.modal.addTitle")}</h3>
    <form id="user-form">
      <label>${t("admin.users.table.username")}</label><input type="text" id="u-username" required />
      <label>${t("admin.users.modal.fullName")}</label><input type="text" id="u-name" required />
      <label>${t("admin.users.modal.password")}</label><input type="password" id="u-password" required minlength="6" />
      <label>${t("admin.users.modal.email")}</label><input type="email" id="u-email" placeholder="user@example.com" />
      <label>${t("admin.users.modal.phone")}</label><input type="text" id="u-phone" placeholder="+91XXXXXXXXXX" />
      <label>${t("admin.users.modal.role")}</label>
      <select id="u-role"><option value="Viewer">${t("role.Viewer")}</option><option value="Supervisor">${t("role.Supervisor")}</option><option value="Admin">${t("role.Admin")}</option></select>
      <label>${t("admin.users.modal.assignedCoaches")}</label>
      ${coachCheckboxListHtml([])}
      <p class="modal-error" id="user-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("admin.users.modal.createBtn")}</button>
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
      showToast(t("admin.users.toast.created"), "success");
      loadAdminUsers();
    } catch (err) { document.getElementById("user-form-error").textContent = err.message; }
  });
});

async function editUser(id) {
  const users = await apiFetch("/admin/users");
  const u = users.find((x) => x.id === id);
  if (!u) return;
  openModal(`
    <h3>${t("admin.users.modal.editTitle", { username: u.username })}</h3>
    <form id="user-edit-form">
      <label>${t("admin.users.modal.fullName")}</label><input type="text" id="ue-name" value="${u.name}" required />
      <label>${t("admin.users.modal.email")}</label><input type="email" id="ue-email" value="${u.email || ""}" placeholder="user@example.com" />
      <label>${t("admin.users.modal.phone")}</label><input type="text" id="ue-phone" value="${u.phone || ""}" placeholder="+91XXXXXXXXXX" />
      <label>${t("admin.users.modal.role")}</label>
      <select id="ue-role">
        <option value="Viewer" ${u.role === "Viewer" ? "selected" : ""}>${t("role.Viewer")}</option>
        <option value="Supervisor" ${u.role === "Supervisor" ? "selected" : ""}>${t("role.Supervisor")}</option>
        <option value="Admin" ${u.role === "Admin" ? "selected" : ""}>${t("role.Admin")}</option>
      </select>
      <label>${t("admin.users.modal.newPassword")}</label><input type="password" id="ue-password" minlength="6" />
      <label>${t("admin.users.modal.assignedCoaches")}</label>
      ${coachCheckboxListHtml(u.assigned_coaches)}
      <label>DSC Certificate (PEM) ${u.has_dsc_certificate ? '<span class="muted">— currently on file</span>' : ""}</label>
      <textarea id="ue-dsc-pem" rows="4" placeholder="Paste the user's DSC token's public certificate, -----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----"></textarea>
      <div class="report-actions" style="margin:0.3rem 0 0.6rem;">
        <button type="button" class="btn-secondary" id="ue-dsc-upload-btn">Upload DSC Certificate</button>
        ${u.has_dsc_certificate ? '<button type="button" class="btn-danger" id="ue-dsc-remove-btn">Remove DSC Certificate</button>' : ""}
      </div>
      <p class="modal-error" id="user-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("common.saveChanges")}</button>
      </div>
    </form>
  `);
  document.getElementById("ue-dsc-upload-btn").addEventListener("click", async () => {
    const cert_pem = document.getElementById("ue-dsc-pem").value.trim();
    if (!cert_pem) { document.getElementById("user-edit-error").textContent = "Paste the certificate PEM text first."; return; }
    try {
      await apiFetch(`/admin/users/${id}/dsc-certificate`, { method: "PUT", body: JSON.stringify({ cert_pem }) });
      showToast("DSC certificate uploaded", "success");
      closeModal();
      editUser(id);
    } catch (err) { document.getElementById("user-edit-error").textContent = err.message; }
  });
  const removeBtn = document.getElementById("ue-dsc-remove-btn");
  if (removeBtn) removeBtn.addEventListener("click", async () => {
    try {
      await apiFetch(`/admin/users/${id}/dsc-certificate`, { method: "DELETE" });
      showToast("DSC certificate removed", "success");
      closeModal();
      editUser(id);
    } catch (err) { document.getElementById("user-edit-error").textContent = err.message; }
  });
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
      showToast(t("admin.users.toast.updated"), "success");
      loadAdminUsers();
    } catch (err) { document.getElementById("user-edit-error").textContent = err.message; }
  });
}
window.editUser = editUser;

async function deleteUser(id) {
  if (!confirm(t("admin.users.confirmDelete"))) return;
  try {
    await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
    showToast(t("admin.users.toast.deleted"), "success");
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
      <td>${t("admin.coaches.status." + c.status) }</td>
      <td>
        ${USER.role !== "Viewer" ? `<button class="btn-small" onclick="editCoach(${c.id})">${t("common.edit")}</button>` : ""}
        ${USER.role === "Admin" ? `<button class="btn-danger" onclick="deleteCoach(${c.id})">${t("common.delete")}</button>` : ""}
      </td>
    </tr>
  `).join("");
}

document.getElementById("add-coach-btn").addEventListener("click", async () => {
  const rakes = await apiFetch("/rakes");
  const rakeOptions = rakes.map((r) => `<option value="${r.id}">${r.rake_name} (${r.rake_type})</option>`).join("");
  openModal(`
    <h3>${t("admin.coaches.modal.addTitle")}</h3>
    <form id="coach-form">
      <label>${t("admin.coaches.modal.coachNumber")}</label><input type="text" id="c-number" required placeholder="${t("rakes.modal.egCoachNumber")}" />
      <label>${t("admin.coaches.modal.rake")}</label><select id="c-rake">${rakeOptions}</select>
      <label>${t("admin.coaches.modal.coachType")}</label><input type="text" id="c-type" required placeholder="${t("rakes.modal.egCoachType")}" />
      <p class="modal-error" id="coach-form-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("admin.coaches.modal.createBtn")}</button>
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
      showToast(t("admin.coaches.toast.created"), "success");
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
    <h3>${t("admin.coaches.modal.editTitle", { number: c.coach_number })}</h3>
    <form id="coach-edit-form">
      <label>${t("admin.coaches.modal.coachType")}</label><input type="text" id="ce-type" value="${c.coach_type}" required />
      <label>${t("admin.coaches.modal.status")}</label>
      <select id="ce-status">
        <option value="Active" ${c.status === "Active" ? "selected" : ""}>${t("admin.coaches.status.Active")}</option>
        <option value="Maintenance" ${c.status === "Maintenance" ? "selected" : ""}>${t("admin.coaches.status.Maintenance")}</option>
        <option value="Withdrawn" ${c.status === "Withdrawn" ? "selected" : ""}>${t("admin.coaches.status.Withdrawn")}</option>
      </select>
      <label>Monthly Bill Amount (₹) — used for Part C Clause 10 penalty calc</label>
      <input type="number" id="ce-bill" min="0" step="1" value="${c.monthly_bill_amount || 0}" />
      <p class="modal-error" id="coach-edit-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("common.saveChanges")}</button>
      </div>
    </form>
  `);
  document.getElementById("coach-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/admin/coaches/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          coach_type: document.getElementById("ce-type").value.trim(),
          status: document.getElementById("ce-status").value,
          monthly_bill_amount: Number(document.getElementById("ce-bill").value) || 0,
        }),
      });
      closeModal();
      showToast(t("admin.coaches.toast.updated"), "success");
      COACHES = await apiFetch("/coaches");
      populateCoachSelectors();
      loadAdminCoaches();
    } catch (err) { document.getElementById("coach-edit-error").textContent = err.message; }
  });
}
window.editCoach = editCoach;

async function deleteCoach(id) {
  if (!confirm(t("admin.coaches.confirmDelete"))) return;
  try {
    await apiFetch(`/admin/coaches/${id}`, { method: "DELETE" });
    showToast(t("admin.coaches.toast.deleted"), "success");
    COACHES = await apiFetch("/coaches");
    populateCoachSelectors();
    loadAdminCoaches();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteCoach = deleteCoach;

// ---- Alert Thresholds + Log Interval (combined) ----
async function loadAdminThresholds() {
  const th = await apiFetch("/admin/thresholds");
  document.getElementById("th-vib-yellow").value = th.vibration.yellow;
  document.getElementById("th-vib-orange").value = th.vibration.orange;
  document.getElementById("th-vib-red").value = th.vibration.red;
  document.getElementById("th-temp-yellow").value = th.temperature.yellow;
  document.getElementById("th-temp-orange").value = th.temperature.orange;
  document.getElementById("th-temp-red").value = th.temperature.red;
  document.getElementById("log-interval-input").value = th.log_interval_seconds;
  if (th.wheel_defect_impact_factor) {
    document.getElementById("th-wheel-yellow").value = th.wheel_defect_impact_factor.yellow;
    document.getElementById("th-wheel-orange").value = th.wheel_defect_impact_factor.orange;
    document.getElementById("th-wheel-red").value = th.wheel_defect_impact_factor.red;
  }
  try {
    const sec = await apiFetch("/admin/security");
    document.getElementById("th-sensor-stale").value = sec.sensor_stale_minutes;
    document.getElementById("th-downtime-threshold").value = sec.downtime_threshold_minutes;
  } catch (err) { /* Supervisor role can't read /admin/security — thresholds tab still works */ }
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
        wheel_defect_impact_factor: {
          yellow: Number(document.getElementById("th-wheel-yellow").value),
          orange: Number(document.getElementById("th-wheel-orange").value),
          red: Number(document.getElementById("th-wheel-red").value),
        },
        log_interval_seconds: Number(document.getElementById("log-interval-input").value),
      }),
    });
    if (USER.role === "Admin") {
      await apiFetch("/admin/security", {
        method: "PUT",
        body: JSON.stringify({
          sensor_stale_minutes: Number(document.getElementById("th-sensor-stale").value),
          downtime_threshold_minutes: Number(document.getElementById("th-downtime-threshold").value),
        }),
      });
    }
    showToast(t("admin.thresholds.toast.updated"), "success");
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
  document.getElementById("smtp-pass").placeholder = n.smtp.pass ? t("admin.notifications.smtp.passUnchanged") : t("admin.notifications.smtp.passBlank");
  document.getElementById("smtp-from-name").value = n.smtp.from_name;
  document.getElementById("smtp-from-email").value = n.smtp.from_email;

  document.getElementById("sms-enabled").checked = n.sms.enabled;
  document.getElementById("sms-provider").value = n.sms.provider;
  document.getElementById("sms-api-key").value = "";
  document.getElementById("sms-api-key").placeholder = n.sms.api_key ? t("admin.notifications.smtp.passUnchanged") : t("admin.notifications.smtp.passBlank");
  document.getElementById("sms-sender-id").value = n.sms.sender_id;
  document.getElementById("sms-method").value = n.sms.method || "POST";
  document.getElementById("sms-url").value = n.sms.url || "";
  document.getElementById("sms-headers").value = n.sms.headers || "";
  document.getElementById("sms-body-template").value = n.sms.body_template || "";
}

document.getElementById("daily-report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({ daily_report_time: document.getElementById("daily-report-time-input").value }),
    });
    showToast(t("admin.notifications.toast.dailyReportUpdated"), "success");
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
    showToast(t("admin.notifications.smtp.toastSaved"), "success");
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
          method: document.getElementById("sms-method").value,
          url: document.getElementById("sms-url").value.trim(),
          headers: document.getElementById("sms-headers").value.trim(),
          body_template: document.getElementById("sms-body-template").value.trim(),
        },
      }),
    });
    showToast(t("admin.notifications.sms.toastSaved"), "success");
    loadAdminNotifications();
  } catch (err) { showToast(err.message, "error"); }
});

document.getElementById("send-test-sms-btn").addEventListener("click", async () => {
  const to = document.getElementById("test-sms-to").value.trim();
  const resultEl = document.getElementById("test-sms-result");
  if (!to) { resultEl.style.color = "var(--red)"; resultEl.textContent = "Enter a recipient phone number first."; return; }
  resultEl.textContent = "Sending...";
  resultEl.style.color = "";
  try {
    const log = await apiFetch("/admin/notifications/test-sms", { method: "POST", body: JSON.stringify({ to }) });
    if (log.status === "sent") { resultEl.style.color = "var(--green)"; resultEl.textContent = "Test SMS sent successfully."; }
    else if (log.status === "simulated") { resultEl.style.color = "var(--orange)"; resultEl.textContent = "Not actually sent — " + log.detail; }
    else { resultEl.style.color = "var(--red)"; resultEl.textContent = "Failed: " + log.detail; }
  } catch (err) { resultEl.style.color = "var(--red)"; resultEl.textContent = err.message; }
});

document.getElementById("send-test-email-btn").addEventListener("click", async () => {
  const to = document.getElementById("test-email-to").value.trim();
  const resultEl = document.getElementById("test-email-result");
  if (!to) { resultEl.style.color = "var(--red)"; resultEl.textContent = t("admin.notifications.smtp.enterRecipient"); return; }
  resultEl.textContent = t("admin.notifications.smtp.sending");
  resultEl.style.color = "";
  try {
    const log = await apiFetch("/admin/notifications/test-email", { method: "POST", body: JSON.stringify({ to }) });
    if (log.status === "sent") { resultEl.style.color = "var(--green)"; resultEl.textContent = t("admin.notifications.smtp.testSentSuccess"); }
    else if (log.status === "simulated") { resultEl.style.color = "var(--orange)"; resultEl.textContent = t("admin.notifications.smtp.notSent", { detail: log.detail }); }
    else { resultEl.style.color = "var(--red)"; resultEl.textContent = t("admin.notifications.smtp.failed", { detail: log.detail }); }
  } catch (err) { resultEl.style.color = "var(--red)"; resultEl.textContent = err.message; }
});

// ---------------- Admin: Security (MFA) + Audit Log ----------------
async function loadAdminSecurity() {
  try {
    const sec = await apiFetch("/admin/security");
    document.getElementById("mfa-required").checked = !!sec.mfa_required;
    document.getElementById("dsc-required").checked = !!sec.dsc_required;
  } catch (err) { /* non-fatal — panel just stays at defaults */ }
}

document.getElementById("security-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("security-error");
  errEl.textContent = "";
  try {
    await apiFetch("/admin/security", {
      method: "PUT",
      body: JSON.stringify({
        mfa_required: document.getElementById("mfa-required").checked,
        dsc_required: document.getElementById("dsc-required").checked,
      }),
    });
    showToast(t("common.saveChanges") || "Saved", "success");
  } catch (err) { errEl.textContent = err.message; }
});

document.getElementById("view-audit-log-btn").addEventListener("click", async () => {
  try {
    const log = await apiFetch("/admin/audit-log?limit=100");
    const rows = log.map((a) => `
      <tr>
        <td>${new Date(a.ts).toLocaleString()}</td>
        <td>${a.actor_username}</td>
        <td>${a.action}</td>
        <td><code style="font-size:0.8em;">${escapeHtml(JSON.stringify(a.details || {}))}</code></td>
      </tr>`).join("");
    openModal(`
      <h3>${t("admin.security.auditLogTitle") || "Audit Log"}</h3>
      <div style="max-height:60vh;overflow:auto;">
        <table class="table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">${t("common.na")}</td></tr>`}</tbody>
        </table>
      </div>
    `);
  } catch (err) { showToast(err.message, "error"); }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ================= SETTINGS =================
async function loadSettings() {
  try {
    const [devices, log] = await Promise.all([
      apiFetch("/settings/rut-devices"),
      apiFetch("/settings/rut-reassign-log"),
    ]);
    renderRutDevicesTable(devices);
    renderRutReassignLog(log);
  } catch (err) { console.error(err); }
}

document.getElementById("clear-simulated-data-btn").addEventListener("click", async () => {
  if (!confirm(t("settings.dataSource.confirmClear"))) return;
  try {
    await apiFetch("/settings/reset-sensor-data", { method: "POST" });
    showToast(t("settings.dataSource.toastCleared"), "success");
    loadSettings();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Builds a searchable coach picker (typing + dropdown, matching the pattern used everywhere
// else in the dashboard) for use inside a modal. Returns the HTML; call readCoachPickerValue()
// on submit to get the selected coach id (or "" for none).
function coachPickerHtml(idPrefix, includeNoneOption) {
  const datalist = COACHES.map((c) => `<option value="${c.coach_number}">`).join("");
  const options = (includeNoneOption ? `<option value="">${t("common.na")}</option>` : "") +
    COACHES.map((c) => `<option value="${c.id}">${c.coach_number} — ${c.coach_type} (${c.rake_name})</option>`).join("");
  return `
    <input type="text" id="${idPrefix}-search" data-i18n-placeholder="common.typeCoachNumber" placeholder="${t("common.typeCoachNumber")}" list="${idPrefix}-datalist" style="margin-bottom:0.4rem;" />
    <datalist id="${idPrefix}-datalist">${datalist}</datalist>
    <select id="${idPrefix}-select">${options}</select>
  `;
}

function wireCoachPicker(idPrefix) {
  const search = document.getElementById(`${idPrefix}-search`);
  const select = document.getElementById(`${idPrefix}-select`);
  search.addEventListener("change", () => {
    const match = COACHES.find((c) => c.coach_number === search.value.trim());
    if (match) select.value = match.id;
  });
  select.addEventListener("change", () => {
    const coach = COACHES.find((c) => c.id === Number(select.value));
    search.value = coach ? coach.coach_number : "";
  });
}

function readCoachPickerValue(idPrefix) {
  return document.getElementById(`${idPrefix}-select`).value;
}

function renderRutDevicesTable(devices) {
  const tbody = document.getElementById("rut-devices-table-body");
  tbody.innerHTML = devices.map((d) => `
    <tr data-device-id="${d.id}">
      <td><b>${d.label}</b></td>
      <td>
        <div class="device-key-cell">
          <span class="device-key-value">${d.device_key}</span>
          <button class="btn-small" type="button" onclick="copyDeviceKey('${d.device_key}')">${t("settings.rut.copyBtn")}</button>
        </div>
      </td>
      <td>${d.current_coach_number || `<span class="muted">${t("settings.rut.unassigned")}</span>`}</td>
      <td>${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : t("settings.rut.neverSeen")}</td>
      <td>
        <button class="btn-small" type="button" onclick="openReassignRutModal(${d.id})">${t("settings.rut.reassignBtn")}</button>
        <button class="btn-danger" type="button" onclick="deleteRutDevice(${d.id})">${t("common.delete")}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="color:#5b6b7f;">${t("settings.rut.noDevices")}</td></tr>`;
}

function renderRutReassignLog(log) {
  document.getElementById("rut-reassign-log-body").innerHTML = log.map((l) => `
    <tr>
      <td>${new Date(l.reassigned_at).toLocaleString()}</td>
      <td>${l.device_label}</td>
      <td>${l.from_coach_number || "-"}</td>
      <td>${l.to_coach_number || t("settings.rut.unassigned")}</td>
      <td>${l.reason}</td>
      <td>${l.reassigned_by}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="color:#5b6b7f;">${t("settings.rut.noLog")}</td></tr>`;
}

function copyDeviceKey(key) {
  navigator.clipboard.writeText(key).then(() => showToast(t("settings.rut.copied"), "success"));
}
window.copyDeviceKey = copyDeviceKey;

document.getElementById("add-rut-device-btn").addEventListener("click", () => {
  openModal(`
    <h3>${t("settings.rut.modal.registerTitle")}</h3>
    <form id="rut-register-form">
      <label>${t("settings.rut.modal.label")}</label>
      <input type="text" id="rut-label" required placeholder="${t("settings.rut.modal.egLabel")}" />
      <label>${t("settings.rut.modal.initialCoach")}</label>
      ${coachPickerHtml("rut-reg-coach", true)}
      <p class="modal-error" id="rut-register-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("settings.rut.modal.registerBtn")}</button>
      </div>
    </form>
  `);
  wireCoachPicker("rut-reg-coach");
  document.getElementById("rut-register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const device = await apiFetch("/settings/rut-devices", {
        method: "POST",
        body: JSON.stringify({
          label: document.getElementById("rut-label").value.trim(),
          coach_id: readCoachPickerValue("rut-reg-coach") || null,
        }),
      });
      showToast(t("settings.rut.toastRegistered"), "success");
      loadSettings();
      openModal(`
        <h3>${t("settings.rut.modal.keyRevealTitle")}</h3>
        <p class="muted">${t("settings.rut.modal.keyRevealNote")}</p>
        <div class="device-key-cell" style="margin:0.8rem 0;">
          <span class="device-key-value" style="font-size:0.95rem;">${device.device_key}</span>
          <button class="btn-small" type="button" onclick="copyDeviceKey('${device.device_key}')">${t("settings.rut.copyBtn")}</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-primary" onclick="closeModal()">${t("common.close")}</button>
        </div>
      `);
    } catch (err) { document.getElementById("rut-register-error").textContent = err.message; }
  });
});

async function openReassignRutModal(deviceId) {
  const devices = await apiFetch("/settings/rut-devices");
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return;
  openModal(`
    <h3>${t("settings.rut.modal.reassignTitle", { label: device.label })}</h3>
    <form id="rut-reassign-form">
      <label>${t("settings.rut.modal.newCoach")}</label>
      ${coachPickerHtml("rut-reassign-coach", true)}
      <label>${t("rakes.modal.reasonOptional")}</label>
      <input type="text" id="rut-reassign-reason" placeholder="${t("rakes.modal.egReason")}" />
      <p class="modal-error" id="rut-reassign-error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
        <button type="submit" class="btn-primary">${t("settings.rut.modal.reassignBtnSubmit")}</button>
      </div>
    </form>
  `);
  wireCoachPicker("rut-reassign-coach");
  if (device.current_coach_id) document.getElementById("rut-reassign-coach-select").value = device.current_coach_id;
  document.getElementById("rut-reassign-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/settings/rut-devices/${deviceId}/reassign`, {
        method: "PUT",
        body: JSON.stringify({
          to_coach_id: readCoachPickerValue("rut-reassign-coach") || null,
          reason: document.getElementById("rut-reassign-reason").value.trim(),
        }),
      });
      closeModal();
      showToast(t("settings.rut.toastReassigned"), "success");
      loadSettings();
    } catch (err) { document.getElementById("rut-reassign-error").textContent = err.message; }
  });
}
window.openReassignRutModal = openReassignRutModal;

async function deleteRutDevice(deviceId) {
  if (!confirm(t("settings.rut.confirmDelete"))) return;
  try {
    await apiFetch(`/settings/rut-devices/${deviceId}`, { method: "DELETE" });
    showToast(t("settings.rut.toastDeleted"), "success");
    loadSettings();
  } catch (err) { showToast(err.message, "error"); }
}
window.deleteRutDevice = deleteRutDevice;

// ---------------- Init ----------------
if (TOKEN && USER) {
  boot();
}
