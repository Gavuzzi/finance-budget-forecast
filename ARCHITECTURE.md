# FP&A Base — Architecture & Plan

This is the north star for turning the finance demo into a real, reusable, multi-tenant
FP&A base. The strategic logic behind it lives in the Decision Systems Lab notes; this
file is the technical "what we're building and why."

## The one idea everything serves

**The engine is shared code. Each client is configuration + data — never a fork.**
Customizing a client must mean *setting things up*, not editing the codebase. If we ever
find ourselves copying the project to change code for a client, the architecture has failed.

Why this matters: AI collapsed the cost of *building*, but not the cost of *trust,
distribution, and support*. The winnable lane is therefore deep per-client fit delivered
cheaply — which only works if the base is genuinely reusable and clients are config.

## Stack

- **Backend / DB / Auth:** Supabase (Postgres + Auth + Row-Level Security). Real
  multi-tenant data, no separate server to run. (We already have Supabase from the
  consulting demo — but spin up a *fresh* project so RLS is correct from day one.)
- **Frontend:** decision pending (see "Open decisions"). Leaning React + Vite for
  transferability + AI support; SvelteKit is the lighter alternative.
- **Engine:** app code, ported from this demo — drivers → cost → forecast → variance,
  the monthly model, FY + rolling-12 lenses.

## Config vs. code — the split

| CODE (same for everyone) | CONFIG / DATA (per tenant) |
|---|---|
| Planning / calc engine | Organizations (tenants) |
| Period model (months, close, fiscal year) | Cost centers / dimensions |
| Variance + roll-up logic | Roles & rate assumptions (the rate engine inputs) |
| Lenses (FY, rolling 12) | Drivers (headcount lines, one-offs, other costs) |
| Rendering framework | Budget / actuals / forecast data |
| RLS / auth scaffolding | Chart-of-accounts mapping, fiscal settings, currency |

## Data model (v1 — deliberately NOT over-abstracted)

Encode only what we already know works from the demo. Extend when a *real* client needs
it — generalize from real cases, not up front.

- `organizations` — tenants (id, name, fiscal_year_start, close_month, currency)
- `memberships` — user ↔ org, with role (owner / editor / viewer)
- `cost_centers` — org-scoped (id, org_id, name, annual_budget)
- `roles` — org-scoped rate catalog (id, org_id, label, base_salary)
- `assumptions` — org-scoped (org_id, employer_contribution_pct, equipment_monthly, other_overhead_pct)
- `headcount_lines` — (org_id, cost_center_id, role_id, count, start_month, end_month)
- `one_offs` — (org_id, cost_center_id, label, amount, month)
- `monthly_budget` — (org_id, cost_center_id, month, amount)
- `monthly_actual` — (org_id, cost_center_id, month, amount)  ← later fed by ERP import

Every table carries `org_id`. Every row is owned by exactly one tenant.

## Multi-tenancy & security (from day 1)

- **RLS ON for every table.** Policy: a user may read/write a row only if its `org_id`
  is in that user's `memberships`. This is the entire multi-tenant isolation.
- The anon/publishable key is safe in client JS **only because** RLS is enforced. The
  secret key is never used client-side. (This is the thing we deliberately skipped in the
  consulting demo — here it's mandatory and built in first.)

## Build phases

0. **Decide** the frontend stack; spin up a clean Supabase project.
1. **Schema + RLS**, seed one org ("Almgren") from the current fixtures.
2. **Auth + read** from the DB; render the UI *from config*, not from hardcoded fixtures.
3. **Writes → DB** (replace the localStorage layer entirely).
4. **Add-a-client = new org + config rows** — prove config-not-code by standing up a
   second tenant with zero code changes.
5. **Later:** Fortnox import → actuals (the feasibility spike feeds this); scenarios; approvals.

## Principles / guardrails

- Generalize from real cases, not speculation. v1 stays close to what we've validated.
- Don't gold-plate production hardening (scale, advanced security) until a paying client
  justifies it. Learn it; don't pre-build it.
- This base is the **credibility + learning engine** and the asset that makes cheap
  bespoke fit possible — not a finished product to sell as-is.
