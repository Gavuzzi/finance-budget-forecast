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

async function saveMapping(costCenterId, code) {
  code = (code || "").trim();
  if (!code) {
    await sb.from("cost_center_mappings").delete().eq("org_id", CURRENT_ORG_ID).eq("cost_center_id", costCenterId);
    return;
  }
  await sb.from("cost_center_mappings").upsert(
    { org_id: CURRENT_ORG_ID, external_code: code, cost_center_id: costCenterId },
    { onConflict: "org_id,external_code" }
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
    renderReconciliation(out);
  } catch (e) {
    showToast("Sync failed — " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Sync now"; }
  }
}

function fmtKr(n) { return (n || 0).toLocaleString("sv-SE") + " kr"; }

// Show the full-P&L reconciliation returned by the sync, to compare against
// Fortnox's own Resultatrapport. This is the Phase 0 tie-out check.
function renderReconciliation(out) {
  const r = out.reconciliation;
  const host = document.getElementById("fnReconciliation");
  if (!host || !r) return;
  host.innerHTML = `
    <div class="fn-recon">
      <h4>Sync reconciliation — compare to Fortnox's Resultatrapport</h4>
      <table class="fn-recon-table">
        <tr><td>Revenue (class 3)</td><td class="num">${fmtKr(r.revenue)}</td></tr>
        <tr><td>COGS (class 4)</td><td class="num">${fmtKr(r.cogs)}</td></tr>
        <tr><td>Operating (class 5–6)</td><td class="num">${fmtKr(r.opex)}</td></tr>
        <tr><td>Personnel (class 7)</td><td class="num">${fmtKr(r.personnel)}</td></tr>
        <tr class="fn-recon-total"><td>Total cost</td><td class="num">${fmtKr(r.total_cost)}</td></tr>
        <tr class="fn-recon-total"><td>Result</td><td class="num">${fmtKr(r.result)}</td></tr>
      </table>
      <p class="fn-recon-note">Read from ${r.vouchers} vouchers / ${r.rows} rows. Captured into cost centres: ${fmtKr(r.captured_cost)}${r.unmapped_cost ? ` · unmapped: ${fmtKr(r.unmapped_cost)}` : ""}.</p>
    </div>`;
}

// ---- Panel UI --------------------------------------------------------------

function demoIntegrationHtml() {
  return `
    <div class="integration-card">
      <div class="integ-head"><span class="integ-logo">⇄</span> Connect your accounting</div>
      <p class="integ-sub">In the live app, connect <strong>Fortnox</strong> once and every month's actuals import themselves — no CSV, no re-keying. This demo uses sample data.</p>
      <button class="integ-btn" type="button" disabled>Connect Fortnox (demo)</button>
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
      <p class="integ-sub">Last synced: ${last}</p>
      <div class="integ-actions">
        <button class="integ-btn" id="fnSyncBtn" type="button">Sync now</button>
        <button class="integ-link" id="fnMapToggle" type="button">Cost-centre mapping</button>
      </div>
      ${err}
      <div id="fnReconciliation"></div>
      <div class="integ-mapping" id="fnMapping" hidden></div>
    </div>`;
}

async function renderMappingEditor(host) {
  const current = await loadMappings();
  host.innerHTML = `
    <p class="integ-map-hint">Enter each cost center's Fortnox cost-centre code (kostnadsställe). Actuals with that code get booked here.</p>
    <div class="integ-map-rows">
      ${COST_CENTERS.map((cc) => `
        <label class="integ-map-row">
          <span>${cc.name}</span>
          <input type="text" data-cc="${cc.id}" value="${current[cc.id] || ""}" placeholder="e.g. 1">
        </label>`).join("")}
    </div>`;
  host.querySelectorAll("input[data-cc]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      await saveMapping(inp.dataset.cc, inp.value);
      showToast("Mapping saved.");
    });
  });
}

function wireIntegrationPanel(host, status) {
  const connectBtn = host.querySelector("#fnConnectBtn");
  if (connectBtn) connectBtn.addEventListener("click", startFortnoxConnect);

  const syncBtn = host.querySelector("#fnSyncBtn");
  if (syncBtn) syncBtn.addEventListener("click", () => runFortnoxSync(syncBtn));

  const mapToggle = host.querySelector("#fnMapToggle");
  const mapping = host.querySelector("#fnMapping");
  if (mapToggle && mapping) {
    mapToggle.addEventListener("click", async () => {
      mapping.hidden = !mapping.hidden;
      if (!mapping.hidden && !mapping.dataset.loaded) {
        await renderMappingEditor(mapping);
        mapping.dataset.loaded = "1";
      }
    });
  }
}

async function renderIntegrationPanel(host) {
  if (!host) return;
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { host.innerHTML = demoIntegrationHtml(); return; }
  const status = await loadIntegrationStatus();
  host.innerHTML = status && status.connected ? connectedHtml(status) : disconnectedHtml();
  wireIntegrationPanel(host, status);
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
