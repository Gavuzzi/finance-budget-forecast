let trendChart;
let currentLens = "fy"; // "fy" | "rolling"

const THEME_COLORS = {
  dark: { text: "#93a1b8", grid: "#28344a", budget: "#7aa3e0", actual: "#5cb88a", forecast: "#d9a647" },
  light: { text: "#647189", grid: "#dde4ee", budget: "#3461a8", actual: "#2f9e6a", forecast: "#b6841f" },
};

function companyMonthlyBudget(month) {
  if (month < 1 || month > FY_MONTHS) return null;
  return COST_CENTERS.reduce((s, cc) => s + monthlyBudgetFor(cc, month), 0);
}

function lensMonthRange() {
  if (currentLens === "rolling") {
    const { start, end } = rollingWindow();
    const months = [];
    for (let m = start; m <= end; m++) months.push(m);
    return months;
  }
  const months = [];
  for (let m = 1; m <= FY_MONTHS; m++) months.push(m);
  return months;
}

function renderStats() {
  const statsRow = document.getElementById("statsRow");

  if (currentLens === "fy") {
    const fy = companyFySummary();
    let bookedActual = 0;
    for (let m = 1; m <= CLOSE_MONTH; m++) bookedActual += companyMonthAmount(m);
    const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
    const cls = varianceClass(fy.variance, fy.budget);

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Annual Budget (FY2026)</span>
        <span class="stat-value">${fmtMkr(fy.budget)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Booked Actuals</span>
        <span class="stat-value">${fmtMkr(bookedActual)}</span>
        <span class="stat-sub">through ${monthLabel(CLOSE_MONTH)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Full-Year Total</span>
        <span class="stat-value">${fmtMkr(fy.total)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Variance vs Budget</span>
        <span class="stat-value ${cls}">${fmtMkrSigned(fy.variance)}</span>
        <span class="stat-sub ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
      </div>
    `;
  } else {
    const { start, end } = rollingWindow();
    const rolling = companyRollingSummary();
    const monthsBeyondBudget = lensMonthRange().filter((m) => m > FY_MONTHS).length;

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Rolling 12 Total</span>
        <span class="stat-value">${fmtMkr(rolling.total)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Window</span>
        <span class="stat-value small">${monthLabel(start)} – ${monthLabel(end)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Avg Monthly Run-Rate</span>
        <span class="stat-value">${fmtMkr(rolling.total / 12)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Months Without FY Budget</span>
        <span class="stat-value">${monthsBeyondBudget}</span>
        <span class="stat-sub">next year's budget isn't set yet</span>
      </div>
    `;
  }
}

function renderTable() {
  const table = document.getElementById("budgetTable");

  if (currentLens === "fy") {
    let html = `
      <div class="budget-row header">
        <span class="cc-name">Cost Center</span>
        <span class="num">Budget</span>
        <span class="num">FY2026 Total</span>
        <span class="num">Variance</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const fy = fySummary(cc);
      const cls = varianceClass(fy.variance, fy.budget);
      const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;

      html += `
        <div class="budget-row">
          <span class="cc-name">${cc.name}${cc.note ? `<span class="cc-note">${cc.note}</span>` : ""}</span>
          <span class="num" data-label="Budget">${fmtMkr(fy.budget)}</span>
          <span class="num" data-label="FY2026 Total">${fmtMkr(fy.total)}</span>
          <span class="variance-cell ${cls}" data-label="Variance">
            ${fmtMkrSigned(fy.variance)}
            <span class="variance-pill ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
          </span>
        </div>
      `;
    }

    const t = companyFySummary();
    const totalCls = varianceClass(t.variance, t.budget);
    const totalPct = t.budget ? (t.variance / t.budget) * 100 : 0;
    html += `
      <div class="budget-row total">
        <span class="cc-name">Total</span>
        <span class="num" data-label="Budget">${fmtMkr(t.budget)}</span>
        <span class="num" data-label="FY2026 Total">${fmtMkr(t.total)}</span>
        <span class="variance-cell ${totalCls}" data-label="Variance">
          ${fmtMkrSigned(t.variance)}
          <span class="variance-pill ${totalCls}">${totalPct > 0 ? "+" : ""}${totalPct.toFixed(1)}%</span>
        </span>
      </div>
    `;
    table.innerHTML = html;
  } else {
    let html = `
      <div class="budget-row header rolling">
        <span class="cc-name">Cost Center</span>
        <span class="num">Rolling 12 Total</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const r = rollingSummary(cc);
      html += `
        <div class="budget-row rolling">
          <span class="cc-name">${cc.name}${cc.note ? `<span class="cc-note">${cc.note}</span>` : ""}</span>
          <span class="num" data-label="Rolling 12 Total">${fmtMkr(r.total)}</span>
        </div>
      `;
    }

    const t = companyRollingSummary();
    html += `
      <div class="budget-row total rolling">
        <span class="cc-name">Total</span>
        <span class="num" data-label="Rolling 12 Total">${fmtMkr(t.total)}</span>
      </div>
    `;
    table.innerHTML = html;
  }
}

function renderChart() {
  const colors = THEME_COLORS[getTheme()];
  const months = lensMonthRange();
  const labels = months.map(monthLabel);

  const budgetSeries = months.map((m) => companyMonthlyBudget(m));
  const actualSeries = months.map((m) => (m <= CLOSE_MONTH ? companyMonthAmount(m) : null));
  const forecastSeries = months.map((m, i) => {
    if (m === CLOSE_MONTH) return companyMonthAmount(m); // connect at the seam
    return m > CLOSE_MONTH ? companyMonthAmount(m) : null;
  });

  document.getElementById("chartTitle").textContent =
    currentLens === "fy" ? "Spend — Budget vs Actual vs Forecast (FY2026)" : "Spend — Rolling 12 Months (Actual + Forecast)";

  const ctx = document.getElementById("trendChart");
  const datasets = [
    {
      label: "Budget",
      data: budgetSeries,
      borderColor: colors.budget,
      borderDash: [4, 4],
      backgroundColor: "transparent",
      tension: 0.2,
      pointRadius: 0,
      spanGaps: false,
    },
    {
      label: "Actual",
      data: actualSeries,
      borderColor: colors.actual,
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 3,
    },
    {
      label: "Forecast",
      data: forecastSeries,
      borderColor: colors.forecast,
      borderDash: [6, 3],
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 3,
    },
  ];

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: colors.text } } },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: {
          ticks: { color: colors.text, callback: (v) => fmtMkr(v) },
          grid: { color: colors.grid },
        },
      },
    },
  });
}

