// assumptions.js — the rate engine: payroll assumptions + the role salary
// catalog. Edits persist to Supabase (scoped to this org by RLS). Changing
// anything here cascades into every cost center's forecast on the other pages
// (they recompute from this data on their next load).

function renderRoleRow(role) {
  return `
    <tr data-role="${role.id}">
      <td><input type="text" data-rolefield="label" value="${role.label}"></td>
      <td><input type="number" data-rolefield="baseSalary" value="${role.baseSalary}" step="500"></td>
      <td class="num computed rate-cell">${fmtSek(monthlyCostForRole(role.id))}</td>
      <td><button class="row-remove" data-removerole="${role.id}" title="Remove role">✕</button></td>
    </tr>
  `;
}

function renderRoleTableBody() {
  if (ROLE_CATALOG.length === 0) {
    return `<tr><td colspan="4" class="empty-hint">No roles yet — click "+ Add role" to create your first one.</td></tr>`;
  }
  return ROLE_CATALOG.map(renderRoleRow).join("");
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
  document.getElementById("rateEngine").innerHTML = renderRateEngineBlock();
}

function refreshRoleRatesDisplay() {
  document.querySelectorAll("#roleTableBody tr[data-role]").forEach((row) => {
    row.querySelector(".rate-cell").textContent = fmtSek(monthlyCostForRole(row.dataset.role));
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
      dbUpdateAssumptions();
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
