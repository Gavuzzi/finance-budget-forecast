# TEARDOWN.md — competitor UI conventions we copy (Phase 7, researched 2026-07-10)

**The rule:** every Phase 7 design decision must cite a convention ID from this sheet (e.g. "per C3").
If a proposed change can't point at who we're copying, we don't make it. Evidence is quoted; where a
line is my inference rather than direct evidence, it's marked **[inference]**.

> **Update 2026-07-10 (round 2): now grounded in real product screenshots, not just marketing copy.**
> The original C1–C12 below were extracted from marketing sites + reviews (a real limitation Felix
> rightly called out — "did we copy them or is this just how it looks?"). Round 2 pulled the *actual
> product screens* — Runway's Exec Dashboard, variance table, and month-end-close view, and Fathom's
> dashboards — as image files and studied the layouts directly. Findings are **C13–C18** at the bottom
> and are the highest-confidence conventions in this doc. They point at one dominant gap: our app
> explains where theirs show.

Products studied: **Runway** (runway.com — the most design-praised tool in the category),
**Fathom** (fathomhq.com — SMB/accountant reporting, closest to our buyer), **Abacum** (abacum.ai —
mid-market FP&A, 4.8/5 on G2), **Causal** (scenario UX legacy — the standalone product is gone:
causal.app now 301-redirects to Lucanet, absorbed after the 2024 acquisition), plus **Fortnox**
(fortnox.se — not a competitor, but the tool our buyer lives in daily; their visual comfort zone).

---

## Per-product evidence

### Runway
- Product Hunt: *"Super clean and intuitive interface, resembles Notion a bit but even better with
  the visualization for managing finance."* / *"A Finance app's design does not need to go this hard."*
- G2/review sweep: "clean interface, blazing fast, quick time-to-value (weeks vs months)", "easy
  learning curve", "intuitive… particularly for teams transitioning from spreadsheets". Cons at scale:
  performance slowdowns, formula customization limits.
- **Design tokens extracted from their live CSS** (cdn.prod.website-files.com, 2026-07-10):
  - Brand accent: `#f9a600` (warm amber — NOT blue)
  - Neutrals: `#f8f7f5`, `#e3dfd5` (warm paper), text `#493f2f` / `#332a19` / `#261b07` (warm dark browns, never pure black)
  - Semantic UI colors: blue `#6ac9ff`, green `#ade988`, purple `#d5befa`, red `#f0624f` — all soft/muted, no neon
  - Typography: **Interphases Pro Variable** (a grotesque sans) for everything; no serif in the product
- Product structure (from their site): hero metrics, scenario **dropdown** (Base / Series C Hiring /
  Downside — a switcher, not a stacked panel), interactive charts, "human-readable formulas your
  entire team can understand". Onboarding: guided, with experts, data connected in week 1.

### Fathom
- Their own copy — the single best density principle in the category: *"**No noise. Just signal.**
  Every insight is relevant. Every number is traceable."*
- Reviews: "clean… minimal clicks", "straightforward setup and navigation, reduces the learning
  curve", "So many beautiful charts", one customer *"conducted our entire meeting using the Fathom
  dashboard report"*. "Reports in minutes, not hours."
- Light theme, green accent, chart-heavy. Portfolio view shows "up to six metrics in one view".
- Targets SMBs + accountants explicitly (our buyer), auto-connects to the ledger (Xero — their
  Fortnox-equivalent) so "month-end reporting saves a lot of time once templates are built".

### Abacum
- G2 4.8/5 (108 reviews): "interface is clean and intuitive… **non-finance stakeholders can explore
  reports without needing hand-holding**", "easy implementation, supportive onboarding".
  Cons: "steep initial setup curve", weak custom-report flexibility.
- Nav = 4 functional areas (Planning / Reporting / Intelligence / Data). "Expert onboarding and
  support included" — concierge onboarding is the market norm, not a weakness.

### Causal (legacy)
- "Sleek and modern… intuitive and easy to use", praised specifically for **scenario side-by-side
  comparison** — "compare base, upside, and downside cases without duplicating entire spreadsheets".
- Market lesson: the most design-loved indie tool in the space still got absorbed (Lucanet, 2024);
  design alone didn't save it. Distribution + retention loops matter more — which is why our loop
  features (Signals, review ritual, re-forecast) get hero placement, per C6.

