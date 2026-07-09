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

  // 2. Mapping rules. Precedence per cost row: cost-centre tag → account-range
  //    fallback → Unassigned. Account ranges make untagged companies syncable.
  const { data: maps } = await admin.from("cost_center_mappings")
    .select("external_code, cost_center_id, dimension, account_from, account_to").eq("org_id", org_id);
  const codeToCc = new Map<string, string>();
  const acctRanges: { from: number; to: number; ccId: string }[] = [];
  (maps ?? []).forEach((m: any) => {
    if (!m.cost_center_id) return;
    if (m.dimension === "account" && m.account_from != null && m.account_to != null) {
      acctRanges.push({ from: m.account_from, to: m.account_to, ccId: m.cost_center_id });
    } else if (m.dimension !== "account") {
      codeToCc.set(m.external_code, m.cost_center_id);
    }
  });

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
  const objektNames = new Map<string, string>();   // SIE dim-1 cost-centre code → name
  const codeCost = new Map<string, number>();       // cost-centre code → total operating cost
  const uaMonths = new Map<number, number>();       // month → unassigned operating cost
  const kontoNames = new Map<number, string>();     // SIE #KONTO — account number → name
  const detail = new Map<string, { amt: number; n: number }>(); // `${ccKey}|${month}|${acct}` (ccKey = ccId or "UA")

  const processLine = (raw: string) => {
    const line = raw.trimStart();
    if (line.startsWith("#VER")) {
      voucherCount++;
      const m = line.match(/#VER\s+\S+\s+\S+\s+(\d{8})/);
      if (m) {
        const ymd = m[1];
        const idx = (Number(ymd.slice(0, 4)) - startYear) * 12 + (Number(ymd.slice(4, 6)) - startMonth) + 1;
        curMonth = idx >= 1 && idx <= 24 ? idx : null;   // month relative to FY start
      } else curMonth = null;
      return;
    }
    if (line.startsWith("#OBJEKT")) {   // cost-centre / project definitions (dim 1 = kostnadsställe)
      const o = line.match(/#OBJEKT\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/);
      if (o && o[1] === "1") objektNames.set(o[2], o[3]);
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
    rowCount++;
    const cls = Math.floor(acct / 1000);

    // Reconciliation: full P&L from every row.
    if (cls === 3) revRaw += amount;              // revenue (credit-normal → negative)
    else if (cls === 4) cogs += amount;           // COGS
    else if (cls === 5 || cls === 6) opex += amount;
    else if (cls === 7) personnel += amount;

    // Cost capture into reporting lines: operating costs (BAS 4–7) only.
    // Precedence: cost-centre tag → account-range fallback → Unassigned bucket.
    if (!(acct >= 4000 && acct < 8000)) return;
    const pairs = [...t[2].matchAll(/(\d+)\s+"([^"]*)"/g)];
    const ccPair = pairs.find((p) => p[1] === "1"); // SIE dimension 1 = kostnadsställe
    const code = ccPair ? ccPair[2].trim() : "";
    if (code) codeCost.set(code, (codeCost.get(code) ?? 0) + amount);

    let ccId = code ? codeToCc.get(code) : undefined;
    if (!ccId) {
      const r = acctRanges.find((r) => acct >= r.from && acct <= r.to);
      if (r) ccId = r.ccId;
    }
    if (!ccId) {
      if (code) unmapped.add(code);
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
    const [cost_center_id, month] = key.split("|");
    return { org_id, cost_center_id, month: Number(month), amount: Math.round(amount) };
  });

  // Unassigned bucket → a real reporting line, so unplaced money is VISIBLE in
  // the grid (never silently dropped). Auto-created when needed, auto-removed
  // when everything is assigned again.
  const UA_NAME = "Unassigned (Fortnox)";
  const { data: uaLine } = await admin.from("cost_centers")
    .select("id").eq("org_id", org_id).eq("name", UA_NAME).maybeSingle();
  let uaId = uaLine?.id ?? null;
  if (uaMonths.size > 0) {
    if (!uaId) {
      const { data: created, error: uaErr } = await admin.from("cost_centers")
        .insert({ org_id, name: UA_NAME, annual_budget: 0, other_monthly: 0, source: "fortnox" })
        .select().single();
      if (uaErr) throw new Error(`unassigned line: ${uaErr.message}`);
      uaId = created.id;
    }
    for (const [m, amt] of uaMonths) rows.push({ org_id, cost_center_id: uaId, month: m, amount: Math.round(amt) });
  } else if (uaId) {
    await admin.from("cost_centers").delete().eq("id", uaId);
  }

  await admin.from("monthly_actual").delete().eq("org_id", org_id);
  if (rows.length) await admin.from("monthly_actual").insert(rows);

  // Drill-down detail: per (line × month × account), replaced wholesale like
  // the actuals. Bounded size (lines × months × accounts), inserted in chunks.
  const detailRows: Record<string, unknown>[] = [];
  for (const [dk, d] of detail) {
    const [ccKey, m, acct] = dk.split("|");
    const cost_center_id = ccKey === "UA" ? uaId : ccKey;
    if (!cost_center_id) continue;
    detailRows.push({
      org_id, cost_center_id, month: Number(m), account: Number(acct),
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

  // Cost-centre list (from SIE #OBJEKT defs + any codes seen in transactions),
  // with operating cost and mapped status — powers the one-click mapping UI.
  const seenCodes = new Set<string>([...objektNames.keys(), ...codeCost.keys()]);
  const cost_centers = [...seenCodes].map((code) => ({
    code,
    name: objektNames.get(code) ?? code,
    cost: Math.round(codeCost.get(code) ?? 0),
    mapped: codeToCc.has(code),
  })).sort((a, b) => b.cost - a.cost);

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
  };

  // Persist the P&L on the status row so the app shows it on load, not just after a sync.
  await admin.from("integration_status").update({
    last_synced_at: new Date().toISOString(), last_sync_error: null, last_reconciliation: recon,
  }).eq("org_id", org_id);

  return {
    ok: true,
    months_updated: rows.length,
    close_month: closeMonthOut,
    unmapped_cost_centers: [...unmapped],
    cost_centers,
    reconciliation: recon,
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
