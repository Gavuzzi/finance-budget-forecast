// sidebar.js — the shared left navigation plus the two global controls that
// belong to the whole app rather than any one page: theme, and the accounting
// period (which month actuals are booked through). Rendered into
// <aside id="sidebar"> on every page. Must load AFTER data.js.
//
// Pages can hook into two events:
//   window.onThemeChanged        — fired after the theme flips (Overview uses it to redraw its chart)
//   window.refreshAfterPeriodChange — fired after the actuals-through month changes (pages re-render)

const NAV = [
  { id: "overview", href: "app.html" },
  { id: "monthly", href: "monthly.html" },
  { id: "planning", href: "planning.html" },
  { id: "cashflow", href: "cashflow.html" },
  { id: "connect", href: "connect.html" },
  { id: "assumptions", href: "assumptions.html" },
];

function currentPageId() {
  const file = (location.pathname.split("/").pop() || "app.html").toLowerCase();
  if (file.startsWith("monthly")) return "monthly";
  if (file.startsWith("planning")) return "planning";
  if (file.startsWith("cashflow")) return "cashflow";
  if (file.startsWith("connect")) return "connect";
  if (file.startsWith("assumptions")) return "assumptions";
  return "overview";
}

// Transient: the booked-through select stays visible after "change" is
// clicked, until the user hands control back to auto. Not persisted.
let _showPeriodSelect = false;

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "light" ? t("theme_light") : t("theme_dark");
  localStorage.setItem("almgren-budget-theme", theme);
  if (typeof window.onThemeChanged === "function") window.onThemeChanged();
}

// Data-freshness badge (steal: Fathom). Finance people don't trust a number
// until they know how current it is — and a silently-failed sync is worse
// than none. Green under 48h, amber when stale, red on a sync error. Only
// shown for Fortnox-connected orgs; links to Monthly where the sync lives.
function syncBadgeHtml() {
  if (!SYNC_STATUS || !SYNC_STATUS.last_synced_at) return "";
  const when = new Date(SYNC_STATUS.last_synced_at).toLocaleString("sv-SE");
  if (SYNC_STATUS.last_sync_error) {
    return `<a class="sync-badge error" href="monthly.html" title="${escapeHtml(SYNC_STATUS.last_sync_error)}"><span class="sync-dot"></span>${t("sync_error")}</a>`;
  }
  const ageH = (Date.now() - new Date(SYNC_STATUS.last_synced_at).getTime()) / 3600000;
  if (ageH >= 48) {
    return `<a class="sync-badge stale" href="monthly.html" title="${when}"><span class="sync-dot"></span>${t("sync_stale", Math.floor(ageH / 24))}</a>`;
  }
  const label = ageH < 1 ? t("sync_just_now") : ageH < 24 ? t("sync_hours_ago", Math.round(ageH)) : t("sync_yesterday");
  return `<span class="sync-badge fresh" title="${when}"><span class="sync-dot"></span>${t("sync_fresh", label)}</span>`;
}

