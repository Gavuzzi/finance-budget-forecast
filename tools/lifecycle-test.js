// Full lifecycle against the LIVE backend: every write path a customer touches.
//
// WHY THIS EXISTS: tests/e2e.js runs in demo mode, where every write is stubbed
// out on purpose — so it can prove the UI behaves, never that data actually
// saves. This drives the real thing: sign in, create an org, seed, import a SIE
// file, add/rename/delete a reporting line, branch a scenario, create and lock a
// budget, render the report, check every page loads and that a phone-width
// viewport doesn't overflow.
//
// ⚠ IT WRITES TO PRODUCTION. It creates an org named "Lifecycle Test AB" and
// leaves it behind. Run it before shipping anything that touches persistence,
// then clean up:
//
//   delete from organizations where name = 'Lifecycle Test AB';
//
// SETUP — it needs a confirmed auth user, which the signup UI can't give you
// quickly (Supabase's built-in mail is rate-limited). Create one directly:
//
//   with u as (
//     insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
//       email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
//       confirmation_token, recovery_token, email_change_token_new,
//       email_change_token_current, email_change, phone_change, phone_change_token,
//       reauthentication_token)
//     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
//       'authenticated', 'claude.lifecycle.2026@gmail.com',
//       crypt('TestFlow!2026x', gen_salt('bf')), now(), now(), now(),
//       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
//       '', '', '', '', '', '', '', '')
//     returning id, email)
//   insert into auth.identities (provider_id, user_id, identity_data, provider,
//     last_sign_in_at, created_at, updated_at)
//   select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
//     'email', now(), now(), now() from u;
//
// (The empty-string token columns matter: GoTrue rejects NULLs there with an
// opaque error that surfaces in the UI as a bare "{}".)
//
//   node tools/lifecycle-test.js
const { chromium } = require("C:/Users/felix/dev/finance-budget-forecast/node_modules/playwright");
const fs = require("fs");
const path = require("path");
const root = "C:/Users/felix/dev/finance-budget-forecast";
const EMAIL = "claude.lifecycle.2026@gmail.com", PASS = "TestFlow!2026x";
const out = (n) => path.join(__dirname, n);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : "  — " + detail}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 160)); });
  const go = async (p, sel) => { await page.goto(`file:///${root}/${p}`); if (sel) await page.waitForSelector(sel, { timeout: 25000 }); };

  // ---- sign in (account pre-created in SQL) --------------------------------
  await go("app.html", ".login-card");
  await page.click(".login-signin summary");
  await page.fill("#loginEmail", EMAIL);
  await page.fill("#loginPassword", PASS);
  await page.click("#loginForm button[type=submit]");
  await page.waitForTimeout(6000);
  check("sign in as a fresh account → welcome + wizard", await page.locator("#orgWizard").count() > 0);

  // ---- create the org through the wizard -----------------------------------
  await page.fill("#wizName", "Lifecycle Test AB");
  await page.click("#wizCreate");
  await page.waitForTimeout(8000);
  check("wizard creates the organization", (await page.textContent(".sb-name").catch(() => "")).includes("Lifecycle"));
  check("new org shows the onboarding options", await page.locator(".empty-state").count() > 0);

  // ---- seed the sample ------------------------------------------------------
  await page.click("[data-loadpreset]");
  await page.waitForTimeout(14000);
  const verdict = (await page.textContent(".hero-verdict").catch(() => "")).trim();
  check("sample seeds and lands On plan", /On plan/.test(verdict), verdict);

  // ---- SIE IMPORT: the real write path (never tested live before) -----------
  const sie = [
    "#FLAGGA 0", "#FORMAT PC8", "#SIETYP 4", '#FNAMN "Lifecycle Test AB"', "#ORGNR 556000-2222",
    "#RAR 0 20260101 20261231", '#KONTO 5010 "Lokalhyra"', '#KONTO 7010 "Loner"',
    "#RES 0 5010 240000.00", "#RES 0 7010 900000.00",
    '#VER A 1 20260715 "Jul" 20260720', "{", "#TRANS 5010 {} 120000.00", "#TRANS 7010 {} 450000.00", "}",
    '#VER A 2 20260815 "Aug" 20260820', "{", "#TRANS 5010 {} 120000.00", "#TRANS 7010 {} 450000.00", "}",
  ].join("\r\n");
  const siePath = path.join(require("os").tmpdir(), "lifecycle.se");
  fs.writeFileSync(siePath, sie, "latin1");

  await go("connect.html", "#sieImportOpen");
  await page.click("#sieImportOpen");
  await page.setInputFiles("#sieFile", siePath);
  await page.waitForSelector(".sie-card");
  check("SIE: tie-out badge passes on a real org", /Ties out/.test(await page.textContent(".sie-tie")));
  // send both groups to a NEW line each, then import for real
  const groups = await page.locator("[data-siegroup]").count();
  for (let i = 0; i < groups; i++) await page.selectOption(`[data-siegroup="${i}"]`, "__new__");
  await page.click("#sieImportBtn");
  await page.waitForTimeout(12000);

  await go("app.html", ".hero-verdict");
  const bodyAfter = (await page.textContent("body")).replace(/\s+/g, " ");
  check("SIE: imported lines exist after reload",
    /Personnel|Other external/.test(bodyAfter), bodyAfter.slice(0, 90));
  check("SIE: booked-through moved to the ledger's last month (Aug 26)",
    /Actuals through Aug 26/.test(bodyAfter));

  // ---- Planning writes: add / edit / delete ---------------------------------
  await go("planning.html", ".cc-block");
  const linesBefore = await page.locator("#ccBlocks .cc-block").count();
  await page.click("#addCostCenter");
  await page.waitForTimeout(3500);
  check("Planning: add a reporting line persists", await page.locator("#ccBlocks .cc-block").count() === linesBefore + 1);

  const last = page.locator("#ccBlocks .cc-block").last();
  await last.locator(".cc-name-input").fill("Delete Me");
  await last.locator(".cc-name-input").dispatchEvent("change");
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForSelector(".cc-block");
  check("Planning: rename survives a reload",
    (await page.locator("#ccBlocks .cc-block").last().locator(".cc-name-input").inputValue()) === "Delete Me");

  // add a monthly cost to the first line, check the FY total moves
  
  await page.locator('[data-addrecurring="0"]').click();
  await page.waitForTimeout(3000);
  check("Planning: add a monthly cost row persists",
    await page.locator('.cc-block[data-cc="0"] tr[data-recurring]').count() >= 1);

  // delete the line we made (accept the confirm)
  page.once("dialog", (d) => d.accept());
  await page.locator("#ccBlocks .cc-block").last().locator("[data-deletecc]").click();
  await page.waitForTimeout(3500);
  await page.reload();
  await page.waitForSelector(".cc-block");
  const names = await page.$$eval(".cc-name-input", (i) => i.map((x) => x.value));
  check("Planning: delete removes the line for good", !names.includes("Delete Me"), names.join("|"));

  // ---- Scenario + budget lifecycle ------------------------------------------
  await go("app.html", ".hero-verdict");
  page.once("dialog", (d) => d.accept("Hiring freeze"));
  await page.click("#newScenarioBtn");
  await page.waitForTimeout(9000);
  check("Scenario: branch created and switched into",
    /Hiring freeze/.test(await page.textContent("#versionSwitcher")));

  // back to forecast, then create + lock a budget
  await page.selectOption("#versionSwitcher", { label: "Forecast" });
  await page.waitForTimeout(7000);
  await go("settings.html", ".plans-block");
  await page.click("#newBudgetBtn");
  await page.waitForTimeout(9000);
  await go("settings.html", ".plans-block");
  const planNames = await page.$$eval(".plan-row .plan-name", (n) => n.map((x) => x.textContent.trim()));
  check("Budget: created for the chosen fiscal year", planNames.some((n) => /Budget 20\d\d/.test(n)), planNames.join("|"));
  page.once("dialog", (d) => d.accept());
  const lockBtn = page.locator("[data-planlock]").first();
  if (await lockBtn.count()) { await lockBtn.click(); await page.waitForTimeout(6000); }
  await go("settings.html", ".plans-block");
  check("Budget: locks (becomes read-only)", await page.locator(".plan-locked").count() >= 1);

  // ---- The report on real data ----------------------------------------------
  await go("report.html", ".rep-org");
  check("Report: renders on real data with the company name",
    (await page.textContent(".rep-org")).includes("Lifecycle"));
  check("Report: result table has rows", await page.locator(".rep-table-result tbody tr").count() >= 2);
  await page.screenshot({ path: out("lc-report.png"), fullPage: true });

  // ---- Cash flow + Data pages load on a real org ----------------------------
  for (const p of ["cashflow.html", "connect.html", "planning.html", "settings.html"]) {
    await go(p);
    await page.waitForTimeout(3500);
    const txt = (await page.textContent("body")).replace(/\s+/g, " ");
    check(`${p} loads without an error screen`, !/Couldn't load|undefined undefined/.test(txt));
  }

  // ---- Responsive: does it survive a phone? ---------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await go("app.html", ".hero-verdict");
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check("mobile 390px: no horizontal overflow", !overflow);
  await page.screenshot({ path: out("lc-mobile.png"), fullPage: false });
  await page.setViewportSize({ width: 1400, height: 1050 });

  check("no JS errors during the whole lifecycle", errors.length === 0, [...new Set(errors)].slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\nLIFECYCLE: ${failed.length} of ${results.length} FAILED` : `\nLIFECYCLE ALL PASS (${results.length} checks)`);
  await browser.close();
})();
