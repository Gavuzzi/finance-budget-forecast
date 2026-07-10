# CLAUDE.md — project guide for finance-budget-forecast

Multi-tenant FP&A web app for Swedish SMEs: driver-based budget/forecast + automatic
Fortnox actuals sync. Vanilla JS + Supabase (Postgres/Auth/RLS/Edge Functions),
static-hosted on GitHub Pages (push to master = deploy).
Live: https://gavuzzi.github.io/finance-budget-forecast/ · Supabase project ref: cgqfiugjsiwlefhguqnc

## File map
- `lib.js` — Supabase client, auth gate, demo mode (`?preview`), toasts
- `i18n.js` — bilingual strings (English/Swedish); see "Localization" below. Loads right after `lib.js`, before `data.js`, on every page
- `data.js` — in-memory model + calculation engine + ALL db reads/writes. UI-agnostic: never put rendering here
- `sidebar.js` — shared nav, theme + language toggles, "actuals booked through" selector
- `script.js` (Overview/app.html), `monthly.js`, `planning.js`, `assumptions.js`, `cashflow.js`, `fortnox.js` — per-page rendering only
- `schema.sql` / `integration-schema.sql` — idempotent DB source of truth (mirror every live DB change here)
- `supabase/functions/fortnox-sync/index.ts` — the sync Edge Function (self-contained, no imports beyond supabase-js)
- `tests.html` — 34-assertion engine test suite (see Tools below); loads `lib.js`+`i18n.js`+`data.js` with a stubbed Supabase client
- `index.html` — the marketing landing page. Separate from the app (no sidebar/data.js), English-only, not yet localized (tracked in ROADMAP)
- `ROADMAP.md` — backlog + honest verification notes · `TESTING.md` — manual checks collected for Felix

## Sacred rules (violating these is a bug even if the code works)
1. **Fortnox is READ-ONLY.** Never call any Fortnox write endpoint, not even to create test data. No exceptions.
2. **Actuals-only.** A closed month shows only booked actuals. Forecast overrides are opt-in, visibly flagged, reversible. A sync never writes forecast values.
3. **Sync replaces wholesale** (delete + insert per org), never blind upserts — corrections/deletions in Fortnox must propagate.
4. **Secrets:** service_role key and DB password must never appear in code, chat, or terminal output. The publishable key in lib.js is fine (RLS protects the data).
5. DB entities are `reporting_lines` / `reporting_line_id` / `reporting_line_mappings` (renamed from cost_centers 2026-07). The JS globals (`COST_CENTERS`, `cc`, `ccId`) and CSS classes keep the old internal names — do NOT rename them.
6. **Estimates stay visually distinct from hard figures** (dim/`mt-forecast` styling + "est." label), never silently blended.
7. Escape every user- or external-origin string interpolated into HTML with `escapeHtml()` (lib.js). Numbers via fmt helpers and monthLabel() are safe.
8. **Every user-visible string goes through `t()`** (i18n.js), never a hardcoded literal — except demo/preset **data values** (reporting-line names, role names, invoice counterparty names, scenario names: starter content the user renames, not UI chrome). New HTML pages must load `i18n.js` right after `lib.js`, before `data.js` — a page that skips it will throw on the first `t()` call. `tests.html` needs it too (data.js's top-level `BUSINESS_PRESETS` calls `t()` at parse time). Never name a local variable `t` — it shadows the global translation function; this has caused real bugs (grep `\bt\s*=` before adding one).

## Tools & workflows
- SQL against the live DB (no password needed):
  `C:\Users\felix\supabase-bin\supabase.exe db query --linked "<sql>"`
- Deploy the Edge Function:
  `C:\Users\felix\supabase-bin\supabase.exe functions deploy fortnox-sync --project-ref cgqfiugjsiwlefhguqnc`
- Trigger a live sync: POST `https://cgqfiugjsiwlefhguqnc.supabase.co/functions/v1/fortnox-sync` with header `x-cron-key: <value>` where the value comes from `select command from cron.job where jobname='fortnox-nightly-sync'` (it's embedded in that command string).
- **Visual verification is required for any UI change**: render the page with demo data via headless Chrome, then Read the PNG and actually inspect it:
  `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox --screenshot=<scratchpad>\x.png --window-size=1500,1400 --virtual-time-budget=6000 "file:///C:/Users/felix/dev/finance-budget-forecast/<page>.html?preview"`
  Append `&theme=light` and re-check when styling changes; append `&lang=sv` (or `#teamtest`/`#maptest` combined with it) and re-check when touching any string, since Swedish text is often longer and can break layouts English never would (e.g. a long unbroken compound word in a narrow stat-card — happened once, fixed by adding a hyphen). Some pages have hash dev-hooks for exact-value checks (`#csvtest`, `#smoothtest`, `#drilltest`, `#alloctest`, `#teamtest`, `#maptest`).
- **Numbers must tie out**: hand-compute the expected values from the preview fixtures (loadPreviewData in data.js) BEFORE looking at the screenshot, then confirm they match exactly.
- **Run the engine tests after ANY change to data.js** (34 assertions over rates, forecasts, the cash walk, Skatteverket due-dates, allocation conservation, CSV parsing, escapeHtml):
  `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox --dump-dom --virtual-time-budget=6000 "file:///C:/Users/felix/dev/finance-budget-forecast/tests.html" | grep -oE "(ALL PASS.*|FAIL.*|✗ [^<]*)"`
  Expect `ALL PASS`. When you add engine features, add tests with hand-derived expected values — never values copied from the implementation's own output.
- DB changes: apply live via the CLI **and** add them idempotently to schema.sql / integration-schema.sql in the same commit.

## Conventions
- Match existing style: vanilla JS, template literals + innerHTML, sv-SE number formatting, `fmtMkr`/`fmtSek`/`fmtMkrSigned` helpers, existing CSS classes before new ones.
- `?preview` (demo mode) must always keep working — it is the sales demo. Any new table needs mock data in `loadPreviewData()`.
- Update `ROADMAP.md` when finishing an item: tick it with an honest verification note, explicitly stating anything NOT verified and why. Collect anything only Felix can do (dashboard clicks, real-data checks) in `TESTING.md` instead of blocking.
- One commit per feature/fix with a detailed message (what + how verified + known gaps), ending with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` line. Push after committing (push = deploy).
