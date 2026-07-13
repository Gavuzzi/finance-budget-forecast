// assumptions.js — the rate engine + org configuration blocks. Since Phase
// 9.2b this file serves TWO pages (job-shaped nav — "Assumptions" dissolved):
//   · planning.html — the org revenue plan (#revenueSlot, org-mode only) and
//     the salary/role engine (#rateEngine) live WITH the planning they drive
//   · settings.html — tax, "How you plan", Plans & versions, team, export
// buildRateEngine detects the page by which slots exist; the delegated
// listeners attach to every host present, so absent blocks simply never fire.

function roleBreakdown(role) {
  const afterEmployer = Math.round(role.baseSalary * (1 + ASSUMPTIONS.employerContributionPct / 100));
  const afterEquip = afterEmployer + ASSUMPTIONS.equipmentMonthly;
  const loaded = monthlyCostForRole(role.id); // final rounded exactly like the cell
  return t("role_breakdown", fmtSek(role.baseSalary), ASSUMPTIONS.employerContributionPct, fmtSek(afterEmployer),
    fmtSek(ASSUMPTIONS.equipmentMonthly), fmtSek(afterEquip), ASSUMPTIONS.otherOverheadPct, fmtSek(loaded));
}

function renderRoleRow(role) {
  return `
    <tr data-role="${role.id}">
      <td><input type="text" data-rolefield="label" value="${escapeHtml(role.label)}"></td>
      <td><input type="number" data-rolefield="baseSalary" value="${role.baseSalary}" step="500"></td>
      <td class="num computed rate-cell" title="${t("rate_cell_title")}">${fmtSek(monthlyCostForRole(role.id))}</td>
      <td><button class="row-remove" data-removerole="${role.id}" title="${t("remove_role_title")}">✕</button></td>
    </tr>
    <tr class="role-detail" data-detailfor="${role.id}" hidden>
      <td colspan="4">${roleBreakdown(role)}</td>
    </tr>
  `;
}

function renderRoleTableBody() {
  if (ROLE_CATALOG.length === 0) {
    return `<tr><td colspan="4" class="empty-hint">${t("no_roles_hint")}</td></tr>`;
  }
  return ROLE_CATALOG.map(renderRoleRow).join("");
}

function revPlanTotalHtml() {
  const plan = ASSUMPTIONS.revenuePlan;
  const hasPlan = Array.isArray(plan) && plan.length === 12 && plan.some((v) => v > 0);
  const target = ASSUMPTIONS.revenueBudget || 0;
  if (!hasPlan) {
    return target
      ? t("rev_no_plan_flat", fmtSek(Math.round(target / 12)))
      : t("rev_no_target");
  }
  const total = plan.reduce((s, v) => s + (Number(v) || 0), 0);
  const diff = total - target;
  // Green when the plan is at/above the target, red below — revenue semantics,
  // the inverse of the cost tables' over/under coloring.
  const drift = Math.abs(diff) < 1000
    ? `<span class="bv-clean">${t("rev_plan_matches")}</span>`
    : `<span class="${diff > 0 ? "under" : "over"}">${t("rev_plan_drift", fmtMkrSigned(diff), fmtMkr(target))}</span>`;
  return `${t("rev_plan_total", fmtMkr(total))} ${drift}`;
}

function renderRevenueBlock() {
  const plan = ASSUMPTIONS.revenuePlan;
  const hasPlan = Array.isArray(plan) && plan.length === 12 && plan.some((v) => v > 0);
  const flat = Math.round((ASSUMPTIONS.revenueBudget || 0) / 12);
  const cells = Array.from({ length: 12 }, (_, i) => `
    <label>${monthLabel(FY_WINDOW_START + i)}
      <input type="number" step="10000" data-revmonth="${i}" value="${hasPlan ? Number(plan[i]) || 0 : ""}" placeholder="${flat || ""}">
    </label>`).join("");
  return `
    <div class="cc-block rate-block revenue-block">
      <h2>${t("revenue_plan_h2")}</h2>
      <p class="rate-hint">${t("revenue_plan_hint")}</p>
      ${anyLineHasRevenue() ? `<p class="rate-hint rev-ignored-note">${t("rev_org_ignored_note")}</p>` : ""}
      <div class="assumption-fields">
        <label>${t("annual_revenue_target")}
          <input type="number" data-assumption="revenueBudget" value="${ASSUMPTIONS.revenueBudget}" step="10000">
        </label>
      </div>
      <div class="rev-plan-grid">${cells}</div>
      <div class="rev-plan-actions">
        <button class="add-headcount" id="revSpreadBtn" type="button">${t("spread_target_btn")}</button>
        <button class="add-headcount" id="revClearBtn" type="button"${hasPlan ? "" : " disabled"}>${t("clear_plan_btn")}</button>
      </div>
      <p class="rate-formula" id="revPlanTotal">${revPlanTotalHtml()}</p>
    </div>
  `;
}

