// report.js — the månadsrapport: the artifact an SME actually hands to a bank,
// a board or an accountant.
//
// Why this exists as its own page rather than "print the dashboard": a report
// is a document, not a screenshot. It leads with the verdict, states the
// figures once, carries the owner's own commentary, and says where the numbers
// came from. Printing the Overview gave you panels, collapsed sections and a
// legend — a board pack has to survive being read without you in the room.
//
// Rendered from the same engine as every other page, so it can never disagree
// with what the app shows. No PDF library: the browser's print-to-PDF is
// excellent and keeps the app build-free.

function reportPeriodLabel() {
  const through = CLOSE_MONTH >= FY_WINDOW_START && CLOSE_MONTH <= fyWindowEnd()
    ? monthLabel(CLOSE_MONTH) : null;
  return through ? t("report_period", fyName(), through) : t("report_period_none", fyName());
}

// The one-line verdict, in the same words the Overview uses — a reader who has
// seen the app should recognise the sentence.
function reportVerdict(fy) {
  const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
  const onPlan = Math.abs(pct) <= 1;
  return {
    text: onPlan ? t("verdict_on_plan") : fy.variance > 0 ? t("verdict_over_budget") : t("verdict_under_budget"),
    cls: onPlan ? "under" : varianceClass(fy.variance, fy.budget),
    pct,
  };
}

function reportKeyFigures(fy, revenue) {
  const cells = [];
  const push = (label, value, sub = "") =>
    cells.push(`<div class="rep-fig"><span class="rep-fig-label">${label}</span><span class="rep-fig-value">${value}</span>${sub ? `<span class="rep-fig-sub">${sub}</span>` : ""}</div>`);

  if (revenue) push(t("report_revenue"), fmtMkr(revenue), t("report_planned"));
  push(t("report_cost_total"), fmtMkr(fy.total), t("report_booked_plus_forecast"));
  push(t("stat_annual_budget", fyName()), fmtMkr(fy.budget));
  if (revenue) {
    const result = revenue - fy.total;
    const margin = Math.round((result / revenue) * 100);
    push(t("pnl_result"), fmtMkrSigned(result), t("report_margin", margin));
  } else {
    push(t("col_variance"), fmtMkrSigned(fy.variance), fy.budget ? `${(fy.variance / fy.budget * 100).toFixed(1)}%` : "");
  }
  return `<div class="rep-figs">${cells.join("")}</div>`;
}