function onboardCardHtml() {
  return `
    <div class="onboard-card">
      <button class="onboard-close" id="onboardClose" type="button" title="Dismiss">✕</button>
      <h2>How this works</h2>
      <p>Your budget and forecast are <strong>built from drivers</strong> — your people and known costs — not typed in cell by cell. Change a driver once and every number here updates. You never re-key figures like in a spreadsheet.</p>
      <div class="onboard-tabs">
        <div><strong>Overview</strong> the whole picture — budget vs. actual vs. forecast.</div>
        <div><strong>Monthly</strong> the same numbers, month by month.</div>
        <div><strong>Planning</strong> where you edit the drivers — headcount &amp; costs.</div>
        <div><strong>Assumptions</strong> set pay rates once; they flow everywhere.</div>
      </div>
    </div>`;
}

function renderOnboard() {
  const slot = document.getElementById("onboardSlot");
  if (!slot) return;

  if (localStorage.getItem("almgren-onboard-dismissed") === "true") {
    slot.innerHTML = `<button class="onboard-link" id="onboardOpen" type="button">How this works ▾</button>`;
    document.getElementById("onboardOpen").addEventListener("click", () => {
      localStorage.removeItem("almgren-onboard-dismissed");
      renderOnboard();
    });
    return;
  }

  slot.innerHTML = onboardCardHtml();
  document.getElementById("onboardClose").addEventListener("click", () => {
    localStorage.setItem("almgren-onboard-dismissed", "true");
    renderOnboard();
  });
}

