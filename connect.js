// connect.js — the "Data" page: connect Fortnox / import actuals. All the
// actuals-loading UI lives here now (moved off Monthly so the reporting views
// stay reporting). Rendering delegates to fortnox.js: renderIntegrationPanel
// (connect + sync + the reconciled P&L + code mapping), initImport (CSV), and
// handleFortnoxRedirect (OAuth callback toast).

function initConnect() {
  handleFortnoxRedirect();
  renderIntegrationPanel(document.getElementById("integrationPanel"));
  initImport();

  // Dev hook (moved from Monthly): render the mapping editor with a mixed
  // mapped/unmapped fixture so the "Import all" path is screenshot-verifiable
  // without a live Fortnox org.
  if (location.hash === "#maptest" && typeof DEMO_MODE !== "undefined" && DEMO_MODE) {
    lastCostCenters = [
      { code: "1", name: "Produktion", cost: 14200000, mapped: true },
      { code: "2", name: "Försäljning", cost: 8300000, mapped: false },
      { code: "3", name: "Lager & Logistik", cost: 5100000, mapped: false },
      { code: "4", name: "Administration", cost: 2400000, mapped: false },
    ];
    const host = document.getElementById("integrationPanel");
    host.innerHTML = `<div class="integration-card connected"><div class="integ-mapping" id="fnMapping"></div></div>`;
    renderMappingEditor(host.querySelector("#fnMapping"));
  }
}

// Closing a month from the sidebar doesn't change anything on this page.
window.refreshAfterPeriodChange = () => {};
window.initPage = initConnect;
