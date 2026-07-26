// sie.js — reader for SIE 4, the Swedish bookkeeping interchange standard.
//
// Why this matters commercially: every Swedish accounting program (Fortnox,
// Visma, Björn Lundén, Hogia, iOrdning, 24SevenOffice…) exports SIE, so one
// parser reaches the whole market — including the many SMEs that aren't on
// Fortnox and would otherwise have to re-key figures by hand.
//
// Pure and UI-free (same rule as data.js): bytes in, plain objects out. The
// caller decides what to persist.
//
// Verified against a real iOrdning 6.0 export (a live Swedish AB's FY2025
// books, deliberately NOT committed — this repo is public). Findings that
// shaped the code are marked "MEASURED" below.

// ---- Encoding ---------------------------------------------------------------
// #FORMAT PC8 means code page 437, which is what Swedish exporters actually
// emit (å = 0x86, ö = 0x94). Reading such a file as UTF-8 mangles every
// Swedish account name, so decode explicitly rather than trusting TextDecoder.
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeSieBytes(bytes) {
  // A UTF-8 BOM means a modern exporter already wrote UTF-8 — honour it.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b < 128 ? String.fromCharCode(b) : (CP437_HIGH[b - 128] || "?");
  }
  return s;
}

// ---- Field splitting --------------------------------------------------------
// SIE fields are space-separated, quoted when they contain spaces, with {} for
// the object (cost centre / project) list. Split without a regex soup so
// account names containing quotes or braces can't derail the row.
function sieFields(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === '"') {
      let v = "";
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) i++; // \" inside a name
        v += line[i++];
      }
      i++; // closing quote
      out.push(v);
    } else if (c === "{") {
      const end = line.indexOf("}", i);
      out.push(end === -1 ? "" : line.slice(i + 1, end).trim());
      i = end === -1 ? line.length : end + 1;
    } else {
      let v = "";
      while (i < line.length && line[i] !== " " && line[i] !== "\t") v += line[i++];
      out.push(v);
    }
  }
  return out;
}

const sieDate = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

// ---- Parser -----------------------------------------------------------------
// Returns { company, fiscalYears, accounts, result, ub, ib, monthly, vouchers,
//           hasObjectTags, tieOut, warnings }.
//
// Sign convention is SIE's own and is preserved as-is: credit is negative, so
// revenue accounts (class 3) come out negative and costs positive. Callers flip
// revenue rather than this parser guessing intent.
function parseSie(input) {
  const text = typeof input === "string"
    ? input
    : decodeSieBytes(input instanceof Uint8Array ? input : new Uint8Array(input));

  const out = {
    company: { name: "", orgNr: "" },
    fiscalYears: [],           // [{ index: 0, from, to }] — 0 = current, -1 = previous
    accounts: {},              // { "3010": "Försäljning" }
    result: {},                // { 0: { "3010": -1272825 }, -1: {…} } — #RES, the reported P&L
    ub: {}, ib: {},            // closing / opening balances by year index
    monthly: {},               // { "2025-03": { "3010": -362700 } } — from #TRANS, bucketed by voucher date
    // Voucher-level detail per account per month. The analyst needs this to
    // tell periodization from real change: one big voucher labelled
    // "Prenumeration Di" is an annual subscription, twelve small ones are a
    // running cost. Shape: { "6900": { "2025-07": { amount, count, texts } } }
    detail: {},
    vouchers: 0,
    hasObjectTags: false,      // any transaction tagged with a cost centre / project?
    transSums: {},             // { "3010": -1272825 } — summed #TRANS, for the tie-out
    warnings: [],
  };

  let voucherMonth = null;
  let voucherText = "";
  let sieType = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "}") { continue; }
    if (line[0] === "{") continue;
    if (line[0] !== "#") continue;

    const f = sieFields(line);
    const tag = f[0];

    switch (tag) {
      case "#SIETYP": sieType = f[1]; break;
      case "#FNAMN": out.company.name = f[1] || ""; break;
      case "#ORGNR": out.company.orgNr = f[1] || ""; break;
      case "#RAR": {
        const idx = parseInt(f[1], 10);
        if (!isNaN(idx)) out.fiscalYears.push({ index: idx, from: sieDate(f[2]), to: sieDate(f[3]) });
        break;
      }
      case "#KONTO": if (f[1]) out.accounts[f[1]] = (f[2] || "").trim(); break;
      case "#RES": case "#UB": case "#IB": {
        const idx = parseInt(f[1], 10);
        const acct = f[2];
        const amt = parseFloat(f[3]);
        if (isNaN(idx) || !acct || isNaN(amt)) break;
        const bucket = tag === "#RES" ? out.result : tag === "#UB" ? out.ub : out.ib;
        (bucket[idx] = bucket[idx] || {})[acct] = amt;
        break;
      }
      case "#VER": {
        // #VER <series> <number> <date> "<text>" <regdate>
        const d = sieDate(f[3]);
        voucherMonth = d ? d.slice(0, 7) : null;
        voucherText = f[4] || "";
        out.vouchers++;
        break;
      }
      case "#TRANS": {
        // MEASURED: summing #TRANS alone reproduced the exporter's own #RES
        // exactly (all 14 P&L accounts, to the öre) on a real file. Summing
        // #BTRANS/#RTRANS as well broke 9 of 14 accounts and overstated one by
        // 3.9 MSEK — they are the audit trail of removed/added rows, NOT
        // current reality. So those two tags are deliberately ignored.
        const acct = f[1];
        const objs = f[2] || "";
        const amt = parseFloat(f[3]);
        if (!acct || isNaN(amt)) break;
        if (objs.trim()) out.hasObjectTags = true;
        out.transSums[acct] = (out.transSums[acct] || 0) + amt;
        if (voucherMonth) {
          const m = (out.monthly[voucherMonth] = out.monthly[voucherMonth] || {});
          m[acct] = (m[acct] || 0) + amt;

          const byAcct = (out.detail[acct] = out.detail[acct] || {});
          const cell = (byAcct[voucherMonth] = byAcct[voucherMonth] || { amount: 0, count: 0, texts: [] });
          cell.amount += amt;
          cell.count++;
          // Keep the voucher labels — the bookkeeper already wrote down what
          // this was ("Prenumeration Di"), which beats anything we could infer.
          if (voucherText && !cell.texts.includes(voucherText)) cell.texts.push(voucherText);
        }
        break;
      }
      default: break; // #BTRANS/#RTRANS/#SRU/#KTYP/#MOMSKOD… not needed
    }
  }

  if (sieType && sieType !== "4" && sieType !== "4B") {
    // Types 1–3 carry balances but no verifications, so there is nothing to
    // spread across months; the annual figures still import fine.
    out.warnings.push({ code: "SIETYP", value: sieType });
  }

  // Tie-out: our summed transactions vs the file's own reported result. This is
  // the trust badge — if these disagree we say so instead of importing quietly.
  // Tolerance is half a krona per account: exporters round to öre, so a few
  // öre of drift is arithmetic noise, not a discrepancy. A genuine problem (a
  // missed voucher, a misread tag) is orders of magnitude larger — flagging
  // sub-krona differences only produced the absurd warning "largest gap 0 kr".
  const current = out.result[0] || {};
  let worstDiff = 0, mismatches = 0;
  for (const acct of Object.keys(current)) {
    const diff = Math.abs((out.transSums[acct] || 0) - current[acct]);
    if (diff > 0.5) { mismatches++; worstDiff = Math.max(worstDiff, diff); }
  }
  out.tieOut = { ok: mismatches === 0, mismatches, worstDiff, accounts: Object.keys(current).length };
  return out;
}