// Per-line result: budget, where the year is heading, and the gap. Booked
// actuals are shown separately so a reader can see how much of the number is
// already fact rather than forecast — the distinction the whole product rests on.
function reportLineTable() {
  const bookedThrough = Math.min(CLOSE_MONTH, fyWindowEnd());
  const rows = COST_CENTERS.map((cc) => {
    const fy = fySummary(cc);
    let booked = 0;
    for (let m = FY_WINDOW_START; m <= bookedThrough; m++) booked += monthAmount(cc, m).value;
    const cls = varianceClass(fy.variance, fy.budget);
    const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(cc.name)}</td>
      <td class="num">${fmtMkr(fy.budget)}</td>
      <td class="num">${fmtMkr(booked)}</td>
      <td class="num">${fmtMkr(fy.total)}</td>
      <td class="num ${cls}">${fmtMkrSigned(fy.variance)}${fy.budget ? ` <span class="rep-pct">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>` : ""}</td>
    </tr>`;
  }).join("");

  const ft = companyFySummary();
  let bookedTotal = 0;
  for (let m = FY_WINDOW_START; m <= bookedThrough; m++) bookedTotal += companyMonthAmount(m);
  const tCls = varianceClass(ft.variance, ft.budget);
  const tPct = ft.budget ? (ft.variance / ft.budget) * 100 : 0;

  return `
    <table class="rep-table rep-table-result">
      <thead><tr>
        <th>${t("col_reporting_line")}</th>
        <th class="num">${t("col_budget")}</th>
        <th class="num">${t("report_col_booked")}</th>
        <th class="num">${t("col_fy_total", fyName())}</th>
        <th class="num">${t("col_variance")}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>${t("col_total")}</td>
        <td class="num">${fmtMkr(ft.budget)}</td>
        <td class="num">${fmtMkr(bookedTotal)}</td>
        <td class="num">${fmtMkr(ft.total)}</td>
        <td class="num ${tCls}">${fmtMkrSigned(ft.variance)}${ft.budget ? ` <span class="rep-pct">${tPct > 0 ? "+" : ""}${tPct.toFixed(1)}%</span>` : ""}</td>
      </tr></tfoot>
    </table>`;
}

// Commentary: the notes the owner already wrote on their lines. A board pack
// without explanation is just numbers — and these are explanations written by
// the person who knows why, not generated prose.
function reportCommentary() {
  const noted = COST_CENTERS.filter((cc) => (cc.note || "").trim());
  if (!noted.length) return "";
  return `
    <section class="rep-section">
      <h2>${t("report_commentary_h2")}</h2>
      <dl class="rep-notes">
        ${noted.map((cc) => `<dt>${escapeHtml(cc.name)}</dt><dd>${escapeHtml(cc.note)}</dd>`).join("")}
      </dl>
    </section>`;
}

function reportCash() {
  if (!CASH_POSITION) return "";
  const proj = cashFlowProjection(6);
  if (!proj || !proj.rows.length) return "";
  const end = proj.rows[proj.rows.length - 1].balance;
  const runway = proj.runway == null
    ? t("report_runway_positive")
    : t("report_runway_months", proj.runway);
  return `
    <section class="rep-section">
      <h2>${t("report_cash_h2")}</h2>
      <div class="rep-figs">
        <div class="rep-fig"><span class="rep-fig-label">${t("stat_bank_balance")}</span><span class="rep-fig-value">${fmtMkr(CASH_POSITION.bankBalance)}</span><span class="rep-fig-sub">${t("stat_as_of", CASH_POSITION.asOf.slice(0, 10))}</span></div>
        <div class="rep-fig"><span class="rep-fig-label">${t("stat_projected_balance")}</span><span class="rep-fig-value">${fmtMkr(end)}</span><span class="rep-fig-sub">${t("stat_projected_sub", 6)}</span></div>
        <div class="rep-fig"><span class="rep-fig-label">${t("runway_label")}</span><span class="rep-fig-value">${runway}</span></div>
      </div>
      <p class="rep-fine">${t("report_cash_fine")}</p>
    </section>`;
}

function reportHeadcount() {
  const rows = COST_CENTERS.map((cc) => ({ name: cc.name, heads: fyAverageHeadcount(cc) + utilizationAvgHeads(cc) }))
    .filter((r) => r.heads > 0.05);
  if (!rows.length) return "";
  const total = rows.reduce((s, r) => s + r.heads, 0);
  return `
    <section class="rep-section">
      <h2>${t("report_headcount_h2")}</h2>
      <table class="rep-table rep-table-narrow">
        <thead><tr><th>${t("col_reporting_line")}</th><th class="num">${t("report_col_avg_heads")}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.heads.toFixed(1)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>${t("col_total")}</td><td class="num">${total.toFixed(1)}</td></tr></tfoot>
      </table>
    </section>`;
}

// Provenance. The trust claim is the product: say plainly where the booked
// figures came from, how the rest is built, and what is an estimate.
function reportProvenance() {
  const source = SYNC_STATUS && SYNC_STATUS.last_synced_at
    ? t("report_source_fortnox", new Date(SYNC_STATUS.last_synced_at).toLocaleDateString("sv-SE"))
    : t("report_source_manual");
  const through = CLOSE_MONTH >= FY_WINDOW_START && CLOSE_MONTH <= fyWindowEnd() ? monthLabel(CLOSE_MONTH) : null;
  return `
    <footer class="rep-provenance">
      <p><strong>${t("report_provenance_h")}</strong> ${source}
      ${through ? t("report_provenance_through", through) : ""}
      ${t("report_provenance_forecast")}</p>
      <p class="rep-fine">${t("report_generated", new Date().toLocaleDateString("sv-SE"))}</p>
    </footer>`;
}

function renderReport() {
  const host = document.getElementById("reportDoc");
  if (!host) return;
  if (COST_CENTERS.length === 0) {
    host.innerHTML = `<p class="rep-fine">${t("report_empty")}</p>`;
    return;
  }

  const orgName = (USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {}).name || "";
  const fy = companyFySummary();
  const revenue = revenuePlanFyTotal();
  const verdict = reportVerdict(fy);
  const planName = activeVersion() ? versionDisplayName(activeVersion()) : "";

  host.innerHTML = `
    <header class="rep-head">
      <div>
        <h1 class="rep-org">${escapeHtml(orgName)}</h1>
        <p class="rep-kicker">${t("report_title")} · ${reportPeriodLabel()}${planName ? ` · ${escapeHtml(planName)}` : ""}</p>
      </div>
    </header>

    <section class="rep-verdict-row">
      <span class="rep-verdict ${verdict.cls}">${verdict.text}</span>
      <span class="rep-verdict-num ${varianceClass(fy.variance, fy.budget)}">${fmtMkrSigned(fy.variance)} ${t("report_vs_budget")}</span>
    </section>

    ${reportKeyFigures(fy, revenue)}

    <section class="rep-section">
      <h2>${t("report_result_h2")}</h2>
      ${reportLineTable()}
    </section>

    ${reportCommentary()}
    ${reportCash()}
    ${reportHeadcount()}
    ${reportProvenance()}`;
}

function initReport() {
  renderReport();
  const btn = document.getElementById("reportPrintBtn");
  if (btn) btn.addEventListener("click", () => window.print());
}

// Print in the light palette regardless of the user's theme — a PDF that
// arrives in dark mode looks broken on paper.
let _repPrevTheme = null;
window.addEventListener("beforeprint", () => {
  _repPrevTheme = getTheme();
  if (_repPrevTheme !== "light") applyTheme("light");
});
window.addEventListener("afterprint", () => {
  if (_repPrevTheme && _repPrevTheme !== "light") applyTheme(_repPrevTheme);
});

window.refreshAfterPeriodChange = renderReport;
window.initPage = initReport;
