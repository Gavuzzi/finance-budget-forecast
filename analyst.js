// analyst.js — explains a ledger, rather than just flagging it.
//
// THE POINT: every BI tool can tell you an account moved. What a controller
// actually needs is WHY, and specifically whether the move is real. Most of
// what looks alarming in a small company's books is periodization — the annual
// insurance premium landing in one month, a subscription billed yearly, a
// quarterly fee. Flagging those as overspend is how a variance report loses its
// reader: twenty flags, eighteen of them timing, nobody opens it again.
//
// So this classifies before it reports, and says which side of that line each
// finding falls on — including "we can't tell", which is an honest answer.
//
// Pure and UI-free (same rule as data.js and sie.js): parsed SIE in, findings
// out. Deliberately NO language model: the judgement below is deterministic,
// inspectable and testable. If we ever add an LLM it phrases these findings —
// it does not decide them. In a finance context an explanation nobody can audit
// is worth less than no explanation.

// ---- What one SIE file can honestly support ---------------------------------
// Available: this year's monthly series per account, voucher counts and the
// bookkeeper's own voucher text, and LAST YEAR'S ANNUAL TOTAL per account
// (#RES -1). NOT available: last year's monthly detail — a SIE export carries
// vouchers for the current year only. So "same thing happened last July" cannot
// be checked from one file, and nothing below pretends otherwise. Year-over-year
// reasoning is annual-total only, and is labelled as such.

const ANALYST_DEFAULTS = {
  minAmount: 5000,        // ignore anything too small to be worth a controller's minute
  spikeMultiple: 2.5,     // a month this many times the account's typical level is a spike
  concentration: 0.6,     // one month holding this share of the year = episodic, not running
  yoyPct: 25,             // year-over-year change worth mentioning
};

// Median is the right "typical" here, not mean: one big annual invoice would
// drag a mean upwards and then hide itself against its own inflated baseline.
function analystMedian(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Cost accounts only (BAS class 4–7), as absolute kronor. Revenue behaves
// differently enough that mixing the two produces mush.
function analystCostAccounts(parsed) {
  const out = {};
  for (const [acct, months] of Object.entries(parsed.detail || {})) {
    if (!/^[4-7]/.test(acct)) continue;
    out[acct] = months;
  }
  return out;
}

// ---- Classification ---------------------------------------------------------
// Each finding gets a `kind`, which is the whole value of this module:
//
//   timing        — almost certainly periodization; one voucher, episodic account
//   timing-likely — spike pattern fits periodization but evidence is weaker
//   step          — level changed and stayed changed (a hire, a new contract)
//   spike         — a genuine one-off that isn't obviously periodization
//   yoy           — this year's total differs materially from last year's
//
// The kind decides the sentence, and "timing" findings are explicitly de-ranked
// so they don't crowd out things a human should actually act on.

// periodMonths = how many months the ledger covers overall, not how many this
// account was active. Getting this wrong was the first real bug: with the
// baseline taken over ACTIVE months only, an account that fires once a year has
// a median equal to that single month and therefore looks perfectly flat —
// so the most concentrated pattern possible (100% of the year in one month)
// sailed through undetected on a real file.
function analystClassifyAccount(acct, months, opts, periodMonths = 12) {
  const o = { ...ANALYST_DEFAULTS, ...opts };
  const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return [];

  const amounts = entries.map(([, c]) => Math.abs(c.amount));
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total < o.minAmount) return [];

  // Two different baselines, deliberately:
  //   perMonth — total spread over the whole period. Used to DETECT, because it
  //              treats "eleven silent months" as the information it is.
  //   typical  — median of the months that had activity. Used to DESCRIBE, because
  //              a mean dragged upwards by the spike would flatter the spike.
  const perMonth = total / Math.max(periodMonths, 1);
  const typical = analystMedian(amounts.filter((v) => v > 0));
  const findings = [];

  entries.forEach(([month, cell], i) => {
    const amount = Math.abs(cell.amount);
    if (amount < o.minAmount) return;
    const share = total ? amount / total : 0;
    if (amount < perMonth * o.spikeMultiple) return;

    // Did the level stay up afterwards? Then it's a step change, not a one-off —
    // a hire or a new contract, which is a different conversation entirely.
    const after = entries.slice(i + 1).map(([, c]) => Math.abs(c.amount)).filter((v) => v > 0);
    const afterTypical = analystMedian(after);
    const isStep = after.length >= 2 && typical > 0 && afterTypical >= amount * 0.7;

    // Periodization evidence: a single voucher carrying most of the year, in an
    // account that isn't otherwise active every month.
    const singleVoucher = cell.count === 1;
    const episodic = entries.length <= 4 || share >= o.concentration;

    let kind, confidence;
    if (isStep) {
      kind = "step"; confidence = "medium";
    } else if (singleVoucher && episodic) {
      kind = "timing"; confidence = "high";
    } else if (singleVoucher || episodic) {
      kind = "timing-likely"; confidence = "low";
    } else {
      kind = "spike"; confidence = "medium";
    }

    findings.push({
      account: acct, month, amount, kind, confidence,
      typical, perMonth, share, activeMonths: entries.length, vouchers: cell.count,
      texts: cell.texts.slice(0, 3),
      // Materiality drives ranking: what a controller would look at first is
      // the size of the deviation in kronor, not the percentage.
      material: Math.abs(amount - typical),
    });
  });

  return findings;
}

