const of = require('./offers.js');
let fails = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok){ fails++; console.log('FAIL', n, 'got', g, 'want', w); } else console.log('ok  ', n, g); };

// Offer A fixture: 1,200,000 @12%, 12 monthly payments, full release month 1
const A = { label: 'A', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'full', amount: 1200000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }],
  fees: [], prepaymentKnown: true, insuranceKnown: true, kfsAprPct: 12.7, fieldStatus: {} };
const m1 = of.monthlyOutflow(A, '2027-01', 1);
eq('EMI 106,618.55', of.fromPaise(m1.outflow), 106618.55);
eq('month-1 balance 1,105,381.45', of.fromPaise(m1.balance), 1105381.45);

// Approval with no actual release -> zero drawn-principal interest
const B = { label: 'B', amount: 300000, rateType: 'fixed', nominalPct: 12, termMonths: 36, preEmiMode: 'interestOnly',
  draws: [{ label: 'first', amount: 300000, plannedDate: '2027-02', actualDate: '', status: 'requested' }], fees: [], fieldStatus: {} };
const bOut = of.monthlyOutflow(B, '2027-01', 2);
eq('no release -> unknown outflow (never zero)', bOut.outflow, null);
eq('no release -> no debt', bOut.balance, 0);
eq('no release -> note', bOut.note, 'nothing released yet');

// 600,000 first release @12% interestOnly -> 6,000 pre-EMI interest
const C = { label: 'C', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'interestOnly',
  draws: [{ label: 'first', amount: 600000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' },
          { label: 'second', amount: 600000, plannedDate: '2027-03', actualDate: '', status: 'requested' }],
  fees: [], fieldStatus: {} };
eq('600k release -> 6,000 interest', of.fromPaise(of.monthlyOutflow(C, '2027-01', 1).outflow), 6000);
eq('requested second draw adds nothing yet', of.fromPaise(of.monthlyOutflow(C, '2027-01', 3).outflow), 6000);

// Unknown fee -> warning, never ranked cheaper silently
const D = { ...A, label: 'D', fees: [{ label: 'Processing fee', amount: '', financed: false, known: false }] };
const cmp = of.compareOffers(A, D, '2027-01');
eq('unknown fee warning', cmp.warnings.some(w => w.includes('Offer B total excludes unknown fee')), true);
eq('unknown fee listed', cmp.b.fees.unknown.join(','), 'Processing fee');

// Validation
eq('negative fee rejected', of.validateOffer({ ...A, fees: [{ label: 'x', amount: -5, known: true }] }).length > 0, true);
eq('zero term rejected', of.validateOffer({ ...A, termMonths: 0 }).length > 0, true);
eq('draw over sanction rejected', of.validateOffer({ ...A, draws: [{ label: 'd', amount: 2000000, status: 'planned' }] }).length > 0, true);
eq('impossible rate rejected', of.validateOffer({ ...A, nominalPct: 140 }).length > 0, true);
eq('clean offer passes', of.validateOffer(A).length, 0);

// Bank-question checklist
const E = { label: 'E', amount: '', rateType: '', nominalPct: '', benchmark: '', spreadPct: '', resetDate: '', termMonths: '', preEmiMode: '', draws: [], fees: [], prepaymentKnown: false, insuranceKnown: false, kfsAprPct: '', fieldStatus: { nominalPct: 'askBank', fees: 'notApplicable' } };
const qs = of.unansweredQuestions(E);
eq('askBank question present', qs.some(q => q.prompt.includes('Ask the bank') && q.field === 'nominalPct'), true);
eq('fees notApplicable not listed', qs.some(q => q.field === 'fees'), false);
eq('unentered fields listed', qs.some(q => q.field === 'termMonths' && q.prompt.startsWith('Not entered')), true);

// Provisional marking
eq('floating without reset is provisional', of.provisionalReasons({ ...A, rateType: 'floating', resetDate: '' }).includes('no reset date'), true);

// Full-EMI mode with zero released draws must not invent outflow or debt
const F = { label: 'F', amount: 500000, rateType: 'fixed', nominalPct: 10, termMonths: 24, preEmiMode: 'emi', draws: [], fees: [], fieldStatus: {} };
const fOut = of.monthlyOutflow(F, '2027-01', 1);
eq('full EMI, no draws -> outflow unknown', fOut.outflow, null);
eq('full EMI, no draws -> balance zero (no debt)', fOut.balance, 0);
eq('full EMI, no draws -> note', fOut.note, 'nothing released yet');

// Releases BEFORE the comparison start still count (existing debt)
const G = { label: 'G', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'interestOnly',
  draws: [{ label: 'old', amount: 600000, plannedDate: '2026-11', actualDate: '2026-11', status: 'released' }], fees: [], fieldStatus: {} };
eq('release before window start counts', of.fromPaise(of.monthlyOutflow(G, '2027-01', 1).outflow), 6000);

// Blank/invalid offer: year and balance unknown, never shown or ranked as zero
const blank = { label: 'Blank', amount: '', rateType: '', nominalPct: '', benchmark: '', spreadPct: '', resetDate: '', termMonths: '', preEmiMode: '', draws: [], fees: [], prepaymentKnown: false, insuranceKnown: false, kfsAprPct: '', fieldStatus: {} };
const cmp2 = of.compareOffers(A, blank, '2027-01');
eq('blank offer year is unknown not zero', cmp2.b.outflowYear, null);
eq('blank offer balance unknown', cmp2.b.balanceEnd, null);
eq('blank offer warning present', cmp2.warnings.some(w => w.includes('Offer B year-one outflow is unknown')), true);
eq('valid offer still totals 12,79,422.60', of.fromPaise(cmp2.a.outflowYear), 1279422.60);
eq('valid offer balance after 12 is zero', cmp2.a.balanceEnd, 0);
// Partial data (rate but no draws) also stays unknown across the year
const cmp3 = of.compareOffers(A, F, '2027-01');
eq('no-draw offer year unknown', cmp3.b.outflowYear, null);

// Blank rate with released draws: Number('') === 0 must not model a free loan
const H2 = { label: 'H', amount: 1200000, rateType: 'fixed', nominalPct: '', termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'full', amount: 1200000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }], fees: [], fieldStatus: {} };
eq('blank rate -> unknown even with draws', of.monthlyOutflow(H2, '2027-01', 1).outflow, null);

