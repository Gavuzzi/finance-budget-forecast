# FP&A Planning — design notes & roadmap

Captures the product/architecture decisions behind the Fortnox integration and
the reporting model, plus the prioritized build backlog. Doubles as sales
knowledge: how SMEs actually keep their books, and how we fit them.

---

## Guiding principles

- **Config, not code.** One shared engine; each customer is *data + settings*, never a fork. New client needs → a config knob added to the shared product, reusable by the next client.
- **Opinionated, not general.** We are *not* SAC/Anaplan. Their generality is their onboarding pain — that pain is our opening. We do one thing (driver-based FP&A for SMEs) with a small, chosen set of knobs. IKEA, not Lego.
- **Simplicity is the moat.** Easy onboarding is the differentiator. Anything that reduces setup friction (master-data load, presets, auto-mapping) is core, not polish.
- **Arrive prepared.** Research the common setups up front and pre-build for them. Show up knowing their world — that reads as senior, not "never seen this before."
- **Steal proven patterns — always.** Before building ANY feature, tear down how the winners do it (steal list below) and copy the convention; users should never have to learn something twice. Innovation budget goes only to our edge (fitted simplicity + Fortnox auto-actuals). Never copy the anti-pattern: consultant-config complexity.

## Source-of-truth model (three kinds of data)

| Data | Owner | In our app |
|---|---|---|
| **Structure** — cost-centres, projects, accounts | **Fortnox** | Load it → auto-create reporting lines + auto-map |
| **Plan** — budget, headcount, rates, drivers | **Our app** | Authored here (Fortnox has no forward plan) |
| **Actuals** — transactions | **Fortnox** | Synced → `monthly_actual` (built) |

Rule of thumb: **pull structure + actuals from Fortnox; own the plan ourselves.**

## Reporting lines (generalize "cost centers")

The app's dimension object is a **reporting line** — modelled as `reporting_lines` (renamed from `cost_centers` in Phase 3), and conceptually it can be fed by any Fortnox dimension. Each line carries:
- **`source`**: `fortnox` (refreshes on master-data sync) or `manual` (never clobbered).
- **`state`**: `planned` (budget only, no Fortnox link yet) or `linked` (mapped, actuals flow in).
- a **mapping** to Fortnox via a rule (below).

## Dimension-agnostic mapping

A mapping row = `{ dimension, value/range → reporting_line }`, where `dimension` is:
- **`costcenter`** — a kostnadsställe code (built)
- **`project`** — a projekt code
- **`account`** — a BAS account or range (e.g. `5000–5999`)

The sync buckets each voucher row by a **configurable precedence**: `project → costcenter → account fallback`. Account fallback is universal — it works even when a company tags *nothing*.

## How SMEs set up Fortnox → presets

| Preset | Maps by | Shape |
|---|---|---|
| Consultancy / agency | project | cost & revenue per engagement, people-heavy |
| Manufacturer | cost-centre | departments, materials-heavy COGS |
| Retail / e-com | account groups | COGS, logistics, thin cost-centre use |
| Small service SME | account ranges | nothing tagged |

A preset is a *researched configuration* (dimension + typical accounts + typical drivers). Onboarding = pick your type → a fitting solution appears. Presets = encoded expertise.

## Messy / half-used structures → handling

| Pattern | Handling |
|---|---|
| Partial tagging | Coverage meter + untagged → **Unassigned** line. Never silently drop. |
| Shared costs never tagged (rent, IT, admin) | Dedicated **Shared / Overhead** line + *optional* simple allocation |
| Dimension repurposed (KS used as project/location) | Mapping is code→line (agnostic); don't assume KS = department |
| Custom / inconsistent accounts | Account **ranges** with include/exclude overrides |
| Mixed dimensions | Configurable **precedence** (project → costcentre → account) |
| Noise vouchers (corrections, accruals, opening balances) | Filter by voucher series / exclude accounts |
| Lumpy bookings (annual costs in one month) | Show honestly; optional "spread annual costs" toggle |
| Payroll as one lump voucher | Account-based (7xxx) captures it; allocate if no split |

**Meta-mechanisms (cover ~all of the above):** account-range fallback · coverage transparency · Unassigned/Shared line · optional simple allocation · precedence + noise filters.

**Two principles (FP&A best practice — and they reinforce the simplicity edge):**
1. **Show it both ways** — before allocation (directly attributable) *and* after (fully-loaded). Default to the unallocated view; it's usually more useful for decisions.
2. **Keep allocation dead simple**; leave genuinely-corporate costs (CEO, audit, board) unallocated. Complex allocation becomes a political football and erodes trust.

## Plan-ahead lifecycle (budget things that don't exist yet)

This is what makes it FP&A, not an accounting viewer. You can budget a cost-centre/project *before* it exists in Fortnox:
1. **Plan** — create the reporting line (`state = planned`), budget it. No Fortnox equivalent.
2. **Materialize** — it's created in Fortnox and starts booking.
3. **Reconcile** — link the new Fortnox code to the line you already planned → plan-vs-actual tracks from day one.

Already supported by the model: driver engine plans future hires; scenarios model "what if we open X"; the actuals-only rule means a planned line shows **budget as forecast + dashes for actuals** until it materializes.

### Link-or-create (the reconciliation UX — the "how")
When master-data sync (or the actuals sync) finds a **Fortnox code that isn't mapped yet**, surface it in an "unlinked items" review. For each, the user picks:
- **Link to existing line** (dropdown) — for something they already planned, or
- **Create new line** — auto-generate a line from the Fortnox name/code.

This prevents duplicates (planned-by-hand + created-in-Fortnox showing up twice) and *is* the plan→actual bridge.

## Cost & revenue forecast methods

Each reporting line's plan is computed by a **forecast method** — a small, bounded
set (not open-ended types; config, not code). Design the line to carry a `method`
field now; build the methods in Phase 3.

- **Headcount** — role × count × loaded rate, over a period *(built)*
- **Fixed recurring** — amount/month · start–end · optional annual escalation %
- **One-off** — amount in a month *(built)*
- **% of a driver** — % of revenue, or % of another line (variable / revenue-linked)
- **Per-unit × volume** — rate × a volume assumption (materials, shipping)
- **Manual profile** — type the 12 months (escape hatch for seasonal/irregular)

Today the model has only headcount + one-off + a single flat **"other monthly" blob**
per line — that blob should become proper recurring lines with start/end.

Revenue is modelled the same way: actuals auto-synced from BAS class 3; the plan
kept simple (typed target or growth %) — no revenue-driver engine. **Revenue +
variable (% / per-unit) methods together are what make the P&L flex with volume** —
change a revenue/volume assumption and the whole statement moves. That's the thing
spreadsheets can't do reliably.

## Frontend & UI changeability

The engine (`data.js`: model, calculations, Supabase access) is deliberately
**UI-agnostic** — rendering lives in the per-page files. So the UI can be reworked
without touching the valuable logic; client feedback on look/flow can never force
a rewrite of the core.

- **Visual changes** (colour, layout, spacing) = mostly CSS, easy even today (CSS variables already drive theming).
- **UX-flow changes** = the render layer; changeable, but heavier in today's vanilla-JS + `innerHTML` approach.
- **The catch:** the backlog roughly *doubles* the UI surface (revenue, cash, versioning, drill-downs, mapping/allocation UIs). Hand-built `innerHTML` templates get slow and error-prone at that scale.

**Plan:** stay vanilla through Phase 0–1 (validate, keep momentum). Around Phase 2–3,
when the UI surface grows, migrate to a component framework (React/Svelte) — a
*bounded* project precisely because the engine is separate. Keep the engine
framework-free the whole way; that's the insurance that makes the swap cheap.

## Currency — deliberately minimal

Swedish books are kept in **SEK by law**; foreign transactions are booked in SEK in the GL, so the sync always pulls SEK. Multi-currency/FX is a trap for ~2% of customers.
- **Do:** make the unit suffix respect `organizations.currency` (kr/tkr/mkr vs €).
- **Don't:** build FX conversion. Revisit only if we leave Sweden/Fortnox.

## Not yet designed — bigger open questions

**Planning discipline / time**
- **Budget vs forecast as distinct, versioned series.** A *locked, approved* budget baseline vs a *living* forecast. Today `annual_budget` is just an editable number — no approved-and-locked version, no "forecast as of June vs as of May." Core FP&A (obvious in SAP); currently under-modelled.
- **Re-forecast from actuals.** The forecast is purely driver-derived and ignores what actuals say (run-rate). Real re-forecasting blends actuals-to-date into the remaining months.
- **Prior-year history as a baseline.** Forecasting often leans on last year (× growth). We pull current-year actuals only; loading 2–3 years unlocks baselines + trend comparison.

**Trust / traceability**
- **Drill to transaction.** From a monthly line back to the Fortnox vouchers behind it ("what's in this number?"). Pairs with reconciliation; critical for trust.

**A whole missing view (strategic fork)**
- **Cash flow.** We do P&L (accrual). SMEs often worry most about *cash* — when money actually moves (payment terms, VAT timing, receivables/payables). A cash forecast is a different, big build — decide if it's ever in scope.

**Outputs / operations**
- **Excel export** — finance people live in Excel; expected, cheap, high-satisfaction.
- **Scheduled auto-sync** (Supabase cron) — the "always current" promise vs manual "Sync now."
- **Variance "why"** — bridge/walk + commentary + drill (where controllers spend their time). We have a basic variance number + a note field.

**Smaller / existing knobs**
- Allocation key UX — how simple can "spread shared costs by headcount/revenue" be?
- Master-data re-sync conflict rules (renamed lines, deactivated cost-centres).
- Presets: seed data vs onboarding wizard step?

