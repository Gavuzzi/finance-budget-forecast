# Pending manual tests (live app)

Collected while you're away — batch these whenever. (App: app.html, signed in, hard-refresh first.)

- [ ] **Drill-down.** Monthly → **Sync now** once (populates the new drill table) → click any **solid (actual) cell** in the grid.
  - Expect: a popup "Cost centre — Month" listing the **BAS accounts behind that number** (account, name, tx count, amount, total). Forecast cells are not clickable.
- [ ] **Coverage line.** After that sync, the P&L panel note should read "Coverage: **100%** of operating costs assigned … Every krona assigned ✓" (your org is fully mapped).
- [ ] **Account ranges UI (glance).** Cost-centre mapping → below the centres there's now an **Account ranges** section (add e.g. `8000–8999 → IT` and remove it again — just to see it works).
- [ ] **Budget versioning.** Overview → new **"Budget version"** panel above Signals.
  - Click **Lock current budget** → name it → it should show "Locked [today] · [name]: [total] approved · ✓ matches the live budget".
  - Go to **Planning**, change a cost centre's annual budget, back to **Overview** → the panel should now show a **drift amount** (over/under) instead of the ✓.
  - Click **Lock current as new version** again → drift should clear back to ✓ against the new snapshot.

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
