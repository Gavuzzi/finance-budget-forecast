// Edge Function: fortnox-sync  (self-contained — paste this whole file into the
// Supabase Dashboard: Edge Functions → create a function named EXACTLY
// "fortnox-sync" → paste → Deploy. Leave "Enforce JWT" ON (the app calls it with
// the signed-in user's token).
//
// Secrets: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET (for token refresh).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
//
// Pulls booked vouchers, keeps operating-expense rows (BAS accounts 5000–7999),
// groups by (cost centre × month), maps each Fortnox cost-centre code to one of
// our cost centers, and upserts into monthly_actual. Month 1 = Jan 2026.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";
const FY_BASE_YEAR = 2026;   // app month 1 = Jan of this year
const MAX_VOUCHERS = 2000;   // safety cap

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

// "2026-03-15" → absolute app month index (1..24), or null if outside the window.
function monthIndex(dateStr: string): number | null {
  const d = new Date(dateStr);
  const idx = (d.getUTCFullYear() - FY_BASE_YEAR) * 12 + (d.getUTCMonth() + 1);
  return idx >= 1 && idx <= 24 ? idx : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  const { org_id } = await req.json().catch(() => ({}));
  if (!org_id) return json({ error: "org_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // Caller-scoped client: can_edit_org verifies this user may sync this org.
  const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: canEdit } = await asUser.rpc("can_edit_org", { p_org: org_id });
  if (!canEdit) return json({ error: "not authorized" }, 403);

  // Service-role client: reads tokens + writes actuals (bypasses RLS).
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

    // 3. Page through vouchers → aggregate expense rows by (cost centre × month).
    const totals = new Map<string, number>();
    const unmapped = new Set<string>();
    let page = 1, fetched = 0;

    while (fetched < MAX_VOUCHERS) {
      const list = await fortnoxGet(`/vouchers?page=${page}&limit=500`, accessToken); // VERIFY params
      const vouchers = list?.Vouchers ?? [];
      if (vouchers.length === 0) break;

      for (const v of vouchers) {
        fetched++;
        const detail = await fortnoxGet(
          `/vouchers/${v.VoucherSeries}/${v.VoucherNumber}?financialyear=${v.Year ?? ""}`, accessToken); // VERIFY
        const rows = detail?.Voucher?.VoucherRows ?? [];
        const date = detail?.Voucher?.TransactionDate ?? v.TransactionDate;
        const month = date ? monthIndex(date) : null;
        if (!month) continue;

        for (const r of rows) {
          const acct = Number(r.Account);
          if (!(acct >= 5000 && acct < 8000)) continue;      // operating + personnel costs
          const amount = (Number(r.Debit) || 0) - (Number(r.Credit) || 0);
          if (!amount) continue;
          const code = String(r.CostCenter ?? "").trim();
          if (!code) continue;                                // untagged → can't place it
          const ccId = codeToCc.get(code);
          if (!ccId) { unmapped.add(code); continue; }
          const key = `${ccId}|${month}`;
          totals.set(key, (totals.get(key) ?? 0) + amount);
        }
      }
      const totalPages = list?.MetaInformation?.["@TotalPages"] ?? 1;
      if (page >= totalPages) break;
      page++;
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

    return json({ ok: true, months_updated: rows.length, close_month: maxMonth, unmapped_cost_centers: [...unmapped] });
  } catch (e) {
    console.error("fortnox-sync error:", e);
    await admin.from("integration_status").update({ last_sync_error: String(e) }).eq("org_id", org_id);
    return json({ error: String(e) }, 500);
  }
});