function renderTaxBlock() {
  return `
    <div class="cc-block rate-block tax-block">
      <h2>${t("tax_vat_h2")}</h2>
      <p class="rate-hint">${t("tax_vat_hint")}</p>
      <div class="assumption-fields">
        <label>${t("vat_frequency_label")}
          <select data-taxfield="vatFrequency">
            <option value="monthly"${ASSUMPTIONS.vatFrequency === "monthly" ? " selected" : ""}>${t("vat_monthly")}</option>
            <option value="quarterly"${ASSUMPTIONS.vatFrequency === "quarterly" ? " selected" : ""}>${t("vat_quarterly")}</option>
            <option value="annual"${ASSUMPTIONS.vatFrequency === "annual" ? " selected" : ""}>${t("vat_annual")}</option>
          </select>
        </label>
        <label>${t("vat_account_range")}
          <span class="range-inputs">
            <input type="number" data-taxfield="vatAccountFrom" value="${ASSUMPTIONS.vatAccountFrom}">
            &ndash;
            <input type="number" data-taxfield="vatAccountTo" value="${ASSUMPTIONS.vatAccountTo}">
          </span>
        </label>
        <label>${t("payroll_account_range")}
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
      <h2>${t("rate_assumptions_h2")}</h2>
      <p class="rate-hint">${t("rate_assumptions_hint")}</p>
      <div class="assumption-fields">
        <label>${t("employer_contribution_label")}
          <input type="number" data-assumption="employerContributionPct" value="${ASSUMPTIONS.employerContributionPct}" step="0.01">
        </label>
        <label>${t("equipment_label")}
          <input type="number" data-assumption="equipmentMonthly" value="${ASSUMPTIONS.equipmentMonthly}" step="100">
        </label>
        <label>${t("other_overhead_label")}
          <input type="number" data-assumption="otherOverheadPct" value="${ASSUMPTIONS.otherOverheadPct}" step="0.5">
        </label>
      </div>
      <p class="rate-formula" id="rateFormula"></p>
      <div class="driver-table-wrap">
        <table class="driver-table role-table">
          <thead>
            <tr>
              <th>${t("col_role_th")}</th>
              <th>${t("col_base_salary")}</th>
              <th class="num">${t("col_loaded_cost")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="roleTableBody">${renderRoleTableBody()}</tbody>
        </table>
      </div>
      <button class="add-headcount" id="addRoleBtn">${t("add_role_btn")}</button>
      <p class="form-status" id="roleStatus"></p>
    </div>
  `;
}

// ---- Team (membership management) ------------------------------------------

async function callOrgMembers(payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/org-members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ org_id: CURRENT_ORG_ID, ...payload }),
  });
  const out = await res.json();
  if (!res.ok || out.error) throw new Error(out.error || res.statusText);
  return out;
}

function roleLabel(r) {
  return { owner: t("role_owner"), editor: t("role_editor"), viewer: t("role_viewer") }[r];
}

function roleSelectHtml(userId, currentRole) {
  return `<select class="team-role-select" data-member="${userId}">
    ${["owner", "editor", "viewer"].map((r) => `<option value="${r}"${r === currentRole ? " selected" : ""}>${roleLabel(r)}</option>`).join("")}
  </select>`;
}