// Partial staged draw, full-EMI mode: only released debt exists
const P = { label: 'P', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'first', amount: 100000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }], fees: [], fieldStatus: {} };
const p1 = of.monthlyOutflow(P, '2027-01', 1);
eq('partial: EMI on released 100k, not sanction', of.fromPaise(p1.outflow), 8884.88);
eq('partial: balance from released only', of.fromPaise(p1.balance), 92115.12);
eq('partial: note says released only', p1.note, 'modeled EMI on released amount only');
const P2 = { ...P, draws: [...P.draws, { label: 'rest', amount: 1100000, plannedDate: '2027-03', actualDate: '2027-03', status: 'released' }] };
eq('partial: month 2 still on 100k', of.fromPaise(of.monthlyOutflow(P2, '2027-01', 2).outflow), 8884.88);
const p3 = of.monthlyOutflow(P2, '2027-01', 3);
eq('partial: month 3 steps up to full release', of.fromPaise(p3.outflow), 106618.55);
eq('partial: month 3 balance rolls both releases', of.fromPaise(p3.balance), 1089374.35);

// Release before the window: repayment rolls from the actual release date
const W = { label: 'W', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'old', amount: 1200000, plannedDate: '2026-11', actualDate: '2026-11', status: 'released' }], fees: [], fieldStatus: {} };
eq('pre-window: month 1 EMI continues', of.fromPaise(of.monthlyOutflow(W, '2027-01', 1).outflow), 106618.55);
eq('pre-window: balance already 3 EMIs down', of.fromPaise(of.monthlyOutflow(W, '2027-01', 1).balance), 913296.33);
eq('pre-window: month 10 last EMI', of.fromPaise(of.monthlyOutflow(W, '2027-01', 10).outflow), 106618.55);
eq('pre-window: month 11 paid off, zero due', of.monthlyOutflow(W, '2027-01', 11).outflow, 0);
eq('pre-window: month 11 note', of.monthlyOutflow(W, '2027-01', 11).note, 'paid off before this month');
eq('pre-window: year total is 10 EMIs', of.fromPaise(of.compareOffers(W, W, '2027-01').a.outflowYear), 1066185.50);

