let currentLens = "fy"; // "fy" | "rolling"

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
  for (let m = 1; m <= FY_MONTHS; m++) a.push(m);
  return a;
}

function monthCell(value, isActual, isDivider) {
  const cls = (isActual ? "" : "mt-forecast") + (isDivider ? " mt-divider" : "");
  // A booked-but-empty cell (actual = 0) reads as "nothing booked" — show a dash.
  const display = isActual && value === 0 ? "–" : fmtCell(value);
  return `<td class="num ${cls}">${display}</td>`;
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
  let html = `<table class="monthly-table"><thead><tr><th class="mt-name">Cost Center</th>`;
  months.forEach((m) => {
    const forecast = m > CLOSE_MONTH;
    const divider = m === CLOSE_MONTH + 1;
    html += `<th class="num ${forecast ? "mt-forecast" : ""} ${divider ? "mt-divider" : ""}">${monthLabel(m)}</th>`;
  });
  html += isFy
    ? `<th class="num mt-summary">FY Total</th><th class="num mt-summary">Budget</th><th class="num mt-summary">Variance</th>`
    : `<th class="num mt-summary">12-mo Total</th>`;
  html += `</tr></thead><tbody>`;

  // One row per cost center
  COST_CENTERS.forEach((cc) => {
    html += `<tr><td class="mt-name">${cc.name}</td>`;
    months.forEach((m) => {
      const { value, isActual } = monthAmount(cc, m);
      html += monthCell(value, isActual, m === CLOSE_MONTH + 1);
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
  html += `<tr class="mt-total"><td class="mt-name">Total</td>`;
  months.forEach((m) => {
    html += monthCell(companyMonthAmount(m), m <= CLOSE_MONTH, m === CLOSE_MONTH + 1);
  });
  if (isFy) {
    const t = companyFySummary();
    const cls = varianceClass(t.variance, t.budget);
    html += `<td class="num mt-summary">${fmtCell(t.total)}</td>`;
    html += `<td class="num mt-summary">${fmtCell(t.budget)}</td>`;
    html += `<td class="num mt-summary ${cls}">${fmtMkrSigned(t.variance)}</td>`;
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
    ["Cost Center", ...months.map(monthLabel), ...(isFy ? ["FY Total", "Budget", "Variance"] : ["12-mo Total"])].join(";")
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
    const t = companyFySummary();
    totalCells.push(num(t.total), num(t.budget), num(t.variance));
  } else {
    totalCells.push(num(companyRollingSummary().total));
  }
  lines.push(["Total", ...totalCells].join(";"));

  return "﻿" + lines.join("\r\n"); // BOM so Excel reads åäö correctly
}

function downloadExport() {
  const blob = new Blob([buildExportCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `monthly-pnl-${currentLens === "fy" ? "FY2026" : "rolling12"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function initImport() {
  const panel = document.getElementById("importPanel");
  const textArea = document.getElementById("csvText");
  const fileInput = document.getElementById("csvFile");
  const preview = document.getElementById("importPreview");
  const doBtn = document.getElementById("doImportBtn");
  let parsed = { rows: [], unmatched: [], skipped: 0 };

  document.getElementById("importActualsBtn").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  function refreshPreview() {
    if (!textArea.value.trim()) {
      parsed = { rows: [], unmatched: [], skipped: 0 };
      preview.innerHTML = "";
      doBtn.disabled = true;
      return;
    }
    parsed = parseActualsCsv(textArea.value);
    let msg = `<strong>${parsed.rows.length}</strong> value(s) ready to import.`;
    if (parsed.unmatched.length) msg += ` <span class="import-warn">Unmatched cost centers (skipped): ${parsed.unmatched.join(", ")}.</span>`;
    if (parsed.skipped) msg += ` ${parsed.skipped} row(s) skipped.`;
    preview.innerHTML = msg;
    doBtn.disabled = parsed.rows.length === 0;
  }

  textArea.addEventListener("input", refreshPreview);
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files[0]) return;
    textArea.value = await fileInput.files[0].text();
    refreshPreview();
  });

  doBtn.addEventListener("click", async () => {
    if (parsed.rows.length === 0) return;
    doBtn.disabled = true;
    const ok = await dbUpsertActuals(parsed.rows);
    if (ok) location.reload();
    else doBtn.disabled = false;
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
  initImport();
  handleFortnoxRedirect();
  renderIntegrationPanel(document.getElementById("integrationPanel"));
  renderMonthlyGrid();
  // Dev hook: #csvtest renders the export inline so it can be verified headless.
  if (location.hash === "#csvtest") {
    document.getElementById("monthlyGrid").innerHTML = `<pre style="font-size:11px">${buildExportCsv().replace(/</g, "&lt;")}</pre>`;
  }
}

// Re-render when a month is closed from the sidebar.
window.refreshAfterPeriodChange = renderMonthlyGrid;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initMonthly;