// ---- Shaping for the app ----------------------------------------------------

// Full-year P&L per BAS class, in the app's convention (revenue positive, costs
// positive). yearIndex 0 = the file's current year, -1 = the comparison year.
function siePnl(parsed, yearIndex = 0) {
  const res = parsed.result[yearIndex] || {};
  let revenue = 0, cogs = 0, opex = 0, personnel = 0;
  for (const [acct, amt] of Object.entries(res)) {
    const cls = acct[0];
    if (cls === "3") revenue += -amt;      // credit-negative → positive revenue
    else if (cls === "4") cogs += amt;
    else if (cls === "5" || cls === "6") opex += amt;
    else if (cls === "7") personnel += amt;
  }
  const totalCost = cogs + opex + personnel;
  return { revenue, cogs, opex, personnel, total_cost: totalCost, result: revenue - totalCost };
}

// Booked cost per calendar month (classes 4–7), keyed "YYYY-MM". Used to fill
// monthly_actual; months absent from the ledger simply don't appear.
function sieMonthlyCosts(parsed) {
  const out = {};
  for (const [month, accts] of Object.entries(parsed.monthly)) {
    let sum = 0;
    for (const [acct, amt] of Object.entries(accts)) {
      if (/^[4-7]/.test(acct)) sum += amt;
    }
    if (sum !== 0) out[month] = Math.round(sum * 100) / 100;
  }
  return out;
}

// How evenly is the year actually booked? A one-person AB that books
// everything at year-end gives lumpy months, and month-by-month variance is
// then noise — we tell the user that instead of letting them misread a chart.
// Returns { monthsWithData, months, concentration } where concentration is the
// share of the year's booked cost landing in its single largest month.
function sieBookingRhythm(parsed) {
  const monthly = sieMonthlyCosts(parsed);
  const values = Object.values(monthly).map(Math.abs);
  const total = values.reduce((a, b) => a + b, 0);
  const largest = values.length ? Math.max(...values) : 0;
  return {
    monthsWithData: values.length,
    months: Object.keys(monthly).sort(),
    concentration: total > 0 ? largest / total : 0,
  };
}
