// assumptions.js — the rate engine: payroll assumptions + the role salary
// catalog. Edits persist to Supabase (scoped to this org by RLS). Changing
// anything here cascades into every reporting line's forecast on the other pages
// (they recompute from this data on their next load).

function roleBreakdown(role) {
  const afterEmployer = Math.round(role.baseSalary * (1 + ASSUMPTIONS.employerContributionPct / 100));
  const afterEquip = afterEmployer + ASSUMPTIONS.equipmentMonthly;
  const loaded = monthlyCostForRole(role.id); // final rounded exactly like the cell
  return `${fmtSek(role.baseSalary)} base &nbsp;→&nbsp; +${ASSUMPTIONS.employerContributionPct}% employer = ${fmtSek(afterEmployer)} ` +
    `&nbsp;→&nbsp; +${fmtSek(ASSUMPTIONS.equipmentMonthly)} equipment = ${fmtSek(afterEquip)} ` +
    `&nbsp;→&nbsp; +${ASSUMPTIONS.otherOverheadPct}% overhead = <strong>${fmtSek(loaded)}</strong>`;
}

function renderRoleRow(role) {
  return `
    <tr data-role="${role.id}">
      <td><input type="text" data-rolefield="label" value="${escapeHtml(role.label)}"></td>
      <td><input type="number" data-rolefield="baseSalary" value="${role.baseSalary}" step="500"></td>
      <td class="num computed rate-cell" title="Click to see how this is calculated">${fmtSek(monthlyCostForRole(role.id))}</td>
      <td><button class="row-remove" data-removerole="${role.id}" title="Remove role">✕</button></td>
    </tr>
    <tr class="role-detail" data-detailfor="${role.id}" hidden>
      <td colspan="4">${roleBreakdown(role)}</td>
    </tr>
  `;
}

function renderRoleTableBody() {
  if (ROLE_CATALOG.length === 0) {
    return `<tr><td colspan="4" class="empty-hint">No roles yet — click "+ Add role" to create your first one.</td></tr>`;
  }
  return ROLE_CATALOG.map(renderRoleRow).join("");
}

function revPlanTotalHtml() {
  const plan = ASSUMPTIONS.revenuePlan;
  const hasPlan = Array.isArray(plan) && plan.length === 12 && plan.some((v) => v > 0);
  const target = ASSUMPTIONS.revenueBudget || 0;
  if (!hasPlan) {
    return target
      ? `No monthly plan — forecasts use a flat <strong>${fmtSek(Math.round(target / 12))}</strong>/month (target ÷ 12).`
      : `No revenue target set — revenue stays hidden from the P&L comparison and forecasts.`;
  }
  const total = plan.reduce((s, v) => s + (Number(v) || 0), 0);
  const diff = total - target;
  // Green when the plan is at/above the target, red below — revenue semantics,
  // the inverse of the cost tables' over/under coloring.
  const drift = Math.abs(diff) < 1000
    ? `<span class="bv-clean">✓ matches the annual target</span>`
    : `<span class="${diff > 0 ? "under" : "over"}">${fmtMkrSigned(diff)} vs the ${fmtMkr(target)} target</span>`;
  return `<strong>Plan total: ${fmtMkr(total)}</strong> ${drift}`;
}

function renderRevenueBlock() {
  const plan = ASSUMPTIONS.revenuePlan;
  const hasPlan = Array.isArray(plan) && plan.length === 12 && plan.some((v) => v > 0);
  const flat = Math.round((ASSUMPTIONS.revenueBudget || 0) / 12);
  const cells = Array.from({ length: 12 }, (_, i) => `
    <label>${monthLabel(i + 1)}
      <input type="number" step="10000" data-revmonth="${i}" value="${hasPlan ? Number(plan[i]) || 0 : ""}" placeholder="${flat || ""}">
    </label>`).join("");
  return `
    <div class="cc-block rate-block revenue-block">
      <h2>Revenue Plan <span class="pnl-src">— feeds the projected FY result &amp; Cash Flow</span></h2>
      <p class="rate-hint">An annual target plus an optional month-by-month profile. The target is what actual revenue (synced from Fortnox) is compared against; the monthly plan shapes the forecast — the projected FY result on Overview and the Operating estimate on Cash Flow. No plan = a flat target ÷ 12. Leave the target at 0 to hide revenue entirely.</p>
      <div class="assumption-fields">
        <label>Annual revenue target (SEK)
          <input type="number" data-assumption="revenueBudget" value="${ASSUMPTIONS.revenueBudget}" step="10000">
        </label>
      </div>
      <div class="rev-plan-grid">${cells}</div>
      <div class="rev-plan-actions">
        <button class="add-headcount" id="revSpreadBtn" type="button">Spread target evenly</button>
        <button class="add-headcount" id="revClearBtn" type="button"${hasPlan ? "" : " disabled"}>Clear plan (use flat ÷ 12)</button>
      </div>
      <p class="rate-formula" id="revPlanTotal">${revPlanTotalHtml()}</p>
    </div>
  `;
}

