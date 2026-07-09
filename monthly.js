let currentLens = "fy"; // "fy" | "rolling"
// Periodization lens: OFF by default ("show honestly" — the actuals-only rule
// stays sacred, this never touches real data). When ON, a cost centre's booked
// actuals display as their period average instead of the raw lumpy monthly
// figure — e.g. one annual insurance payment in March no longer reads as a
// spike with everything else near-zero. Purely a display transform: average ×
// count = the same sum, so FY/company totals are computed from the real
// monthAmount() and never change; drill-down still shows the real month.
let smoothActuals = false;

function smoothedActual(cc) {
  const vals = [];
  for (let m = 1; m <= CLOSE_MONTH; m++) { const v = cc.actualMonthly[m - 1]; if (v != null) vals.push(v); }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

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

function monthCell(value, isActual, isDivider, ccId, month, isOverridden, isSmoothed) {
  // Actual cells are drillable ("what's in this number?"); forecast cells aren't.
  const drill = isActual && ccId ? ` mt-drill" data-cc="${ccId}" data-m="${month}` : "";
  // A run-rate override, or a smoothed display value, is visibly distinct from
  // the real driver plan / raw booked figure — never silent.
  const cls = (isActual ? "" : "mt-forecast") + (isDivider ? " mt-divider" : "") + (isOverridden ? " mt-override" : "") + (isSmoothed ? " mt-smoothed" : "");
  // A booked-but-empty cell (actual = 0, not smoothed) reads as "nothing booked" — show a dash.
  const display = isActual && !isSmoothed && value === 0 ? "–" : fmtCell(value);
  const title = isOverridden ? ` title="Using a re-forecast run-rate override, not the driver plan"`
    : isSmoothed ? ` title="Smoothed — the period average, not the raw booked figure. Click to see the real month."` : "";
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
  let html = `<table class="monthly-table"><thead><tr><th class="mt-name">Reporting Line</th>`;
  months.forEach((m) => {
    const forecast = m > CLOSE_MONTH;
    const divider = m === CLOSE_MONTH + 1;
    html += `<th class="num ${forecast ? "mt-forecast" : ""} ${divider ? "mt-divider" : ""}">${monthLabel(m)}</th>`;
  });
  html += isFy
    ? `<th class="num mt-summary">FY Total</th><th class="num mt-summary">Budget</th><th class="num mt-summary">Variance</th>`
    : `<th class="num mt-summary">12-mo Total</th>`;
  html += `</tr></thead><tbody>`;

  // One row per reporting line
  COST_CENTERS.forEach((cc) => {
    const smoothed = smoothActuals ? smoothedActual(cc) : null;
    html += `<tr><td class="mt-name">${escapeHtml(cc.name)}</td>`;
    months.forEach((m) => {
      const { value, isActual, isOverridden } = monthAmount(cc, m);
      // Display-only substitution — the drill-down (cc.id/m) still points at
      // the real month, so clicking always shows what actually happened.
      const shown = isActual && smoothed != null ? smoothed : value;
      html += monthCell(shown, isActual, m === CLOSE_MONTH + 1, cc.id, m, isOverridden, isActual && smoothed != null);
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

  // Company total row — smoothed consistently with the per-cc rows above
  // (sum of smoothed = smoothed sum, since averaging is linear).
  let smoothedTotal = null;
  if (smoothActuals) {
    const vals = [];
    for (let m = 1; m <= CLOSE_MONTH; m++) vals.push(companyMonthAmount(m));
    smoothedTotal = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  html += `<tr class="mt-total"><td class="mt-name">Total</td>`;
  months.forEach((m) => {
    const isActualM = m <= CLOSE_MONTH;
    const shown = isActualM && smoothedTotal != null ? smoothedTotal : companyMonthAmount(m);
    html += monthCell(shown, isActualM, m === CLOSE_MONTH + 1, null, m, false, isActualM && smoothedTotal != null);
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
    ["Reporting Line", ...months.map(monthLabel), ...(isFy ? ["FY Total", "Budget", "Variance"] : ["12-mo Total"])].join(";")
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
      <p class="drill-sub">Booked actuals by account — straight from your ledger.</p>
      ${rows.length === 0 ? `<p class="drill-empty">No transactions behind this cell${cc ? "" : ""} — run a sync to populate drill data.</p>` : `
      <div class="drill-rows">
        ${rows.map((r) => `
          <div class="drill-row">
            <span><span class="fn-cc-code">${r.account}</span> ${escapeHtml(r.account_name || "")}</span>
            <span class="drill-n">${r.tx_count} tx</span>
            <span class="num">${fmtSek(Number(r.amount))}</span>
          </div>`).join("")}
        <div class="drill-row drill-total"><span>Total</span><span></span><span class="num">${fmtSek(total)}</span></div>
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
    if (parsed.unmatched.length) msg += ` <span class="import-warn">Unmatched reporting lines (skipped): ${parsed.unmatched.map(escapeHtml).join(", ")}.</span>`;
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
  document.getElementById("smoothToggle").addEventListener("change", (e) => {
    smoothActuals = e.target.checked;
    renderMonthlyGrid();
  });
  document.getElementById("exportBtn").addEventListener("click", downloadExport);
  initDrill();
  initImport();
  handleFortnoxRedirect();
  renderIntegrationPanel(document.getElementById("integrationPanel"));
  renderMonthlyGrid();
  // Dev hooks for headless verification.
  if (location.hash === "#drilltest" && COST_CENTERS.length) showDrill(COST_CENTERS[0].id, 3);
  if (location.hash === "#maptest" && typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    // Render the mapping editor with a mixed mapped/unmapped list so the
    // "Import all" path is screenshot-verifiable without a live Fortnox org.
    lastCostCenters = [
      { code: "1", name: "Produktion", cost: 14200000, mapped: true },
      { code: "2", name: "Försäljning", cost: 8300000, mapped: false },
      { code: "3", name: "Lager & Logistik", cost: 5100000, mapped: false },
      { code: "4", name: "Administration", cost: 2400000, mapped: false },
    ];
    const host = document.getElementById("integrationPanel");
    host.innerHTML = `<div class="integration-card connected"><div class="integ-mapping" id="fnMapping"></div></div>`;
    renderMappingEditor(host.querySelector("#fnMapping"));
  }
  if (location.hash === "#csvtest") {
    document.getElementById("monthlyGrid").innerHTML = `<pre style="font-size:11px">${escapeHtml(buildExportCsv())}</pre>`;
  }
  if (location.hash === "#smoothtest") {
    document.getElementById("smoothToggle").checked = true;
    smoothActuals = true;
    renderMonthlyGrid();
  }
}

// Re-render when a month is closed from the sidebar.
window.refreshAfterPeriodChange = renderMonthlyGrid;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initMonthly;
