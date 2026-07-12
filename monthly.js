let currentLens = "fy"; // "fy" | "rolling"
// (The "spread lumpy actuals" smoothing lens was removed — killed per feedback
// #6: no competitor does it, low value, and it fought "actuals are as-is".)

// Compact cell value — just the number in the org's display unit (stated once in the hint).
function fmtCell(n) {
  const u = unitCfg();
  return (n / u.div).toLocaleString("sv-SE", { minimumFractionDigits: u.dec, maximumFractionDigits: u.dec });
}

function lensMonths() {
  if (currentLens === "rolling") {
    const { start, end } = rollingWindow();
    const a = [];
    for (let m = start; m <= end; m++) a.push(m);
    return a;
  }
  const a = [];
  for (let m = FY_WINDOW_START; m <= fyWindowEnd(); m++) a.push(m);
  return a;
}

function monthCell(value, isActual, isDivider, ccId, month, isOverridden) {
  // Actual cells are drillable ("what's in this number?"); forecast cells aren't.
  const drill = isActual && ccId ? ` mt-drill" data-cc="${ccId}" data-m="${month}` : "";
  // A run-rate override is visibly distinct from the real driver plan — never silent.
  const cls = (isActual ? "" : "mt-forecast") + (isDivider ? " mt-divider" : "") + (isOverridden ? " mt-override" : "");
  // A booked-but-empty cell (actual = 0) reads as "nothing booked" — show a dash.
  const display = isActual && value === 0 ? "–" : fmtCell(value);
  const title = isOverridden ? ` title="${t("drill_override_title")}"` : "";
  return `<td class="num ${cls}${drill}"${title}>${display}</td>`;
}

function renderMonthlyGrid() {
  const sections = document.querySelectorAll(".lens-controls, .table-hint, .actuals-import, .panel");
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

  const unitEl = document.getElementById("unitLabel");
  if (unitEl) unitEl.textContent = DISPLAY_UNIT;

  const months = lensMonths();
  const isFy = currentLens === "fy";

  // Header
  let html = `<table class="monthly-table"><thead><tr><th class="mt-name">${t("col_reporting_line")}</th>`;
  months.forEach((m) => {
    const forecast = m > CLOSE_MONTH;
    const divider = m === CLOSE_MONTH + 1;
    html += `<th class="num ${forecast ? "mt-forecast" : ""} ${divider ? "mt-divider" : ""}">${monthLabel(m)}</th>`;
  });
  html += isFy
    ? `<th class="num mt-summary">${t("col_fy_total_short")}</th><th class="num mt-summary">${t("col_budget")}</th><th class="num mt-summary">${t("col_variance")}</th>`
    : `<th class="num mt-summary">${t("col_12mo_total")}</th>`;
  html += `</tr></thead><tbody>`;

  // One row per reporting line
  COST_CENTERS.forEach((cc) => {
    html += `<tr><td class="mt-name">${escapeHtml(cc.name)}</td>`;
    months.forEach((m) => {
      const { value, isActual, isOverridden } = monthAmount(cc, m);
      html += monthCell(value, isActual, m === CLOSE_MONTH + 1, cc.id, m, isOverridden);
    });
    if (isFy) {
      const fy = fySummary(cc);
      const cls = varianceClass(fy.variance, fy.budget);
      html += `<td class="num mt-summary">${fmtCell(fy.total)}</td>`;
      html += `<td class="num mt-summary">${fmtCell(fy.budget)}</td>`;
      html += `<td class="num mt-summary ${cls}">${fmtMkrSigned(fy.variance)}</td>`;
    } else {
      html += `<td class="num mt-summary">${fmtCell(rollingSummary(cc).total)}</td>`;
    }
    html += `</tr>`;
  });

  // Company total row
  html += `<tr class="mt-total"><td class="mt-name">${t("col_total")}</td>`;
  months.forEach((m) => {
    const isActualM = m <= CLOSE_MONTH;
    html += monthCell(companyMonthAmount(m), isActualM, m === CLOSE_MONTH + 1, null, m, false);
  });
  if (isFy) {
    const ft = companyFySummary();
    const cls = varianceClass(ft.variance, ft.budget);
    html += `<td class="num mt-summary">${fmtCell(ft.total)}</td>`;
    html += `<td class="num mt-summary">${fmtCell(ft.budget)}</td>`;
    html += `<td class="num mt-summary ${cls}">${fmtMkrSigned(ft.variance)}</td>`;
  } else {
    html += `<td class="num mt-summary">${fmtCell(companyRollingSummary().total)}</td>`;
  }
  html += `</tr></tbody></table>`;

  document.getElementById("monthlyGrid").innerHTML = html;
}

