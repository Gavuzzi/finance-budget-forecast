// cashflow.js — Phase 5: "will there be money in the bank." Current bank
// balance (from the sync's SIE #UB lines) walked forward by open invoices due
// each month (from Fortnox's /invoices and /supplierinvoices) — a hard figure
// straight from Fortnox's own AR/AP module — PLUS an estimated VAT/payroll-tax
// due-date projection (v2) derived from tracked account balances + Skatteverket's
// published deadline rules. The two are never blended silently: the table keeps
// them in separate columns so the estimate is always visually distinct from the
// hard invoice data.

let cashChart;
const CASHFLOW_MONTHS_AHEAD = 6;

// script.js (Overview) isn't loaded on this page, so this page keeps its own
// copy rather than pulling in the whole Overview chart module for one const.
const THEME_COLORS = {
  dark: { text: "#93a1b8", grid: "#28344a", budget: "#7aa3e0", actual: "#5cb88a", forecast: "#d9a647" },
  light: { text: "#647189", grid: "#dde4ee", budget: "#3461a8", actual: "#2f9e6a", forecast: "#b6841f" },
};

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function renderCashStats() {
  const row = document.getElementById("cashStatsRow");
  const totalAr = OPEN_INVOICES.filter((i) => i.kind === "customer").reduce((s, i) => s + i.amount, 0);
  const totalAp = OPEN_INVOICES.filter((i) => i.kind === "supplier").reduce((s, i) => s + i.amount, 0);
  const projection = cashFlowProjection(CASHFLOW_MONTHS_AHEAD);
  const rows = projection.rows;
  const endBalance = rows[rows.length - 1].balance;
  const cls = endBalance < 0 ? "over" : "";
  const runway = projection.runway;
  const runwayLabel = runway == null ? t("runway_cash_positive") : t("runway_months", runway);
  const runwayCls = runway != null && runway <= 3 ? "over" : "";
  const runwaySub = runway == null
    ? t("runway_holds", RUNWAY_HORIZON_MONTHS - cashFlowMonthIndex(new Date().toISOString().slice(0, 10)) + 1)
    : t("runway_crosses");

  row.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">${t("stat_bank_balance")}</span>
      <span class="stat-value">${fmtMkr(CASH_POSITION.bankBalance)}</span>
      <span class="stat-sub">${t("stat_as_of", fmtDate(CASH_POSITION.asOf.slice(0, 10)))}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${t("stat_open_ar")}</span>
      <span class="stat-value">${fmtMkr(totalAr)}</span>
      <span class="stat-sub">${t("stat_unpaid_customer", OPEN_INVOICES.filter((i) => i.kind === "customer").length)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">${t("stat_open_ap")}</span>
      <span class="stat-value">${fmtMkr(totalAp)}</span>
      <span class="stat-sub">${t("stat_unpaid_supplier", OPEN_INVOICES.filter((i) => i.kind === "supplier").length)}</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-label">${t("stat_projected_balance")}</span>
      <span class="stat-value ${cls}">${fmtMkr(endBalance)}</span>
      <span class="stat-sub ${cls}">${t("stat_projected_sub", CASHFLOW_MONTHS_AHEAD)}</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-label" title="${t("runway_title")}">${t("runway_label")}</span>
      <span class="stat-value ${runwayCls}">${runwayLabel}</span>
      <span class="stat-sub ${runwayCls}">${runwaySub}</span>
    </div>
  `;
}

function renderCashChart() {
  const colors = THEME_COLORS[getTheme()];
  const rows = cashFlowProjection(CASHFLOW_MONTHS_AHEAD).rows;
  const labels = rows.map((r) => monthLabel(r.month));
  const balanceSeries = rows.map((r) => r.balance);

  const ctx = document.getElementById("cashChart");
  if (cashChart) cashChart.destroy();
  cashChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: t("chart_series_bank_balance"),
        data: balanceSeries,
        borderColor: colors.actual,
        backgroundColor: "transparent",
        tension: 0.25,
        pointRadius: 3,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
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

function renderCashTable() {
  const rows = cashFlowProjection(CASHFLOW_MONTHS_AHEAD).rows;
  let html = `<table class="monthly-table"><thead><tr>
    <th class="mt-name">${t("col_month")}</th>
    <th class="num" title="${t("hard_figure_title")}">${t("col_inflow")}</th>
    <th class="num" title="${t("hard_figure_title")}">${t("col_outflow")}</th>
    <th class="num" title="${t("operating_est_title")}">${t("operating_est_col")}</th>
    <th class="num" title="${t("tax_vat_title")}">${t("tax_vat_col")}</th>
    <th class="num">${t("col_net")}</th>
    <th class="num mt-summary">${t("col_running_balance")}</th>
  </tr></thead><tbody>`;
  rows.forEach((r) => {
    const netCls = r.net > 0 ? "under" : r.net < 0 ? "over" : "";
    const balCls = r.balance < 0 ? "over" : "";
    const taxCls = r.taxDue > 0 ? "over" : r.taxDue < 0 ? "under" : "";
    const opCls = r.operating > 0 ? "under" : r.operating < 0 ? "over" : "";
    html += `<tr>
      <td class="mt-name">${monthLabel(r.month)}</td>
      <td class="num">${r.inflow ? fmtMkr(r.inflow) : "–"}</td>
      <td class="num">${r.outflow ? fmtMkr(r.outflow) : "–"}</td>
      <td class="num ${opCls} mt-forecast">${r.operating ? fmtMkrSigned(r.operating) : "–"}</td>
      <td class="num ${taxCls} mt-forecast">${r.taxDue ? fmtMkrSigned(-r.taxDue) : "–"}</td>
      <td class="num ${netCls}">${fmtMkrSigned(r.net)}</td>
      <td class="num mt-summary ${balCls}">${fmtMkr(r.balance)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  document.getElementById("cashTable").innerHTML = html;
}

function renderOpenInvoices() {
  const panel = document.getElementById("openInvoicesPanel");
  const container = document.getElementById("openInvoicesTable");
  if (OPEN_INVOICES.length === 0) {
    container.innerHTML = `<p class="table-hint">${t("no_invoices_hint")}</p>`;
    return;
  }
  let html = `<table class="monthly-table"><thead><tr>
    <th class="mt-name">${t("col_due")}</th>
    <th class="mt-name">${t("col_type")}</th>
    <th class="mt-name">${t("col_counterparty")}</th>
    <th class="mt-name">${t("col_description")}</th>
    <th class="num">${t("col_amount")}</th>
  </tr></thead><tbody>`;
  OPEN_INVOICES.forEach((inv) => {
    html += `<tr>
      <td class="mt-name">${fmtDate(inv.dueDate)}</td>
      <td class="mt-name">${inv.kind === "customer" ? t("ar_in") : t("ap_out")}</td>
      <td class="mt-name">${escapeHtml(inv.counterparty || "—")}</td>
      <td class="mt-name">${escapeHtml(inv.description || "")}</td>
      <td class="num">${fmtSek(inv.amount)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

function emptyCashflowHtml() {
  return `
    <div class="empty-state">
      <h2>${t("no_cash_data_h2")}</h2>
      <p>${t("no_cash_data_p")}</p>
      <a class="empty-cta" href="monthly.html">${t("connect_sync_fortnox")}</a>
    </div>`;
}

function renderCashflowPage() {
  const empty = document.getElementById("emptyState");

  if (!CASH_POSITION) {
    document.querySelectorAll(".stats-row, .main-row, .table-panel").forEach((el) => (el.style.display = "none"));
    empty.innerHTML = emptyCashflowHtml();
    empty.hidden = false;
    return;
  }
  document.querySelectorAll(".stats-row, .main-row, .table-panel").forEach((el) => (el.style.display = ""));
  empty.hidden = true;

  renderCashStats();
  renderCashChart();
  renderCashTable();
  renderOpenInvoices();
}

function initCashflow() {
  renderCashflowPage();
}

window.onThemeChanged = () => {
  if (CASH_POSITION) renderCashChart();
};
window.refreshAfterPeriodChange = renderCashflowPage;

window.initPage = initCashflow;
