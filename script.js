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
        <span class="stat-label">${t("stat_annual_budget")}</span>
        <span class="stat-value">${fmtMkr(fy.budget)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_booked_actuals")}</span>
        <span class="stat-value">${fmtMkr(bookedActual)}</span>
        <span class="stat-sub">${t("stat_through", monthLabel(CLOSE_MONTH))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_fy_total")}</span>
        <span class="stat-value">${fmtMkr(fy.total)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">${t("stat_variance_vs_budget")}</span>
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
        <span class="stat-label">${t("stat_rolling_12")}</span>
        <span class="stat-value">${fmtMkr(rolling.total)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_window")}</span>
        <span class="stat-value small">${monthLabel(start)} – ${monthLabel(end)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_avg_monthly")}</span>
        <span class="stat-value">${fmtMkr(rolling.total / 12)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">${t("stat_months_without_budget")}</span>
        <span class="stat-value">${monthsBeyondBudget}</span>
        <span class="stat-sub">${t("stat_budget_not_set")}</span>
      </div>
    `;
  }
}

function renderTable() {
  const table = document.getElementById("budgetTable");

  if (currentLens === "fy") {
    let html = `
      <div class="budget-row header">
        <span class="cc-name">${t("col_reporting_line")}</span>
        <span class="num">${t("col_budget")}</span>
        <span class="num">${t("col_fy_total")}</span>
        <span class="num">${t("col_variance")}</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const fy = fySummary(cc);
      const cls = varianceClass(fy.variance, fy.budget);
      const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;

      html += `
        <div class="budget-row">
          <span class="cc-name">${escapeHtml(cc.name)}${cc.note ? `<span class="cc-note">${escapeHtml(cc.note)}</span>` : ""}</span>
          <span class="num" data-label="${t("col_budget")}">${fmtMkr(fy.budget)}</span>
          <span class="num" data-label="${t("col_fy_total")}">${fmtMkr(fy.total)}</span>
          <span class="variance-cell ${cls}" data-label="${t("col_variance")}">
            ${fmtMkrSigned(fy.variance)}
            <span class="variance-pill ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
          </span>
        </div>
      `;
    }

    const ft = companyFySummary();
    const totalCls = varianceClass(ft.variance, ft.budget);
    const totalPct = ft.budget ? (ft.variance / ft.budget) * 100 : 0;
    html += `
      <div class="budget-row total">
        <span class="cc-name">${t("col_total")}</span>
        <span class="num" data-label="${t("col_budget")}">${fmtMkr(ft.budget)}</span>
        <span class="num" data-label="${t("col_fy_total")}">${fmtMkr(ft.total)}</span>
        <span class="variance-cell ${totalCls}" data-label="${t("col_variance")}">
          ${fmtMkrSigned(ft.variance)}
          <span class="variance-pill ${totalCls}">${totalPct > 0 ? "+" : ""}${totalPct.toFixed(1)}%</span>
        </span>
      </div>
    `;
    table.innerHTML = html;
  } else {
    let html = `
      <div class="budget-row header rolling">
        <span class="cc-name">${t("col_reporting_line")}</span>
        <span class="num">${t("col_rolling_12")}</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const r = rollingSummary(cc);
      html += `
        <div class="budget-row rolling">
          <span class="cc-name">${escapeHtml(cc.name)}${cc.note ? `<span class="cc-note">${escapeHtml(cc.note)}</span>` : ""}</span>
          <span class="num" data-label="${t("col_rolling_12")}">${fmtMkr(r.total)}</span>
        </div>
      `;
    }

    const rt = companyRollingSummary();
    html += `
      <div class="budget-row total rolling">
        <span class="cc-name">${t("col_total")}</span>
        <span class="num" data-label="${t("col_rolling_12")}">${fmtMkr(rt.total)}</span>
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
    currentLens === "fy" ? t("chart_title_fy") : t("chart_title_rolling");

  const ctx = document.getElementById("trendChart");
  const datasets = [
    {
      label: t("chart_series_budget"),
      data: budgetSeries,
      borderColor: colors.budget,
      borderDash: [4, 4],
      backgroundColor: "transparent",
      tension: 0.2,
      pointRadius: 0,
      spanGaps: false,
    },
    {
      label: t("chart_series_actual"),
      data: actualSeries,
      borderColor: colors.actual,
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 3,
    },
    {
      label: t("chart_series_forecast"),
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
      <button class="onboard-close" id="onboardClose" type="button" title="${t("onboard_dismiss")}">✕</button>
      <h2>${t("onboard_h2")}</h2>
      <p>${t("onboard_intro")}</p>
      <div class="onboard-tabs">
        <div><strong>${t("nav_overview")}</strong> ${t("onboard_overview")}</div>
        <div><strong>${t("nav_monthly")}</strong> ${t("onboard_monthly")}</div>
        <div><strong>${t("nav_planning")}</strong> ${t("onboard_planning")}</div>
        <div><strong>${t("nav_assumptions")}</strong> ${t("onboard_assumptions")}</div>
      </div>
    </div>`;
}

function renderOnboard() {
  const slot = document.getElementById("onboardSlot");
  if (!slot) return;

  if (localStorage.getItem("almgren-onboard-dismissed") === "true") {
    slot.innerHTML = `<button class="onboard-link" id="onboardOpen" type="button">${t("onboard_reopen")}</button>`;
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

// Total people cost per role across all reporting lines, for the fiscal year.
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
    el.innerHTML = `<p class="empty-hint">${t("no_headcount_hint")}</p>`;
    return;
  }

  const total = rows.reduce((s, r) => s + r.cost, 0);
  let html = `<div class="rb-row rb-head"><span>${t("col_role")}</span><span class="num">${t("col_headcount")}</span><span class="num">${t("col_fy_people_cost")}</span><span class="num">${t("col_share")}</span></div>`;
  rows.forEach((r) => {
    const pct = total ? (r.cost / total) * 100 : 0;
    html += `<div class="rb-row"><span>${escapeHtml(r.label)}</span><span class="num">${r.count}</span><span class="num">${fmtMkr(r.cost)}</span><span class="num">${pct.toFixed(0)}%</span></div>`;
  });
  html += `<div class="rb-row rb-total"><span>${t("total_people_cost")}</span><span class="num"></span><span class="num">${fmtMkr(total)}</span><span class="num">100%</span></div>`;
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
        <span>${escapeHtml(name)}</span>
        <span class="num">${scen != null ? fmtMkr(scen) : "—"}</span>
        <span class="num">${cur != null ? fmtMkr(cur) : "—"}</span>
        <span class="num ${cls}">${scen != null && cur != null ? fmtMkrSigned(d) : ""}</span>
      </div>`;
  });
  return `<div class="scen-detail-head"><span>${t("col_reporting_line")}</span><span class="num">${t("col_scenario")}</span><span class="num">${t("col_current")}</span><span class="num">Δ</span></div>${rows}`;
}

function renderScenarios() {
  const listEl = document.getElementById("scenarioList");
  const currentTotal = companyFySummary().total;
  const currentByName = {};
  COST_CENTERS.forEach((cc) => { currentByName[cc.name] = fySummary(cc).total; });

  let html = `
    <div class="scenario-row current">
      <span>${t("scenario_current_plan")}</span>
      <span class="num">${fmtMkr(currentTotal)}</span>
      <span class="num"></span>
      <span></span>
    </div>`;

  if (SCENARIOS.length === 0) {
    html += `<p class="empty-hint">${t("no_scenarios_hint")}</p>`;
  } else {
    SCENARIOS.forEach((s) => {
      const delta = s.fyTotal - currentTotal;
      const cls = delta > 0 ? "over" : delta < 0 ? "under" : "neutral";
      html += `
        <div class="scenario-row scenario-toggle" data-scen="${s.id}">
          <span>${escapeHtml(s.name)} <span class="scenario-caret">▾</span></span>
          <span class="num">${fmtMkr(s.fyTotal)}</span>
          <span class="num ${cls}">${fmtMkrSigned(delta)}</span>
          <button class="row-remove" data-delscen="${s.id}" title="${t("delete_scenario_title")}">✕</button>
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
    const name = prompt(t("prompt_scenario_name"));
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
      if (!confirm(t("confirm_delete_scenario", s ? s.name : ""))) return;
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
  const sections = document.querySelectorAll(".lens-controls, .stats-row, .main-row, .table-panel, .role-breakdown-panel, .scenarios-panel, .signals-panel, .fortnox-pnl-panel, .budget-version-panel, .forecast-pnl-panel, .reforecast-panel");
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
  renderSignals();
  renderBudgetVersion();
  renderForecastPnl();
  renderReforecast();
}

// The forward answer to "will we make money this year": the revenue plan
// (Assumptions) minus the full-year cost picture (booked actuals through the
// close month + driver forecast after). Hidden until a revenue target or
// monthly plan exists — no invented numbers.
function renderForecastPnl() {
  const panel = document.getElementById("forecastPnlPanel");
  if (!panel) return;
  const revenue = revenuePlanFyTotal();
  if (!revenue) { panel.hidden = true; return; }
  const cost = companyFySummary().total;
  const result = revenue - cost;
  const margin = Math.round((result / revenue) * 100);
  const cls = result >= 0 ? "under" : "over";
  const hasPlan = Array.isArray(ASSUMPTIONS.revenuePlan) && ASSUMPTIONS.revenuePlan.some((v) => v > 0);
  panel.hidden = false;
  panel.innerHTML = `
    <div class="bv-row">
      <div>
        <h2 class="bv-title">${t("forecast_pnl_title")} <span class="pnl-src">${t("forecast_pnl_sub")}</span></h2>
        <p class="table-hint">${t("forecast_pnl_body", `<strong class="${cls}">${fmtMkrSigned(result)}</strong>`, fmtMkr(revenue), fmtMkr(cost), margin)}${hasPlan ? "" : ` · ${t("forecast_pnl_flat_note")}`}</p>
      </div>
    </div>`;
}

// Steal-list (Abacum): budgets are locked/versioned, not just a live editable
// number. Shows the locked baseline, flags drift from the live budget, and
// lets you lock the current numbers as a new approved version.
function renderBudgetVersion() {
  const panel = document.getElementById("budgetVersionPanel");
  if (!panel) return;
  const v = latestBudgetVersion();
  const drift = budgetDrift();
  const lockBtn = `<button class="add-cc-btn" id="lockBudgetBtn" type="button">${v ? t("lock_new_version") : t("lock_current_budget")}</button>`;

  if (!v) {
    panel.innerHTML = `
      <div class="bv-row">
        <div>
          <h2 class="bv-title">${t("budget_version_title")}</h2>
          <p class="table-hint">${t("budget_version_none")}</p>
        </div>
        ${lockBtn}
      </div>`;
  } else {
    const dateStr = new Date(v.lockedAt).toLocaleDateString("sv-SE");
    const driftHtml = drift == null
      ? `<span class="bv-clean">${t("budget_version_clean")}</span>`
      : `<span class="bv-drift ${drift > 0 ? "over" : "under"}">${t("budget_version_drift", fmtMkrSigned(drift))}</span>`;
    panel.innerHTML = `
      <div class="bv-row">
        <div>
          <h2 class="bv-title">${t("budget_version_title")} <span class="pnl-src">${t("budget_version_locked", dateStr)}</span></h2>
          <p class="table-hint">${t("budget_version_approved", `<strong>${escapeHtml(v.name)}</strong>`, fmtMkr(v.total))} ${driftHtml}</p>
        </div>
        ${lockBtn}
      </div>`;
  }

  document.getElementById("lockBudgetBtn").addEventListener("click", async () => {
    const suggested = `${t("suggested_fy_budget")}${BUDGET_VERSIONS.length ? " v" + (BUDGET_VERSIONS.length + 1) : ""}`;
    const name = prompt(t("prompt_lock_version"), suggested);
    if (!name || !name.trim()) return;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_lock")); return; }
    const version = await dbLockBudgetVersion(name.trim());
    if (version) { showToast(t("toast_locked", version.name)); renderBudgetVersion(); }
  });
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
  if (ph) ph.textContent = t("print_header", orgName, new Date().toLocaleDateString("sv-SE"));
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

// Signals — proactively surface what's off, so the controller doesn't have to
// hunt through tables (the pattern every winning FP&A tool shares).
function renderSignals() {
  const panel = document.getElementById("signalsPanel");
  const list = document.getElementById("signalsList");
  if (!panel || !list) return;

  const signals = [];
  COST_CENTERS.forEach((cc) => {
    const fy = fySummary(cc);
    if (!fy.budget) return;
    const pct = (fy.variance / fy.budget) * 100;
    if (Math.abs(pct) < 3) return; // within tolerance — no noise
    signals.push({
      abs: Math.abs(fy.variance),
      over: fy.variance > 0,
      html: `${t("signal_tracking", escapeHtml(cc.name), fmtMkrSigned(fy.variance), fy.variance > 0 ? t("signal_over") : t("signal_under"), `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`)}${cc.note ? ` <span class="signal-note">— ${escapeHtml(cc.note)}</span>` : ""}`,
    });
  });

  if (signals.length === 0) { panel.hidden = true; return; }
  signals.sort((a, b) => b.abs - a.abs);
  list.innerHTML = signals.slice(0, 5).map((s) =>
    `<div class="signal-row"><span class="signal-dot ${s.over ? "over" : "under"}"></span><span>${s.html}</span></div>`
  ).join("");
  panel.hidden = false;
}

// Re-forecast: when a cost centre's recent actuals meaningfully diverge from
// its driver-based plan, suggest applying the run-rate to the remaining
// months — never automatically, always as an opt-in, reversible per-line
// action (this is deliberate: an earlier design pass rejected any auto-apply
// as trust-destroying — a controller may know a spike is a one-off).
function renderReforecast() {
  const panel = document.getElementById("reforecastPanel");
  const list = document.getElementById("reforecastList");
  if (!panel || !list) return;

  const nextMonth = CLOSE_MONTH + 1;
  const items = [];
  COST_CENTERS.forEach((cc) => {
    const hasOverride = cc.overrides && Object.keys(cc.overrides).length > 0;
    if (hasOverride) {
      items.push({ cc, hasOverride: true, runRate: cc.overrides[nextMonth] });
      return;
    }
    if (nextMonth > TIMELINE_LENGTH) return;
    const recent = [];
    for (let m = CLOSE_MONTH; m >= 1 && recent.length < 3; m--) {
      const v = cc.actualMonthly[m - 1];
      if (v != null) recent.push(v);
    }
    if (recent.length === 0) return;
    const runRate = recent.reduce((a, b) => a + b, 0) / recent.length;
    const planForecast = forecastForMonth(cc, nextMonth);
    if (!planForecast) return;
    const pct = Math.abs(runRate - planForecast) / planForecast * 100;
    if (pct < 10) return; // within normal drift — no noise
    items.push({ cc, hasOverride: false, runRate, planForecast, pct });
  });

  if (items.length === 0) { panel.hidden = true; return; }
  list.innerHTML = items.map((it) => `
    <div class="rf-row" data-cc="${it.cc.id}">
      <div>
        <strong>${escapeHtml(it.cc.name)}</strong>
        ${it.hasOverride
          ? `<span class="rf-badge">${t("rf_override_badge", fmtSek(it.runRate))}</span>`
          : `<span class="rf-detail">${t("rf_detail", fmtSek(it.runRate), fmtSek(it.planForecast), it.pct.toFixed(0))}</span>`}
      </div>
      ${it.hasOverride
        ? `<button class="add-cc-btn" data-revert type="button">${t("rf_revert")}</button>`
        : `<button class="add-cc-btn" data-apply type="button">${t("rf_apply")}</button>`}
    </div>`).join("");
  panel.hidden = false;
}

function initReforecast() {
  const list = document.getElementById("reforecastList");
  if (!list) return;
  list.addEventListener("click", async (e) => {
    const row = e.target.closest(".rf-row");
    if (!row) return;
    const cc = COST_CENTERS.find((c) => c.id === row.dataset.cc);
    if (!cc) return;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_reforecast")); return; }
    if (e.target.dataset.apply !== undefined) {
      const rr = await dbApplyRunRate(cc);
      if (rr != null) { showToast(t("toast_applied_runrate", cc.name)); renderAll(); }
    } else if (e.target.dataset.revert !== undefined) {
      const ok = await dbClearOverrides(cc);
      if (ok) { showToast(t("toast_reverted", cc.name)); renderAll(); }
    }
  });
}

// The actuals P&L pulled from Fortnox (persisted from the last sync), shown on
// the Overview so the headline view reflects the full picture, not just costs.
async function renderFortnoxPnl() {
  const panel = document.getElementById("fortnoxPnl");
  const body = document.getElementById("fortnoxPnlBody");
  if (!panel || !body || typeof pnlTable !== "function") return;
  let recon = null;
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    const revenue = 52400000, cogs = 14200000, opex = 12600000, personnel = 15000000;
    const total_cost = cogs + opex + personnel;
    recon = { revenue, cogs, opex, personnel, total_cost, result: revenue - total_cost, vouchers: 3214 };
  } else {
    const status = await loadIntegrationStatus();
    recon = status && status.last_reconciliation;
  }
  if (!recon) { panel.hidden = true; return; }
  body.innerHTML = pnlTable(recon) +
    `<p class="fn-recon-note">${t("fortnox_pnl_note", recon.vouchers ? Number(recon.vouchers).toLocaleString("sv-SE") : null)}</p>`;
  panel.hidden = false;
}

window.initPage = () => {
  initLensControls();
  initScenarios();
  initReforecast();
  initPrint();
  renderOnboard();
  renderAll();
  renderFortnoxPnl();
};
