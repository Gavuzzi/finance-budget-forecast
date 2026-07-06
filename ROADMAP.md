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

## Source-of-truth model (three kinds of data)

| Data | Owner | In our app |
|---|---|---|
| **Structure** — cost-centres, projects, accounts | **Fortnox** | Load it → auto-create reporting lines + auto-map |
| **Plan** — budget, headcount, rates, drivers | **Our app** | Authored here (Fortnox has no forward plan) |
| **Actuals** — transactions | **Fortnox** | Synced → `monthly_actual` (built) |

Rule of thumb: **pull structure + actuals from Fortnox; own the plan ourselves.**

## Reporting lines (generalize "cost centers")

The app's dimension object is a **reporting line** — today modelled as `cost_centers`, but conceptually it can be fed by any Fortnox dimension. Each line carries:
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

**Explicitly out of scope for now:** balance sheet, group consolidation, approval workflow, alerts.

---

## Risks & what can go wrong

**Correctness & trust — highest stakes (in finance, one wrong number ends the relationship)**
- **Reconciliation/tie-out is unsolved.** Validated on 4 toy vouchers, never a real GL. Our summed actuals *must* tie to Fortnox's own result report per period, or trust dies. → Make a reconciliation check (our total vs Fortnox's report) a first-class feature, in Phase 1.
- **"Truly closed" is inferred, not known.** We set `close_month` = last month with a booking. A partially-booked *current* month then reads as fully closed → understated actuals → fake favourable variance. → Use Fortnox's real locked-period info, or have the user confirm the closed month.
- **Account scope is crude.** We take 5000–7999. Some firms book operating costs in 4xxx (varukostnader/COGS); 8xxx is financial. → Configurable account scope with BAS-aware defaults.
- **Corrections/deletions don't propagate.** Sync is upsert-only; a voucher reversed/deleted in Fortnox leaves stale actuals. → Full-refresh a period (delete + reload), not blind upsert.

**Scale & reliability**
- **N+1 API calls → timeouts + rate limits.** Real companies have thousands of vouchers; the per-voucher GET loop will hit Fortnox rate limits and the Edge Function wall-clock limit, and `MAX_VOUCHERS` silently truncates. Tested on 4. → Incremental sync (only since last), batching, backoff.

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
- [ ] `[F]` **Realistic sandbox** — a full year: dozens of vouchers across BAS 4/5/6/7, several cost-centres, a project or two, a lumpy annual cost, one correction/reversal. *(kills toy-data blindness)*
- [ ] `[B]` **Reconciliation / tie-out** — after a sync, compare our per-period total to Fortnox's own result report; show ✓ matches / ✗ off by X. *(Risk #1 — trust)* — **done when our total = Fortnox's P&L per closed month.**
- [ ] `[B]` **Configurable account scope** — default BAS 5–7; explicit decision on 4xxx (COGS). *(crude-filter miscount)*
- [ ] `[B]` **Incremental + resilient sync** — only since last run; batch + backoff; drop the silent `MAX_VOUCHERS` cap; full pagination. *(Risk #2 — scale/timeout)*
- [ ] `[B]` **Period refresh, not blind upsert** — delete + reload a period so corrections/deletions propagate. *(stale-actuals drift)*
- [ ] `[B]` **Real "closed" month** — stop auto-advancing to "last month with a booking"; use Fortnox's locked-period info, or keep it user-confirmed. *(fake favourable variance)*

**Gate:** foundation ties out → only now build features.

### Decision — Revenue (make this call before Phase 1)
Cost-only tool (honest, simpler) **or** add revenue (BAS 3xxx → revenue + margin per line/project). Shapes everything after, especially the consultancy/project segment.

### Phase 1 — Universal ingestion
- [ ] `[B]` `dimension` (`costcenter|project|account`) + `source` (`fortnox|manual`) + `state` (`planned|linked`) on the model
- [ ] `[B]` Account-range matcher (works even untagged)
- [ ] `[B]` Coverage % + **Unassigned** line — never silently drop
- [ ] `[B]` Currency suffix respects `organizations.currency`
- [ ] `[B]` Store transaction-level detail at sync → enables **drill-to-transaction** *(blind spot #3)*
- [ ] `[B]` Load prior-year actuals as a baseline *(blind spot #5)*

### Phase 2 — Onboarding superpower
- [ ] `[B]` Master-data load (`/3/costcenters`, `/3/projects`) → auto-create + auto-map
- [ ] `[B]` **Link-or-create** reconciliation review for unmapped codes
- [ ] `[B]` **Budget vs forecast as versioned series** — locked/approved budget baseline + living forecast *(blind spot #1)*

### Phase 3 — Breadth
- [ ] `[B]` Project matcher + configurable dimension precedence
- [ ] `[B]` Presets (consultancy / manufacturer / retail / service)
- [ ] `[B]` Revenue (if chosen above) — actuals from class 3 + simple plan + margin view
- [ ] `[B]` Cost forecast methods: recurring (start/end/escalation), % of driver, per-unit, manual profile
- [ ] `[B]` **Re-forecast from actuals** (run-rate / trend) — **manual, opt-in, shown as a suggested delta, per-line, reversible; NEVER auto-overwrites a set forecast on sync** *(blind spot #4)*
- [ ] `[B]` Variance "why" — bridge + commentary + drill-to-transaction UI *(blind spot #3/#5)*
- [ ] `[B]` Rename `cost_centers` → reporting lines (cosmetic, once)

### Phase 4 — Depth & polish
- [ ] `[B]` Simple allocation (corporate unallocated) + before/after views
- [ ] `[B]` Noise filters (voucher series / account exclusions)
- [ ] `[B]` "Spread annual costs" periodization toggle
- [ ] `[B]` Excel export *(blind spot #5)*
- [ ] `[B]` Scheduled auto-sync (Supabase cron) — "always current" *(blind spot #5)*

### Phase 5 — Cash flow (major module · decision pending)
A second forecast lens: **bank-balance projection, not P&L.** Different data
(unpaid customer/supplier invoices + due dates, VAT settlement, salary/tax dates)
and a running-balance view. Potentially *more* valuable to SMEs than the P&L —
"can I make payroll?" — but a big, separate build. *(blind spot #2)*
- [ ] `[F/B]` Decide if in scope
- [ ] `[B]` Pull open invoices + due dates from Fortnox → projected in/outflows
- [ ] `[B]` VAT + payroll/tax payment timing
- [ ] `[B]` Running bank-balance forecast view

### Compliance gate — before onboarding a REAL client
- [ ] `[F]` Confirm Fortnox **production** API access (partner agreement if needed)
- [ ] `[F/B]` DPA + security review for holding real financial data (GDPR)
- [ ] `[B]` Read-only posture (token has write scope; we never write) — documented + enforced