// Total people cost per role across all cost centers, for the fiscal year.
function roleFyTotals() {
  const totals = {};
  COST_CENTERS.forEach((cc) => {
    cc.headcount.forEach((h) => {
      const activeFy = Math.max(0, Math.min(h.endMonth, FY_MONTHS) - Math.max(h.startMonth, 1) + 1);
      const cost = h.count * monthlyCostForRole(h.roleId) * activeFy;
      const role = getRole(h.roleId);
      if (!totals[h.roleId]) totals[h.roleId] = { label: role ? role.label : "—", count: 0, cost: 0 };
      totals[h.roleId].count += h.count;
      totals[h.roleId].cost += cost;
    });
  });
  return Object.values(totals).sort((a, b) => b.cost - a.cost);
}

function renderRoleBreakdown() {
  const el = document.getElementById("roleBreakdown");
  if (!el) return;
  const rows = roleFyTotals();

  if (rows.length === 0) {
    el.innerHTML = `<p class="empty-hint">No headcount yet — add some on the Planning page.</p>`;
    return;
  }

  const total = rows.reduce((s, r) => s + r.cost, 0);
  let html = `<div class="rb-row rb-head"><span>Role</span><span class="num">Headcount</span><span class="num">FY people cost</span><span class="num">Share</span></div>`;
  rows.forEach((r) => {
    const pct = total ? (r.cost / total) * 100 : 0;
    html += `<div class="rb-row"><span>${r.label}</span><span class="num">${r.count}</span><span class="num">${fmtMkr(r.cost)}</span><span class="num">${pct.toFixed(0)}%</span></div>`;
  });
  html += `<div class="rb-row rb-total"><span>Total people cost</span><span class="num"></span><span class="num">${fmtMkr(total)}</span><span class="num">100%</span></div>`;
  el.innerHTML = html;
}

function renderScenarioDetail(s, currentByName) {
  const names = [...new Set([...(s.breakdown || []).map((b) => b.name), ...Object.keys(currentByName)])];
  let rows = "";
  names.forEach((name) => {
    const scen = ((s.breakdown || []).find((b) => b.name === name) || {}).total;
    const cur = currentByName[name];
    const d = (scen ?? 0) - (cur ?? 0);
    const cls = d > 0 ? "over" : d < 0 ? "under" : "neutral";
    rows += `
      <div class="scen-detail-row">
        <span>${name}</span>
        <span class="num">${scen != null ? fmtMkr(scen) : "—"}</span>
        <span class="num">${cur != null ? fmtMkr(cur) : "—"}</span>
        <span class="num ${cls}">${scen != null && cur != null ? fmtMkrSigned(d) : ""}</span>
      </div>`;
  });
  return `<div class="scen-detail-head"><span>Cost center</span><span class="num">Scenario</span><span class="num">Current</span><span class="num">Δ</span></div>${rows}`;
}

function renderScenarios() {
  const listEl = document.getElementById("scenarioList");
  const currentTotal = companyFySummary().total;
  const currentByName = {};
  COST_CENTERS.forEach((cc) => { currentByName[cc.name] = fySummary(cc).total; });

  let html = `
    <div class="scenario-row current">
      <span>Current plan (live)</span>
      <span class="num">${fmtMkr(currentTotal)}</span>
      <span class="num"></span>
      <span></span>
    </div>`;

  if (SCENARIOS.length === 0) {
    html += `<p class="empty-hint">No saved scenarios yet — snapshot the current plan to start comparing.</p>`;
  } else {
    SCENARIOS.forEach((s) => {
      const delta = s.fyTotal - currentTotal;
      const cls = delta > 0 ? "over" : delta < 0 ? "under" : "neutral";
      html += `
        <div class="scenario-row scenario-toggle" data-scen="${s.id}">
          <span>${s.name} <span class="scenario-caret">▾</span></span>
          <span class="num">${fmtMkr(s.fyTotal)}</span>
          <span class="num ${cls}">${fmtMkrSigned(delta)}</span>
          <button class="row-remove" data-delscen="${s.id}" title="Delete scenario">✕</button>
        </div>
        <div class="scenario-detail" data-detailscen="${s.id}" hidden>
          ${renderScenarioDetail(s, currentByName)}
        </div>`;
    });
  }

  listEl.innerHTML = html;
}

