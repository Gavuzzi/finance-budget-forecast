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

  return `
    <div class="sidebar-brand">
      ${USER_ORGS.length > 1
        ? `<select class="org-switcher" id="orgSwitcher">${USER_ORGS.map((o) => `<option value="${o.id}" ${o.id === CURRENT_ORG_ID ? "selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}</select>`
        : `<span class="sb-name">${escapeHtml((USER_ORGS[0] && USER_ORGS[0].name) || "—")}</span>`}
      <span class="sb-sub">${t("brand_sub")}</span>
    </div>
    <button class="new-org-btn" id="newOrgBtn" type="button">${t("new_org_btn")}</button>
    ${versionSwitcherHtml()}
    <nav class="sidebar-nav">${nav}</nav>
    <div class="sidebar-footer">
      ${syncBadgeHtml()}
      <div class="period-box">
        <label class="period-label" for="closeMonthSelect">${t("period_label")}</label>
        <select class="period-select" id="closeMonthSelect">${monthOptions}</select>
      </div>
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle light/dark theme"></button>
      <button class="lang-toggle" id="langToggle" type="button">${t("lang_toggle")}</button>
      <button class="logout-btn" id="logoutBtn" type="button">${t("sign_out")}</button>
    </div>
  `;
}

// The plan-version switcher (Phase 8): pick Main / a scenario / a locked
// budget, or branch a new scenario. Hidden until versions are loaded.
function versionSwitcherHtml() {
  if (!Array.isArray(PLAN_VERSIONS) || PLAN_VERSIONS.length === 0) return "";
  const opts = PLAN_VERSIONS.map((v) =>
    `<option value="${v.id}" ${v.id === ACTIVE_VERSION_ID ? "selected" : ""}>${escapeHtml(v.name)}${v.lockedAt ? " 🔒" : ""}</option>`).join("");
  return `
    <div class="version-box">
      <label class="version-label" for="versionSwitcher">${t("plan_version_label")}</label>
      <div class="version-row">
        <select class="version-switcher" id="versionSwitcher">${opts}</select>
        <button class="version-new" id="newScenarioBtn" type="button" title="${t("new_scenario_title")}">${t("new_scenario_btn")}</button>
      </div>
    </div>`;
}

function renderSidebar() {
  document.getElementById("sidebar").innerHTML = sidebarHtml();
  document.getElementById("themeToggle").textContent = getTheme() === "light" ? t("theme_light") : t("theme_dark");

  document.getElementById("langToggle").addEventListener("click", () => {
    setLang(getLang() === "sv" ? "en" : "sv");
  });

  // Reflect the live tenant in the tab title so multiple orgs/tabs are distinguishable
  // (the static <title> is only a pre-load fallback).
  const activeOrg = USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || USER_ORGS[0];
  const pageLabel = t("nav_" + currentPageId());
  if (activeOrg && activeOrg.name) document.title = `${pageLabel} · ${activeOrg.name}`;

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
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
