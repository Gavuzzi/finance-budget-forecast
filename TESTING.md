# Pending manual tests (live app)

Things built while you were away that need a quick check in the live app
(they touch the real Fortnox sync, so they can't be verified in `?preview`).
Do these on https://gavuzzi.github.io/finance-budget-forecast/app.html →
Monthly, connected to a Fortnox test company.

- [ ] **Persistent P&L.** Run the migration `alter table integration_status add column if not exists last_reconciliation jsonb;` in the SQL Editor → **Sync once** → **reload** the page.
  - Expect: the **P&L panel stays** on load (doesn't vanish until you re-sync).

- [x] ~~One-click cost-centre mapping — worked; unmapped dropped to 0, real cost centres shown by name, Import/Link functional.~~
- [x] ~~Fiscal-year anchoring re-sync — confirmed same numbers (146 462 448 / 98 918 624 / 47 543 824).~~
