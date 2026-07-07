# Pending manual tests (live app)

**Nothing pending — all clear as of 2026-07-07.** ✅

Everything below verified live against real Fortnox data:

- [x] Persistent P&L — survives reload (shown from `last_reconciliation` on load).
- [x] Overview "Actuals P&L — from Fortnox" — revenue → result + margin badge, real numbers.
- [x] Signals — proactive variance flags render with real data.
- [x] Auto/manual "booked through" — Auto lands on last fully-elapsed month; a manual pick survives syncs; Auto option hands control back.
- [x] One-click cost-centre mapping — real centres by name, Import/Link works, unmapped → 0.
- [x] Fiscal-year anchoring — re-sync reproduced exact tie-out numbers.
- [x] Reconciliation/tie-out — 146 462 448 / 98 918 624 / 47 543 824, to the krona, 54,966 vouchers in ~3s.
- [x] Nightly auto-sync — cron path fired manually, synced all orgs autonomously, no error.
