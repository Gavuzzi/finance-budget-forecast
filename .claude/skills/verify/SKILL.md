---
name: verify
description: House verification workflow for the finance-budget-forecast app — run before every commit that touches product code. Engine tests, e2e interaction tests, shadowing check, screenshot proof, and the DB-change rules.
---

# Verify — finance-budget-forecast

No-build vanilla JS + Supabase, statically hosted on GitHub Pages (push to
master = live deploy). There is no staging: verification happens BEFORE the
push, with the checks below. Run them from the repo root.

## The checklist (every product-code commit)

**1. Engine tests** — must print `ALL PASS`:

```sh
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox \
  --dump-dom --virtual-time-budget=6000 \
  "file:///C:/Users/felix/dev/finance-budget-forecast/tests.html" | grep -oE "ALL PASS \([0-9]+ tests\)"
```

New engine math ⇒ new tests in `tests.html`, with every expected number
**hand-derived from the preview fixtures before being asserted**. Never bend
an expected value to make a test pass.

**2. E2E interaction tests** (Playwright) — must print `E2E ALL PASS`:

```powershell
node tests/e2e.js
```

Covers clicks/typing/popovers/toggles against `?preview` (demo mode, no DB
writes). New interaction shipped ⇒ new check in `tests/e2e.js`. Behavioral
checks only ("clicking X makes Y appear"), no pixel assertions.

**3. Variable-shadowing grep** — the i18n function is `t()`, so any local
`t = …` silently breaks translations at runtime with no error:

```sh
grep -nE "\bt\s*=[^=]" <changed .js files> | grep -v "://"    # must be empty
```

**4. Screenshot proof for UI changes** — look at the actual pixels:

```sh
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox \
  --screenshot="<scratchpad>/shot.png" --window-size=1400,1000 --virtual-time-budget=6000 \
  "file:///C:/Users/felix/dev/finance-budget-forecast/<page>.html?preview"
```

Useful preview hooks: `?preview` (demo data) · `&empty` (fresh org) ·
`&profit` (profit-centre lines) · `&consulting` (utilization driver) ·
`&revgrid` (shaped monthly revenue) · `&fystart=5` (broken FY) ·
`?theme=dark` / `&lens=rolling` · hashes `#alloctest` `#bridgetest`
`#drilltest` `#csvtest`. Verify BOTH languages when copy changed (segmented
EN|SV toggle in the sidebar).

**5. Data-layer verification** — write paths that demo mode blocks can't be
e2e-tested; verify them against the live DB directly:

```sh
/c/Users/felix/supabase-bin/supabase.exe db query --linked "<sql>"
```

Never verify with data-modifying CTEs that SELECT their own inserts (they
can't see each other); use separate statements, or a `begin; …; rollback;`
transaction for shape-only validation.

## DB rules (non-negotiable)

- Every live DB change is mirrored **idempotently** into `schema.sql` in the
  **same commit** (guard one-time migrations with `information_schema`
  existence checks so re-runs are no-ops).
- RLS on every table: `is_org_member(org_id)` for reads,
  `can_edit_org(org_id)` for writes.
- `version_id` lives ONLY in the DB load/write layer — the engine operates on
  the in-memory model and must never see it.
- Versioned writes must call `assertEditable()` (locked-budget guard); new
  versioned tables must be added to `copyActiveVersion`'s table list AND
  `computeVersionSummary`'s loads AND `EXPORT_TABLES`.

## Security rules (inviolable)

- Fortnox integration is strictly **READ-ONLY** — never any Fortnox write
  endpoint, not even for test data (SECURITY.md §4).
- No service_role/secret keys client-side; DB password never appears anywhere.

## i18n rule

Every user-visible string exists in BOTH `en` and `sv` blocks of `i18n.js` in
the same commit. Deleted features ⇒ delete their keys (both blocks).