// ---- Export (Excel) ---------------------------------------------------------
// Swedish-Excel-friendly CSV: BOM + "sep=;" + semicolon separators + comma
// decimals — opens as clean columns in sv-SE Excel with no import wizard.
function buildExportCsv() {
  const months = lensMonths();
  const isFy = currentLens === "fy";
  const num = (n) => String(Math.round(n)); // whole SEK
  const lines = [];

  lines.push("sep=;");
  const orgName = (USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {}).name || "";
  lines.push(`${orgName} — Monthly P&L (SEK); exported ${new Date().toLocaleDateString("sv-SE")}`);
  lines.push(
    [t("col_reporting_line"), ...months.map(monthLabel), ...(isFy ? [t("col_fy_total_short"), t("col_budget"), t("col_variance")] : [t("col_12mo_total")])].join(";")
  );

  COST_CENTERS.forEach((cc) => {
    const cells = months.map((m) => num(monthAmount(cc, m).value));
    if (isFy) {
      const fy = fySummary(cc);
      cells.push(num(fy.total), num(fy.budget), num(fy.variance));
    } else {
      cells.push(num(rollingSummary(cc).total));
    }
    lines.push([cc.name, ...cells].join(";"));
  });

  const totalCells = months.map((m) => num(companyMonthAmount(m)));
  if (isFy) {
    const ft = companyFySummary();
    totalCells.push(num(ft.total), num(ft.budget), num(ft.variance));
  } else {
    totalCells.push(num(companyRollingSummary().total));
  }
  lines.push([t("col_total"), ...totalCells].join(";"));

  return "﻿" + lines.join("\r\n"); // BOM so Excel reads åäö correctly
}

function downloadExport() {
  const blob = new Blob([buildExportCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `monthly-pnl-${currentLens === "fy" ? fyName() : "rolling12"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Drill-down: what's inside an actual cell -------------------------------

async function loadDrill(ccId, month) {
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    return [
      { account: 7010, account_name: "Löner", amount: 1650000, tx_count: 1 },
      { account: 4010, account_name: "Inköp material", amount: 520000, tx_count: 14 },
      { account: 5010, account_name: "Lokalhyra", amount: 118000, tx_count: 1 },
      { account: 6540, account_name: "IT-tjänster", amount: 62000, tx_count: 3 },
    ];
  }
  const { data } = await sb.from("actual_detail")
    .select("account, account_name, amount, tx_count")
    .eq("org_id", CURRENT_ORG_ID).eq("reporting_line_id", ccId).eq("month", month)
    .order("amount", { ascending: false });
  return data || [];
}

async function showDrill(ccId, month) {
  const cc = COST_CENTERS.find((c) => c.id === ccId);
  const rows = await loadDrill(ccId, month);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const old = document.getElementById("drillOverlay");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "drillOverlay";
  el.className = "drill-overlay";
  el.innerHTML = `
    <div class="drill-card">
      <div class="drill-head">
        <h3>${cc ? escapeHtml(cc.name) : ""} — ${monthLabel(month)}</h3>
        <button class="drill-close" type="button">✕</button>
      </div>
      <p class="drill-sub">${t("drill_sub")}</p>
      ${rows.length === 0 ? `<p class="drill-empty">${t("drill_empty")}</p>` : `
      <div class="drill-rows">
        ${rows.map((r) => `
          <div class="drill-row">
            <span><span class="fn-cc-code">${r.account}</span> ${escapeHtml(r.account_name || "")}</span>
            <span class="drill-n">${t("drill_tx", r.tx_count)}</span>
            <span class="num">${fmtSek(Number(r.amount))}</span>
          </div>`).join("")}
        <div class="drill-row drill-total"><span>${t("col_total")}</span><span></span><span class="num">${fmtSek(total)}</span></div>
      </div>`}
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el || e.target.classList.contains("drill-close")) el.remove(); });
}

function initDrill() {
  document.getElementById("monthlyGrid").addEventListener("click", (e) => {
    const td = e.target.closest("td.mt-drill");
    if (td) showDrill(td.dataset.cc, Number(td.dataset.m));
  });
}

function initMonthly() {
  document.querySelectorAll(".lens-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentLens = btn.dataset.lens;
      document.querySelectorAll(".lens-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderMonthlyGrid();
    });
  });
  document.getElementById("exportBtn").addEventListener("click", downloadExport);
  initDrill();
  renderMonthlyGrid();
  // Dev hooks for headless verification.
  if (location.hash === "#drilltest" && COST_CENTERS.length) showDrill(COST_CENTERS[0].id, 3);
  if (location.hash === "#csvtest") {
    document.getElementById("monthlyGrid").innerHTML = `<pre style="font-size:11px">${escapeHtml(buildExportCsv())}</pre>`;
  }
}

// Re-render when a month is closed from the sidebar.
window.refreshAfterPeriodChange = renderMonthlyGrid;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initMonthly;
