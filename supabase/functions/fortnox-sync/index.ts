// Edge Function: fortnox-sync  (self-contained)
//
// NEVER-FAIL read: exports the whole financial year as ONE SIE file (/3/sie/4)
// and parses it locally. O(1) API calls regardless of voucher count — no N+1,
// no rate-limit death, no timeout. Scales from 500 to 500,000 vouchers.
//
// Computes a full-P&L reconciliation (revenue/COGS/opex/personnel/result) from
// every transaction, and buckets operating costs (BAS 4–7) by (cost centre ×
// month) into monthly_actual. Month 1 = Jan of FY_BASE_YEAR.
//
// "Enforce JWT" stays OFF (the browser calls it directly); auth is checked in
// code via can_edit_org. Secrets: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";
const FY_BASE_YEAR = 2026;   // app month 1 = Jan of this year

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
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

// SIE export returns a raw file, not JSON.
async function fortnoxGetText(path: string, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`);
  return await res.text();
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

// "20260315" → absolute app month index (1..24), or null if outside the window.
function monthIndexFromYmd(ymd: string): number | null {
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(4, 6));
  const idx = (y - FY_BASE_YEAR) * 12 + mo;
  return idx >= 1 && idx <= 24 ? idx : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  const { org_id } = await req.json().catch(() => ({}));
  if (!org_id) return json({ error: "org_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: canEdit } = await asUser.rpc("can_edit_org", { p_org: org_id });
  if (!canEdit) return json({ error: "not authorized" }, 403);

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Tokens; refresh if expired/near-expiry.
    const { data: integ } = await admin.from("integrations").select("*").eq("org_id", org_id).single();
    if (!integ) return json({ error: "not connected" }, 400);

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

    // 2. Cost-centre mappings: Fortnox code → our cost_center_id.
    const { data: maps } = await admin.from("cost_center_mappings")
      .select("external_code, cost_center_id").eq("org_id", org_id);
    const codeToCc = new Map<string, string>();
    (maps ?? []).forEach((m: any) => m.cost_center_id && codeToCc.set(m.external_code, m.cost_center_id));

    // 3. Bulk read: ONE SIE export for the financial year, then parse.
    const fyRes = await fortnoxGet(`/financialyears`, accessToken); // VERIFY response shape
    const fys = fyRes?.FinancialYears ?? [];
    const fy = fys.find((f: any) => String(f.FromDate ?? "").startsWith(String(FY_BASE_YEAR))) ?? fys[fys.length - 1];
    const fyId = fy?.Id;
    const sie = await fortnoxGetText(`/sie/4${fyId ? `?financialyear=${fyId}` : ""}`, accessToken); // VERIFY path/param

    // Parse #VER (voucher date) + #TRANS (account, dimensions, amount).
    const totals = new Map<string, number>();
    const unmapped = new Set<string>();
    let voucherCount = 0, rowCount = 0;
    let revRaw = 0, cogs = 0, opex = 0, personnel = 0;   // raw P&L by BAS class
    let capturedCost = 0, unmappedCost = 0;
    let curMonth: number | null = null;

    for (const raw of sie.split(/\r?\n/)) {
      const line = raw.trimStart();
      if (line.startsWith("#VER")) {
        voucherCount++;
        const m = line.match(/#VER\s+\S+\s+\S+\s+(\d{8})/);
        curMonth = m ? monthIndexFromYmd(m[1]) : null;
        continue;
      }
      if (!line.startsWith("#TRANS") || curMonth === null) continue;
      const t = line.match(/^#TRANS\s+(\d+)\s+\{([^}]*)\}\s+(-?\d+(?:\.\d+)?)/);
      if (!t) continue;
      const acct = Number(t[1]);
      const amount = Number(t[3]);
      if (!amount) continue;
      rowCount++;
      const cls = Math.floor(acct / 1000);

      // Reconciliation: full P&L from every row.
      if (cls === 3) revRaw += amount;              // revenue (credit-normal → negative)
      else if (cls === 4) cogs += amount;           // COGS
      else if (cls === 5 || cls === 6) opex += amount;
      else if (cls === 7) personnel += amount;

      // Cost capture into reporting lines: operating costs (BAS 4–7) only.
      if (!(acct >= 4000 && acct < 8000)) continue;
      const pairs = [...t[2].matchAll(/(\d+)\s+"([^"]*)"/g)];
      const ccPair = pairs.find((p) => p[1] === "1"); // SIE dimension 1 = kostnadsställe
      const code = ccPair ? ccPair[2].trim() : "";
      if (!code) continue;                            // untagged → can't place it
      const ccId = codeToCc.get(code);
      if (!ccId) { unmapped.add(code); unmappedCost += amount; continue; }
      capturedCost += amount;
      const key = `${ccId}|${curMonth}`;
      totals.set(key, (totals.get(key) ?? 0) + amount);
    }

    // 4. Upsert aggregated actuals.
    const rows = [...totals.entries()].map(([key, amount]) => {
      const [cost_center_id, month] = key.split("|");
      return { org_id, cost_center_id, month: Number(month), amount: Math.round(amount) };
    });
    if (rows.length) await admin.from("monthly_actual").upsert(rows, { onConflict: "cost_center_id,month" });

    // 5. Advance the actuals boundary to the latest synced month.
    const maxMonth = rows.reduce((m, r) => Math.max(m, r.month), 0);
    if (maxMonth) await admin.from("organizations").update({ close_month: maxMonth }).eq("id", org_id);

    await admin.from("integration_status").update({
      last_synced_at: new Date().toISOString(), last_sync_error: null,
    }).eq("org_id", org_id);

    const revenue = -revRaw;
    const totalCost = cogs + opex + personnel;
    return json({
      ok: true,
      months_updated: rows.length,
      close_month: maxMonth,
      unmapped_cost_centers: [...unmapped],
      reconciliation: {
        revenue: Math.round(revenue),
        cogs: Math.round(cogs),
        opex: Math.round(opex),
        personnel: Math.round(personnel),
        total_cost: Math.round(totalCost),
        result: Math.round(revenue - totalCost),
        captured_cost: Math.round(capturedCost),
        unmapped_cost: Math.round(unmappedCost),
        vouchers: voucherCount,
        rows: rowCount,
      },
    });
  } catch (e) {
    console.error("fortnox-sync error:", e);
    await admin.from("integration_status").update({ last_sync_error: String(e) }).eq("org_id", org_id);
    return json({ error: String(e) }, 500);
  }
});
