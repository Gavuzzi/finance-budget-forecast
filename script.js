let trendChart;
let scenarioChart;
let currentLens = "fy"; // "fy" | "rolling"

const THEME_COLORS = {
  dark: { text: "#93a1b8", grid: "#28344a", budget: "#7aa3e0", actual: "#5cb88a", forecast: "#d9a647" },
  light: { text: "#647189", grid: "#dde4ee", budget: "#3461a8", actual: "#2f9e6a", forecast: "#b6841f" },
};

// Fixed palette for scenario lines (cycled if there are more scenarios than colors) —
// deliberately distinct from THEME_COLORS.budget/actual/forecast so the "Current
// plan" line (which reuses colors.actual) never collides with a scenario line.
const SCENARIO_PALETTE = ["#d9a647", "#c86bd6", "#5aa8d9", "#e07a5f", "#8fbf5f"];

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

// Hero + compact stats (TEARDOWN C6): the hero answers the page's one
// question — "are we on plan?" — as a verdict, not just a signed number.
// The projected-FY-result line (revenue plan − cost) lives inside the hero
// as a subline instead of being its own stacked panel.
function renderStats() {
  const hero = document.getElementById("heroCard");
  const statsRow = document.getElementById("statsRow");

  if (currentLens === "fy") {
    const fy = companyFySummary();
    let bookedActual = 0;
    for (let m = 1; m <= CLOSE_MONTH; m++) bookedActual += companyMonthAmount(m);
    const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
    const cls = varianceClass(fy.variance, fy.budget);
    const onPlan = Math.abs(pct) <= 1;
    const verdict = onPlan ? t("verdict_on_plan")
      : fy.variance > 0 ? t("verdict_over_budget") : t("verdict_under_budget");
    // "On plan" is good news — green, not the amber the tiny raw variance
    // would get from varianceClass (amber reads as a warning; TEARDOWN C4).
    const verdictCls = onPlan ? "under" : cls;

    const revenue = revenuePlanFyTotal();
    let projHtml = "";
    if (revenue) {
      const result = revenue - fy.total;
      const margin = Math.round((result / revenue) * 100);
      const rcls = result >= 0 ? "under" : "over";
      const hasPlan = Array.isArray(ASSUMPTIONS.revenuePlan) && ASSUMPTIONS.revenuePlan.some((v) => v > 0);
      projHtml = `<p class="hero-sub"><strong>${t("forecast_pnl_title")}:</strong> ${t("forecast_pnl_body", `<strong class="${rcls}">${fmtMkrSigned(result)}</strong>`, fmtMkr(revenue), fmtMkr(fy.total), margin)}${hasPlan ? "" : ` · ${t("forecast_pnl_flat_note")}`}</p>`;
    }

    hero.innerHTML = `
      <div class="hero-main">
        <div>
          <span class="stat-label">${t("stat_variance_vs_budget")}</span>
          <span class="hero-verdict ${verdictCls}">${verdict}</span>
        </div>
        <div class="hero-amount">
          <span class="stat-value ${cls}">${fmtMkrSigned(fy.variance)}</span>
          <span class="variance-pill ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
        </div>
      </div>
      ${projHtml}`;

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
    `;
  } else {
    const { start, end } = rollingWindow();
    const rolling = companyRollingSummary();
    const monthsBeyondBudget = lensMonthRange().filter((m) => m > FY_MONTHS).length;

    hero.innerHTML = `
      <div class="hero-main">
        <div>
          <span class="stat-label">${t("stat_rolling_12")}</span>
          <span class="hero-verdict">${fmtMkr(rolling.total)}</span>
        </div>
        <div class="hero-amount">
          <span class="stat-sub">${monthLabel(start)} – ${monthLabel(end)}</span>
        </div>
      </div>`;

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">${t("stat_avg_monthly")}</span>
        <span class="stat-value">${fmtMkr(rolling.total / 12)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_window")}</span>
        <span class="stat-value small">${monthLabel(start)} – ${monthLabel(end)}</span>
      </div>
      <div class="stat-card">
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

  // Default CLOSED (progressive disclosure, SAC-style): a quiet "? How this
  // works" button; the explainer card opens only on demand instead of
  // permanently walling the page (TEARDOWN C13 — show, don't explain).
  if (localStorage.getItem("almgren-onboard-open") !== "true") {
    slot.innerHTML = `<button class="onboard-help-btn" id="onboardOpen" type="button">${t("onboard_help_btn")}</button>`;
    document.getElementById("onboardOpen").addEventListener("click", () => {
      localStorage.setItem("almgren-onboard-open", "true");
      renderOnboard();
    });
    return;
  }

  slot.innerHTML = onboardCardHtml();
  document.getElementById("onboardClose").addEventListener("click", () => {
    localStorage.setItem("almgren-onboard-open", "false");
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

// A scenario version's per-line totals vs the live (active) plan's, so the
// caret-expand shows WHERE the difference sits, not just the FY delta. Both
// sides come from VERSION_SUMMARIES (live cross-version compute), so there's no
// stale snapshot — expand a scenario and it reflects its current drivers.
function renderScenarioDetail(scen, currentByName) {
  const scenByName = (scen && scen.byName) || {};
  const names = [...new Set([...Object.keys(scenByName), ...Object.keys(currentByName)])];
  let rows = "";
  names.forEach((name) => {
    const s = scenByName[name], cur = currentByName[name];
    const d = (s ?? 0) - (cur ?? 0);
    const cls = d > 0 ? "over" : d < 0 ? "under" : "neutral";
    rows += `
      <div class="scen-detail-row">
        <span>${escapeHtml(name)}</span>
        <span class="num">${s != null ? fmtMkr(s) : "—"}</span>
        <span class="num">${cur != null ? fmtMkr(cur) : "—"}</span>
        <span class="num ${cls}">${s != null && cur != null ? fmtMkrSigned(d) : ""}</span>
      </div>`;
  });
  return `<div class="scen-detail-head"><span>${t("col_reporting_line")}</span><span class="num">${t("col_scenario")}</span><span class="num">${t("col_current")}</span><span class="num">Δ</span></div>${rows}`;
}

// Scenarios are now real plan versions (branches), compared LIVE against the
// active plan via VERSION_SUMMARIES — not frozen snapshots. Lists every
// non-locked version other than the one you're on; locked budgets get their
// own panel. Branch a new one from the sidebar (+ Scenario).
function scenarioVersions() {
  return PLAN_VERSIONS.filter((v) => !v.lockedAt && v.id !== ACTIVE_VERSION_ID);
}

function renderScenarios() {
  const listEl = document.getElementById("scenarioList");
  const active = VERSION_SUMMARIES[ACTIVE_VERSION_ID] || { total: 0, byName: {} };
  const currentTotal = active.total;
  const currentByName = active.byName || {};
  const activeName = (activeVersion() || {}).name || t("scenario_current_plan");

  let html = `
    <div class="scenario-row current">
      <span>${escapeHtml(activeName)} <span class="pnl-src">${t("scenario_live")}</span></span>
      <span class="num">${fmtMkr(currentTotal)}</span>
      <span class="num"></span>
      <span></span>
    </div>`;

  const scens = scenarioVersions();
  if (scens.length === 0) {
    html += `<p class="empty-hint">${t("no_scenarios_hint")}</p>`;
  } else {
    scens.forEach((v) => {
      const sum = VERSION_SUMMARIES[v.id];
      if (!sum) return;
      const delta = sum.total - currentTotal;
      const cls = delta > 0 ? "over" : delta < 0 ? "under" : "neutral";
      html += `
        <div class="scenario-row scenario-toggle" data-scen="${v.id}">
          <span>${escapeHtml(v.name)}${v.isMain ? ` <span class="pnl-src">${t("scenario_main_tag")}</span>` : ""} <span class="scenario-caret">▾</span></span>
          <span class="num">${fmtMkr(sum.total)}</span>
          <span class="num ${cls}">${fmtMkrSigned(delta)}</span>
          ${v.isMain ? "<span></span>" : `<button class="row-remove" data-delscen="${v.id}" title="${t("delete_scenario_title")}">✕</button>`}
        </div>
        <div class="scenario-detail" data-detailscen="${v.id}" hidden>
          ${renderScenarioDetail(sum, currentByName)}
        </div>`;
    });
  }

  listEl.innerHTML = html;
  renderScenarioChart();
}

// Scenario trajectories (steal: Causal): a saved scenario stores one FY total,
// which hides WHEN two plans diverge — a hiring freeze from month 9 and a 3%
// mid-year price cut can land on the same annual delta but tell very
// different stories. Plot each saved scenario's frozen monthly snapshot
// against the live current-plan trajectory so the shape is visible, not just
// the number.
function renderScenarioChart() {
  const wrap = document.getElementById("scenarioChartWrap");
  if (!wrap) return;
  const withMonthly = scenarioVersions()
    .map((v) => ({ name: v.name, monthly: (VERSION_SUMMARIES[v.id] || {}).monthly }))
    .filter((s) => Array.isArray(s.monthly) && s.monthly.length === FY_MONTHS);
  if (withMonthly.length === 0) { wrap.hidden = true; return; }
  // Inside a closed <details> the canvas has zero size and Chart.js renders
  // blank — skip; the details' toggle listener re-renders on first open.
  const host = document.getElementById("scenariosDetails");
  if (host && !host.open) return;
  wrap.hidden = false;

  const colors = THEME_COLORS[getTheme()];
  const months = [];
  for (let m = 1; m <= FY_MONTHS; m++) months.push(m);
  const labels = months.map(monthLabel);

  const datasets = [
    {
      label: t("scenario_current_plan"),
      data: months.map((m) => companyMonthAmount(m)),
      borderColor: colors.actual,
      backgroundColor: "transparent",
      borderWidth: 2,
      tension: 0.2,
      pointRadius: 2,
    },
    ...withMonthly.map((s, i) => ({
      label: s.name,
      data: s.monthly,
      borderColor: SCENARIO_PALETTE[i % SCENARIO_PALETTE.length],
      backgroundColor: "transparent",
      borderDash: [5, 3],
      tension: 0.2,
      pointRadius: 2,
    })),
  ];

  if (scenarioChart) scenarioChart.destroy();
  scenarioChart = new Chart(document.getElementById("scenarioChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: colors.text } } },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: { ticks: { color: colors.text, callback: (v) => fmtMkr(v) }, grid: { color: colors.grid } },
      },
    },
  });
}

function initScenarios() {
  const host = document.getElementById("scenariosDetails");
  if (host) host.addEventListener("toggle", () => { if (host.open) renderScenarioChart(); });

  document.getElementById("newScenarioFromOverview").addEventListener("click", async () => {
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
    const name = prompt(t("prompt_new_scenario"));
    if (!name || !name.trim()) return;
    const id = await dbCreateVersion(name.trim());
    if (id) switchVersion(id); // branch + open it, same as the sidebar
  });

  document.getElementById("scenarioList").addEventListener("click", async (e) => {
    const delBtn = e.target.closest("[data-delscen]");
    if (delBtn) {
      const id = delBtn.dataset.delscen;
      const v = PLAN_VERSIONS.find((x) => x.id === id);
      if (!confirm(t("confirm_delete_scenario", v ? v.name : ""))) return;
      if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
      if (!(await dbDeleteVersion(id))) return;
      if (id === ACTIVE_VERSION_ID) localStorage.removeItem(activeVersionKey()); // was active → fall back to Main
      location.reload(); // versions + summaries reload cleanly
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
  const sections = document.querySelectorAll(".lens-controls, .hero-card, .stats-row, .main-row, .table-panel, .this-month-panel, .collapse-panel");
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
    renderIntegrationPanel(document.getElementById("onboardIntegrationPanel"));
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

  // The "This month" wrapper now only holds the signals block; hide it when
  // there's nothing to say (e.g. no closed month yet).
  const wrap = document.getElementById("thisMonthPanel");
  const sig = document.getElementById("signalsPanel");
  if (wrap && sig) wrap.hidden = sig.hidden;
}

// Steal-list (Abacum): a budget is an approved, locked plan version — not a
// live editable number. This panel shows the latest locked budget and whether
// the live plan has since drifted from it (live cost vs the budget's cost,
// both engine-computed via VERSION_SUMMARIES). Locking happens in the sidebar
// (Lock as budget), so there's no button here — just the read-out.
function renderBudgetVersion() {
  const panel = document.getElementById("budgetVersionPanel");
  if (!panel) return;
  const v = latestBudgetVersion();
  const drift = budgetDrift();

  const driftHtml = drift == null
    ? `<span class="bv-clean">${t("budget_version_clean")}</span>`
    : `<span class="bv-drift ${drift > 0 ? "over" : "under"}">${t("budget_version_drift", fmtMkrSigned(drift))}</span>`;

  // Status chip lives in the collapsed <summary> so the drift/✓ verdict is
  // visible without expanding — collapsed must never mean hidden information.
  const status = document.getElementById("bvStatus");
  if (status) status.innerHTML = !v ? "" : driftHtml;

  if (!v) {
    panel.innerHTML = `<div class="bv-row"><p class="table-hint">${t("budget_version_none")}</p></div>`;
    return;
  }
  const sum = VERSION_SUMMARIES[v.id] || { total: 0 };
  const dateStr = new Date(v.lockedAt).toLocaleDateString("sv-SE");
  panel.innerHTML = `
    <div class="bv-row">
      <p class="table-hint">${t("budget_version_approved", `<strong>${escapeHtml(v.name)}</strong>`, fmtMkr(sum.total))} <span class="pnl-src">${t("budget_version_locked", dateStr)}</span> ${driftHtml}</p>
    </div>`;
}

function initLensControls() {
  // Dev hook: ?preview&lens=rolling renders the rolling lens for headless
  // screenshot verification (the toggle needs a click otherwise).
  if (new URLSearchParams(location.search).get("lens") === "rolling") currentLens = "rolling";
  document.querySelectorAll(".lens-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lens === currentLens);
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
  if (scenarioChart) {
    scenarioChart.destroy();
    scenarioChart = null;
    renderScenarioChart();
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
// then restore the user's theme afterward. Collapsed sections are opened for
// the print (a board pack shouldn't have hidden content) and restored after.
let _printPrevTheme = null;
let _printClosedDetails = [];
window.addEventListener("beforeprint", () => {
  _printPrevTheme = getTheme();
  if (_printPrevTheme !== "light") applyTheme("light");
  _printClosedDetails = [...document.querySelectorAll("details.collapse-panel:not([open])")];
  _printClosedDetails.forEach((d) => (d.open = true));
});
window.addEventListener("afterprint", () => {
  if (_printPrevTheme && _printPrevTheme !== "light") applyTheme(_printPrevTheme);
  _printClosedDetails.forEach((d) => (d.open = false));
  _printClosedDetails = [];
});

// Signals — proactively surface what's off, so the controller doesn't have to
// hunt through tables (the pattern every winning FP&A tool shares).
// Month-end review ritual: turns this panel into a checkable close checklist
// instead of a wall of variance text. Reviewed state is per (reporting line,
// CLOSE_MONTH) — purely a habit-tracking checkbox, never fed back into any
// calculation. Two positive-reinforcement states (all reviewed / nothing to
// flag) replace the old behavior of just hiding the panel when there's
// nothing to complain about — the goal is a monthly habit, not a nag list.
function renderSignals() {
  const panel = document.getElementById("signalsPanel");
  const list = document.getElementById("signalsList");
  if (!panel || !list) return;

  const monthLbl = monthLabel(CLOSE_MONTH);
  const signals = [];
  COST_CENTERS.forEach((cc) => {
    const fy = fySummary(cc);
    if (!fy.budget) return;
    const pct = (fy.variance / fy.budget) * 100;
    if (Math.abs(pct) < 3) return; // within tolerance — no noise
    signals.push({
      id: cc.id,
      abs: Math.abs(fy.variance),
      over: fy.variance > 0,
      html: `${t("signal_tracking", escapeHtml(cc.name), fmtMkrSigned(fy.variance), fy.variance > 0 ? t("signal_over") : t("signal_under"), `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`)}${cc.note ? ` <span class="signal-note">— ${escapeHtml(cc.note)}</span>` : ""}`,
    });
  });

  if (CLOSE_MONTH < 1) { panel.hidden = true; return; } // no closed month yet — nothing to review

  if (signals.length === 0) {
    list.innerHTML = `<div class="signal-empty">${t("signals_nothing_to_flag", monthLbl)}</div>`;
    panel.hidden = false;
    return;
  }

  signals.sort((a, b) => b.abs - a.abs);
  const shown = signals.slice(0, 5);
  const isReviewed = (s) => SIGNAL_REVIEWS.has(s.id + ":" + CLOSE_MONTH);
  const allReviewed = shown.every(isReviewed);

  list.innerHTML = shown.map((s) => {
    const reviewed = isReviewed(s);
    return `<div class="signal-row ${reviewed ? "reviewed" : ""}">
      <span class="signal-dot ${s.over ? "over" : "under"}"></span>
      <span class="signal-text">${s.html}</span>
      <button class="signal-review-btn" type="button" data-cc="${s.id}" data-mark="${!reviewed}">${reviewed ? t("signal_unmark") : t("signal_mark_reviewed")}</button>
    </div>`;
  }).join("") + (allReviewed ? `<div class="signal-empty">${t("signals_all_reviewed", monthLbl)}</div>` : "");
  panel.hidden = false;
}

function initSignals() {
  const list = document.getElementById("signalsList");
  if (!list) return;
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest(".signal-review-btn");
    if (!btn) return;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_review")); return; }
    const ccId = btn.dataset.cc;
    const mark = btn.dataset.mark === "true";
    const ok = mark ? await dbMarkReviewed(ccId, CLOSE_MONTH) : await dbUnmarkReviewed(ccId, CLOSE_MONTH);
    if (ok) renderSignals();
  });
}

// (Re-forecast moved to Planning [#3] — it EDITS the plan, so it lives with
// the other plan-editing tools; Overview stays a monitoring surface.)

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
  initSignals();
  initPrint();
  renderOnboard();
  renderAll();
  renderFortnoxPnl();
};
