// Edge Function: org-members  (self-contained)
//
// Membership management: list / invite / set_role / remove. All membership
// writes go through here (service role) — never a direct client INSERT/
// UPDATE/DELETE on `memberships`. Same reasoning as create_organization():
// a client with a direct write path could add itself to any org it knows
// the id of, or demote/remove someone else's owner. This function re-checks
// authorization against the CALLER'S OWN JWT on every call (is_org_member
// for read, is_org_owner for every write) — it never trusts a client-
// supplied role or org_id claim.
//
// "list" is available to any member (transparency: see who has access).
// invite/set_role/remove are owner-only (administrative, not a data edit —
// stricter than can_edit_org, which also allows editors).
//
// Note: invite emails go through Supabase's own built-in Auth email system
// (not Resend — that's reserved for the digest), which has a low default
// rate limit on the free tier. Fine at today's scale; if real client
// onboarding ever needs volume, configure custom SMTP in Supabase Auth
// settings (can reuse Resend there too).
//
// Enforce JWT stays OFF — auth is done in-code via the caller's own token,
// same pattern as fortnox-sync's user path. Secrets: none beyond the
// platform-provided SUPABASE_URL/SERVICE_ROLE_KEY/ANON_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://gavuzzi.github.io/finance-budget-forecast/app.html";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const body = await req.json().catch(() => ({}));
  const { action, org_id } = body;
  if (!org_id || !action) return json({ error: "org_id and action required" }, 400);

  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "not authenticated" }, 401);

  if (action === "list") {
    const { data: isMember } = await asUser.rpc("is_org_member", { p_org: org_id });
    if (!isMember) return json({ error: "not authorized" }, 403);

    const { data: members, error } = await admin.from("memberships")
      .select("user_id, role, created_at").eq("org_id", org_id).order("created_at");
    if (error) return json({ error: error.message }, 500);

    const out = [];
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      out.push({ user_id: m.user_id, role: m.role, email: u?.user?.email ?? "(unknown)", is_you: m.user_id === user.id });
    }
    return json({ ok: true, members: out });
  }

  // Every action below is an owner-only administrative action.
  const { data: isOwner } = await asUser.rpc("is_org_owner", { p_org: org_id });
  if (!isOwner) return json({ error: "Only an owner can manage members." }, 403);

  if (action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role === "viewer" ? "viewer" : "editor"; // never invite straight to owner
    if (!email) return json({ error: "Email required." }, 400);

    const { data: orgRow } = await admin.from("organizations").select("name").eq("id", org_id).single();
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: APP_URL,
      data: { invited_org: orgRow?.name ?? "" },
    });

    let targetUserId: string | null = invited?.user?.id ?? null;
    let mode = "invited";

    if (inviteErr) {
      // Already-registered users can't be re-invited via this path — look
      // them up and add the membership directly instead of failing.
      if (/already been registered|already exists|already registered/i.test(inviteErr.message)) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (listErr) return json({ error: listErr.message }, 500);
        const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
        if (!existing) return json({ error: "That email has an account but couldn't be looked up." }, 500);
        targetUserId = existing.id;
        mode = "added";
      } else {
        return json({ error: inviteErr.message }, 500);
      }
    }

    const { error: memErr } = await admin.from("memberships")
      .upsert({ user_id: targetUserId, org_id, role }, { onConflict: "user_id,org_id" });
    if (memErr) return json({ error: memErr.message }, 500);

    return json({ ok: true, mode, email });
  }

  if (action === "set_role") {
    const targetUserId = body.user_id;
    const role = body.role;
    if (!targetUserId || !["owner", "editor", "viewer"].includes(role)) return json({ error: "Invalid role." }, 400);
    if (targetUserId === user.id && role !== "owner") {
      const { count } = await admin.from("memberships")
        .select("*", { count: "exact", head: true }).eq("org_id", org_id).eq("role", "owner");
      if ((count ?? 0) <= 1) return json({ error: "You're the only owner — promote someone else first." }, 400);
    }
    const { error } = await admin.from("memberships").update({ role }).eq("org_id", org_id).eq("user_id", targetUserId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "remove") {
    const targetUserId = body.user_id;
    if (!targetUserId) return json({ error: "user_id required" }, 400);
    const { data: target } = await admin.from("memberships")
      .select("role").eq("org_id", org_id).eq("user_id", targetUserId).maybeSingle();
    if (target?.role === "owner") {
      const { count } = await admin.from("memberships")
        .select("*", { count: "exact", head: true }).eq("org_id", org_id).eq("role", "owner");
      if ((count ?? 0) <= 1) return json({ error: "Can't remove the only owner." }, 400);
    }
    const { error } = await admin.from("memberships").delete().eq("org_id", org_id).eq("user_id", targetUserId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
