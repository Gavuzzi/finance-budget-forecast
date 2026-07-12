// data.js — in-memory model + engine + formatting.
//
// The data now comes from Supabase (loadData), not hardcoded fixtures. The
// engine functions below are unchanged — they operate on the in-memory
// structures that loadData() populates from the database. This is the
// config-not-code split in action: same engine, tenant data loaded at runtime.
//
// Reads come from loadData(); edits persist through the granular db* write
// helpers below (scoped to the org by RLS).

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Fiscal-year anchor: app month 1 = FY_START_MONTH of FY_START_YEAR. Calendar
// years keep the old Jan-2026 behaviour; broken years (May–Apr etc.) label
// correctly. Set per org in loadData / loadPreviewData.
let FY_START_MONTH = 1;
let FY_START_YEAR = 2026;

function monthLabel(m) {
  const abs = FY_START_MONTH - 1 + (m - 1);         // months since Jan of FY_START_YEAR
  const name = MONTH_NAMES[abs % 12];
  const year = (FY_START_YEAR % 100) + Math.floor(abs / 12);
  return `${name} ${year}`;
}

const TIMELINE_LENGTH = 24; // FY2026 (1-12) + FY2027 (13-24)
const FY_MONTHS = 12;

// Populated by loadData() from the database.
let CLOSE_MONTH = 6;
let CLOSE_MONTH_MANUAL = false; // true = user picked the month; syncs won't touch it
let DISPLAY_UNIT = "mkr"; // "kr" | "tkr" | "mkr" — set per org in loadData/loadPreviewData
let CURRENT_ORG_ID = null;
let USER_ORGS = [];
// Phase 8 versioning spine. PLAN_VERSIONS = this org's plan versions
// ({ id, name, isMain, lockedAt }); ACTIVE_VERSION_ID = the version whose
// drivers are currently loaded/edited (Main by default). version_id lives only
// in the DB load/write layer — the engine operates on the in-memory model and
// never sees it, so preview mode and the engine tests are unaffected.
let PLAN_VERSIONS = [];
let ACTIVE_VERSION_ID = null;
// Cross-version engine results, keyed by version id — { total, byName, monthly,
// revenue, result } for every version. Filled at load (loadVersionSummaries) so
// the Overview panels can compare Main / scenarios / locked budgets without an
// async call per render. The active version is always the live in-memory model.
let VERSION_SUMMARIES = {};
let CASH_POSITION = null; // { bankBalance, asOf } — from the last sync's SIE #UB lines
let OPEN_INVOICES = [];   // [{ kind: 'customer'|'supplier', amount, dueDate, description, counterparty }]
// VAT/payroll-tax closing balances by FY-relative month, from the sync's #IB +
// #TRANS tracking of the configured account ranges — an ESTIMATE of what's
// owed, kept separate from OPEN_INVOICES (a hard Fortnox figure).
let TAX_LIABILITY = { vat: new Map(), payroll: new Map() };
// Freshness of the Fortnox connection, for the sidebar badge — null for orgs
// that aren't connected (manual/CSV orgs get no badge, no nagging).
let SYNC_STATUS = null; // { connected, last_synced_at, last_sync_error }
// Month-end review ritual: set of "reportingLineId:month" keys the user has
// checked off. Purely a UI checklist — never read by any engine calculation.
let SIGNAL_REVIEWS = new Set();
const ORG_STORAGE_KEY = "almgren-current-org";
const ROLE_CATALOG = [];
const ASSUMPTIONS = {
  employerContributionPct: 31.42, equipmentMonthly: 1200, otherOverheadPct: 4, revenueBudget: 0,
  revenuePlan: null, // optional [12] monthly SEK profile; null = flat revenueBudget/12
  vatFrequency: "quarterly", vatAccountFrom: 2610, vatAccountTo: 2659, payrollAccountFrom: 2710, payrollAccountTo: 2739,
};
const COST_CENTERS = [];

// ---- Rate engine -----------------------------------------------------------

function getRole(roleId) {
  return ROLE_CATALOG.find((r) => r.id === roleId);
}

function monthlyCostForRole(roleId) {
  const role = getRole(roleId);
  if (!role) return 0;
  const loaded = role.baseSalary * (1 + ASSUMPTIONS.employerContributionPct / 100) + ASSUMPTIONS.equipmentMonthly;
  return Math.round(loaded * (1 + ASSUMPTIONS.otherOverheadPct / 100));
}

function isRoleInUse(roleId) {
  return COST_CENTERS.some((cc) => cc.headcount.some((h) => h.roleId === roleId));
}

// ---- Engine (unchanged; operates on the in-memory model) -------------------

function headcountCostForMonth(cc, month) {
  return cc.headcount.reduce((sum, h) => {
    if (month >= h.startMonth && month <= h.endMonth) return sum + h.count * monthlyCostForRole(h.roleId);
    return sum;
  }, 0);
}

function oneOffCostForMonth(cc, month) {
  return cc.oneOffs.filter((o) => o.month === month).reduce((s, o) => s + o.amount, 0);
}

// Recurring costs (rent, subscriptions, leases): a named line active over a
// start–end range, with an optional annual escalation compounding every 12
// months from its own start (so a line starting mid-year escalates on its own
// anniversary, not the calendar year).
function recurringCostForMonth(cc, month) {
  return (cc.recurringCosts || []).reduce((sum, r) => {
    if (month < r.startMonth || month > r.endMonth) return sum;
    const yearsIn = Math.floor((month - r.startMonth) / 12);
    const amt = r.amount * Math.pow(1 + (r.escalationPct || 0) / 100, yearsIn);
    return sum + amt;
  }, 0);
}

// ---- Utilization / capacity driver (the services/consulting way to plan) ----
// A BOUNDED optional driver on a line (cc.utilization), not a general formula
// engine. It captures the consulting planning identity in one object:
//   billableHours[12] · billRate · utilizationPct · hoursPerHead · roleId
// and derives BOTH sides of that line:
//   revenue(m)        = billableHours(m) × billRate
//   requiredHeads(m)  = billableHours(m) ÷ (utilizationPct% × hoursPerHead)
//   cost(m)           = requiredHeads(m) × fully-loaded role cost
// So "we plan to bill N hours" flows to both the top line and the headcount
// needed to deliver it. It COMPOSES with the manual drivers (adds to them), so
// a line can mix a retainer (revenuePlan) or fixed costs with billable work.

function hasUtilization(cc) {
  return !!(cc.utilization && (Number(cc.utilization.billRate) > 0 || (Array.isArray(cc.utilization.billableHours) && cc.utilization.billableHours.some((h) => h > 0))));
}

function utilBillableHours(cc, month) {
  const u = cc.utilization;
  if (!u || !Array.isArray(u.billableHours) || u.billableHours.length !== 12) return 0;
  return Number(u.billableHours[(month - 1) % 12]) || 0;
}

// Heads needed to deliver the billable hours at the target utilization. 0 when
// the capacity assumptions are unset (avoids divide-by-zero → a line with a
// bill rate but no capacity model is still valid: revenue only, no derived cost).
function utilizationRequiredHeads(cc, month) {
  const u = cc.utilization;
  if (!u) return 0;
  const capacityPerHead = (Number(u.utilizationPct) / 100) * Number(u.hoursPerHead);
  if (!(capacityPerHead > 0)) return 0;
  return utilBillableHours(cc, month) / capacityPerHead;
}

function utilizationCostForMonth(cc, month) {
  const u = cc.utilization;
  if (!u || !u.roleId) return 0; // no role to cost the derived heads against
  return utilizationRequiredHeads(cc, month) * monthlyCostForRole(u.roleId);
}

function utilizationRevenueForMonth(cc, month) {
  const u = cc.utilization;
  if (!u) return 0;
  return utilBillableHours(cc, month) * (Number(u.billRate) || 0);
}

// FY-average required heads / FY revenue / FY derived cost — the read-only
// numbers the Planning UI shows back so "we plan to bill N hours" is legible as
// heads, top line and cost.
function utilizationAvgHeads(cc) {
  if (!cc.utilization) return 0;
  let s = 0;
  for (let m = 1; m <= FY_MONTHS; m++) s += utilizationRequiredHeads(cc, m);
  return s / FY_MONTHS;
}
function utilizationFyRevenue(cc) {
  let s = 0;
  for (let m = 1; m <= FY_MONTHS; m++) s += utilizationRevenueForMonth(cc, m);
  return s;
}
function utilizationFyCost(cc) {
  let s = 0;
  for (let m = 1; m <= FY_MONTHS; m++) s += utilizationCostForMonth(cc, m);
  return s;
}

// A fresh driver with sensible SME-consulting defaults (75% utilization, 160
// working hours/month). Not persisted until the user edits something.
function defaultUtilization() {
  return { billRate: 0, utilizationPct: 75, hoursPerHead: 160, roleId: (ROLE_CATALOG[0] || {}).id || null, billableHours: Array(12).fill(0) };
}

// DB row (snake_case) → in-memory driver (camelCase). billable_hours is a [12]
// jsonb; anything malformed becomes a flat-zero array so the shape is stable.
function utilizationFromRow(u) {
  const hrs = Array.isArray(u.billable_hours) && u.billable_hours.length === 12
    ? u.billable_hours.map((h) => Number(h) || 0) : Array(12).fill(0);
  return {
    billRate: Number(u.bill_rate) || 0,
    utilizationPct: Number(u.utilization_pct) || 0,
    hoursPerHead: Number(u.hours_per_head) || 0,
    roleId: u.role_id || null,
    billableHours: hrs,
  };
}

function forecastForMonth(cc, month) {
  return headcountCostForMonth(cc, month) + oneOffCostForMonth(cc, month) + recurringCostForMonth(cc, month) + utilizationCostForMonth(cc, month);
}

