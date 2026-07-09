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
  const runwayLabel = runway == null ? "Cash-positive" : `${runway} mo${runway === 1 ? "" : "s"}`;
  const runwayCls = runway != null && runway <= 3 ? "over" : "";
  const runwaySub = runway == null
    ? `holds beyond ${RUNWAY_HORIZON_MONTHS - cashFlowMonthIndex(new Date().toISOString().slice(0, 10)) + 1} months at current plan`
    : "until balance would cross zero, at current plan";

  row.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Bank Balance</span>
      <span class="stat-value">${fmtMkr(CASH_POSITION.bankBalance)}</span>
      <span class="stat-sub">as of ${fmtDate(CASH_POSITION.asOf.slice(0, 10))}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Open Receivables (AR)</span>
      <span class="stat-value">${fmtMkr(totalAr)}</span>
      <span class="stat-sub">${OPEN_INVOICES.filter((i) => i.kind === "customer").length} unpaid customer invoices</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Open Payables (AP)</span>
      <span class="stat-value">${fmtMkr(totalAp)}</span>
      <span class="stat-sub">${OPEN_INVOICES.filter((i) => i.kind === "supplier").length} unpaid supplier invoices</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-label">Projected Balance</span>
      <span class="stat-value ${cls}">${fmtMkr(endBalance)}</span>
      <span class="stat-sub ${cls}">in ${CASHFLOW_MONTHS_AHEAD} months, incl. estimates</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-label" title="Estimated from the driver forecast (salaries, recurring, one-offs) and the monthly revenue plan — not a hard figure">Runway</span>
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
        label: "Bank Balance",
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
    <th class="mt-name">Month</th>
    <th class="num" title="Hard figures from unpaid Fortnox invoices">Inflow</th>
    <th class="num" title="Hard figures from unpaid Fortnox invoices">Outflow</th>
    <th class="num" title="Estimated from the driver forecast (salaries, recurring costs, one-offs) netted against the monthly revenue plan (or a flat target ÷ 12 when no plan is set) — not a hard Fortnox figure">Operating (est.)</th>
    <th class="num" title="Estimated from tracked VAT/payroll-tax account balances + Skatteverket deadline rules — not a hard Fortnox figure">Tax/VAT (est.)</th>
    <th class="num">Net</th>
    <th class="num mt-summary">Running Balance</th>
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
    container.innerHTML = `<p class="table-hint">No unpaid invoices on file — either your books are current, or this org hasn't synced open invoices yet.</p>`;
    return;
  }
  let html = `<table class="monthly-table"><thead><tr>
    <th class="mt-name">Due</th>
    <th class="mt-name">Type</th>
    <th class="mt-name">Counterparty</th>
    <th class="mt-name">Description</th>
    <th class="num">Amount</th>
  </tr></thead><tbody>`;
  OPEN_INVOICES.forEach((inv) => {
    html += `<tr>
      <td class="mt-name">${fmtDate(inv.dueDate)}</td>
      <td class="mt-name">${inv.kind === "customer" ? "AR (in)" : "AP (out)"}</td>
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
      <h2>No cash data yet</h2>
      <p>Bank balance and open invoices come in automatically with your Fortnox sync.</p>
      <a class="empty-cta" href="monthly.html">Connect / sync Fortnox →</a>
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