// Mid-year first release: earlier months are a truthful zero, year computable
const M = { label: 'M', amount: 100000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'mid', amount: 100000, plannedDate: '2027-06', actualDate: '2027-06', status: 'released' }], fees: [], fieldStatus: {} };
eq('mid-year: month 1 truthful zero', of.monthlyOutflow(M, '2027-01', 1).outflow, 0);
eq('mid-year: month 1 note', of.monthlyOutflow(M, '2027-01', 1).note, 'no release yet this month');
eq('mid-year: year total computable', of.fromPaise(of.compareOffers(M, M, '2027-01').a.outflowYear), 62194.16);

// Invalid offer excluded from the numeric comparison (visible)
const BAD = { label: 'BAD', amount: 1200000, rateType: 'fixed', nominalPct: -5, termMonths: 12, preEmiMode: 'emi',
  draws: [{ label: 'full', amount: 1200000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }], fees: [], fieldStatus: {} };
const cmpBad = of.compareOffers(A, BAD, '2027-01');
eq('invalid offer: outflowYear null', cmpBad.b.outflowYear, null);
eq('invalid offer: balanceEnd null', cmpBad.b.balanceEnd, null);
eq('invalid offer: errors listed', cmpBad.b.errors.length > 0, true);
eq('invalid offer: exclusion warning', cmpBad.warnings.some(w => w.includes('Offer B fails validation')), true);
eq('invalid offer: valid side still numeric', of.fromPaise(cmpBad.a.outflowYear), 1279422.60);

// Known fee with blank amount is unknown, never zero
const feeBlank = of.knownFees({ fees: [{ label: 'Processing', amount: '', financed: false, known: true }] });
eq('known fee blank amount: not in cash', feeBlank.cash, 0);
eq('known fee blank amount: listed unknown', feeBlank.unknown.join(','), 'Processing (marked known but no amount entered)');

// Blank repayment mode: unknown, never a guessed EMI; comparison stays blocked
const N = { label: 'N', amount: 1200000, rateType: 'fixed', nominalPct: 12, termMonths: 12, preEmiMode: '',
  draws: [{ label: 'first', amount: 600000, plannedDate: '2027-01', actualDate: '2027-01', status: 'released' }], fees: [], fieldStatus: {} };
const n1 = of.monthlyOutflow(N, '2027-01', 1);
eq('blank mode: outflow unknown', n1.outflow, null);
eq('blank mode: note', n1.note, 'repayment mode unknown');
eq('blank mode: released debt still shown', of.fromPaise(n1.balance), 600000);
eq('blank mode: year blocked', of.compareOffers(N, N, '2027-01').a.outflowYear, null);
// The visible comparison reason and the provisional state must both name the
// real cause: a repayment mode we refuse to guess, not "missing rate/term/draw".
const cmpN = of.compareOffers(N, N, '2027-01');
eq('blank mode: warning names mode', cmpN.warnings.some(w => w.includes('repayment mode unknown')), true);
eq('blank mode: warning not missing-rate', cmpN.warnings.some(w => w.includes('missing rate, term')), false);
eq('blank mode: provisional names mode', of.provisionalReasons(N).includes('repayment mode unknown'), true);
eq('chosen mode: not provisional for mode', of.provisionalReasons({ ...N, preEmiMode: 'emi' }).includes('repayment mode unknown'), false);
eq('chosen emi mode on 600k is explicit', of.fromPaise(of.monthlyOutflow({ ...N, preEmiMode: 'emi' }, '2027-01', 1).outflow), 53309.27);
eq('chosen pre-EMI mode on 600k is 6,000', of.fromPaise(of.monthlyOutflow({ ...N, preEmiMode: 'interestOnly' }, '2027-01', 1).outflow), 6000);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
