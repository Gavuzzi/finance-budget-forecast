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
- **Swedish localization** — UI + finance terms in Swedish for the target market; currently English.

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
- [ ] `[B]` **Cash-flow honesty + runway** *(HANDOFF-fixes Task 2)* — the flagship Cash Flow projection currently walks the balance from open invoices + tax ONLY. It omits salaries/recurring/one-offs (the biggest, most predictable outflow) and revenue, so the line reads far too flat and answers "can I make payroll?" *wrongly*. Feed the existing driver forecast + a revenue estimate in as a separate "estimated" bucket (distinct from hard invoice figures, like tax already is), and add a **"Runway: X months"** stat — *the* SME number, and we have every ingredient. A truth-bug in the headline feature; fix before any demo.

**Revenue → real forecast P&L**
- [ ] `[B]` **Monthly revenue plan** *(HANDOFF-fixes Task 3)* — revenue is one annual number today, so there's no *forecast* P&L, only an actuals one. Add a simple monthly revenue plan (typed 12-month profile, or last-year × growth %), then Overview/Monthly can show a **projected full-year result** (revenue − cost). This is the jump from cost tool to genuine FP&A — the owner's real question is "will we make money this year?", which currently has no forward answer.

**Steal from the winners — retention & trust (the moat for Decision Systems Lab)**
- [ ] `[B]` **Monthly email digest** *(steal: Runway)* — **the priority steal.** Our nightly sync pulls fresh numbers every morning and then does nothing with them; nobody logs into a planning tool daily, so the value is invisible. A scheduled email — "June closed: result 1,2 vs 1,4 plan, IT 22% under, runway 11 months, 2 signals" — turns a tool-you-forget into a service-that-shows-up. Reuses the existing cron machinery pointed at an email provider (Resend free tier). Nobody serves this to small Swedish companies — exactly our gap.
- [ ] `[B]` **Data-freshness badge** *(steal: Fathom)* — sidebar "Synced this morning" label that turns amber when the last sync is stale (>48h) or errored. Finance people don't trust a number until they know how current it is; cheap, high trust-per-line-of-code. (A silently-failed 3-day-old sync is worse than none.)
- [ ] `[B]` **Month-end review ritual** *(steal: Abacum)* — sequence the pieces we already have (Signals flags + per-line notes) into a guided close: "June is closed — here are the 3 lines that look off, write one sentence each, mark reviewed." Turns the tool from something you *have* into a monthly *habit*.
- [ ] `[B]` **Scenario trajectories** *(steal: Causal)* — scenarios store a single FY total today ("Base 41,8 / Hiring-freeze 39,5"); plot them as full month-by-month lines so you see the *shape* of the divergence. Demo-wow more than retention — **later** of the four.

**Product gaps (not features — table-stakes for a real client)**
- [ ] `[B]` **User invite flow** — roles exist in the schema but there's no way to add a teammate; first real client says "my accountant needs access" on day one.
- [ ] `[B]` **Full data export** — Monthly CSV only today; add a one-click full JSON/Excel dump (trust + GDPR data-portability). Pairs with the DPA.
- [ ] `[B]` **Swedish localization** — Fortnox users are Swedish-speaking SMEs; the UI is English. May be the single highest-value *conversion* polish item (was filed "smaller" but it's buyer-facing).
- [ ] `[B]` **One-click "import all" Fortnox onboarding** — today cost-centre codes are imported one at a time; the dream flow is connect → import all → synced app in ~5 min. Onboarding friction is the differentiator ("simplicity is the moat").
- [ ] `[B]` **Automated test suite for `data.js`** — zero tests today on a finance engine; every change re-risks hand-verified math. A small headless suite over the engine (allocation conservation, FY composition, cash projection, runway) locks in the correctness work and lets a cheaper model refactor safely.
- [ ] `[B]` **Landing page + demo script** — for Decision Systems Lab, sell the *loop*, not features: data flows in nightly → deviation detected → fix suggested → one click updates the plan, fully reversible. That's a decision system, not a dashboard.

**Explicitly NOT now** (still correct calls): React/Svelte migration (vanilla is creaking but holding — a client sees nothing for it), multi-currency, approval workflows, complex allocation.

### Compliance gate — before onboarding a REAL client
- [ ] `[F]` Confirm Fortnox **production** API access (partner agreement if needed)
- [ ] `[F/B]` DPA + security review for holding real financial data (GDPR). **DPA** = the GDPR-required processor contract with each client (you process their employees'/company's data on their instruction): scope, sub-processors (Supabase, Fortnox), security measures, breach notice, deletion-on-exit — have a template ready before demoing to a serious prospect ("can you sign a DPA?" is an early buyer question). **Security review** = the Phase 6 security-pass findings (XSS fix, RLS audit, read-only posture) written up as an honest posture doc + data-retention/deletion story, not a paid pentest until a client demands one.
- [ ] `[B]` Read-only posture (token has write scope; we never write) — documented + enforced
- [ ] `[F]` **Live UI click-through pass** — every backend mechanism built this session was fault-injection-tested via direct DB/SQL access (coverage/Unassigned, account ranges, projects, drill-down, budget drift, revenue target, re-forecast apply/revert — all verified correct against real synced data). What's NOT yet done: clicking the real buttons as a logged-in user in a browser. Low risk (same render code already screenshot-verified in `?preview`; same write functions verified by hand) but not zero — do one full pass through Monthly/Overview/Planning/Assumptions before a real client's data is on the line.
