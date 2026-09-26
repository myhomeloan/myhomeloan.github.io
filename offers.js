'use strict';
/*
 * Concept 3 - "Translate my loan offer".
 * Guided offer workspace: breaks one or two loan offers into plain parts,
 * tracks what is still unknown as a bank-question checklist, and compares
 * two offers on the same 12-month assumptions. Standalone page module.
 *
 * Money convention: integer paise, ROUND-HALF-UP to 2 decimals on any
 * formula result (shared convention with the pressure-test feature).
 * Unknown is null/blank, never zero. KFS APR is quoted separately and never
 * mixed with modeled costs. No lender data is bundled; nothing leaves the browser.
 */
function rhu(x){ return Math.floor(x * 100 + 0.5); }
function toPaise(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
function fromPaise(p){ return p / 100; }
function fmt(p){ if (p == null || !Number.isFinite(p)) return 'unknown'; const neg = p < 0, abs = Math.abs(p); return (neg ? '-' : '') + '₹' + (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function emiPaise(principalPaise, annualRatePct, termMonths){
  const n = Math.round(termMonths);
  if (!(principalPaise > 0) || !(n > 0)) return null;
  const i = annualRatePct / 1200;
  if (i === 0) return Math.round(principalPaise / n);
  return Math.floor(principalPaise * i / (1 - Math.pow(1 + i, -n)) + 0.5);
}
// Simple full-month pre-EMI interest on the actually drawn balance.
function preEmiInterestPaise(drawnPaise, annualRatePct){
  if (!(drawnPaise > 0)) return 0; // no actual release -> zero drawn-principal interest
  return Math.floor(drawnPaise * (annualRatePct / 1200) + 0.5);
}

/* Offer shape:
 * { label, amount, rateType:'fixed'|'floating'|'hybrid'|'', nominalPct, benchmark, spreadPct,
 *   resetDate, fixedUntil, termMonths, preEmiMode:'interestOnly'|'emi'|'',
 *   draws: [{label, amount, plannedDate, actualDate, status:'planned'|'requested'|'released'}],
 *   fees: [{label, amount, financed:bool, known:bool}],
 *   prepaymentKnown:bool, prepaymentNotes, kfsAprPct,
 *   fieldStatus: {fieldKey: 'answered'|'askBank'|'notApplicable'} }
 * Money fields are rupees as entered; blank/askBank means unknown.
 */

const ASKABLE = [
  ['nominalPct', 'the exact annual interest rate'],
  ['rateType', 'whether the rate is fixed, floating or hybrid'],
  ['benchmark', 'the benchmark and spread (for a floating/hybrid rate)'],
  ['resetDate', 'when the rate can reset'],
  ['termMonths', 'the loan term in months'],
  ['preEmiMode', 'whether you pay interest-only (pre-EMI) or full EMI before the full draw'],
  ['fees', 'every fee: amount, due date, and whether it is paid in cash or financed'],
  ['prepayment', 'the prepayment rules and any charge'],
  ['kfsAprPct', 'the APR from the Key Facts Statement (KFS)'],
  ['insurance', 'any required insurance and its cost'],
];

function unansweredQuestions(offer){
  const st = offer.fieldStatus || {};
  const out = [];
  for (const [key, label] of ASKABLE){
    if (st[key] === 'askBank') out.push({ field: key, prompt: 'Ask the bank: ' + label + '.' });
    else if (st[key] !== 'notApplicable' && isEmpty(offer, key)) out.push({ field: key, prompt: 'Not entered yet: ' + label + '.' });
  }
  return out;
}
function isEmpty(offer, key){
  switch (key){
    case 'nominalPct': return offer.nominalPct === '' || offer.nominalPct == null;
    case 'rateType': return !offer.rateType;
    case 'benchmark': return (offer.rateType === 'floating' || offer.rateType === 'hybrid') && !offer.benchmark && (offer.spreadPct === '' || offer.spreadPct == null);
    case 'resetDate': return (offer.rateType === 'floating' || offer.rateType === 'hybrid') && !offer.resetDate;
    case 'termMonths': return offer.termMonths === '' || offer.termMonths == null;
    case 'preEmiMode': return !offer.preEmiMode;
    case 'fees': return !offer.fees.length;
    case 'prepayment': return !offer.prepaymentKnown;
    case 'kfsAprPct': return offer.kfsAprPct === '' || offer.kfsAprPct == null;
    case 'insurance': return !offer.insuranceKnown;
    default: return false;
  }
}

function validateOffer(offer){
  const errs = [];
  const amt = Number(offer.amount);
  if (offer.amount !== '' && !(amt > 0)) errs.push('The loan amount must be positive.');
  if (offer.nominalPct !== '' && offer.nominalPct != null && !(Number(offer.nominalPct) >= 0 && Number(offer.nominalPct) <= 100)) errs.push('The rate looks impossible (outside 0-100%). Nothing was clamped.');
  if (offer.termMonths !== '' && offer.termMonths != null && !(Number(offer.termMonths) > 0)) errs.push('The term must be a positive number of months.');
  for (const f of offer.fees) if (f.known && !(Number(f.amount) >= 0)) errs.push('Fee "' + (f.label || 'unnamed') + '" is negative; rejected rather than clamped.');
  const drawnPlanned = offer.draws.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  if (offer.amount !== '' && drawnPlanned > amt) errs.push('The draws add up to more than the sanctioned amount.');
  return errs;
}

// Modeled monthly outflow in month m (1-12) for one offer, on the entered draws.
// A draw raises interest only from its ACTUAL release date; planned/requested draws
// add nothing until received. Dates are YYYY-MM; month m maps to an entered start month.
function monthlyOutflow(offer, startYearMonth, m){
  // A blank rate is unknown, never 0%: Number('') === 0 would silently model a
  // free loan and let a blank offer show (and rank) as zero.
  if (offer.nominalPct === '' || offer.nominalPct == null) return { outflow: null, balance: null, note: 'rate unknown' };
  const rate = Number(offer.nominalPct);
  if (!Number.isFinite(rate)) return { outflow: null, balance: null, note: 'rate unknown' };
  if (rate < 0 || rate > 100) return { outflow: null, balance: null, note: 'rate outside 0-100%' };
  const [sy, sm] = (startYearMonth || '2027-01').split('-').map(Number);
  const winStart = sy * 12 + (sm - 1);
  const anyRelease = offer.draws.some(d => d.status === 'released' && d.actualDate && d.actualDate.split('-').map(Number)[0]);
  const drawn = releasedDrawsUpTo(offer, startYearMonth, m);
  const drawnTotal = drawn.reduce((s, d) => s + toPaise(d.amount), 0);
  if (drawnTotal === 0){
    // No release anywhere: unknown, never zero - nothing can be modeled.
    if (!anyRelease) return { outflow: null, balance: 0, note: 'nothing released yet' };
    // Releases exist but start later: this month has no debt and no EMI due.
    // Zero is the truth for THIS month (unlike the never-released case).
    return { outflow: 0, balance: 0, note: 'no release yet this month' };
  }
  // Never guess the repayment mode: a blank choice is unknown, never a default
  // full EMI. The numeric comparison stays blocked until one is chosen.
  if (offer.preEmiMode !== 'interestOnly' && offer.preEmiMode !== 'emi') return { outflow: null, balance: drawnTotal, note: 'repayment mode unknown' };
  const fullyDrawn = offer.amount !== '' && drawnTotal >= toPaise(offer.amount);
  if (offer.preEmiMode === 'interestOnly' && !fullyDrawn){
    return { outflow: preEmiInterestPaise(drawnTotal, rate), balance: drawnTotal, note: 'pre-EMI interest on released amount' };
  }
  // Full-EMI mode: only RELEASED debt exists. The EMI basis is the released
  // amount, never the sanction - a partial release cannot carry a full-sanction
  // EMI or balance. Repayment and balance roll forward from each ACTUAL release
  // date: a release before the comparison window accrues its pre-window interest
  // and EMIs first, so the window opens on the true outstanding balance.
  const term = Number(offer.termMonths);
  const emi = emiPaise(drawnTotal, rate, term);
  if (emi == null) return { outflow: null, balance: drawnTotal, note: 'term unknown' };
  const monthlyRate = rate / 1200;
  const firstIdx = Math.min(...drawn.map(d => { const [y, mo] = d.actualDate.split('-').map(Number); return y * 12 + (mo - 1); }));
  let bal = 0, prevDrawnP = 0, outflowM = emi, paidOff = false;
  for (let idx = firstIdx; idx < winStart + m; idx++){
    const drawnP = releasedDrawsUpTo(offer, startYearMonth, idx - winStart + 1).reduce((s2, d) => s2 + toPaise(d.amount), 0);
    const newRelease = drawnP - prevDrawnP;
    if (idx === winStart + m - 1 && bal === 0 && newRelease === 0){ paidOff = true; outflowM = 0; } // loan already repaid before this month
    bal += newRelease; // a new release joins the principal in its own month
    prevDrawnP = drawnP;
    const emiK = emiPaise(drawnP, rate, term);
    if (emiK != null && bal > 0){
      const interest = Math.floor(bal * monthlyRate + 0.5);
      bal = Math.max(0, bal + interest - emiK);
    }
  }
  const note = paidOff ? 'paid off before this month' : (drawnTotal < (toPaise(offer.amount) || 0) ? 'modeled EMI on released amount only' : 'modeled EMI');
  return { outflow: outflowM, balance: bal, note };
}

function releasedDrawsUpTo(offer, startYearMonth, m){
  // Draws with an actual release date up to month m count - INCLUDING releases
  // before the comparison start: an earlier release is existing debt and its
  // interest/EMI does not vanish when the window opens later.
  const [sy, sm] = (startYearMonth || '2027-01').split('-').map(Number);
  const limit = sy * 12 + (sm - 1) + m; // months 1..m inclusive
  return offer.draws.filter(d => {
    if (d.status !== 'released' || !d.actualDate) return false;
    const [y, mo] = d.actualDate.split('-').map(Number);
    if (!y || !mo) return false;
    return y * 12 + (mo - 1) < limit;
  });
}

function knownFees(offer){
  // A fee marked known but entered without an amount is NOT zero: Number('')
  // would silently make it 0. It joins the unknown list, loudly.
  const usable = f => f.known && f.amount !== '' && f.amount != null && Number.isFinite(Number(f.amount));
  const cash = offer.fees.filter(f => usable(f) && !f.financed).reduce((s, f) => s + toPaise(f.amount), 0);
  const financed = offer.fees.filter(f => usable(f) && f.financed).reduce((s, f) => s + toPaise(f.amount), 0);
  const unknown = offer.fees.filter(f => !usable(f)).map(f => (f.label || 'unnamed fee') + (f.known ? ' (marked known but no amount entered)' : ''));
  return { cash, financed, unknown };
}

function compareOffers(a, b, startYearMonth){
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(m);
  // A year total exists only when EVERY month is modeled. Any unknown month makes
  // the year unknown too: an invalid or blank offer must never show or rank as zero.
  const sum = (offer) => {
    let total = 0;
    for (const m of months){
      const o = monthlyOutflow(offer, startYearMonth, m).outflow;
      if (o == null) return null;
      total += o;
    }
    return total;
  };
  const fa = knownFees(a), fb = knownFees(b);
  const va = validateOffer(a), vb = validateOffer(b);
  // An offer that fails validation (e.g. an impossible rate) is EXCLUDED from
  // the numeric comparison: its figures are unknown, its errors are listed, and
  // it can never rank on numbers it failed to validate.
  const side = (offer, fees, errs) => ({
    outflowYear: errs.length ? null : sum(offer),
    balanceEnd: errs.length ? null : monthlyOutflow(offer, startYearMonth, 12).balance,
    fees, provisional: provisionalReasons(offer), errors: errs,
  });
  const rowsOut = { a: side(a, fa, va), b: side(b, fb, vb), warnings: [] };
  if (va.length) rowsOut.warnings.push('Offer A fails validation (' + va.join(' ') + ') and is excluded from the numeric comparison.');
  if (vb.length) rowsOut.warnings.push('Offer B fails validation (' + vb.join(' ') + ') and is excluded from the numeric comparison.');
  // Say WHY it is unknown: a released draw with a blank repayment mode is not
  // "missing rate, term, or draw" - it is a mode we refuse to guess.
  const whyUnknown = (offer) => {
    const hasRelease = releasedDrawsUpTo(offer, startYearMonth, 12).length > 0;
    if (hasRelease && offer.preEmiMode !== 'interestOnly' && offer.preEmiMode !== 'emi') return 'repayment mode unknown';
    return 'missing rate, term, or no released draw yet';
  };
  if (rowsOut.a.outflowYear == null) rowsOut.warnings.push('Offer A year-one outflow is unknown (' + whyUnknown(a) + '). Unknown is never zero, so it cannot be ranked cheaper.');
  if (rowsOut.b.outflowYear == null) rowsOut.warnings.push('Offer B year-one outflow is unknown (' + whyUnknown(b) + '). Unknown is never zero, so it cannot be ranked cheaper.');
  if (fa.unknown.length) rowsOut.warnings.push('Offer A total excludes unknown fee(s): ' + fa.unknown.join(', ') + '. It is not treated as zero.');
  if (fb.unknown.length) rowsOut.warnings.push('Offer B total excludes unknown fee(s): ' + fb.unknown.join(', ') + '. It is not treated as zero.');
  if ((a.draws.length > 1 || b.draws.length > 1)) rowsOut.warnings.push('Staged draws make a simple EMI comparison misleading; the month-by-month view is the honest one.');
  return rowsOut;
}
function provisionalReasons(offer){
  const reasons = [];
  if ((offer.rateType === 'floating' || offer.rateType === 'hybrid') && !offer.resetDate) reasons.push('no reset date');
  if (!offer.draws.length) reasons.push('no draw schedule');
  if (knownFees(offer).unknown.length) reasons.push('unknown fee');
  // A blank repayment mode is an open question, never a guessed default: the
  // offer stays marked provisional until one is chosen.
  if (offer.preEmiMode !== 'interestOnly' && offer.preEmiMode !== 'emi') reasons.push('repayment mode unknown');
  return reasons;
}

const OF_CORE = { rhu, toPaise, fromPaise, fmt, emiPaise, preEmiInterestPaise, unansweredQuestions, validateOffer, monthlyOutflow, knownFees, compareOffers, provisionalReasons, ASKABLE };
if (typeof module !== 'undefined' && module.exports) module.exports = OF_CORE;

/* ---------- browser wiring ---------- */
if (typeof document !== 'undefined') (function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const KEY = 'mhl-offer-workspace-v1';

  function blankOffer(label){
    return { label: label || 'Offer A', status: 'draft', path: '', amount: '', rateType: '', nominalPct: '', benchmark: '', spreadPct: '', resetDate: '', fixedUntil: '', termMonths: '', preEmiMode: '', draws: [], fees: [], prepaymentKnown: false, prepaymentNotes: '', insuranceKnown: false, kfsAprPct: '', fieldStatus: {} };
  }
  function fictionalOffer(){
    const o = blankOffer('Fictional bank offer');
    o.path = 'offer'; o.amount = 1200000; o.rateType = 'fixed'; o.nominalPct = 12; o.termMonths = 12; o.preEmiMode = 'emi';
    o.draws = [{ label: 'Full release', amount: 1200000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }];
    o.fees = [{ label: 'Processing fee', amount: 5000, financed: false, known: true }];
    o.prepaymentKnown = true; o.insuranceKnown = true; o.kfsAprPct = 12.7;
    o.fieldStatus = { nominalPct: 'answered', rateType: 'answered', termMonths: 'answered', preEmiMode: 'answered', fees: 'answered', prepayment: 'answered', kfsAprPct: 'answered', insurance: 'answered' };
    return o;
  }

  let offers = [blankOffer('Offer A'), blankOffer('Offer B')];
  let active = 0, startYM = '2027-01';

  function save(){ try{ localStorage.setItem(KEY, JSON.stringify({ offers, startYM })); }catch{} }
  function load(){ try{ const raw = localStorage.getItem(KEY); if (raw){ const p = JSON.parse(raw); if (p && Array.isArray(p.offers) && p.offers.length === 2){ offers = p.offers; startYM = p.startYM || startYM; return true; } } }catch{} return false; }

  function askRow(o, key, label, controlHtml){
    const st = (o.fieldStatus || {})[key] || '';
    return `<div class="lo-qrow" data-field="${esc(key)}"><div class="lo-qhead"><strong>${esc(label)}</strong><span class="lo-flags" role="group" aria-label="Mark ${esc(label)}">
      <button type="button" data-st="askBank" class="${st === 'askBank' ? 'selected' : ''}">Ask my bank</button>
      <button type="button" data-st="notApplicable" class="${st === 'notApplicable' ? 'selected' : ''}">Not applicable</button>
      ${st ? `<button type="button" data-st="" class="lo-clear">Clear mark</button>` : ''}</span></div>${controlHtml}</div>`;
  }
  const inp = (id, val, opts) => `<input id="${id}" type="${(opts && opts.type) || 'number'}" ${opts && opts.type === 'month' ? '' : 'min="0" step="any" inputmode="decimal"'} value="${esc(val ?? '')}" placeholder="${esc((opts && opts.ph) || 'Not sure yet')}">`;

  function renderOffer(){
    const o = offers[active];
    $('lo-offer-label').value = o.label;
    $('lo-path').innerHTML = ['', 'exploring', 'offer', 'taken'].map(p => `<button type="button" data-path="${p}" class="${o.path === p ? 'selected' : ''}">${p === '' ? 'Choose…' : p === 'exploring' ? 'Still exploring' : p === 'offer' ? 'I have an offer' : 'Loan already taken'}</button>`).join('');
    const body = [
      askRow(o, 'amount', 'Loan amount and draw dates',
        inp('lo-amount', o.amount, { ph: 'Sanctioned amount ₹' }) +
        `<div class="lo-draws" id="lo-draws">${o.draws.map((d, i) => drawHtml(d, i)).join('')}</div><button type="button" class="lo-btn" id="lo-add-draw">Add a draw / release</button>`),
      askRow(o, 'rateType', 'Fixed, floating or hybrid',
        `<div class="lo-choices" id="lo-ratetype">${['fixed', 'floating', 'hybrid'].map(t => `<button type="button" data-rt="${t}" class="${o.rateType === t ? 'selected' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`),
      askRow(o, 'nominalPct', 'Annual interest rate (%)', inp('lo-nominalPct', o.nominalPct, { ph: '% per year' })),
      askRow(o, 'benchmark', 'Benchmark and spread', inp('lo-benchmark', o.benchmark, { type: 'text', ph: 'e.g. repo-linked' }) + inp('lo-spreadPct', o.spreadPct, { ph: 'spread %' })),
      askRow(o, 'resetDate', 'Rate reset / fixed-until date', inp('lo-resetDate', o.resetDate, { type: 'month' }) + inp('lo-fixedUntil', o.fixedUntil, { type: 'month' })),
      askRow(o, 'termMonths', 'Loan term (months)', inp('lo-termMonths', o.termMonths, { ph: 'e.g. 240' })),
      askRow(o, 'preEmiMode', 'Repayment before the full draw',
        `<div class="lo-choices" id="lo-preemi">${[['interestOnly', 'Interest-only (pre-EMI)'], ['emi', 'Full EMI from start']].map(([v, l]) => `<button type="button" data-pe="${v}" class="${o.preEmiMode === v ? 'selected' : ''}">${l}</button>`).join('')}</div>`),
      askRow(o, 'fees', 'Fees (upfront, financed or recurring)',
        `<div class="lo-fees" id="lo-fees">${o.fees.map((f, i) => feeHtml(f, i)).join('')}</div><button type="button" class="lo-btn" id="lo-add-fee">Add a fee</button>`),
      askRow(o, 'prepayment', 'Prepayment rules',
        `<label class="lo-check"><input type="checkbox" id="lo-prepay-known"${o.prepaymentKnown ? ' checked' : ''}> Terms known</label><input id="lo-prepay-notes" type="text" value="${esc(o.prepaymentNotes)}" placeholder="e.g. no charge on floating rate, per sanction letter">`),
      askRow(o, 'insurance', 'Required insurance',
        `<label class="lo-check"><input type="checkbox" id="lo-ins-known"${o.insuranceKnown ? ' checked' : ''}> Insurance requirement and cost known</label>`),
      askRow(o, 'kfsAprPct', 'KFS APR (%) — quoted, never mixed with modeled costs', inp('lo-kfsAprPct', o.kfsAprPct, { ph: 'APR from Key Facts Statement' })),
    ].join('');
    $('lo-offer-body').innerHTML = body;
    bindOffer();
    renderQuestions(); renderCompare(); save();
  }
  function drawHtml(d, i){
    return `<div class="lo-draw" data-i="${i}"><input type="text" data-k="label" value="${esc(d.label)}" placeholder="Stage" aria-label="Draw label"><input type="number" min="0" data-k="amount" value="${esc(d.amount)}" placeholder="Amount ₹" aria-label="Draw amount"><input type="month" data-k="plannedDate" value="${esc(d.plannedDate)}" aria-label="Planned month"><input type="month" data-k="actualDate" value="${esc(d.actualDate)}" aria-label="Actual month"><select data-k="status" aria-label="Draw status">${['planned', 'requested', 'released'].map(s => `<option${d.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="button" class="lo-del" data-del-draw="${i}">Remove</button></div>`;
  }
  function feeHtml(f, i){
    return `<div class="lo-fee" data-i="${i}"><input type="text" data-k="label" value="${esc(f.label)}" placeholder="Fee name" aria-label="Fee name"><input type="number" min="0" data-k="amount" value="${f.known ? esc(f.amount) : ''}" placeholder="${f.known ? 'Amount ₹' : 'Amount unknown'}" aria-label="Fee amount"><label><input type="checkbox" data-k="financed"${f.financed ? ' checked' : ''}> Financed</label><label><input type="checkbox" data-k="known"${f.known ? ' checked' : ''}> Known</label><button type="button" class="lo-del" data-del-fee="${i}">Remove</button></div>`;
  }

  function readOffer(){
    const o = offers[active];
    const v = id => { const el = $(id); return el ? el.value : o[id.replace('lo-', '').replace(/-([a-z])/g, (m, c) => c.toUpperCase())]; };
    o.label = $('lo-offer-label').value || o.label;
    o.amount = v('lo-amount'); o.nominalPct = v('lo-nominalPct'); o.benchmark = v('lo-benchmark'); o.spreadPct = v('lo-spreadPct');
    o.resetDate = v('lo-resetDate'); o.fixedUntil = v('lo-fixedUntil'); o.termMonths = v('lo-termMonths'); o.kfsAprPct = v('lo-kfsAprPct');
    const pk = $('lo-pre-pay-known') || $('lo-prepay-known'); if (pk) o.prepaymentKnown = pk.checked;
    const pn = $('lo-prepay-notes'); if (pn) o.prepaymentNotes = pn.value;
    const ik = $('lo-ins-known'); if (ik) o.insuranceKnown = ik.checked;
    document.querySelectorAll('#lo-draws .lo-draw').forEach(el => { const d = o.draws[Number(el.dataset.i)]; if (d) el.querySelectorAll('[data-k]').forEach(inp2 => { d[inp2.dataset.k] = inp2.type === 'checkbox' ? inp2.checked : inp2.value; }); });
    document.querySelectorAll('#lo-fees .lo-fee').forEach(el => { const f = o.fees[Number(el.dataset.i)]; if (f) el.querySelectorAll('[data-k]').forEach(inp2 => { f[inp2.dataset.k] = inp2.type === 'checkbox' ? inp2.checked : inp2.value; }); });
  }

  function bindOffer(){
    document.querySelectorAll('#lo-path [data-path]').forEach(b => b.addEventListener('click', () => { readOffer(); offers[active].path = b.dataset.path; renderOffer(); }));
    document.querySelectorAll('#lo-ratetype [data-rt]').forEach(b => b.addEventListener('click', () => { readOffer(); offers[active].rateType = b.dataset.rt; renderOffer(); }));
    document.querySelectorAll('#lo-preemi [data-pe]').forEach(b => b.addEventListener('click', () => { readOffer(); offers[active].preEmiMode = b.dataset.pe; renderOffer(); }));
    document.querySelectorAll('.lo-qrow [data-st]').forEach(b => b.addEventListener('click', () => { readOffer(); const row = b.closest('.lo-qrow'); offers[active].fieldStatus[row.dataset.field] = b.dataset.st; renderOffer(); }));
    $('lo-add-draw').addEventListener('click', () => { readOffer(); offers[active].draws.push({ label: '', amount: '', plannedDate: '', actualDate: '', status: 'planned' }); renderOffer(); });
    $('lo-add-fee').addEventListener('click', () => { readOffer(); offers[active].fees.push({ label: '', amount: '', financed: false, known: false }); renderOffer(); });
    document.querySelectorAll('[data-del-draw]').forEach(b => b.addEventListener('click', () => { readOffer(); offers[active].draws.splice(Number(b.dataset.delDraw), 1); renderOffer(); }));
    document.querySelectorAll('[data-del-fee]').forEach(b => b.addEventListener('click', () => { readOffer(); offers[active].fees.splice(Number(b.dataset.delFee), 1); renderOffer(); }));
  }

  function renderQuestions(){
    readOffer();
    const o = offers[active];
    const errs = validateOffer(o);
    const qs = unansweredQuestions(o);
    $('lo-errors').innerHTML = errs.length ? `<div class="lo-alert">${errs.map(e => `<p>${esc(e)}</p>`).join('')}</div>` : '';
    $('lo-checklist').innerHTML = qs.length
      ? `<h3>Questions for the bank (${qs.filter(q => q.prompt.startsWith('Ask')).length} to ask · ${qs.length} open)</h3><p class="lo-hint">A checklist only. Nothing is sent anywhere; copy it into your own email or call.</p><ul>${qs.map(q => `<li>${esc(q.prompt)}</li>`).join('')}</ul>`
      : '<h3>Questions for the bank</h3><p class="lo-hint">Every tracked field is answered or marked not applicable.</p>';
  }

  function moneyOr(p){ return p == null ? 'unknown' : fmt(p); }
  function renderCompare(){
    const [a, b] = offers;
    const res = compareOffers(a, b, startYM);
    const col = (name, r, o) => `<div class="lo-card"><h4>${esc(name)}${r.provisional.length ? ' · provisional (' + esc(r.provisional.join(', ')) + ')' : ''}</h4>
      <p class="pt-big">${moneyOr(r.outflowYear)}</p><small>modeled year-one outflow (EMI / pre-EMI interest only)</small>
      ${r.errors && r.errors.length ? '<ul class="lo-err">' + r.errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>' : ''}
      <p><strong>Balance after month 12:</strong> ${moneyOr(r.balanceEnd)}<br>
      <strong>Known fees, cash:</strong> ${fmt(r.fees.cash)} · <strong>financed:</strong> ${fmt(r.fees.financed)}${r.fees.unknown.length ? '<br><strong>Excluded unknown fee(s):</strong> ' + esc(r.fees.unknown.join(', ')) : ''}<br>
      <strong>KFS APR (quoted separately):</strong> ${o.kfsAprPct !== '' && o.kfsAprPct != null ? esc(o.kfsAprPct) + '%' : 'not entered'}</p></div>`;
    $('lo-compare').innerHTML = `<h3>Side by side, same assumptions</h3><div class="lo-cards">${col(a.label || 'Offer A', res.a, a)}${col(b.label || 'Offer B', res.b, b)}</div>` +
      (res.warnings.length ? `<ul class="lo-notes">${res.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '') +
      `<p class="lo-hint">Modeled cost uses your entered draws and the simple monthly convention; the KFS APR comes from the lender's statement and can differ. An offer with an unknown fee is never ranked cheaper by hiding that fee. Rates can change and teaser periods end; a selected offer without reset, draw or fee terms stays marked provisional.</p>`;
  }

  function bind(){
    $('lo-tab-a').addEventListener('click', () => { readOffer(); active = 0; markTabs(); renderOffer(); });
    $('lo-tab-b').addEventListener('click', () => { readOffer(); active = 1; markTabs(); renderOffer(); });
    $('lo-fictional').addEventListener('click', () => { offers[active] = fictionalOffer(); renderOffer(); });
    $('lo-start').addEventListener('change', () => { startYM = $('lo-start').value || startYM; renderCompare(); save(); });
    $('lo-app').addEventListener('input', e => { if (e.target.matches('input') && !e.target.closest('.lo-draw') && !e.target.closest('.lo-fee')) { renderQuestions(); renderCompare(); save(); } });
    $('lo-app').addEventListener('change', e => { if (e.target.closest('.lo-draw') || e.target.closest('.lo-fee')) { renderQuestions(); renderCompare(); save(); } });
    $('lo-clear').addEventListener('click', () => { offers = [blankOffer('Offer A'), blankOffer('Offer B')]; try{ localStorage.removeItem(KEY); }catch{}; renderOffer(); });
  }
  function markTabs(){ $('lo-tab-a').classList.toggle('selected', active === 0); $('lo-tab-b').classList.toggle('selected', active === 1); }

  load();
  $('lo-start').value = startYM;
  markTabs(); bind(); renderOffer();
})();