function monthAmount(cc, month) {
  // A closed month shows the ACTUAL — 0 if nothing was booked to this cost
  // centre. We never blend the forecast into a closed month; that would
  // misrepresent reality and break variance. Future months show the forecast —
  // unless the user has EXPLICITLY applied a re-forecast override for this
  // month (never written automatically), in which case that wins and is
  // flagged (isOverridden) so it's visibly distinct from the driver plan.
  if (month <= CLOSE_MONTH) {
    return { value: cc.actualMonthly[month - 1] ?? 0, isActual: true };
  }
  const override = cc.overrides && cc.overrides[month];
  if (override != null) return { value: override, isActual: false, isOverridden: true };
  return { value: forecastForMonth(cc, month), isActual: false };
}

function monthlyBudgetFor(cc, month) {
  if (month < 1 || month > FY_MONTHS) return null; // no budget set for next FY yet
  return cc.annualBudget / FY_MONTHS;
}

function fySummary(cc) {
  let total = 0;
  for (let m = 1; m <= FY_MONTHS; m++) total += monthAmount(cc, m).value;
  return { total, budget: cc.annualBudget, variance: total - cc.annualBudget };
}

function rollingWindow() {
  const start = CLOSE_MONTH + 1;
  return { start, end: start + 11 };
}

function rollingSummary(cc) {
  const { start, end } = rollingWindow();
  let total = 0;
  for (let m = start; m <= end; m++) total += monthAmount(cc, m).value;
  return { total };
}

function companyFySummary() {
  const totals = COST_CENTERS.map(fySummary);
  return {
    total: totals.reduce((s, t) => s + t.total, 0),
    budget: totals.reduce((s, t) => s + t.budget, 0),
    variance: totals.reduce((s, t) => s + t.variance, 0),
  };
}

// The "why" behind a cost centre's FY total: what it's actually MADE OF, split
// into booked actuals (closed months), any re-forecast override, and each
// driver category's forecast for the remaining open months. Sums to exactly
// fySummary(cc).total — this is a composition breakdown, not a classic
// budget-to-actual waterfall, because the budget is a flat target independent
// of the drivers (there's nothing to "walk" from budget in named steps; what
// a controller actually wants first is "what's IN this number").
function fyComposition(cc) {
  let actual = 0, overridden = 0, headcount = 0, oneOff = 0, recurring = 0, utilization = 0;
  for (let m = 1; m <= FY_MONTHS; m++) {
    const a = monthAmount(cc, m);
    if (a.isActual) { actual += a.value; continue; }
    if (a.isOverridden) { overridden += a.value; continue; }
    headcount += headcountCostForMonth(cc, m);
    oneOff += oneOffCostForMonth(cc, m);
    recurring += recurringCostForMonth(cc, m);
    utilization += utilizationCostForMonth(cc, m);
  }
  return { actual, overridden, headcount, oneOff, recurring, utilization, total: actual + overridden + headcount + oneOff + recurring + utilization };
}

// ---- Simple allocation (corporate/shared costs → the rest) -----------------
// "Keep allocation dead simple; default to the unallocated (directly
// attributable) view — it's usually more useful for decisions." A cost centre
// marked isShared (rent for the whole building, group IT, etc.) can OPTIONALLY
// be spread across the other cost centres instead of sitting on its own line.
// Key: headcount-weighted (FY-average active heads) — the standard, simplest
// real-world allocation key — falling back to an equal split if nobody has
// headcount yet. Always opt-in; never the default view.

// FY-average active headcount for one cost centre — the allocation weight.
function fyAverageHeadcount(cc) {
  return cc.headcount.reduce((sum, h) => {
    const from = Math.max(1, h.startMonth), to = Math.min(FY_MONTHS, h.endMonth);
    const activeMonths = Math.max(0, to - from + 1);
    return sum + h.count * (activeMonths / FY_MONTHS);
  }, 0);
}

function sharedCostsTotal() {
  return COST_CENTERS.filter((cc) => cc.isShared).reduce((s, cc) => s + fySummary(cc).total, 0);
}

// This cc's share of the shared-cost pool (0 for shared centres themselves —
// they're the ones being redistributed, not receiving).
function allocatedShare(cc) {
  if (cc.isShared) return 0;
  const receivers = COST_CENTERS.filter((c) => !c.isShared);
  const weights = receivers.map(fyAverageHeadcount);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weight = totalWeight > 0 ? fyAverageHeadcount(cc) / totalWeight : (receivers.length ? 1 / receivers.length : 0);
  return sharedCostsTotal() * weight;
}

// The "after allocation" total for one cost centre — 0 for shared centres
// (their cost has moved to everyone else), fySummary(cc).total + its share otherwise.
function fullyLoadedTotal(cc) {
  return cc.isShared ? 0 : fySummary(cc).total + allocatedShare(cc);
}

// ---- Cash flow projection (Phase 5 v1) --------------------------------------
// A second forecast lens: not "are we profitable" (the P&L) but "will there be
// money in the bank" — the question that actually keeps an SME owner up at
// night. Built from two Fortnox-sourced ingredients: the current bank balance
// (summed from the SIE's #UB closing-balance lines) and open (unpaid)
// invoices with real due dates. Buckets each invoice into a month using the
// same fiscal-year-relative math the sync itself uses, then walks a running
// balance forward from today.

function cashFlowMonthIndex(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return (d.getUTCFullYear() - FY_START_YEAR) * 12 + (d.getUTCMonth() + 1 - FY_START_MONTH) + 1;
}

// FY-relative month → real calendar {year, month(1-12)}. VAT/payroll deadlines
// follow the calendar, not the org's (possibly broken) fiscal year.
function fyMonthToCalendar(m) {
  const abs = FY_START_MONTH - 1 + (m - 1);
  return { year: FY_START_YEAR + Math.floor(abs / 12), month: (abs % 12) + 1 };
}

