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
  if (month < FY_WINDOW_START || month > fyWindowEnd()) return null;
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
  for (let m = FY_WINDOW_START; m <= fyWindowEnd(); m++) months.push(m);
  return months;
}

// ---- The Brief (Phase 9.1) ---------------------------------------------------
// The hero is a BRIEFING, not a dashboard: the verdict headline, then up to
// five plain-language sentences with live numbers — cash, the next tax
// deadline, the variances that need review (the ritual lives inline), any
// actuals/plan divergence, the budget state — each linking to its evidence.
// One home per fact: this absorbs the old "This month" signals panel.
// Happy state: "All quiet." The Monday-email version is Tier 3.

// Variance signals (≥3% of a line's annual target), biggest first. Only
// meaningful when the window holds a closed month.
function varianceSignals() {
  if (CLOSE_MONTH < FY_WINDOW_START || CLOSE_MONTH > fyWindowEnd()) return [];
  const out = [];
  COST_CENTERS.forEach((cc) => {
    const fy = fySummary(cc);
    if (!fy.budget) return;
    const pct = (fy.variance / fy.budget) * 100;
    if (Math.abs(pct) < 3) return;
    out.push({ id: cc.id, name: cc.name, note: cc.note, variance: fy.variance, pct, abs: Math.abs(fy.variance), over: fy.variance > 0 });
  });
  return out.sort((a, b) => b.abs - a.abs);
}

// The next Skatteverket payment (VAT / employer taxes) due within `days`.
function nextTaxDue(days = 45) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  let next = null;
  for (const kind of ["vat", "payroll"]) {
    for (const [fyMonth, balance] of TAX_LIABILITY[kind]) {
      const owed = -balance;
      if (owed <= 0) continue;
      const due = taxDueDate(kind, fyMonth);
      if (!due || due < today || due > horizon) continue;
      if (!next || due < next.due) next = { kind, due, owed };
    }
  }
  return next;
}

// The line whose booked run-rate diverges most from its driver plan (≥3%),
// unless it's already been re-forecast (overrides exist) — same rules as the
// Planning row, surfaced here because noticing is Overview's job.
function topDivergence() {
  if (CLOSE_MONTH < 1 || CLOSE_MONTH + 1 > TIMELINE_LENGTH) return null;
  let top = null;
  COST_CENTERS.forEach((cc) => {
    if (cc.overrides && Object.keys(cc.overrides).length) return;
    const recent = recentRunRate(cc);
    const plan = forecastForMonth(cc, CLOSE_MONTH + 1);
    if (recent == null || !plan) return;
    const pct = ((recent - plan) / plan) * 100;
    if (Math.abs(pct) < 3) return;
    if (!top || Math.abs(pct) > Math.abs(top.pct)) top = { name: cc.name, pct };
  });
  return top;
}