// Step changes need their own detector, and this was the second real bug found
// by running against data: salaries going 150k → 250k mid-year is a 67% jump in
// run-rate — the single most important thing a controller could be told — and
// it trips NO spike threshold, because not one month is unusual on its own. A
// spike is a month that stands out; a step is a level that moved and stayed.
// Different shapes, different tests.
function analystStepChanges(parsed, opts, periodMonths) {
  const o = { ...ANALYST_DEFAULTS, ...opts };
  const findings = [];

  for (const [acct, months] of Object.entries(analystCostAccounts(parsed))) {
    const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length < 4) continue; // too short to call a level shift

    const amounts = entries.map(([, c]) => Math.abs(c.amount));
    const half = Math.floor(amounts.length / 2);
    const before = analystMedian(amounts.slice(0, half));
    const after = analystMedian(amounts.slice(amounts.length - half));
    if (before <= 0) continue;

    const delta = after - before;
    const pct = (delta / before) * 100;
    if (Math.abs(pct) < o.yoyPct || Math.abs(delta) < o.minAmount) continue;

    // Where did it move? First month at or beyond the new level.
    const threshold = before + delta / 2;
    const idx = amounts.findIndex((v, i) => i >= half - 1 && (delta > 0 ? v >= threshold : v <= threshold));
    const month = entries[idx === -1 ? half : idx][0];

    findings.push({
      account: acct, kind: "step", confidence: "high",
      month, before, after, delta, pct,
      texts: (months[month] || {}).texts || [],
      material: Math.abs(delta) * 12, // annualised: a step repeats every month
    });
  }
  return findings;
}

// Year-over-year on annual totals — the only YoY a single file can support.
function analystYoY(parsed, opts) {
  const o = { ...ANALYST_DEFAULTS, ...opts };
  const cur = parsed.result[0] || {}, prev = parsed.result[-1] || {};
  const findings = [];
  for (const [acct, amount] of Object.entries(cur)) {
    if (!/^[4-7]/.test(acct)) continue;
    const before = prev[acct];
    if (before == null || Math.abs(before) < o.minAmount) continue;
    const delta = amount - before;
    const pct = (delta / Math.abs(before)) * 100;
    if (Math.abs(pct) < o.yoyPct || Math.abs(delta) < o.minAmount) continue;
    findings.push({
      account: acct, kind: "yoy", confidence: "high",
      amount, previous: before, delta, pct,
      material: Math.abs(delta),
    });
  }
  return findings;
}

// The full pass. Returns findings ranked so the first thing a controller reads
// is the thing most worth their time — real movements before timing artefacts,
// and within each, biggest kronor first.
function analyseLedger(parsed, opts = {}) {
  const accounts = analystCostAccounts(parsed);
  // How long the ledger actually covers — a part-year file shouldn't have its
  // months averaged over twelve.
  const periodMonths = Math.max(Object.keys(parsed.monthly || {}).length, 1);
  let findings = [];
  for (const [acct, months] of Object.entries(accounts)) {
    findings = findings.concat(analystClassifyAccount(acct, months, opts, periodMonths));
  }
  const steps = analystStepChanges(parsed, opts, periodMonths);
  findings = findings.concat(steps);
  // A step change already explains that account's year-over-year movement —
  // reporting both would be the same story told twice.
  const steppedAccounts = new Set(steps.map((s) => s.account));
  findings = findings.concat(analystYoY(parsed, opts).filter((f) => !steppedAccounts.has(f.account)));

  // Timing artefacts are reported but never lead. This ordering IS the product:
  // it's what stops the report reading like eighteen false alarms.
  const rank = { step: 0, spike: 1, yoy: 2, "timing-likely": 3, timing: 4 };
  findings.sort((a, b) => (rank[a.kind] - rank[b.kind]) || (b.material - a.material));

  const realCount = findings.filter((f) => f.kind !== "timing" && f.kind !== "timing-likely").length;
  return {
    findings,
    summary: {
      total: findings.length,
      needsAttention: realCount,
      timingOnly: findings.length - realCount,
      accountsSeen: Object.keys(accounts).length,
    },
  };
}

