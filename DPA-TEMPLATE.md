> ⚠️ **DRAFT — NOT LEGAL ADVICE — DO NOT SEND TO A CUSTOMER AS-IS.**
> This is a starting-point skeleton built from standard GDPR processor-agreement structure and
> the technical facts in `SECURITY.md`. It has not been reviewed by a lawyer. Data Processing
> Agreements are binding contracts with real liability attached — have this reviewed by someone
> qualified (a lawyer, or a service like a template-provider with legal backing) before any
> customer signs it. Placeholders are marked `[LIKE THIS]`.

# Data Processing Agreement

Between **[CONTROLLER NAME]** ("Customer", the data controller) and **[YOUR COMPANY NAME]**
("Processor"), entered into as an addendum to the Customer's subscription to [PRODUCT NAME]
(the "Service"), effective as of the date of the Customer's acceptance.

## 1. Subject matter and duration

The Processor processes personal data on behalf of the Customer solely to provide the Service:
budget/forecast planning and the ingestion of accounting actuals from the Customer's connected
accounting system, for as long as the Customer's subscription is active plus any post-termination
retention period stated in §7.

## 2. Nature and purpose of processing

The Processor stores and displays: the Customer's organizational financial data (budgets,
forecasts, headcount plans, cost drivers) and, where the Customer connects their accounting
system, booked accounting actuals read from that system (revenue, cost, and related ledger
data). Personal data within this may include names and salary figures tied to named or
identifiable roles/employees where the Customer has entered them.

## 3. Categories of data subjects

Employees and contractors of the Customer whose names, roles, or compensation data are entered
into the Service by the Customer or its authorized users.

## 4. Categories of personal data

Names, job titles/roles, and compensation figures, to the extent the Customer chooses to enter
identifiable data rather than aggregated role-based figures. [CUSTOMER SHOULD CONFIRM WHETHER
THEY ENTER NAMED INDIVIDUALS OR ROLE-LEVEL AGGREGATES ONLY — THIS MATERIALLY AFFECTS SCOPE.]

## 5. Processor's obligations

The Processor shall:
- process personal data only on the Customer's documented instructions, including regarding
  international transfers, unless required to do otherwise by law;
- ensure persons authorized to process the data are bound by confidentiality;
- implement the technical and organizational security measures described in `SECURITY.md`
  (row-level tenant isolation, encrypted credential storage with zero client-side access,
  XSS-safe rendering, read-only integration with the connected accounting system);
- assist the Customer, insofar as reasonably possible, in responding to data subject rights
  requests (access, rectification, erasure, portability) — in practice, via the in-app data
  export feature and direct data deletion on request;
- notify the Customer without undue delay after becoming aware of a personal data breach
  affecting the Customer's data — target: **[WITHIN N HOURS/DAYS — DECIDE AND STATE A REAL
  NUMBER, THEN BE ABLE TO MEET IT]**;
- at the Customer's choice, delete or return all personal data at the end of the provision of
  services, and delete existing copies, within **[N DAYS — DECIDE A REAL NUMBER]**, except
  where retention is required by law;
- make available to the Customer all information necessary to demonstrate compliance with this
  Agreement, and allow for audits — [DEFINE WHETHER THIS MEANS DOCUMENTATION REVIEW ONLY, OR
  AN ON-SITE/REMOTE AUDIT RIGHT, AND ANY NOTICE PERIOD].

## 6. Sub-processors

The Processor uses the following sub-processor:

| Sub-processor | Role | Location |
|---|---|---|
| Supabase | Database hosting, authentication, serverless compute | EU (AWS `eu-west-1`, Ireland) — verified live via the Supabase CLI on 2026-07-10 |
| Resend (if email digest enabled) | Transactional email delivery | [CONFIRM REGION — NOT YET CHECKED] |

The Customer's own connected accounting system (e.g. Fortnox) is not a sub-processor under this
Agreement — it is a system the Customer independently controls; the Processor accesses it only
at the Customer's instruction via credentials the Customer grants.

The Processor shall not engage a new sub-processor without giving the Customer prior notice and
an opportunity to object. Since the primary sub-processor (Supabase) is EU-hosted, Standard
Contractual Clauses should not be needed for that transfer — **but confirm Resend's region before
relying on this**, and re-verify the Supabase region hasn't changed if this document is reused
for a future customer, since infrastructure can move.

## 7. Data retention and deletion

See `SECURITY.md` §5. [THIS SECTION IS THE LEAST FINISHED PART OF THE WHOLE POSTURE — DECIDE AN
ACTUAL DELETION TIMELINE AND MAKE SURE IT'S TRUE BEFORE PROMISING IT HERE.]

## 8. Liability

[LEAVE THIS TO A LAWYER. Liability allocation in a DPA is exactly the kind of clause where a
reasonable-sounding AI-drafted default can be either toothless or dangerously one-sided, and it's
not possible to tell which from the text alone without real legal judgment.]

## 9. Governing law

[LEAVE THIS TO A LAWYER — almost certainly Swedish law for a Swedish counterparty, but confirm.]

---

**Before this document is usable:**
1. Get it reviewed by a lawyer — a fixed-fee review of a short DPA is not expensive, and this is
   the single highest-leverage place to spend that money before talking to a real client.
2. Fill in every `[BRACKETED]` placeholder with a real, checked answer — several of them (data
   residency, deletion timeline, breach-notification window) are promises you need to actually
   be able to keep, not just plausible-sounding numbers.
3. Confirm the Supabase project's hosting region — this single fact determines whether this DPA
   needs Standard Contractual Clauses attached, which is a real complication worth knowing about
   before a prospect asks.