// Skatteverket's standard deadline shape for turnover ≤40M SEK (our SME
// target segment): the 12th of the Nth month after the period, EXCEPT the
// 17th whenever that resolves to January or August. Verified against
// Skatteverket's published 2026 dates for monthly/quarterly VAT and the
// (aligned) arbetsgivardeklaration payment deadline.
function skatteverketDueDate(calYear, calMonth, monthsAfter) {
  let y = calYear, m = calMonth + monthsAfter;
  while (m > 12) { m -= 12; y++; }
  const day = (m === 1 || m === 8) ? 17 : 12;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// When a given FY-relative month's tracked liability balance actually falls
// due — or null if that month isn't a reporting-period boundary for the kind
// (e.g. a non-quarter-end month under quarterly VAT).
function taxDueDate(kind, fyMonth) {
  const { year, month } = fyMonthToCalendar(fyMonth);
  if (kind === "payroll") return skatteverketDueDate(year, month, 1);
  if (ASSUMPTIONS.vatFrequency === "monthly") return skatteverketDueDate(year, month, 2);
  if (ASSUMPTIONS.vatFrequency === "annual") {
    if (month !== 12) return null;
    return `${year + 1}-02-12`; // approximate — Skatteverket doesn't publish an exact day for annual filers
  }
  // quarterly (default): only calendar quarter-end months carry a liability event.
  if (![3, 6, 9, 12].includes(month)) return null;
  return skatteverketDueDate(year, month, 2);
}

// ---- Revenue plan (the forecast P&L's revenue side) -------------------------
// An optional 12-month profile typed on Assumptions. When absent (or cleared
// to all zeros) the engine falls back to a flat revenueBudget/12 — exactly the
// pre-plan behavior, so orgs that never touch it see no change.

function revenuePlanForMonth(m) {
  // Per-line revenue wins: when any reporting line is a profit centre (carries
  // its own revenue), company revenue = the sum across lines, and the org-level
  // number is ignored. Otherwise fall back to the org-level plan / flat target.
  if (anyLineHasRevenue()) {
    return COST_CENTERS.reduce((s, cc) => s + lineRevenueForMonth(cc, m), 0);
  }
  const plan = ASSUMPTIONS.revenuePlan;
  if (Array.isArray(plan) && plan.length === 12 && plan.some((v) => v > 0)) {
    // Months 13-24 reuse the same profile — seasonality carries into next FY
    // until a dedicated plan for it exists.
    return Number(plan[(m - 1) % 12]) || 0;
  }
  return (ASSUMPTIONS.revenueBudget || 0) / 12;
}

function revenuePlanFyTotal() {
  let total = 0;
  for (let m = 1; m <= FY_MONTHS; m++) total += revenuePlanForMonth(m);
  return total;
}

// ---- Per-line revenue (Tier 1: a reporting line can be a profit centre) -----
// A reporting line may carry its own optional 12-month revenue profile
// (cc.revenuePlan, [12] SEK, FY-relative). A line with revenue is a profit
// centre — its revenue minus its driver-built cost is its margin (a project
// P&L). This is the SMB "profit centre" pattern (Jirav/Fathom-style), not a
// second planning dimension: a line is still a line, it can just also earn.

function lineHasManualRevenue(cc) {
  return Array.isArray(cc.revenuePlan) && cc.revenuePlan.length === 12 && cc.revenuePlan.some((v) => v > 0);
}

// A line earns if it has a manual revenue plan OR a billable utilization driver
// (they compose — a line can carry both a retainer and billable hours).
function lineHasRevenue(cc) {
  return lineHasManualRevenue(cc) || hasUtilization(cc);
}

function anyLineHasRevenue() {
  return COST_CENTERS.some(lineHasRevenue);
}

function lineRevenueForMonth(cc, m) {
  const manual = lineHasManualRevenue(cc) ? (Number(cc.revenuePlan[(m - 1) % 12]) || 0) : 0;
  return manual + utilizationRevenueForMonth(cc, m);
}

function lineRevenueFyTotal(cc) {
  let total = 0;
  for (let m = 1; m <= FY_MONTHS; m++) total += lineRevenueForMonth(cc, m);
  return total;
}

// A line's margin = its revenue − its full-year cost. Only meaningful for a
// profit centre; returns null for a pure cost line so callers show nothing
// rather than presenting "−(cost)" as if it were a margin.
function lineMargin(cc) {
  if (!lineHasRevenue(cc)) return null;
  return lineRevenueFyTotal(cc) - fySummary(cc).total;
}

// Runway cap: how far ahead we'll walk looking for a zero-crossing before
// giving up and calling it cash-positive. Matches the driver forecast's own
// horizon — there's no data to project operating costs beyond it anyway.
const RUNWAY_HORIZON_MONTHS = TIMELINE_LENGTH;

// fromIdx is injectable so tests can pin "now" to a fixed month; the app
// always uses the default (today).
function cashFlowProjection(monthsAhead = 6, fromIdx = null) {
  if (!CASH_POSITION) return null;
  const nowIdx = fromIdx ?? cashFlowMonthIndex(new Date().toISOString().slice(0, 10));

  const inflowByMonth = new Map();
  const outflowByMonth = new Map();
  OPEN_INVOICES.forEach((inv) => {
    const m = cashFlowMonthIndex(inv.dueDate);
    const map = inv.kind === "customer" ? inflowByMonth : outflowByMonth;
    map.set(m, (map.get(m) ?? 0) + inv.amount);
  });

  // Tax/VAT: an ESTIMATE from tracked account balances, kept as its own signed
  // bucket (positive = owed/outflow, negative = refund) rather than blended
  // into the hard invoice inflow/outflow above.
  const taxDueByMonth = new Map();
  for (const kind of ["vat", "payroll"]) {
    for (const [fyMonth, balance] of TAX_LIABILITY[kind]) {
      const due = taxDueDate(kind, fyMonth);
      if (!due) continue;
      const m = cashFlowMonthIndex(due);
      const owed = -balance; // liability balances are negative (credit-normal); owed = -balance
      taxDueByMonth.set(m, (taxDueByMonth.get(m) ?? 0) + owed);
    }
  }

  // Estimated operating cash flow: the SAME driver forecast that powers
  // Overview/Monthly (salaries, recurring costs, one-offs — the biggest,
  // most predictable outflow, and previously missing here entirely) netted
  // against the monthly revenue plan (or a flat annual-target/12 when no
  // plan is set). Kept as its own signed bucket, exactly like tax, so a
  // hard invoice figure is never silently blended with a model estimate.
  const estOperating = (m) => revenuePlanForMonth(m) - (m >= 1 && m <= TIMELINE_LENGTH ? companyMonthAmount(m) : 0);

  let running = CASH_POSITION.bankBalance;
  const rows = [];
  let runway = running < 0 ? 0 : null;
  const horizon = Math.max(monthsAhead, RUNWAY_HORIZON_MONTHS - nowIdx + 1, 0);
  for (let i = 0; i < horizon; i++) {
    const m = nowIdx + i;
    const inflow = inflowByMonth.get(m) ?? 0;
    const outflow = outflowByMonth.get(m) ?? 0;
    const taxDue = taxDueByMonth.get(m) ?? 0;
    const operating = estOperating(m);
    const net = inflow - outflow - taxDue + operating;
    running += net;
    if (i < monthsAhead) rows.push({ month: m, inflow, outflow, taxDue, operating, net, balance: running });
    if (runway == null && running < 0) runway = i + 1;
  }
  return { rows, runway };
}

// ---- Budget baseline (a locked plan version) -------------------------------
// A budget is now a locked plan_version (see lock-as-budget), not a separate
// snapshot table. "Are we drifting from budget?" = the live plan's projected
// cost vs the approved budget version's cost, both computed by the same engine
// (VERSION_SUMMARIES). Most-recently-locked budget is the active baseline.

function lockedBudgetVersions() {
  return PLAN_VERSIONS.filter((v) => v.lockedAt)
    .sort((a, b) => new Date(b.lockedAt) - new Date(a.lockedAt));
}
function latestBudgetVersion() {
  return lockedBudgetVersions()[0] || null;
}

// null when there's no locked budget yet, or once one exists but the live plan
// hasn't drifted from it (nothing to flag). Positive = live plan costs MORE
// than the approved budget.
function budgetDrift() {
  const v = latestBudgetVersion();
  if (!v) return null;
  const budget = VERSION_SUMMARIES[v.id], live = VERSION_SUMMARIES[ACTIVE_VERSION_ID];
  if (!budget || !live) return null;
  const diff = live.total - budget.total;
  return Math.abs(diff) < 1 ? null : diff;
}

function companyRollingSummary() {
  return { total: COST_CENTERS.reduce((s, cc) => s + rollingSummary(cc).total, 0) };
}

function companyMonthAmount(month) {
  return COST_CENTERS.reduce((s, cc) => s + monthAmount(cc, month).value, 0);
}

// Set which absolute month actuals are booked through (0 = none yet).
// Months without actual data still fall back to forecast, so any value is safe.
function setCloseMonth(m) {
  CLOSE_MONTH = Math.max(0, Math.min(TIMELINE_LENGTH, m));
}

// ---- Load from Supabase ----------------------------------------------------

// Resolve this org's plan versions and pick the active one (Main for now).
// Self-heals a brand-new org that has no Main yet (creates it + attaches any
// orphaned drivers), so the versioned driver load always finds its rows.
async function loadPlanVersions() {
  PLAN_VERSIONS = [];
  const { data, error } = await sb.from("plan_versions")
    .select("id, name, is_main, locked_at, revenue_budget, revenue_plan").eq("org_id", CURRENT_ORG_ID).order("created_at");
  let rows = error ? [] : (data || []);
  let main = rows.find((v) => v.is_main);
  if (!main) {
    const ins = await sb.from("plan_versions")
      .insert({ org_id: CURRENT_ORG_ID, name: "Main", is_main: true })
      .select("id, name, is_main, locked_at, revenue_budget, revenue_plan").single();
    if (!ins.error && ins.data) {
      main = ins.data;
      rows = [main, ...rows];
      for (const tbl of ["headcount_lines", "one_offs", "recurring_costs", "forecast_overrides"]) {
        await sb.from(tbl).update({ version_id: main.id }).eq("org_id", CURRENT_ORG_ID).is("version_id", null);
      }
    }
  }
  PLAN_VERSIONS = rows.map((v) => ({ id: v.id, name: v.name, isMain: !!v.is_main, lockedAt: v.locked_at, revenueBudget: Number(v.revenue_budget || 0), revenuePlan: v.revenue_plan }));
  // Active = the saved choice for this org if it still exists, else Main.
  const saved = localStorage.getItem(activeVersionKey());
  const active = PLAN_VERSIONS.find((v) => v.id === saved) || PLAN_VERSIONS.find((v) => v.isMain);
  ACTIVE_VERSION_ID = active ? active.id : (main ? main.id : null);
}

function activeVersionKey() { return "almgren-active-version-" + CURRENT_ORG_ID; }
function activeVersion() { return PLAN_VERSIONS.find((v) => v.id === ACTIVE_VERSION_ID) || null; }

// Switch which plan version is active (reloads to pull that version's drivers).
function switchVersion(id) {
  localStorage.setItem(activeVersionKey(), id);
  location.reload();
}

// True when the active version is a locked budget → its numbers are frozen and
// edits are refused. Write helpers call assertEditable() to enforce it.
function versionLocked() { const av = activeVersion(); return !!(av && av.lockedAt); }
function assertEditable() {
  if (versionLocked()) { showToast(t("toast_version_locked")); return false; }
  return true;
}

// Core: a full copy of the active version — drivers (cost) + per-line revenue
// + the version's org-level revenue — under a new version. Optionally locked
// (a budget). Returns the new id; does NOT switch.
async function copyActiveVersion(name, { locked = false } = {}) {
  const src = ACTIVE_VERSION_ID;
  const srcV = activeVersion() || {};
  const { data: v, error } = await sb.from("plan_versions").insert({
    org_id: CURRENT_ORG_ID, name, is_main: false,
    locked_at: locked ? new Date().toISOString() : null,
    revenue_budget: srcV.revenueBudget || 0, revenue_plan: srcV.revenuePlan || null,
  }).select("id").single();
  if (error) { flagWriteError(error); return null; }
  for (const tbl of ["headcount_lines", "one_offs", "recurring_costs", "forecast_overrides", "version_line_revenue", "utilization_drivers"]) {
    const { data: srcRows, error: se } = await sb.from(tbl).select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", src);
    if (se) { flagWriteError(se); return null; }
    if (srcRows && srcRows.length) {
      const copies = srcRows.map(({ id, created_at, ...rest }) => ({ ...rest, version_id: v.id }));
      const { error: ce } = await sb.from(tbl).insert(copies);
      if (ce) { flagWriteError(ce); return null; }
    }
  }
  return v.id;
}

// Branch a new scenario (editable copy) and switch into it.
async function dbCreateVersion(name) {
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return null; }
  const id = await copyActiveVersion(name);
  if (id) localStorage.setItem(activeVersionKey(), id); // caller triggers switchVersion (reload)
  return id;
}

// Lock the current plan as an approved budget: a frozen copy. Stays on the
// current version (you keep forecasting); the budget is the immutable baseline.
async function dbLockAsBudget(name) {
  if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) { showToast(t("toast_signin_save_data")); return null; }
  return await copyActiveVersion(name, { locked: true });
}

async function dbRenameVersion(id, name) {
  const { error } = await sb.from("plan_versions").update({ name }).eq("id", id);
  if (error) flagWriteError(error);
}

// Delete a scenario (its drivers cascade). Never Main. If it was active, the
// caller switches back to Main.
async function dbDeleteVersion(id) {
  const { error } = await sb.from("plan_versions").delete().eq("id", id);
  if (error) { flagWriteError(error); return false; }
  return true;
}

// ---- Cross-version computation ---------------------------------------------
// Run the same engine on ANY version's drivers without disturbing the live
// in-memory model. The active version is already fully materialised in
// COST_CENTERS, so for it we just read the live model; for every other version
// we load its versioned drivers + per-line revenue and overlay them onto the
// org-shared skeleton (reporting lines + booked actuals + rates + close month,
// none of which are versioned). fySummary/monthAmount take a cost-centre
// argument, so they compute correctly on the alt centres.

