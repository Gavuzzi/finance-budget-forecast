// Edge Function: fortnox-sync  (self-contained)
//
// NEVER-FAIL read: exports the whole financial year as ONE SIE file (/3/sie/4)
// and parses it locally. O(1) API calls regardless of voucher count — no N+1,
// no rate-limit death, no timeout. Scales from 500 to 500,000 vouchers.
//
// Two callers share the same engine:
//   • the app (user JWT; authorized in-code via can_edit_org, one org), and
//   • the nightly pg_cron job (x-cron-key header === CRON_SECRET, all connected orgs).
//
// "Enforce JWT" stays OFF. Secrets: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET, CRON_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";
const FY_BASE_YEAR = 2026;   // app month 1 = Jan of this year

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-cron-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function fortnoxGet(path: string, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function refreshTokens(refreshToken: string) {
  const id = Deno.env.get("FORTNOX_CLIENT_ID")!;
  const secret = Deno.env.get("FORTNOX_CLIENT_SECRET")!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Lightweight P&L-only parse of a SIE export (used for the PRIOR fiscal year —
// baseline for "vs last year" deltas). Same stream approach, classes only.
async function fetchPnlTotals(accessToken: string, fyId: number | string) {
  const res = await fetch(`${API_BASE}/sie/4?financialyear=${fyId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "*/*" },
  });
  if (!res.ok || !res.body) return null;
  let revRaw = 0, cogs = 0, opex = 0, personnel = 0;
  const reader = res.body.pipeThrough(new TextDecoderStream("latin1")).getReader();
  let buf = "";
  const line = (l: string) => {
    const t = l.trimStart().match(/^#TRANS\s+(\d+)\s+\{[^}]*\}\s+(-?\d+(?:\.\d+)?)/);
    if (!t) return;
    const cls = Math.floor(Number(t[1]) / 1000);
    const amt = Number(t[2]);
    if (cls === 3) revRaw += amt;
    else if (cls === 4) cogs += amt;
    else if (cls === 5 || cls === 6) opex += amt;
    else if (cls === 7) personnel += amt;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) line(l);
  }
  if (buf) line(buf);
  const revenue = -revRaw, totalCost = cogs + opex + personnel;
  return {
    revenue: Math.round(revenue), cogs: Math.round(cogs), opex: Math.round(opex),
    personnel: Math.round(personnel), total_cost: Math.round(totalCost),
    result: Math.round(revenue - totalCost),
  };
}

// The whole sync for one org: refresh tokens → SIE export → stream-parse →
// replace actuals → persist FY anchor + P&L. Returns the response payload.
async function syncOrg(admin: any, org_id: string) {
  // 1. Tokens; refresh if expired/near-expiry.
  const { data: integ } = await admin.from("integrations").select("*").eq("org_id", org_id).single();
  if (!integ) throw new Error("not connected");

  let accessToken = integ.access_token as string;
  if (!integ.token_expires_at || new Date(integ.token_expires_at).getTime() < Date.now() + 60_000) {
    const tok = await refreshTokens(integ.refresh_token);
    accessToken = tok.access_token;
    await admin.from("integrations").update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 45 * 864e5).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("org_id", org_id);
  }

  // 2. Mapping rules, split by dimension. Precedence per cost row: PROJECT tag
  //    (SIE dim 6, the more specific dimension) → COST-CENTRE tag (dim 1) →
  //    account-range fallback → Unassigned. Account ranges make untagged
  //    companies syncable; project codes and cost-centre codes are independent
  //    namespaces (can collide as the same string), hence two separate maps.
  const { data: maps } = await admin.from("reporting_line_mappings")
    .select("external_code, reporting_line_id, dimension, account_from, account_to").eq("org_id", org_id);
  const costCodeToCc = new Map<string, string>();
  const projCodeToCc = new Map<string, string>();
  const acctRanges: { from: number; to: number; ccId: string }[] = [];
  (maps ?? []).forEach((m: any) => {
    if (!m.reporting_line_id) return;
    if (m.dimension === "account" && m.account_from != null && m.account_to != null) {
      acctRanges.push({ from: m.account_from, to: m.account_to, ccId: m.reporting_line_id });
    } else if (m.dimension === "project") {
      projCodeToCc.set(m.external_code, m.reporting_line_id);
    } else {
      costCodeToCc.set(m.external_code, m.reporting_line_id);
    }
  });

  // Noise filters: an excluded voucher series (e.g. a correction/adjustment
  // series) or excluded account (e.g. opening-balance postings) is fully
  // ignored — not counted anywhere, not just left unmapped.
  const { data: exclRows } = await admin.from("sync_exclusions").select("kind, value").eq("org_id", org_id);
  const excludedSeries = new Set<string>();
  const excludedAccounts = new Set<number>();
  (exclRows ?? []).forEach((r: any) => {
    if (r.kind === "series") excludedSeries.add(String(r.value).toUpperCase());
    else if (r.kind === "account") excludedAccounts.add(Number(r.value));
  });

  // VAT/payroll-tax account ranges (Phase 5 v2 cash flow) — configurable per
  // org since exact chart-of-accounts usage varies. Defaults land on BAS
  // standard: 2610-2659 (moms sub-accounts + 2650 settlement), 2710-2739
  // (personalskatt + arbetsgivaravgifter settlement).
  const { data: asmp } = await admin.from("assumptions")
    .select("vat_account_from, vat_account_to, payroll_account_from, payroll_account_to").eq("org_id", org_id).maybeSingle();
  const vatFrom = asmp?.vat_account_from ?? 2610, vatTo = asmp?.vat_account_to ?? 2659;
  const paFrom = asmp?.payroll_account_from ?? 2710, paTo = asmp?.payroll_account_to ?? 2739;

  // 3. Bulk read: ONE SIE export for the financial year, STREAM-parsed line by
  //    line so memory stays constant no matter how many vouchers (500 → millions).
  const fyRes = await fortnoxGet(`/financialyears`, accessToken);
  const fys = fyRes?.FinancialYears ?? [];
  const fy = fys.find((f: any) => String(f.FromDate ?? "").startsWith(String(FY_BASE_YEAR))) ?? fys[fys.length - 1];
  const fyId = fy?.Id;

  // Anchor month 1 to the fiscal year's REAL start, so broken fiscal years
  // (e.g. May–Apr) land in the right months instead of assuming Jan–Dec.
  const fyStart = String(fy?.FromDate ?? `${FY_BASE_YEAR}-01-01`);
  const startYear = Number(fyStart.slice(0, 4)) || FY_BASE_YEAR;
  const startMonth = Number(fyStart.slice(5, 7)) || 1;

  const sieRes = await fetch(`${API_BASE}/sie/4${fyId ? `?financialyear=${fyId}` : ""}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "*/*" },
  });
  if (!sieRes.ok || !sieRes.body) throw new Error(`SIE ${sieRes.status}: ${await sieRes.text()}`);

  const totals = new Map<string, number>();
  const unmapped = new Set<string>();
  let voucherCount = 0, rowCount = 0;
  let revRaw = 0, cogs = 0, opex = 0, personnel = 0;   // raw P&L by BAS class
  let capturedCost = 0, unassignedCost = 0;
  let curMonth: number | null = null;
  const objektNames = new Map<string, string>();    // SIE dim-1 cost-centre code → name
  const projektNames = new Map<string, string>();   // SIE dim-6 project code → name
  const codeCost = new Map<string, number>();       // cost-centre code → total operating cost
  const projCost = new Map<string, number>();       // project code → total operating cost
  const uaMonths = new Map<number, number>();       // month → unassigned operating cost
  const kontoNames = new Map<number, string>();     // SIE #KONTO — account number → name
  const detail = new Map<string, { amt: number; n: number }>(); // `${ccKey}|${month}|${acct}` (ccKey = ccId or "UA")
  let bankBalance = 0; // sum of #UB (closing balance) for bank accounts (BAS 1900–1999), current year (index 0)
  let vatOpening = 0, paOpening = 0;               // #IB (opening balance), current year, summed over the configured range
  const vatMonthly = new Map<number, number>();    // month → net #TRANS movement within the VAT range
  const paMonthly = new Map<number, number>();     // month → net #TRANS movement within the payroll-tax range

  const processLine = (raw: string) => {
    const line = raw.trimStart();
    if (line.startsWith("#UB")) {       // #UB <yearindex> <account> <amount> — closing balance
      const u = line.match(/^#UB\s+(-?\d+)\s+(\d+)\s+(-?\d+(?:\.\d+)?)/);
      if (u && u[1] === "0") {
        const acct = Number(u[2]);
        if (acct >= 1900 && acct < 2000) bankBalance += Number(u[3]);
      }
      return;
    }
    if (line.startsWith("#IB")) {       // #IB <yearindex> <account> <amount> — opening balance
      const i = line.match(/^#IB\s+(-?\d+)\s+(\d+)\s+(-?\d+(?:\.\d+)?)/);
      if (i && i[1] === "0") {
        const acct = Number(i[2]);
        if (acct >= vatFrom && acct <= vatTo) vatOpening += Number(i[3]);
        else if (acct >= paFrom && acct <= paTo) paOpening += Number(i[3]);
      }
      return;
    }
    if (line.startsWith("#VER")) {
      voucherCount++;
      const vm = line.match(/#VER\s+"?([^"\s]+)"?\s+\S+\s+(\d{8})/);
      if (vm) {
        const series = vm[1].toUpperCase();
        if (excludedSeries.has(series)) { curMonth = null; return; } // whole voucher is noise — ignore every row in it
        const ymd = vm[2];
        const idx = (Number(ymd.slice(0, 4)) - startYear) * 12 + (Number(ymd.slice(4, 6)) - startMonth) + 1;
        curMonth = idx >= 1 && idx <= 24 ? idx : null;   // month relative to FY start
      } else curMonth = null;
      return;
    }
    if (line.startsWith("#OBJEKT")) {   // dim 1 = kostnadsställe, dim 6 = projekt (both SIE4-reserved)
      const o = line.match(/#OBJEKT\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/);
      if (o && o[1] === "1") objektNames.set(o[2], o[3]);
      else if (o && o[1] === "6") projektNames.set(o[2], o[3]);
      return;
    }
    if (line.startsWith("#KONTO")) {    // account definitions → names for the drill-down
      const k = line.match(/^#KONTO\s+(\d+)\s+"([^"]*)"/);
      if (k) kontoNames.set(Number(k[1]), k[2]);
      return;
    }
    if (!line.startsWith("#TRANS") || curMonth === null) return;
    const t = line.match(/^#TRANS\s+(\d+)\s+\{([^}]*)\}\s+(-?\d+(?:\.\d+)?)/);
    if (!t) return;
    const acct = Number(t[1]);
    const amount = Number(t[3]);
    if (!amount) return;
    if (excludedAccounts.has(acct)) return; // noise (e.g. opening-balance postings) — fully ignored

    // VAT/payroll-tax balance-sheet tracking (Phase 5 v2) — independent of the
    // cost-centre capture below (these are 2xxx accounts, never dimension-tagged).
    if (acct >= vatFrom && acct <= vatTo) vatMonthly.set(curMonth, (vatMonthly.get(curMonth) ?? 0) + amount);
    else if (acct >= paFrom && acct <= paTo) paMonthly.set(curMonth, (paMonthly.get(curMonth) ?? 0) + amount);

    rowCount++;
    const cls = Math.floor(acct / 1000);

    // Reconciliation: full P&L from every row.
    if (cls === 3) revRaw += amount;              // revenue (credit-normal → negative)
    else if (cls === 4) cogs += amount;           // COGS
    else if (cls === 5 || cls === 6) opex += amount;
    else if (cls === 7) personnel += amount;

    // Cost capture into reporting lines: operating costs (BAS 4–7) only.
    // Precedence: PROJECT tag (more specific) → cost-centre tag → account-range
    // fallback → Unassigned bucket.
    if (!(acct >= 4000 && acct < 8000)) return;
    const pairs = [...t[2].matchAll(/(\d+)\s+"([^"]*)"/g)];
    const ccPair = pairs.find((p) => p[1] === "1");   // SIE dimension 1 = kostnadsställe
    const projPair = pairs.find((p) => p[1] === "6"); // SIE dimension 6 = projekt
    const code = ccPair ? ccPair[2].trim() : "";
    const projCode = projPair ? projPair[2].trim() : "";
    if (code) codeCost.set(code, (codeCost.get(code) ?? 0) + amount);
    if (projCode) projCost.set(projCode, (projCost.get(projCode) ?? 0) + amount);

    let ccId = projCode ? projCodeToCc.get(projCode) : undefined;
    if (!ccId) ccId = code ? costCodeToCc.get(code) : undefined;
    if (!ccId) {
      const r = acctRanges.find((r) => acct >= r.from && acct <= r.to);
      if (r) ccId = r.ccId;
    }
    if (!ccId) {
      if (projCode) unmapped.add(projCode);
      else if (code) unmapped.add(code);
      unassignedCost += amount;   // never silently drop — lands in the Unassigned line
      uaMonths.set(curMonth, (uaMonths.get(curMonth) ?? 0) + amount);
      const dk = `UA|${curMonth}|${acct}`;
      const d = detail.get(dk) ?? { amt: 0, n: 0 };
      d.amt += amount; d.n++;
      detail.set(dk, d);
      return;
    }
    capturedCost += amount;
    const key = `${ccId}|${curMonth}`;
    totals.set(key, (totals.get(key) ?? 0) + amount);
    const dk = `${ccId}|${curMonth}|${acct}`;
    const d = detail.get(dk) ?? { amt: 0, n: 0 };
    d.amt += amount; d.n++;
    detail.set(dk, d);
  };

  const reader = sieRes.body.pipeThrough(new TextDecoderStream("latin1")).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";       // keep the trailing partial line
    for (const l of lines) processLine(l);
  }
  if (buf) processLine(buf);

  // 4. Replace actuals wholesale (not upsert): each sync is a full re-export of
  //    the current truth, so vouchers deleted/reversed in Fortnox can't leave
  //    stale rows behind. Fortnox is the source of truth for a connected org.
  const rows = [...totals.entries()].map(([key, amount]) => {
    const [reporting_line_id, month] = key.split("|");
    return { org_id, reporting_line_id, month: Number(month), amount: Math.round(amount) };
  });

  // Unassigned bucket → a real reporting line, so unplaced money is VISIBLE in
  // the grid (never silently dropped). Auto-created when needed, auto-removed
  // when everything is assigned again.
  const UA_NAME = "Unassigned (Fortnox)";
  const { data: uaLine } = await admin.from("reporting_lines")
    .select("id").eq("org_id", org_id).eq("name", UA_NAME).maybeSingle();
  let uaId = uaLine?.id ?? null;
  if (uaMonths.size > 0) {
    if (!uaId) {
      const { data: created, error: uaErr } = await admin.from("reporting_lines")
        .insert({ org_id, name: UA_NAME, annual_budget: 0, other_monthly: 0, source: "fortnox" })
        .select().single();
      if (uaErr) throw new Error(`unassigned line: ${uaErr.message}`);
      uaId = created.id;
    }
    for (const [m, amt] of uaMonths) rows.push({ org_id, reporting_line_id: uaId, month: m, amount: Math.round(amt) });
  } else if (uaId) {
    await admin.from("reporting_lines").delete().eq("id", uaId);
  }

  await admin.from("monthly_actual").delete().eq("org_id", org_id);
  if (rows.length) await admin.from("monthly_actual").insert(rows);

  // Drill-down detail: per (line × month × account), replaced wholesale like
  // the actuals. Bounded size (lines × months × accounts), inserted in chunks.
  const detailRows: Record<string, unknown>[] = [];
  for (const [dk, d] of detail) {
    const [ccKey, m, acct] = dk.split("|");
    const reporting_line_id = ccKey === "UA" ? uaId : ccKey;
    if (!reporting_line_id) continue;
    detailRows.push({
      org_id, reporting_line_id, month: Number(m), account: Number(acct),
      account_name: kontoNames.get(Number(acct)) ?? null,
      amount: Math.round(d.amt), tx_count: d.n,
    });
  }
  await admin.from("actual_detail").delete().eq("org_id", org_id);
  for (let i = 0; i < detailRows.length; i += 2000) {
    await admin.from("actual_detail").insert(detailRows.slice(i, i + 2000));
  }

  // 5. Advance the actuals boundary (Fathom convention: only ever to the last
  //    FULLY-ELAPSED month — a partially-booked current month must never read
  //    as closed, or variance shows fake savings) + persist the FY anchor.
  //    A manual user choice (close_month_manual) always wins; sync won't touch it.
  const maxMonth = rows.reduce((m, r) => Math.max(m, r.month), 0);
  const now = new Date();
  const nowIdx = (now.getUTCFullYear() - startYear) * 12 + (now.getUTCMonth() + 1 - startMonth) + 1;
  const lastElapsed = Math.max(0, Math.min(24, nowIdx - 1)); // current month never counts
  const autoClose = Math.min(maxMonth, lastElapsed);

  const { data: org } = await admin.from("organizations").select("close_month_manual, close_month").eq("id", org_id).single();
  const orgPatch: Record<string, unknown> = { fy_start_month: startMonth, fy_start_year: startYear };
  if (!org?.close_month_manual) orgPatch.close_month = autoClose;
  await admin.from("organizations").update(orgPatch).eq("id", org_id);
  const closeMonthOut = org?.close_month_manual ? org.close_month : autoClose;

  // 5B. Cash flow (Phase 5 v1): current bank balance (already have it — summed
  // from the SIE's #UB lines above, no extra call) + open invoices (2 REST
  // calls; typically a small list, unlike vouchers, so plain pagination is
  // fine). Best-effort — a cash-flow hiccup should never fail the P&L sync.
  let openInvoiceCount = 0;
  try {
    await admin.from("cash_position").upsert({ org_id, bank_balance: Math.round(bankBalance), as_of: new Date().toISOString() });

    const invoiceRows: Record<string, unknown>[] = [];
    for (const [kind, path, listKey, dueField, balField, nameField] of [
      ["customer", "/invoices", "Invoices", "DueDate", "Balance", "CustomerName"],
      ["supplier", "/supplierinvoices", "SupplierInvoices", "DueDate", "Balance", "SupplierName"],
    ] as const) {
      let page = 1;
      for (;;) {
        const list = await fortnoxGet(`${path}?filter=unpaid&page=${page}&limit=500`, accessToken); // VERIFY filter/param names
        const items = list?.[listKey] ?? [];
        if (items.length === 0) break;
        for (const inv of items) {
          const bal = Number(inv[balField] ?? inv.Total ?? 0);
          const due = inv[dueField];
          if (!bal || !due) continue;
          invoiceRows.push({ org_id, kind, amount: Math.round(Math.abs(bal)), due_date: due, description: inv.DocumentNumber ? `#${inv.DocumentNumber}` : null, counterparty: inv[nameField] ?? null });
        }
        const totalPages = list?.MetaInformation?.["@TotalPages"] ?? 1;
        if (page >= totalPages) break;
        page++;
      }
    }
    openInvoiceCount = invoiceRows.length;
    await admin.from("open_invoices").delete().eq("org_id", org_id);
    if (invoiceRows.length) await admin.from("open_invoices").insert(invoiceRows);
  } catch (e) { console.error("cash-flow step (non-fatal):", e); }

  // 5C. VAT/payroll-tax timing (Phase 5 v2): closing balance = opening balance
  // + cumulative #TRANS movement through each month, for the configured
  // account ranges. That closing balance IS the amount due on Skatteverket's
  // deadline the following month/quarter (client computes the exact date).
  // An estimate from account balances, not a hard Fortnox figure — best-effort.
  try {
    const taxRows: Record<string, unknown>[] = [];
    let vatRunning = vatOpening, paRunning = paOpening;
    const lastMonth = Math.max(0, ...[...vatMonthly.keys(), ...paMonthly.keys()]);
    for (let m = 1; m <= lastMonth; m++) {
      vatRunning += vatMonthly.get(m) ?? 0;
      paRunning += paMonthly.get(m) ?? 0;
      taxRows.push({ org_id, kind: "vat", month: m, balance: Math.round(vatRunning) });
      taxRows.push({ org_id, kind: "payroll", month: m, balance: Math.round(paRunning) });
    }
    await admin.from("tax_liability_monthly").delete().eq("org_id", org_id);
    if (taxRows.length) await admin.from("tax_liability_monthly").insert(taxRows);
  } catch (e) { console.error("VAT/payroll-tax step (non-fatal):", e); }

  // Master-data load: fetch Fortnox's FULL cost-centre + project lists (not
  // just codes seen in the ledger), so one created but never yet booked to —
  // the plan-ahead scenario — still shows up to link-or-create against.
  // Best-effort; the SIE-derived lists alone are still enough if these fail.
  try {
    const cc = await fortnoxGet(`/costcenters`, accessToken);
    for (const c of cc?.CostCenters ?? []) {
      const code = String(c.Code ?? c.code ?? "").trim();
      if (code && !objektNames.has(code)) objektNames.set(code, c.Description ?? c.Name ?? code);
    }
  } catch (_) { /* non-fatal — SIE-derived list still works */ }
  try {
    const pr = await fortnoxGet(`/projects`, accessToken);
    for (const p of pr?.Projects ?? []) {
      const code = String(p.ProjectNumber ?? p.Code ?? p.code ?? "").trim();
      if (code && !projektNames.has(code)) projektNames.set(code, p.Description ?? p.Name ?? code);
    }
  } catch (_) { /* non-fatal — SIE-derived list still works */ }

  // Reporting-line / project lists (master data + any codes seen in transactions),
  // with operating cost and mapped status — power the one-click mapping UI.
  const seenCodes = new Set<string>([...objektNames.keys(), ...codeCost.keys()]);
  const reporting_lines = [...seenCodes].map((code) => ({
    code,
    name: objektNames.get(code) ?? code,
    cost: Math.round(codeCost.get(code) ?? 0),
    mapped: costCodeToCc.has(code),
  })).sort((a, b) => b.cost - a.cost);

  const seenProjCodes = new Set<string>([...projektNames.keys(), ...projCost.keys()]);
  const projects = [...seenProjCodes].map((code) => ({
    code,
    name: projektNames.get(code) ?? code,
    cost: Math.round(projCost.get(code) ?? 0),
    mapped: projCodeToCc.has(code),
  })).sort((a, b) => b.cost - a.cost);

  // Prior fiscal year (if the company has one) → "vs last year" baseline.
  let priorYear: Record<string, number> | null = null;
  const prior = fys
    .filter((f: any) => String(f.ToDate ?? "") < String(fy?.FromDate ?? ""))
    .sort((a: any, b: any) => String(b.ToDate).localeCompare(String(a.ToDate)))[0];
  if (prior?.Id) {
    try { priorYear = await fetchPnlTotals(accessToken, prior.Id); }
    catch (_) { /* baseline is best-effort — never fail the sync over it */ }
  }

  const revenue = -revRaw;
  const totalCost = cogs + opex + personnel;
  const recon = {
    revenue: Math.round(revenue),
    cogs: Math.round(cogs),
    opex: Math.round(opex),
    personnel: Math.round(personnel),
    total_cost: Math.round(totalCost),
    result: Math.round(revenue - totalCost),
    captured_cost: Math.round(capturedCost),
    unmapped_cost: Math.round(unassignedCost),
    coverage_pct: capturedCost + unassignedCost > 0
      ? Math.round((capturedCost / (capturedCost + unassignedCost)) * 100)
      : 100,
    vouchers: voucherCount,
    rows: rowCount,
    prior_year: priorYear,   // null when the company has no previous FY
  };

  // Persist the P&L + reporting-line/project lists on the status row so the app
  // shows them on load, not just immediately after a sync.
  await admin.from("integration_status").update({
    last_synced_at: new Date().toISOString(), last_sync_error: null, last_reconciliation: recon,
    last_reporting_lines: reporting_lines, last_projects: projects,
  }).eq("org_id", org_id);

  return {
    ok: true,
    months_updated: rows.length,
    close_month: closeMonthOut,
    unmapped_reporting_lines: [...unmapped],
    reporting_lines,
    projects,
    reconciliation: recon,
    bank_balance: Math.round(bankBalance),
    open_invoice_count: openInvoiceCount,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  // Cron path: nightly job syncs EVERY connected org. Authorized by shared secret.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-key") === cronSecret) {
    const { data: integs } = await admin.from("integrations").select("org_id");
    const results: Record<string, string> = {};
    for (const i of integs ?? []) {
      try {
        const r = await syncOrg(admin, i.org_id);
        results[i.org_id] = `ok — ${r.months_updated} months`;
      } catch (e) {
        results[i.org_id] = `error: ${e}`;
        await admin.from("integration_status").update({ last_sync_error: String(e) }).eq("org_id", i.org_id);
      }
    }
    return json({ ok: true, cron: true, results });
  }

  // User path: one org, authorized in-code via can_edit_org (caller's JWT).
  const org_id = body?.org_id;
  if (!org_id) return json({ error: "org_id required" }, 400);
  const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: canEdit } = await asUser.rpc("can_edit_org", { p_org: org_id });
  if (!canEdit) return json({ error: "not authorized" }, 403);

  try {
    return json(await syncOrg(admin, org_id));
  } catch (e) {
    console.error("fortnox-sync error:", e);
    await admin.from("integration_status").update({ last_sync_error: String(e) }).eq("org_id", org_id);
    return json({ error: String(e) }, 500);
  }
});
