// "Fully-loaded" view is OFF by default — "keep allocation dead simple;
// default to the unallocated (directly attributable) view" (researched
// principle). It never changes stored data, only how the FY summary reads.
let fullyLoadedView = false;

function summaryHtml(cc, i) {
  const fy = fySummary(cc);
  const cls = varianceClass(fy.variance, fy.budget);
  const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
  if (!fullyLoadedView) {
    return `
      <span>${t("fy_total_label", fmtMkr(fy.total))}</span>
      <span class="variance ${cls}">${t("vs_budget_label", `${fmtMkrSigned(fy.variance)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`)}</span>
      <button class="bridge-toggle" data-bridge="${i}" type="button">${t("why_btn")}</button>
    `;
  }
  if (cc.isShared) {
    return `<span>${t("fy_total_label", fmtMkr(fy.total))}</span><span class="alloc-out">${t("alloc_out")}</span>`;
  }
  const loaded = fullyLoadedTotal(cc);
  const share = allocatedShare(cc);
  return `
    <span>${t("direct_label", fmtMkr(fy.total))}</span>
    <span class="alloc-plus">${t("alloc_plus", fmtMkr(share))}</span>
    <span>${t("fully_loaded_label", fmtMkr(loaded))}</span>
    <button class="bridge-toggle" data-bridge="${i}" type="button">${t("why_btn")}</button>
  `;
}

function monthOptionsHtml(selected) {
  let html = "";
  for (let m = 1; m <= TIMELINE_LENGTH; m++) {
    html += `<option value="${m}" ${m === selected ? "selected" : ""}>${monthLabel(m)}</option>`;
  }
  return html;
}

function roleOptionsHtml(selectedRoleId) {
  return ROLE_CATALOG.map((r) => `<option value="${r.id}" ${r.id === selectedRoleId ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("");
}

function renderHeadcountRow(h, hc) {
  const rate = monthlyCostForRole(h.roleId);
  return `
    <tr data-hc="${hc}">
      <td><select data-field="roleId">${roleOptionsHtml(h.roleId)}</select></td>
      <td><input type="number" data-field="count" value="${h.count}" step="1"></td>
      <td class="computed rate-cell">${fmtSek(rate)}</td>
      <td><select data-field="startMonth">${monthOptionsHtml(h.startMonth)}</select></td>
      <td><select data-field="endMonth">${monthOptionsHtml(h.endMonth)}</select></td>
      <td><button class="row-remove" data-hc="${hc}" title="${t("remove_line_title")}">✕</button></td>
    </tr>
  `;
}

function renderOneOffRow(o, oi) {
  return `
    <tr data-oneoff="${oi}">
      <td><input type="text" data-ofield="label" value="${escapeHtml(o.label)}"></td>
      <td><input type="number" data-ofield="amount" value="${o.amount}" step="10000"></td>
      <td><select data-ofield="month">${monthOptionsHtml(o.month)}</select></td>
      <td><button class="row-remove" data-removeoneoff="${oi}" title="${t("remove_title")}">✕</button></td>
    </tr>
  `;
}

function renderRecurringRow(r, ri) {
  return `
    <tr data-recurring="${ri}">
      <td><input type="text" data-rfield="label" value="${escapeHtml(r.label)}"></td>
      <td><input type="number" data-rfield="amount" value="${r.amount}" step="1000"></td>
      <td><select data-rfield="startMonth">${monthOptionsHtml(r.startMonth)}</select></td>
      <td><select data-rfield="endMonth">${monthOptionsHtml(r.endMonth)}</select></td>
      <td><input type="number" data-rfield="escalationPct" value="${r.escalationPct}" step="0.5"></td>
      <td><button class="row-remove" data-removerecurring="${ri}" title="${t("remove_title")}">✕</button></td>
    </tr>
  `;
}

function renderCcBlock(i) {
  const cc = COST_CENTERS[i];

  const headcountRows = cc.headcount.map(renderHeadcountRow).join("");
  const oneOffRows = cc.oneOffs.map(renderOneOffRow).join("");
  const recurringRows = (cc.recurringCosts || []).map(renderRecurringRow).join("");

  return `
    <div class="cc-block" data-cc="${i}">
      <div class="cc-header">
        <input class="cc-name-input" data-ccfield="name" value="${escapeHtml(cc.name)}" aria-label="${t("reporting_line_name_label")}">
        <div class="cc-header-right">
          <label class="budget-field">${t("annual_budget_label")}
            <input type="number" data-ccfield="annualBudget" value="${cc.annualBudget}" step="10000">
          </label>
          <label class="shared-toggle" title="${t("shared_toggle_title")}">
            <input type="checkbox" data-ccfield="isShared" ${cc.isShared ? "checked" : ""}>
            ${t("shared_corporate_label")}
          </label>
          <button class="cc-delete" data-deletecc="${i}" type="button" title="${t("delete_line_title")}">${t("common_delete")}</button>
        </div>
      </div>
      ${cc.isShared ? `<p class="shared-note">${t("shared_note")}</p>` : ""}

      <div class="driver-table-wrap">
        <table class="driver-table">
          <thead>
            <tr>
              <th>${t("col_role_line")}</th>
              <th>${t("col_count")}</th>
              <th>${t("col_cost_head")}</th>
              <th>${t("col_active_from")}</th>
              <th>${t("col_active_until")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${headcountRows}</tbody>
        </table>
      </div>
      <button class="add-headcount" data-add="${i}">${t("add_line_btn")}</button>
      <p class="line-hint">${t("headcount_hint")}</p>

      <div class="oneoffs-section">
        <h3>${t("oneoffs_h3")}</h3>
        <div class="driver-table-wrap">
          <table class="driver-table oneoffs-table">
            <thead>
              <tr><th>${t("col_description")}</th><th>${t("col_amount_sek")}</th><th>${t("col_month")}</th><th></th></tr>
            </thead>
            <tbody>${oneOffRows}</tbody>
          </table>
        </div>
        <button class="add-headcount" data-addoneoff="${i}">${t("add_oneoff_btn")}</button>
      </div>

      <div class="recurring-section">
        <h3>${t("recurring_h3")}</h3>
        <div class="driver-table-wrap">
          <table class="driver-table recurring-table">
            <thead>
              <tr><th>${t("col_description")}</th><th>${t("col_amount_sek_mo")}</th><th>${t("col_active_from")}</th><th>${t("col_active_until")}</th><th>${t("col_escalation")}</th><th></th></tr>
            </thead>
            <tbody>${recurringRows}</tbody>
          </table>
        </div>
        <button class="add-headcount" data-addrecurring="${i}">${t("add_recurring_btn")}</button>
      </div>

      <div class="cc-note-row">
        <label>${t("comment_note_label")} <span class="cc-note-hint">${t("comment_note_hint")}</span>
          <input type="text" data-ccfield="note" value="${escapeHtml(cc.note || "")}" placeholder="${t("comment_note_placeholder")}">
        </label>
      </div>

      <div class="cc-revenue">${revenueRowHtml(cc, i)}</div>
      <div class="cc-summary">${summaryHtml(cc, i)}</div>
      <div class="cc-bridge" data-bridgepanel="${i}" hidden>${bridgeHtml(cc)}</div>
    </div>
  `;
}

// Per-line revenue (profit centre). Cost-only lines stay clean — just a quiet
// "+ Add revenue" link; a line that earns shows an annual-revenue input and
// its margin (revenue − cost). The annual box is the quick path (spreads flat);
// "Monthly" expands a 12-cell grid to SHAPE revenue month by month — the point
// of #12, since project/milestone billing is lumpy, not flat. Stored as the
// [12] revenuePlan either way, so the cost side and revenue side now match.
function revenueRowHtml(cc, i) {
  if (!lineHasRevenue(cc) && !cc._showRevenue) {
    return `<button class="add-revenue-link" data-addrevenue="${i}" type="button">${t("add_revenue_btn")}</button>`;
  }
  // annual is reconstructed from the [12] monthly plan — round it for a clean
  // display (storage stays exact).
  const annual = lineRevenueFyTotal(cc);
  const margin = lineMargin(cc);
  const plan = Array.isArray(cc.revenuePlan) && cc.revenuePlan.length === 12 ? cc.revenuePlan : null;
  // "Custom" once the months aren't all equal — the visible signal that this
  // line is shaped (a ramp / milestones), not a flat 1/12 spread.
  const isCustom = plan && plan.some((v) => Math.abs((Number(v) || 0) - (Number(plan[0]) || 0)) > 0.5);
  const flat = plan ? Math.round(annual / 12) : 0;
  const cells = Array.from({ length: 12 }, (_, m) => `
    <label>${monthLabel(m + 1)}
      <input type="number" step="10000" data-revmonthline="${i}" data-m="${m}" value="${plan ? Math.round(Number(plan[m]) || 0) : ""}" placeholder="${flat || 0}">
    </label>`).join("");
  return `
    <div class="line-revenue-row">
      <label class="line-revenue-label">${t("line_revenue_label")}
        <input type="number" data-revenue="${i}" value="${annual ? Math.round(annual) : ""}" step="10000" placeholder="0">
      </label>
      ${margin != null ? `<span class="cc-margin ${margin >= 0 ? "under" : "over"}">${t("line_margin_label", fmtMkrSigned(margin))}</span>` : ""}
      <button class="rev-monthly-toggle" data-revtoggle="${i}" type="button">${t("rev_monthly_toggle")}${isCustom ? ` <span class="rev-custom-tag">${t("rev_custom_tag")}</span>` : ""} ${cc._showRevMonthly ? "▴" : "▾"}</button>
    </div>
    ${cc._showRevMonthly ? `<div class="line-rev-grid rev-plan-grid">${cells}</div><p class="rate-hint rev-grid-hint">${t("rev_monthly_hint")}</p>` : ""}`;
}

// Live update of one month of a line's revenue while typing. Seeds the [12]
// plan from the current flat annual so untouched months keep their value, then
// sets the edited month. Clears back to null once every month is 0 (= no
// revenue). Updates the annual total in place so it stays in sync without a
// rebuild (which would drop focus mid-type); margin + custom tag refresh on
// blur (change → buildPlanningGrid).
function updateLineRevMonth(input) {
  const i = Number(input.dataset.revmonthline), m = Number(input.dataset.m);
  const cc = COST_CENTERS[i];
  if (!Array.isArray(cc.revenuePlan) || cc.revenuePlan.length !== 12) {
    const flat = lineRevenueFyTotal(cc) / 12;
    cc.revenuePlan = Array.from({ length: 12 }, () => flat || 0);
  }
  cc.revenuePlan[m] = Number(input.value) || 0;
  if (!cc.revenuePlan.some((v) => (Number(v) || 0) > 0)) cc.revenuePlan = null;
  const annualInput = document.querySelector(`[data-revenue="${i}"]`);
  if (annualInput) annualInput.value = cc.revenuePlan ? Math.round(lineRevenueFyTotal(cc)) : "";
}

// The composition breakdown behind a cost centre's FY total — "what's this
// number actually made of" (booked actuals + each driver category's forecast
// for the remaining months), not a budget-to-actual waterfall (see fyComposition).
function bridgeHtml(cc) {
  const b = fyComposition(cc);
  const rows = [
    [t("bridge_booked_actuals"), b.actual],
    [t("bridge_override"), b.overridden],
    [t("bridge_headcount"), b.headcount],
    [t("bridge_oneoff"), b.oneOff],
    [t("bridge_recurring"), b.recurring],
  ].filter(([, v]) => v !== 0); // skip zero rows (e.g. no override applied) — no noise
  return `
    <p class="bridge-hint">${t("bridge_hint")}</p>
    ${rows.map(([label, v]) => `<div class="bridge-row"><span>${label}</span><span class="num">${fmtMkr(v)}</span></div>`).join("")}
    <div class="bridge-row bridge-total"><span>${t("bridge_total_label")}</span><span class="num">${fmtMkr(b.total)}</span></div>
  `;
}

function buildPlanningGrid() {
  if (COST_CENTERS.length === 0) {
    document.getElementById("ccBlocks").innerHTML =
      `<p class="empty-hint">${t("no_reporting_lines_hint")}</p>`;
    return;
  }
  document.getElementById("ccBlocks").innerHTML = COST_CENTERS.map((cc, i) => renderCcBlock(i)).join("");
}

function rebuildCcBlock(i) {
  const block = document.querySelector(`.cc-block[data-cc="${i}"]`);
  if (block) block.outerHTML = renderCcBlock(i);
}

// Updates only the computed cells (rate per head, summary line) in place —
// never touches input elements, so focus/cursor position is never lost while typing.
function refreshCcComputed(ccIndex) {
  const cc = COST_CENTERS[ccIndex];
  const block = document.querySelector(`.cc-block[data-cc="${ccIndex}"]`);
  if (!block) return;

  block.querySelectorAll(".driver-table tbody tr[data-hc]").forEach((row) => {
    const hc = Number(row.dataset.hc);
    const h = cc.headcount[hc];
    row.querySelector(".rate-cell").textContent = fmtSek(monthlyCostForRole(h.roleId));
  });

  block.querySelector(".cc-summary").innerHTML = summaryHtml(cc, ccIndex);

  // If the bridge breakdown is currently open, keep it live too — it changes
  // with the same edits that change the FY total.
  const bridgePanel = block.querySelector(`.cc-bridge[data-bridgepanel="${ccIndex}"]`);
  if (bridgePanel && !bridgePanel.hidden) bridgePanel.innerHTML = bridgeHtml(cc);
}

function initPlanningGrid() {
  buildPlanningGrid();
  const ccBlocks = document.getElementById("ccBlocks");

  document.getElementById("allocToggle").addEventListener("change", (e) => {
    fullyLoadedView = e.target.checked;
    buildPlanningGrid();
  });

  // Dev hook: #alloctest marks the first cost centre Shared and switches to
  // fully-loaded view, for headless verification.
  if (location.hash === "#alloctest" && COST_CENTERS.length > 1) {
    COST_CENTERS[0].isShared = true;
    fullyLoadedView = true;
    document.getElementById("allocToggle").checked = true;
    buildPlanningGrid();
  }

  // Dev hook: #bridgetest auto-opens the first cost centre's bridge panel, for headless verification.
  if (location.hash === "#bridgetest") {
    const panel = document.querySelector('.cc-bridge[data-bridgepanel="0"]');
    if (panel) { panel.hidden = false; panel.innerHTML = bridgeHtml(COST_CENTERS[0]); }
  }

  document.getElementById("addCostCenter").addEventListener("click", async () => {
    const cc = await dbInsertCostCenter();
    if (!cc) return;
    COST_CENTERS.push(cc);
    buildPlanningGrid();
    const block = document.querySelector(`.cc-block[data-cc="${COST_CENTERS.length - 1}"]`);
    if (block) {
      block.scrollIntoView({ behavior: "smooth", block: "center" });
      const nameInput = block.querySelector(".cc-name-input");
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
  });

  // Field edits: update in-memory + re-render immediately (snappy), then persist.
  function handleCcFieldChange(target) {
    const block = target.closest(".cc-block");
    if (!block) return;
    const ccIndex = Number(block.dataset.cc);
    const cc = COST_CENTERS[ccIndex];

    if (target.dataset.field) {
      const row = target.closest("tr[data-hc]");
      const line = cc.headcount[Number(row.dataset.hc)];
      const field = target.dataset.field;
      line[field] = field === "roleId" ? target.value : Number(target.value) || 0;
      refreshCcComputed(ccIndex);
      dbUpdateHeadcount(line);
    } else if (target.dataset.ofield) {
      const row = target.closest("tr[data-oneoff]");
      const o = cc.oneOffs[Number(row.dataset.oneoff)];
      const field = target.dataset.ofield;
      o[field] = field === "label" ? target.value : Number(target.value) || 0;
      refreshCcComputed(ccIndex);
      dbUpdateOneOff(o);
    } else if (target.dataset.rfield) {
      const row = target.closest("tr[data-recurring]");
      const r = cc.recurringCosts[Number(row.dataset.recurring)];
      const field = target.dataset.rfield;
      r[field] = field === "label" ? target.value : Number(target.value) || 0;
      refreshCcComputed(ccIndex);
      dbUpdateRecurringCost(r);
    } else if (target.dataset.ccfield) {
      const field = target.dataset.ccfield;
      if (field === "note") {
        cc.note = target.value;
        dbSetCostCenterNote(cc);
      } else if (field === "isShared") {
        cc.isShared = target.checked;
        dbSetCostCenterShared(cc);
        buildPlanningGrid(); // affects every block's allocation math + the shared-centre note
      } else {
        cc[field] = field === "name" ? target.value : Number(target.value) || 0;
        if (field !== "name") refreshCcComputed(ccIndex);
        dbUpdateCostCenter(cc);
      }
    }
  }

  ccBlocks.addEventListener("input", (e) => {
    // A month cell updates the in-memory plan + annual total live (no rebuild,
    // so typing stays smooth); persistence happens on change (blur).
    if (e.target.dataset.revmonthline !== undefined) { updateLineRevMonth(e.target); return; }
    handleCcFieldChange(e.target);
  });
  // <select> elements don't reliably fire "input" on every browser, so handle
  // dropdown changes (role, start/end month, one-off month) via "change" too.
  ccBlocks.addEventListener("change", (e) => {
    if (e.target.tagName === "SELECT") { handleCcFieldChange(e.target); return; }
    if (e.target.dataset.revmonthline !== undefined) {
      const cc = COST_CENTERS[Number(e.target.dataset.revmonthline)];
      dbSetLineRevenue(cc);
      buildPlanningGrid(); // refresh margin + the flat/custom tag
      return;
    }
    if (e.target.dataset.revenue !== undefined) {
      const ccIndex = Number(e.target.dataset.revenue);
      const cc = COST_CENTERS[ccIndex];
      const annual = Number(e.target.value) || 0;
      cc.revenuePlan = annual > 0 ? Array(12).fill(annual / 12) : null; // annual box = spread flat
      dbSetLineRevenue(cc);
      buildPlanningGrid(); // refresh margin + any org-revenue-dependent readouts
    }
  });

  ccBlocks.addEventListener("click", async (e) => {
    const bridgeBtn = e.target.closest("[data-bridge]");
    if (bridgeBtn) {
      const ccIndex = Number(bridgeBtn.dataset.bridge);
      const panel = document.querySelector(`.cc-bridge[data-bridgepanel="${ccIndex}"]`);
      if (panel) {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) panel.innerHTML = bridgeHtml(COST_CENTERS[ccIndex]); // fresh on open
      }
      return;
    }

    const addRevBtn = e.target.closest("[data-addrevenue]");
    if (addRevBtn) {
      const ccIndex = Number(addRevBtn.dataset.addrevenue);
      COST_CENTERS[ccIndex]._showRevenue = true; // transient reveal; persists only once an amount is saved
      buildPlanningGrid();
      const input = document.querySelector(`[data-revenue="${ccIndex}"]`);
      if (input) input.focus();
      return;
    }

    const revToggle = e.target.closest("[data-revtoggle]");
    if (revToggle) {
      const cc = COST_CENTERS[Number(revToggle.dataset.revtoggle)];
      cc._showRevMonthly = !cc._showRevMonthly; // transient reveal of the 12-month grid
      buildPlanningGrid();
      return;
    }

    const deleteCcBtn = e.target.closest("[data-deletecc]");
    if (deleteCcBtn) {
      const ccIndex = Number(deleteCcBtn.dataset.deletecc);
      const cc = COST_CENTERS[ccIndex];
      if (!confirm(t("confirm_delete_line", cc.name))) return;
      const ok = await dbDeleteCostCenter(cc.id);
      if (!ok) return;
      COST_CENTERS.splice(ccIndex, 1);
      buildPlanningGrid();
      return;
    }

    const removeBtn = e.target.closest(".row-remove");

    if (removeBtn && removeBtn.dataset.hc !== undefined) {
      const block = removeBtn.closest(".cc-block");
      const ccIndex = Number(block.dataset.cc);
      const hcIndex = Number(removeBtn.dataset.hc);
      const line = COST_CENTERS[ccIndex].headcount[hcIndex];
      const role = getRole(line.roleId);
      if (!confirm(t("confirm_remove_headcount", role ? role.label : t("fallback_line")))) return;
      COST_CENTERS[ccIndex].headcount.splice(hcIndex, 1);
      rebuildCcBlock(ccIndex);
      dbDeleteHeadcount(line.id);
      return;
    }

    if (removeBtn && removeBtn.dataset.removeoneoff !== undefined) {
      const block = removeBtn.closest(".cc-block");
      const ccIndex = Number(block.dataset.cc);
      const oIndex = Number(removeBtn.dataset.removeoneoff);
      const o = COST_CENTERS[ccIndex].oneOffs[oIndex];
      if (!confirm(t("confirm_remove_oneoff", o.label))) return;
      COST_CENTERS[ccIndex].oneOffs.splice(oIndex, 1);
      rebuildCcBlock(ccIndex);
      dbDeleteOneOff(o.id);
      return;
    }

    if (removeBtn && removeBtn.dataset.removerecurring !== undefined) {
      const block = removeBtn.closest(".cc-block");
      const ccIndex = Number(block.dataset.cc);
      const rIndex = Number(removeBtn.dataset.removerecurring);
      const r = COST_CENTERS[ccIndex].recurringCosts[rIndex];
      if (!confirm(t("confirm_remove_recurring", r.label))) return;
      COST_CENTERS[ccIndex].recurringCosts.splice(rIndex, 1);
      rebuildCcBlock(ccIndex);
      dbDeleteRecurringCost(r.id);
      return;
    }

    const addBtn = e.target.closest(".add-headcount[data-add]");
    if (addBtn) {
      if (ROLE_CATALOG.length === 0) {
        alert(t("alert_add_role_first"));
        return;
      }
      const ccIndex = Number(addBtn.dataset.add);
      const line = {
        roleId: ROLE_CATALOG[0].id,
        count: 1,
        startMonth: Math.min(CLOSE_MONTH + 1, TIMELINE_LENGTH),
        endMonth: TIMELINE_LENGTH,
      };
      const id = await dbInsertHeadcount(COST_CENTERS[ccIndex].id, line);
      if (!id) return;
      line.id = id;
      COST_CENTERS[ccIndex].headcount.push(line);
      rebuildCcBlock(ccIndex);
      const block = document.querySelector(`.cc-block[data-cc="${ccIndex}"]`);
      const lastSelect = block.querySelector(".driver-table:not(.oneoffs-table) tbody tr:last-child select");
      if (lastSelect) lastSelect.focus();
      return;
    }

    const addOneOffBtn = e.target.closest("[data-addoneoff]");
    if (addOneOffBtn) {
      const ccIndex = Number(addOneOffBtn.dataset.addoneoff);
      const o = { label: t("new_oneoff_label"), amount: 50000, month: Math.min(CLOSE_MONTH + 1, TIMELINE_LENGTH) };
      const id = await dbInsertOneOff(COST_CENTERS[ccIndex].id, o);
      if (!id) return;
      o.id = id;
      COST_CENTERS[ccIndex].oneOffs.push(o);
      rebuildCcBlock(ccIndex);
      const block = document.querySelector(`.cc-block[data-cc="${ccIndex}"]`);
      const lastInput = block.querySelector(".oneoffs-table tbody tr:last-child input");
      if (lastInput) lastInput.focus();
      return;
    }

    const addRecurringBtn = e.target.closest("[data-addrecurring]");
    if (addRecurringBtn) {
      const ccIndex = Number(addRecurringBtn.dataset.addrecurring);
      const r = { label: t("new_recurring_label"), amount: 10000, startMonth: Math.min(CLOSE_MONTH + 1, TIMELINE_LENGTH), endMonth: TIMELINE_LENGTH, escalationPct: 0 };
      const id = await dbInsertRecurringCost(COST_CENTERS[ccIndex].id, r);
      if (!id) return;
      r.id = id;
      COST_CENTERS[ccIndex].recurringCosts.push(r);
      rebuildCcBlock(ccIndex);
      const block = document.querySelector(`.cc-block[data-cc="${ccIndex}"]`);
      const lastInput = block.querySelector(".recurring-table tbody tr:last-child input");
      if (lastInput) lastInput.focus();
    }
  });
}

// Re-render the grid when a month is closed elsewhere (the sidebar) so the
// "actuals booked through" lines and recomputed totals stay correct.
window.refreshAfterPeriodChange = buildPlanningGrid;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initPlanningGrid;