function teamRowHtml(m, isOwnerView) {
  const manage = isOwnerView && !m.is_you
    ? `${roleSelectHtml(m.user_id, m.role)} <button class="row-remove" data-removemember="${m.user_id}" title="${t("remove_member_title")}">✕</button>`
    : isOwnerView
      ? roleSelectHtml(m.user_id, m.role) // can change your own role (server blocks removing the last owner)
      : `<span class="role-pill role-${m.role}">${roleLabel(m.role)}</span>`;
  return `
    <div class="team-row">
      <span class="team-email">${escapeHtml(m.email)}${m.is_you ? ` <span class="team-you">${t("team_you")}</span>` : ""}</span>
      <span class="team-manage">${manage}</span>
    </div>`;
}

function demoTeamHtml() {
  return `
    <div class="team-row"><span class="team-email">${t("demo_team_owner_email")} <span class="team-you">${t("team_you")}</span></span><span class="role-pill role-owner">${roleLabel("owner")}</span></div>
    <div class="team-row"><span class="team-email">${t("demo_team_colleague_email")}</span><span class="role-pill role-editor">${roleLabel("editor")}</span></div>
    <p class="rate-hint" style="margin:10px 0 0;">${t("demo_team_signin_hint")}</p>`;
}

function teamInviteFormHtml() {
  return `<div class="team-invite">
    <input type="email" id="teamInviteEmail" placeholder="${t("invite_email_placeholder")}">
    <select id="teamInviteRole"><option value="editor">${t("role_editor")}</option><option value="viewer">${t("role_viewer")}</option></select>
    <button class="add-headcount" id="teamInviteBtn" type="button">${t("invite_btn")}</button>
  </div>`;
}

async function renderTeamPanel() {
  const listEl = document.getElementById("teamList");
  const formEl = document.getElementById("teamInviteForm");
  if (!listEl) return;

  // Dev hook: ?preview#teamtest renders the interactive owner view (role
  // selects, remove buttons, invite form) without a live edge-function call
  // — headless-verifiable, unlike the real authenticated path.
  if (location.hash === "#teamtest" && typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    const fake = [
      { user_id: "u1", email: "felixroos@gmail.com", role: "owner", is_you: true },
      { user_id: "u2", email: "colleague@company.se", role: "editor", is_you: false },
      { user_id: "u3", email: "accountant@company.se", role: "viewer", is_you: false },
    ];
    listEl.innerHTML = fake.map((m) => teamRowHtml(m, true)).join("");
    formEl.innerHTML = teamInviteFormHtml();
    return;
  }

  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    listEl.innerHTML = demoTeamHtml();
    formEl.innerHTML = "";
    return;
  }

  try {
    const { members } = await callOrgMembers({ action: "list" });
    const isOwnerView = members.some((m) => m.is_you && m.role === "owner");
    listEl.innerHTML = members.map((m) => teamRowHtml(m, isOwnerView)).join("");
    formEl.innerHTML = isOwnerView ? teamInviteFormHtml() : "";
  } catch (e) {
    listEl.innerHTML = `<p class="rate-hint">${t("team_load_error", escapeHtml(e.message))}</p>`;
  }
}

function renderTeamBlock() {
  return `
    <div class="cc-block rate-block team-block">
      <h2>${t("team_h2")}</h2>
      <p class="rate-hint">${t("team_hint")}</p>
      <div id="teamList" class="team-list">${t("common_loading")}</div>
      <div id="teamInviteForm"></div>
      <p class="form-status" id="teamStatus"></p>
    </div>
  `;
}

function renderDataBlock() {
  return `
    <div class="cc-block rate-block data-block">
      <h2>${t("your_data_h2")}</h2>
      <p class="rate-hint">${t("your_data_hint")}</p>
      <button class="add-headcount" id="exportAllBtn" type="button">${t("export_all_btn")}</button>
    </div>
  `;
}