function sidebarHtml() {
  const active = currentPageId();
  const nav = NAV.map(
    (n) => `<a class="nav-item ${n.id === active ? "active" : ""}" href="${n.href}">${t("nav_" + n.id)}</a>`
  ).join("");

  // "Auto" = the sync decides (only ever fully-elapsed months — Fathom convention).
  // Picking a month is a manual override the sync will never touch.
  const monthOptions = [
    `<option value="auto"${!CLOSE_MONTH_MANUAL ? " selected" : ""}>${t("period_auto", CLOSE_MONTH ? monthLabel(CLOSE_MONTH) : t("period_none_yet"))}</option>`,
    `<option value="0"${CLOSE_MONTH_MANUAL && CLOSE_MONTH === 0 ? " selected" : ""}>${t("period_none_yet")}</option>`,
  ]
    .concat(
      Array.from({ length: TIMELINE_LENGTH }, (_, i) => i + 1).map(
        (m) => `<option value="${m}"${CLOSE_MONTH_MANUAL && m === CLOSE_MONTH ? " selected" : ""}>${monthLabel(m)}</option>`
      )
    )
    .join("");

  // "Actuals booked through" [#7]: the read-out is the ONLY resting state —
  // the select appears just while choosing and collapses again on every pick
  // (it used to stay open for manual overrides, which read as a stuck control).
  // A manual override is flagged with a small tag instead.
  const periodControl = _showPeriodSelect
    ? `<div class="period-box">
        <label class="period-label" for="closeMonthSelect">${t("period_label")}</label>
        <select class="period-select" id="closeMonthSelect">${monthOptions}</select>
      </div>`
    : `<div class="period-line">
        <span>${t("period_booked_through", CLOSE_MONTH ? monthLabel(CLOSE_MONTH) : t("period_none_yet"))}${CLOSE_MONTH_MANUAL ? ` <span class="period-manual">${t("period_manual_tag")}</span>` : ""}</span>
        <button class="period-edit" id="periodEditBtn" type="button">${t("period_change")}</button>
      </div>`;

  return `
    <div class="sidebar-brand">
      ${USER_ORGS.length > 1
        ? `<select class="org-switcher" id="orgSwitcher" title="${escapeHtml((USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {}).name || "")}">${USER_ORGS.map((o) => `<option value="${o.id}" ${o.id === CURRENT_ORG_ID ? "selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}</select>`
        : `<span class="sb-name" title="${escapeHtml((USER_ORGS[0] && USER_ORGS[0].name) || "")}">${escapeHtml((USER_ORGS[0] && USER_ORGS[0].name) || "—")}</span>`}
    </div>
    <button class="new-org-btn" id="newOrgBtn" type="button">${t("new_org_btn")}</button>
    ${versionSwitcherHtml()}
    <nav class="sidebar-nav">${nav}</nav>
    <div class="sidebar-footer">
      ${syncBadgeHtml()}
      ${periodControl}
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle light/dark theme"></button>
      <div class="lang-seg" id="langToggle" role="group" aria-label="Language">
        <button class="lang-opt ${getLang() === "en" ? "active" : ""}" data-lang="en" type="button">EN</button>
        <button class="lang-opt ${getLang() === "sv" ? "active" : ""}" data-lang="sv" type="button">SV</button>
      </div>
      <button class="logout-btn" id="logoutBtn" type="button">${t("sign_out")}</button>
    </div>
  `;
}

// The plan-version switcher (Phase 8): the FORECAST (working plan), locked
// BUDGETS, and SCENARIOS — the industry's mental model, grouped so the three
// concepts never blur. Hidden until versions are loaded.
function versionSwitcherHtml() {
  if (!Array.isArray(PLAN_VERSIONS) || PLAN_VERSIONS.length === 0) return "";
  const opt = (v) => `<option value="${v.id}" ${v.id === ACTIVE_VERSION_ID ? "selected" : ""}>${escapeHtml(versionDisplayName(v))}</option>`;
  const forecast = PLAN_VERSIONS.filter((v) => v.isMain).map(opt).join("");
  const budgets = PLAN_VERSIONS.filter((v) => !v.isMain && v.lockedAt).map(opt).join("");
  const scenarios = PLAN_VERSIONS.filter((v) => !v.isMain && !v.lockedAt).map(opt).join("");
  return `
    <div class="version-box">
      <label class="version-label" for="versionSwitcher">${t("plan_version_label")}</label>
      <div class="version-row">
        <select class="version-switcher" id="versionSwitcher">
          ${forecast}
          ${budgets ? `<optgroup label="${t("version_group_budgets")}">${budgets}</optgroup>` : ""}
          ${scenarios ? `<optgroup label="${t("version_group_scenarios")}">${scenarios}</optgroup>` : ""}
        </select>
        <button class="version-new" id="newScenarioBtn" type="button" title="${t("new_scenario_title")}">${t("new_scenario_btn")}</button>
      </div>
      ${versionLocked()
        ? `<span class="version-locked-note">${t("version_locked_note")}</span>`
        : `<button class="version-lock" id="lockBudgetBtn" type="button">${t("lock_budget_btn")}</button>`}
    </div>`;
}

function renderSidebar() {
  document.getElementById("sidebar").innerHTML = sidebarHtml();
  document.getElementById("themeToggle").textContent = getTheme() === "light" ? t("theme_light") : t("theme_dark");

  // Segmented EN/SV — click the inactive one to switch (clearer than a single
  // button that showed the target language and read as if it were the current).
  document.querySelectorAll("#langToggle .lang-opt").forEach((btn) => {
    btn.addEventListener("click", () => { if (btn.dataset.lang !== getLang()) setLang(btn.dataset.lang); });
  });

  // Reflect the live tenant in the tab title so multiple orgs/tabs are distinguishable
  // (the static <title> is only a pre-load fallback).
  const activeOrg = USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || USER_ORGS[0];
  const pageLabel = t("nav_" + currentPageId());
  if (activeOrg && activeOrg.name) document.title = `${pageLabel} · ${activeOrg.name}`;

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
  });

  const periodEditBtn = document.getElementById("periodEditBtn");
  if (periodEditBtn) periodEditBtn.addEventListener("click", () => {
    _showPeriodSelect = true;
    renderSidebar();
  });

  const closeSel = document.getElementById("closeMonthSelect");
  if (closeSel) {
    closeSel.addEventListener("change", () => {
      if (closeSel.value === "auto") {
        CLOSE_MONTH_MANUAL = false;      // hand control back to the sync
      } else {
        CLOSE_MONTH_MANUAL = true;       // manual override — syncs won't touch it
        setCloseMonth(parseInt(closeSel.value, 10));
      }
      _showPeriodSelect = false;         // every pick collapses back to the read-out
      dbUpdateCloseMonth();
      renderSidebar();                    // refresh the Auto label/selection
      if (typeof window.refreshAfterPeriodChange === "function") window.refreshAfterPeriodChange();
    });
  }

  // Switching tenant reloads with the new org selected (loadData reads the saved choice).
  const orgSel = document.getElementById("orgSwitcher");
  if (orgSel) {
    orgSel.addEventListener("change", () => {
      localStorage.setItem(ORG_STORAGE_KEY, orgSel.value);
      location.reload();
    });
  }

  // Switching plan version reloads with that version's drivers.
  const verSel = document.getElementById("versionSwitcher");
  if (verSel) verSel.addEventListener("change", () => switchVersion(verSel.value));

  const newScenarioBtn = document.getElementById("newScenarioBtn");
  if (newScenarioBtn) newScenarioBtn.addEventListener("click", async () => {
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
    const name = prompt(t("prompt_new_scenario"));
    if (!name || !name.trim()) return;
    const id = await dbCreateVersion(name.trim());
    if (id) switchVersion(id); // reloads into the new scenario, ready to edit
  });

  const lockBudgetBtn = document.getElementById("lockBudgetBtn");
  if (lockBudgetBtn) lockBudgetBtn.addEventListener("click", async () => {
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return; }
    const name = prompt(t("prompt_lock_budget"), t("default_budget_name"));
    if (!name || !name.trim()) return;
    const id = await dbLockAsBudget(name.trim());
    if (id) { showToast(t("toast_budget_locked")); location.reload(); } // stay on current version; dropdown gains the budget
  });

  const newOrgBtn = document.getElementById("newOrgBtn");
  if (newOrgBtn) newOrgBtn.addEventListener("click", createOrg);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.reload();
  });
}

// Apply the saved theme immediately (styles the login screen too). The sidebar
// itself is rendered by the auth bootstrap once data has loaded — it needs
// CLOSE_MONTH and the rest of the model to be populated first.
const _themeParam = new URLSearchParams(location.search).get("theme");
applyTheme(_themeParam === "light" || _themeParam === "dark" ? _themeParam : (localStorage.getItem("almgren-budget-theme") || "light"));
