// sidebar.js — the shared left navigation plus the two global controls that
// belong to the whole app rather than any one page: theme, and the accounting
// period (which month actuals are booked through). Rendered into
// <aside id="sidebar"> on every page. Must load AFTER data.js.
//
// Pages can hook into two events:
//   window.onThemeChanged        — fired after the theme flips (Overview uses it to redraw its chart)
//   window.refreshAfterPeriodChange — fired after the actuals-through month changes (pages re-render)

const NAV = [
  { id: "overview", label: "Overview", href: "app.html" },
  { id: "monthly", label: "Monthly", href: "monthly.html" },
  { id: "planning", label: "Planning", href: "planning.html" },
  { id: "cashflow", label: "Cash Flow", href: "cashflow.html" },
  { id: "assumptions", label: "Assumptions", href: "assumptions.html" },
];

function currentPageId() {
  const file = (location.pathname.split("/").pop() || "app.html").toLowerCase();
  if (file.startsWith("monthly")) return "monthly";
  if (file.startsWith("planning")) return "planning";
  if (file.startsWith("cashflow")) return "cashflow";
  if (file.startsWith("assumptions")) return "assumptions";
  return "overview";
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "light" ? "☀️ Light" : "🌙 Dark";
  localStorage.setItem("almgren-budget-theme", theme);
  if (typeof window.onThemeChanged === "function") window.onThemeChanged();
}

function sidebarHtml() {
  const active = currentPageId();
  const nav = NAV.map(
    (n) => `<a class="nav-item ${n.id === active ? "active" : ""}" href="${n.href}">${n.label}</a>`
  ).join("");

  // "Auto" = the sync decides (only ever fully-elapsed months — Fathom convention).
  // Picking a month is a manual override the sync will never touch.
  const monthOptions = [
    `<option value="auto"${!CLOSE_MONTH_MANUAL ? " selected" : ""}>Auto (${CLOSE_MONTH ? monthLabel(CLOSE_MONTH) : "none yet"})</option>`,
    `<option value="0"${CLOSE_MONTH_MANUAL && CLOSE_MONTH === 0 ? " selected" : ""}>None yet</option>`,
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
      <span class="sb-sub">FP&amp;A Planning</span>
    </div>
    <button class="new-org-btn" id="newOrgBtn" type="button">+ New organization</button>
    <nav class="sidebar-nav">${nav}</nav>
    <div class="sidebar-footer">
      <div class="period-box">
        <label class="period-label" for="closeMonthSelect">Actuals booked through</label>
        <select class="period-select" id="closeMonthSelect">${monthOptions}</select>
      </div>
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle light/dark theme"></button>
      <button class="logout-btn" id="logoutBtn" type="button">Sign out</button>
    </div>
  `;
}

function renderSidebar() {
  document.getElementById("sidebar").innerHTML = sidebarHtml();
  document.getElementById("themeToggle").textContent = getTheme() === "light" ? "☀️ Light" : "🌙 Dark";

  // Reflect the live tenant in the tab title so multiple orgs/tabs are distinguishable
  // (the static <title> is only a pre-load fallback).
  const activeOrg = USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || USER_ORGS[0];
  const pageLabel = (NAV.find((n) => n.id === currentPageId()) || {}).label || "";
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
applyTheme(_themeParam === "light" || _themeParam === "dark" ? _themeParam : (localStorage.getItem("almgren-budget-theme") || "dark"));