// "How you plan" — the org's planning mode (one revenue home). Presets set it
// at creation; this panel is the quiet place to change it later. Switching
// gates AFFORDANCES only: existing data keeps rendering and keeps counting
// (the honest warning below says exactly that).
function renderPlanningModeBlock() {
  const mode = planBillableHours() ? "hours" : planRevenueOnLines() ? "lines" : "org";
  const opt = (val, label, desc) => `
    <label class="planmode-opt ${mode === val ? "active" : ""}">
      <input type="radio" name="planMode" value="${val}" ${mode === val ? "checked" : ""}>
      <strong>${label}</strong><span>${desc}</span>
    </label>`;
  // The cost-side question (people as roles×headcount, or plain amounts).
  // Hidden in hours mode: the utilization driver needs roles to cost its
  // derived heads, so the choice would be a lie there.
  const people = planHeadcount() ? "roles" : "simple";
  const popt = (val, label, desc) => `
    <label class="planmode-opt ${people === val ? "active" : ""}">
      <input type="radio" name="peopleMode" value="${val}" ${people === val ? "checked" : ""}>
      <strong>${label}</strong><span>${desc}</span>
    </label>`;
  return `
    <div class="cc-block rate-block planmode-block">
      <h2>${t("planmode_h2")}</h2>
      <p class="rate-hint">${t("planmode_hint")}</p>
      <div class="planmode-opts">
        ${opt("org", t("planmode_org"), t("planmode_org_desc"))}
        ${opt("lines", t("planmode_lines"), t("planmode_lines_desc"))}
        ${opt("hours", t("planmode_hours"), t("planmode_hours_desc"))}
      </div>
      ${mode === "hours" ? "" : `
      <p class="rate-hint planmode-people-q">${t("planmode_people_q")}</p>
      <div class="planmode-opts planmode-people">
        ${popt("roles", t("planmode_people_roles"), t("planmode_people_roles_desc"))}
        ${popt("simple", t("planmode_people_simple"), t("planmode_people_simple_desc"))}
      </div>`}
    </div>`;
}

// Manage plans — the quiet governance corner: create the fiscal-year budget,
// rename/delete scenarios and, with friction, lock/unlock budgets.
// Deliberately here and not in the sidebar; day-to-day switching is enough
// there. The Forecast can't be renamed/deleted — it's the org's spine.
function renderPlansBlock() {
  const rows = PLAN_VERSIONS.map((v) => {
    const state = v.isMain ? `<span class="plan-state">${t("plan_state_forecast")}</span>`
      : v.budgetFy != null
        ? (v.lockedAt
          ? `<span class="plan-state plan-locked">🔒 ${t("plan_state_locked", new Date(v.lockedAt).toLocaleDateString("sv-SE"))}</span>`
          : `<span class="plan-state plan-draft">${t("plan_state_budget_draft")}</span>`)
      : v.lockedAt ? `<span class="plan-state plan-locked">🔒 ${t("plan_state_locked", new Date(v.lockedAt).toLocaleDateString("sv-SE"))}</span>`
      : `<span class="plan-state">${t("plan_state_scenario")}</span>`;
    const actions = v.isMain ? "" : `
      <button class="integ-link" data-planrename="${v.id}" type="button">${t("plan_rename_btn")}</button>
      ${v.budgetFy != null && !v.lockedAt ? `<button class="integ-link" data-planlock="${v.id}" type="button">${t("plan_lock_btn")}</button>` : ""}
      ${v.lockedAt ? `<button class="integ-link" data-planunlock="${v.id}" type="button">${t("plan_unlock_btn")}</button>` : ""}
      <button class="integ-link" data-plandelete="${v.id}" type="button">${t("plan_delete_btn")}</button>`;
    return `<div class="plan-row"><span class="plan-name">${escapeHtml(versionDisplayName(v))}</span>${state}<span class="plan-actions">${actions}</span></div>`;
  }).join("");
  // Create the budget for a chosen fiscal year, starting from the current
  // plan (Felix: "fill what we have done… as a starting point"). Offers the
  // two FYs the timeline covers; defaults to the next one — budgeting is
  // usually next year's exercise.
  const fyOpts = [FY_START_YEAR, FY_START_YEAR + 1]
    .map((y) => `<option value="${y}" ${y === FY_START_YEAR + 1 ? "selected" : ""}>${t("budget_for_fy", y)}</option>`).join("");
  return `
    <div class="cc-block rate-block plans-block">
      <h2>${t("plans_h2")}</h2>
      <p class="rate-hint">${t("plans_hint")}</p>
      <div class="plan-list">${rows}</div>
      <div class="plan-newbudget">
        <select id="newBudgetFy">${fyOpts}</select>
        <button class="add-headcount" id="newBudgetBtn" type="button">${t("new_budget_btn")}</button>
        <span class="rate-hint plan-newbudget-hint">${t("new_budget_hint")}</span>
      </div>
    </div>`;
}

