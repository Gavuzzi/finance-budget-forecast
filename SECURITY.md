# Security & data protection posture

_Last verified: 2026-07-10. This document describes the system as it actually is, checked
against the live database and source code on the date above — not a general statement of
intent. Where something has not been independently verified, that is stated explicitly._

## 1. Multi-tenant data isolation

Every table holding tenant data has Postgres Row-Level Security (RLS) enabled, verified live
against every table in the schema (21 tables at last check): none are RLS-disabled, and none
are RLS-enabled-but-force-bypassable. Every policy is scoped by one of two functions —
`is_org_member(org_id)` for reads, `can_edit_org(org_id)` for writes — evaluated against the
caller's real authenticated identity (`auth.uid()`), not a client-supplied value. In practice:
if a user edits their organization ID in browser devtools to another customer's ID, the
database itself refuses the query — isolation is enforced server-side, not by hiding UI.

Organization creation is not a direct table write; it goes through a `SECURITY DEFINER`
database function (`create_organization()`), which closes the "add myself to a company I don't
belong to" class of bug by construction rather than by policy logic that could be misconfigured.

**Independently verified live (2026-07-10):** a real authenticated account holding no
membership in any organization was used to attempt, against the live production database, to
read every tenant table and to escalate its own privileges. All eight attempts failed as
required:
- reading `organizations`, `reporting_lines`, `monthly_actual`, and `memberships` each returned
  zero rows (the attacker sees nothing, not even the existence of other tenants' data);
- reading `integrations` (the OAuth-token table) returned zero rows, confirming the deny-all
  posture holds against a real authenticated session, not just in theory;
- inserting a `memberships` row to make the attacker an owner of an existing organization (the
  "add myself to any company" escalation) was rejected by the database with a row-level-security
  violation;
- injecting a `reporting_lines` row into another org, and forging an `oauth_states` row to hijack
  an OAuth callback, were both likewise rejected at the database.

The test account was created solely for this check and deleted immediately afterward; it created
no data (every write it attempted was blocked), so removal was clean and the production database
was left in its prior state. This is now a hands-on end-to-end confirmation, not only a
policy-text audit.

## 2. Credential and secret handling

OAuth tokens for a connected accounting system (access token, refresh token) are stored in a
table with RLS enabled and **zero** policies defined — Postgres's default behavior for a table
with RLS on and no policies is to deny all access to every client role. Only server-side Edge
Functions, authenticating with a service-role key that never leaves the server, can read or
write that table. No client-side code path can reach these tokens under any circumstance.

The publishable API key embedded in the client-side application is not a secret — it identifies
the project, not a user — and is safe to expose because every table it can reach is RLS-scoped
as described above. The service-role key and database password are never present in client code,
logs, or version control.

## 3. Cross-site scripting (XSS)

Every place the application renders a value that a user typed or that arrived from the
connected accounting system's API into HTML (names, notes, labels, imported descriptions, error
messages) passes through a single shared HTML-escaping function before insertion. This was
audited and fixed across every rendering file in the codebase, and confirmed by injecting a
script-tag payload into a test field and verifying it rendered as inert text, not executed
markup.

## 4. Read-only integration with the connected accounting system

The application reads a customer's bookkeeping data (Fortnox) to populate actuals — it does not
write anything back. This is verified by inspecting every network call the system makes to the
accounting system's API: **every data-fetching call is an HTTP GET**; the only non-GET call to
the provider is the standard OAuth token exchange/refresh (obtaining or renewing the access
token itself, not a data write).

**Important nuance, stated plainly:** this is enforced by the application's own code, not by an
OAuth permission scope that is technically incapable of writing. The connected provider's
permission model does not offer a strictly read-only scope for this data category — the
guarantee here is architectural discipline (the code simply never issues a write call), verified
by inspection, not a platform-level restriction that would block a future write call from being
introduced by mistake. Anyone reviewing this posture should treat "no write calls exist today,
confirmed by source inspection" as the accurate claim, not "the system is technically incapable
of writing."

## 5. Data retention and deletion

- A customer's data lives in their own isolated rows, scoped by organization ID, enforced by
  the RLS policies described in §1.
- A full data export (all tenant tables, as JSON) is available to any signed-in member of an
  organization at any time, from the Assumptions page.
- **Not yet formalized:** a written data-deletion procedure and timeline for when a customer
  offboards. The mechanism (deleting an organization row cascades to all related tables via
  foreign-key `on delete cascade`) already exists and was verified in the schema; what's missing
  is the customer-facing written commitment (e.g., "data deleted within N days of a deletion
  request") that belongs in the DPA.

## 6. Sub-processors

- **Supabase** — hosts the Postgres database, authentication, and serverless Edge Functions.
  This is the only true sub-processor: customer data is stored and processed here. Hosting
  region verified live via the Supabase CLI on 2026-07-10: **AWS `eu-west-1` (Ireland)** — data
  stays within the EU.
- **The connected accounting system (Fortnox)** — this is not a sub-processor in the traditional
  sense; it is the customer's own accounting system, which they already have a direct
  relationship with. This application is granted read access, at the customer's instruction, to
  pull data the customer already owns and controls in that system.
- **Resend** (if the monthly email digest feature is enabled for a customer) — used only to
  send the digest email itself; the email content is a summary already visible in-app.
- Static application files are served via GitHub Pages; no customer data passes through or is
  stored there — it serves only the application code itself.

## 7. What has not been done

Stated plainly, not buried:
- No third-party penetration test has been performed. The findings above come from an internal
  adversarial review of the RLS policy set and rendering code, not an external audit.
- No formal accessibility (WCAG) contrast audit has been performed on the UI.
- The deletion-timeline commitment in §5 is still an open item (needs a real committed number in
  the DPA, not a mechanism question — the mechanism exists and is verified).

The cross-tenant live-query check formerly listed here as open was completed on 2026-07-10; see
§1.

This document should be revisited and re-verified before being shared with any customer whose
onboarding is imminent, and any claim in it should be spot-checked against the live system
rather than assumed to remain true indefinitely.
