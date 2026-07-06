let currentLens = "fy"; // "fy" | "rolling"

// Compact cell value — just the number in mkr (the unit is stated once in the hint).
function fmtCell(n) {
  return (n / 1_000_000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
  return `<td class="num ${cls}">${fmtCell(value)}</td>`;
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
  initImport();
  handleFortnoxRedirect();
  renderIntegrationPanel(document.getElementById("integrationPanel"));
  renderMonthlyGrid();
}

// Re-render when a month is closed from the sidebar.
window.refreshAfterPeriodChange = renderMonthlyGrid;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initMonthly;
