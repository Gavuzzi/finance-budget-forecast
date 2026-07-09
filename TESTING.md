# Security review (2026-07-09)

**Adversarial RLS audit — PASS, no findings.** Queried `pg_class.relrowsecurity` for every
table in the public schema (21 tables): all have RLS enabled, none forced-but-bypassable.
Queried `pg_policies` for every policy: every single one is scoped by `is_org_member(org_id)`
(read) or `can_edit_org(org_id)` (write) — no policy uses an unscoped `true` condition, and
no tenant table is missing a policy. `memberships`/`organizations` (the multi-tenant boundary
itself) allow no client INSERT — org creation only happens via the `create_organization()`
SECURITY DEFINER RPC, closing the "add myself to any org" hole by construction. `integrations`
(OAuth tokens) has RLS enabled with **zero** policies — Postgres defaults to deny-all, so no
client role (anon or authenticated) can read it under any circumstance; only the Edge Function's
service_role key (which bypasses RLS entirely) touches it. Confirmed the isolation is server-side,
not client-trust-based: `is_org_member()`/`can_edit_org()` check the real `auth.uid()` against
the `memberships` table — a user editing `CURRENT_ORG_ID` in devtools to another org's UUID gets
blocked at the database, not just hidden in the UI. Not tested: an actual live cross-org query
attempt with two real user sessions (would need a second real login) — the policy-text audit is
airtight, but a hands-on confirmation is a cheap thing to do once you have two test accounts.

**XSS pass — fixed.** Every `innerHTML` template that interpolated a user-typed or
Fortnox-sourced string (reporting-line names, notes, role labels, scenario/budget-version
names, org names, invoice counterparty/description, synced account names, CSV-import
unmatched names, sync-exclusion values, error messages) now runs through `escapeHtml()`
(lib.js). Native `confirm()`/`prompt()` dialogs and `showToast()` (uses `textContent`) were
already safe and left as-is. Verify: see the item below.

**Password reset — added.** "Forgot password?" link on the login screen calls
`sb.auth.resetPasswordForEmail`. Code-verified (renders, wires up, no console errors);
the actual email send/click-through needs a real inbox — added as a manual check below.

---

# Pending manual tests (live app)

Collected while you're away — batch these whenever. (App: app.html, signed in, hard-refresh first.)

