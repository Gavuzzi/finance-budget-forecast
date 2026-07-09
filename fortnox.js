// fortnox.js — client side of the accounting integration.
// Loads after lib.js (sb, SUPABASE_URL/KEY) and data.js (CURRENT_ORG_ID,
// COST_CENTERS, DEMO_MODE, showToast).
//
// The Client ID is PUBLIC and belongs here. The Client SECRET is NEVER here —
// it lives only in the Edge Function secrets. Set the ID after creating your
// Fortnox integration in the Developer Portal.
const FORTNOX_CLIENT_ID = "3HheIYa28iIf";
const FORTNOX_SCOPES = "bookkeeping companyinformation";
const FORTNOX_AUTHORIZE_URL = "https://apps.fortnox.se/oauth-v1/auth";
const FN_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/fortnox-oauth`;
const fortnoxConfigured = () => FORTNOX_CLIENT_ID && !FORTNOX_CLIENT_ID.startsWith("SET_");

// The cost centres / projects returned by the last sync (from the SIE), for the mapping UI.
let lastCostCenters = [];
let lastProjects = [];

// ---- Data access -----------------------------------------------------------

async function loadIntegrationStatus() {
  const { data } = await sb.from("integration_status").select("*").eq("org_id", CURRENT_ORG_ID).maybeSingle();
  return data;
}

async function loadMappings() {
  const { data } = await sb.from("cost_center_mappings").select("external_code, cost_center_id").eq("org_id", CURRENT_ORG_ID);
  const byCc = {};
  (data || []).forEach((m) => { if (m.cost_center_id) byCc[m.cost_center_id] = m.external_code; });
  return byCc;
}

// dimension: "costcenter" (default) or "project" — project codes and cost-
// centre codes are independent namespaces and can collide as the same string,
// so the unique key (and this upsert's conflict target) includes dimension.
async function saveMapping(costCenterId, code, dimension = "costcenter") {
  code = (code || "").trim();
  if (!code) {
    await sb.from("cost_center_mappings").delete().eq("org_id", CURRENT_ORG_ID).eq("cost_center_id", costCenterId).eq("dimension", dimension);
    return;
  }
  await sb.from("cost_center_mappings").upsert(
    { org_id: CURRENT_ORG_ID, external_code: code, cost_center_id: costCenterId, dimension },
    { onConflict: "org_id,dimension,external_code" }
  );
}

// ---- Connect (OAuth) -------------------------------------------------------

async function startFortnoxConnect() {
  if (!fortnoxConfigured()) {
    showToast("Fortnox isn't configured yet — set the Client ID in fortnox.js.", "error");
    return;
  }
  const state = crypto.randomUUID();
  const { error } = await sb.from("oauth_states").insert({ state, org_id: CURRENT_ORG_ID });
  if (error) { showToast("Couldn't start the connection — " + error.message, "error"); return; }

  const params = new URLSearchParams({
    client_id: FORTNOX_CLIENT_ID,
    redirect_uri: FN_REDIRECT_URI,
    scope: FORTNOX_SCOPES,
    state,
    access_type: "offline",   // needed to receive a refresh token
    response_type: "code",
    account_type: "service",
  });
  location.href = `${FORTNOX_AUTHORIZE_URL}?${params.toString()}`;
}

async function runFortnoxSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fortnox-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ org_id: CURRENT_ORG_ID }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    let msg = `Synced — ${out.months_updated} cost-centre-month(s) updated.`;
    if (out.unmapped_cost_centers && out.unmapped_cost_centers.length) {
      msg += ` Unmapped Fortnox codes: ${out.unmapped_cost_centers.join(", ")}.`;
    }
    showToast(msg);
    lastCostCenters = out.cost_centers || [];
    lastProjects = out.projects || [];
    renderReconciliation(out);
    const ls = document.getElementById("fnLastSynced");
    if (ls) ls.textContent = "Last synced: " + new Date().toLocaleString("sv-SE");
  } catch (e) {
    showToast("Sync failed — " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Sync now"; }
  }
}

function fmtKr(n) {
  const base = typeof currencyBase === "function" ? currencyBase() : "kr";
  return (n || 0).toLocaleString("sv-SE") + " " + base;
}

// Shared P&L table (used by the live sync panel and the demo showcase), with
// a gross-margin line. `r` = { revenue, cogs, opex, personnel, total_cost, result }.
function pnlTable(r) {
  const margin = r.revenue ? Math.round((r.result / r.revenue) * 100) : 0;
  const py = r.prior_year;
  // "vs LY" delta — only when a prior fiscal year exists in the company's books.
  const vsLy = (cur, prev) => {
    if (!py || !prev) return "";
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    return ` <span class="pnl-py">${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}% vs LY</span>`;
  };
  // Revenue budget is a simple typed target (Assumptions page) — no driver
  // engine. Only shown once a target is actually set (0 = hidden, not "0% of nothing").
  const revBudget = (typeof ASSUMPTIONS !== "undefined" && ASSUMPTIONS.revenueBudget) || 0;
  const revVsBudget = revBudget
    ? ` <span class="pnl-py">${r.revenue >= revBudget ? "+" : "−"}${Math.abs(Math.round(((r.revenue - revBudget) / revBudget) * 100))}% vs budget</span>`
    : "";
  return `
    <table class="fn-recon-table">
      <tr><td>Revenue (class 3)</td><td class="num">${fmtKr(r.revenue)}${vsLy(r.revenue, py?.revenue)}${revVsBudget}</td></tr>
      <tr><td>COGS (class 4)</td><td class="num">${fmtKr(r.cogs)}</td></tr>
      <tr><td>Operating (class 5–6)</td><td class="num">${fmtKr(r.opex)}</td></tr>
      <tr><td>Personnel (class 7)</td><td class="num">${fmtKr(r.personnel)}</td></tr>
      <tr class="fn-recon-total"><td>Total cost</td><td class="num">${fmtKr(r.total_cost)}${vsLy(r.total_cost, py?.total_cost)}</td></tr>
      <tr class="fn-recon-total"><td>Result <span class="fn-margin">${margin}% margin</span></td><td class="num">${fmtKr(r.result)}${vsLy(r.result, py?.result)}</td></tr>
    </table>`;
}

// Render the P&L pulled from Fortnox after a sync (ties out to the Resultatrapport).
function renderReconciliation(out) {
  const r = out.reconciliation;
  const host = document.getElementById("fnReconciliation");
  if (!host || !r) return;
  host.innerHTML = `
    <div class="fn-recon">
      <h4>P&amp;L from Fortnox <span class="fn-recon-sub">— ties out to your Resultatrapport</span></h4>
      ${pnlTable(r)}
      <p class="fn-recon-note">Read from ${r.vouchers} vouchers / ${r.rows} rows in one call.${r.coverage_pct != null ? ` Coverage: <strong>${r.coverage_pct}%</strong> of operating costs assigned.` : ""}${r.unmapped_cost ? ` <span class="fn-recon-warn">Unassigned: ${fmtKr(r.unmapped_cost)} — shown as its own line in the grid.</span>` : " Every krona assigned ✓"}</p>
    </div>`;
}

// ---- Panel UI --------------------------------------------------------------

function demoIntegrationHtml() {
  const revenue = 52400000, cogs = 14200000, opex = 12600000, personnel = 15000000;
  const total_cost = cogs + opex + personnel;
  const r = {
    revenue, cogs, opex, personnel, total_cost, result: revenue - total_cost, coverage_pct: 100,
    prior_year: { revenue: 46800000, cogs: 13100000, opex: 11900000, personnel: 13600000, total_cost: 38600000, result: 8200000 },
  };
  return `
    <div class="integration-card connected">
      <div class="integ-head"><span class="integ-dot"></span> Connected to Fortnox · Meridian Manufacturing AB <span class="integ-demo-tag">demo</span></div>
      <p class="integ-sub">What a live connection looks like: your real accounting, reconciled automatically — no CSV, no re-keying. (Sample data.)</p>
      <div class="fn-recon">
        <h4>Actuals from Fortnox — full-year P&amp;L</h4>
        ${pnlTable(r)}
        <p class="fn-recon-note">Read from 3 214 vouchers in one call · ties out to Fortnox's Resultatrapport.</p>
        <div class="fn-cc-maplabel">Cost centres — auto-mapped from your ledger:</div>
        <div class="fn-cc-chips">
          <span class="fn-cc-chip">✓ Production</span>
          <span class="fn-cc-chip">✓ Sales &amp; Marketing</span>
          <span class="fn-cc-chip">✓ R&amp;D</span>
          <span class="fn-cc-chip">✓ Administration</span>
          <span class="fn-cc-chip">✓ IT</span>
        </div>
      </div>
    </div>`;
}

function disconnectedHtml() {
  const note = fortnoxConfigured() ? "" : `<p class="integ-warn">Not configured yet — add your Client ID in <code>fortnox.js</code>.</p>`;
  return `
    <div class="integration-card">
      <div class="integ-head"><span class="integ-logo">⇄</span> Connect your accounting</div>
      <p class="integ-sub">Connect <strong>Fortnox</strong> to import booked actuals automatically instead of uploading CSVs.</p>
      <button class="integ-btn" id="fnConnectBtn" type="button">Connect Fortnox →</button>
      ${note}
    </div>`;
}

function connectedHtml(status) {
  const last = status.last_synced_at ? new Date(status.last_synced_at).toLocaleString("sv-SE") : "never";
  const err = status.last_sync_error ? `<p class="integ-warn">Last sync error: ${status.last_sync_error}</p>` : "";
  return `
    <div class="integration-card connected">
      <div class="integ-head"><span class="integ-dot"></span> Connected to Fortnox${status.tenant_name ? " · " + status.tenant_name : ""}</div>
      <p class="integ-sub" id="fnLastSynced">Last synced: ${last}</p>
      <div class="integ-actions">
        <button class="integ-btn" id="fnSyncBtn" type="button">Sync now</button>
        <button class="integ-link" id="fnMapToggle" type="button">Cost-centre mapping</button>
        <button class="integ-link" id="fnReconnectBtn" type="button">Switch company</button>
      </div>
      ${err}
      <div id="fnReconciliation"></div>
      <div class="integ-mapping" id="fnMapping" hidden></div>
    </div>`;
}

// Shared row markup for a mappable Fortnox object (cost centre or project):
// name + code + cost from the last sync, with one-click Import/Link.
function codeRowsHtml(items, dimension) {
  const options = COST_CENTERS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  return `
    <div class="fn-cc-rows">
      ${items.map((it) => `
        <div class="fn-cc-row" data-code="${it.code}" data-dim="${dimension}">
          <span class="fn-cc-name">${it.name} <span class="fn-cc-code">${it.code}</span></span>
          <span class="fn-cc-cost num">${fmtKr(it.cost)}</span>
          ${it.mapped
            ? `<span class="fn-cc-mapped">✓ mapped</span>`
            : `<span class="fn-cc-actions">
                 <button class="fn-cc-import" type="button">Import</button>
                 <select class="fn-cc-link"><option value="">Link to…</option>${options}</select>
               </span>`}
        </div>`).join("")}
    </div>`;
}

// Shows the REAL Fortnox cost centres AND projects (name + code + cost) from
// the last sync, each with a one-click "Import as new reporting line" or
// "Link to existing". Precedence on sync: project tag → cost-centre tag →
// account range → Unassigned (a row rarely carries both, but if it does, the
// project is more specific and wins).
async function renderMappingEditor(host) {
  const ccSection = lastCostCenters.length
    ? `<p class="integ-map-hint">Your Fortnox <strong>cost centres</strong>. <strong>Import</strong> each as a reporting line, or <strong>link</strong> it to an existing one, then re-sync to pull its actuals in. Nothing is dropped.</p>` + codeRowsHtml(lastCostCenters, "costcenter")
    : `<p class="integ-map-hint">Hit <strong>Sync now</strong> first — then your Fortnox cost centres appear here to map in one click. (No cost centres in your books? Use account ranges below.)</p>`;
  const projSection = lastProjects.length
    ? `<p class="integ-map-hint fn-section-gap"><strong>Projects</strong> — matched before cost centres when a booking carries both.</p>` + codeRowsHtml(lastProjects, "project")
    : "";
  host.innerHTML = ccSection + projSection + `<div id="fnAcctRanges" class="fn-acct-ranges"></div>`;
  renderAccountRanges(host);
  host.querySelectorAll(".fn-cc-row[data-code]").forEach((row) => {
    const dim = row.dataset.dim;
    const item = (dim === "project" ? lastProjects : lastCostCenters).find((c) => c.code === row.dataset.code);
    const imp = row.querySelector(".fn-cc-import");
    if (imp) imp.addEventListener("click", () => importCostCenter(item, host, dim));
    const sel = row.querySelector(".fn-cc-link");
    if (sel) sel.addEventListener("change", () => { if (sel.value) linkCostCenter(item, sel.value, host, dim); });
  });
}

// ---- Account-range mappings (fallback for untagged bookings) ----------------

async function loadAccountRanges() {
  const { data } = await sb.from("cost_center_mappings")
    .select("id, account_from, account_to, cost_center_id")
    .eq("org_id", CURRENT_ORG_ID).eq("dimension", "account");
  return data || [];
}

async function renderAccountRanges(host) {
  const ranges = await loadAccountRanges();
  const el = host.querySelector("#fnAcctRanges");
  if (!el) return;
  const options = COST_CENTERS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  el.innerHTML = `
    <p class="integ-map-hint"><strong>Account ranges</strong> — fallback for bookings without a cost-centre tag: any BAS account in a range lands on the chosen line. (E.g. 4000–4999 → Production.)</p>
    ${ranges.map((r) => `
      <div class="fn-cc-row">
        <span class="fn-cc-name">${r.account_from}–${r.account_to} → ${(COST_CENTERS.find((c) => c.id === r.cost_center_id) || {}).name || "?"}</span>
        <span></span>
        <button class="integ-link" data-del="${r.id}" type="button">Remove</button>
      </div>`).join("")}
    <div class="fn-acct-add">
      <input type="number" id="fnAcctFrom" placeholder="4000" min="1000" max="9999">
      <span>–</span>
      <input type="number" id="fnAcctTo" placeholder="4999" min="1000" max="9999">
      <span>→</span>
      <select id="fnAcctCc">${options}</select>
      <button class="fn-cc-import" id="fnAcctAdd" type="button">Add</button>
    </div>`;
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    await sb.from("cost_center_mappings").delete().eq("id", b.dataset.del);
    showToast("Range removed — re-sync to apply.");
    renderAccountRanges(host);
  }));
  el.querySelector("#fnAcctAdd").addEventListener("click", async () => {
    const from = parseInt(el.querySelector("#fnAcctFrom").value, 10);
    const to = parseInt(el.querySelector("#fnAcctTo").value, 10);
    const ccId = el.querySelector("#fnAcctCc").value;
    if (!from || !to || from > to || !ccId) { showToast("Enter a valid range (from ≤ to).", "error"); return; }
    const { error } = await sb.from("cost_center_mappings").insert({
      org_id: CURRENT_ORG_ID, dimension: "account", external_code: `${from}-${to}`,
      account_from: from, account_to: to, cost_center_id: ccId,
    });
    if (error) { showToast("Couldn't add — " + error.message, "error"); return; }
    showToast("Range added — re-sync to apply.");
    renderAccountRanges(host);
  });
}

async function importCostCenter(item, host, dimension = "costcenter") {
  const { data, error } = await sb.from("cost_centers")
    .insert({ org_id: CURRENT_ORG_ID, name: item.name, annual_budget: 0, other_monthly: 0 })
    .select().single();
  if (error) { showToast("Couldn't create — " + error.message, "error"); return; }
  COST_CENTERS.push({ id: data.id, name: data.name, annualBudget: 0, otherMonthly: 0, note: "", headcount: [], oneOffs: [], recurringCosts: [], overrides: {}, actualMonthly: [] });
  await saveMapping(data.id, item.code, dimension);
  item.mapped = true;
  showToast(`Imported "${item.name}" and mapped it.`);
  renderMappingEditor(host);
}

async function linkCostCenter(item, appCcId, host, dimension = "costcenter") {
  await saveMapping(appCcId, item.code, dimension);
  item.mapped = true;
  showToast(`Linked ${item.code} → ${COST_CENTERS.find((c) => c.id === appCcId)?.name || "line"}.`);
  renderMappingEditor(host);
}

function wireIntegrationPanel(host, status) {
  const connectBtn = host.querySelector("#fnConnectBtn");
  if (connectBtn) connectBtn.addEventListener("click", startFortnoxConnect);

  const syncBtn = host.querySelector("#fnSyncBtn");
  if (syncBtn) syncBtn.addEventListener("click", () => runFortnoxSync(syncBtn));

  const reconnectBtn = host.querySelector("#fnReconnectBtn");
  if (reconnectBtn) reconnectBtn.addEventListener("click", startFortnoxConnect);

  const mapToggle = host.querySelector("#fnMapToggle");
  const mapping = host.querySelector("#fnMapping");
  if (mapToggle && mapping) {
    mapToggle.addEventListener("click", async () => {
      mapping.hidden = !mapping.hidden;
      if (!mapping.hidden) await renderMappingEditor(mapping);
    });
  }
}

async function renderIntegrationPanel(host) {
  if (!host) return;
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { host.innerHTML = demoIntegrationHtml(); return; }
  const status = await loadIntegrationStatus();
  host.innerHTML = status && status.connected ? connectedHtml(status) : disconnectedHtml();
  wireIntegrationPanel(host, status);
  // Show the last synced P&L immediately, without waiting for another sync.
  if (status && status.connected && status.last_reconciliation) {
    renderReconciliation({ reconciliation: status.last_reconciliation });
  }
}

// Surface the OAuth callback result (?fortnox=connected|error) as a toast.
function handleFortnoxRedirect() {
  const p = new URLSearchParams(location.search);
  const r = p.get("fortnox");
  if (!r) return;
  if (r === "connected") showToast("Fortnox connected. Hit “Sync now” to pull your actuals.");
  else showToast("Fortnox connection failed. Please try again.", "error");
  p.delete("fortnox");
  history.replaceState({}, "", location.pathname + (p.toString() ? "?" + p : ""));
}
