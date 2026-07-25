// sie-import.js — the Data page's "import from your accounting system" flow.
// Parsing lives in sie.js (pure); this file is only UI + the write.
//
// Design: nothing is written until the user has seen (a) which company and
// year the file is for, (b) whether the transactions tie out to the file's own
// reported P&L, and (c) exactly which of their reporting lines each group of
// accounts will land on. A finance person's first question about any imported
// number is "where did this come from" — so the preview answers it up front.

let SIE_PARSED = null;   // last parsed file
let SIE_GROUPS = [];     // [{ key, label, accounts, monthly: {appMonth: amount}, total, lineId }]

// Cost accounts split by BAS class — the standard Swedish grouping, and the
// only sensible default when a file carries no cost-centre tags (as small-SME
// exports typically don't).
const SIE_CLASS_GROUPS = [
  { key: "cogs", test: (a) => a[0] === "4", labelKey: "sie_group_cogs" },
  { key: "opex", test: (a) => a[0] === "5" || a[0] === "6", labelKey: "sie_group_opex" },
  { key: "personnel", test: (a) => a[0] === "7", labelKey: "sie_group_personnel" },
];

// Build the importable groups: booked cost per BAS class per APP month.
// SIE months are calendar; the app's timeline is fiscal-year-relative, so
// anything outside the current planning window is reported and skipped rather
// than silently folded into month 1.
function sieBuildGroups(parsed) {
  const groups = SIE_CLASS_GROUPS.map((g) => ({ ...g, label: t(g.labelKey), accounts: new Set(), monthly: {}, total: 0 }));
  let outsideWindow = 0;

  for (const [ym, accts] of Object.entries(parsed.monthly)) {
    const appMonth = cashFlowMonthIndex(ym + "-01");
    const inWindow = appMonth >= 1 && appMonth <= TIMELINE_LENGTH;
    for (const [acct, amt] of Object.entries(accts)) {
      const g = groups.find((x) => x.test(acct));
      if (!g || !amt) continue;
      g.accounts.add(acct);
      g.total += amt;
      if (inWindow) g.monthly[appMonth] = (g.monthly[appMonth] || 0) + amt;
      else outsideWindow += Math.abs(amt);
    }
  }
  return { groups: groups.filter((g) => g.total !== 0), outsideWindow };
}

function sieLineOptions(selectedId) {
  const opts = COST_CENTERS.map((cc) =>
    `<option value="${cc.id}" ${cc.id === selectedId ? "selected" : ""}>${escapeHtml(cc.name)}</option>`).join("");
  return `<option value="">${t("sie_map_skip")}</option>${opts}` +
    `<option value="__new__" ${selectedId === "__new__" ? "selected" : ""}>${t("sie_map_create")}</option>`;
}