function buildRateEngine() {
  const onPlanning = !!document.getElementById("ccBlocks");
  const revenueSlot = document.getElementById("revenueSlot");
  const rateEngine = document.getElementById("rateEngine");
  if (!rateEngine) return;

  if (onPlanning) {
    // Planning: revenue above the cost lines (org-mode only — lines-mode orgs
    // plan revenue per line; ONE revenue home), roles/salary engine below
    // (hidden for simple-amounts orgs unless roles already exist — data
    // always renders).
    if (revenueSlot) revenueSlot.innerHTML = planRevenueOnLines() ? "" : renderRevenueBlock();
    rateEngine.innerHTML = (planHeadcount() || ROLE_CATALOG.length > 0) ? renderRateEngineBlock() : "";
    updateRateFormula();
    return;
  }

  // Settings: the org's configuration corner.
  rateEngine.innerHTML =
    renderTaxBlock() + renderPlanningModeBlock() + renderPlansBlock() + renderTeamBlock() + renderDataBlock();
  renderTeamPanel();
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
  el.innerHTML = t("rate_formula", ASSUMPTIONS.employerContributionPct, fmtSek(ASSUMPTIONS.equipmentMonthly), ASSUMPTIONS.otherOverheadPct, fmtSek(example), fmtSek(loaded));
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
  // Attach the delegated handlers to every host this page has (#revenueSlot
  // exists on Planning only); handlers for blocks that aren't rendered on
  // this page simply never match anything.
  [document.getElementById("revenueSlot"), document.getElementById("rateEngine")]
    .filter(Boolean)
    .forEach(attachRateEngineHandlers);
}

