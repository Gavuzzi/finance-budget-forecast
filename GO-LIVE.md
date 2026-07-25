# Go-live runbook

**What this is:** the ordered path from "a customer said yes" to "a real company is
using this on their real books." Written 2026-07-25, while the product was fresh in
mind, precisely so it doesn't have to be reconstructed in a hurry later.

**The plan it serves:** the product is deliberately parked in a finished-enough state.
We market, look for customers, and only do the remaining work when someone actually
says yes. That works — but only if the long-lead items below are started *early*,
because two of them are not in our hands.

---

## 0. The short version

| | Item | Who | Time | Can it be rushed? |
|---|---|---|---|---|
| 🔴 | Fortnox **production** API access | Felix | days–weeks | **No** — external approval |
| 🔴 | DPA reviewed by a lawyer | Felix + lawyer | 1–3 weeks | **No** — external, costs money |
| 🟡 | Domain + email (Resend → Supabase SMTP) | Felix | ~1 hour | Yes |
| 🟡 | Supabase Pro | Felix | 5 min | Yes |
| 🟡 | Terms + privacy pages | Claude + Felix | ~half a day | Yes |
| 🟢 | Move app to the new domain | Claude + Felix | ~1 hour | Yes |
| 🟢 | Pilot dry-run on real books | Felix | 1 session | Yes |

🔴 = start the day a conversation turns serious, before any promise is made.

**The escape hatch worth knowing:** a customer can be fully onboarded **without
Fortnox** using SIE file import (Data → Import a SIE file). Every Swedish accounting
program exports SIE. So if Fortnox production access is slow, it delays the *automatic
nightly sync*, not the customer. Say "monthly file upload now, automatic sync when our
Fortnox partner status completes" — that is honest and keeps the deal moving.

---

## 1. Start immediately when a deal looks real

### 1a. Fortnox production access 🔴
Today the integration runs against a **sandbox** (`FORTNOX_CLIENT_ID = 3HheIYa28iIf`).
Sandbox credentials cannot read a real customer's books. Production access to customer
data requires registering as a Fortnox integration partner and agreeing to their terms;
expect review time and possibly a partner agreement.

- Fortnox Developer Portal → check what production/partner status requires
- The code needs **no change** — only the `FORTNOX_CLIENT_ID` / `FORTNOX_CLIENT_SECRET`
  secrets in Supabase (Edge Functions → Secrets) and the redirect URI registered in
  their portal
- Our read-only posture (we never call a Fortnox write endpoint) is a genuine asset in
  that conversation — see `SECURITY.md` §4

### 1b. DPA / personuppgiftsbiträdesavtal 🔴
`DPA-TEMPLATE.md` is a structural skeleton and is **explicitly not usable as-is** — its
liability, governing-law, breach-window and deletion-timeline clauses are deliberately
blank. A redovisningskonsult or any careful SME will ask for this.

- Get it reviewed by an actual lawyer; budget money and 1–3 weeks
- Bring `SECURITY.md` to that meeting — the factual groundwork (EU hosting in
  `eu-west-1`, RLS tenant isolation, sub-processor list) is already done and verified
- Decide the two numbers a lawyer will ask for: breach-notification window, and
  data-deletion timeline after contract end

---

## 2. Same-day technical work

Do these in order — later steps depend on earlier ones.

### 2a. Supabase Pro (~$25/mo)
The free tier **pauses a project after ~1 week of inactivity**. A paused project means a
customer's app cannot sign in. Upgrade before anyone depends on it. Also gives daily
backups — ask yourself whether you could restore this customer's data tomorrow.

### 2b. Domain
Buy it (Loopia/one.com, ~100 kr/yr). This one purchase serves three purposes: the app's
address, the email sender, and the trust signal for software that handles a company's
books.

### 2c. Email (details and current state in `TESTING.md`)
1. Resend → Domains → add the domain → add the DNS records at the registrar → Verify
2. Resend → SMTP → copy host/port/user/password
3. Supabase → Authentication → SMTP → paste, sender `no-reply@<domain>`
4. Supabase → Authentication → Rate Limits → raise the email cap
5. Change the `from:` in `supabase/functions/send-digest/index.ts` off
   `onboarding@resend.dev`, then
   `supabase functions deploy send-digest --project-ref cgqfiugjsiwlefhguqnc`

### 2d. Move the app to the domain (**four places must agree**)
This is the step most likely to break silently — the OAuth redirect and the auth
callback both hard-depend on the app's URL.

1. GitHub Pages → custom domain → add the CNAME
2. Supabase → Edge Functions → Secrets → `APP_URL` = the new URL
3. Fortnox Developer Portal → registered redirect URI = `<APP_URL>` callback
4. Supabase → Authentication → URL Configuration → Site URL + redirect allowlist

Then re-test **both** flows end to end: a signup confirmation link, and a Fortnox
connect. Neither fails loudly if a URL is stale — they just don't come back.

### 2e. Swap the contact links on the landing page
`index.html` currently points "Contact" and "Book a walkthrough" at a personal
gmail address (two `mailto:` links, plus the same address in `i18n.js` is not used —
only the HTML). Change both to the new domain's address.

### 2f. Terms of service + privacy policy
Needed because sign-up is open to anyone. `SECURITY.md` already contains the factual
content (what we store, where, who processes it); these pages are the customer-facing
wrapper. Ask Claude to draft, then have the same lawyer glance at them while they have
the DPA open.

---

## 3. Before handing over real credentials

- [ ] Work `TESTING.md` top to bottom — it is the list of things only a human with a
      real login can confirm (invite flow, Fortnox connect, open invoices, VAT dates)
- [ ] Do one full close on real books yourself before the customer does: import or sync
      actuals → check the Overview verdict → produce the månadsrapport → read it as if
      you were their bank
- [ ] Confirm you can answer "where does this number come from" for every figure on the
      report. If you can't explain it cold, don't ship it to their board.
- [ ] Decide the support promise: who answers, how fast, and what happens at month-end
      close when a sync breaks. An FP&A tool is judged in the first week of the month.

---

## 4. Known gaps to state plainly, not hide

These are honest limitations as of 2026-07-25. Telling a customer up front costs
nothing; being caught by one costs the relationship.

- **No third-party penetration test.** We ran our own adversarial RLS audit and a live
  cross-tenant attack with a real hostile session (`SECURITY.md` §1) — strong, but not
  an external audit.
- **Open-invoice and VAT/payroll ingestion are structurally verified, not data-verified**
  — the sandbox has no unpaid invoices and no postings on those account ranges. First
  real connection is also the first real test of those two paths.
- **Fortnox is read-only, permanently.** We never write back. If a customer expects
  two-way sync, that is a no.
- **Monthly digest** goes only to the org's members, and only once a domain is verified.
- **No billing.** Invoice manually until Stripe exists — fine for the first few
  customers, and arguably better (you talk to them).
- **Lumpy bookkeeping** (a year booked in a few batches) makes month-by-month variance
  meaningless; the SIE import warns about it, but set expectations if their accountant
  books quarterly.

---

## 5. If it all goes quiet instead

Parking is a legitimate outcome. To restart cleanly in six months, the state of the
world lives in: `ROADMAP.md` (what is built and what is honestly unverified),
`TESTING.md` (what needs a human), `CLAUDE.md` (how the code is organised), the vault's
`Decisions.md` (why things are the way they are), and this file (what "live" requires).
Nothing important is only in someone's head — which was the point of writing it all down.
