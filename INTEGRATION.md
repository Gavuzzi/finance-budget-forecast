# Fortnox actuals integration — setup

Everything is built. This is the switch-on checklist. **No local tools needed** —
you deploy the functions straight from the Supabase Dashboard in your browser.

## What it does
Connect a Fortnox company once → a server-side job pulls booked vouchers, keeps
operating-expense rows (BAS accounts 5000–7999), groups them by **cost centre ×
month**, maps each Fortnox cost-centre code to one of your cost centers, and
writes them into `monthly_actual`. The "actuals booked through" month advances
itself. No CSV, no re-keying.

## Architecture
```
Browser "Connect Fortnox" → Fortnox consent → redirect w/ code
   Edge fn fortnox-oauth → exchange code (holds SECRET) → store tokens
Browser "Sync now" → Edge fn fortnox-sync → /3/vouchers
   → expense rows × cost centre × month → map → monthly_actual
```
Secrets never touch the browser: tokens live in `integrations` (RLS, no policies =
service-role only). The client reads `integration_status` only.

## Switch-on checklist

**1. Fortnox Developer Portal**
- In your Integration: note the **Client ID** (done — it's in `fortnox.js`) and the **Client Secret**.
- Scopes: `bookkeeping`, `companyinformation`.
- Redirect URI (register this exactly):
  `https://cgqfiugjsiwlefhguqnc.supabase.co/functions/v1/fortnox-oauth`
- Sandbox: book a few verifications **with cost centres** so there's data to pull.

**2. Database** — run `integration-schema.sql` in the SQL Editor. ✅ (already done)

**3. Deploy the two functions — Supabase Dashboard → Edge Functions → "Create a function":**
- Name it **exactly** `fortnox-oauth` → paste all of `supabase/functions/fortnox-oauth/index.ts` → **Deploy** → open its **Settings** tab → turn **OFF "Enforce JWT"** (it's a public redirect target).
- Name it **exactly** `fortnox-sync` → paste all of `supabase/functions/fortnox-sync/index.ts` → **Deploy** → leave "Enforce JWT" **ON**.

**4. Secrets — Dashboard → Edge Functions → Secrets** (add these three; the SUPABASE_* ones are automatic):
- `FORTNOX_CLIENT_ID` = `3HheIYa28iIf`
- `FORTNOX_CLIENT_SECRET` = *(from the portal — paste it HERE only, never in code or chat)*
- `APP_URL` = `https://gavuzzi.github.io/finance-budget-forecast`

**5. Test the loop:** deployed app → Monthly → **Connect Fortnox** → authorize the
sandbox → back to the app → open **Cost-centre mapping**, enter each cost centre's
Fortnox code → **Sync now**. Actuals should land in the grid.
*(Test on the deployed GitHub Pages app — the OAuth redirect goes to APP_URL, not a local file.)*

## Verify against the sandbox (marked `VERIFY` in the code)
Public docs pinned down most of it; confirm these on first real connection:
- OAuth `TOKEN_URL` host (`apps.fortnox.se`), and the authorize host in `fortnox.js`.
- `fortnox-sync`: the `/vouchers` list shape (params `page`/`limit`, whether rows are
  inlined or need the per-voucher GET), pagination (`@TotalPages`).
- `fortnox-oauth`: the company-name path (`/settings/company`).

## Files
- `integration-schema.sql` — tables: `integrations` (secrets), `integration_status`
  (client-safe), `cost_center_mappings`, `oauth_states`.
- `supabase/functions/fortnox-oauth/index.ts` — OAuth callback + token storage (self-contained).
- `supabase/functions/fortnox-sync/index.ts` — the sync job (self-contained).
- `fortnox.js` — Connect button, Sync, status panel, cost-centre mapping UI.
