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
eq('no release -> 0 interest', of.fromPaise(of.monthlyOutflow(B, '2027-01', 2).outflow), 0);

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

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