- [ ] **Revenue plan → projected result (new).** Assumptions → the "Revenue Target" panel is now **"Revenue Plan"**: annual target + an optional 12-month grid. Try **"Spread target evenly"**, then bump a couple of months up/down — the "Plan total" line below should track live and flag drift vs the target. Then check: (1) **Overview** shows a new **"Projected FY2026 result"** panel (revenue plan − full-year cost, with margin) between Budget Version and Signals; (2) **Cash Flow**'s "Operating (est.)" column now follows your monthly profile instead of a flat value — a month you planned low should show a visibly smaller (or negative) operating figure. **"Clear plan"** returns everything to the old flat target÷12 behavior. Until you touch the grid, nothing changes anywhere — worth confirming your live org looks identical to before.
- [ ] **Password reset (new).** Log out (or open an incognito window to the live URL, don't sign in). On the login card, click **"Forgot password?"** without typing an email → should show "Enter your email first…". Type your real email, click it again → should show "Reset link sent — check your email." → check your inbox, click the link, confirm it takes you to a working reset flow.
- [ ] **Cross-org RLS (new, needs a second real account — optional but cheap once you have one).** The policy-text audit says isolation is airtight (see "Security review" above), but a hands-on check is worth 2 minutes once you have a second test login: sign in as a second user with **no** membership in your main org, confirm they see an empty/no-org state, and that no request for your org's data succeeds.
- [ ] **Cash Flow (Phase 5, now complete).** New **"Cash Flow"** nav item. Bank balance mechanism (`#UB` parsing) is already fault-injection-verified live — real, non-zero, correctly-signed number. Two mechanisms are NOT yet verified against real data (your Fortnox sandbox has neither, and I deliberately didn't fabricate either via the API to keep the read-only posture): (1) open invoices — whenever you have a real unpaid customer/supplier invoice, **Monthly → Sync now**, then check **Cash Flow** — it should show up in the "Open Invoices" table with the right due date/amount/counterparty, and shift the projection table's Inflow/Outflow for that month. (2) VAT/payroll tax — whenever your books have real postings on the VAT (default 2610–2659) or payroll-tax (default 2710–2739) account ranges, re-sync, then check the "Tax/VAT (est.)" column on Cash Flow — it should show a non-zero amount landing on the correct Skatteverket due-date (12th of the month, 17th in Jan/Aug). If the numbers look off, check **Assumptions → Tax & VAT Settings** — your chart of accounts or VAT reporting frequency (monthly/quarterly/annual) may differ from the defaults.
- [ ] **Presets (new, needs a fresh org — can't fault-inject this one via SQL since it only shows on a genuinely empty org).** Sidebar → **+ New organization** → give it any name → you'll land on an empty org showing **4 preset cards** (Manufacturer / Consultancy / Retail / Small service) instead of the old single "load example data" link. Click one → confirm it seeds realistic cost centres + headcount + budget for that shape. (Delete the test org after, or keep it — up to you.)
- [ ] **Noise filters (new).** Monthly → Cost-centre mapping → new **"Sync exclusions"** section at the bottom. Add an exclusion (e.g. a voucher series or account you know is a correction/opening-balance) → re-sync → confirm the P&L moved as expected. Already fault-injection-verified on real data by me; this is just a glance.
- [ ] **Periodization (new).** Monthly → **"Spread lumpy actuals"** checkbox next to the FY/Rolling toggle. Turn it on → booked-actual columns for each cost centre should flatten to their period average (italic styling) → FY Total at the far right should NOT change. Turn it back off → raw figures return.
- [ ] **Simple allocation (new).** Planning → tick **"Shared / corporate"** on one cost centre (e.g. Administration) → tick the **"Fully-loaded view"** checkbox near "+ Add cost center" → the shared centre's summary should say "allocated to the other cost centres"; every other centre should show "Direct + allocated = Fully-loaded". Untick both to return to normal.

- [ ] **Drill-down.** Monthly → **Sync now** once (populates the new drill table) → click any **solid (actual) cell** in the grid.
  - Expect: a popup "Cost centre — Month" listing the **BAS accounts behind that number** (account, name, tx count, amount, total). Forecast cells are not clickable.
- [ ] **Coverage line.** After that sync, the P&L panel note should read "Coverage: **100%** of operating costs assigned … Every krona assigned ✓" (your org is fully mapped).
- [ ] **Account ranges UI (glance).** Cost-centre mapping → below the centres there's now an **Account ranges** section (add e.g. `8000–8999 → IT` and remove it again — just to see it works).
- [ ] **Budget versioning.** Overview → new **"Budget version"** panel above Signals.
  - Click **Lock current budget** → name it → it should show "Locked [today] · [name]: [total] approved · ✓ matches the live budget".
  - Go to **Planning**, change a cost centre's annual budget, back to **Overview** → the panel should now show a **drift amount** (over/under) instead of the ✓.
  - Click **Lock current as new version** again → drift should clear back to ✓ against the new snapshot.
- [ ] **Revenue target.** Assumptions page → new **"Revenue Target"** panel at the top → set an annual number (e.g. your real rough target) → go to Monthly, **Sync now**.
  - Expect: the P&L panel's Revenue row shows an extra **"±X% vs budget"** next to the actual figure. Set it back to 0 → the "vs budget" text should disappear.
- [ ] **Recurring costs (important — replaces "Other costs").** Planning → each cost centre now has a **"Recurring costs"** table instead of the old single "Other costs" field.
  - Your existing values should already be there as one row named **"Other costs (migrated)"** with the same amount — **check your FY totals didn't change** (they shouldn't have).
  - Try **+ Add recurring cost**: e.g. a new lease starting mid-year (active from month X) or set a 3% escalation on one — confirm the FY total moves as expected.
- [ ] **Projects mapping (new).** Monthly → Cost-centre mapping → after **Sync now**, if your books have any Fortnox **projects** tagged, a new **"Projects"** section should appear below the cost centres with the same Import/Link buttons.
  - If you don't use projects in Fortnox, this section just won't appear — nothing to check.
  - If you do: link/import one, re-sync, and its actuals should flow in (project tags take priority over cost-centre tags on the same booking).
- [ ] **Re-forecast (new).** Overview → if any cost centre's recent actuals differ >10% from its plan for the next month, a **"Re-forecast"** panel appears with a suggestion + **"Apply run-rate to remaining months"** button.
  - Click **Apply** on one → go to **Monthly** → its future months should show a **dotted-underline** styling (hover for a tooltip) — that's the override, visibly distinct from the plan.
  - Back on Overview, that row should now say **"using run-rate override"** with a **Revert to plan** button — click it and confirm the Monthly grid goes back to normal (dotted underline gone, numbers match the driver plan again).

---
Previously verified live (2026-07-07): ✅

Everything below verified live against real Fortnox data:

- [x] Persistent P&L — survives reload (shown from `last_reconciliation` on load).
- [x] Overview "Actuals P&L — from Fortnox" — revenue → result + margin badge, real numbers.
- [x] Signals — proactive variance flags render with real data.
- [x] Auto/manual "booked through" — Auto lands on last fully-elapsed month; a manual pick survives syncs; Auto option hands control back.
- [x] One-click cost-centre mapping — real centres by name, Import/Link works, unmapped → 0.
- [x] Fiscal-year anchoring — re-sync reproduced exact tie-out numbers.
- [x] Reconciliation/tie-out — 146 462 448 / 98 918 624 / 47 543 824, to the krona, 54,966 vouchers in ~3s.
- [x] Nightly auto-sync — cron path fired manually, synced all orgs autonomously, no error.
