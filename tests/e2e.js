// E2E interaction tests (Playwright) — the layer the headless-Chrome
// dump-dom/screenshot workflow could never cover: clicking, typing, popovers,
// toggles. Runs against ?preview (no login, no DB writes — demo mode blocks
// them), so this verifies UI BEHAVIOR, not persistence; the data layer is
// verified separately (engine tests + supabase db query).
//
//   node tests/e2e.js        → PASS/FAIL per check, exit 1 on any failure
//
// Keep checks lean and behavioral: "clicking X makes Y appear", not pixel
// assertions. Add a check whenever a new interaction ships.

const { chromium } = require("playwright");
const path = require("path");

const root = path.resolve(__dirname, "..");
const url = (page, extra = "") => `file:///${root.replace(/\\/g, "/")}/${page}?preview${extra}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : " — " + detail}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);

  // ---- Overview ---------------------------------------------------------------
  await page.goto(url("app.html"));
  await page.waitForSelector(".hero-verdict");
  check("overview: hero verdict renders", !!(await page.textContent(".hero-verdict")).trim());

  // Version switcher + lock affordance (Tier 0 spine), with the
  // Forecast/Budgets/Scenarios grouping (Phase 8b-B)
  check("overview: plan version switcher present", await page.locator("#versionSwitcher").count() === 1);
  check("overview: switcher groups Budgets + Scenarios", await page.locator("#versionSwitcher optgroup").count() === 2);
  check("overview: working plan displays as Forecast",
    (await page.textContent('#versionSwitcher option[selected], #versionSwitcher option:checked')).trim() === "Forecast");
  // Budgets are created (for a fiscal year) from the Plans panel / budget
  // panel — no global freeze-now lock button on the Forecast anymore
  check("overview: no lock button while the Forecast is active", await page.locator("#lockBudgetBtn").count() === 0);
  check("overview: approved budget read-out with live drift",
    /Budget 2026/.test(await page.textContent("#budgetVersionPanel")));

  // Demo guard: branching a scenario while signed out shows the sign-in toast
  await page.click("#newScenarioBtn");
  await page.waitForSelector("#saveToast.show");
  check("overview: + Scenario in demo → sign-in toast (write blocked)", true);

  // Language toggle: segmented control actually switches the UI language
  await page.click('#langToggle .lang-opt[data-lang="sv"]');
  await page.waitForFunction(() => document.querySelector(".nav-item") && document.querySelector(".nav-item").textContent.includes("Översikt"));
  check("sidebar: SV segment switches nav to Swedish", true);
  await page.click('#langToggle .lang-opt[data-lang="en"]');
  await page.waitForFunction(() => document.querySelector(".nav-item") && document.querySelector(".nav-item").textContent.includes("Overview"));
  check("sidebar: EN segment switches back", true);

  // Booked-through read-out expands to the select on "change" — and collapses
  // back to the read-out after ANY pick, manual picks tagged (Felix: the open
  // select "stays in that kind of view… feels buggy")
  check("sidebar: booked-through is a read-out by default", await page.locator(".period-line").count() === 1);
  await page.click("#periodEditBtn");
  await page.waitForSelector("#closeMonthSelect");
  check("sidebar: 'change' reveals the period select", true);
  await page.selectOption("#closeMonthSelect", "4");
  await page.waitForSelector(".period-line");
  check("sidebar: picking a month collapses back to the read-out", true);
  check("sidebar: manual override shows the (manual) tag", await page.locator(".period-manual").count() === 1);

  // ---- Planning ----------------------------------------------------------------
  await page.goto(url("planning.html", "&consulting"));
  await page.waitForSelector(".cc-block");

  // Help mode (Phase 8b-C): marks invisible until the page ? is toggled on
  check("planning: help marks hidden by default", await page.locator('[data-help="headcount"]').first().isHidden());
  await page.click(".help-toggle");
  await page.waitForSelector('[data-help="headcount"]', { state: "visible" });
  check("planning: help toggle reveals the marks", true);
  await page.click('[data-help="headcount"]');
  await page.waitForSelector(".help-pop");
  const popText = (await page.textContent(".help-pop")).trim();
  check("planning: ? mark opens a popover with text", popText.length > 20, popText.slice(0, 40));
  await page.click('[data-help="headcount"]');
  check("planning: same ? click closes it", await page.locator(".help-pop").count() === 0);

  // Merged Costs table: monthly + one-off rows share ONE table
  const costsTable = page.locator('.cc-block[data-cc="0"] .costs-table');
  check("planning: one merged costs table per line", await costsTable.count() === 1);
  check("planning: it holds both monthly and one-off rows",
    await costsTable.locator("tr[data-recurring]").count() >= 1 && await costsTable.locator("tr[data-oneoff]").count() >= 1);

  // Note ✎ toggle opens AND closes (the old + Add note couldn't close — #9)
  await page.click('[data-notetoggle="0"]');
  await page.waitForSelector('.cc-block[data-cc="0"] [data-ccfield="note"]');
  check("planning: ✎ opens the note input", true);
  await page.click('[data-notetoggle="0"]');
  await page.waitForTimeout(100);
  check("planning: ✎ closes it again", await page.locator('.cc-block[data-cc="0"] [data-ccfield="note"]').count() === 0);

  // Utilization driver (consulting hook): derived read-back present
  const derived = (await page.textContent(".util-derived")).trim();
  check("planning: utilization derives heads/revenue/cost", /8\.1|8,1/.test(derived), derived);

  // Re-forecast: one plain-language action, no source dropdown (the dropdown
  // was the confusion); R&D's fixtures diverge >3% so the row must render
  check("planning: re-forecast is one action, no source select",
    await page.locator(".rf-source").count() === 0 && await page.locator('[data-rfapply="1"]').count() === 1);
  check("planning: re-forecast states the divergence in words",
    /above|below/.test(await page.textContent('.cc-block[data-cc="1"] .rf-detail')));

  // Monthly billable-hours grid toggles open/closed
  const gridsBefore = await page.locator(".line-rev-grid").count();
  await page.click('[data-utiltoggle="1"]');
  await page.waitForTimeout(150);
  const gridsAfter = await page.locator(".line-rev-grid").count();
  check("planning: Monthly toggle collapses/expands the hours grid", gridsAfter !== gridsBefore);

  // Allocation toggle hidden with no overhead line (progressive disclosure)
  check("planning: allocation toggle hidden by default", await page.locator("#allocToggleWrap").isHidden());

  // Planning-mode gating (Phase 8b-A): an org-mode company sees ZERO
  // revenue/capacity affordances on Planning — one revenue home.
  await page.goto(url("planning.html"));
  await page.waitForSelector(".cc-block");
  check("planning (org mode): no + Add revenue anywhere", await page.locator("[data-addrevenue]").count() === 0);
  check("planning (org mode): no billable-hours affordance", await page.locator("[data-addutil]").count() === 0);
  await page.goto(url("assumptions.html", "&profit"));
  await page.waitForSelector(".planmode-block");
  check("assumptions (lines mode): no org revenue panel (one home)", await page.locator(".revenue-block").count() === 0);
  check("assumptions: How-you-plan picker present (3 revenue + 2 people cards)",
    await page.locator(".planmode-opt").count() === 5);
  check("assumptions: Manage plans panel with unlock on the budget",
    await page.locator("[data-planunlock]").count() === 1);
  check("assumptions: New-budget control with a fiscal-year choice",
    await page.locator("#newBudgetBtn").count() === 1 && await page.locator("#newBudgetFy option").count() === 2);

  // ---- FY-scoped budgets (&fy27: a draft Budget 2027 is the active version) ----
  await page.goto(url("app.html", "&fy27"));
  await page.waitForSelector(".hero-verdict");
  check("fy27: Overview subtitle says FY2027", /FY2027/.test(await page.textContent(".page-sub")));
  check("fy27: sidebar offers contextual 'Lock Budget 2027'",
    /Budget 2027/.test((await page.textContent("#lockBudgetBtn")) || ""));
  check("fy27: switcher marks the draft", /draft|utkast/.test(await page.textContent("#versionSwitcher")));
  await page.goto(url("planning.html", "&fy27"));
  await page.waitForSelector(".cc-block");
  check("fy27: Planning totals read FY2027", /FY2027/.test(await page.textContent(".cc-summary, .cc-block")));
  await page.goto(url("monthly.html", "&fy27"));
  await page.waitForSelector(".mt-table, table");
  const monthlyHead = await page.textContent("table");
  check("fy27: Monthly grid shows Jan 27–Dec 27", /Jan 27/.test(monthlyHead) && !/Jan 26/.test(monthlyHead));

  // No budget yet (fresh real org): the panel offers to create next year's
  // (the panel lives in a collapsed <details>, so count — don't wait for visible)
  await page.goto(url("app.html", "&nobudget"));
  await page.waitForSelector(".hero-verdict");
  check("no budget yet: create-Budget-2027 CTA offered", await page.locator("[data-createbudget]").count() === 1);

  // Planning-mode gating, cost side (Phase 8c): a no-headcount org has no
  // People sections and no role/salary engine — costs are plain amounts.
  await page.goto(url("planning.html", "&simplecosts"));
  await page.waitForSelector(".cc-block");
  check("planning (simple costs): no People sections", await page.locator("[data-add]").count() === 0);
  check("planning (simple costs): costs tables still render", await page.locator(".costs-table").count() >= 2);
  await page.goto(url("assumptions.html", "&simplecosts"));
  await page.waitForSelector(".planmode-block");
  check("assumptions (simple costs): role/salary engine hidden", await page.locator("#roleTableBody").count() === 0);
  check("assumptions: people-cost question with 2 cards", await page.locator(".planmode-people .planmode-opt").count() === 2);

  // ---- Org-creation wizard (build your company) ----------------------------------
  await page.goto(url("app.html"));
  await page.waitForSelector("#newOrgBtn");
  await page.click("#newOrgBtn");
  await page.waitForSelector("#orgWizard");
  check("wizard: build-your-company modal opens", true);
  check("wizard: 3 revenue cards + 2 people cards",
    await page.locator('#orgWizard input[name="wizRev"]').count() === 3 &&
    await page.locator('#orgWizard input[name="wizPeople"]').count() === 2);
  await page.click('#orgWizard .planmode-opt:has(input[value="hours"])');
  check("wizard: hours mode hides the people question", await page.locator("#wizPeopleOpts").isHidden());
  await page.click("#wizCancel");
  check("wizard: cancel closes it", await page.locator("#orgWizard").count() === 0);

  // Empty org: ONE sample matched to the org's declared shape, not 4 stereotypes
  await page.goto(url("app.html", "&empty"));
  await page.waitForSelector(".empty-state");
  check("empty org: exactly one matched sample card", await page.locator(".preset-card").count() === 1);

  // ---- Cash Flow -----------------------------------------------------------------
  await page.goto(url("cashflow.html"));
  await page.waitForSelector('[data-help="cashflow_method"]');
  await page.click('[data-help="cashflow_method"]');
  await page.waitForSelector(".help-pop");
  check("cashflow: method ? popover opens", true);

  // ---- Data page -------------------------------------------------------------------
  await page.goto(url("connect.html"));
  await page.waitForSelector("#importActualsBtn");
  await page.click("#importActualsBtn");
  await page.waitForSelector("#downloadTemplateBtn");
  check("data: import panel opens with template button", true);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0
    ? `\nE2E ALL PASS (${results.length} checks)`
    : `\nE2E FAIL: ${failed.length} of ${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error("E2E CRASH:", e.message); process.exit(1); });