function renderBrief() {
  const hero = document.getElementById("heroCard");
  if (!hero) return;

  const fy = companyFySummary();
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
    projHtml = `<p class="hero-sub"><strong>${t("forecast_pnl_title", fyName())}:</strong> ${t("forecast_pnl_body", `<strong class="${rcls}">${fmtMkrSigned(result)}</strong>`, fmtMkr(revenue), fmtMkr(fy.total), margin)}${hasPlan ? "" : ` · ${t("forecast_pnl_flat_note")}`}</p>`;
  }

  // The sentences, in fixed priority order, capped at five.
  const lines = [];
  const line = (sev, html, act = "") =>
    lines.push(`<div class="brief-line"><span class="signal-dot ${sev}"></span><span class="brief-text">${html}</span>${act}</div>`);
  const arrow = (href, label) => `<a class="brief-act" href="${href}">${label}</a>`;

  if (CASH_POSITION) {
    const proj = cashFlowProjection(6);
    const bal = fmtMkr(CASH_POSITION.bankBalance);
    if (proj && proj.runway != null) {
      line(proj.runway <= 3 ? "over" : "warn", t("brief_cash_low", bal, proj.runway), arrow("cashflow.html", t("brief_see_cash")));
    } else {
      line("under", t("brief_cash_ok", bal), arrow("cashflow.html", t("brief_see_cash")));
    }
  }

  const tax = nextTaxDue();
  if (tax) {
    // strip the locale's abbreviation dot ("aug.") — the sentence adds its own
    const when = new Date(tax.due).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short" }).replace(/\.$/, "");
    line("info", t("brief_tax_due", t(tax.kind === "vat" ? "brief_tax_vat" : "brief_tax_payroll"), fmtSek(tax.owed), when), arrow("cashflow.html", t("brief_see_cash")));
  }

  const isReviewed = (id) => SIGNAL_REVIEWS.has(id + ":" + CLOSE_MONTH);
  varianceSignals().slice(0, 2).forEach((s) => {
    const reviewed = isReviewed(s.id);
    const text = `${t("signal_tracking", escapeHtml(s.name), fmtMkrSigned(s.variance), s.over ? t("signal_over") : t("signal_under"), `${s.pct > 0 ? "+" : ""}${s.pct.toFixed(1)}%`)}${s.note ? ` <span class="signal-note">— ${escapeHtml(s.note)}</span>` : ""}`;
    lines.push(`<div class="brief-line ${reviewed ? "reviewed" : ""}">
      <span class="signal-dot ${s.over ? "over" : "under"}"></span>
      <span class="brief-text">${text}</span>
      <button class="signal-review-btn" type="button" data-cc="${s.id}" data-mark="${!reviewed}">${reviewed ? t("signal_unmark") : t("signal_mark_reviewed")}</button>
    </div>`);
  });

  const div = topDivergence();
  if (div) {
    line("warn", t("brief_diverge", escapeHtml(div.name), Math.abs(div.pct).toFixed(0), t(div.pct > 0 ? "rf_above" : "rf_below")), arrow("planning.html", t("brief_update_forecast")));
  }

  const budget = latestBudgetVersion();
  const drift = budgetDrift();
  if (!budget && draftBudgetVersions().length === 0) {
    line("info", t("brief_no_budget", FY_START_YEAR + 1), arrow("assumptions.html", t("brief_open_plans")));
  } else if (budget && drift != null && Math.abs(drift) >= (VERSION_SUMMARIES[budget.id] || {}).total * 0.01) {
    line("warn", t("brief_drift", fmtMkrSigned(drift), escapeHtml(budget.name)), arrow("assumptions.html", t("brief_open_plans")));
  }

  const shown = lines.slice(0, 5);
  if (shown.length === 0 && CLOSE_MONTH >= FY_WINDOW_START) {
    shown.push(`<div class="brief-line"><span class="signal-dot under"></span><span class="brief-text">${t("brief_all_quiet")}</span></div>`);
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
    ${projHtml}
    ${shown.length ? `<div class="brief-lines">${shown.join("")}</div>` : ""}`;
}

function initBrief() {
  const hero = document.getElementById("heroCard");
  if (!hero) return;
  hero.addEventListener("click", async (e) => {
    const btn = e.target.closest(".signal-review-btn");
    if (!btn) return;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_review")); return; }
    const mark = btn.dataset.mark === "true";
    const ok = mark ? await dbMarkReviewed(btn.dataset.cc, CLOSE_MONTH) : await dbUnmarkReviewed(btn.dataset.cc, CLOSE_MONTH);
    if (ok) renderBrief();
  });
}

// Compact stats under the Brief (TEARDOWN C6).
function renderStats() {
  const statsRow = document.getElementById("statsRow");

  if (currentLens === "fy") {
    const fy = companyFySummary();
    let bookedActual = 0; // booked months INSIDE the active FY window (a next-year budget has none yet)
    for (let m = FY_WINDOW_START; m <= Math.min(CLOSE_MONTH, fyWindowEnd()); m++) bookedActual += companyMonthAmount(m);

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">${t("stat_annual_budget", fyName())}</span>
        <span class="stat-value">${fmtMkr(fy.budget)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_booked_actuals")}</span>
        <span class="stat-value">${fmtMkr(bookedActual)}</span>
        <span class="stat-sub">${CLOSE_MONTH >= FY_WINDOW_START ? t("stat_through", monthLabel(CLOSE_MONTH)) : t("period_none_yet")}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_fy_total")}</span>
        <span class="stat-value">${fmtMkr(fy.total)}</span>
      </div>
    `;
  } else {
    // Rolling lens: the Brief stays put (it's window-based, not lens-based);
    // the R12 total leads the stats row instead of overwriting the hero.
    const { start, end } = rollingWindow();
    const rolling = companyRollingSummary();
    const monthsBeyondBudget = lensMonthRange().filter((m) => m < FY_WINDOW_START || m > fyWindowEnd()).length;

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">${t("stat_rolling_12")}</span>
        <span class="stat-value">${fmtMkr(rolling.total)}</span>
        <span class="stat-sub">${monthLabel(start)} – ${monthLabel(end)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">${t("stat_avg_monthly")}</span>
        <span class="stat-value">${fmtMkr(rolling.total / 12)}</span>
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
        <span class="num">${t("col_fy_total", fyName())}</span>
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
          <span class="num" data-label="${t("col_fy_total", fyName())}">${fmtMkr(fy.total)}</span>
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
        <span class="num" data-label="${t("col_fy_total", fyName())}">${fmtMkr(ft.total)}</span>
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
    currentLens === "fy" ? t("chart_title_fy", fyName()) : t("chart_title_rolling");

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

// (The "? How this works" button + explainer card were removed [#1] — the
// pages explain themselves now; contextual help lives in help mode instead.)

// Total people cost per role across all reporting lines, for the fiscal year.
function roleFyTotals() {
  const totals = {};
  COST_CENTERS.forEach((cc) => {
    cc.headcount.forEach((h) => {
      const activeFy = Math.max(0, Math.min(h.endMonth, fyWindowEnd()) - Math.max(h.startMonth, FY_WINDOW_START) + 1);
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
// non-locked, non-budget version other than the one you're on AND in the same
// fiscal year (comparing a FY2026 scenario's total against a FY2027 budget's
// would be apples-to-oranges); budgets get their own panel. Branch a new one
// from the sidebar (+ Scenario).
function scenarioVersions() {
  return PLAN_VERSIONS.filter((v) =>
    !v.lockedAt && v.budgetFy == null && v.id !== ACTIVE_VERSION_ID
    && fyWindowStartFor(v) === FY_WINDOW_START);
}

function renderScenarios() {
  const listEl = document.getElementById("scenarioList");
  const active = VERSION_SUMMARIES[ACTIVE_VERSION_ID] || { total: 0, byName: {} };
  const currentTotal = active.total;
  const currentByName = active.byName || {};
  const activeName = activeVersion() ? versionDisplayName(activeVersion()) : t("scenario_current_plan");

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
          <span>${escapeHtml(versionDisplayName(v))} <span class="scenario-caret">▾</span></span>
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
  for (let m = FY_WINDOW_START; m <= fyWindowEnd(); m++) months.push(m);
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

  // Budget panel: create next year's budget from the current plan / jump into
  // the existing draft to finish it.
  const bvPanel = document.getElementById("budgetVersionPanel");
  if (bvPanel) bvPanel.addEventListener("click", async (e) => {
    const createBtn = e.target.closest("[data-createbudget]");
    if (createBtn) {
      if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
      const fy = Number(createBtn.dataset.createbudget);
      const id = await dbCreateBudget(fy);
      if (id) { showToast(t("toast_budget_created", fy)); switchVersion(id); }
      return;
    }
    const openBtn = e.target.closest("[data-openbudget]");
    if (openBtn) switchVersion(openBtn.dataset.openbudget);
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
  // Subtitle carries the ACTIVE window's fiscal year (editing Budget 2027
  // must read FY2027 everywhere, not the year baked into the static HTML).
  const sub = document.querySelector(".page-sub");
  if (sub) sub.textContent = t("overview_subtitle", fyName());

  const sections = document.querySelectorAll(".lens-controls, .hero-card, .stats-row, .main-row, .table-panel, .collapse-panel");
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
  renderBrief();
  renderStats();
  renderTable();
  renderChart();
  renderRoleBreakdown();
  renderScenarios();
  renderBudgetVersion();
}

// A budget is a FISCAL-YEAR plan version (budget_fy): draft while you build
// it from the current plan, approved once locked. Three states here:
//   none    → the CTA to create next year's budget from the current plan
//   draft   → "finish and lock" pointer (the draft is edited like any plan)
//   locked  → the approved read-out + live drift over the BUDGET'S year
function renderBudgetVersion() {
  const panel = document.getElementById("budgetVersionPanel");
  if (!panel) return;
  const v = latestBudgetVersion();
  const draft = draftBudgetVersions()[0] || null;
  const drift = budgetDrift();

  const driftHtml = drift == null
    ? `<span class="bv-clean">${t("budget_version_clean")}</span>`
    : `<span class="bv-drift ${drift > 0 ? "over" : "under"}">${t("budget_version_drift", fmtMkrSigned(drift))}</span>`;

  // Status chip lives in the collapsed <summary> so the drift/✓ verdict is
  // visible without expanding — collapsed must never mean hidden information.
  const status = document.getElementById("bvStatus");
  if (status) status.innerHTML = !v ? "" : driftHtml;

  if (!v && !draft) {
    // Propose next FY — budgeting is next year's exercise (current FY is
    // also offered where budgets are managed, on Assumptions).
    const nextFy = FY_START_YEAR + 1;
    panel.innerHTML = `
      <div class="bv-row">
        <p class="table-hint">${t("budget_none_yet", nextFy)}</p>
        <button class="add-headcount" data-createbudget="${nextFy}" type="button">${t("create_budget_btn", nextFy)}</button>
      </div>`;
    return;
  }
  if (!v && draft) {
    const sum = VERSION_SUMMARIES[draft.id] || { total: 0 };
    panel.innerHTML = `
      <div class="bv-row">
        <p class="table-hint">${t("budget_draft_status", `<strong>${escapeHtml(draft.name)}</strong>`, fmtMkr(sum.total))}
        <button class="integ-link" data-openbudget="${draft.id}" type="button">${t("budget_draft_open")}</button></p>
      </div>`;
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
  if (ph) ph.textContent = t("print_header", orgName, new Date().toLocaleDateString("sv-SE"), fyName());
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

// (The "This month" signals panel was absorbed into the Brief [Phase 9.1] —
// variance sentences + the mark-reviewed ritual live in the hero now, one
// home per fact. Re-forecast lives on Planning — it EDITS the plan.)

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
  initBrief();
  initPrint();
  renderAll();
  renderFortnoxPnl();
};
