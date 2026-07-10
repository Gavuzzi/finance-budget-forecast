// Edge Function: send-digest  (self-contained)
//
// Monthly email recap per org — the retention feature. A nightly sync that
// nobody looks at delivers zero value; this makes the app show up without
// anyone opening it.
//
// Deliberately reuses ALREADY-COMPUTED figures rather than re-implementing
// the driver forecast (headcount windows, recurring-cost escalation, the
// revenue plan) a second time in a second runtime:
//   • the P&L block is integration_status.last_reconciliation — the exact
//     numbers already synced and shown on Monthly's "Actuals from Fortnox"
//     panel. Zero risk of a divergent copy of that math.
//   • the "lines to watch" block is booked-actuals-so-far vs a simple
//     pro-rated budget (annual_budget × close_month/12) — real SQL
//     aggregation, not the client's full FY forecast. Labeled honestly as
//     such in the email copy so it never claims to be the Signals panel.
//
// Runs monthly via pg_cron (x-cron-key header === CRON_SECRET, same shared
// secret as fortnox-sync). Every org with a membership is considered;
// orgs with nothing to report (no reconciliation AND no budgeted reporting
// lines) are skipped — never spam an empty org.
//
// Secrets: RESEND_API_KEY, CRON_SECRET (already set for fortnox-sync).

import { createClient } from "npm:@supabase/supabase-js@2";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-cron-key" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Same FY-relative → calendar-label arithmetic as monthLabel() in data.js.
function monthLabel(m: number, fyStartMonth: number, fyStartYear: number) {
  const abs = fyStartMonth - 1 + (m - 1);
  const name = MONTH_NAMES[((abs % 12) + 12) % 12];
  const year = (fyStartYear % 100) + Math.floor(abs / 12);
  return `${name} ${String(year).padStart(2, "0")}`;
}

const fmtMkr = (n: number) => (n / 1_000_000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mkr";
const fmtSigned = (n: number) => (n >= 0 ? "+" : "−") + fmtMkr(Math.abs(n));

async function buildDigestHtml(admin: ReturnType<typeof createClient>, org: any) {
  const closeMonth = org.close_month || 0;
  const fyStartMonth = org.fy_start_month || 1;
  const fyStartYear = org.fy_start_year || 2026;

  const [{ data: status }, { data: cash }, { data: lines }, { data: actuals }] = await Promise.all([
    admin.from("integration_status").select("connected, last_reconciliation").eq("org_id", org.id).maybeSingle(),
    admin.from("cash_position").select("bank_balance, as_of").eq("org_id", org.id).maybeSingle(),
    admin.from("reporting_lines").select("id, name, annual_budget").eq("org_id", org.id),
    admin.from("monthly_actual").select("reporting_line_id, month, amount").eq("org_id", org.id).lte("month", closeMonth || 0),
  ]);

  const recon = status?.last_reconciliation ?? null;
  const hasLines = (lines ?? []).some((l: any) => Number(l.annual_budget) > 0);
  if (!recon && !hasLines) return null; // nothing to report — don't spam an empty org

  const bookedByLine = new Map<string, number>();
  for (const a of actuals ?? []) bookedByLine.set(a.reporting_line_id, (bookedByLine.get(a.reporting_line_id) ?? 0) + Number(a.amount));

  const watch = (lines ?? [])
    .map((l: any) => {
      const booked = bookedByLine.get(l.id) ?? 0;
      const proRated = (Number(l.annual_budget) || 0) * (closeMonth / 12);
      return { name: l.name, variance: booked - proRated };
    })
    .filter((l) => Math.abs(l.variance) > 10000) // ignore noise
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 3);

  const monthTxt = closeMonth ? monthLabel(closeMonth, fyStartMonth, fyStartYear) : "this period";

  let pnlHtml = "";
  if (recon) {
    const margin = recon.revenue ? Math.round((recon.result / recon.revenue) * 100) : 0;
    pnlHtml = `
      <tr><td style="padding:4px 0;color:#647189;">Revenue</td><td style="padding:4px 0;text-align:right;font-weight:600;">${fmtMkr(recon.revenue)}</td></tr>
      <tr><td style="padding:4px 0;color:#647189;">Total cost</td><td style="padding:4px 0;text-align:right;">${fmtMkr(recon.total_cost)}</td></tr>
      <tr><td style="padding:8px 0 4px;color:#161c2a;font-weight:700;border-top:1px solid #e4e9f0;">Result</td><td style="padding:8px 0 4px;text-align:right;font-weight:700;border-top:1px solid #e4e9f0;">${fmtMkr(recon.result)} <span style="font-weight:400;color:#647189;">(${margin}% margin)</span></td></tr>`;
  }

  const watchHtml = watch.length
    ? `<p style="margin:20px 0 8px;font-weight:700;color:#161c2a;">Lines to watch</p>
       <p style="margin:0 0 8px;color:#647189;font-size:13px;">Booked so far vs a simple pro-rated share of the annual budget — not the full-year forecast shown in the app.</p>` +
      watch.map((l) => `<div style="padding:3px 0;">${l.name}: <strong style="color:${l.variance > 0 ? "#c0524a" : "#2f9e6a"};">${fmtSigned(l.variance)}</strong> vs pro-rated budget</div>`).join("")
    : "";

  const cashHtml = cash
    ? `<p style="margin:20px 0 4px;color:#647189;">Bank balance: <strong style="color:#161c2a;">${fmtMkr(Number(cash.bank_balance))}</strong> as of ${new Date(cash.as_of).toLocaleDateString("sv-SE")}</p>`
    : "";

  return {
    subject: `${org.name} — ${monthTxt} recap`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#161c2a;">
        <h2 style="margin:0 0 4px;">${org.name}</h2>
        <p style="margin:0 0 20px;color:#647189;">${monthTxt} recap</p>
        ${recon ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${pnlHtml}</table>` : ""}
        ${cashHtml}
        ${watchHtml}
        <p style="margin:28px 0 0;font-size:12px;color:#98a2b3;">Sent automatically once a month. Open the app any time for the full forecast, runway, and drill-downs.</p>
      </div>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-key") !== cronSecret) return json({ error: "not authorized" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY not set" }, 500);

  const { data: orgs, error: orgErr } = await admin.from("organizations").select("id, name, close_month, fy_start_month, fy_start_year");
  if (orgErr) return json({ error: orgErr.message }, 500);

  const results: Record<string, string> = {};
  for (const org of orgs ?? []) {
    try {
      const digest = await buildDigestHtml(admin, org);
      if (!digest) { results[org.id] = "skipped — nothing to report"; continue; }

      const { data: members } = await admin.from("memberships").select("user_id").eq("org_id", org.id);
      const emails: string[] = [];
      for (const m of members ?? []) {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        if (u?.user?.email) emails.push(u.user.email);
      }
      if (emails.length === 0) { results[org.id] = "skipped — no member emails"; continue; }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "FP&A Planning <onboarding@resend.dev>", to: emails, subject: digest.subject, html: digest.html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      results[org.id] = `sent to ${emails.length}`;
    } catch (e) {
      results[org.id] = `error: ${e}`;
    }
  }
  return json({ ok: true, results });
});
