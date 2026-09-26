'use strict';
/*
 * Affordability pressure-test (what-if) layer.
 * Standalone page module. No account, no server, no real data bundled.
 *
 * Money convention: all arithmetic is done in integer paise (1/100 rupee).
 * Values produced by a formula (EMI, income-drop reduction) are rounded
 * ROUND-HALF-UP to 2 decimals (paise) before any further use. Displayed
 * figures therefore match fixtures exactly, e.g. the EMI on Rs 4,000,000
 * at 9% over 20 years is 35,989.04 (not 35,989.03).
 *
 * Scope caveats (shown on the page as well):
 * - Fixed-rate, full-balance EMI illustration for the first 12 months.
 * - Staged draws, lender resets, fees, tax and portfolio growth are not modeled.
 * - A loan not yet released by the lender is not settled cash.
 * - Life-event scenarios are what-if sketches on user-entered figures.
 *   No probabilities, no insurance advice, no legal conclusions.
 */

/* ---------- money helpers (pure) ---------- */
function rhu(x){ return Math.floor(x * 100 + 0.5); }        // round-half-up to paise
function toPaise(rupees){ const n = Number(rupees); return Number.isFinite(n) ? Math.round(n * 100) : null; }
function fromPaise(p){ return p / 100; }
function fmt(p){ // paise -> "Rs 1,23,456.78" style string (negative kept, never clamped)
  if (p == null || !Number.isFinite(p)) return 'unknown';
  const neg = p < 0, abs = Math.abs(p);
  return (neg ? '-' : '') + '₹' + (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------- loan math (pure) ---------- */
// Standard annuity EMI on the FULL balance, rounded half-up to paise.
function emiPaise(principalPaise, annualRatePct, years){
  const n = Math.round(years * 12);
  if (!(principalPaise > 0) || !(n > 0)) return null;
  const i = annualRatePct / 1200;
  if (i === 0) return Math.round(principalPaise / n);
  const emi = principalPaise * i / (1 - Math.pow(1 + i, -n)); // already in paise
  return Math.floor(emi + 0.5); // round-half-up to integer paise
}
// Balance after the first EMI (fixture check): interest first, then principal.
function firstMonthBalancePaise(principalPaise, annualRatePct, emiP){
  const interest = Math.floor(principalPaise * (annualRatePct / 1200) + 0.5); // paise, half-up
  return principalPaise + interest - emiP;
}

/* ---------- input model ----------
 * answers: {income, otherIncome, essentials, debt, ownership, goal,
 *           rent, rentStart, rentMonths,
 *           projectCost, own, cash, reserve, commitments,
 *           loanAmount, rate, years, loanReleased: 'received'|'later'}
 * rows: [{label, amount, kind:'income'|'expense', freq:'once'|'monthly'|'quarterly'|'annual', firstMonth, lastMonth?}]
 * All money fields are rupees as entered (strings/numbers); blanks are unknown, not zero.
 */
function rowAppears(row, month){
  const first = Number(row.firstMonth), last = row.lastMonth === '' || row.lastMonth == null ? first : Number(row.lastMonth);
  if (!(first >= 1 && first <= 12) || month < first) return false;
  switch (row.freq){
    case 'once': return month === first;
    case 'monthly': return month <= Math.min(12, last >= first ? last : 12);
    case 'quarterly': return (month - first) % 3 === 0 && month <= 12;
    case 'annual': return month === first; // a 12-month view sees an annual item once
    default: return false;
  }
}

/* Life-event scenario model (all optional; blanks stay unknown):
 * stress: {ratePlus, dropPct, dropStart, dropMonths, overrun}
 * jobLoss: {enabled, gapStart, gapMonths, otherStops, severance, severanceMonth,
 *           relocationCost, relocationMonth, newIncome, newIncomeStart, newRecurringCost, newCostStart,
 *           fxAmount, fxRate, fxFee, fxStart} // fx only converted when a dated rate is entered
 * loanRejected: {enabled, status:'expected'|'sanctioned'|'partly', released}
 * earnerDeath: {enabled, endMonth, expenseDelta, claimStatus:'none'|'pending'|'received'|'unknown',
 *               claimAmount, claimMonth, coborrower:'yes'|'no'|'unknown', otherStops}
 */
function inWindow(start, months, m){
  if (!(start >= 1 && months >= 1)) return false;
  return m >= start && m < start + months;
}

function computeMonth(a, rows, stress, life, m){
  const income = toPaise(a.income), other = toPaise(a.otherIncome) || 0;
  const essentials = toPaise(a.essentials), debt = toPaise(a.debt) || 0;
  const ownership = toPaise(a.ownership) || 0, goal = toPaise(a.goal) || 0;
  const rent = toPaise(a.rent) || 0;
  const loanP = toPaise(a.loanAmount);
  const rate = Number(a.rate) + (Number(stress.ratePlus) || 0);

  // Scenario loan handling: a rejected loan with no release has no EMI and no cash.
  let emiLoanP = loanP;
  if (life.loanRejected && life.loanRejected.enabled){
    const released = toPaise(life.loanRejected.released) || 0;
    emiLoanP = life.loanRejected.status === 'partly' ? released : 0;
  }
  const emi = emiPaise(emiLoanP, rate, Number(a.years)) || 0;

  let extraIncome = 0, extraCost = 0;
  for (const r of rows){
    if (!r || r.amount === '' || r.amount == null) continue;
    const amt = toPaise(r.amount);
    if (amt == null || !rowAppears(r, m)) continue;
    if (r.kind === 'income') extraIncome += amt; else extraCost += amt;
  }

  const rentDue = (rent > 0 && inWindow(Number(a.rentStart), Number(a.rentMonths), m)) ? rent : 0;

  // Base remainder for month m.
  let remaining = income + other - essentials - debt - ownership - emi - goal - rentDue + extraIncome - extraCost;
  const notes = [];

  // Pressure test: income drop applies to regular take-home income only.
  let reduction = 0;
  if (Number(stress.dropPct) > 0 && inWindow(Number(stress.dropStart), Number(stress.dropMonths), m)){
    reduction = Math.floor(income * Number(stress.dropPct) / 100 + 0.5); // income is already paise
    remaining -= reduction;
  }

  // Life event: job loss / return from abroad.
  if (life.jobLoss && life.jobLoss.enabled){
    const j = life.jobLoss;
    if (inWindow(Number(j.gapStart), Number(j.gapMonths), m)){
      remaining -= income;                       // the affected stream stops
      if (j.otherStops) remaining -= other;
      notes.push('income gap');
    }
    if (j.newIncome !== '' && j.newIncome != null && Number(j.newIncomeStart) >= 1 && m >= Number(j.newIncomeStart)){
      remaining += toPaise(j.newIncome) || 0;    // explicit replacement income only
    }
    if (j.severance !== '' && j.severance != null && m === Number(j.severanceMonth)) remaining += toPaise(j.severance) || 0;
    if (j.relocationCost !== '' && j.relocationCost != null && m === Number(j.relocationMonth)) remaining -= toPaise(j.relocationCost) || 0;
    if (j.newRecurringCost !== '' && j.newRecurringCost != null && m >= Number(j.newCostStart || 1)) remaining -= toPaise(j.newRecurringCost) || 0;
    // Foreign-currency stream: never converted without a user-entered dated rate.
    if (j.fxAmount !== '' && j.fxAmount != null && Number(j.fxStart) >= 1 && m >= Number(j.fxStart)){
      if (j.fxRate !== '' && j.fxRate != null && Number(j.fxRate) > 0){
        remaining += rhu(Number(j.fxAmount) * Number(j.fxRate));
        if (j.fxFee !== '' && j.fxFee != null && m === Number(j.fxStart)) remaining -= toPaise(j.fxFee) || 0;
      }
      // else: deliberately excluded; surfaced as an unknown by the caller.
    }
  }

  // Life event: earner death (family continuity sketch).
  if (life.earnerDeath && life.earnerDeath.enabled){
    const d = life.earnerDeath;
    if (Number(d.endMonth) >= 1 && m >= Number(d.endMonth)){
      remaining -= income;                       // the earner's income ends
      if (d.otherStops) remaining -= other;
      if (d.expenseDelta !== '' && d.expenseDelta != null) remaining -= toPaise(d.expenseDelta) || 0;
    }
    if (d.claimStatus === 'received' && d.claimAmount !== '' && d.claimAmount != null && m === Number(d.claimMonth)){
      remaining += toPaise(d.claimAmount) || 0;  // settled claim, once, on its date; not auto-applied to principal
      notes.push('claim received');
    }
    // 'pending' or 'unknown' claim adds Rs 0 settled cash. EMI (debt) always continues.
  }

  return { month: m, remaining, reduction, emi, rentDue, extraIncome, extraCost, notes };
}

function computeAll(a, rows, stress, life){
  const required = ['income', 'essentials', 'projectCost', 'own', 'cash', 'reserve', 'loanAmount', 'rate', 'years'];
  const missing = required.filter(k => a[k] === '' || a[k] == null || !Number.isFinite(Number(a[k])));
  const stressOk = (stress.dropPct === '' || (Number(stress.dropPct) >= 0 && Number(stress.dropPct) <= 100))
    && (stress.dropStart === '' || (Number.isInteger(Number(stress.dropStart)) && Number(stress.dropStart) >= 1 && Number(stress.dropStart) <= 12))
    && (stress.dropMonths === '' || (Number.isInteger(Number(stress.dropMonths)) && Number(stress.dropMonths) >= 0 && Number(stress.dropMonths) <= 12))
    && (stress.overrun === '' || Number(stress.overrun) >= 0);
  // Calc-level range validation, fail closed. Blank required fields stay in
  // `missing` above - unknown stays unknown; only ENTERED values are range-checked
  // here, and nothing is ever clamped to fit.
  const invalid = [];
  const finiteIn = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!missing.includes('income') && !finiteIn(a.income, 0, 1e9)) invalid.push('income outside 0-1,000,000,000');
  if (!missing.includes('projectCost') && !finiteIn(a.projectCost, 0, 1e11)) invalid.push('project cost outside 0-100,000,000,000');
  if (!missing.includes('rate') && !finiteIn(a.rate, 0, 60)) invalid.push('rate outside 0-60%');
  if (!missing.includes('years') && !(Number.isInteger(Number(a.years)) && Number(a.years) >= 1 && Number(a.years) <= 40)) invalid.push('years must be a whole number 1-40');
  const rp = stress.ratePlus === '' || stress.ratePlus == null ? 0 : Number(stress.ratePlus);
  if (!Number.isFinite(rp) || rp < -10 || rp > 20) invalid.push('rate stress outside -10..+20 points');
  else if (!missing.includes('rate') && !finiteIn(Number(a.rate) + rp, 0, 60)) invalid.push('rate plus stress must stay within 0-60%');
  if (missing.length || !stressOk || invalid.length) return { ready: false, missing, stressOk, invalid };

  const months = [];
  for (let m = 1; m <= 12; m++) months.push(computeMonth(a, rows, stress, life, m));
  const total = months.reduce((s, x) => s + x.remaining, 0);
  const avg = Math.floor(total / 12 + 0.5); // paise, half-up
  let tightest = months[0];
  for (const x of months) if (x.remaining < tightest.remaining) tightest = x;
  const negativeMonths = months.filter(x => x.remaining < 0).map(x => x.month);

  // Funding gap: extra project cost raises the cost side; it is never taken silently
  // from cash or the protected reserve. An unreleased facility is not settled cash.
  // Funding gap counts the facility being planned (it is a funding source for the
  // project), except in the rejected-loan scenario where only money already
  // released counts. The 'not settled cash' caveat applies to the reserve
  // headroom below, and is stated in the caveats list.
  let loanCashP = toPaise(a.loanAmount);
  let loanCounted = true;
  if (life.loanRejected && life.loanRejected.enabled){
    const released = toPaise(life.loanRejected.released) || 0;
    loanCashP = life.loanRejected.status === 'partly' ? released : 0;
    loanCounted = true; // 'released' is 0 unless partly released, so the gap keeps only real cash
  }
  const gapBasis = (toPaise(a.projectCost) + (toPaise(stress.overrun) || 0)) - toPaise(a.own) - (loanCounted ? loanCashP : 0);
  const fundingGap = Math.max(0, gapBasis); // negative means surplus, shown separately
  const surplus = Math.max(0, -gapBasis);
  const reserveHeadroom = toPaise(a.cash) - toPaise(a.own) - (toPaise(a.commitments) || 0) - toPaise(a.reserve);

  return {
    ready: true, months, avg, tightest, negativeMonths,
    fundingGap, surplus, reserveHeadroom,
    emiUsed: months[0].emi,
    unknowns: collectUnknowns(a, stress, life),
  };
}

function collectUnknowns(a, stress, life){
  const u = [];
  if (a.loanReleased !== 'received') u.push('The loan is not counted as settled cash until the lender releases it.');
  if (life.jobLoss && life.jobLoss.enabled){
    const j = life.jobLoss;
    if (j.fxAmount !== '' && j.fxAmount != null && !(j.fxRate !== '' && Number(j.fxRate) > 0))
      u.push('A foreign-currency income stream is excluded: no dated FX rate entered. Currencies are never mixed without one.');
    if (Number(j.gapStart) + Number(j.gapMonths) - 1 > 12)
      u.push('The income gap runs past the 12-month view. Months beyond 12 are unknown, not a recovery.');
    if ((j.newIncome === '' || j.newIncome == null) && j.newIncomeStart !== '' && j.newIncomeStart != null)
      u.push('A new job start month was entered without a salary. It stays unknown rather than assumed.');
  }
  if (life.loanRejected && life.loanRejected.enabled)
    u.push('Rejected-loan view zeroes only future undisbursed draws. Amounts already released stay as debt; payments already made stay paid.');
  if (life.earnerDeath && life.earnerDeath.enabled){
    const d = life.earnerDeath;
    if (d.claimStatus === 'pending' || d.claimStatus === 'unknown')
      u.push('The life-cover claim is not settled cash while pending or unknown. This is not a prediction of any payout.');
    if (d.coborrower === 'unknown')
      u.push('Co-borrower liability on the loan needs confirmation with the lender. Debt is shown as continuing.');
    u.push('Family-continuity sketch only: no probabilities, premiums, tax or legal conclusions. A professional should review real plans.');
  }
  return u;
}

/* Node test hook; browser wiring lives below. */
const PT_CORE = { rhu, toPaise, fromPaise, fmt, emiPaise, firstMonthBalancePaise, rowAppears, computeMonth, computeAll };
if (typeof module !== 'undefined' && module.exports) module.exports = PT_CORE;

/* ---------- browser wiring ---------- */
if (typeof document !== 'undefined') (function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const F = [ // baseline fields: [key, label, hint]
    ['income', 'Monthly take-home income (₹)', 'Regular salary or business income you can rely on.'],
    ['otherIncome', 'Other reliable monthly income (₹)', 'Optional. Leave blank if none.'],
    ['essentials', 'Monthly essentials, excluding rent and debt (₹)', 'Food, utilities, transport, school.'],
    ['debt', 'Payments on other debts each month (₹)', 'Optional.'],
    ['ownership', 'Monthly ownership costs once home (₹)', 'Maintenance, association, property tax averaged. Optional.'],
    ['goal', 'Monthly long-term goal allocation (₹)', 'The amount the home must not crowd out. You set it.'],
  ];
  const H = [
    ['projectCost', 'Expected project / purchase cost (₹)', ''],
    ['own', 'Own contribution planned (₹)', 'The part you pay from your own cash.'],
    ['cash', 'Settled cash today (₹)', 'Money actually in your accounts now.'],
    ['reserve', 'Protected reserve (₹)', 'Cash that should stay untouched. You set it.'],
    ['commitments', 'Cash already promised to named bills (₹)', 'Optional.'],
    ['loanAmount', 'Illustrative loan amount (₹)', ''],
    ['rate', 'Annual interest rate (%)', 'One fixed illustrative rate; resets are not modeled.'],
    ['years', 'Loan term (years)', ''],
  ];

  const FICTION = {
    a: { income: 150000, otherIncome: 0, essentials: 55000, debt: 12000, ownership: 6000, goal: 20000,
         rent: 18000, rentStart: 4, rentMonths: 1,
         projectCost: 5000000, own: 1000000, cash: 1000000, reserve: 600000, commitments: 0,
         loanAmount: 4000000, rate: 9, years: 20, loanReleased: 'later' },
    rows: [
      { label: 'Health insurance premium', amount: 30000, kind: 'expense', freq: 'once', firstMonth: 2, lastMonth: '' },
      { label: 'Car insurance and service', amount: 42000, kind: 'expense', freq: 'once', firstMonth: 3, lastMonth: '' },
      { label: 'School fees term', amount: 30000, kind: 'expense', freq: 'once', firstMonth: 4, lastMonth: '' },
      { label: 'Car renewal', amount: 24000, kind: 'expense', freq: 'once', firstMonth: 7, lastMonth: '' },
      { label: 'Family festival costs', amount: 24000, kind: 'expense', freq: 'once', firstMonth: 10, lastMonth: '' },
    ],
    stress: { ratePlus: 0, dropPct: '', dropStart: '', dropMonths: '', overrun: '' },
    life: { kind: 'none' },
  };

  let rows = [];

  function fieldHtml(key, label, hint, value){
    return `<label class="pt-field">${esc(label)}<input id="pt-${esc(key)}" type="number" min="0" step="any" inputmode="decimal" value="${esc(value ?? '')}" placeholder="Not sure yet">${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</label>`;
  }

  function renderInputs(){
    $('pt-base-fields').innerHTML = F.map(([k, l, h]) => fieldHtml(k, l, h, state.a[k])).join('');
    $('pt-home-fields').innerHTML = H.map(([k, l, h]) => fieldHtml(k, l, h, state.a[k])).join('') +
      `<div class="pt-field"><span>Has the lender actually released this loan?</span><div class="pt-choices" role="group" aria-label="Loan release status">
        <button type="button" data-rel="received" class="${state.a.loanReleased === 'received' ? 'selected' : ''}">Received</button>
        <button type="button" data-rel="later" class="${state.a.loanReleased !== 'received' ? 'selected' : ''}">Not yet / unsure</button></div>
        <small class="hint">A loan that has not arrived is not settled cash.</small></div>`;
    $('pt-rent-fields').innerHTML =
      fieldHtml('rent', 'Current rent each month (₹)', 'Only counted during the overlap below.', state.a.rent) +
      fieldHtml('rentStart', 'Rent overlap starts in month (1-12)', '', state.a.rentStart) +
      fieldHtml('rentMonths', 'How many months rent overlaps (0-12)', '', state.a.rentMonths);
  }

  function rowHtml(r, i){
    return `<div class="pt-row" data-i="${i}">
      <input type="text" placeholder="Label" value="${esc(r.label)}" data-k="label" aria-label="Item label">
      <input type="number" min="0" step="any" placeholder="Amount ₹" value="${esc(r.amount)}" data-k="amount" aria-label="Amount">
      <select data-k="kind" aria-label="Income or expense">
        <option value="expense"${r.kind === 'expense' ? ' selected' : ''}>Expense</option>
        <option value="income"${r.kind === 'income' ? ' selected' : ''}>Income</option></select>
      <select data-k="freq" aria-label="Frequency">
        <option value="once"${r.freq === 'once' ? ' selected' : ''}>One-off</option>
        <option value="monthly"${r.freq === 'monthly' ? ' selected' : ''}>Monthly</option>
        <option value="quarterly"${r.freq === 'quarterly' ? ' selected' : ''}>Quarterly</option>
        <option value="annual"${r.freq === 'annual' ? ' selected' : ''}>Annual</option></select>
      <input type="number" min="1" max="12" step="1" placeholder="First month" value="${esc(r.firstMonth)}" data-k="firstMonth" aria-label="First month (1-12)">
      <button type="button" class="ghost" data-del="${i}">Remove</button></div>`;
  }
  function renderRows(){ $('pt-rows').innerHTML = rows.map(rowHtml).join('') || '<p class="hint">No dated items yet. Annual, quarterly and one-off costs belong here so a lumpy month is never averaged away.</p>'; }

  function lifeHtml(){
    const kind = state.life.kind;
    if (kind === 'job') return `<div class="pt-sub">
      <p class="hint">Job loss or a move back from abroad: say which income stops and for how long, what cash arrives, and what changes. Unknown figures stay unknown.</p>
      ${fieldHtml('j-gapStart', 'Income gap starts in month (1-12)', '', state.life.jobLoss.gapStart)}
      ${fieldHtml('j-gapMonths', 'Gap length in months (2, 3 or your own)', 'A gap past month 12 shows as unknown, not recovery.', state.life.jobLoss.gapMonths)}
      <label class="pt-check"><input type="checkbox" id="pt-j-otherStops"${state.life.jobLoss.otherStops ? ' checked' : ''}> Other reliable income stops too</label>
      ${fieldHtml('j-severance', 'Severance or accessible cash (₹)', 'Optional one-off amount.', state.life.jobLoss.severance)}
      ${fieldHtml('j-severanceMonth', 'Severance arrives in month', '', state.life.jobLoss.severanceMonth)}
      ${fieldHtml('j-relocationCost', 'One-off relocation cost (₹)', 'Optional.', state.life.jobLoss.relocationCost)}
      ${fieldHtml('j-relocationMonth', 'Relocation cost falls in month', '', state.life.jobLoss.relocationMonth)}
      ${fieldHtml('j-newIncome', 'Replacement monthly income (₹)', 'Only if you choose a figure. Blank stays unknown.', state.life.jobLoss.newIncome)}
      ${fieldHtml('j-newIncomeStart', 'Replacement income starts in month', '', state.life.jobLoss.newIncomeStart)}
      ${fieldHtml('j-newRecurringCost', 'New recurring monthly cost (₹)', 'Optional, e.g. higher living costs after a move.', state.life.jobLoss.newRecurringCost)}
      ${fieldHtml('j-newCostStart', 'New cost starts in month', '', state.life.jobLoss.newCostStart)}
      <div class="pt-fx"><strong>Income in another currency?</strong>
      ${fieldHtml('j-fxAmount', 'Foreign amount per month', 'Never added to ₹ without your own rate.', state.life.jobLoss.fxAmount)}
      ${fieldHtml('j-fxRate', 'Your FX rate (₹ per 1 unit)', 'Enter a rate you would actually get.', state.life.jobLoss.fxRate)}
      ${fieldHtml('j-fxFee', 'One-off transfer fee (₹)', '', state.life.jobLoss.fxFee)}
      ${fieldHtml('j-fxStart', 'This income starts in month', '', state.life.jobLoss.fxStart)}</div></div>`;
    if (kind === 'rejected') return `<div class="pt-sub">
      <p class="hint">If this loan is refused: future, undisbursed money is removed. Debt already released and payments already made stay.</p>
      <div class="pt-field"><span>Where does the loan stand?</span><div class="pt-choices" role="group" aria-label="Loan status">
        ${['expected', 'sanctioned', 'partly'].map(s => `<button type="button" data-lr="${s}" class="${state.life.loanRejected.status === s ? 'selected' : ''}">${s === 'partly' ? 'Partly released' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div>
      ${fieldHtml('lr-released', 'Amount already released (₹)', 'Only if partly released.', state.life.loanRejected.released)}
      <p class="hint">Alternatives to weigh separately: another lender, a smaller build, or a pause. Non-refundable payments already made are not recovered here.</p></div>`;
    if (kind === 'death') return `<div class="pt-sub">
      <p class="hint">Family continuity planning: if the earning person dies, what happens to income, costs and the loan? This is a careful sketch, not insurance or legal advice.</p>
      ${fieldHtml('d-endMonth', 'Income ends from month (1-12)', '', state.life.earnerDeath.endMonth)}
      <label class="pt-check"><input type="checkbox" id="pt-d-otherStops"${state.life.earnerDeath.otherStops ? ' checked' : ''}> Other reliable income ends too</label>
      ${fieldHtml('d-expenseDelta', 'Monthly family expense change (₹)', 'Optional increase after the loss.', state.life.earnerDeath.expenseDelta)}
      <div class="pt-field"><span>Life cover claim status</span><div class="pt-choices" role="group" aria-label="Claim status">
        ${['none', 'pending', 'received', 'unknown'].map(s => `<button type="button" data-ed="${s}" class="${state.life.earnerDeath.claimStatus === s ? 'selected' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        <small class="hint">A pending or unknown claim adds ₹0 settled cash. A payout is never inferred.</small></div>
      ${fieldHtml('d-claimAmount', 'Claim amount if received (₹)', 'Counted once, on its date; not auto-applied to the loan.', state.life.earnerDeath.claimAmount)}
      ${fieldHtml('d-claimMonth', 'Claim received in month', '', state.life.earnerDeath.claimMonth)}
      <div class="pt-field"><span>Is there a co-borrower liable for the loan?</span><div class="pt-choices" role="group" aria-label="Co-borrower">
        ${['yes', 'no', 'unknown'].map(s => `<button type="button" data-cb="${s}" class="${state.life.earnerDeath.coborrower === s ? 'selected' : ''}">${s === 'unknown' ? 'Needs confirmation' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        <small class="hint">Debt is shown as continuing unless a documented discharge exists. Ask a professional to review.</small></div></div>`;
    return '';
  }

  let state = null;
  function blankLife(){
    return { kind: 'none',
      jobLoss: { enabled: false, gapStart: '', gapMonths: '', otherStops: false, severance: '', severanceMonth: '', relocationCost: '', relocationMonth: '', newIncome: '', newIncomeStart: '', newRecurringCost: '', newCostStart: '', fxAmount: '', fxRate: '', fxFee: '', fxStart: '' },
      loanRejected: { enabled: false, status: 'expected', released: '' },
      earnerDeath: { enabled: false, endMonth: '', otherStops: false, expenseDelta: '', claimStatus: 'none', claimAmount: '', claimMonth: '', coborrower: 'unknown' } };
  }
  function blankState(){
    return { a: { income: '', otherIncome: '', essentials: '', debt: '', ownership: '', goal: '', rent: '', rentStart: '', rentMonths: '', projectCost: '', own: '', cash: '', reserve: '', commitments: '', loanAmount: '', rate: '', years: '', loanReleased: 'later' },
      stress: { ratePlus: 0, dropPct: '', dropStart: '', dropMonths: '', overrun: '' },
      life: blankLife() };
  }

  function readInputs(){
    for (const [k] of F.concat(H, [['rent'], ['rentStart'], ['rentMonths']])){
      const el = $('pt-' + k); if (el) state.a[k] = el.value;
    }
    state.stress.ratePlus = Number($('pt-ratePlus').value) || 0;
    state.stress.dropPct = $('pt-dropPct').value;
    state.stress.dropStart = $('pt-dropStart').value;
    state.stress.dropMonths = $('pt-dropMonths').value;
    state.stress.overrun = $('pt-overrun').value;
    document.querySelectorAll('#pt-rows .pt-row').forEach(el => {
      const i = Number(el.dataset.i), r = rows[i];
      el.querySelectorAll('[data-k]').forEach(inp => { r[inp.dataset.k] = inp.value; });
    });
    const L = state.life, J = L.jobLoss, R = L.loanRejected, D = L.earnerDeath;
    const val = id => { const el = $(id); return el ? el.value : ''; };
    if (L.kind === 'job'){ J.gapStart = val('pt-j-gapStart'); J.gapMonths = val('pt-j-gapMonths'); J.otherStops = $('pt-j-otherStops').checked;
      J.severance = val('pt-j-severance'); J.severanceMonth = val('pt-j-severanceMonth'); J.relocationCost = val('pt-j-relocationCost'); J.relocationMonth = val('pt-j-relocationMonth');
      J.newIncome = val('pt-j-newIncome'); J.newIncomeStart = val('pt-j-newIncomeStart'); J.newRecurringCost = val('pt-j-newRecurringCost'); J.newCostStart = val('pt-j-newCostStart');
      J.fxAmount = val('pt-j-fxAmount'); J.fxRate = val('pt-j-fxRate'); J.fxFee = val('pt-j-fxFee'); J.fxStart = val('pt-j-fxStart'); }
    if (L.kind === 'rejected'){ R.released = val('pt-lr-released'); }
    if (L.kind === 'death'){ D.endMonth = val('pt-d-endMonth'); D.otherStops = $('pt-d-otherStops').checked; D.expenseDelta = val('pt-d-expenseDelta');
      D.claimAmount = val('pt-d-claimAmount'); D.claimMonth = val('pt-d-claimMonth'); }
    J.enabled = L.kind === 'job'; R.enabled = L.kind === 'rejected'; D.enabled = L.kind === 'death';
  }

  function stat(title, value, detail){
    return `<div class="pt-card"><h4>${esc(title)}</h4><p class="pt-big">${esc(value)}</p><small>${esc(detail)}</small></div>`;
  }

  function render(){
    readInputs();
    const noStress = { ratePlus: 0, dropPct: '', dropStart: '', dropMonths: '', overrun: '' };
    const noLife = blankLife();
    const base = computeAll(state.a, rows, noStress, noLife);
    const scen = computeAll(state.a, rows, state.stress, state.life);
    const out = $('pt-results');
    if (!base.ready){
      out.innerHTML = `<div class="pt-panel"><h3>Your answer appears here</h3><p class="hint">${base.missing.length ? 'Still needed before anything is calculated (a blank is unknown, never zero): ' + esc(base.missing.join(', ')) + '.' : ''}${!base.stressOk ? ' Check the pressure-test entries: drop 0-100%, start month 1-12, whole-month duration 0-12, and a non-negative extra cost.' : ''}${base.invalid && base.invalid.length ? ' Outside a safe range (nothing was clamped): ' + esc(base.invalid.join('; ')) + '.' : ''}</p></div>`;
      return;
    }
    const stressed = scen.ready && (Number(state.stress.ratePlus) > 0 || Number(state.stress.dropPct) > 0 || Number(state.stress.overrun) > 0 || state.life.kind !== 'none');
    const lifeName = { none: '', job: 'Income gap / move scenario', rejected: 'Loan refused scenario', death: 'Family continuity scenario' }[state.life.kind];
    let html = `<div class="pt-panel"><h3>Baseline month</h3><div class="pt-cards">` +
      stat('EMI used', fmt(base.emiUsed), 'Fixed-rate illustration, round-half-up to paise') +
      stat('Month 1 remainder', fmt(base.months[0].remaining), 'A regular month before dated items') +
      stat('Year-one average', fmt(base.avg), 'Average of the 12 monthly remainders') +
      stat('Tightest month', fmt(base.tightest.remaining), 'Month ' + base.tightest.month + ' is the hardest') +
      `</div>` +
      (base.negativeMonths.length ? `<p class="pt-alert">Months below zero in the baseline: ${base.negativeMonths.map(m => 'month ' + m).join(', ')}.</p>` : '') +
      `<div class="pt-cards">` +
      stat('Project funding gap', fmt(base.fundingGap), base.surplus > 0 ? 'Surplus of ' + fmt(base.surplus) + ' above the entered cost' : 'Cost less own contribution and counted loan') +
      stat('Reserve headroom', fmt(base.reserveHeadroom), 'Settled cash less contribution, promises and reserve') +
      `</div>`;
    if (base.ready && !scen.ready){
      html += `<p class="pt-alert">The what-if entries are outside a safe range, so the scenario is not calculated${scen.invalid && scen.invalid.length ? ': ' + esc(scen.invalid.join('; ')) : ''}. Nothing was clamped.</p>`;
    }
    if (stressed && scen.ready){
      html += `<h3>What-if view${lifeName ? ' · ' + esc(lifeName) : ''}</h3><div class="pt-cards">` +
        stat('EMI under test', fmt(scen.emiUsed), Number(state.stress.ratePlus) > 0 ? 'Rate +' + state.stress.ratePlus + ' points' : 'Same loan terms') +
        stat('Year-one average', fmt(scen.avg), 'Shift of ' + fmt(scen.avg - base.avg) + ' vs baseline') +
        stat('Tightest month', fmt(scen.tightest.remaining), 'Month ' + scen.tightest.month) +
        stat('Funding gap', fmt(scen.fundingGap), Number(state.stress.overrun) > 0 ? 'Includes +' + fmt(toPaise(state.stress.overrun)) + ' extra cost' : 'Unchanged cost side') +
        `</div>` +
        (scen.negativeMonths.length ? `<p class="pt-alert">Months below zero under the scenario: ${scen.negativeMonths.map(m => 'month ' + m).join(', ')}. The reserve is never spent automatically.</p>` : '');
      if (scen.unknowns.length) html += `<ul class="pt-notes">${scen.unknowns.map(u => `<li>${esc(u)}</li>`).join('')}</ul>`;
      html += `<h3>Month by month</h3><div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>Month</th><th>Baseline</th><th>Scenario</th><th>What moves it</th></tr></thead><tbody>` +
        scen.months.map((s, i) => {
          const b = base.months[i];
          const why = [s.reduction ? 'income down ' + fmt(s.reduction) : '', s.rentDue ? 'rent ' + fmt(s.rentDue) : '', s.extraCost ? 'bills ' + fmt(s.extraCost) : '', s.extraIncome ? 'extra income ' + fmt(s.extraIncome) : '', s.notes.join(', ')].filter(Boolean).join(' · ');
          return `<tr${s.remaining < 0 ? ' class="pt-neg"' : ''}><td>Month ${s.month}</td><td>${fmt(b.remaining)}</td><td>${fmt(s.remaining)}</td><td>${esc(why)}</td></tr>`;
        }).join('') + `</tbody></table></div>`;
    }
    html += `<p class="hint">What this is: a first-year what-if sketch on your own figures, using one fixed rate and a full-balance EMI with round-half-up paise. What it is not: a lender statement, a risk probability, tax, insurance or legal advice. Staged draws, rate resets and fees are separate questions for the lender.</p></div>`;
    out.innerHTML = html;
  }

  function bindRelease(){
    document.querySelectorAll('#pt-home-fields [data-rel]').forEach(b => b.addEventListener('click', () => { readInputs(); state.a.loanReleased = b.dataset.rel; renderInputs(); bindRelease(); render(); }));
  }
  function bind(){
    $('pt-add-row').addEventListener('click', () => { readInputs(); rows.push({ label: '', amount: '', kind: 'expense', freq: 'once', firstMonth: '', lastMonth: '' }); renderRows(); render(); });
    $('pt-rows').addEventListener('click', e => { const d = e.target.dataset.del; if (d != null){ readInputs(); rows.splice(Number(d), 1); renderRows(); render(); } });
    $('pt-rows').addEventListener('change', () => render());
    document.querySelectorAll('[data-life]').forEach(b => b.addEventListener('click', () => { readInputs(); state.life.kind = b.dataset.life; $('pt-life-fields').innerHTML = lifeHtml(); bindLife(); render(); }));
    $('pt-ratePlus').addEventListener('input', () => { $('pt-ratePlus-val').textContent = '+' + $('pt-ratePlus').value + ' points'; });
    $('pt-fictional').addEventListener('click', () => {
      state = blankState(); Object.assign(state.a, FICTION.a); rows = FICTION.rows.map(r => ({ ...r }));
      state.stress = { ...FICTION.stress }; state.life = blankLife();
      $('pt-ratePlus').value = 0; $('pt-ratePlus-val').textContent = '+0 points';
      $('pt-dropPct').value = ''; $('pt-dropStart').value = ''; $('pt-dropMonths').value = ''; $('pt-overrun').value = '';
      document.querySelectorAll('[data-life]').forEach(b => b.classList.toggle('selected', b.dataset.life === 'none'));
      $('pt-life-fields').innerHTML = '';
      renderInputs(); renderRows(); render();
    });
    $('pt-reset').addEventListener('click', () => { state = blankState(); rows = []; $('pt-dropPct').value = ''; $('pt-dropStart').value = ''; $('pt-dropMonths').value = ''; $('pt-overrun').value = ''; $('pt-ratePlus').value = 0; $('pt-ratePlus-val').textContent = '+0 points'; document.querySelectorAll('[data-life]').forEach(b => b.classList.toggle('selected', b.dataset.life === 'none')); $('pt-life-fields').innerHTML = ''; renderInputs(); renderRows(); render(); });
    $('pt-app').addEventListener('input', e => { if (e.target.matches('input')) render(); });
  }
  function bindLife(){
    document.querySelectorAll('#pt-life-fields [data-lr]').forEach(b => b.addEventListener('click', () => { state.life.loanRejected.status = b.dataset.lr; document.querySelectorAll('#pt-life-fields [data-lr]').forEach(x => x.classList.toggle('selected', x === b)); render(); }));
    document.querySelectorAll('#pt-life-fields [data-ed]').forEach(b => b.addEventListener('click', () => { state.life.earnerDeath.claimStatus = b.dataset.ed; document.querySelectorAll('#pt-life-fields [data-ed]').forEach(x => x.classList.toggle('selected', x === b)); render(); }));
    document.querySelectorAll('#pt-life-fields [data-cb]').forEach(b => b.addEventListener('click', () => { state.life.earnerDeath.coborrower = b.dataset.cb; document.querySelectorAll('#pt-life-fields [data-cb]').forEach(x => x.classList.toggle('selected', x === b)); render(); }));
  }

  state = blankState();
  renderInputs(); renderRows(); bind(); bindRelease(); render();
})();