function renderTaxBlock() {
  return `
    <div class="cc-block rate-block tax-block">
      <h2>Tax &amp; VAT Settings <span class="pnl-src">— feeds the Cash Flow page's estimate</span></h2>
      <p class="rate-hint">Which BAS accounts hold your VAT and payroll-tax liabilities, and how often you report VAT — used to estimate when those amounts fall due. Defaults match the standard BAS chart of accounts; adjust if your books use different ones. Ranges are wide on purpose: reclassification entries within a range net to zero either way.</p>
      <div class="assumption-fields">
        <label>VAT reporting frequency
          <select data-taxfield="vatFrequency">
            <option value="monthly"${ASSUMPTIONS.vatFrequency === "monthly" ? " selected" : ""}>Monthly</option>
            <option value="quarterly"${ASSUMPTIONS.vatFrequency === "quarterly" ? " selected" : ""}>Quarterly</option>
            <option value="annual"${ASSUMPTIONS.vatFrequency === "annual" ? " selected" : ""}>Annual</option>
          </select>
        </label>
        <label>VAT account range
          <span class="range-inputs">
            <input type="number" data-taxfield="vatAccountFrom" value="${ASSUMPTIONS.vatAccountFrom}">
            &ndash;
            <input type="number" data-taxfield="vatAccountTo" value="${ASSUMPTIONS.vatAccountTo}">
          </span>
        </label>
        <label>Payroll-tax account range
          <span class="range-inputs">
            <input type="number" data-taxfield="payrollAccountFrom" value="${ASSUMPTIONS.payrollAccountFrom}">
            &ndash;
            <input type="number" data-taxfield="payrollAccountTo" value="${ASSUMPTIONS.payrollAccountTo}">
          </span>
        </label>
      </div>
    </div>
  `;
}

function renderRateEngineBlock() {
  return `
    <div class="cc-block rate-block">
      <h2>Rate Assumptions</h2>
      <p class="rate-hint">Costs are derived from these, not typed. Set the payroll assumptions and each role's base salary once — the loaded monthly cost is calculated, and every reporting line using a role recalculates automatically.</p>
      <div class="assumption-fields">
        <label>Employer contribution (%)
          <input type="number" data-assumption="employerContributionPct" value="${ASSUMPTIONS.employerContributionPct}" step="0.01">
        </label>
        <label>Equipment / tools per head (SEK/mo)
          <input type="number" data-assumption="equipmentMonthly" value="${ASSUMPTIONS.equipmentMonthly}" step="100">
        </label>
        <label>Other overhead (%)
          <input type="number" data-assumption="otherOverheadPct" value="${ASSUMPTIONS.otherOverheadPct}" step="0.5">
        </label>
      </div>
      <p class="rate-formula" id="rateFormula"></p>
      <div class="driver-table-wrap">
        <table class="driver-table role-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Base salary (SEK/mo)</th>
              <th class="num">Loaded cost (SEK/mo)</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="roleTableBody">${renderRoleTableBody()}</tbody>
        </table>
      </div>
      <button class="add-headcount" id="addRoleBtn">+ Add role</button>
      <p class="form-status" id="roleStatus"></p>
    </div>
  `;
}

function renderDataBlock() {
  return `
    <div class="cc-block rate-block data-block">
      <h2>Your Data</h2>
      <p class="rate-hint">Everything this organization stores — budget drivers, actuals, plans, scenarios, sync configuration — downloadable as one JSON file. Your data is yours: take it to Excel, another tool, or just keep a backup. (OAuth tokens are never included; they aren't readable from the browser at all.)</p>
      <button class="add-headcount" id="exportAllBtn" type="button">⬇ Export everything (JSON)</button>
    </div>
  `;
}

function buildRateEngine() {
  document.getElementById("rateEngine").innerHTML = renderRevenueBlock() + renderRateEngineBlock() + renderTaxBlock() + renderDataBlock();
  updateRateFormula();
}

// Shows, in plain language with the live assumptions plugged in, exactly how
// every role's monthly cost is derived — so it's transparent, not a black box.
function updateRateFormula() {
  const el = document.getElementById("rateFormula");
  if (!el) return;
  const example = 40000;
  const loaded = Math.round(
    (example * (1 + ASSUMPTIONS.employerContributionPct / 100) + ASSUMPTIONS.equipmentMonthly) *
      (1 + ASSUMPTIONS.otherOverheadPct / 100)
  );
  el.innerHTML =
    `<strong>How each cost is derived:</strong> base salary × (1 + ${ASSUMPTIONS.employerContributionPct}% employer) + ` +
    `${fmtSek(ASSUMPTIONS.equipmentMonthly)} equipment, then × (1 + ${ASSUMPTIONS.otherOverheadPct}% overhead). ` +
    `So a ${fmtSek(example)} base becomes <strong>${fmtSek(loaded)}/month</strong>.`;
}

