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
      <span>FY2026 total: <strong>${fmtMkr(fy.total)}</strong></span>
      <span class="variance ${cls}">vs budget: <strong>${fmtMkrSigned(fy.variance)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)</strong></span>
      <button class="bridge-toggle" data-bridge="${i}" type="button">Why? ▾</button>
    `;
  }
  if (cc.isShared) {
    return `<span>FY2026 total: <strong>${fmtMkr(fy.total)}</strong></span><span class="alloc-out">→ allocated to the other cost centres</span>`;
  }
  const loaded = fullyLoadedTotal(cc);
  const share = allocatedShare(cc);
  return `
    <span>Direct: <strong>${fmtMkr(fy.total)}</strong></span>
    <span class="alloc-plus">+ ${fmtMkr(share)} allocated</span>
    <span>= Fully-loaded: <strong>${fmtMkr(loaded)}</strong></span>
    <button class="bridge-toggle" data-bridge="${i}" type="button">Why? ▾</button>
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
  return ROLE_CATALOG.map((r) => `<option value="${r.id}" ${r.id === selectedRoleId ? "selected" : ""}>${r.label}</option>`).join("");
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
      <td><button class="row-remove" data-hc="${hc}" title="Remove line">✕</button></td>
    </tr>
  `;
}

function renderOneOffRow(o, oi) {
  return `
    <tr data-oneoff="${oi}">
      <td><input type="text" data-ofield="label" value="${o.label}"></td>
      <td><input type="number" data-ofield="amount" value="${o.amount}" step="10000"></td>
      <td><select data-ofield="month">${monthOptionsHtml(o.month)}</select></td>
      <td><button class="row-remove" data-removeoneoff="${oi}" title="Remove">✕</button></td>
    </tr>
  `;
}

function renderRecurringRow(r, ri) {
  return `
    <tr data-recurring="${ri}">
      <td><input type="text" data-rfield="label" value="${r.label}"></td>
      <td><input type="number" data-rfield="amount" value="${r.amount}" step="1000"></td>
      <td><select data-rfield="startMonth">${monthOptionsHtml(r.startMonth)}</select></td>
      <td><select data-rfield="endMonth">${monthOptionsHtml(r.endMonth)}</select></td>
      <td><input type="number" data-rfield="escalationPct" value="${r.escalationPct}" step="0.5"></td>
      <td><button class="row-remove" data-removerecurring="${ri}" title="Remove">✕</button></td>
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
        <input class="cc-name-input" data-ccfield="name" value="${cc.name}" aria-label="Reporting line name">
        <div class="cc-header-right">
          <label class="budget-field">Annual budget (FY2026)
            <input type="number" data-ccfield="annualBudget" value="${cc.annualBudget}" step="10000">
          </label>
          <label class="shared-toggle" title="Shared/corporate costs (rent for the whole building, group IT…) can be optionally allocated to the other reporting lines instead of sitting on their own line.">
            <input type="checkbox" data-ccfield="isShared" ${cc.isShared ? "checked" : ""}>
            Shared / corporate
          </label>
          <button class="cc-delete" data-deletecc="${i}" type="button" title="Delete this reporting line">Delete</button>
        </div>
      </div>
      <p class="cc-actual">Actuals booked through <strong>${monthLabel(CLOSE_MONTH)}</strong> — months after that are forecast.</p>
      ${cc.isShared ? `<p class="shared-note">Shared reporting line — with <strong>Fully-loaded view</strong> on, its total is allocated to the others below (by headcount) instead of shown here.</p>` : ""}

      <div class="driver-table-wrap">
        <table class="driver-table">
          <thead>
            <tr>
              <th>Role / line</th>
              <th>Count</th>
              <th>Cost/head (mo)</th>
              <th>Active from</th>
              <th>Active until</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${headcountRows}</tbody>
        </table>
      </div>
      <button class="add-headcount" data-add="${i}">+ Add line</button>
      <p class="line-hint">Negative count models a leaver. Set "active until" to the month someone leaves or a contract ends. Pay rates come from the <a href="assumptions.html">Assumptions page</a>.</p>

      <div class="oneoffs-section">
        <h3>One-off costs</h3>
        <div class="driver-table-wrap">
          <table class="driver-table oneoffs-table">
            <thead>
              <tr><th>Description</th><th>Amount (SEK)</th><th>Month</th><th></th></tr>
            </thead>
            <tbody>${oneOffRows}</tbody>
          </table>
        </div>
        <button class="add-headcount" data-addoneoff="${i}">+ Add one-off cost</button>
      </div>

      <div class="recurring-section">
        <h3>Recurring costs</h3>
        <p class="line-hint">Rent, subscriptions, leases, materials — a named cost active over a start–end range, with an optional annual increase (e.g. 3%/yr rent escalation).</p>
        <div class="driver-table-wrap">
          <table class="driver-table recurring-table">
            <thead>
              <tr><th>Description</th><th>Amount (SEK/mo)</th><th>Active from</th><th>Active until</th><th>Escalation (%/yr)</th><th></th></tr>
            </thead>
            <tbody>${recurringRows}</tbody>
          </table>
        </div>
        <button class="add-headcount" data-addrecurring="${i}">+ Add recurring cost</button>
      </div>

      <div class="cc-note-row">
        <label>Comment / variance note <span class="cc-note-hint">— shows on the Overview &amp; board pack</span>
          <input type="text" data-ccfield="note" value="${cc.note || ""}" placeholder="e.g. DevOps hire delayed to Q4 — under budget">
        </label>
      </div>

      <div class="cc-summary">${summaryHtml(cc, i)}</div>
      <div class="cc-bridge" data-bridgepanel="${i}" hidden>${bridgeHtml(cc)}</div>
    </div>
  `;
}

// The composition breakdown behind a cost centre's FY total — "what's this
// number actually made of" (booked actuals + each driver category's forecast
// for the remaining months), not a budget-to-actual waterfall (see fyComposition).
function bridgeHtml(cc) {
  const b = fyComposition(cc);
  const rows = [
    ["Booked actuals", b.actual],
    ["Re-forecast override (remaining months)", b.overridden],
    ["Headcount (remaining months)", b.headcount],
    ["One-off costs (remaining months)", b.oneOff],
    ["Recurring costs (remaining months)", b.recurring],
  ].filter(([, v]) => v !== 0); // skip zero rows (e.g. no override applied) — no noise
  return `
    <p class="bridge-hint">What this cost centre's FY total is actually made of.</p>
    ${rows.map(([label, v]) => `<div class="bridge-row"><span>${label}</span><span class="num">${fmtMkr(v)}</span></div>`).join("")}
    <div class="bridge-row bridge-total"><span>= FY2026 total</span><span class="num">${fmtMkr(b.total)}</span></div>
  `;
}

function buildPlanningGrid() {
  if (COST_CENTERS.length === 0) {
    document.getElementById("ccBlocks").innerHTML =
      `<p class="empty-hint">No reporting lines yet — click "+ Add reporting line" above to create your first one.</p>`;
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

  ccBlocks.addEventListener("input", (e) => handleCcFieldChange(e.target));
  // <select> elements don't reliably fire "input" on every browser, so handle
  // dropdown changes (role, start/end month, one-off month) via "change" too.
  ccBlocks.addEventListener("change", (e) => {
    if (e.target.tagName === "SELECT") handleCcFieldChange(e.target);
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

    const deleteCcBtn = e.target.closest("[data-deletecc]");
    if (deleteCcBtn) {
      const ccIndex = Number(deleteCcBtn.dataset.deletecc);
      const cc = COST_CENTERS[ccIndex];
      if (!confirm(`Delete the reporting line "${cc.name}" and everything in it (headcount, one-offs, actuals)? This can't be undone.`)) return;
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
      if (!confirm(`Remove this "${role ? role.label : "line"}" headcount line? This can't be undone.`)) return;
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
      if (!confirm(`Remove the one-off cost "${o.label}"? This can't be undone.`)) return;
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
      if (!confirm(`Remove the recurring cost "${r.label}"? This can't be undone.`)) return;
      COST_CENTERS[ccIndex].recurringCosts.splice(rIndex, 1);
      rebuildCcBlock(ccIndex);
      dbDeleteRecurringCost(r.id);
      return;
    }

    const addBtn = e.target.closest(".add-headcount[data-add]");
    if (addBtn) {
      if (ROLE_CATALOG.length === 0) {
        alert("Add at least one role on the Assumptions page first — headcount lines reference a role.");
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
      const o = { label: "New one-off cost", amount: 50000, month: Math.min(CLOSE_MONTH + 1, TIMELINE_LENGTH) };
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
      const r = { label: "New recurring cost", amount: 10000, startMonth: Math.min(CLOSE_MONTH + 1, TIMELINE_LENGTH), endMonth: TIMELINE_LENGTH, escalationPct: 0 };
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
