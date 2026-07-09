# Handoff — prioritized fixes

Work top to bottom. Each task is self-contained: do it, verify it the stated way, commit it,
push it, tick it here. Read CLAUDE.md first (sacred rules + tool commands). Do NOT batch
multiple tasks into one commit.

---

## TASK 1 — Security pass (do first) ✅ DONE 2026-07-09 (commit 1d011fa)

### 1a. XSS: escape user/external strings in HTML
**Problem:** UI is built with `innerHTML` and interpolates strings we don't control:
reporting-line names (user-typed) and invoice counterparty names (from Fortnox). A name like
`<img src=x onerror=alert(1)>` executes. RLS limits blast radius to one org, but an editor
could hit a viewer — a real finding.

**Fix:**
1. Add to `lib.js` (top level, after the client setup):
   ```js
   function escapeHtml(s) {
     return String(s ?? "").replace(/[&<>"']/g, (c) =>
       ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
   }
   ```
2. Wrap every interpolation of a **name/label/description/counterparty/note** that goes into an
   `innerHTML` template. Audit these files: `fortnox.js` (counterparty, reporting-line names in
   dropdowns/chips, mapping rows), `cashflow.js` (`inv.counterparty`, `inv.description`),
   `planning.js` (cc.name in headings/confirms that build HTML), `script.js` (cc.name in tables,
   scenario names), `monthly.js` (cc.name, drill account_name), `assumptions.js` (role labels).
   Grep for `${` inside template literals and check each: if the value is a DB/Fortnox string,
   escape it. **Do NOT escape** numbers, `monthLabel()`, `fmtMkr/fmtSek` output, or hardcoded strings.
3. `<option value="${c.id}">${c.name}</option>` — escape `c.name`. (ids are UUIDs, safe, but escaping is harmless.)
4. Leave `<input value="...">` bindings too: `value="${escapeHtml(cc.name)}"` (an unescaped `"` in a name breaks the attribute).

**Verify:** In the SQL DB, temporarily rename one reporting line to
`<b>x</b><img src=x onerror="document.title='XSS'">`, load the app in `?preview`?
No — preview uses mock data. Instead: add a mock reporting line with that name to
`loadPreviewData()` temporarily, screenshot Overview + Planning, confirm the literal text shows
(not bolded, no broken layout), then revert the mock. Also confirm normal names still render fine.

### 1b. Password reset
**Problem:** no way to recover a locked-out account → support burden + looks unfinished.
**Fix:** On the login screen (built in `lib.js`), add a "Forgot password?" link under the form.
On click, read the email field and call
`await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })`,
then toast "Reset link sent — check your email." Handle empty-email ("Enter your email first").
**Verify:** screenshot the login screen (sign out or open a fresh page in `?preview`? login screen
shows when NOT in preview and not authed — render `app.html` with no session; the auth overlay
appears). Confirm the link renders and wiring compiles (no console errors). Felix will do the
real send/receive test — note it in TESTING.md.

### 1c. Adversarial RLS check (verification only, likely no code change)
Confirm a user in org A truly cannot read org B's data. Using the CLI, check that every
tenant table's SELECT policy is `is_org_member(org_id)` and writes are `can_edit_org(org_id)`.
Query `pg_policies` and eyeball all tables incl. the Phase 5 additions
(`cash_position`, `open_invoices`, `tax_liability_monthly`) and the renamed
`reporting_lines`/`reporting_line_mappings`. If any tenant table has RLS off or a missing/loose
policy, that's a finding — fix it in schema.sql + live. Write the result (pass or fixes) into
TESTING.md under a "Security review" heading.

**Commit 1** after 1a+1b+1c: "Security pass: escape HTML injection points, password reset, RLS audit".

---

## TASK 2 — Cash flow honesty + runway

**Problem:** `cashFlowProjection()` in `data.js` walks the balance using only open invoices + tax.
It omits salaries/recurring/one-offs (the biggest outflows) and revenue, so the projected line is
far too flat and answers "can I make payroll?" wrongly.

**Fix (data.js `cashFlowProjection`):**
- For each projected month, add estimated operating flows from the existing engine:
  outflow += the month's forecast cost for all reporting lines (reuse `companyMonthAmount(m)` /
  the per-line `monthAmount` forecast — the same numbers the Monthly page forecasts).
  inflow += estimated revenue for the month = `ASSUMPTIONS.revenueBudget / 12` (crude but honest;
  refine when Task 3 lands a real revenue plan).
- Keep these in a SEPARATE signed bucket from the hard invoice flows, exactly like tax. The table
  should distinguish "hard" (open invoices) from "estimated" (operating + revenue + tax).
- Add a **runway** calc: if the running balance trends negative, months until it crosses zero;
  else "12+ / positive". Expose as a new stat card on cashflow.js ("Runway: X months" or
  "Cash-positive").
**cashflow.js:** add the operating in/out to the monthly table (can fold into existing columns
with an "(est.)" treatment, or add columns — keep it readable), add the runway stat card, and
UPDATE the page copy: it currently says invoices+tax only; it must now say the projection includes
estimated operating costs and revenue.
**Verify:** hand-compute from `loadPreviewData` fixtures (bank 6 200 000; the 6 invoices; tax mocks;
plus now the preview reporting-line forecasts and revenueBudget 50 000 000 → ~4 166 667/mo revenue).
Screenshot, confirm the line now slopes realistically and the runway number matches your hand calc.
Dark + light.
**Commit 2:** "Cash flow: include estimated operating costs + revenue, add runway".

---

## TASK 3 — Monthly revenue plan → forecast P&L (bigger; do after 1–2)
Give revenue a simple monthly plan (not just one annual number): either a typed 12-month profile
or "last-year actual × growth %". Then Overview/Monthly can show a **projected full-year result**
(revenue − cost), not just actuals. Design it like the recurring-costs UI. This is the jump from
cost tool to real FP&A. Scope it as its own mini-project; write a plan in ROADMAP.md before coding.
**Commit 3** (or several).

---

## Notes for whoever picks this up
- Verify visually (screenshot + Read it) and numerically (hand-compute first). CLAUDE.md has the commands.
- If a step's reality differs from this doc, trust the code and tell Felix — don't force the doc.
- Anything needing Felix (real Fortnox data, dashboard clicks, email receipt) → collect in TESTING.md, don't block.