function sieRenderPreview() {
  const host = document.getElementById("sieResult");
  if (!host || !SIE_PARSED) return;
  const p = SIE_PARSED;
  const fy = p.fiscalYears.find((y) => y.index === 0);
  const pnl = siePnl(p, 0);
  // Prior-year figures are shown per row only when that row's accounts exist in
  // the comparison year. A file can carry last year's revenue but not its
  // costs, and printing "0 kr prior year" would state a zero we don't know.
  const prevRes = p.result[-1] || {};
  const prevHas = (test) => Object.keys(prevRes).some(test);
  const prev = Object.keys(prevRes).length ? siePnl(p, -1) : null;
  const prevCell = (value, known) =>
    prev && known ? `<td class="num pnl-py">${t("sie_prev_year", fmtSek(value))}</td>` : "<td></td>";
  const prevRevKnown = prevHas((a) => a[0] === "3");
  const prevCostKnown = prevHas((a) => /^[4-7]/.test(a));

  // Tie-out badge: our sum of the vouchers vs the file's own reported result.
  const tie = p.tieOut.ok
    ? `<span class="sie-tie ok">${t("sie_tie_ok", p.tieOut.accounts)}</span>`
    : `<span class="sie-tie bad">${t("sie_tie_bad", p.tieOut.mismatches, fmtSek(p.tieOut.worstDiff))}</span>`;

  // Honest note when the books are kept in a few big lumps: month-by-month
  // variance is then an artefact of when someone did the bookkeeping.
  const rhythm = sieBookingRhythm(p);
  const lumpy = rhythm.monthsWithData > 0 && (rhythm.concentration >= 0.6 || rhythm.monthsWithData <= 3);
  const rhythmNote = lumpy
    ? `<p class="sie-note">${t("sie_lumpy_note", rhythm.monthsWithData, Math.round(rhythm.concentration * 100))}</p>`
    : "";

  const { groups, outsideWindow } = sieBuildGroups(p);
  SIE_GROUPS = groups;
  // Nothing to import if every booked month falls outside the planning window
  // (e.g. last year's file) — say so plainly instead of letting the user pick a
  // target and then be told, unhelpfully, to pick a target.
  const importable = groups.some((g) => Object.keys(g.monthly).length > 0);
  const rows = groups.map((g, i) => {
    const months = Object.keys(g.monthly).length;
    return `<tr>
      <td>${escapeHtml(g.label)} <span class="sie-acc">${t("sie_accounts_n", g.accounts.size)}</span></td>
      <td class="num">${fmtSek(g.total)}</td>
      <td class="num">${months}</td>
      <td><select class="sie-map" data-siegroup="${i}">${sieLineOptions(g.lineId)}</select></td>
    </tr>`;
  }).join("");

  host.innerHTML = `
    <div class="sie-card">
      <div class="sie-head">
        <strong>${escapeHtml(p.company.name || t("sie_unknown_company"))}</strong>
        <span class="pnl-src">${escapeHtml(p.company.orgNr)}</span>
        ${fy ? `<span class="pnl-src">${fy.from} – ${fy.to}</span>` : ""}
        ${tie}
      </div>
      <p class="sie-sub">${t("sie_file_summary", p.vouchers, Object.keys(p.accounts).length)}</p>
      <table class="fn-recon-table sie-pnl">
        <tr><td>${t("pnl_revenue")}</td><td class="num">${fmtSek(pnl.revenue)}</td>
            ${prevCell(prev && prev.revenue, prevRevKnown)}</tr>
        <tr><td>${t("sie_total_cost")}</td><td class="num">${fmtSek(pnl.total_cost)}</td>
            ${prevCell(prev && prev.total_cost, prevCostKnown)}</tr>
        <tr><td><strong>${t("pnl_result")}</strong></td><td class="num"><strong>${fmtSek(pnl.result)}</strong></td>
            ${prevCell(prev && prev.result, prevRevKnown && prevCostKnown)}</tr>
      </table>
      ${rhythmNote}
      ${p.hasObjectTags ? `<p class="sie-note">${t("sie_has_objects")}</p>` : ""}
      ${groups.length ? `
        <h3 class="cc-section-label">${t("sie_map_h3")}</h3>
        <p class="rate-hint">${t("sie_map_hint")}</p>
        <div class="driver-table-wrap">
          <table class="driver-table">
            <thead><tr>
              <th>${t("sie_col_group")}</th><th class="num">${t("sie_col_booked")}</th>
              <th class="num">${t("sie_col_months")}</th><th>${t("sie_col_target")}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<p class="sie-note">${t("sie_no_cost_rows")}</p>`}
      ${outsideWindow ? `<p class="sie-note">${t("sie_outside_window", fmtSek(outsideWindow), monthLabel(1), monthLabel(TIMELINE_LENGTH))}</p>` : ""}
      <button class="add-cc-btn" id="sieImportBtn" type="button" ${importable ? "" : "disabled"}>${t("sie_import_btn")}</button>
      ${importable ? "" : `<p class="sie-note">${t("sie_nothing_in_window")}</p>`}
    </div>`;
}

async function sieDoImport() {
  const btn = document.getElementById("sieImportBtn");
  const chosen = SIE_GROUPS.filter((g) => g.lineId && Object.keys(g.monthly).length);
  if (!chosen.length) { showToast(t("sie_pick_target")); return; }
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
  btn.disabled = true;
  btn.textContent = t("loading_btn").replace(/<[^>]+>/g, "");

  // Create any "new line" targets first, so every row has a real id.
  for (const g of chosen) {
    if (g.lineId !== "__new__") continue;
    const cc = await dbInsertCostCenter(g.label);
    if (!cc) { btn.disabled = false; return; }
    COST_CENTERS.push(cc);
    g.lineId = cc.id;
  }

  const rows = [];
  let lastMonth = 0;
  for (const g of chosen) {
    for (const [month, amount] of Object.entries(g.monthly)) {
      rows.push({ reporting_line_id: g.lineId, month: Number(month), amount: Math.round(amount) });
      lastMonth = Math.max(lastMonth, Number(month));
    }
  }
  if (!(await dbUpsertActuals(rows))) { btn.disabled = false; return; }

  // Booked-through follows the ledger: the last month the file actually has.
  if (lastMonth && lastMonth !== CLOSE_MONTH) {
    setCloseMonth(lastMonth);
    CLOSE_MONTH_MANUAL = true; // came from a file, not the sync — don't let a sync move it
    await dbUpdateCloseMonth();
  }
  showToast(t("sie_imported", rows.length, monthLabel(lastMonth)));
  setTimeout(() => location.reload(), 900);
}

function initSieImport() {
  const openBtn = document.getElementById("sieImportOpen");
  const panel = document.getElementById("siePanel");
  if (!openBtn || !panel) return;

  openBtn.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  document.getElementById("sieFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const host = document.getElementById("sieResult");
    try {
      SIE_PARSED = parseSie(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      host.innerHTML = `<p class="sie-note sie-bad">${t("sie_parse_failed", escapeHtml(err.message))}</p>`;
      return;
    }
    if (!SIE_PARSED.vouchers && !Object.keys(SIE_PARSED.result).length) {
      host.innerHTML = `<p class="sie-note sie-bad">${t("sie_not_sie")}</p>`;
      return;
    }
    sieRenderPreview();
  });

  // Delegated: the mapping selects and the import button are re-rendered.
  panel.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-siegroup]");
    if (!sel) return;
    SIE_GROUPS[Number(sel.dataset.siegroup)].lineId = sel.value;
  });
  panel.addEventListener("click", (e) => {
    if (e.target.id === "sieImportBtn") sieDoImport();
  });
}
