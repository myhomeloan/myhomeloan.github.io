'use strict';
/*
 * Outcomes slice - "Cashflow while you wait"  (DRAFT - NOT WIRED, NOT LIVE)
 * ======================================================================
 * Standalone page module. Not referenced by index.html; does nothing until
 * opened directly or wired into a tab.
 *
 * SCOPE (peer-agreed slice, reframed after peer review):
 *   - Illustrative cashflow while delaying a purchase by 1 month or 1 year.
 *   - Plain-language what-if caveats for job termination and moving countries.
 *   - Local-first (localStorage only) with JSON export.
 *
 * FRAMING (peer review 2026-09-26):
 *   - NO numeric "gain of delaying" or "loss of delaying" is shown. A delay
 *     gain/loss needs an explicit buy-now counterfactual (occupancy date,
 *     interim rent during construction, loan start, ownership costs), which
 *     this page does NOT model. Rent paid while waiting is a fact of the
 *     wait, not a loss: buying now does not imply zero housing cost from
 *     day one. What is shown: cashflow while you wait.
 *   - NO property-price growth is assumed in either direction.
 *   - Caveats are plain language, not predictions or advice.
 *
 * Money convention (project-wide): integer paise internally, round-half-up to
 * 2 decimals on every formula result. A blank answer is unknown, never zero:
 * a blank rent gates every rent-dependent number (explicit 0 = "I pay no
 * rent", blank = "I have not said").
 */
