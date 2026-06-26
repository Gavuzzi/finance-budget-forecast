// sidebar.js — the shared left navigation plus the two global controls that
// belong to the whole app rather than any one page: theme, and the accounting
// period (which month actuals are booked through). Rendered into
// <aside id="sidebar"> on every page. Must load AFTER data.js.
//
// Pages can hook into two events:
//   window.onThemeChanged        — fired after the theme flips (Overview uses it to redraw its chart)
//   window.refreshAfterPeriodChange — fired after a month is closed (pages re-render their data)

const NAV = [
  { id: "overview", label: "Overview", href: "index.html" },
  { id: "monthly", label: "Monthly", href: "monthly.html" },
  { id: "planning", label: "Planning", href: "planning.html" },
  { id: "assumptions", label: "Assumptions", href: "assumptions.html" },
];

function currentPageId() {
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (file.startsWith("monthly")) return "monthly";
  if (file.startsWith("planning")) return "planning";
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

  const atCap = CLOSE_MONTH >= MAX_CLOSE_MONTH;
  const periodAction = atCap
    ? `<span class="period-note">All available months closed</span>`
    : `<button class="period-close" id="closeMonthBtn" type="button">Close ${monthLabel(CLOSE_MONTH + 1)} →</button>`;

  return `
    <div class="sidebar-brand">
      ${USER_ORGS.length > 1
        ? `<select class="org-switcher" id="orgSwitcher">${USER_ORGS.map((o) => `<option value="${o.id}" ${o.id === CURRENT_ORG_ID ? "selected" : ""}>${o.name}</option>`).join("")}</select>`
        : `<span class="sb-name">${(USER_ORGS[0] && USER_ORGS[0].name) || "—"}</span>`}
      <span class="sb-sub">FP&amp;A Planning</span>
    </div>
    <button class="new-org-btn" id="newOrgBtn" type="button">+ New organization</button>
    <nav class="sidebar-nav">${nav}</nav>
    <div class="sidebar-footer">
      <div class="period-box">
        <span class="period-label">Actuals booked through</span>
        <span class="period-value">${monthLabel(CLOSE_MONTH)}</span>
        ${periodAction}
      </div>
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle light/dark theme"></button>
      <button class="logout-btn" id="logoutBtn" type="button">Sign out</button>
    </div>
  `;
}

function renderSidebar() {
  document.getElementById("sidebar").innerHTML = sidebarHtml();
  document.getElementById("themeToggle").textContent = getTheme() === "light" ? "☀️ Light" : "🌙 Dark";

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
  });

  const closeBtn = document.getElementById("closeMonthBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      const next = monthLabel(CLOSE_MONTH + 1);
      if (!confirm(`Close ${next}? This locks in that month's actuals and can't be reopened.`)) return;
      advanceCloseMonth();
      dbUpdateCloseMonth();
      renderSidebar(); // refresh the period label + button
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
applyTheme(localStorage.getItem("almgren-budget-theme") || "dark");
