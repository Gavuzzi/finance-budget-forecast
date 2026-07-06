// Edge Function: fortnox-oauth  (self-contained — paste this whole file into the
// Supabase Dashboard: Edge Functions → create a function named EXACTLY
// "fortnox-oauth" → paste → Deploy → Settings tab → turn OFF "Enforce JWT"
// (Fortnox redirects the browser here with no Supabase token).
//
// Secrets (Dashboard → Edge Functions → Secrets): FORTNOX_CLIENT_ID,
// FORTNOX_CLIENT_SECRET, APP_URL. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token"; // VERIFY host vs apidocs
const API_BASE = "https://api.fortnox.se/3";

async function fortnoxToken(params: Record<string, string>) {
  const id = Deno.env.get("FORTNOX_CLIENT_ID")!;
  const secret = Deno.env.get("FORTNOX_CLIENT_SECRET")!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const back = (s: string) => Response.redirect(`${appUrl}/app.html?fortnox=${s}`, 302);
  if (!code || !state) return back("error");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Consume the pending state → org_id (single-use CSRF binding).
    const { data: pending } = await admin.from("oauth_states").select("org_id").eq("state", state).single();
    if (!pending) return back("error");
    await admin.from("oauth_states").delete().eq("state", state);

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/fortnox-oauth`;
    const tok = await fortnoxToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

    // Best-effort: the connected company's name for display.
    let tenantName: string | null = null;
    try {
      const r = await fetch(`${API_BASE}/settings/company`, {
        headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" },
      });
      if (r.ok) { const info = await r.json(); tenantName = info?.CompanySettings?.Name ?? null; } // VERIFY path
    } catch (_) { /* non-fatal */ }

    const now = Date.now();
    await admin.from("integrations").upsert({
      org_id: pending.org_id,
      provider: "fortnox",
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      token_expires_at: new Date(now + tok.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + 45 * 864e5).toISOString(),
      tenant_name: tenantName,
      updated_at: new Date(now).toISOString(),
    });
    await admin.from("integration_status").upsert({
      org_id: pending.org_id,
      provider: "fortnox",
      connected: true,
      connected_at: new Date(now).toISOString(),
      last_sync_error: null,
    });

    return back("connected");
  } catch (e) {
    console.error("fortnox-oauth error:", e);
    return back("error");
  }
});