function rhu(x){ return Math.floor(x * 100 + 0.5); }
function toPaise(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
function fromPaise(p){ return p / 100; }
function fmt(p){ if (p == null || !Number.isFinite(p)) return 'unknown'; const neg = p < 0, abs = Math.abs(p); return (neg ? '-' : '') + '₹' + (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* Cashflow over N waiting months.
 * setAside     = monthly amount left before housing (income - essentials - debt - goal), paise
 * rent         = monthly rent paid while waiting, paise (0 = genuinely rent-free)
 * monthlyFlow  = setAside - rent: the cash left each month while waiting
 * cashSaved    = monthlyFlow * N: what reaches the home fund over the wait
 * rentPaid     = rent * N: rent outflow over the same months (a fact of the
 *                wait, NOT labeled a loss - see FRAMING above)
 */
function waitCashflow(setAside, rent, months){
  if (!Number.isInteger(months) || months < 1) return null;
  const monthlyFlow = setAside - rent;
  return { months, rentPaid: rent * months, cashSaved: monthlyFlow * months, monthlyFlow };
}

function compute(inputs){
  const required = ['income', 'essentials'];
  const missing = required.filter(k => inputs[k] === '' || inputs[k] == null || !Number.isFinite(Number(inputs[k])));
  const invalid = [];
  const fin = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!missing.includes('income') && !fin(inputs.income, 0, 1e9)) invalid.push('income outside 0-1,000,000,000');
  if (!missing.includes('essentials') && !fin(inputs.essentials, 0, 1e9)) invalid.push('essentials outside 0-1,000,000,000');
  for (const k of ['debt', 'goal']){
    const v = inputs[k];
    if (v !== '' && v != null && !fin(v, 0, 1e9)) invalid.push(k + ' outside 0-1,000,000,000');
  }
  const rentKnown = inputs.rent !== '' && inputs.rent != null;
  if (rentKnown && !fin(inputs.rent, 0, 1e9)) invalid.push('rent outside 0-1,000,000,000');
  if (missing.length || invalid.length) return { ready: false, missing, invalid };
  const setAside = toPaise(inputs.income) - toPaise(inputs.essentials) - (toPaise(inputs.debt) || 0) - (toPaise(inputs.goal) || 0);
  const rent = rentKnown ? toPaise(inputs.rent) : null;
  const caveats = [];
  if (setAside < 0) caveats.push('Your entered month is already negative before any home cost. Waiting cannot save what is not there; the pressure-test page is the better next step.');
  if (rentKnown && rent === 0) caveats.push('You entered 0 rent: the wait adds no rent outflow. If you meant "I have not checked yet", leave the rent blank instead.');
  caveats.push('No buy-now scenario is modeled here: buying now can carry its own housing costs before you move in (construction time, interim rent, EMI before possession). Because that side is not modeled, this page shows no numeric gain or loss from delaying - only your cashflow while you wait.');
  return {
    ready: true, rentKnown, setAside, rent,
    oneMonth: rentKnown ? waitCashflow(setAside, rent, 1) : null,
    oneYear: rentKnown ? waitCashflow(setAside, rent, 12) : null,
    caveats,
  };
}

/* Plain-language what-if caveats (no calculations, no predictions). */
function whatIfCaveats(){
  return [
    { title: 'If a job ends while you wait',
      body: 'The monthly set-aside stops the month the income stops; rent and essentials continue. If the loan was already taken, the EMI continues too - it does not pause with a job. Model the exact months on the pressure-test page (income-gap scenario).' },
    { title: 'If you move countries while you wait',
      body: 'A move adds one-off relocation costs and usually an income restart gap. Foreign-currency income is never converted without a dated rate. The return-from-abroad scenario on the pressure-test page walks these month by month.' },
  ];
}

const OC_CORE = { rhu, toPaise, fromPaise, fmt, waitCashflow, compute, whatIfCaveats };
if (typeof module !== 'undefined' && module.exports) module.exports = OC_CORE;

/* ---------- browser wiring ---------- */
if (typeof document !== 'undefined') (function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const KEY = 'mhl-outcomes-v1';
  const FIELDS = ['income', 'essentials', 'debt', 'goal', 'rent'];

  function fictional(){
    return { income: 150000, essentials: 55000, debt: 12000, goal: 20000, rent: 18000 };
  }
  function save(){ try{ const o = {}; FIELDS.forEach(f => o[f] = $( 'oc-' + f).value); localStorage.setItem(KEY, JSON.stringify(o)); }catch{} }
  function load(){ try{ const raw = localStorage.getItem(KEY); if (!raw) return; const p = JSON.parse(raw); FIELDS.forEach(f => { if (p[f] !== undefined) $('oc-' + f).value = p[f]; }); }catch{} }
  function readInputs(){
    const o = {};
    FIELDS.forEach(f => o[f] = $('oc-' + f).value);
    return o;
  }

  function card(title, value, detail){
    return `<div class="oc-card"><h4>${esc(title)}</h4><p class="oc-big">${esc(value)}</p><small>${esc(detail)}</small></div>`;
  }
  /* Two cards per horizon, deliberately: a monthly figure beside its own
   * total is a duplicate, and three overlapping cards invite adding them up.
   * The monthly cashflow is shown ONCE, next to the set-aside, before the
   * horizons. */
  function horizon(label, d){
    const span = d.months + (d.months === 1 ? ' month' : ' months');
    return `<div class="oc-horizon"><h3>${esc(label)}</h3><div class="oc-cards">` +
      card('Added to your home fund over ' + span, fmt(d.cashSaved), 'Your monthly waiting cashflow, totalled. This is cashflow while you wait, not a gain over buying now') +
      card('Rent paid over ' + span, fmt(d.rentPaid), 'A fact of the wait, not a scored loss: buying now can carry its own housing costs before move-in') +
      `</div></div>`;
  }

  function render(){
    const inputs = readInputs();
    const res = compute(inputs);
    const out = $('oc-results');
    if (!res.ready){
      out.innerHTML = `<div class="oc-panel"><h3>Your answer appears here</h3><p class="oc-hint">${res.missing.length ? 'Still needed (a blank is unknown, never zero): ' + esc(res.missing.join(', ')) + '.' : ''}${res.invalid && res.invalid.length ? ' Outside a safe range (nothing was clamped): ' + esc(res.invalid.join('; ')) + '.' : ''}</p></div>`;
      return;
    }
    let html = `<div class="oc-panel"><h3>Your cashflow while you wait</h3>` +
      `<p class="oc-hint">What this page shows: the cash you keep (or do not keep) each month while you wait. What it deliberately does not show: a numeric gain or loss from delaying, because that needs a full buy-now comparison (occupancy date, interim rent, loan start, ownership costs) which is not modeled here. No property-price change is assumed in either direction. This is an illustration, not a forecast, and not financial advice.</p>` +
      `<div class="oc-cards">` +
      card('Set aside each month before housing', fmt(res.setAside), 'Income minus essentials, debt payments and goal allocation') +
      (res.rentKnown ? card('Cash left each month while you wait', fmt(res.oneMonth.monthlyFlow), 'Your set-aside after rent') : '') +
      `</div>`;
    if (!res.rentKnown){
      html += `<div class="oc-notes"><p>Your rent is blank, so the waiting cashflow stays unknown - a blank is never treated as 0. Enter your current rent, or enter 0 if you genuinely pay none, and the 1-month and 1-year figures appear.</p></div>`;
    } else {
      html += horizon('Wait 1 month', res.oneMonth) + horizon('Wait 1 year', res.oneYear);
    }
    if (res.caveats.length) html += `<ul class="oc-notes">${res.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
    html += `<h3>What-if caveats</h3>` + whatIfCaveats().map(c => `<div class="oc-caveat"><strong>${esc(c.title)}</strong><p>${esc(c.body)}</p></div>`).join('');
    html += `<p class="oc-hint">Local-first: these figures stay in this browser (your device's storage). Export downloads a JSON copy you can keep or delete. Nothing is sent anywhere.</p></div>`;
    out.innerHTML = html;
  }

  function exportJson(){
    const inputs = readInputs();
    const res = compute(inputs);
    const payload = {
      tool: 'myhomeloan waiting-cashflow illustration (draft)',
      exportedAt: new Date().toISOString(),
      framing: ['cashflow while you wait only', 'no numeric delay gain or loss: no buy-now counterfactual is modeled', 'no property-price growth assumed', 'a blank rent is unknown, never zero', 'illustration, not advice'],
      inputs,
      result: res.ready ? (res.rentKnown ? {
        setAsideMonthly: fromPaise(res.setAside), rentMonthly: fromPaise(res.rent),
        oneMonth: { monthlyCashflow: fromPaise(res.oneMonth.monthlyFlow), cashSaved: fromPaise(res.oneMonth.cashSaved), rentPaid: fromPaise(res.oneMonth.rentPaid) },
        oneYear: { monthlyCashflow: fromPaise(res.oneYear.monthlyFlow), cashSaved: fromPaise(res.oneYear.cashSaved), rentPaid: fromPaise(res.oneYear.rentPaid) },
        caveats: res.caveats,
      } : { setAsideMonthly: fromPaise(res.setAside), rent: 'unknown (blank)', gated: 'waiting cashflow withheld until rent is entered or explicitly set to 0' }) : { notReady: res },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'myhomeloan-waiting-cashflow.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $('oc-fictional').addEventListener('click', () => { const f = fictional(); FIELDS.forEach(k => $('oc-' + k).value = f[k]); render(); save(); });
  $('oc-clear').addEventListener('click', () => { FIELDS.forEach(k => $('oc-' + k).value = ''); try{ localStorage.removeItem(KEY); }catch{} render(); });
  $('oc-export').addEventListener('click', exportJson);
  FIELDS.forEach(f => $('oc-' + f).addEventListener('input', () => { render(); save(); }));
  load();
  render();
})();