// FY revenue for an arbitrary version: per-line profit centres win (sum across
// lines); otherwise the version's own org-level plan / flat budget. Mirrors
// revenuePlanForMonth but reads the passed version + alt centres, not globals.
function versionRevenueFyTotal(ver, altCenters) {
  // Per-line revenue wins (manual plan OR utilization billable) — lineRevenueForMonth
  // composes both and takes only the cc, so it's correct on alt centres too.
  const anyLine = altCenters.some(lineHasRevenue);
  const plan = ver && Array.isArray(ver.revenuePlan) && ver.revenuePlan.length === 12 && ver.revenuePlan.some((v) => v > 0) ? ver.revenuePlan : null;
  let total = 0;
  for (let m = 1; m <= FY_MONTHS; m++) {
    if (anyLine) total += altCenters.reduce((s, cc) => s + lineRevenueForMonth(cc, m), 0);
    else if (plan) total += Number(plan[(m - 1) % 12]) || 0;
    else total += ((ver && ver.revenueBudget) || 0) / 12;
  }
  return total;
}

async function computeVersionSummary(versionId) {
  // Active version = the live model already in memory.
  if (versionId === ACTIVE_VERSION_ID) {
    const monthly = [];
    for (let m = 1; m <= FY_MONTHS; m++) monthly[m - 1] = companyMonthAmount(m);
    const byName = {};
    COST_CENTERS.forEach((cc) => { byName[cc.name] = fySummary(cc).total; });
    const total = companyFySummary().total, revenue = revenuePlanFyTotal();
    return { total, byName, monthly, revenue, result: revenue - total };
  }
  const ver = PLAN_VERSIONS.find((v) => v.id === versionId);
  const [hcRes, ooRes, rcRes, foRes, vlrRes, udRes] = await Promise.all([
    sb.from("headcount_lines").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
    sb.from("one_offs").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
    sb.from("recurring_costs").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
    sb.from("forecast_overrides").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
    sb.from("version_line_revenue").select("reporting_line_id, revenue_plan").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
    sb.from("utilization_drivers").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", versionId),
  ]);
  const lineRev = {};
  if (!vlrRes.error) (vlrRes.data || []).forEach((r) => { lineRev[r.reporting_line_id] = r.revenue_plan; });
  const utilByLine = {};
  if (!udRes.error) (udRes.data || []).forEach((u) => { utilByLine[u.reporting_line_id] = utilizationFromRow(u); });
  const alt = COST_CENTERS.map((base) => ({
    id: base.id, name: base.name, annualBudget: base.annualBudget,
    isShared: base.isShared, actualMonthly: base.actualMonthly, // shared — actuals aren't versioned
    utilization: utilByLine[base.id] || null,
    revenuePlan: Array.isArray(lineRev[base.id]) && lineRev[base.id].length === 12 ? lineRev[base.id].map((v) => Number(v) || 0) : null,
    headcount: (hcRes.data || []).filter((h) => h.reporting_line_id === base.id)
      .map((h) => ({ roleId: h.role_id, count: h.count, startMonth: h.start_month, endMonth: h.end_month })),
    oneOffs: (ooRes.data || []).filter((o) => o.reporting_line_id === base.id)
      .map((o) => ({ amount: Number(o.amount), month: o.month })),
    recurringCosts: (rcRes.error ? [] : rcRes.data).filter((r) => r.reporting_line_id === base.id)
      .map((r) => ({ amount: Number(r.amount), startMonth: r.start_month, endMonth: r.end_month, escalationPct: Number(r.escalation_pct || 0) })),
    overrides: {},
  }));
  if (!foRes.error) (foRes.data || []).forEach((o) => { const cc = alt.find((c) => c.id === o.reporting_line_id); if (cc) cc.overrides[o.month] = Number(o.amount); });

  let total = 0; const byName = {}; const monthly = new Array(FY_MONTHS).fill(0);
  alt.forEach((cc) => {
    const fy = fySummary(cc);
    total += fy.total; byName[cc.name] = fy.total;
    for (let m = 1; m <= FY_MONTHS; m++) monthly[m - 1] += monthAmount(cc, m).value;
  });
  const revenue = versionRevenueFyTotal(ver, alt);
  return { total, byName, monthly, revenue, result: revenue - total };
}

// Fill VERSION_SUMMARIES for every version (Main + scenarios + budgets). Called
// at the end of loadData; versions are few, so the parallel loads are cheap.
async function loadVersionSummaries() {
  VERSION_SUMMARIES = {};
  const results = await Promise.all(PLAN_VERSIONS.map((v) => computeVersionSummary(v.id).catch(() => null)));
  PLAN_VERSIONS.forEach((v, i) => { if (results[i]) VERSION_SUMMARIES[v.id] = results[i]; });
}

async function loadData(orgId) {
  // Which orgs does this user belong to? RLS returns only their memberships.
  const orgsRes = await sb.from("organizations").select("*").order("name");
  if (orgsRes.error) throw new Error(orgsRes.error.message);
  USER_ORGS = orgsRes.data;
  if (USER_ORGS.length === 0) throw new Error(t("err_no_org_linked"));

  // Pick the active org: explicit arg → saved choice → first available.
  const saved = orgId || localStorage.getItem(ORG_STORAGE_KEY);
  const org = USER_ORGS.find((o) => o.id === saved) || USER_ORGS[0];
  CURRENT_ORG_ID = org.id;
  CLOSE_MONTH = org.close_month;
  CLOSE_MONTH_MANUAL = !!org.close_month_manual;
  DISPLAY_UNIT = org.display_unit || "tkr"; // SME default; falls back gracefully if the column isn't set
  CURRENCY = org.currency || "SEK";
  FY_START_MONTH = org.fy_start_month || 1; // broken fiscal years — set by the Fortnox sync
  FY_START_YEAR = org.fy_start_year || 2026;
  localStorage.setItem(ORG_STORAGE_KEY, CURRENT_ORG_ID);

  // Resolve the active plan version (the driver copy we load/edit). Ensures a
  // Main exists (self-heals new orgs); ACTIVE_VERSION_ID is Main for now —
  // scenario switching arrives in a later step. Drivers are then filtered to
  // this version; actuals / reporting lines / rates stay org-shared.
  await loadPlanVersions();

  // Everything else is filtered to the active org (there may be several now).
  // Per-line revenue is versioned too (vlrRes), so scenarios can vary it.
  const [assRes, rolesRes, ccRes, hcRes, ooRes, actRes, vlrRes] = await Promise.all([
    sb.from("assumptions").select("*").eq("org_id", CURRENT_ORG_ID).single(),
    sb.from("roles").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("reporting_lines").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("headcount_lines").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID),
    sb.from("one_offs").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID),
    sb.from("monthly_actual").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("version_line_revenue").select("reporting_line_id, revenue_plan").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID),
  ]);

  const failed = [assRes, rolesRes, ccRes, hcRes, ooRes, actRes].find((r) => r.error);
  if (failed) throw new Error(failed.error.message);
  const lineRevByCc = {};
  if (!vlrRes.error) (vlrRes.data || []).forEach((r) => { lineRevByCc[r.reporting_line_id] = r.revenue_plan; });

  Object.assign(ASSUMPTIONS, {
    employerContributionPct: Number(assRes.data.employer_contribution_pct),
    equipmentMonthly: Number(assRes.data.equipment_monthly),
    otherOverheadPct: Number(assRes.data.other_overhead_pct),
    // Org-level revenue is now versioned — it lives on the active plan version,
    // not the (org-shared) assumptions row. Falls back to 0/null.
    revenueBudget: Number((activeVersion() || {}).revenueBudget || 0),
    revenuePlan: Array.isArray((activeVersion() || {}).revenuePlan) && activeVersion().revenuePlan.length === 12
      ? activeVersion().revenuePlan.map((v) => Number(v) || 0)
      : null,
    vatFrequency: assRes.data.vat_frequency || "quarterly",
    vatAccountFrom: Number(assRes.data.vat_account_from ?? 2610),
    vatAccountTo: Number(assRes.data.vat_account_to ?? 2659),
    payrollAccountFrom: Number(assRes.data.payroll_account_from ?? 2710),
    payrollAccountTo: Number(assRes.data.payroll_account_to ?? 2739),
  });

  ROLE_CATALOG.length = 0;
  rolesRes.data
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((r) => ROLE_CATALOG.push({ id: r.id, label: r.label, baseSalary: Number(r.base_salary) }));

  COST_CENTERS.length = 0;
  ccRes.data
    .slice()
    .sort((a, b) => Number(b.annual_budget) - Number(a.annual_budget)) // biggest first, stable display order
    .forEach((cc) => {
      const actualMonthly = [];
      actRes.data
        .filter((a) => a.reporting_line_id === cc.id)
        .forEach((a) => (actualMonthly[a.month - 1] = Number(a.amount)));

      COST_CENTERS.push({
        id: cc.id,
        name: cc.name,
        annualBudget: Number(cc.annual_budget),
        otherMonthly: Number(cc.other_monthly), // legacy — superseded by recurringCosts, kept only so old writes don't error
        note: cc.note || "",
        isShared: !!cc.is_shared,
        // Per-line revenue (profit centre), versioned — from version_line_revenue
        // for the active version. Malformed/absent → null.
        revenuePlan: Array.isArray(lineRevByCc[cc.id]) && lineRevByCc[cc.id].length === 12
          ? lineRevByCc[cc.id].map((v) => Number(v) || 0) : null,
        headcount: hcRes.data
          .filter((h) => h.reporting_line_id === cc.id)
          .map((h) => ({ id: h.id, roleId: h.role_id, count: h.count, startMonth: h.start_month, endMonth: h.end_month })),
        oneOffs: ooRes.data
          .filter((o) => o.reporting_line_id === cc.id)
          .map((o) => ({ id: o.id, label: o.label, amount: Number(o.amount), month: o.month })),
        recurringCosts: [],
        overrides: {},
        utilization: null, // optional capacity driver, loaded below
        actualMonthly,
      });
    });

  // Recurring costs — loaded tolerantly (like scenarios) in case an older DB
  // hasn't run the migration yet; the app still works, just with no recurring lines.
  const rcRes = await sb.from("recurring_costs").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID);
  if (!rcRes.error) {
    rcRes.data.forEach((r) => {
      const cc = COST_CENTERS.find((c) => c.id === r.reporting_line_id);
      if (cc) cc.recurringCosts.push({
        id: r.id, label: r.label, amount: Number(r.amount),
        startMonth: r.start_month, endMonth: r.end_month, escalationPct: Number(r.escalation_pct || 0),
      });
    });
  }

  // Re-forecast overrides — likewise tolerant. Never written by a sync; only
  // ever present because a user explicitly clicked "Apply run-rate".
  const foRes = await sb.from("forecast_overrides").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID);
  if (!foRes.error) {
    foRes.data.forEach((o) => {
      const cc = COST_CENTERS.find((c) => c.id === o.reporting_line_id);
      if (cc) cc.overrides[o.month] = Number(o.amount);
    });
  }

  // Utilization / capacity drivers — tolerant load (table may not exist on an
  // older DB). At most one per line, for the active version.
  const udRes = await sb.from("utilization_drivers").select("*").eq("org_id", CURRENT_ORG_ID).eq("version_id", ACTIVE_VERSION_ID);
  if (!udRes.error) {
    udRes.data.forEach((u) => {
      const cc = COST_CENTERS.find((c) => c.id === u.reporting_line_id);
      if (cc) cc.utilization = utilizationFromRow(u);
    });
  }

  // Sync freshness for the sidebar badge — tolerant, absent for unconnected orgs.
  SYNC_STATUS = null;
  const stRes = await sb.from("integration_status")
    .select("connected, last_synced_at, last_sync_error").eq("org_id", CURRENT_ORG_ID).maybeSingle();
  if (!stRes.error && stRes.data && stRes.data.connected) SYNC_STATUS = stRes.data;

  // Cash flow (Phase 5) — tolerant load; only populated once Fortnox is connected and synced.
  CASH_POSITION = null;
  const cpRes = await sb.from("cash_position").select("*").eq("org_id", CURRENT_ORG_ID).maybeSingle();
  if (!cpRes.error && cpRes.data) CASH_POSITION = { bankBalance: Number(cpRes.data.bank_balance), asOf: cpRes.data.as_of };

  OPEN_INVOICES.length = 0;
  const oiRes = await sb.from("open_invoices").select("*").eq("org_id", CURRENT_ORG_ID).order("due_date");
  if (!oiRes.error) oiRes.data.forEach((o) => OPEN_INVOICES.push({ kind: o.kind, amount: Number(o.amount), dueDate: o.due_date, description: o.description, counterparty: o.counterparty }));

  TAX_LIABILITY = { vat: new Map(), payroll: new Map() };
  const taxRes = await sb.from("tax_liability_monthly").select("*").eq("org_id", CURRENT_ORG_ID);
  if (!taxRes.error) taxRes.data.forEach((r) => TAX_LIABILITY[r.kind === "vat" ? "vat" : "payroll"].set(r.month, Number(r.balance)));

  // Month-end review checkmarks — tolerant load (table may not exist yet on an older DB).
  SIGNAL_REVIEWS = new Set();
  const srRes = await sb.from("signal_reviews").select("reporting_line_id, month").eq("org_id", CURRENT_ORG_ID);
  if (!srRes.error) srRes.data.forEach((r) => SIGNAL_REVIEWS.add(r.reporting_line_id + ":" + r.month));

  // Cross-version summaries for the Overview panels (scenarios vs live, budget
  // drift). Runs the engine on every version; needs the shared skeleton above.
  await loadVersionSummaries();
}