### Fortnox (the buyer's daily environment)
- Live CSS: brand green `#00db33`, text `#002517` (near-black green), light surfaces. Friendly,
  rounded, plain-Swedish language throughout.

---

## The convention sheet

**C1 — Light theme is the default.** Every product studied (all 4 competitors + Fortnox) is
light-first. Nobody ships dark-first finance software to SMEs. Dark stays available as a toggle.
*(Evidence: all five sites; strongest signal in the whole teardown.)*

**C2 — Warm neutral surfaces, never pure black text.** Runway's measured palette: warm paper
surfaces (`#f8f7f5`), warm near-black text (`#261b07`). Calm > sterile. **[inference on exact
values: we adapt the temperatures, not the hex codes.]**

**C3 — One restrained accent, used only for actions and active states.** Runway: one amber. Fathom:
one green. Fortnox: one green. Nobody uses their accent as decoration or panel chrome. **Our accent
stays in the blue family** — it's the category trust color, and copying green would read as a
Fortnox clone — but desaturated and used far more sparingly than today. **[decision + inference]**

**C4 — Semantic colors are muted, not neon.** Runway's red is `#f0624f`, green `#ade988` — soft.
Variance/alert colors should read calmly; an over-budget line is information, not an alarm.

**C5 — One sans-serif family for the whole product UI; tabular numerals in tables.** Runway uses one
grotesque sans (Interphases Pro) everywhere, no serif in-app. Our nearest equivalent already loaded:
**Inter**. The Fraunces serif goes away in-app (it reads "editorial portfolio", not "finance tool");
it may survive on the landing page hero for personality. Tables get `font-variant-numeric:
tabular-nums`. **[inference on Fraunces; direct evidence on the one-sans pattern]**

**C6 — One screen answers one question; max ~4–6 headline metrics; everything else is drill-down.**
Fathom: "No noise. Just signal… **Every number is traceable**", "up to six metrics in one view", a
whole board meeting run from ONE dashboard report. Runway: hero metrics + charts, praised as clean.
Applied to us: Overview answers **"am I on plan, and what needs my attention this month?"** — one
hero variance number, one chart, one "this month" action block (Signals + review ritual +
re-forecast = the loop, our differentiator, front and center). Budget version, projected result,
cost-by-role, scenarios: demoted to collapsed sections or their own pages. Current Overview stacks
~11 equal-weight sections — that's the "too much everywhere" feeling, and this is the fix.

**C7 — Scenario switching is a lightweight control, not a stacked panel.** Runway: a dropdown
(Base / Downside / …). Causal: side-by-side comparison praised specifically. We already have the
trajectory chart (Causal steal); the list/save UI should shrink to a compact switcher + chart.

**C8 — 4–6 plain-word nav items.** Abacum: 4 areas. Fathom: 3 pillars. Our 5 pages are the right
count; the words need the jargon pass (C9) and each page needs a one-line answer to "what question
does this page answer?" visible in its header. **[inference on the header line]**

**C9 — Plain language; the buyer is an SME owner, not a CFO.** Runway: "human-readable formulas
your entire team can understand". Abacum's most-praised trait: "non-finance stakeholders can explore
without hand-holding". Fathom targets SMBs/accountants in plain words. Applied: kill "FP&A" as the
in-app brand tag (the buyer doesn't know the acronym — rename candidate is Felix's call), audit
every label a Swedish SME owner wouldn't say out loud ("lens", "drivers", "booked actuals" need
Swedish-first plain equivalents; the sv strings are ahead of the en ones here).

**C10 — Traceability is a feature to keep and surface.** Fathom's "every number is traceable" is a
headline claim. We already have drill-down, the allocation bridge, and the "why" breakdowns — these
stay first-class and get pointed at in the demo script. (Also the Runway cons list — formula
opacity at scale — is the failure mode we avoid by keeping drivers simple and inspectable.)