**Also noted (smaller / market-fit)**
- **Salary/cost escalation over time** — a person costs the same forever today; headcount method needs an annual-increase option.
- **Audit trail / change history** — who changed which number when; finance-grade credibility, pairs with versioning.
- ~~**Swedish localization**~~ — done, see Phase 6 below.

**Explicitly out of scope for now:** balance sheet, group consolidation, approval workflow, alerts.

---

## Steal list — proven patterns from the winners (copy convention, innovate only on our edge)

From teardown of Runway / Abacum / Causal / Planacy (2026-07-07):
- **Proactive variance flags** *(Runway/Abacum — all winners have this)*: the system surfaces "what's off" in plain language instead of making you scan tables. → Build as "Signals" on Overview. **(building now)**
- **Forecast suggestions from history** *(Planacy)* = our re-forecast item ✓ validated.
- **Version control on budgets/forecasts** *(Abacum)* = our versioning item ✓ validated.
- **Auto-retrieved actuals at process start** *(Planacy)* = our Fortnox sync ✓ already built.
- **Investor/board-ready reporting** *(Runway)* = our board pack ✓; polish later.
- **Anomaly scanning with severity + explanation** *(Abacum)* — later, after Signals proves out.
- Anti-pattern to NOT copy: Planacy's module sprawl (needs consultants to configure) — that's the gap we live in.

## Risks & what can go wrong

**Correctness & trust — highest stakes (in finance, one wrong number ends the relationship)**
- **Reconciliation/tie-out is unsolved.** Validated on 4 toy vouchers, never a real GL. Our summed actuals *must* tie to Fortnox's own result report per period, or trust dies. → Make a reconciliation check (our total vs Fortnox's report) a first-class feature, in Phase 1.
- **"Truly closed" is inferred, not known.** We set `close_month` = last month with a booking. A partially-booked *current* month then reads as fully closed → understated actuals → fake favourable variance. → Use Fortnox's real locked-period info, or have the user confirm the closed month.
- **Account scope is crude.** We take 5000–7999. Some firms book operating costs in 4xxx (varukostnader/COGS); 8xxx is financial. → Configurable account scope with BAS-aware defaults.
- **Corrections/deletions don't propagate.** Sync is upsert-only; a voucher reversed/deleted in Fortnox leaves stale actuals. → Full-refresh a period (delete + reload), not blind upsert.

**Scale & reliability**
- **N+1 API calls → timeouts + rate limits.** ~~The per-voucher GET loop dies at ~750 vouchers~~ (Fortnox rate limit = 25 req / 5s; Edge Function ~150s). **✅ Solved:** switched to a single **SIE export** (`/3/sie/4`) per sync — one call returns the whole year's transactions with dimensions, parsed locally. O(1) API calls, scales to 500k+ vouchers, corrections included. Vouchers list has no rows, so the SIE route is the only scalable option.

**Scope gaps**
- **No revenue.** The app is cost-only. Real FP&A is P&L; a project-based client (our Phase 3 target) lives on revenue/margin per project. → Decide: honest cost-planning tool, or add revenue (3xxx) as a peer to cost.
- **Complexity creep.** Every phase adds knobs (dimensions, precedence, allocation, presets). The more flexible, the more we risk *becoming* the hard-to-onboard thing we're beating. → Actively guard the "IKEA not Lego" line; sane defaults everywhere.

**Business / platform**
- **Production access & real financial data.** Sandbox is easy; production access to real customers' books may need a Fortnox partner agreement, and holding real GL data brings DPA/GDPR/security duties we've deferred. Fortnox could also ship budgeting themselves.
- **Unvalidated by a real client or dataset.** All four phases are coherent but rest on assumptions + a 4-voucher sandbox.

**De-risking move:** before investing in Phase 2+, run **one real (or realistic full-year) Fortnox dataset** through the sync and make it **tie out** to Fortnox's P&L. That single test attacks reconciliation, scale, and the `VERIFY` spots at once.

---

## Step-by-step plan (validation-first)

**Principle: prove the foundation before building on it.** No new features until
the current sync ties out to Fortnox's own P&L at realistic scale.
`[F]` = Felix does it in Fortnox/Supabase · `[B]` = a build task.