// ---- Preview mode ----------------------------------------------------------
// Loads representative sample data WITHOUT a login or Supabase, so the UI can be
// inspected/developed offline. Activated with ?preview on any page. Not used in
// the real app — purely a development affordance.
function loadPreviewData() {
  USER_ORGS = [
    { id: "preview-1", name: "Meridian Manufacturing AB", close_month: 6, currency: "SEK" },
    { id: "preview-2", name: "Vantage Consulting AB", close_month: 6, currency: "SEK" },
  ];
  CURRENT_ORG_ID = "preview-1";
  // Fake plan versions so the sidebar switcher renders in the demo (real writes
  // are blocked in demo mode, so branching just shows the sign-in toast).
  PLAN_VERSIONS = [
    { id: "pv-main", name: "Main", isMain: true, lockedAt: null, revenueBudget: 50000000, revenuePlan: null },
    { id: "pv-scen", name: "Hiring freeze", isMain: false, lockedAt: null, revenueBudget: 50000000, revenuePlan: null },
    { id: "pv-budget", name: "Budget 2026", isMain: false, lockedAt: "2026-01-15T09:00:00Z", revenueBudget: 50000000, revenuePlan: null },
  ];
  ACTIVE_VERSION_ID = "pv-main";
  CLOSE_MONTH = 6;
  DISPLAY_UNIT = "mkr"; // demo figures are millions-scale — keep the portfolio clean
  // Dev hook: ?preview&fystart=5 renders a broken fiscal year (May–Apr) to verify labels.
  FY_START_MONTH = parseInt(new URLSearchParams(location.search).get("fystart"), 10) || 1;
  FY_START_YEAR = 2026;
  Object.assign(ASSUMPTIONS, {
    employerContributionPct: 31.42, equipmentMonthly: 1200, otherOverheadPct: 4, revenueBudget: 50000000,
    vatFrequency: "quarterly", vatAccountFrom: 2610, vatAccountTo: 2659, payrollAccountFrom: 2710, payrollAccountTo: 2739,
  });

  ROLE_CATALOG.length = 0;
  COST_CENTERS.length = 0;
  VERSION_SUMMARIES = {};
  if (new URLSearchParams(location.search).has("empty")) return; // ?preview&empty → fresh-org state

  ROLE_CATALOG.push(
    { id: "r1", label: "Production Operator", baseSalary: 33000 },
    { id: "r2", label: "Shift Supervisor", baseSalary: 42000 },
    { id: "r3", label: "Engineer", baseSalary: 47000 },
    { id: "r4", label: "IT Support Specialist", baseSalary: 36000 },
  );

  const mk = (id, name, budget, other, hc, oo, act) => ({
    id, name, annualBudget: budget, otherMonthly: other, note: "", headcount: hc, oneOffs: oo, actualMonthly: act,
    recurringCosts: other ? [{ id: id + "-rec1", label: "Other costs", amount: other, startMonth: 1, endMonth: 24, escalationPct: 0 }] : [],
    overrides: {}, isShared: false,
  });

  COST_CENTERS.push(
    mk("c1", "Production", 28000000, 1350000,
      [{ id: "h1", roleId: "r1", count: 18, startMonth: 1, endMonth: 24 }, { id: "h2", roleId: "r2", count: 1, startMonth: 9, endMonth: 24 }],
      [{ id: "o1", label: "Press line overhaul", amount: 650000, month: 9 }],
      [2380000, 2410000, 2510000, 2440000, 2460000, 2400000]),
    mk("c2", "R&D", 9000000, 283000,
      [{ id: "h3", roleId: "r3", count: 6, startMonth: 1, endMonth: 24 }],
      [{ id: "o2", label: "Prototype tooling", amount: 320000, month: 8 }],
      [780000, 800000, 850000, 820000, 830000, 820000]),
    mk("c3", "IT", 5000000, 166000,
      [{ id: "h4", roleId: "r4", count: 2, startMonth: 1, endMonth: 24 }],
      [],
      [360000, 370000, 400000, 390000, 400000, 380000]),
  );

  const itCc = COST_CENTERS.find((c) => c.name === "IT");
  if (itCc) itCc.note = t("demo_it_note");

  // Dev hook: ?preview&profit turns the demo lines into profit centres (each
  // with its own revenue) so the per-line revenue / margin feature is
  // screenshot-verifiable. Left OFF by default — the sales demo stays an
  // org-level-revenue manufacturer.
  if (new URLSearchParams(location.search).has("profit")) {
    const rev = { Production: 35000000, "R&D": 11000000, IT: 2000000 };
    COST_CENTERS.forEach((cc) => {
      if (rev[cc.name]) cc.revenuePlan = Array(12).fill(rev[cc.name] / 12);
    });
    // Dev hook: &revgrid shows a shaped (custom monthly) line with its grid open
    // so the per-line monthly editor (#12) is screenshot-verifiable.
    if (new URLSearchParams(location.search).has("revgrid")) {
      const prod = COST_CENTERS.find((c) => c.name === "Production");
      if (prod) { prod.revenuePlan = [2.4, 2.4, 3.0, 3.2, 3.0, 2.6, 1.8, 2.2, 3.4, 3.6, 4.0, 3.4].map((v) => v * 1e6); prod._showRevMonthly = true; }
    }
  }

  // Dev hook: &consulting plans a line via the utilization/capacity driver
  // (billable hours × rate → revenue; hours → required heads → cost) so the
  // services way of planning is screenshot-verifiable.
  if (new URLSearchParams(location.search).has("consulting")) {
    const line = COST_CENTERS.find((c) => c.name === "R&D") || COST_CENTERS[0];
    if (line) {
      line.utilization = { billRate: 1200, utilizationPct: 75, hoursPerHead: 160, roleId: "r3",
        billableHours: [900, 950, 1000, 1050, 1000, 900, 600, 800, 1100, 1150, 1200, 1000] };
      line._showUtil = true; line._showUtilMonthly = true;
    }
  }

  // Cross-version summaries for the demo Overview panels. Monthly trajectories
  // are illustrative fixed fixtures (not engine-derived, unlike everything else
  // here) — "Hiring freeze" tracks Main exactly through month 8 then visibly
  // dips for months 9-12, right where Main has the September hire + one-off, so
  // the trajectory chart demonstrates its whole point (see the SHAPE of the
  // divergence, not just the FY delta). Main mirrors the live model (~41.8M);
  // Budget 2026 is the approved baseline (42.0M) so the drift chip shows a
  // small clean under-budget number.
  VERSION_SUMMARIES = {
    "pv-main": { total: 41800000, byName: { Production: 28600000, "R&D": 9300000, IT: 3900000 }, revenue: 50000000, result: 8200000,
      monthly: [3300000, 3300000, 3300000, 3300000, 3300000, 3300000, 3400000, 3400000, 4100000, 3700000, 3700000, 3700000] },
    "pv-scen": { total: 39500000, byName: { Production: 27000000, "R&D": 8600000, IT: 3900000 }, revenue: 50000000, result: 10500000,
      monthly: [3300000, 3300000, 3300000, 3300000, 3300000, 3300000, 3400000, 3400000, 3200000, 3200000, 3200000, 3300000] },
    "pv-budget": { total: 42000000, byName: { Production: 28000000, "R&D": 9000000, IT: 5000000 }, revenue: 50000000, result: 8000000,
      monthly: [3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000, 3500000] },
  };

  // Seasonal revenue profile summing to exactly the 50.0M annual target —
  // July dips (industrisemester), Q4 pushes. Gives the demo a non-flat cash
  // curve and exercises the plan → forecast-P&L → cash-flow chain.
  ASSUMPTIONS.revenuePlan = [4200000, 4200000, 4600000, 4400000, 4300000, 4100000, 3000000, 3600000, 4400000, 4600000, 4600000, 4000000];

  // Badge demo: synced a few hours ago, healthy.
  SYNC_STATUS = { connected: true, last_synced_at: new Date(Date.now() - 3 * 3600000).toISOString(), last_sync_error: null };

  // Review ritual demo: IT already reviewed this close (matches its note above),
  // Production/R&D left unmarked so the screenshot shows both states.
  SIGNAL_REVIEWS = new Set(["c3:6"]);

  CASH_POSITION = { bankBalance: 6200000, asOf: "2026-07-07T05:00:00Z" };
  OPEN_INVOICES.length = 0;
  OPEN_INVOICES.push(
    { kind: "customer", amount: 1450000, dueDate: "2026-07-20", description: "#10234", counterparty: "Nordisk Handel AB" },
    { kind: "customer", amount: 820000, dueDate: "2026-08-05", description: "#10241", counterparty: "Bygg & Co" },
    { kind: "customer", amount: 630000, dueDate: "2026-08-28", description: "#10255", counterparty: "Skandia Retail" },
    { kind: "supplier", amount: 540000, dueDate: "2026-07-15", description: "#SI-8821", counterparty: "Komponent AB" },
    { kind: "supplier", amount: 310000, dueDate: "2026-07-31", description: "#SI-8834", counterparty: "Fastighets AB" },
    { kind: "supplier", amount: 275000, dueDate: "2026-08-12", description: "#SI-8850", counterparty: "IT-Partner AB" },
  );

  // Liability balances are negative in this convention (credit-normal accounts,
  // same sign convention as CASH_POSITION's bank balance) — a negative number
  // here means money owed, matching what the real sync would store.
  TAX_LIABILITY = { vat: new Map(), payroll: new Map() };
  [-920000, -935000, -905000, -940000, -915000, -960000].forEach((bal, i) => TAX_LIABILITY.payroll.set(i + 1, bal));
  TAX_LIABILITY.vat.set(3, -410000);
  TAX_LIABILITY.vat.set(6, -395000);
}

