const oc = require('./outcomes.js');
let fails = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok){ fails++; console.log('FAIL', n, 'got', g, 'want', w); } else console.log('ok  ', n, g); };

// Fictional fixture: income 150000, essentials 55000, debt 12000, goal 20000, rent 18000
const inp = { income: 150000, essentials: 55000, debt: 12000, goal: 20000, rent: 18000 };
const r = oc.compute(inp);
eq('ready', r.ready, true);
eq('rent known', r.rentKnown, true);
eq('set-aside 63,000', oc.fromPaise(r.setAside), 63000);
eq('1m monthly cashflow 45,000', oc.fromPaise(r.oneMonth.monthlyFlow), 45000);
eq('1m cash saved 45,000', oc.fromPaise(r.oneMonth.cashSaved), 45000);
eq('1m rent paid 18,000', oc.fromPaise(r.oneMonth.rentPaid), 18000);
eq('1y cash saved 5,40,000', oc.fromPaise(r.oneYear.cashSaved), 540000);
eq('1y rent paid 2,16,000', oc.fromPaise(r.oneYear.rentPaid), 216000);

// No gain/loss framing anywhere in the model or caveats
eq('no loss wording in caveats', r.caveats.some(c => /loss|gain/i.test(c) && !/no numeric gain or loss/i.test(c)), false);

// Blank rent: unknown, gated - never a 0 row of numbers
const r2 = oc.compute({ income: 100000, essentials: 60000, debt: '', goal: '', rent: '' });
eq('blank rent: still ready (set-aside shown)', r2.ready, true);
eq('blank rent: rentKnown false', r2.rentKnown, false);
eq('blank rent: horizons gated', r2.oneMonth === null && r2.oneYear === null, true);
eq('blank rent: set-aside still computed', oc.fromPaise(r2.setAside), 40000);

// Explicit 0 rent is a real answer, distinct from blank
const r0 = oc.compute({ income: 100000, essentials: 60000, debt: '', goal: '', rent: 0 });
eq('explicit 0 rent: known', r0.rentKnown, true);
eq('explicit 0 rent: cashflow = set-aside', oc.fromPaise(r0.oneMonth.monthlyFlow), 40000);
eq('explicit 0 rent: rent paid 0, honestly', oc.fromPaise(r0.oneMonth.rentPaid), 0);
eq('explicit 0 rent: noted in caveats', r0.caveats.some(c => c.includes('0 rent')), true);
eq('explicit 0 differs from blank', r0.oneMonth !== null && r2.oneMonth === null, true);

// No buy-now counterfactual is claimed
eq('buy-now caveat stated', r.caveats.some(c => c.includes('No buy-now scenario is modeled')), true);

// Negative month flagged, never silently zeroed
const r3 = oc.compute({ income: 50000, essentials: 60000, debt: '', goal: '', rent: 5000 });
eq('negative set-aside caveat', r3.caveats.some(c => c.includes('already negative')), true);

// Unknown stays unknown
const r4 = oc.compute({ income: '', essentials: 55000, debt: '', goal: '', rent: '' });
eq('blank income blocks', r4.ready, false);
eq('blank income is missing not invalid', r4.missing.includes('income') && r4.invalid.length === 0, true);

// Range validation
eq('negative rent blocked', oc.compute({ ...inp, rent: -1 }).ready, false);
eq('absurd income blocked', oc.compute({ ...inp, income: 1e10 }).ready, false);

// waitCashflow guards
eq('zero months rejected', oc.waitCashflow(100, 0, 0), null);

// Caveats present and plain
const cav = oc.whatIfCaveats();
eq('job caveat', cav.some(c => c.title.includes('job ends')), true);
eq('move caveat', cav.some(c => c.title.includes('move countries')), true);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
