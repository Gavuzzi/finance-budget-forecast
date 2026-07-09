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
let BUDGET_VERSIONS = []; // locked budget snapshots, newest first
let CASH_POSITION = null; // { bankBalance, asOf } — from the last sync's SIE #UB lines
let OPEN_INVOICES = [];   // [{ kind: 'customer'|'supplier', amount, dueDate, description, counterparty }]
// VAT/payroll-tax closing balances by FY-relative month, from the sync's #IB +
// #TRANS tracking of the configured account ranges — an ESTIMATE of what's
// owed, kept separate from OPEN_INVOICES (a hard Fortnox figure).
let TAX_LIABILITY = { vat: new Map(), payroll: new Map() };
let SCENARIOS = [];
// Freshness of the Fortnox connection, for the sidebar badge — null for orgs
// that aren't connected (manual/CSV orgs get no badge, no nagging).
let SYNC_STATUS = null; // { connected, last_synced_at, last_sync_error }
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

function forecastForMonth(cc, month) {
  return headcountCostForMonth(cc, month) + oneOffCostForMonth(cc, month) + recurringCostForMonth(cc, month);
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
  let actual = 0, overridden = 0, headcount = 0, oneOff = 0, recurring = 0;
  for (let m = 1; m <= FY_MONTHS; m++) {
    const a = monthAmount(cc, m);
    if (a.isActual) { actual += a.value; continue; }
    if (a.isOverridden) { overridden += a.value; continue; }
    headcount += headcountCostForMonth(cc, m);
    oneOff += oneOffCostForMonth(cc, m);
    recurring += recurringCostForMonth(cc, m);
  }
  return { actual, overridden, headcount, oneOff, recurring, total: actual + overridden + headcount + oneOff + recurring };
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

// Runway cap: how far ahead we'll walk looking for a zero-crossing before
// giving up and calling it cash-positive. Matches the driver forecast's own
// horizon — there's no data to project operating costs beyond it anyway.
const RUNWAY_HORIZON_MONTHS = TIMELINE_LENGTH;

function cashFlowProjection(monthsAhead = 6) {
  if (!CASH_POSITION) return null;
  const nowIdx = cashFlowMonthIndex(new Date().toISOString().slice(0, 10));

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

// ---- Budget versioning (locked baseline vs the live, editable budget) ------
// "Variance vs budget" above always compares to the CURRENT annualBudget,
// which keeps moving as people edit it. A locked version freezes a snapshot so
// you can also see "vs what was approved" — and whether the live plan has
// since drifted from it.

function latestBudgetVersion() {
  return BUDGET_VERSIONS[0] || null;
}

function currentBudgetTotal() {
  return COST_CENTERS.reduce((s, cc) => s + cc.annualBudget, 0);
}

// null when there's no locked version yet, or once one exists but nothing has
// drifted (nothing to flag).
function budgetDrift() {
  const v = latestBudgetVersion();
  if (!v) return null;
  const diff = currentBudgetTotal() - v.total;
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

async function loadData(orgId) {
  // Which orgs does this user belong to? RLS returns only their memberships.
  const orgsRes = await sb.from("organizations").select("*").order("name");
  if (orgsRes.error) throw new Error(orgsRes.error.message);
  USER_ORGS = orgsRes.data;
  if (USER_ORGS.length === 0) throw new Error("No organization is linked to your login.");

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

  // Everything else is filtered to the active org (there may be several now).
  const [assRes, rolesRes, ccRes, hcRes, ooRes, actRes] = await Promise.all([
    sb.from("assumptions").select("*").eq("org_id", CURRENT_ORG_ID).single(),
    sb.from("roles").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("reporting_lines").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("headcount_lines").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("one_offs").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("monthly_actual").select("*").eq("org_id", CURRENT_ORG_ID),
  ]);

  const failed = [assRes, rolesRes, ccRes, hcRes, ooRes, actRes].find((r) => r.error);
  if (failed) throw new Error(failed.error.message);

  Object.assign(ASSUMPTIONS, {
    employerContributionPct: Number(assRes.data.employer_contribution_pct),
    equipmentMonthly: Number(assRes.data.equipment_monthly),
    otherOverheadPct: Number(assRes.data.other_overhead_pct),
    revenueBudget: Number(assRes.data.revenue_budget || 0),
    // Optional 12-month revenue profile; anything malformed loads as null and
    // the engine falls back to flat revenueBudget/12 (the pre-plan behavior).
    revenuePlan: Array.isArray(assRes.data.revenue_plan) && assRes.data.revenue_plan.length === 12
      ? assRes.data.revenue_plan.map((v) => Number(v) || 0)
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
        headcount: hcRes.data
          .filter((h) => h.reporting_line_id === cc.id)
          .map((h) => ({ id: h.id, roleId: h.role_id, count: h.count, startMonth: h.start_month, endMonth: h.end_month })),
        oneOffs: ooRes.data
          .filter((o) => o.reporting_line_id === cc.id)
          .map((o) => ({ id: o.id, label: o.label, amount: Number(o.amount), month: o.month })),
        recurringCosts: [],
        overrides: {},
        actualMonthly,
      });
    });

  // Recurring costs — loaded tolerantly (like scenarios) in case an older DB
  // hasn't run the migration yet; the app still works, just with no recurring lines.
  const rcRes = await sb.from("recurring_costs").select("*").eq("org_id", CURRENT_ORG_ID);
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
  const foRes = await sb.from("forecast_overrides").select("*").eq("org_id", CURRENT_ORG_ID);
  if (!foRes.error) {
    foRes.data.forEach((o) => {
      const cc = COST_CENTERS.find((c) => c.id === o.reporting_line_id);
      if (cc) cc.overrides[o.month] = Number(o.amount);
    });
  }

  // Scenarios are optional — the table may not exist until migration-scenarios.sql
  // is run — so load them tolerantly; the app works either way.
  SCENARIOS.length = 0;
  const scenRes = await sb.from("scenarios").select("*").eq("org_id", CURRENT_ORG_ID).order("created_at");
  if (!scenRes.error) scenRes.data.forEach((s) => SCENARIOS.push({ id: s.id, name: s.name, fyTotal: Number(s.fy_total), breakdown: (s.snapshot && s.snapshot.breakdown) || [] }));

  // Budget versions — likewise optional/tolerant (table may not exist yet on an older DB).
  BUDGET_VERSIONS.length = 0;
  const bvRes = await sb.from("budget_versions").select("*").eq("org_id", CURRENT_ORG_ID).order("locked_at", { ascending: false });
  if (!bvRes.error) bvRes.data.forEach((v) => BUDGET_VERSIONS.push({ id: v.id, name: v.name, lockedAt: v.locked_at, snapshot: v.snapshot, total: Number(v.total) }));

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
  SCENARIOS.length = 0;
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
  if (itCc) itCc.note = "DevOps contractor hire delayed to Q4 — running under budget.";

  SCENARIOS.push(
    { id: "s1", name: "Base", fyTotal: 41800000, breakdown: [{ name: "Production", total: 28600000 }, { name: "R&D", total: 9300000 }, { name: "IT", total: 3900000 }] },
    { id: "s2", name: "Hiring freeze", fyTotal: 39500000, breakdown: [{ name: "Production", total: 27000000 }, { name: "R&D", total: 8600000 }, { name: "IT", total: 3900000 }] },
  );

  BUDGET_VERSIONS.length = 0;
  BUDGET_VERSIONS.push({ id: "bv1", name: "FY2026 Budget", lockedAt: "2026-01-15T09:00:00Z", snapshot: { c1: 28000000, c2: 9000000, c3: 5000000 }, total: 42000000 });

  // Seasonal revenue profile summing to exactly the 50.0M annual target —
  // July dips (industrisemester), Q4 pushes. Gives the demo a non-flat cash
  // curve and exercises the plan → forecast-P&L → cash-flow chain.
  ASSUMPTIONS.revenuePlan = [4200000, 4200000, 4600000, 4400000, 4300000, 4100000, 3000000, 3600000, 4400000, 4600000, 4600000, 4000000];

  // Badge demo: synced a few hours ago, healthy.
  SYNC_STATUS = { connected: true, last_synced_at: new Date(Date.now() - 3 * 3600000).toISOString(), last_sync_error: null };

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
  showToast("Save failed — " + error.message, "error");
}

async function dbUpdateAssumptions() {
  const { error } = await sb.from("assumptions").update({
    employer_contribution_pct: ASSUMPTIONS.employerContributionPct,
    equipment_monthly: ASSUMPTIONS.equipmentMonthly,
    other_overhead_pct: ASSUMPTIONS.otherOverheadPct,
    revenue_budget: ASSUMPTIONS.revenueBudget,
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
  if (DEMO_MODE) { showToast("Sign in to export your own workspace."); return; }
  const org = USER_ORGS.find((o) => o.id === CURRENT_ORG_ID) || {};
  const out = {
    exported_at: new Date().toISOString(),
    app: "FP&A Planning",
    organization: org,
    note: "Every table stored for this organization. Excluded: OAuth tokens/state (secrets, not business data).",
    tables: {},
  };
  for (const t of EXPORT_TABLES) {
    const { data, error } = await sb.from(t).select("*").eq("org_id", CURRENT_ORG_ID);
    // Tolerant per-table: a missing/newer table shouldn't sink the whole export.
    out.tables[t] = error ? { export_error: error.message } : data;
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
  showToast("Export downloaded — everything this organization stores, as JSON.");
}

async function dbUpdateRevenuePlan() {
  const { error } = await sb.from("assumptions")
    .update({ revenue_plan: ASSUMPTIONS.revenuePlan })
    .eq("org_id", CURRENT_ORG_ID);
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
    .insert({ org_id: CURRENT_ORG_ID, label: "New role", base_salary: 35000 })
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
    .insert({ org_id: CURRENT_ORG_ID, name: "New reporting line", annual_budget: 0, other_monthly: 0 })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return { id: data.id, name: data.name, annualBudget: Number(data.annual_budget), otherMonthly: Number(data.other_monthly), isShared: false, headcount: [], oneOffs: [], recurringCosts: [], overrides: {}, actualMonthly: [] };
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

async function dbSetCostCenterShared(cc) {
  const { error } = await sb.from("reporting_lines").update({ is_shared: cc.isShared }).eq("id", cc.id);
  if (error) flagWriteError(error);
}

async function dbInsertHeadcount(ccId, line) {
  const { data, error } = await sb.from("headcount_lines")
    .insert({ org_id: CURRENT_ORG_ID, reporting_line_id: ccId, role_id: line.roleId, count: line.count, start_month: line.startMonth, end_month: line.endMonth })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateHeadcount(line) {
  const { error } = await sb.from("headcount_lines")
    .update({ role_id: line.roleId, count: line.count, start_month: line.startMonth, end_month: line.endMonth })
    .eq("id", line.id);
  if (error) flagWriteError(error);
}

async function dbDeleteHeadcount(id) {
  const { error } = await sb.from("headcount_lines").delete().eq("id", id);
  if (error) flagWriteError(error);
}

async function dbInsertOneOff(ccId, o) {
  const { data, error } = await sb.from("one_offs")
    .insert({ org_id: CURRENT_ORG_ID, reporting_line_id: ccId, label: o.label, amount: o.amount, month: o.month })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateOneOff(o) {
  const { error } = await sb.from("one_offs")
    .update({ label: o.label, amount: o.amount, month: o.month })
    .eq("id", o.id);
  if (error) flagWriteError(error);
}

async function dbDeleteOneOff(id) {
  const { error } = await sb.from("one_offs").delete().eq("id", id);
  if (error) flagWriteError(error);
}

async function dbInsertRecurringCost(ccId, r) {
  const { data, error } = await sb.from("recurring_costs")
    .insert({ org_id: CURRENT_ORG_ID, reporting_line_id: ccId, label: r.label, amount: r.amount, start_month: r.startMonth, end_month: r.endMonth, escalation_pct: r.escalationPct })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return data.id;
}

async function dbUpdateRecurringCost(r) {
  const { error } = await sb.from("recurring_costs")
    .update({ label: r.label, amount: r.amount, start_month: r.startMonth, end_month: r.endMonth, escalation_pct: r.escalationPct })
    .eq("id", r.id);
  if (error) flagWriteError(error);
}

async function dbDeleteRecurringCost(id) {
  const { error } = await sb.from("recurring_costs").delete().eq("id", id);
  if (error) flagWriteError(error);
}

// Re-forecast: average the last up-to-3 CLOSED (actual) months for this cost
// centre, and apply that run-rate as an explicit override for every remaining
// month (CLOSE_MONTH+1 through the end of the timeline). Only ever called by
// a user clicking "Apply" — never by a sync. Returns the run-rate, or null if
// there's no actual data yet to base one on.
async function dbApplyRunRate(cc) {
  const recent = [];
  for (let m = CLOSE_MONTH; m >= 1 && recent.length < 3; m--) {
    const v = cc.actualMonthly[m - 1];
    if (v != null) recent.push(v);
  }
  if (recent.length === 0) return null;
  const runRate = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);

  const rows = [];
  for (let m = CLOSE_MONTH + 1; m <= TIMELINE_LENGTH; m++) rows.push({ org_id: CURRENT_ORG_ID, reporting_line_id: cc.id, month: m, amount: runRate });
  const { error } = await sb.from("forecast_overrides").upsert(rows, { onConflict: "reporting_line_id,month" });
  if (error) { flagWriteError(error); return null; }
  rows.forEach((r) => (cc.overrides[r.month] = runRate));
  return runRate;
}

// Reversible: delete the override rows and the driver-based forecast resumes
// unchanged (headcount/one-offs/recurring costs were never touched).
async function dbClearOverrides(cc) {
  const { error } = await sb.from("forecast_overrides").delete().eq("reporting_line_id", cc.id);
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

async function dbSaveScenario(name) {
  const breakdown = COST_CENTERS.map((cc) => ({ name: cc.name, total: fySummary(cc).total }));
  const fyTotal = companyFySummary().total;
  const { data, error } = await sb.from("scenarios")
    .insert({ org_id: CURRENT_ORG_ID, name, fy_total: fyTotal, snapshot: { breakdown } })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return { id: data.id, name: data.name, fyTotal: Number(data.fy_total), breakdown };
}

async function dbDeleteScenario(id) {
  const { error } = await sb.from("scenarios").delete().eq("id", id);
  if (error) { flagWriteError(error); return false; }
  return true;
}

// Lock the CURRENT annualBudget of every cost centre into a named, permanent
// snapshot. Doesn't touch the live budget — that stays editable — so future
// edits can be measured against "what was approved" via budgetDrift().
async function dbLockBudgetVersion(name) {
  const snapshot = Object.fromEntries(COST_CENTERS.map((cc) => [cc.id, cc.annualBudget]));
  const total = currentBudgetTotal();
  const { data, error } = await sb.from("budget_versions")
    .insert({ org_id: CURRENT_ORG_ID, name, snapshot, total })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  const version = { id: data.id, name: data.name, lockedAt: data.locked_at, snapshot: data.snapshot, total: Number(data.total) };
  BUDGET_VERSIONS.unshift(version);
  return version;
}

// Stand up a brand-new tenant via the locked-down server-side function — one
// atomic call that creates the org, your owner membership, and default
// assumptions. The client can't touch memberships directly (security).
async function createOrg() {
  if (DEMO_MODE) { showToast("Sign in to create your own workspace."); return; }
  const name = prompt("Name the new organization:");
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
    label: "Manufacturer",
    hint: "Departments as cost centres — typically maps by Fortnox kostnadsställe.",
    roles: [["Manager", 55000], ["Specialist", 42000], ["Associate", 33000], ["Support", 30000]],
    costCenters: [
      { name: "Production", budget: 12000000, other: 300000, hc: [["Manager", 1], ["Specialist", 4], ["Associate", 6]] },
      { name: "Sales & Marketing", budget: 6000000, other: 150000, hc: [["Manager", 1], ["Associate", 4]] },
      { name: "Administration", budget: 3000000, other: 120000, hc: [["Support", 2]] },
    ],
  },
  consultancy: {
    label: "Consultancy / agency",
    hint: "People-heavy, engagement-based — typically maps by Fortnox PROJECT, not cost centre.",
    roles: [["Partner", 75000], ["Senior Consultant", 55000], ["Consultant", 42000], ["Ops & Admin", 33000]],
    costCenters: [
      { name: "Client Delivery", budget: 14000000, other: 100000, hc: [["Senior Consultant", 3], ["Consultant", 5]] },
      { name: "Business Development", budget: 2500000, other: 80000, hc: [["Partner", 1]] },
      { name: "Operations", budget: 2000000, other: 90000, hc: [["Ops & Admin", 2]] },
    ],
  },
  retail: {
    label: "Retail / e-commerce",
    hint: "COGS-heavy, thin cost-centre use — typically maps by BAS account groups instead.",
    roles: [["Store/Ops Manager", 45000], ["Warehouse Staff", 32000], ["E-com & Marketing", 38000], ["Support", 29000]],
    costCenters: [
      { name: "COGS & Merchandising", budget: 18000000, other: 400000, hc: [["Store/Ops Manager", 1]] },
      { name: "Logistics & Fulfilment", budget: 4000000, other: 250000, hc: [["Warehouse Staff", 4]] },
      { name: "Marketing", budget: 3000000, other: 120000, hc: [["E-com & Marketing", 2]] },
    ],
  },
  service: {
    label: "Small service business",
    hint: "Often books with no cost-centre or project tags at all — map by BAS account ranges instead.",
    roles: [["Owner/Manager", 45000], ["Staff", 32000]],
    costCenters: [
      { name: "Operations", budget: 4000000, other: 150000, hc: [["Owner/Manager", 1], ["Staff", 3]] },
    ],
  },
};

// Shown on Overview/Monthly when an organization has no reporting lines yet.
function emptyOrgHtml() {
  const presetButtons = Object.entries(BUSINESS_PRESETS).map(([key, p]) =>
    `<button class="preset-card" data-loadpreset="${key}" type="button">
       <strong>${p.label}</strong>
       <span>${p.hint}</span>
     </button>`).join("");
  return `
    <div class="empty-state">
      <h2>Let's set up this organization</h2>
      <p>There are no reporting lines here yet. Two quick steps and the forecast comes to life:</p>
      <ol>
        <li>Add your <strong>roles</strong> and their salaries on the <a href="assumptions.html">Assumptions</a> page.</li>
        <li>Add <strong>reporting lines</strong> and their headcount on the <a href="planning.html">Planning</a> page.</li>
      </ol>
      <a class="empty-cta" href="assumptions.html">Start on Assumptions →</a>
      <p class="preset-lead">Or start from what's closest to your business — a working example you edit from there:</p>
      <div class="preset-grid">${presetButtons}</div>
    </div>`;
}

// One-click onboarding: fill the current (empty) org with a small working
// sample company shaped like the chosen business type, so a new user starts
// from something real (and already-labelled the way their Fortnox books
// probably look) instead of a blank app or a one-size-fits-all example.
async function seedPreset(presetKey) {
  if (DEMO_MODE) { showToast("Sign in to save your own data."); return false; }
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

    const hcRows = cc.hc.map(([label, count]) => ({ org_id: CURRENT_ORG_ID, reporting_line_id: ccId, role_id: roleIds[label], count, start_month: 1, end_month: 24 }));
    const hcRes = await sb.from("headcount_lines").insert(hcRows);
    if (hcRes.error) { flagWriteError(hcRes.error); return false; }

    const rcRes = await sb.from("recurring_costs")
      .insert({ org_id: CURRENT_ORG_ID, reporting_line_id: ccId, label: "Other costs", amount: cc.other, start_month: 1, end_month: 24, escalation_pct: 0 });
    if (rcRes.error) { flagWriteError(rcRes.error); return false; }

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
  btn.innerHTML = "<strong>Loading…</strong>";
  const ok = await seedPreset(btn.dataset.loadpreset);
  if (ok) location.reload();
  else { btn.disabled = false; btn.innerHTML = orig; }
});
