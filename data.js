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

function monthLabel(m) {
  const name = MONTH_NAMES[(m - 1) % 12];
  const year = 26 + Math.floor((m - 1) / 12);
  return `${name} ${year}`;
}

const TIMELINE_LENGTH = 24; // FY2026 (1-12) + FY2027 (13-24)
const FY_MONTHS = 12;
const MAX_CLOSE_MONTH = 9; // how far the seeded fixture actuals go

// Populated by loadData() from the database.
let CLOSE_MONTH = 6;
let CURRENT_ORG_ID = null;
let USER_ORGS = [];
const ORG_STORAGE_KEY = "almgren-current-org";
const ROLE_CATALOG = [];
const ASSUMPTIONS = { employerContributionPct: 31.42, equipmentMonthly: 1200, otherOverheadPct: 4 };
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

function forecastForMonth(cc, month) {
  return headcountCostForMonth(cc, month) + oneOffCostForMonth(cc, month) + cc.otherMonthly;
}

function monthAmount(cc, month) {
  if (month <= CLOSE_MONTH && cc.actualMonthly[month - 1] != null) {
    return { value: cc.actualMonthly[month - 1], isActual: true };
  }
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

function companyRollingSummary() {
  return { total: COST_CENTERS.reduce((s, cc) => s + rollingSummary(cc).total, 0) };
}

function companyMonthAmount(month) {
  return COST_CENTERS.reduce((s, cc) => s + monthAmount(cc, month).value, 0);
}

function advanceCloseMonth() {
  if (CLOSE_MONTH < MAX_CLOSE_MONTH) CLOSE_MONTH++;
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
  localStorage.setItem(ORG_STORAGE_KEY, CURRENT_ORG_ID);

  // Everything else is filtered to the active org (there may be several now).
  const [assRes, rolesRes, ccRes, hcRes, ooRes, actRes] = await Promise.all([
    sb.from("assumptions").select("*").eq("org_id", CURRENT_ORG_ID).single(),
    sb.from("roles").select("*").eq("org_id", CURRENT_ORG_ID),
    sb.from("cost_centers").select("*").eq("org_id", CURRENT_ORG_ID),
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
        .filter((a) => a.cost_center_id === cc.id)
        .forEach((a) => (actualMonthly[a.month - 1] = Number(a.amount)));

      COST_CENTERS.push({
        id: cc.id,
        name: cc.name,
        annualBudget: Number(cc.annual_budget),
        otherMonthly: Number(cc.other_monthly),
        headcount: hcRes.data
          .filter((h) => h.cost_center_id === cc.id)
          .map((h) => ({ id: h.id, roleId: h.role_id, count: h.count, startMonth: h.start_month, endMonth: h.end_month })),
        oneOffs: ooRes.data
          .filter((o) => o.cost_center_id === cc.id)
          .map((o) => ({ id: o.id, label: o.label, amount: Number(o.amount), month: o.month })),
        actualMonthly,
      });
    });
}

// ---- Preview mode ----------------------------------------------------------
// Loads representative sample data WITHOUT a login or Supabase, so the UI can be
// inspected/developed offline. Activated with ?preview on any page. Not used in
// the real app — purely a development affordance.
function loadPreviewData() {
  USER_ORGS = [
    { id: "preview-1", name: "Almgren Industrier", close_month: 6, currency: "SEK" },
    { id: "preview-2", name: "Nordstjärna Konsult", close_month: 6, currency: "SEK" },
  ];
  CURRENT_ORG_ID = "preview-1";
  CLOSE_MONTH = 6;
  Object.assign(ASSUMPTIONS, { employerContributionPct: 31.42, equipmentMonthly: 1200, otherOverheadPct: 4 });

  ROLE_CATALOG.length = 0;
  COST_CENTERS.length = 0;
  if (new URLSearchParams(location.search).has("empty")) return; // ?preview&empty → fresh-org state

  ROLE_CATALOG.push(
    { id: "r1", label: "Production Operator", baseSalary: 33000 },
    { id: "r2", label: "Shift Supervisor", baseSalary: 42000 },
    { id: "r3", label: "Engineer", baseSalary: 47000 },
    { id: "r4", label: "IT Support Specialist", baseSalary: 36000 },
  );

  const mk = (id, name, budget, other, hc, oo, act) =>
    ({ id, name, annualBudget: budget, otherMonthly: other, headcount: hc, oneOffs: oo, actualMonthly: act });

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
}

// ---- Writes (granular Supabase updates, scoped by org via RLS) -------------

// Surfaces a save failure to the user (silence = success). RLS or network
// errors land here rather than failing silently.
function flagWriteError(error) {
  console.error("Save failed:", error);
  let el = document.getElementById("saveToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "saveToast";
    el.className = "save-toast";
    document.body.appendChild(el);
  }
  el.textContent = "Save failed — " + error.message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 5000);
}

