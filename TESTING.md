# Pending manual tests (live app)

Things built while you were away that need a quick check in the live app
(they touch the real Fortnox sync, so they can't be verified in `?preview`).
Do these on https://gavuzzi.github.io/finance-budget-forecast/app.html →
Monthly, connected to a Fortnox test company.

- [ ] **One-click cost-centre mapping.** Hard-refresh → **Sync now** → click **Cost-centre mapping**.
  - Expect: your real Fortnox cost centres by name — `Produktion 10`, `Forsaljning 20`, `Administration 30` — each with its cost + ✓ mapped status.
  - The unmapped **Administration** (~33M that was dropping) should have **Import** / **Link to…** actions.
  - Click **Import** (or Link) → **Sync now** again → the panel's **"unmapped"** should drop to **0** (every krona captured).

- [x] ~~Fiscal-year anchoring re-sync — confirmed same numbers (146 462 448 / 98 918 624 / 47 543 824).~~
