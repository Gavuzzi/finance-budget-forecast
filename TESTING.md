# Pending manual tests (live app)

Collected while you're away — batch these whenever. (App: app.html, signed in, hard-refresh first.)

- [ ] **Cash Flow (new — Phase 5 v1).** New **"Cash Flow"** nav item. Bank balance mechanism (`#UB` parsing) is already fault-injection-verified live — real, non-zero, correctly-signed number. The open-invoices mechanism is NOT yet verified against real data (your Fortnox sandbox has no unpaid invoices right now, and I deliberately didn't create one via the API to keep the read-only posture). Whenever you have (or create in the Fortnox UI) a real unpaid customer or supplier invoice: **Monthly → Sync now**, then check **Cash Flow** — the invoice should show up in the "Open Invoices" table with the right due date/amount/counterparty, and shift the projection table's inflow/outflow for that month accordingly.
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
