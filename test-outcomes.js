const oc = require('./outcomes.js');
let fails = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok){ fails++; console.log('FAIL', n, 'got', g, 'want', w); } else console.log('ok  ', n, g); };

// Fictional fixture: income 150000, essentials 55000, debt 12000, goal 20000, rent 18000
const inp = { income: 150000, essentials: 55000, debt: 12000, goal: 20000, rent: 18000 };
const r = oc.compute(inp);
eq('ready', r.ready, true);
eq('set-aside 63,000', oc.fromPaise(r.setAside), 63000);
eq('1m rent loss', oc.fromPaise(r.oneMonth.rentPaid), 18000);
eq('1m saved gain', oc.fromPaise(r.oneMonth.saved), 45000);
eq('1y rent loss', oc.fromPaise(r.oneYear.rentPaid), 216000);
eq('1y saved gain', oc.fromPaise(r.oneYear.saved), 540000);

// Optionals blank: debt/goal/rent default 0, still ready
const r2 = oc.compute({ income: 100000, essentials: 60000, debt: '', goal: '', rent: '' });
eq('optionals blank ready', r2.ready, true);
eq('no rent -> saved = full set-aside', oc.fromPaise(r2.oneMonth.saved), 40000);
eq('no rent caveat', r2.caveats.some(c => c.includes('No rent entered')), true);

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

// delayOutcome guards
eq('zero months rejected', oc.delayOutcome(100, 0, 0), null);

// Caveats present and plain
const cav = oc.whatIfCaveats();
eq('job caveat', cav.some(c => c.title.includes('job ends')), true);
eq('move caveat', cav.some(c => c.title.includes('move countries')), true);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