function initScenarios() {
  document.getElementById("saveScenarioBtn").addEventListener("click", async () => {
    const name = prompt("Name this scenario (e.g. Base, Hiring freeze):");
    if (!name || !name.trim()) return;
    const s = await dbSaveScenario(name.trim());
    if (!s) return;
    SCENARIOS.push(s);
    renderScenarios();
  });

  document.getElementById("scenarioList").addEventListener("click", async (e) => {
    const delBtn = e.target.closest("[data-delscen]");
    if (delBtn) {
      const id = delBtn.dataset.delscen;
      const s = SCENARIOS.find((x) => x.id === id);
      if (!confirm(`Delete scenario "${s ? s.name : ""}"?`)) return;
      if (!(await dbDeleteScenario(id))) return;
      const idx = SCENARIOS.findIndex((x) => x.id === id);
      if (idx > -1) SCENARIOS.splice(idx, 1);
      renderScenarios();
      return;
    }

    const toggle = e.target.closest(".scenario-toggle");
    if (toggle) {
      const detail = document.querySelector(`.scenario-detail[data-detailscen="${toggle.dataset.scen}"]`);
      if (detail) detail.hidden = !detail.hidden;
    }
  });
}

function renderAll() {
  const sections = document.querySelectorAll(".lens-controls, .stats-row, .main-row, .table-panel, .role-breakdown-panel, .scenarios-panel");
  let empty = document.getElementById("emptyState");

  if (COST_CENTERS.length === 0) {
    sections.forEach((el) => (el.style.display = "none"));
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "emptyState";
      document.querySelector(".app-main").appendChild(empty);
    }
    empty.innerHTML = emptyOrgHtml();
    empty.style.display = "";
    return;
  }

  sections.forEach((el) => (el.style.display = ""));
  if (empty) empty.style.display = "none";
  renderStats();
  renderTable();
  renderChart();
  renderRoleBreakdown();
  renderScenarios();
}

function initLensControls() {
  document.querySelectorAll(".lens-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentLens = btn.dataset.lens;
      document.querySelectorAll(".lens-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });
}

// Redraw the chart when the theme flips (the sidebar owns the toggle) and
// re-render everything when a month is closed from the sidebar.
window.onThemeChanged = () => {
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
    renderChart();
  }
};
window.refreshAfterPeriodChange = renderAll;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
function initPrint() {
  const orgName = (USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {}).name || "";
  const ph = document.getElementById("printHeader");
  if (ph) ph.textContent = `${orgName} — Budget & Forecast FY2026 — printed ${new Date().toLocaleDateString("sv-SE")}`;
  document.getElementById("printBtn").addEventListener("click", () => window.print());
}

// Force a clean light palette (and re-render the chart light) for printing,
// then restore the user's theme afterward.
let _printPrevTheme = null;
window.addEventListener("beforeprint", () => {
  _printPrevTheme = getTheme();
  if (_printPrevTheme !== "light") applyTheme("light");
});
window.addEventListener("afterprint", () => {
  if (_printPrevTheme && _printPrevTheme !== "light") applyTheme(_printPrevTheme);
});

window.initPage = () => {
  initLensControls();
  initScenarios();
  initPrint();
  renderOnboard();
  renderAll();
};