### Phase 0 — Prove the foundation (do this first)
Goal: the sync's numbers match Fortnox's result report, at real scale, reliably.
- [x] `[F]` **Realistic sandbox** — 80-voucher SIE across BAS 3/4/5/6/7, 3 cost-centres, a project, a lumpy annual cost, a correction. Generated via `test-data/seed-sie.pl`, imported into "Large scale Actual test". *(A bigger set for the scale test is next.)*
- [x] `[B]` **Reconciliation / tie-out** — sync returns a full-P&L reconciliation (revenue/COGS/opex/personnel/result) from every voucher, shown in-app. **✅ Ties out to the öre** against Fortnox (2 467 000 rev / 2 733 000 cost / −266 000 result).
- [x] `[B]` **Account scope** — widened cost capture to BAS 4–7 (COGS now included) + revenue class 3 in the reconciliation. *(Full per-account configurability = later refinement.)*
- [x] `[B]` **Never-fail read (SIE bulk export)** — replaced the N+1 per-voucher fetch with a **single `/3/sie/4` export per sync**, **stream-parsed** (constant memory). ✅ **Proven end-to-end: 54,966 vouchers / 109,980 rows tied out to the krona in ~3 seconds** (the old approach would've made 54,966 API calls). Locally, 500k vouchers parse in ~1s. Corrections/deletions handled for free (full re-export each sync). O(1) API calls at any volume. *(Risk #2 — scale/timeout, DEAD.)*
- [x] `[B]` **Period refresh, not blind upsert** — sync now replaces actuals wholesale (delete + insert from the full SIE re-export), so corrections *and deletions* propagate; stale rows impossible. *(stale-actuals drift — closed)*
- [x] `[B]` **Real "closed" month** — stolen from the winners: sync auto-advances only to the last **fully-elapsed** month (Fathom's default — a partial current month never reads as closed), and a manual dropdown pick (Oxceed-style boundary) is authoritative: syncs never override it. "Auto (Jun 26)" option hands control back. *(fake favourable variance — closed)*

- [x] `[B]` **Support broken fiscal years** (brutet räkenskapsår) — sync anchors each voucher's month to the fiscal year's real start (`/3/financialyears` FromDate) **and persists it** (`organizations.fy_start_month/year`); the app's month labels are now FY-relative too (verified: May-start year renders May 26 → Apr 27). Calendar years unchanged.

**Gate:** foundation ties out → only now build features.

### Decision — Revenue ✅ DECIDED: include
Revenue is in scope (actuals from BAS 3xxx + simple typed plan + margin per line/project). Design reporting lines to hold revenue *and* cost from now; build the P&L/margin view in Phase 3. No revenue-driver engine — keep the plan simple.

### Phase 1 — Universal ingestion
- [x] `[B]` `dimension` (`costcenter|project|account`) + `source` (`fortnox|manual`) + `state` (`planned|linked`) on the model — migrations applied, sync + UI use them
- [x] `[B]` Account-range matcher — sync falls back to account ranges for untagged/unmapped rows; add/remove ranges in the mapping UI. Untagged companies are now syncable.
- [x] `[B]` Coverage % + **Unassigned** line — unplaced money lands in a real "Unassigned (Fortnox)" line (auto-created/auto-removed); panel shows coverage. Verified live by fault injection (67% → 100%).
- [x] `[B]` Currency suffix respects `organizations.currency` (SEK → kr/tkr/mkr, EUR → €/t€/m€)
- [x] `[B]` Drill-down v1 — sync stores per (line × month × account) detail with names from SIE #KONTO; clicking an actual cell shows "what's in this number" (accounts, tx counts, amounts). *(blind spot #3 — account-level; voucher-level later)*
- [x] `[B]` Prior-year baseline v1 — sync also reads the PREVIOUS fiscal year's SIE (still O(1) calls, best-effort) and the P&L panels show "vs LY" deltas on revenue/cost/result. Graceful when no prior FY exists. *(per-line monthly PY = later, with trend views)*

### Phase 2 — Onboarding superpower
- [x] `[B]` Master-data load (cost centres) — sync also fetches Fortnox's full `/3/costcenters` list (best-effort), so a cost centre defined but never yet booked to (plan-ahead) still appears in the mapping UI to link-or-create against. Verified live: full sync ran clean, coverage unaffected. *(Projects deferred to Phase 3, alongside the project matcher — no UI would consume it yet)*
- [x] `[B]` **Link-or-create** reconciliation review — already delivered by the one-click mapping UI (Phase 1): every unmapped Fortnox code lists with **Import** (create a new line) or **Link to…** (an existing one).
- [x] `[B]` **Budget vs forecast as versioned series v1** — a `budget_versions` table snapshots every cost centre's live annual_budget under a name + lock timestamp; the Overview shows the locked baseline, flags drift from the live (still-editable) budget, and lets you lock a new version. *(blind spot #1 v1 — forecast-side versioning/drift-over-time trend is a later iteration)*

### Phase 3 — Breadth
- [x] `[B]` Project matcher + dimension precedence — sync now parses SIE dimension 6 (Projekt, the SIE4-reserved standard, verified against spec) alongside dimension 1 (Kostnadsställe); precedence per row is project tag → cost-centre tag → account range → Unassigned. Mapping UI has a parallel "Projects" section (Import/Link, same one-click pattern). Master-data load extended to `/3/projects`. Fixed a latent bug this surfaced: the mapping table's unique constraint was (org_id, external_code) only, predating the dimension column — a project code and cost-centre code sharing the same string (e.g. both "10") would have silently collided; now (org_id, dimension, external_code). Verified live: full sync ran clean, coverage unaffected.
- [x] `[B]` Presets — the empty-org state offers 4 researched starter shapes (Manufacturer, Consultancy/agency, Retail/e-commerce, Small service) instead of one generic example. Each seeds realistic roles/cost-centres/headcount/budget AND states which Fortnox dimension that business type typically maps by (cost-centre / project / account ranges) — onboarding = pick your type, arrive prepared, per the "arrive prepared" guiding principle. Verified in preview: all 4 cards render correctly with distinct hint copy.
- [x] `[B]` Revenue plan v1 — a simple annual revenue target (`assumptions.revenue_budget`, deliberately no driver engine) set on the Assumptions page; the P&L panel shows "+X% vs budget" next to actual revenue whenever a target is set. Verified in preview (52.4M actual vs 50M target -> +5%).
- [x] `[B]` **Recurring cost lines** — replaced the flat "other_monthly" blob with named lines (label, amount, start/end month, annual escalation %). Migration auto-preserved every existing value as an equivalent line (verified: identical FY totals before/after, to the mkr). Planning UI mirrors the one-offs table. *(% of driver / per-unit / manual-profile methods are a later iteration — this closes the recurring-with-escalation gap, the one explicitly flagged in the design)*
- [x] `[B]` **Re-forecast from actuals v1** — a "Re-forecast" panel on Overview suggests applying the recent (up to 3-month) actuals run-rate to a cost centre's remaining months, only when the drift exceeds 10%. **Manual, opt-in, per-line, fully reversible**: a new `forecast_overrides` table holds explicit user-applied values that `monthAmount()` checks before falling to the driver forecast — nothing is ever written by a sync. Overridden cells are visibly flagged on the Monthly grid (dotted underline + tooltip), never silently blended. Verified in preview: 3 independently-computed real suggestions rendered correctly. *(blind spot #4 — closed per the explicit "never auto-overwrite" constraint from design discussion)*
- [x] `[B]` Variance "why" bridge — a "Why?" toggle on each Planning cost centre reveals a composition breakdown (booked actuals + each driver category's forecast for the remaining months), summing exactly to the FY total. Paired with drill-to-transaction (account-level, built earlier) and the existing variance-note commentary field, this closes the full "what's in this number" story at both the FY (macro) and monthly-account (micro) level. Verified in preview: 14,6+5,2+0,7+8,1 = 28,6 mkr, exact match.
- [x] `[B]` Rename `cost_centers` → reporting lines — a genuine full rename, not just UI copy: `cost_centers` → `reporting_lines`, `cost_center_mappings` → `reporting_line_mappings`, and the `cost_center_id` FK column → `reporting_line_id` on every referencing table (headcount_lines, one_offs, monthly_actual, recurring_costs, forecast_overrides, reporting_line_mappings, actual_detail), plus `integration_status.last_cost_centers` → `last_reporting_lines`. Applied live via `ALTER TABLE ... RENAME` (atomic, RLS policies carry over automatically by OID), immediately followed by an edge-function redeploy and a client-side sweep of every `.from()`/`.eq()`/insert-key call, plus user-facing copy (page headings, button labels, CSV headers, empty-state text) across app/monthly/planning.html/js and data.js/fortnox.js. Internal JS identifiers (`COST_CENTERS` global, `cc`/`ccId` locals, CSS classes) were deliberately left alone — decoupled from the DB schema, renaming them was pure extra risk for zero benefit. Verified live end-to-end: PostgREST recognizes the new names (200s, not 404s) immediately after the DDL (no manual schema-cache reload needed), a triggered sync ran clean and wrote correct row counts (8 reporting lines, 42 monthly_actual rows, 3 mappings — all preserved through the rename), and all 5 pages screenshot-verified in `?preview` with the new copy rendering correctly.

### Phase 4 — Depth & polish
- [x] `[B]` Simple allocation — mark a cost centre "Shared / corporate"; an OPTIONAL "Fully-loaded view" toggle (OFF by default — "keep allocation dead simple; default to the unallocated view" per the researched principle) allocates its total to the other cost centres by FY-average headcount, showing Direct / + allocated / = Fully-loaded per line. Never touches stored budgets/forecasts — pure derived display. Verified in preview: R&D 9,3+21,4=30,7 mkr, IT 3,9+7,1=11,0 mkr, and the conservation invariant holds (allocated shares sum back to the shared centre's total; company total is redistributed, not lost or duplicated). Closes Phase 4.
- [x] `[B]` Noise filters — a "Sync exclusions" panel lets you exclude a whole voucher series (e.g. a corrections series) or a specific account (e.g. opening balances); excluded rows are fully ignored everywhere, not just left unmapped. Verified live via fault injection on real data: excluding account 7010 (Löner) zeroed Personnel exactly and moved Result by precisely the excluded amount (+3,600,000); excluding series "A" (100% of the test company's vouchers) zeroed revenue and cost entirely while the scanned voucher count stayed correct. Fully restored after.
- [x] `[B]` "Spread lumpy actuals" periodization toggle on Monthly — a display-only lens (OFF by default, "show honestly" wins), never a data mutation: booked actuals for a cost centre display as their period average instead of the raw lumpy figure, so one annual payment landing in a single month doesn't read as a spike. FY/company totals are unaffected (average × count = the same sum) since they're computed from the real monthAmount(), only the per-cell DISPLAY is substituted; drill-down still opens the real month's transactions. Verified in preview: smoothed cells show the exact arithmetic average (14,600,000/6=2,433,333→2,4 mkr) while FY Total stayed at 28,6 mkr in both states.
- [x] `[B]` Excel export — one-click CSV of the Monthly grid (sv-Excel format: BOM + sep=;), FY + rolling lenses *(blind spot #5 — done early, it was cheap)*
- [x] `[B]` Scheduled auto-sync — pg_cron fires the sync nightly (05:00 UTC) for every connected org, secret-authorized, per-org error isolation. Verified live: cron path synced 54,966 vouchers autonomously with exact tie-out. *(blind spot #5 — "always current" is real)*

### Phase 5 — Cash flow (major module · ✅ on the map, sequenced last)
A second forecast lens: **bank-balance projection, not P&L.** Different data
(unpaid customer/supplier invoices + due dates, VAT settlement, salary/tax dates)
and a running-balance view. Potentially *more* valuable to SMEs than the P&L —
"can I make payroll?" — but a big, separate build. *(blind spot #2)*
- [x] Decided: in scope — the flagship capstone, built last
- [x] `[B]` Pull open invoices + due dates from Fortnox → projected in/outflows. Bank balance is extracted for free from the existing SIE download (`#UB` closing-balance directive, BAS 1900–1999, current year) — no extra API call. Open invoices come from two new REST calls (`/invoices`, `/supplierinvoices`, `filter=unpaid`, paginated). Verified live on the real sandbox: `#UB` parsing produced a real non-zero bank balance (−4,296,000, correctly negative given the synthetic test data models no cash receipts) and the sync ran with zero errors end-to-end. The invoice-ingestion code path itself is only structurally verified, not data-verified — the sandbox genuinely has no unpaid Fortnox Invoice/SupplierInvoice objects, and I deliberately did not create a test invoice via Fortnox's write API (would violate the read-only posture in the Compliance gate below). See the new TESTING.md item.
- [x] `[B]` VAT + payroll/tax payment timing — researched Skatteverket's actual 2026 deadline rules (turnover ≤40M SEK segment: 12th of month N+1/N+2, except the 17th whenever that resolves to January or August) rather than guessing. The sync tracks each month's CLOSING balance (`#IB` opening balance + cumulative `#TRANS`, extending the same streaming parse) for two configurable BAS account ranges — default 2610–2659 (moms sub-accounts + the 2650 settlement account; deliberately wide so internal reclassification entries net to zero regardless of bookkeeping style) and 2710–2739 (personalskatt + arbetsgivaravgifter). A new "Tax & VAT Settings" panel on Assumptions lets you correct the ranges/frequency for your own chart of accounts. `cashFlowProjection()` maps each closing balance to its real calendar due-date (broken fiscal years handled — VAT/payroll deadlines follow the calendar, not the org's FY) and surfaces it as its own signed "Tax/VAT (est.)" column — never blended into the hard open-invoices inflow/outflow, and clearly labelled an estimate. Verified: `#IB` parsing mirrors the already-proven `#UB` pattern; sync deployed and ran clean live (no errors) with the new account-range config loaded correctly; UI verified via `?preview` screenshot with the numbers tying out exactly (Jul: 1.5−0.9−1.0=−0.4→5.8mkr; Aug: 1.5−0.3−0.4=+0.8→6.6mkr). Same honest caveat as open_invoices: the sandbox's synthetic SIE data has no postings in the VAT/payroll account ranges, so the end-to-end number itself is not yet data-verified against a real balance — flagged in TESTING.md. I did not create synthetic Fortnox vouchers to force a test value, to keep the read-only posture unconditional.
- [x] `[B]` Running bank-balance forecast view — new `cashflow.html` page (added to nav): stat cards (bank balance, open AR, open AP, projected balance), a running-balance line chart, a 6-month inflow/outflow/tax/net/balance table, and an open-invoices list. Verified in `?preview` (dark + light) via headless screenshot; the monthly table's per-month arithmetic ties out exactly including the tax/VAT column (6.2 mkr bank walked forward by invoices + estimated tax/VAT → 6.6 mkr projected in 6 months). Closes Phase 5.

### Phase 6 — Retention, trust & correctness (post-feature-complete review, 2026-07-09)
All Phase 0–5 build items done. A full-solution review (with self-critique) surfaced two
truth-bugs, a security gap, and a set of high-leverage steals from the winners. Ordered by
priority. **Detailed, step-by-step specs for the first three live in `HANDOFF-fixes.md`** —
built so a cheaper model can execute + self-verify mechanically. Do those first.

**Correctness & security — do first (these are bugs, not features)**
- [x] `[B]` **Security pass** *(HANDOFF-fixes Task 1 — done 2026-07-09, commit `1d011fa`)* — (a) **XSS:** the app built UI via `innerHTML` and interpolated user-typed reporting-line names + Fortnox counterparty names unescaped → a name like `<img src=x onerror=…>` would execute. Added `escapeHtml()` (lib.js) and swept every injection point across fortnox.js, cashflow.js, planning.js, script.js, monthly.js, assumptions.js, sidebar.js, lib.js's own error display — names, notes, labels, scenario/budget-version/org names, invoice counterparty/description, synced account names, CSV-import unmatched names, exclusion values. Verified live: injected an `<img onerror>` payload into a preview reporting-line name, confirmed inert literal text on Overview + Planning (title unchanged, no broken layout), then confirmed normal names incl. ampersands ("R&D") still render correctly. (b) **Password reset** — "Forgot password?" added to the login screen (`sb.auth.resetPasswordForEmail`), screenshot-verified; real email click-through needs a live inbox (in TESTING.md). (c) **Adversarial RLS audit** — queried `pg_class`+`pg_policies` for all 21 public tables: RLS enabled everywhere, every policy scoped by `is_org_member`/`can_edit_org`, no unscoped policy anywhere, `integrations` correctly has zero policies (deny-all). Full writeup in TESTING.md; a live two-account test is the one thing still needing a real second login.
- [x] `[B]` **Cash-flow honesty + runway** *(HANDOFF-fixes Task 2 — done 2026-07-10)* — the flagship Cash Flow projection previously walked the balance from open invoices + tax ONLY, omitting salaries/recurring/one-offs (the biggest, most predictable outflow) and revenue — reading far too flat and answering "can I make payroll?" *wrongly*. `cashFlowProjection()` now nets the existing driver forecast (`companyMonthAmount`, the same numbers Overview/Monthly already show) against a flat monthly revenue estimate (`revenueBudget/12`) as a new signed **"Operating (est.)"** column, kept strictly separate from the hard invoice figures and the existing Tax/VAT estimate — same non-blending convention, same `mt-forecast` styling. Also added a **Runway** stat card (5th card on Cash Flow only, `#cashStatsRow` CSS override): walks the same operating estimate forward up to the full 24-month driver-forecast horizon looking for a zero-crossing, reporting "Cash-positive" when it never crosses. The function's return shape changed from a bare array to `{ rows, runway }`; all 3 call sites in cashflow.js updated. Verified by hand-computing the full 6-month preview projection from first principles (role rates, headcount windows, one-offs, recurring costs, invoice due-dates, tax due-dates) *before* looking at the render — every cell (inflow, outflow, operating, tax/VAT, net, running balance, all 5 stat cards) matched the screenshot exactly to the krona-rounded mkr figure. Checked dark, light, and mobile-width (2-col wrap) renders.

**Revenue → real forecast P&L**
- [x] `[B]` **Monthly revenue plan → forecast P&L** *(HANDOFF-fixes Task 3 — done 2026-07-10)* — revenue was one annual number, so there was no *forecast* P&L, only an actuals one. **Shipped:** (1) *Storage:* `assumptions.revenue_plan jsonb` (nullable array of 12 monthly SEK values, FY-relative), applied live + mirrored in schema.sql; null/absent/all-zero → engine falls back to the flat `revenue_budget/12`, so existing orgs see zero behavior change until they opt in. The annual target remains what the P&L "vs budget" chip compares against; the plan is the month-by-month *shape*. (2) *Engine:* `revenuePlanForMonth(m)` (profile repeats annually for FY2027 months — seasonality carries forward until a next-FY plan exists) + `revenuePlanFyTotal()`. (3) *Assumptions:* the Revenue Target block became **Revenue Plan** — annual target + optional 12-input monthly grid, "Spread target evenly" / "Clear plan" helpers, and a live plan-total readout flagging drift vs the target (green ✓ when within 1 000 kr). First edit of any month seeds all 12 cells from target÷12 so one keystroke doesn't zero the other eleven. (4) *Overview:* new "Projected FY2026 result" panel = revenue plan FY total − `companyFySummary().total` (booked actuals + driver forecast) with margin %; hidden when no revenue is configured and in the empty-org state. (5) *Cash Flow:* the Operating estimate now uses `revenuePlanForMonth(m)`; copy/tooltips updated. Chose typed-monthly-profile over "last-year × growth%" because monthly revenue actuals don't exist client-side (the sync only aggregates full-year revenue) — a growth% variant would need Edge Function changes for no v1 gain. Monthly-page revenue row deferred. **Verified:** preview got a seasonal profile summing to exactly the 50.0M target (July industrisemester dip to 3.0M); hand-computed the entire 6-month projection from first principles before rendering — all 36 table cells, the 10,9 mkr projected balance, the July −0,5 mkr net / 5,7 mkr dip, and the Overview panel's +8,2 mkr = 50,0 − 41,8 · 16% margin all matched the screenshots exactly. Checked dark, light, mobile (3-col grid), and the `?preview&empty` state (panel correctly hidden). Live orgs untouched until they set a plan (null → flat fallback verified by code path; real-data check in TESTING.md).

**Steal from the winners — retention & trust (the moat for Decision Systems Lab)**
- [x] `[B]` **Monthly email digest** *(steal: Runway — done 2026-07-10)* — new `supabase/functions/send-digest`, monthly via pg_cron (`monthly-digest`, 06:00 UTC on the 1st, one hour after the nightly sync) using the same `x-cron-key`/`CRON_SECRET` pattern as the existing sync job. Per org: the P&L block reuses `integration_status.last_reconciliation` (the exact, already-verified numbers the app shows) rather than re-implementing the driver forecast a second time in a second runtime; a "lines to watch" block flags the biggest booked-so-far-vs-pro-rated-budget deviations via plain SQL aggregation (deliberately NOT the client's full-year forecast, and labeled as such in the email copy, so it never claims to be the Signals panel); bank balance included when the org is cash-flow-connected. Orgs with nothing to report (no reconciliation and no budgeted lines) are skipped — never spam an empty org. Recipients are every org member's email via the Auth admin API. Sent via Resend (free tier, `fetch`-only, no SDK — matches fortnox-sync's zero-dependency style); `RESEND_API_KEY` set as a Supabase secret. **Verified live, not just deployed:** manually triggered the cron endpoint — real digest emails sent successfully to both real orgs ("sent to 1" each), and a genuinely empty test org already in the DB was correctly auto-skipped ("nothing to report"), confirming that guard works against real data, not just in theory.
- [x] `[B]` **Data-freshness badge** *(steal: Fathom — done 2026-07-10)* — every page's sidebar now shows a freshness badge for Fortnox-connected orgs: green "Synced Xh ago" under 48h, amber "Data N days old" past that, red "Sync failing — check Monthly" on a sync error (full error text in the tooltip; amber/red link to Monthly where the sync button lives). Unconnected (manual/CSV) orgs get no badge — no nagging. `loadData()` tolerantly reads `integration_status` into a `SYNC_STATUS` global; preview mocks a healthy 3h-old sync so the demo shows the trust signal. Verified all three states via preview screenshots by temporarily mutating the mock (3h → green, 75h → "Data 3 days old" amber, error → red), then reverted; desktop and collapsed-sidebar layouts checked.
- [x] `[B]` **Month-end review ritual** *(steal: Abacum — done 2026-07-10)* — turned the existing Signals panel from a static variance list into a checkable close checklist. New table `signal_reviews` (`org_id, reporting_line_id, month` PK, RLS scoped the standard `is_org_member`/`can_edit_org` way) records a "reviewed" mark per line per `CLOSE_MONTH`; `dbMarkReviewed`/`dbUnmarkReviewed` (data.js) write it with an optimistic local `SIGNAL_REVIEWS` Set (instant checkbox feedback, reverted on write failure) and `renderSignals()` (script.js) renders a small pill button per row ("Mark reviewed"/"Unmark", dimmed once checked). Deliberately reused the existing per-line `note` field instead of building new inline note-editing UI — scope stayed "add a checkable state," not a notes subsystem. Two new positive-reinforcement states replace the old "just hide the panel" behavior: **"✓ All reviewed for [Month]"** once every shown signal is checked, and **"✓ Nothing to flag for [Month]"** when there are zero variance signals at all (previously the panel silently vanished either way — now a closed month always shows *something*, reinforcing the habit even on a quiet month). Guarded against `CLOSE_MONTH < 1` (a not-yet-closed org) so `monthLabel()` never gets called with a nonsensical month. Verified: hand-confirmed the demo fixture's two flagged lines (R&D over, IT under, matching the existing hand-derived FY variance numbers), screenshotted the mixed state (one reviewed/one not), the all-reviewed success banner (temporarily marked both, screenshotted, reverted), dark/light, and Swedish (button labels "Markera granskad"/"Avmarkera" fit without wrapping) — all matched. All 34 engine tests still green after the data.js changes. `signal_reviews` mirrored into schema.sql. Not yet checked against a real (non-preview) org's actual review state — added to TESTING.md.
- [x] `[B]` **Scenario trajectories** *(steal: Causal — done 2026-07-10)* — a saved scenario used to store one FY total, hiding *when* two plans diverge (a hiring freeze from month 9 and a mid-year price cut can land on the same annual delta but tell very different stories). `dbSaveScenario()` now also freezes a 12-month `companyMonthAmount()` snapshot (`snapshot.monthly`, alongside the existing per-line `breakdown`) at save time — frozen like the FY total, so it doesn't retroactively shift if `CLOSE_MONTH` advances or drivers change later. New chart in the Scenarios panel (`renderScenarioChart()`, reuses the same Chart.js already loaded for the Overview trend chart — no new dependency) plots the live current-plan trajectory (solid) against every saved scenario (dashed, cycled through a small fixed palette so scenario lines never collide with the trend chart's own budget/actual/forecast colors); hidden entirely when no scenario has a monthly snapshot (older scenarios saved before this change tolerantly fall back to not being plotted, never crash). Demo fixtures got hand-crafted (not engine-derived, documented as such in a code comment) monthly arrays for "Base" and "Hiring freeze" that track identically through month 8 then diverge for months 9-12 — exactly where the preview data's September hire + one-off sits — so the demo chart visibly demonstrates the feature's whole point without needing real data; verified both arrays sum to their existing FY totals (41,800,000 / 39,500,000) via a standalone calculation before committing them. **Bug found and fixed during verification, unrelated to scenarios specifically but exposed by testing this feature's empty state:** `[hidden]` (used app-wide — signals/reforecast/forecast-pnl/fortnox-pnl panels, cash flow's empty state, planning's allocation bridge) was silently losing to any author CSS rule of equal specificity that sets its own `display` value (`.panel{display:flex}` etc.) per the CSS cascade's origin-then-specificity ordering — confirmed with an isolated minimal repro (a `<div class="panel" hidden>` stayed visible; a plain `<div hidden>` correctly disappeared) before touching the real app. Fixed with a single global `[hidden]{display:none!important}` rule in style.css rather than patching each panel individually. Re-screenshotted all 5 pages (Overview, Monthly, Planning, Cash Flow, Assumptions) after the fix to confirm no visual regression, and specifically confirmed the scenario chart wrapper now truly disappears with 0 saved scenarios (previously showed an empty heading + blank chart box). All 34 engine tests still green. Not yet checked against a real org with 3+ scenarios (layout was only verified with 2 lines) — noted in TESTING.md.

**Product gaps (not features — table-stakes for a real client)**
- [x] `[B]` **User invite flow** *(done 2026-07-10)* — new "Team" block on Assumptions (visible to any member; invite/remove/role controls owner-only). Backed by a new edge function `org-members` (list/invite/set_role/remove), never a direct client write to `memberships` — same reasoning as `create_organization()`: a client with a direct write path could add itself to any org it knows the id of, or demote/remove someone else's owner. Every action re-checks authorization against the caller's own JWT (`is_org_member` for read, a new `is_org_owner` SQL helper — stricter than `can_edit_org` — for every write), never trusting a client-supplied role/org_id. Inviting a brand-new email uses Supabase's `inviteUserByEmail` (creates the account + sends a signup-link email via Supabase's own Auth email system, not Resend — that's reserved for the digest); inviting an already-registered email adds the membership directly instead of failing. Guards against removing/demoting the last owner. **Known gap, documented rather than hidden:** Supabase's built-in Auth email has a low default rate limit on the free tier — fine at today's scale (one real user), but real multi-person client onboarding would want custom SMTP configured in Supabase's Auth settings (can reuse Resend there too) — noted in TESTING.md, not yet needed. Verified: the auth gate (401/400 on bad requests) tested live against the deployed function; the full owner-view UI (role selects, remove buttons, invite form) screenshot-verified via a `#teamtest` dev hook since I have no real login to click-test the authenticated path myself — that live click-through (invite a real email, accept it, confirm the new member appears) is the one thing left for TESTING.md.
- [x] `[B]` **Full data export** *(done 2026-07-10)* — new "Your Data" block at the bottom of Assumptions: one click downloads everything the org stores as a single JSON file — all 17 tenant tables (drivers, actuals, plans, scenarios, versions, sync config, cash/invoice/tax data) queried fresh from the DB (RLS-scoped), each tolerantly so one missing table can't sink the export. Deliberately excluded and documented in-file: `integrations`/`oauth_states` (OAuth secrets — unreadable client-side by design). GDPR portability + the "can I get my data out?" trust answer; pairs with the DPA. Verified: all 17 table names checked against the live DB via CLI (exact match), UI screenshot-verified; the real click-through download is in TESTING.md (needs a live session).
- [x] `[B]` **Swedish localization** *(done 2026-07-10)* — Fortnox users are Swedish-speaking SMEs; the UI was English-only. Built a real bilingual system, not a fragile "translate the rendered DOM" overlay — pattern-matching text nodes would risk scrambling dynamically-assembled financial sentences (wrong signs, wrong numbers), worse than staying English. New `i18n.js`: `t(key, ...args)` against a `STRINGS.en`/`STRINGS.sv` dictionary (plain strings, or functions for anything with an interpolated value — keeps translated sentences explicit instead of assembled from fragments, which reads wrong in Swedish word order); static HTML carries `data-i18n`/`data-i18n-html`/`data-i18n-placeholder` attributes, translated once via `translateStaticHtml()` (also sets `<html lang>` for accessibility). English stays the default (zero disruption to existing dev/test screenshots); Swedish via the new sidebar toggle or `?lang=sv`, same convention as `?theme=light`. Every render call site across every page was touched explicitly — sidebar, login, Overview, Monthly, Planning, Cash Flow, Assumptions (incl. the Team panel and revenue plan), and the Fortnox integration panel (`fortnox.js`, shared by Monthly and Overview). Deliberate scope boundary: demo/preset **data values** (reporting-line names, role names, invoice counterparty names, scenario names) stay as-is — they're starter content the user renames, not UI chrome; the one exception is the demo variance-note (explanatory prose shown live in a sales demo), which is translated. Marketing landing page (`index.html`, discovered mid-sweep — a separate, already-built asset with real screenshots) is explicitly **out of scope**; it's the still-open "Landing page + demo script" item below, not app UI. Three real bugs caught by screenshot verification before shipping: (1) `translateStaticHtml()` was called before the `const STRINGS` it depends on — a temporal-dead-zone `ReferenceError` that silently aborted the whole `i18n.js` parse, cascading into every downstream `t()` call; (2) four separate local variables named `t` (`const t = companyFySummary()` in script.js/monthly.js, a `for (const t of EXPORT_TABLES)` loop in data.js) shadowed the global `t()` translation function within their own scope — grepped the whole codebase for the pattern and fixed every instance; (3) `tests.html` didn't load `i18n.js`, so the new `t()` calls inside `data.js`'s top-level `BUSINESS_PRESETS` would have broken the entire engine test suite — caught before it shipped, not after. Verified: every page screenshotted in both languages (including a full-height pass), all 34 engine tests still green, English mode confirmed byte-for-byte unchanged from pre-localization screenshots (no regression) at every checkpoint.
- [x] `[B]` **One-click "import all" Fortnox onboarding** *(done 2026-07-10)* — the mapping editor now shows an "Import all N as reporting lines" button per section (cost centres + projects) whenever ≥2 codes are unmapped; one click imports and maps every remaining code, then prompts a re-sync. Connect → import all → sync = populated app in ~3 clicks. Implementation reuses the already-live-verified single-import write path (refactored into `importOneQuiet()`, one code path not two) in a loop; per-item failures toast individually and the summary reports "N of M". Verified via a new `#maptest` dev hook (renders the mapping editor with a mixed mapped/unmapped fixture in demo mode) — button appears with the correct count, mapped rows excluded. Honest gap: a real end-to-end batch import needs a live org with unmapped codes, and the sandbox is 100% mapped — the batch is a thin loop over a proven path, so risk is low, but it's noted rather than claimed.
- [x] `[B]` **Automated test suite for `data.js`** *(done 2026-07-10)* — `tests.html`: 34 assertions, no framework, no Node — loads the real lib.js + data.js with a stubbed Supabase client and runs against the preview fixtures; headless-runnable with a greppable `ALL PASS` verdict (command in CLAUDE.md, to be run after any data.js change). Covers: loaded role rates, driver forecasts (incl. mid-year hire + one-off months), the actuals-only boundary (closed month = actual, override wins + flagged), FY composition, the revenue plan (trough month, annual repeat into FY2027, flat/all-zero fallbacks), all Skatteverket due-date rules (incl. the Jan-17 year-rollover and quarterly-August-17 edge cases), the full cash-flow walk pinned to a fixed month (exact Jul row, Dec balance, runway null), a zero-revenue runway crossing (=3 months, hand-walked), allocation conservation (shared-line allocation can't create or destroy money), CSV import parsing, and escapeHtml. Every expected value was hand-derived before asserting — none copied from the implementation's output. `cashFlowProjection` gained an injectable `fromIdx` (default unchanged) so tests don't rot as real time passes. Green on first run.
- [x] `[B]` **Landing page rewrite + localization** *(done 2026-07-10)* — the page (already built, real screenshots) pitched "driver-based forecasting" but never said the thing that actually matters for Decision Systems Lab positioning: this isn't a dashboard, it's a closed loop. Added a new prominent section between the problem framing and the mechanics ("Drivers, not cells" / Fortnox) — kicker "The loop", h2 "Not a dashboard. A decision system.", a 4-step numbered list (data flows in nightly → deviation flagged → fix suggested → one click updates the plan, reversible) paired with a genuine cropped screenshot of the Signals + Re-forecast panels (`assets/screen-loop.png`, cropped from a real preview render, not staged) — every claim in those 4 steps is a real, already-shipped mechanism (nightly cron sync, Signals + month-end review, Re-forecast suggestion, Apply/Revert), not aspirational copy. Localized the whole page: loads `i18n.js` standalone (it has no lib.js/data.js dependency, confirmed self-contained), every string converted to `data-i18n`/`data-i18n-html`, plus a new `data-i18n-alt` handler added to `translateStaticHtml()` for screenshot alt text (small, symmetric addition to the existing pattern) — full Swedish translation of all ~70 landing-page strings, a nav language toggle added (reuses the existing `lang_toggle` key). Also fixed a real mobile-nav overflow bug found while testing narrow widths (nested flex-wrap wasn't reliably shrinking the 4-item nav-links row; replaced with a guaranteed-correct column-stack at ≤640px) — though note the headless Chrome screenshot tool used for verification has its own ~500px viewport floor that silently *crops* (not scales) screenshots requested narrower than that, which initially looked like additional overflow bugs and cost real time to correctly diagnose as a tooling artifact (confirmed via `window.innerWidth`/`body.scrollWidth` — no actual overflow) rather than a second real bug; worth remembering for any future sub-500px screenshot verification. Verified: full page + all sections screenshotted in English and Swedish (no truncation, no wrapping issues even with longer Swedish strings), 650px and 750px widths confirmed clean, 34 engine tests still green. Not yet viewed in a real mobile browser (only headless-Chrome-verified) — worth Felix's own phone glance once.

**Explicitly NOT now** (still correct calls): React/Svelte migration (vanilla is creaking but holding — a client sees nothing for it), multi-currency, approval workflows, complex allocation.

### Phase 7 — Make it feel like a product (pre-customer polish, planned 2026-07-10)
Felix's verdict opening the app fresh: confusing, too much everywhere, unsure about the color, and — the
most important signal — he doesn't yet feel he could use it to the fullest himself. Diagnosis (honest):
the problem is NOT the blue. It's (a) **density/information architecture** — Overview stacks ~11 sections
with equal visual weight, so nothing is the headline; (b) **dark-by-default** — every praised SME finance
tool (Runway, Causal, Fathom, Abacum) is light-first with one restrained accent; dark-first reads
"developer tool", not "finance tool your accountant would trust"; (c) **jargon** — "FP&A", "drivers",
"reporting lines" assume a finance-team reader; the buyer is an SME owner/controller. Method: **copy, don't
invent** — same rule we already use for features, now applied to UI. Order matters: teardown BEFORE any
repaint, so we never restyle twice.

- [x] `[B]` **1. Competitor UI teardown** *(done 2026-07-10)* — see **`TEARDOWN.md`**: 12 convention IDs
  (C1–C12) with quoted evidence per product, plus a "what we do NOT copy" list. Researched Runway (incl.
  design tokens pulled from their live CSS — brand is warm amber `#f9a600` on warm paper neutrals, NOT
  blue; one grotesque sans, no serif in-app), Fathom ("No noise. Just signal. Every number is traceable"
  — the density principle; light + green; SMB/accountant buyer), Abacum (G2 4.8/5 — "non-finance
  stakeholders explore without hand-holding"; concierge onboarding is the market norm), Causal (scenario
  side-by-side praise; standalone product confirmed dead — causal.app 301s to Lucanet), and Fortnox
  itself (buyer's daily comfort zone: light, green `#00db33`, plain Swedish). Headline answers to Felix's
  questions: every product studied is **light-first** (dark-by-default was our real color problem, not
  the blue — accent stays blue-family per C3, desaturated); density fix is C6 (one screen = one question,
  hero variance number + one chart + "this month" action block, rest demoted). Verification note: quotes
  are from marketing/review sites fetched 2026-07-10, not hands-on product use — conventions are
  triangulated across 5 sources rather than single-sourced to compensate.
- [x] `[B]` **2. Information architecture restructure** *(done 2026-07-10)* — Overview went from ~11
  equal-weight stacked sections to a ranked page (per C6): **hero card** answering the page's question
  as a verdict ("On plan ✓" / "Over budget" — green/red words, not just a signed number; the tiny-variance
  amber from varianceClass deliberately NOT used for the verdict since amber reads as a warning, per C4)
  with the projected-FY-result line folded in as a subline (its standalone panel deleted); **3 compact
  supporting stats**; **one "This month" block** merging Signals + review ritual + Re-forecast (the loop,
  front and center per C6, hidden only when neither has content); the chart; the reporting-lines table;
  and **four `<details>` collapsed sections** (Actuals P&L, Budget version, Cost by Role, Scenarios) —
  native disclosure elements, no JS state, styled as panels with carets. Collapsed ≠ hidden information:
  the budget-version drift/✓ verdict renders inside the closed summary. Scenario trajectory chart guards
  against zero-size canvas inside a closed details and re-renders on first expand (toggle listener);
  print opens all details before rendering and restores after (a board pack shouldn't have hidden
  content). C9: sidebar brand tag "FP&A Planning" → "Budget & Forecast" (jargon; sv was already plain);
  C8: Overview subtitle is now the question itself ("Are we on plan? …" / "Ligger vi enligt plan? …").
  Two real bugs caught by screenshot: `.stats-compact` lost to the base `.stats-row` 4-col rule on
  source order (equal specificity — fixed by compounding the selector), and the on-plan verdict rendered
  amber. New `?preview&lens=rolling` dev hook added (headless can't click the lens toggle). **Verified:**
  dark/light/Swedish/empty-org/rolling/expanded-details all screenshotted; rolling-lens numbers
  hand-computed from the fixtures (39,1 mkr total = 19 967 436 + 6×3 185 790; avg 3,3; 6 months w/o
  budget) and matched exactly; 34 engine tests green; zero data.js changes. NOT verified hands-on: the
  print-opens-details path (code-reviewed only — in TESTING.md).
- [x] `[B]` **3. Visual reskin** *(done 2026-07-10)* — light is now the default theme app-wide (dark
  survives as an explicit toggle, one `applyTheme()` fallback flipped in sidebar.js + `getTheme()`'s
  fallback for consistency); the landing page needed no JS change at all since it reuses `style.css`'s
  `:root` and picked up light automatically. New palette per C2/C3/C4: warm paper `--bg` (`#f7f4ef`) +
  white `--panel` (not pure-white-on-pure-white — a two-surface system, cards visibly lifted off the
  page), warm near-black `--text` (`#2a2521`, never pure black), desaturated slate-blue `--accent`
  (`#3f6690`, chosen at ~the same luminance as the old `#3461a8` specifically to avoid regressing the
  pre-existing `color:#0e141f`-on-accent button contrast, which is hardcoded and unowned by this pass),
  and muted semantic colors (`--green`/`--amber`/`--red`) — an over-budget line reads as information, not
  a siren. Dark theme's own values are untouched, just moved from being `:root` to an explicit
  `html[data-theme="dark"]` override. C5: all 11 in-app `font-family: 'Fraunces', serif` declarations
  swapped to `'Inter', sans-serif` (weight already 700 on every one, so hierarchy didn't need
  rebalancing); Fraunces now renders only on the landing page hero, which keeps its own personality on
  purpose. **Screenshot assets regenerated**, not just left stale: `screen-overview.png`,
  `screen-assumptions.png`, `screen-fortnox.png`, `screen-loop.png` all re-shot against the live
  light-themed, post-restructure app and re-cropped to their original dimensions (demo-mode toast
  excluded from each crop) — the landing page's embedded screenshots now match what a visitor actually
  sees pixel-for-pixel, not a stale dark/old-IA copy. **Verified:** Overview/Monthly/Planning/Cash
  Flow/Assumptions/login/landing screenshotted in the new light default, Overview re-checked in dark to
  confirm the toggle still works, Swedish re-checked for text-color legibility, 34 engine tests green
  (zero data.js touched), shadowing grep clean. NOT checked: a real accessibility contrast-ratio audit
  (eyeballed via screenshots only) — reasonable given the accent was deliberately kept at the old
  luminance, but a formal WCAG pass is cheap and worth doing before a real client demo.
- [x] `[B]` **3b. UI round 2 — real teardown + density/sectioning purge** *(done 2026-07-11)* — Felix
  opened the live app and (rightly) said it was confusing, text-heavy, and things "blended" — and
  questioned whether we'd actually copied the praised tools. Honest answer: round 1's TEARDOWN was
  principle-level (marketing sites + reviews), not layout-level. Round 2 fixed that: pulled the **actual
  product screenshots** (Runway's Exec Dashboard / variance table / month-end view, Fathom's dashboards)
  as image files and studied them directly — findings are TEARDOWN **C13–C18**, highest confidence in the
  doc. Dominant lesson **C13**: the praised tools SHOW, never EXPLAIN — *zero* instructional prose in
  their UIs; ours embedded a manual inline, the #1 "busy/amateur" driver. Executed the safe, high-value
  cuts across all 4 content pages: **Monthly** — orphaned Export/Import buttons became a grouped toolbar
  in a titled "Month by month" card (C18), legend → one caption line; **Planning** (the worst wall) —
  cut the intro paragraph, the redundant per-card "actuals booked through" note (the sidebar already
  shows it), and the verbose recurring-costs explanation, keeping the two non-obvious facts (negative =
  leaver, pay rates on Assumptions) as one line; **Cash Flow** — the 8-line methodology essay → a
  one-line honesty caption + a "How this is calculated" disclosure (caveat survives per sacred rule #6,
  page stops walling); **Assumptions** (a settings page — more guidance is legitimately OK) — conservatively
  trimmed only the two essay-length hints. New reusable `.panel-head`/`.panel-actions`/`.panel-legend`/
  `.btn-secondary`/`.calc-details` + `data-i18n-title`/`data-i18n-alt` handlers. **Verified:** every page
  screenshotted light + dark + Swedish, 34 tests green throughout, shadowing grep clean, zero engine
  changes. **Deliberately HELD for Felix's input** (working unsupervised, model swapped): C16 (collapse
  variance to one indicator — changes a number he reads daily) and C15 (sparklines in stat tiles — more
  effort, cosmetic). Those are the taste/habit calls that need a human, not more autonomous edits.
- [x] `[B]` **3c. Per-line revenue + the "who's the customer" model question** *(done 2026-07-11)* —
  Felix (rightly) asked whether you can only plan on cost-centres and what about projects/revenue. Dug
  into how the real tools structure planning (Jirav/Fathom = one primary dimension + slice actuals by
  tracking category; Causal = full matrix, praised-but-complexity-warned). Conclusion: our model IS the
  proven SMB pattern (Jirav-style); the gap was per-line revenue. Built it (**Tier 1**, the proportionate
  profit-centre pattern, NOT the enterprise matrix): `reporting_lines.revenue_plan`, engine
  (`lineRevenue*`/`lineMargin`, org revenue prefers per-line sum when any line earns, else falls back —
  fully backward-compatible), 10 hand-derived tests (44 total, green), Planning UI (quiet "+ Add revenue"
  → margin), and it flows to Overview/Cash Flow for free via the engine. A line named after a project +
  its Fortnox project-code mapped (already worked) + per-line revenue = **per-project P&L, margin, and
  variance**. The full department×project matrix stays deferred (Tier 2, YAGNI for SMEs, fights the
  simplicity goal). Plus IA fixes from Felix's session: the persistent "how this works" → an on-demand
  **? button** (SAC-style); and actuals-loading (Fortnox connect + CSV import) moved off Monthly to a new
  **"Data"** nav page (Monthly is now purely the grid). **OPEN for Felix:** should the Overview *reorient*
  around per-project margins for a genuinely project-based org (vs just showing margin on Planning)? —
  a real "who's the customer" call, not built speculatively.
- [x] `[B]` **4a. First-run experience** *(done 2026-07-10 — demo script deferred, Felix's call)* —
  the empty-org screen (`emptyOrgHtml()`, shared by Overview/Monthly) offered two paths: a preset or
  manual entry. Neither was "connect Fortnox," even though that's the fastest route to a real number for
  our actual buyer (a Fortnox SME) and the app already has a fully-built one-click import flow for it —
  per C11, connect-the-ledger comes first, ahead of both the demo-quality preset and manual entry.
  Restructured into three explicitly ranked options: **Connect Fortnox** (featured — warm-tinted card,
  reuses the exact same `renderIntegrationPanel()`/OAuth flow already shipped and verified on Monthly,
  zero new backend code), then the preset grid, then manual steps — each under a plain-language kicker
  instead of one undifferentiated block. **Bug found and fixed during verification:** demo mode
  (`?preview`) always rendered the Fortnox panel as already-connected with fake P&L data, which on an
  *empty* org (only reachable via the `?preview&empty` dev hook, but that's also how I screenshot-verify
  this exact screen) is a visible contradiction — fixed by showing the real not-connected state instead
  when `COST_CENTERS.length === 0`; that in turn exposed a second bug — the connect button in that
  branch had no click handler at all (dead button, no feedback) — fixed with a toast, matching the
  existing demo-blocked-action convention used elsewhere (`toast_signin_*`). **Verified:** engine tests
  green, screenshotted in English/Swedish/light/dark, confirmed the normal (non-empty) demo Overview is
  pixel-identical to before this change — this only touches the zero-data first-run path.
- [ ] `[B]` **4b. Demo script** *(deferred — "probably later" per Felix 2026-07-10)* — a written outline
  for a live screen-share call (not a recording) walking a prospect through login → the Overview verdict
  → the loop → Assumptions. Pick back up whenever real customer conversations are close.
- [ ] `[F]` **5. Dress rehearsal — the exit criterion** — Felix runs the full TESTING.md backlog, closes a
  real month on real data solo, and performs the demo script end-to-end without notes. Every stumble gets
  fixed same-day. **When the rehearsal passes, product prep is DONE and customer conversations start** —
  "the UI feels perfect" is explicitly NOT the bar, because taste has no finish line and this becomes
  avoidance. The product is already functionally ahead of what any SME expects from a first meeting.

### Phase 8 — Planning platform: versioning spine + the ways of planning (backlog set 2026-07-11)

**Context / strategy.** Felix opened the app fresh and surfaced ~27 issues (the raw list + the
critique thread are in the chat transcript). Two decisions frame this phase: (1) **build broad,
segment-agnostic** — we support multiple ways of planning/viewing, but each org only ever *sees*
its own model ("**breadth in the engine, narrowness in each org's UI**" — this is what lets us be
powerful without recreating the "too much everywhere" problem); (2) **build before any customer**
— Felix will create manufacturer / consultancy / agency test orgs and test every mode himself.

Two honest caveats recorded up front:
- **Felix's own testing validates correctness, not product-market fit.** Synthetic orgs confirm the
  machine runs; they don't confirm the workflow is what a real services firm wants. Mitigation:
  use **his dad's real web-dev firm** (real Fortnox books, real projects, a real services business)
  as the first real-data test, not only synthetic orgs.
- **Segment doesn't gate capability, only sequencing.** With broad primitives + config, we don't need
  to pick a segment to start. Profile only re-orders the *final polish* and the *default preset*.

**Competitor grounding** (researched 2026-07-11): scenario/budget model from Runway
(docs.runway.com/guides/modeling/bva + "a new way to plan scenarios") — Main forecast, scenarios as
editable branches, budget = a *locked* scenario. Cash-flow method confirmed: we already built the
**direct / ~13-week method** (bank + AR/AP by due date + estimated operating/tax), which is the
correct SMB treasury method — the fix is legibility, not method. Professional-services planning
(utilization 70–80%, capacity-constrained headcount, project profitability) is **core, not edge**,
for the likely Gothenburg/Fortnox services segment.

Ordered by build sequence — each tier leans on the one above. `[B]` unless noted.

**Tier 0 — the versioning spine (foundational, first, the genuinely big one)**
- [x] **One versioned driver-plan** *(done 2026-07-12)* — `plan_versions` + `version_id` on all 5
  versioned tables (incl. `version_line_revenue`; org revenue lives on the version), sidebar
  Plan switcher + "+ Scenario" branch + 🔒 Lock as budget (read-only guard on all 13 write paths),
  cross-version engine (`computeVersionSummary`/`VERSION_SUMMARIES`) driving live scenario compare +
  budget drift on Overview; old `scenarios`/`budget_versions` snapshot tables + legacy revenue
  columns dropped (live DB in sync). Full-copy-per-version as decided below.
  Replaces all three of today's half-overlapping notions at once: the typed `annual_budget` number
  (divorced from drivers), the dead-end read-only `scenarios.snapshot`, and the buried
  `budget_versions.snapshot`. Target UX (copy Runway): a **Main** working forecast (rolling R12); a
  **scenario** is a branch you enter, edit ("revenue dips 20%"), and compare to Main; a **budget** is
  a scenario you **lock** (e.g. "Budget 2027") — budget & forecast then independently editable, BvA
  compares locked-budget vs Main+actuals. **[#4, #24(partly), #25]**
  - **Storage decision (verified 2026-07-11):** every driver table (`headcount_lines`, `one_offs`,
    `recurring_costs`, `forecast_overrides`) is scoped only by `org_id`+`reporting_line_id` — no
    version dimension. The spine adds one. **Use full-copy-per-version, NOT Runway's internal
    diff/layer model** — a nullable `scenario_id` on each driver, a scenario = a complete duplicate
    of the drivers. Same user-facing UX (branch/edit/compare/lock), far less merge-logic risk for a
    solo vanilla-JS app; storage cost is trivial at SME scale. "Changes to Main don't auto-propagate
    into an old scenario" is acceptable (usually desirable for a locked budget).
  - **Do this incrementally & test each step** — it's a schema + engine + migration change touching
    the whole model; not a one-sitting job. Hand-derived engine tests per step (the suite exists).

**Tier 1 — org-creation ergonomics (the test harness; can start early, in parallel with Tier 0)**
- [x] **Fast create/switch between org *types*** *(done 2026-07-12)* — presets now exercise the
  planning styles: consultancy's Client Delivery is utilization-driven (billable hours → revenue +
  derived heads, no manual hc), manufacturer's Production is a profit centre (per-line revenue →
  margin). One click from the empty-org screen = a real test org of that style. (The "show only the
  relevant model's UI" gating remains open below.)

**Tier 2 — the ways of planning (the driver primitives → "support all")**
- [x] **Per-line revenue → monthly** *(done 2026-07-12)* — "Monthly" toggle on each revenue line
  expands a 12-cell grid (quarter rows) for milestone/ramp billing; annual box stays the flat-spread
  quick path; "custom" tag flags shaped lines. **[#12]**
- [x] **Utilization / capacity driver** *(done 2026-07-12)* — `utilization_drivers` (versioned, one
  per line): billableHours[12] × billRate → revenue; hours ÷ utilization% ÷ hoursPerHead → required
  heads → cost via the role's loaded rate. Bounded driver, composes with manual drivers (retainer +
  billable on one line), zero-capacity guarded, revenue-only mode (no role), 13 hand-derived tests.
  Planning UI reads back "≈ N heads needed · Revenue X · Cost Y". **[#26 styles 4–5]**
- [x] **Account-level line planning** *(assessed 2026-07-12: already covered)* — a line + labeled
  recurring costs/one-offs IS account-category planning (Ads/Travel/Tools each a named row), and
  Fortnox account ranges map actuals to it. No new primitive built — deliberately. **[#26 style 2]**
- [x] **Surface shared/corporate allocation clearly** *(done 2026-07-12)* — "Overhead (whole
  company)" + "Show with overhead allocated" in plain language; the view toggle is hidden until a
  line is actually marked overhead. **[#14, #15]**
- [x] **Per-org model gating** *(done 2026-07-12 — Phase 8b, from Felix's "build your company"
  feedback)* — `organizations.planning_config` (revenueMode org/lines + billableHours): presets
  pre-answer it at creation, a "How you plan" panel on Assumptions changes it later, and the UI
  shapes itself — org-mode companies see zero revenue/capacity options on Planning; lines-mode orgs
  have no Assumptions revenue panel (ONE revenue home, killing the two-places confusion
  structurally). Config gates affordances only — never the engine, never existing data. Same batch
  (Phase 8b): Forecast/Budget/Scenario vocabulary + grouped switcher + Manage plans with unlock
  behind friction; merged one-table Costs section; note → closable ✎ icon; page-level help-mode
  toggle replacing scattered ? marks; "? How this works" killed.
- [x] **Round-2 feedback batch (Felix 2026-07-12, 6 points → 3 commits 7abd777/6e87f1f/7583db7,
  done 2026-07-13)** —
  (1) Re-forecast rebuilt as a two-state row: silent within 3% of plan, one sentence + one action
  on divergence, "re-forecast at X/mo · Undo" while overridden; source dropdown killed.
  (4) Booked-through select collapses back to the read-out after every pick, manual picks tagged.
  (2/6) "Build your company" wizard at org creation (revenue mode AND cost mode →
  planning_config.headcount; simple-amounts orgs get no People tables / role engine); presets
  collapsed from 4 industry stereotypes (3 were the same shape) to ONE sample per planning shape,
  matched to the org's config.
  (3/5) Budgets are fiscal-year plans: `plan_versions.budget_fy`, draft-from-current-plan →
  lock-when-approved flow (Plans panel + Overview CTA + contextual sidebar lock), and a
  FY-window engine (`FY_WINDOW_START`) so editing Budget 2027 shows Jan 27–Dec 27 everywhere;
  drift measured over the budget's own year. Verified: 65 engine tests (8 new hand-derived
  FY-window assertions), 49 e2e checks, EN+SV screenshots, drift check 160 cols.
  NOT yet verified: the full create→edit→lock→drift cycle against the live DB with a real
  signed-in session (demo mode blocks writes; the data layer reuses copyActiveVersion, which
  Tier 0 verified live) — on Felix's next click-through.

**Tier 3 — progressive disclosure (breadth without clutter)**
- [x] **Contextual `?` pattern (SAC-style)** *(done 2026-07-12)* — shared `helpMark(key)` primitive
  (lib.js) pops a ≤2-sentence one-liner under a small circled ?. Deployed ruthlessly: Planning
  headcount hint, Capacity explainer, Cash Flow method — each replacing an always-on paragraph.
  Extend only where genuinely non-obvious. **[#2, #5, #18]**
- [x] **Hide advanced features** *(done 2026-07-12)* — account ranges + sync exclusions behind an
  "Advanced" disclosure on the Data page; allocation toggle hidden until an overhead line exists.
  **[#20]**

**Tier 4 — IA / placement**
- [x] **Re-forecast → Planning + selectable source** *(done 2026-07-12)* — per-line row inside each
  Planning block (Overview is monitoring-only now); source = recent actuals / monthly budget /
  custom amount. Never automatic, always reversible. **[#3, #24]**
- [x] **Import → auto-link + auto-reflect** *(done 2026-07-12)* — import/link a Fortnox code and a
  sync runs automatically + reload, so the line arrives WITH its actuals; failed sync keeps its
  error and skips the reload. **[#17]**
- [x] **"Actuals booked through" demoted** *(done 2026-07-12)* — one-line read-out ("Actuals through
  Jun 26 · change"); the select appears only while overriding, Auto collapses it back. **[#7]**
- [x] **Revenue-plan placement reconciled** *(done 2026-07-12)* — org plan stays on Assumptions as
  the fallback, but now states its relationship: an amber note appears when any line earns/bills,
  saying the company total comes from the lines and the org plan is ignored. **[#22]**
- [x] **"Your data" → honest GDPR framing** *(done 2026-07-12)* — renamed "Data portability (GDPR)",
  copy says export-only/not-a-backup, points to Monthly's Excel export for real work; export table
  list fixed (retired tables out, plan_versions/version_line_revenue/utilization_drivers/
  signal_reviews in). Stays on Assumptions until a real account-settings page exists. **[#23]**
- [~] **Cash-flow legibility** *(labels done 2026-07-12; walkthrough open)* — a `?` on Projected
  Bank Balance names the method honestly (short-term DIRECT cash forecast, hard vs estimated
  split, not an accounting statement). Still open: the live walkthrough with Felix + a selectable
  horizon if his testing wants it. **[#16]**

**Tier 5 — polish / chrome (ALL done 2026-07-12)**
- [x] Company selector tooltip for truncated names **[#1]**
- [x] Language toggle → segmented EN | SV (active highlighted) **[#8]**
- [x] Killed the "Budget & Forecast" subtitle **[#9, #27]**
- [x] Planning hierarchy — line name is the container (larger + rule), sub-sections are quiet
  uppercase labels **[#10, #11]**
- [x] Variance note → quiet "+ Add note" link + "✓ Saved" feedback on blur **[#13]**
- [x] Fallback wording fixed — ranges are the last resort for ANY unmatched booking, incl.
  unmapped project/cost-centre tags **[#19]**
- [x] Excel-first import: 3-step flow + downloadable template pre-filled with the org's lines
  (sep=; + BOM) **[#21]**
- [x] Plan grids → 3 columns so each row is a quarter (unambiguously 12 months) **[#22]**
- [x] Killed "spread lumpy actuals" **[#6]**

**Quick-wins note:** several Tier 5 items (company-selector, language toggle, subtitle, kill
spread-lumpy) are near-zero cost and make Felix's own testing less annoying — fine to do a small batch
first/in parallel, ahead of the tiers, since they don't depend on anything.

**Model guidance for this phase:** Tier 0 (schema/engine/migration, correctness-critical) and the
utilization driver in Tier 2 want the **strongest model at high effort** (architecture + math where
being wrong is expensive) — Fable/Opus, 1M context helps since it touches many files. Tiers 3–5
(execution against decided design, screenshot- and test-guarded) are fine on **Sonnet** — cheaper,
faster, and the verification loop catches mistakes. Split accordingly.

### Compliance gate — before onboarding a REAL client
- [ ] `[F]` Confirm Fortnox **production** API access (partner agreement if needed)
- [x] `[B]` **Security review write-up** *(done 2026-07-10)* — see **`SECURITY.md`**: the Phase 6
  security-pass findings (RLS audit, XSS fix, credential isolation) plus the read-only posture
  below, written as a client-facing posture doc rather than internal dev notes, organized by
  GDPR-relevant category (tenant isolation, secrets, XSS, read-only integration, retention,
  sub-processors) with what's NOT done stated plainly (no third-party pentest, no live two-account
  cross-tenant test, no formal deletion-timeline commitment). Sub-processor hosting region
  (Supabase, AWS `eu-west-1`/Ireland — EU, no SCCs needed for that transfer) verified live via the
  Supabase CLI rather than assumed.
- [x] `[B]` **Read-only posture — documented + enforced** *(done 2026-07-10)* — re-verified by
  grepping every `fetch()` call touching Fortnox's API across `fortnox.js` and the edge function:
  every data-fetching call is a GET; the only non-GET call is the OAuth token exchange (not a data
  write). Documented honestly in `SECURITY.md` §4 that this is enforced by code discipline, NOT by
  an OAuth scope technically incapable of writing (Fortnox doesn't offer a strictly-read-only scope
  for this data category) — an important distinction for anyone relying on this claim. Added an
  explicit warning comment directly above the fetch calls in `fortnox-sync/index.ts` so a future
  edit can't add a write call without seeing it, and redeployed the function (comment-only change,
  zero behavior difference, deploy confirmed clean).
- [ ] `[F/B]` **DPA** *(drafted 2026-07-10, NOT usable as-is)* — see **`DPA-TEMPLATE.md`**: a
  structural skeleton (parties, processing scope, sub-processors, breach notice, deletion,
  liability) built from `SECURITY.md`'s verified facts, with every placeholder marked and a
  top-of-file banner that this is not legal advice. Deliberately left blank rather than
  confidently filled in: the liability and governing-law clauses (drafting these without a lawyer
  risks a clause that's either toothless or dangerously one-sided, and there's no way to verify
  which from the text alone), the actual breach-notification window and deletion timeline (need
  real numbers Felix can commit to, not plausible-sounding placeholders), and whether data entered
  is named-individual or role-aggregate (changes GDPR scope). **Get this reviewed by an actual
  lawyer before any customer sees it** — this is not a model-capability gap that a stronger model
  closes; no LLM output should be treated as legal advice for a binding contract.
- [x] `[B]` **Cross-tenant isolation — live-verified end-to-end** *(done 2026-07-10)* — went beyond
  the earlier policy-text audit: created a real authenticated no-membership account via the auth API
  (email-confirmed via CLI SQL to get a session past the confirmation gate) and ran an 8-step breach
  attempt against the live production DB — read `organizations`/`reporting_lines`/`monthly_actual`/
  `memberships`/`integrations` (all returned empty) and attempted to insert itself as an org owner,
  inject a reporting line, and forge an `oauth_states` row (all rejected with 42501 RLS violations).
  Test account deleted afterward, created zero data (writes all blocked), production left untouched.
  Result written into `SECURITY.md` §1. This is the strongest form of the isolation guarantee — a
  real hostile session against real data — and it's now done, not deferred.
- [ ] `[F]` **Live UI click-through pass** — every backend mechanism was fault-injection-tested via
  direct DB/SQL access, and the security-critical cross-tenant portion is now fully live-verified
  (item above). What genuinely still needs a human: clicking the real buttons as a logged-in user in
  a browser (does "Apply run-rate" fire the write and re-render, etc.) and judging how the app *feels*
  to use — both of which are the dress rehearsal (Phase 7 step 5), and neither of which an agent can
  stand in for. Low residual risk (same render code screenshot-verified in `?preview`; same write
  functions verified by hand) but it's the last mile before a real client's data is on the line.
