'use strict';
/*
 * Outcomes slice - "What does waiting do?"  (DRAFT - NOT WIRED, NOT LIVE)
 * ======================================================================
 * Standalone page module. Not referenced by index.html; does nothing until
 * opened directly or wired into a tab.
 *
 * SCOPE (peer-agreed slice):
 *   - Illustrative 1-month and 1-year delay savings/losses.
 *   - Plain-language what-if caveats for job termination and moving countries.
 *   - Local-first (localStorage only) with JSON export.
 *
 * STATED ASSUMPTIONS (approved, and labeled in the UI):
 *   - Extra rent paid while waiting = the LOSS of delaying.
 *   - Extra surplus saved while waiting = the GAIN of delaying.
 *   - NO property-price growth is assumed in either direction.
 *   - Caveats are plain language, not predictions or advice.
 *
 * Money convention (project-wide): integer paise internally, round-half-up to
 * 2 decimals on every formula result. A blank answer is unknown, never zero.
 */
function rhu(x){ return Math.floor(x * 100 + 0.5); }
function toPaise(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
function fromPaise(p){ return p / 100; }
function fmt(p){ if (p == null || !Number.isFinite(p)) return 'unknown'; const neg = p < 0, abs = Math.abs(p); return (neg ? '-' : '') + '₹' + (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* One delay illustration for N months.
 * setAside  = monthly amount left before housing (income - essentials - debt - goal), paise
 * rent      = monthly rent paid while waiting, paise
 * gain      = what actually reaches the home fund over N months = (setAside - rent) * N
 * loss      = rent paid over N months (the cost of waiting; already inside gain, so
 *             gain and loss are NEVER summed - they are two views of the same months)
 * netFund   = gain (net change in the home fund)
 */
function delayOutcome(setAside, rent, months){
  if (!Number.isInteger(months) || months < 1) return null;
  const monthlySaved = setAside - rent;
  return {
    months,
    rentPaid: rent * months,          // the loss of waiting
    saved: monthlySaved * months,     // the gain of waiting (rent already paid out of it)
    monthlySaved,
  };
}

function compute(inputs){
  const required = ['income', 'essentials'];
  const missing = required.filter(k => inputs[k] === '' || inputs[k] == null || !Number.isFinite(Number(inputs[k])));
  const invalid = [];
  const fin = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!missing.includes('income') && !fin(inputs.income, 0, 1e9)) invalid.push('income outside 0-1,000,000,000');
  if (!missing.includes('essentials') && !fin(inputs.essentials, 0, 1e9)) invalid.push('essentials outside 0-1,000,000,000');
  for (const k of ['debt', 'goal', 'rent']){
    const v = inputs[k];
    if (v !== '' && v != null && !fin(v, 0, 1e9)) invalid.push(k + ' outside 0-1,000,000,000');
  }
  if (missing.length || invalid.length) return { ready: false, missing, invalid };
  const setAside = toPaise(inputs.income) - toPaise(inputs.essentials) - (toPaise(inputs.debt) || 0) - (toPaise(inputs.goal) || 0);
  const rent = toPaise(inputs.rent) || 0;
  const caveats = [];
  if (setAside < 0) caveats.push('Your entered month is already negative before any home cost. Waiting cannot save what is not there; the pressure-test page is the better next step.');
  if (rent === 0) caveats.push('No rent entered: the "cost of waiting" shows only the months passing, not money lost. If you live rent-free, waiting may genuinely cost nothing.');
  return {
    ready: true, setAside, rent,
    oneMonth: delayOutcome(setAside, rent, 1),
    oneYear: delayOutcome(setAside, rent, 12),
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

const OC_CORE = { rhu, toPaise, fromPaise, fmt, delayOutcome, compute, whatIfCaveats };
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
  function horizon(label, d){
    return `<div class="oc-horizon"><h3>${esc(label)}</h3><div class="oc-cards">` +
      card('Cost of waiting (rent paid)', fmt(-d.rentPaid), d.months + (d.months === 1 ? ' month' : ' months') + ' of rent you would not pay if you moved now') +
      card('Saved while waiting', fmt(d.saved), 'What actually reaches the home fund, rent already paid out of it') +
      card('Net change to home fund', fmt(d.saved), 'Same figure as the savings: the two views are never added together') +
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
    let html = `<div class="oc-panel"><h3>Waiting, in money</h3>` +
      `<p class="oc-hint">Assumptions, stated plainly: extra rent while waiting is the loss; extra surplus saved is the gain; no property-price change is assumed in either direction. This is an illustration, not a forecast, and not financial advice.</p>` +
      horizon('Wait 1 month', res.oneMonth) +
      horizon('Wait 1 year', res.oneYear);
    if (res.caveats.length) html += `<ul class="oc-notes">${res.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
    html += `<h3>What-if caveats</h3>` + whatIfCaveats().map(c => `<div class="oc-caveat"><strong>${esc(c.title)}</strong><p>${esc(c.body)}</p></div>`).join('');
    html += `<p class="oc-hint">Local-first: these figures stay in this browser (your device\'s storage). Export downloads a JSON copy you can keep or delete. Nothing is sent anywhere.</p></div>`;
    out.innerHTML = html;
  }

  function exportJson(){
    const inputs = readInputs();
    const res = compute(inputs);
    const payload = {
      tool: 'myhomeloan delay-outcomes illustration (draft)',
      exportedAt: new Date().toISOString(),
      assumptions: ['extra rent while waiting = loss', 'extra surplus saved = gain', 'no property-price growth assumed', 'illustration, not advice'],
      inputs,
      result: res.ready ? {
        setAsideMonthly: fromPaise(res.setAside), rentMonthly: fromPaise(res.rent),
        oneMonth: { rentPaid: fromPaise(res.oneMonth.rentPaid), saved: fromPaise(res.oneMonth.saved) },
        oneYear: { rentPaid: fromPaise(res.oneYear.rentPaid), saved: fromPaise(res.oneYear.saved) },
        caveats: res.caveats,
      } : { notReady: res },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'myhomeloan-delay-outcomes.json';
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