// ---- Rendering the sentence -------------------------------------------------
// Plain language, and always says what the evidence was. A controller who can
// see the reasoning can overrule it; one who can't has to redo the work.

function analystAccountName(parsed, acct) {
  const name = (parsed.accounts || {})[acct];
  return name ? `${acct} ${name}` : acct;
}

function analystExplain(parsed, f, fmt = (n) => Math.round(n).toLocaleString("sv-SE") + " kr") {
  const who = analystAccountName(parsed, f.account);
  const label = f.texts && f.texts.length ? ` (“${f.texts[0]}”)` : "";

  switch (f.kind) {
    case "timing":
      return `${who}: ${fmt(f.amount)} in ${f.month}, versus ${fmt(f.perMonth)}/month if it were spread evenly — one voucher${label} carrying ${Math.round(f.share * 100)}% of the year, active in ${f.activeMonths} month(s). Periodization, not a cost increase.`;
    case "timing-likely":
      return `${who}: ${fmt(f.amount)} in ${f.month} across ${f.vouchers} vouchers, versus ${fmt(f.perMonth)}/month spread evenly${label}. Possibly periodization — worth a glance to confirm.`;
    case "step":
      return `${who}: run-rate ${f.delta > 0 ? "up" : "down"} from ${fmt(f.before)} to ${fmt(f.after)} per month around ${f.month} (${f.pct > 0 ? "+" : ""}${Math.round(f.pct)}%), and it stayed there${label} — about ${fmt(Math.abs(f.delta) * 12)}/year. Looks like a lasting change, not a one-off.`;
    case "spike":
      return `${who}: ${fmt(f.amount)} in ${f.month} against a typical ${fmt(f.typical)}, across ${f.vouchers} vouchers${label}. Not an obvious timing artefact — worth checking.`;
    case "yoy":
      return `${who}: ${fmt(f.amount)} this year vs ${fmt(f.previous)} last year (${f.pct > 0 ? "+" : ""}${Math.round(f.pct)}%).`;
    default:
      return `${who}: ${fmt(f.amount)} in ${f.month}.`;
  }
}

// Is this ledger even a candidate for month-by-month analysis? A company that
// books its whole year in one sitting (common for owner-managed ABs) produces
// "spikes" in every account at once — and reporting twelve of those as findings
// would be technically true and completely useless. Say it once, at the top,
// and stop pretending the monthly detail means something it doesn't.
function analystLedgerRhythm(parsed) {
  const monthly = typeof sieMonthlyCosts === "function" ? sieMonthlyCosts(parsed) : {};
  const values = Object.values(monthly).map(Math.abs);
  const total = values.reduce((a, b) => a + b, 0);
  const largest = values.length ? Math.max(...values) : 0;
  const concentration = total > 0 ? largest / total : 0;
  return {
    months: values.length,
    concentration,
    bulkBooked: values.length > 0 && (concentration >= 0.6 || values.length <= 3),
  };
}

// The whole report as text — the shape a controller would actually receive.
function analystReport(parsed, opts = {}) {
  const { findings, summary } = analyseLedger(parsed, opts);
  const rhythm = analystLedgerRhythm(parsed);

  // Bulk-booked ledger: lead with the reason everything looks spiky, and drop
  // the per-account timing findings entirely — they are all the same fact
  // reported N times. Whatever survives (real year-over-year movement) still
  // stands, because annual totals don't care when the vouchers were entered.
  if (rhythm.bulkBooked) {
    const real = findings.filter((f) => f.kind !== "timing" && f.kind !== "timing-likely");
    const head = `This ledger is booked in bulk — ${Math.round(rhythm.concentration * 100)}% of the year's cost lands in a single month, across ${rhythm.months} month(s) with any activity. Month-by-month variance isn't meaningful here; comparing full-year totals is.`;
    if (!real.length) return head + "\n\nOn an annual basis, nothing stands out.";
    return [head, "", "On an annual basis:", ...real.map((f) => "• " + analystExplain(parsed, f))].join("\n");
  }

  if (!findings.length) return "Nothing stands out in this ledger.";
  const lines = findings.map((f) => "• " + analystExplain(parsed, f));
  const head = summary.needsAttention
    ? `${summary.needsAttention} thing(s) worth a look, ${summary.timingOnly} likely timing:`
    : `Nothing needs action — ${summary.timingOnly} finding(s), all consistent with periodization:`;
  return [head, ...lines].join("\n");
}