function refreshRoleRatesDisplay() {
  document.querySelectorAll("#roleTableBody tr[data-role]").forEach((row) => {
    const roleId = row.dataset.role;
    row.querySelector(".rate-cell").textContent = fmtSek(monthlyCostForRole(roleId));
    const detail = document.querySelector(`.role-detail[data-detailfor="${roleId}"] td`);
    if (detail) detail.innerHTML = roleBreakdown(getRole(roleId));
  });
}

function initAssumptions() {
  buildRateEngine();
  const rateEngine = document.getElementById("rateEngine");

  rateEngine.addEventListener("input", (e) => {
    const target = e.target;

    if (target.dataset.assumption) {
      ASSUMPTIONS[target.dataset.assumption] = Number(target.value) || 0;
      refreshRoleRatesDisplay();
      updateRateFormula();
      const rpTotal = document.getElementById("revPlanTotal");
      if (rpTotal) rpTotal.innerHTML = revPlanTotalHtml();
      dbUpdateAssumptions();
      return;
    }

    if (target.dataset.revmonth != null) {
      if (!Array.isArray(ASSUMPTIONS.revenuePlan) || ASSUMPTIONS.revenuePlan.length !== 12) {
        // First touch seeds the whole profile from the flat target ÷ 12, so
        // adjusting one month doesn't silently zero out the other eleven.
        ASSUMPTIONS.revenuePlan = Array.from({ length: 12 }, () => Math.round((ASSUMPTIONS.revenueBudget || 0) / 12));
        document.querySelectorAll("[data-revmonth]").forEach((inp) => {
          if (inp !== target && inp.value === "") inp.value = ASSUMPTIONS.revenuePlan[Number(inp.dataset.revmonth)];
        });
      }
      ASSUMPTIONS.revenuePlan[Number(target.dataset.revmonth)] = Number(target.value) || 0;
      document.getElementById("revPlanTotal").innerHTML = revPlanTotalHtml();
      const clearBtn = document.getElementById("revClearBtn");
      if (clearBtn) clearBtn.disabled = false;
      dbUpdateRevenuePlan();
      return;
    }

    if (target.dataset.taxfield) {
      ASSUMPTIONS[target.dataset.taxfield] = target.dataset.taxfield === "vatFrequency" ? target.value : (Number(target.value) || 0);
      dbUpdateTaxSettings();
      return;
    }

    if (target.dataset.rolefield) {
      const row = target.closest("tr[data-role]");
      const role = getRole(row.dataset.role);
      const field = target.dataset.rolefield;
      role[field] = field === "label" ? target.value : Number(target.value) || 0;
      refreshRoleRatesDisplay();
      dbUpdateRole(role);
    }
  });

  rateEngine.addEventListener("click", async (e) => {
    if (e.target.id === "exportAllBtn") {
      exportAllData();
      return;
    }
    if (e.target.id === "revSpreadBtn") {
      ASSUMPTIONS.revenuePlan = Array.from({ length: 12 }, () => Math.round((ASSUMPTIONS.revenueBudget || 0) / 12));
      dbUpdateRevenuePlan();
      buildRateEngine();
      return;
    }
    if (e.target.id === "revClearBtn") {
      ASSUMPTIONS.revenuePlan = null;
      dbUpdateRevenuePlan();
      buildRateEngine();
      return;
    }

    // Click a loaded-cost cell to reveal/hide its step-by-step breakdown.
    const rateCell = e.target.closest("tr[data-role] .rate-cell");
    if (rateCell) {
      const roleId = rateCell.closest("tr[data-role]").dataset.role;
      const detail = document.querySelector(`.role-detail[data-detailfor="${roleId}"]`);
      if (detail) detail.hidden = !detail.hidden;
      return;
    }

    const removeBtn = e.target.closest("[data-removerole]");
    if (removeBtn) {
      const roleId = removeBtn.dataset.removerole;
      const role = getRole(roleId);
      const status = document.getElementById("roleStatus");
      if (isRoleInUse(roleId)) {
        status.textContent = "Can't remove — this role is still used by a reporting line on the Planning page.";
        status.classList.add("error");
        return;
      }
      if (!confirm(`Remove the role "${role.label}"? This can't be undone.`)) return;
      const ok = await dbDeleteRole(roleId);
      if (!ok) return;
      const idx = ROLE_CATALOG.findIndex((r) => r.id === roleId);
      if (idx !== -1) ROLE_CATALOG.splice(idx, 1);
      buildRateEngine();
      return;
    }

    if (e.target.id === "addRoleBtn") {
      const role = await dbInsertRole();
      if (!role) return;
      ROLE_CATALOG.push(role);
      buildRateEngine();
      const lastInput = document.querySelector("#roleTableBody tr:last-child input");
      if (lastInput) lastInput.focus();
    }
  });
}

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = initAssumptions;