// ---- Writes (granular Supabase updates, scoped by org via RLS) -------------

// Surfaces a save failure to the user (silence = success). RLS or network
// errors land here rather than failing silently.
// Brief bottom toast. kind "error" (red) for save failures, "info" for notices.
function showToast(message, kind = "info") {
  let el = document.getElementById("saveToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "saveToast";
    el.className = "save-toast";
    document.body.appendChild(el);
  }
  el.classList.toggle("error", kind === "error");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 5000);
}

function flagWriteError(error) {
  console.error("Save failed:", error);
  showToast(t("save_failed", error.message), "error");
}

async function dbUpdateAssumptions() {
  // Rates are org-shared (same across versions). Revenue is versioned — see
  // dbUpdateRevenuePlan (writes both the target and the monthly profile).
  const { error } = await sb.from("assumptions").update({
    employer_contribution_pct: ASSUMPTIONS.employerContributionPct,
    equipment_monthly: ASSUMPTIONS.equipmentMonthly,
    other_overhead_pct: ASSUMPTIONS.otherOverheadPct,
  }).eq("org_id", CURRENT_ORG_ID);
  if (error) flagWriteError(error);
}

// ---- Full data export (GDPR portability / "your data is yours") ------------
// Dumps every table this org owns, straight from the DB (RLS scopes each
// query), as one JSON download. Deliberately excluded: `integrations` and
// `oauth_states` — OAuth secrets/transient state, unreadable client-side by
// design (RLS deny-all) and not the user's business data.
const EXPORT_TABLES = [
  "assumptions", "roles", "reporting_lines", "headcount_lines", "one_offs",
  "recurring_costs", "monthly_actual", "forecast_overrides", "scenarios",
  "budget_versions", "reporting_line_mappings", "sync_exclusions",
  "cash_position", "open_invoices", "tax_liability_monthly", "actual_detail",
];