async function dbUpdateAssumptions() {
  const { error } = await sb.from("assumptions").update({
    employer_contribution_pct: ASSUMPTIONS.employerContributionPct,
    equipment_monthly: ASSUMPTIONS.equipmentMonthly,
    other_overhead_pct: ASSUMPTIONS.otherOverheadPct,
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
  const { error } = await sb.from("cost_centers")
    .update({ name: cc.name, annual_budget: cc.annualBudget, other_monthly: cc.otherMonthly })
    .eq("id", cc.id);
  if (error) flagWriteError(error);
}

async function dbInsertCostCenter() {
  const { data, error } = await sb.from("cost_centers")
    .insert({ org_id: CURRENT_ORG_ID, name: "New cost center", annual_budget: 0, other_monthly: 0 })
    .select().single();
  if (error) { flagWriteError(error); return null; }
  return { id: data.id, name: data.name, annualBudget: Number(data.annual_budget), otherMonthly: Number(data.other_monthly), headcount: [], oneOffs: [], actualMonthly: [] };
}

async function dbDeleteCostCenter(id) {
  const { error } = await sb.from("cost_centers").delete().eq("id", id);
  if (error) { flagWriteError(error); return false; }
  return true;
}

async function dbInsertHeadcount(ccId, line) {
  const { data, error } = await sb.from("headcount_lines")
    .insert({ org_id: CURRENT_ORG_ID, cost_center_id: ccId, role_id: line.roleId, count: line.count, start_month: line.startMonth, end_month: line.endMonth })
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
    .insert({ org_id: CURRENT_ORG_ID, cost_center_id: ccId, label: o.label, amount: o.amount, month: o.month })
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

async function dbUpdateCloseMonth() {
  const { error } = await sb.from("organizations").update({ close_month: CLOSE_MONTH }).eq("id", CURRENT_ORG_ID);
  if (error) flagWriteError(error);
}

// Client-side UUID (works on file:// — uses getRandomValues, not the
// secure-context-only crypto.randomUUID).
function uuidv4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

// Stand up a brand-new tenant from the UI: org → owner membership → default
// assumptions, then switch to it. Order matters so RLS checks pass.
async function createOrg() {
  const name = prompt("Name the new organization:");
  if (!name || !name.trim()) return;

  const orgId = uuidv4();
  const orgRes = await sb.from("organizations").insert({ id: orgId, name: name.trim(), close_month: 0, currency: "SEK" });
  if (orgRes.error) { flagWriteError(orgRes.error); return; }

  const { data: { user } } = await sb.auth.getUser();
  const mRes = await sb.from("memberships").insert({ user_id: user.id, org_id: orgId, role: "owner" });
  if (mRes.error) { flagWriteError(mRes.error); return; }

  const aRes = await sb.from("assumptions").insert({ org_id: orgId });
  if (aRes.error) { flagWriteError(aRes.error); return; }

  localStorage.setItem(ORG_STORAGE_KEY, orgId);
  location.reload();
}

// ---- Shared formatting -----------------------------------------------------

function fmtMkr(n) {
  return (n / 1_000_000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mkr";
}

function fmtMkrSigned(n) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + fmtMkr(Math.abs(n));
}

function fmtSek(n) {
  const sign = n < 0 ? "−" : "";
  return sign + Math.round(Math.abs(n)).toLocaleString("sv-SE") + " kr";
}

function varianceClass(variance, budget) {
  const pct = budget ? (variance / budget) * 100 : 0;
  if (pct > 1) return "over";
  if (pct < -1) return "under";
  return "neutral";
}

// Shown on Overview/Monthly when an organization has no cost centers yet.
function emptyOrgHtml() {
  return `
    <div class="empty-state">
      <h2>Let's set up this organization</h2>
      <p>There are no cost centers here yet. Two quick steps and the forecast comes to life:</p>
      <ol>
        <li>Add your <strong>roles</strong> and their salaries on the <a href="assumptions.html">Assumptions</a> page.</li>
        <li>Add <strong>cost centers</strong> and their headcount on the <a href="planning.html">Planning</a> page.</li>
      </ol>
      <a class="empty-cta" href="assumptions.html">Start on Assumptions →</a>
    </div>`;
}
