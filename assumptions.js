// assumptions.js — the rate engine: payroll assumptions + the role salary
// catalog. Edits persist to Supabase (scoped to this org by RLS). Changing
// anything here cascades into every cost center's forecast on the other pages
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
      <td><input type="text" data-rolefield="label" value="${role.label}"></td>
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

function renderRevenueBlock() {
  return `
    <div class="cc-block rate-block revenue-block">
      <h2>Revenue Target</h2>
      <p class="rate-hint">A simple annual target — no driver engine, just a number to compare actual revenue (synced from Fortnox) against. Leave at 0 to hide revenue variance.</p>
      <div class="assumption-fields">
        <label>Annual revenue budget (SEK)
          <input type="number" data-assumption="revenueBudget" value="${ASSUMPTIONS.revenueBudget}" step="10000">
        </label>
      </div>
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
      <p class="rate-hint">Costs are derived from these, not typed. Set the payroll assumptions and each role's base salary once — the loaded monthly cost is calculated, and every cost center using a role recalculates automatically.</p>
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

function buildRateEngine() {
  document.getElementById("rateEngine").innerHTML = renderRevenueBlock() + renderRateEngineBlock() + renderTaxBlock();
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
      dbUpdateAssumptions();
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
        status.textContent = "Can't remove — this role is still used by a cost center on the Planning page.";
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