function attachRateEngineHandlers(rateEngine) {
  // Manage plans: create budget / rename / lock / unlock (with friction) / delete.
  rateEngine.addEventListener("click", async (e) => {
    const renameBtn = e.target.closest("[data-planrename]");
    const unlockBtn = e.target.closest("[data-planunlock]");
    const deleteBtn = e.target.closest("[data-plandelete]");
    const lockBtn = e.target.closest("[data-planlock]");
    const newBudgetBtn = e.target.closest("#newBudgetBtn");
    if (!renameBtn && !unlockBtn && !deleteBtn && !lockBtn && !newBudgetBtn) return;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }

    if (newBudgetBtn) {
      const fy = Number((document.getElementById("newBudgetFy") || {}).value) || FY_START_YEAR + 1;
      const id = await dbCreateBudget(fy);
      if (id) { showToast(t("toast_budget_created", fy)); switchVersion(id); } // jump into the draft to edit it
      return;
    }
    if (lockBtn) {
      const v = PLAN_VERSIONS.find((x) => x.id === lockBtn.dataset.planlock);
      if (!v || !confirm(t("lock_budget_confirm", v.name))) return;
      if (await dbLockVersion(v.id)) {
        v.lockedAt = new Date().toISOString();
        showToast(t("toast_budget_locked"));
        buildRateEngine(); renderSidebar();
      }
      return;
    }

    if (renameBtn) {
      const v = PLAN_VERSIONS.find((x) => x.id === renameBtn.dataset.planrename);
      const name = prompt(t("prompt_rename_plan"), v ? v.name : "");
      if (!name || !name.trim() || !v) return;
      v.name = name.trim();
      await dbRenameVersion(v.id, v.name);
      buildRateEngine(); renderSidebar();
      return;
    }
    if (unlockBtn) {
      const v = PLAN_VERSIONS.find((x) => x.id === unlockBtn.dataset.planunlock);
      if (!v || !confirm(t("plan_unlock_confirm", v.name))) return;
      if (await dbUnlockVersion(v.id)) {
        v.lockedAt = null;
        showToast(t("toast_plan_unlocked", v.name));
        buildRateEngine(); renderSidebar();
      }
      return;
    }
    if (deleteBtn) {
      const v = PLAN_VERSIONS.find((x) => x.id === deleteBtn.dataset.plandelete);
      if (!v || !confirm(t("confirm_delete_scenario", v.name))) return;
      if (!(await dbDeleteVersion(v.id))) return;
      if (v.id === ACTIVE_VERSION_ID) { localStorage.removeItem(activeVersionKey()); location.reload(); return; }
      PLAN_VERSIONS.splice(PLAN_VERSIONS.indexOf(v), 1);
      buildRateEngine(); renderSidebar();
    }
  });

  // Planning-mode switch: honest confirm (existing numbers keep counting;
  // only the affordances change), then persist + reload so every page
  // re-renders under the new mode.
  rateEngine.addEventListener("change", async (e) => {
    if (e.target.name !== "planMode" && e.target.name !== "peopleMode") return;
    const val = e.target.value;
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); buildRateEngine(); return; }
    if (!confirm(t("planmode_confirm"))) { buildRateEngine(); return; }
    if (e.target.name === "planMode") {
      PLANNING_CONFIG = { ...PLANNING_CONFIG, revenueMode: val === "org" ? "org" : "lines", billableHours: val === "hours" };
    } else {
      PLANNING_CONFIG = { ...PLANNING_CONFIG, headcount: val === "roles" };
    }
    await dbUpdatePlanningConfig();
    location.reload();
  });

  rateEngine.addEventListener("input", (e) => {
    const target = e.target;

    if (target.dataset.assumption) {
      ASSUMPTIONS[target.dataset.assumption] = Number(target.value) || 0;
      refreshRoleRatesDisplay();
      updateRateFormula();
      const rpTotal = document.getElementById("revPlanTotal");
      if (rpTotal) rpTotal.innerHTML = revPlanTotalHtml();
      // Revenue target is versioned; the rate fields are org-shared.
      if (target.dataset.assumption === "revenueBudget") dbUpdateRevenuePlan();
      else dbUpdateAssumptions();
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

  rateEngine.addEventListener("change", async (e) => {
    const sel = e.target.closest(".team-role-select");
    if (!sel) return;
    const status = document.getElementById("teamStatus");
    status.classList.remove("error");
    status.textContent = t("team_updating");
    try {
      await callOrgMembers({ action: "set_role", user_id: sel.dataset.member, role: sel.value });
      status.textContent = t("team_role_updated");
      renderTeamPanel();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add("error");
      renderTeamPanel(); // revert the dropdown to the actual server state
    }
  });

  rateEngine.addEventListener("click", async (e) => {
    if (e.target.id === "exportAllBtn") {
      exportAllData();
      return;
    }

    if (e.target.id === "teamInviteBtn") {
      const emailInput = document.getElementById("teamInviteEmail");
      const roleSelect = document.getElementById("teamInviteRole");
      const status = document.getElementById("teamStatus");
      const email = emailInput.value.trim();
      status.classList.remove("error");
      if (!email) { status.textContent = t("team_enter_email"); status.classList.add("error"); return; }
      e.target.disabled = true;
      e.target.textContent = t("inviting_btn");
      try {
        const out = await callOrgMembers({ action: "invite", email, role: roleSelect.value });
        status.textContent = out.mode === "invited"
          ? t("team_invite_sent", out.email)
          : t("team_already_added", out.email);
        emailInput.value = "";
        renderTeamPanel();
      } catch (err) {
        status.textContent = err.message;
        status.classList.add("error");
      } finally {
        e.target.disabled = false;
        e.target.textContent = t("invite_btn");
      }
      return;
    }

    const removeMemberBtn = e.target.closest("[data-removemember]");
    if (removeMemberBtn) {
      const row = removeMemberBtn.closest(".team-row");
      const email = row ? row.querySelector(".team-email").textContent.trim() : t("fallback_this_person");
      if (!confirm(t("confirm_remove_member", email))) return;
      const status = document.getElementById("teamStatus");
      status.classList.remove("error");
      try {
        await callOrgMembers({ action: "remove", user_id: removeMemberBtn.dataset.removemember });
        status.textContent = t("team_removed");
        renderTeamPanel();
      } catch (err) {
        status.textContent = err.message;
        status.classList.add("error");
      }
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
        status.textContent = t("cannot_remove_role_in_use");
        status.classList.add("error");
        return;
      }
      if (!confirm(t("confirm_remove_role", role.label))) return;
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
// Page wiring: on Settings this module IS the page; on Planning it chains
// after planning.js's own init (script order: planning.js, then this file).
if (document.getElementById("ccBlocks")) {
  const prevInit = window.initPage;
  window.initPage = () => { if (typeof prevInit === "function") prevInit(); initAssumptions(); };
} else {
  window.initPage = initAssumptions;
}
