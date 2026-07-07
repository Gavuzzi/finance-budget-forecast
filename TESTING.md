# Pending manual tests (live app)

Things built while you were away that need a quick check in the live app
(they touch the real Fortnox sync, so they can't be verified in `?preview`).
Do these on https://gavuzzi.github.io/finance-budget-forecast/app.html →
Monthly, connected to a Fortnox test company.

- [ ] **Persistent P&L + Overview P&L.** (Migration already applied for you.) **Sync once** → **reload**.
  - Expect: the Monthly **P&L panel stays** on load (doesn't vanish until you re-sync).
  - Expect: the **Overview** now shows an **"Actuals P&L — from Fortnox"** panel (Revenue → Result + margin) under the stats. It also flows into the **Print / board-pack PDF** automatically.

- [x] ~~One-click cost-centre mapping — worked; unmapped dropped to 0, real cost centres shown by name, Import/Link functional.~~
- [x] ~~Fiscal-year anchoring re-sync — confirmed same numbers (146 462 448 / 98 918 624 / 47 543 824).~~