**C11 — Time-to-value is measured in minutes; connect-the-ledger comes first.** Fathom: auto-connect
Xero, "reports in minutes, not hours". Runway: data connected in week 1 of onboarding. Applied:
first-run = pick a preset OR connect Fortnox → land on a 3-step checklist → first real insight in
one sitting. Concierge onboarding (Felix walking a client through setup) is the market norm at every
tier (Runway, Abacum both do it) — it's a service feature, not an embarrassment.

**C12 — Fast beats fancy.** Runway praised as "blazing fast"; our static vanilla app already is.
No framework migration for looks (confirms the existing "Explicitly NOT now" call). Polish within
the current architecture.

## C13–C18 — from the real product screens (round 2, highest confidence)

**C13 — The UI SHOWS; it does not EXPLAIN. This is the single biggest gap.** Across Runway's Exec
Dashboard, variance table, and month-end view, and Fathom's dashboards, there is **not one sentence
of instructional prose** — no "this is how this works", no "negative count models a leaver", no
paragraph under a panel telling you what the panel does. Labels, numbers, and charts only. Our app,
by contrast, embeds a manual inline: `.table-hint`, `.integ-sub`, the Planning helper paragraphs,
the Cash Flow methodology essay. **Applied:** delete instructional prose wherever the UI is
self-evident; where a genuine caveat must survive (e.g. "estimate, not a hard figure"), make it a
short caption or a hover/info affordance, never a paragraph. A confused first-time user is a
navigation/labelling problem, not a "add more explanatory text" problem.

**C14 — Section headers are UNDERSTATED; the data is the hero.** Fathom's section titles ("Cost of
Sales", "Top 10 Expenses") are small, light-gray, quiet. Runway's are modest bold. Neither uses a
big heavy heading that competes with the numbers. Our `.table-hint`-laden panels with prominent
`h2`s invert this. **Applied:** section titles go quiet (smaller, `--text-dim`, uppercase-tracked or
light weight); the figures get the visual weight.

**C15 — KPI tiles carry a number AND a sparkline, not just a number.** Runway's top strip: ARR /
Cash / Average ACV / Runway, each a tile with the big value top-right and a mini area chart filling
the tile. Ours are label + number only. **Applied [inference on effort]:** add a small inline
sparkline to the Overview supporting-stat tiles where a series exists (trend to date). Nice-to-have,
higher effort — do after the density/sectioning wins land.

**C16 — Variance is ONE colored number, not two stacked encodings.** Runway's variance table shows a
single `5%` (green) or `14%` (red) — that's it. Ours double-encodes: signed `+0,6 mkr` *plus* a
`+2.1%` pill *plus* a background color. **Applied:** collapse to the cleaner single indicator (a
colored signed value, or a colored %, not both-plus-a-pill); keep the absolute figure available but
stop stacking three redundant signals in one cell.

**C17 — Tables are borderless and quiet, with optional in-cell magnitude bars.** Fathom's "Top 10
Expenses" uses a faint in-cell bar to show relative size, subtle row separation, no gridlines, right-
aligned tabular numbers. No heavy borders anywhere. **Applied:** drop heavy table chrome; right-align
+ tabular-nums everywhere (some already done); consider a faint in-cell bar on the reporting-lines
and role-breakdown tables to show magnitude at a glance.

**C18 — A toolbar is a grouped control cluster, never naked buttons floating between blocks.** Every
action in the real screens sits in a header row or a defined control strip. Our Monthly page has
Export/Import buttons orphaned in mid-page whitespace (Felix's specific complaint), and the grid
below them has no header of its own. **Applied:** group page actions into the relevant card's header
or a defined toolbar; every data block gets a titled container.

## What we deliberately do NOT copy
- **Fortnox green** as accent — would read as a Fortnox clone (C3).
- **Enterprise patterns** (Pigment/Anaplan/Lucanet: multi-workspace admin, template locking,
  permission matrices) — Abacum's own con list ("steep initial setup") shows where that road goes.
- **Dark-first anything.**
- **AI-chat-everything** — the current category fashion; none of the praise quotes above mention it,
  and we'd be copying marketing, not UX.

## Mapping to Phase 7 steps
- Step 2 (IA restructure) executes **C6, C7, C8, C9, C10**.
- Step 3 (visual reskin) executes **C1, C2, C3, C4, C5** (+ C12 as a constraint).
- Step 4 (first-run) executes **C11** (+ C9 for its copy).