async function exportAllData() {
  if (DEMO_MODE) { showToast(t("toast_signin_export")); return; }
  const org = USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {};
  const out = {
    exported_at: new Date().toISOString(),
    app: "FP&A Planning",
    organization: org,
    note: "Every table stored for this organization. Excluded: OAuth tokens/state (secrets, not business data).",
    tables: {},
  };
  for (const tbl of EXPORT_TABLES) {
    const { data, error } = await sb.from(tbl).select("*").eq("org_id", CURRENT_ORG_ID);
    // Tolerant per-table: a missing/newer table shouldn't sink the whole export.
    out.tables[tbl] = error ? { export_error: error.message } : data;
  }
  const stRes = await sb.from("integration_status")
    .select("connected, tenant_name, last_synced_at, last_sync_error, last_reconciliation, last_reporting_lines, last_projects")
    .eq("org_id", CURRENT_ORG_ID).maybeSingle();
  out.tables.integration_status = stRes.error ? { export_error: stRes.error.message } : stRes.data;

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fpa-export-${(org.name || "org").replace(/[^\w-]+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(t("toast_export_done"));
}

// Org-level revenue (target + monthly profile) is versioned — it lives on the
// active plan version, so a scenario can vary the top line. Also keeps the
// in-memory activeVersion() copy in sync so a later re-read is correct.
async function dbUpdateRevenuePlan() {
  if (!assertEditable()) return;
  const av = activeVersion();
  if (av) { av.revenueBudget = ASSUMPTIONS.revenueBudget; av.revenuePlan = ASSUMPTIONS.revenuePlan; }
  const { error } = await sb.from("plan_versions")
    .update({ revenue_budget: ASSUMPTIONS.revenueBudget, revenue_plan: ASSUMPTIONS.revenuePlan })
    .eq("id", ACTIVE_VERSION_ID);
  if (error) flagWriteError(error);
}

async function dbUpdateTaxSettings() {
  const { error } = await sb.from("assumptions").update({
    vat_frequency: ASSUMPTIONS.vatFrequency,
    vat_account_from: ASSUMPTIONS.vatAccountFrom,
    vat_account_to: ASSUMPTIONS.vatAccountTo,
    payroll_account_from: ASSUMPTIONS.payrollAccountFrom,
    payroll_account_to: ASSUMPTIONS.payrollAccountTo,
  }).eq("org_id", CURRENT_ORG_ID);
  if (error) flagWriteError(error);
}

async function dbUpdateRole(role) {
  const { error } = await sb.from("roles")
    .update({ label: role.label, base_salary: role.baseSalary })
    .eq("id", role.id);
  if (error) flagWriteError(error);
}

async function dbInsertRole() {
  const { data, error } = await sb.from("roles")
    .insert({ org_id: CURRENT_ORG_ID, label: t("new_role_label"), base_salary: 35000 })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return { id: data.id, label: data.label, baseSalary: Number(data.base_salary) };
}

async function dbDeleteRole(id) {
  const { error } = await sb.from("roles").delete().eq("id", id);
  if (error) { flagWriteError(error); return false; }
  return true;
}

async function dbUpdateCostCenter(cc) {
  const { error } = await sb.from("reporting_lines")
    .update({ name: cc.name, annual_budget: cc.annualBudget, other_monthly: cc.otherMonthly })
    .eq("id", cc.id);
  if (error) flagWriteError(error);
}

async function dbInsertCostCenter() {
  const { data, error } = await sb.from("reporting_lines")
    .insert({ org_id: CURRENT_ORG_ID, name: t("new_reporting_line_name"), annual_budget: 0, other_monthly: 0 })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return { id: data.id, name: data.name, annualBudget: Number(data.annual_budget), otherMonthly: Number(data.other_monthly), isShared: false, headcount: [], oneOffs: [], recurringCosts: [], overrides: {}, utilization: null, actualMonthly: [] };
}

async function dbDeleteCostCenter(id) {
  const { error } = await sb.from("reporting_lines").delete().eq("id", id);
  if (error) { flagWriteError(error); return false; }
  return true;
}

// Separate + error-tolerant so the app still works before migration-notes.sql
// is run (the note column may not exist yet).
async function dbSetCostCenterNote(cc) {
  const { error } = await sb.from("reporting_lines").update({ note: cc.note || null }).eq("id", cc.id);
  if (error) flagWriteError(error);
}

// Per-line revenue (profit centre). Persists cc.revenuePlan; null clears it
// (the line reverts to a pure cost centre).
async function dbSetLineRevenue(cc) {
  if (!assertEditable()) return;
  // Per-line revenue is versioned: upsert into version_line_revenue for the
  // active version; clearing it (null) removes the row (line reverts to cost-only).
  if (cc.revenuePlan) {
    const { error } = await sb.from("version_line_revenue").upsert(
      { version_id: ACTIVE_VERSION_ID, org_id: CURRENT_ORG_ID, reporting_line_id: cc.id, revenue_plan: cc.revenuePlan },
      { onConflict: "version_id,reporting_line_id" });
    if (error) flagWriteError(error);
  } else {
    const { error } = await sb.from("version_line_revenue").delete()
      .eq("version_id", ACTIVE_VERSION_ID).eq("reporting_line_id", cc.id);
    if (error) flagWriteError(error);
  }
}

// Utilization / capacity driver — versioned, at most one per line. Upserts
// cc.utilization for the active version; null clears it (line reverts to
// manual planning). camelCase in-memory → snake_case row.
async function dbSetUtilization(cc) {
  if (!assertEditable()) return;
  const u = cc.utilization;
  if (u) {
    const { error } = await sb.from("utilization_drivers").upsert({
      version_id: ACTIVE_VERSION_ID, org_id: CURRENT_ORG_ID, reporting_line_id: cc.id,
      bill_rate: Number(u.billRate) || 0, utilization_pct: Number(u.utilizationPct) || 0,
      hours_per_head: Number(u.hoursPerHead) || 0, role_id: u.roleId || null,
      billable_hours: Array.isArray(u.billableHours) ? u.billableHours : null,
    }, { onConflict: "version_id,reporting_line_id" });
    if (error) flagWriteError(error);
  } else {
    const { error } = await sb.from("utilization_drivers").delete()
      .eq("version_id", ACTIVE_VERSION_ID).eq("reporting_line_id", cc.id);
    if (error) flagWriteError(error);
  }
}

// Month-end review ritual: mark/unmark a signal as reviewed. Optimistic on the
// in-memory Set so the checkbox responds instantly; reverted on write failure.
async function dbMarkReviewed(reportingLineId, month) {
  SIGNAL_REVIEWS.add(reportingLineId + ":" + month);
  const { error } = await sb.from("signal_reviews")
    .upsert({ org_id: CURRENT_ORG_ID, reporting_line_id: reportingLineId, month }, { onConflict: "org_id,reporting_line_id,month" });
  if (error) { SIGNAL_REVIEWS.delete(reportingLineId + ":" + month); flagWriteError(error); return false; }
  return true;
}

async function dbUnmarkReviewed(reportingLineId, month) {
  SIGNAL_REVIEWS.delete(reportingLineId + ":" + month);
  const { error } = await sb.from("signal_reviews").delete()
    .eq("org_id", CURRENT_ORG_ID).eq("reporting_line_id", reportingLineId).eq("month", month);
  if (error) { SIGNAL_REVIEWS.add(reportingLineId + ":" + month); flagWriteError(error); return false; }
  return true;
}

async function dbSetCostCenterShared(cc) {
  const { error } = await sb.from("reporting_lines").update({ is_shared: cc.isShared }).eq("id", cc.id);
  if (error) flagWriteError(error);
}

async function dbInsertHeadcount(ccId, line) {
  if (!assertEditable()) return null;
  const { data, error } = await sb.from("headcount_lines")
    .insert({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, role_id: line.roleId, count: line.count, start_month: line.startMonth, end_month: line.endMonth })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateHeadcount(line) {
  if (!assertEditable()) return;
  const { error } = await sb.from("headcount_lines")
    .update({ role_id: line.roleId, count: line.count, start_month: line.startMonth, end_month: line.endMonth })
    .eq("id", line.id);
  if (error) flagWriteError(error);
}

async function dbDeleteHeadcount(id) {
  if (!assertEditable()) return;
  const { error } = await sb.from("headcount_lines").delete().eq("id", id);
  if (error) flagWriteError(error);
}

async function dbInsertOneOff(ccId, o) {
  if (!assertEditable()) return null;
  const { data, error } = await sb.from("one_offs")
    .insert({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, label: o.label, amount: o.amount, month: o.month })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateOneOff(o) {
  if (!assertEditable()) return;
  const { error } = await sb.from("one_offs")
    .update({ label: o.label, amount: o.amount, month: o.month })
    .eq("id", o.id);
  if (error) flagWriteError(error);
}

async function dbDeleteOneOff(id) {
  if (!assertEditable()) return;
  const { error } = await sb.from("one_offs").delete().eq("id", id);
  if (error) flagWriteError(error);
}

async function dbInsertRecurringCost(ccId, r) {
  if (!assertEditable()) return null;
  const { data, error } = await sb.from("recurring_costs")
    .insert({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, label: r.label, amount: r.amount, start_month: r.startMonth, end_month: r.endMonth, escalation_pct: r.escalationPct })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateRecurringCost(r) {
  if (!assertEditable()) return;
  const { error } = await sb.from("recurring_costs")
    .update({ label: r.label, amount: r.amount, start_month: r.startMonth, end_month: r.endMonth, escalation_pct: r.escalationPct })
    .eq("id", r.id);
  if (error) flagWriteError(error);
}

async function dbDeleteRecurringCost(id) {
  if (!assertEditable()) return;
  const { error } = await sb.from("recurring_costs").delete().eq("id", id);
  if (error) flagWriteError(error);
}

// Re-forecast: average the last up-to-3 CLOSED (actual) months for this cost
// centre, and apply that run-rate as an explicit override for every remaining
// month (CLOSE_MONTH+1 through the end of the timeline). Only ever called by
// a user clicking "Apply" — never by a sync. Returns the run-rate, or null if
// there's no actual data yet to base one on.
async function dbApplyRunRate(cc) {
  if (!assertEditable()) return null;
  const recent = [];
  for (let m = CLOSE_MONTH; m >= 1 && recent.length < 3; m--) {
    const v = cc.actualMonthly[m - 1];
    if (v != null) recent.push(v);
  }
  if (recent.length === 0) return null;
  const runRate = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);

  const rows = [];
  for (let m = CLOSE_MONTH + 1; m <= TIMELINE_LENGTH; m++) rows.push({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: cc.id, month: m, amount: runRate });
  const { error } = await sb.from("forecast_overrides").upsert(rows, { onConflict: "version_id,reporting_line_id,month" });
  if (error) { flagWriteError(error); return null; }
  rows.forEach((r) => (cc.overrides[r.month] = runRate));
  return runRate;
}

// Reversible: delete the override rows and the driver-based forecast resumes
// unchanged (headcount/one-offs/recurring costs were never touched).
async function dbClearOverrides(cc) {
  if (!assertEditable()) return false;
  const { error } = await sb.from("forecast_overrides").delete()
    .eq("reporting_line_id", cc.id).eq("version_id", ACTIVE_VERSION_ID);
  if (error) { flagWriteError(error); return false; }
  cc.overrides = {};
  return true;
}

async function dbUpdateCloseMonth() {
  const { error } = await sb.from("organizations")
    .update({ close_month: CLOSE_MONTH, close_month_manual: CLOSE_MONTH_MANUAL })
    .eq("id", CURRENT_ORG_ID);
  if (error) flagWriteError(error);
}

// Bulk import actuals. rows: [{ reporting_line_id, month, amount }].
// Upserts on the (reporting_line_id, month) unique key, so re-importing a month
// overwrites rather than duplicating.
async function dbUpsertActuals(rows) {
  const payload = rows.map((r) => ({ org_id: CURRENT_ORG_ID, reporting_line_id: r.reporting_line_id, month: r.month, amount: r.amount }));
  const { error } = await sb.from("monthly_actual").upsert(payload, { onConflict: "reporting_line_id,month" });
  if (error) { flagWriteError(error); return false; }
  return true;
}

// Parse a simple CSV of actuals: one row per value, columns
// "Reporting Line", "Month (1–24)", "Amount", separated by ; , or tab.
// A header row is auto-skipped (its month field isn't numeric). Reporting lines
// are matched by name (case-insensitive); unmatched names are reported, not imported.
function parseActualsCsv(text) {
  const rows = [];
  const unmatched = new Set();
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (parts.length < 3) { skipped++; continue; }

    const [name, monthStr, amountStr] = parts;
    const month = parseInt(monthStr, 10);
    const amount = Number(amountStr.replace(/\s/g, ""));
    if (isNaN(month) || month < 1 || month > TIMELINE_LENGTH || isNaN(amount)) { skipped++; continue; }

    const cc = COST_CENTERS.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cc) { unmatched.add(name); continue; }

    rows.push({ reporting_line_id: cc.id, month, amount });
  }

  return { rows, unmatched: [...unmatched], skipped };
}

// (Scenarios and budgets used to be immutable snapshots in their own tables.
// They're now real, editable plan_versions — see copyActiveVersion /
// dbCreateVersion / dbLockAsBudget above — so dbSaveScenario / dbDeleteScenario
// / dbLockBudgetVersion are gone. Comparison is live via VERSION_SUMMARIES.)

// Stand up a brand-new tenant via the locked-down server-side function — one
// atomic call that creates the org, your owner membership, and default
// assumptions. The client can't touch memberships directly (security).
async function createOrg() {
  if (DEMO_MODE) { showToast(t("toast_signin_create_org")); return; }
  const name = prompt(t("prompt_new_org_name"));
  if (!name || !name.trim()) return;

  const { data, error } = await sb.rpc("create_organization", { org_name: name.trim() });
  if (error) { flagWriteError(error); return; }

  localStorage.setItem(ORG_STORAGE_KEY, data);
  location.reload();
}

// ---- Shared formatting -----------------------------------------------------

// Display unit is per-org: real orgs default to thousands (tkr, the SME standard),
// while the sample/demo uses millions (mkr) because its figures are much larger.
// Suffixes respect the org's accounting currency (SEK → kr/tkr/mkr; EUR → €/t€/M€).
let CURRENCY = "SEK";
function currencyBase() { return CURRENCY === "SEK" ? "kr" : CURRENCY === "EUR" ? "€" : CURRENCY; }
function unitCfg() {
  const base = currencyBase();
  const units = {
    kr:  { div: 1,         suffix: base,       dec: 0 },
    tkr: { div: 1000,      suffix: "t" + base, dec: 0 },
    mkr: { div: 1_000_000, suffix: "m" + base, dec: 1 },
  };
  return units[DISPLAY_UNIT] || units.mkr;
}

function fmtMkr(n) {
  const u = unitCfg();
  return (n / u.div).toLocaleString("sv-SE", { minimumFractionDigits: u.dec, maximumFractionDigits: u.dec }) + " " + u.suffix;
}

function fmtMkrSigned(n) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + fmtMkr(Math.abs(n));
}

function fmtSek(n) {
  const sign = n < 0 ? "−" : "";
  return sign + Math.round(Math.abs(n)).toLocaleString("sv-SE") + " " + currencyBase();
}

function varianceClass(variance, budget) {
  const pct = budget ? (variance / budget) * 100 : 0;
  if (pct > 1) return "over";
  if (pct < -1) return "under";
  return "neutral";
}

// Researched starter shapes for common SME setups (steal-list: "arrive
// prepared" — a controller shouldn't hear "never seen that before" from us).
// Each maps to how that business type TYPICALLY tags its Fortnox bookings, so
// picking one also sets expectations for the Fortnox mapping step later.
const BUSINESS_PRESETS = {
  manufacturer: {
    label: t("preset_manufacturer_label"),
    hint: t("preset_manufacturer_hint"),
    roles: [["Manager", 55000], ["Specialist", 42000], ["Associate", 33000], ["Support", 30000]],
    costCenters: [
      // Production is a profit centre — the factory sells what it makes, so it
      // carries per-line revenue (→ margin). Shows the per-line-revenue style.
      { name: "Production", budget: 12000000, other: 300000, hc: [["Manager", 1], ["Specialist", 4], ["Associate", 6]], revenue: 22000000 },
      { name: "Sales & Marketing", budget: 6000000, other: 150000, hc: [["Manager", 1], ["Associate", 4]] },
      { name: "Administration", budget: 3000000, other: 120000, hc: [["Support", 2]] },
    ],
  },
  consultancy: {
    label: t("preset_consultancy_label"),
    hint: t("preset_consultancy_hint"),
    roles: [["Partner", 75000], ["Senior Consultant", 55000], ["Consultant", 42000], ["Ops & Admin", 33000]],
    costCenters: [
      // Client Delivery is planned by the utilization driver (billable hours →
      // revenue, and → the delivery headcount needed), not manual headcount —
      // the services/consulting planning style. BD + Ops stay manual overhead.
      { name: "Client Delivery", budget: 14000000, other: 100000, hc: [],
        util: { billRate: 1250, utilizationPct: 72, hoursPerHead: 160, roleLabel: "Consultant", billableHours: 1350 } },
      { name: "Business Development", budget: 2500000, other: 80000, hc: [["Partner", 1]] },
      { name: "Operations", budget: 2000000, other: 90000, hc: [["Ops & Admin", 2]] },
    ],
  },
  retail: {
    label: t("preset_retail_label"),
    hint: t("preset_retail_hint"),
    roles: [["Store/Ops Manager", 45000], ["Warehouse Staff", 32000], ["E-com & Marketing", 38000], ["Support", 29000]],
    costCenters: [
      { name: "COGS & Merchandising", budget: 18000000, other: 400000, hc: [["Store/Ops Manager", 1]] },
      { name: "Logistics & Fulfilment", budget: 4000000, other: 250000, hc: [["Warehouse Staff", 4]] },
      { name: "Marketing", budget: 3000000, other: 120000, hc: [["E-com & Marketing", 2]] },
    ],
  },
  service: {
    label: t("preset_service_label"),
    hint: t("preset_service_hint"),
    roles: [["Owner/Manager", 45000], ["Staff", 32000]],
    costCenters: [
      { name: "Operations", budget: 4000000, other: 150000, hc: [["Owner/Manager", 1], ["Staff", 3]] },
    ],
  },
};

// Shown on Overview/Monthly when an organization has no reporting lines yet.
// Three ranked paths to real numbers (TEARDOWN C11: connect-the-ledger comes
// first — it's the fastest route to a trustworthy number, ahead of both the
// preset shortcut and manual entry). onboardIntegrationPanel is populated
// separately by renderIntegrationPanel() once this markup is in the DOM,
// reusing the exact same connect flow already shipped on Monthly — no new
// OAuth code, just a second place it's offered.
function emptyOrgHtml() {
  const presetButtons = Object.entries(BUSINESS_PRESETS).map(([key, p]) =>
    `<button class="preset-card" data-loadpreset="${key}" type="button">
       <strong>${p.label}</strong>
       <span>${p.hint}</span>
     </button>`).join("");
  return `
    <div class="empty-state">
      <h2>${t("empty_org_h2")}</h2>
      <p>${t("empty_org_intro")}</p>

      <div class="empty-option empty-option-primary">
        <div class="empty-option-kicker">${t("empty_org_option_fortnox")}</div>
        <div id="onboardIntegrationPanel"></div>
      </div>

      <div class="empty-option">
        <div class="empty-option-kicker">${t("empty_org_option_preset")}</div>
        <div class="preset-grid">${presetButtons}</div>
      </div>

      <div class="empty-option">
        <div class="empty-option-kicker">${t("empty_org_option_manual")}</div>
        <ol>
          <li>${t("empty_org_step1")}</li>
          <li>${t("empty_org_step2")}</li>
        </ol>
        <a class="empty-cta" href="assumptions.html">${t("empty_org_cta")}</a>
      </div>
    </div>`;
}

// One-click onboarding: fill the current (empty) org with a small working
// sample company shaped like the chosen business type, so a new user starts
// from something real (and already-labelled the way their Fortnox books
// probably look) instead of a blank app or a one-size-fits-all example.
async function seedPreset(presetKey) {
  if (DEMO_MODE) { showToast(t("toast_signin_save_data")); return false; }
  const preset = BUSINESS_PRESETS[presetKey];
  if (!preset) return false;

  const roleIds = {};
  for (const [label, base] of preset.roles) {
    const { data, error } = await sb.from("roles").insert({ org_id: CURRENT_ORG_ID, label, base_salary: base }).select().single();
    if (error) { flagWriteError(error); return false; }
    roleIds[label] = data.id;
  }

  for (const cc of preset.costCenters) {
    const { data: ccRow, error } = await sb.from("reporting_lines")
      .insert({ org_id: CURRENT_ORG_ID, name: cc.name, annual_budget: cc.budget, other_monthly: 0 })
      .select().single();
    if (error) { flagWriteError(error); return false; }
    const ccId = ccRow.id;

    // Utilization-planned lines carry no manual headcount (hc: []) — skip the
    // insert entirely rather than sending an empty array.
    if (cc.hc.length) {
      const hcRows = cc.hc.map(([label, count]) => ({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, role_id: roleIds[label], count, start_month: 1, end_month: 24 }));
      const hcRes = await sb.from("headcount_lines").insert(hcRows);
      if (hcRes.error) { flagWriteError(hcRes.error); return false; }
    }

    const rcRes = await sb.from("recurring_costs")
      .insert({ org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, label: "Other costs", amount: cc.other, start_month: 1, end_month: 24, escalation_pct: 0 });
    if (rcRes.error) { flagWriteError(rcRes.error); return false; }

    // Utilization driver (consulting-style delivery lines) — hours × rate is the
    // revenue and derives the delivery headcount, so no manual hc is seeded.
    if (cc.util) {
      const hoursArr = Array.isArray(cc.util.billableHours) ? cc.util.billableHours : Array(12).fill(cc.util.billableHours);
      const udRes = await sb.from("utilization_drivers").insert({
        org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId,
        bill_rate: cc.util.billRate, utilization_pct: cc.util.utilizationPct, hours_per_head: cc.util.hoursPerHead,
        role_id: roleIds[cc.util.roleLabel] || null, billable_hours: hoursArr,
      });
      if (udRes.error) { flagWriteError(udRes.error); return false; }
    }

    // Per-line revenue (profit-centre lines) — flat annual spread; makes the
    // line show a margin. Versioned, on the active version.
    if (cc.revenue) {
      const revArr = Array.isArray(cc.revenue) ? cc.revenue : Array(12).fill(Math.round(cc.revenue / 12));
      const vlrRes = await sb.from("version_line_revenue").insert({
        org_id: CURRENT_ORG_ID, version_id: ACTIVE_VERSION_ID, reporting_line_id: ccId, revenue_plan: revArr,
      });
      if (vlrRes.error) { flagWriteError(vlrRes.error); return false; }
    }

    // Believable 6 months of actuals derived from the monthly budget run-rate
    // (small variation), so the example shows a real actual/forecast split.
    const monthlyBudget = (cc.budget + cc.other * 12) / 12;
    const factors = [0.93, 0.97, 1.02, 0.99, 1.01, 0.98];
    const actRows = factors.map((f, i) => ({
      org_id: CURRENT_ORG_ID, reporting_line_id: ccId, month: i + 1,
      amount: Math.round((monthlyBudget * f) / 1000) * 1000,
    }));
    const actRes = await sb.from("monthly_actual").insert(actRows);
    if (actRes.error) { flagWriteError(actRes.error); return false; }
  }

  // Book actuals through month 6 so the example shows an actual/forecast split.
  await sb.from("organizations").update({ close_month: 6 }).eq("id", CURRENT_ORG_ID);
  return true;
}

// Delegated handler for the empty-state preset buttons (works on any page
// that renders emptyOrgHtml).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-loadpreset]");
  if (!btn) return;
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = t("loading_btn");
  const ok = await seedPreset(btn.dataset.loadpreset);
  if (ok) location.reload();
  else { btn.disabled = false; btn.innerHTML = orig; }
});
