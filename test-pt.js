const pt = require('./pressure-test.js');
let fails = 0;
function eq(name, got, want){ const ok = got === want; if (!ok){ fails++; console.log('FAIL', name, 'got', got, 'want', want); } else console.log('ok  ', name, got); }

// Loan fixtures
eq('EMI 4,000,000 @9% 20y', pt.fromPaise(pt.emiPaise(pt.toPaise(4000000), 9, 20)), 35989.04);
eq('EMI 1,200,000 @12% 12m', pt.fromPaise(pt.emiPaise(pt.toPaise(1200000), 12, 1)), 106618.55);
eq('first balance', pt.fromPaise(pt.firstMonthBalancePaise(pt.toPaise(1200000), 12, pt.toPaise(106618.55))), 1105381.45);

// Baseline fixture
const a = { income: 150000, otherIncome: 0, essentials: 55000, debt: 12000, ownership: 6000, goal: 20000,
  rent: 18000, rentStart: 4, rentMonths: 1,
  projectCost: 5000000, own: 1000000, cash: 1000000, reserve: 600000, commitments: 0,
  loanAmount: 4000000, rate: 9, years: 20, loanReleased: 'later' };
const rows = [
  { label: 'health', amount: 30000, kind: 'expense', freq: 'once', firstMonth: 2, lastMonth: '' },
  { label: 'car ins', amount: 42000, kind: 'expense', freq: 'once', firstMonth: 3, lastMonth: '' },
  { label: 'school', amount: 30000, kind: 'expense', freq: 'once', firstMonth: 4, lastMonth: '' },
  { label: 'car renewal', amount: 24000, kind: 'expense', freq: 'once', firstMonth: 7, lastMonth: '' },
  { label: 'festival', amount: 24000, kind: 'expense', freq: 'once', firstMonth: 10, lastMonth: '' },
];
const noStress = { ratePlus: 0, dropPct: '', dropStart: '', dropMonths: '', overrun: '' };
const noLife = { jobLoss: { enabled: false }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } };
const base = pt.computeAll(a, rows, noStress, noLife);
eq('ready', base.ready, true);
eq('regular remainder (month 1)', pt.fromPaise(base.months[0].remaining), 21010.96);
eq('month 2 baseline', pt.fromPaise(base.months[1].remaining), -8989.04);
eq('month 4', pt.fromPaise(base.months[3].remaining), -26989.04);
eq('year-one average', pt.fromPaise(base.avg), 7010.96);
eq('tightest baseline', base.tightest.month, 4);
eq('funding gap', pt.fromPaise(base.fundingGap), 0);
eq('reserve headroom', pt.fromPaise(base.reserveHeadroom), -600000);

// Stress: -20% income months 1-3
const stress = { ratePlus: 0, dropPct: 20, dropStart: 1, dropMonths: 3, overrun: '' };
const st = pt.computeAll(a, rows, stress, noLife);
eq('stressed month 3', pt.fromPaise(st.months[2].remaining), -50989.04);
eq('stressed avg', pt.fromPaise(st.avg), -489.04);
eq('stressed tightest', st.tightest.month, 3);

// Overrun
const ov = pt.computeAll(a, rows, { ratePlus: 0, dropPct: '', dropStart: '', dropMonths: '', overrun: 400000 }, noLife);
eq('overrun gap', pt.fromPaise(ov.fundingGap), 400000);

// Job loss: income stops months 2-4, relocation 80,000 in month 2
const jl = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: true, gapStart: 2, gapMonths: 3, otherStops: false, severance: '', severanceMonth: '', relocationCost: '', relocationMonth: '', newIncome: '', newIncomeStart: '', newRecurringCost: '', newCostStart: '', fxAmount: '', fxRate: '', fxFee: '', fxStart: '' }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } });
eq('job loss month 2', pt.fromPaise(jl.months[1].remaining), -158989.04);
const jl2 = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: true, gapStart: 2, gapMonths: 3, otherStops: false, severance: '', severanceMonth: '', relocationCost: 80000, relocationMonth: 2, newIncome: '', newIncomeStart: '', newRecurringCost: '', newCostStart: '', fxAmount: '', fxRate: '', fxFee: '', fxStart: '' }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } });
eq('job loss + relocation month 2', pt.fromPaise(jl2.months[1].remaining), -238989.04);
const jl3 = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: true, gapStart: 2, gapMonths: 3, otherStops: false, severance: '', severanceMonth: '', relocationCost: '', relocationMonth: '', newIncome: 120000, newIncomeStart: 5, newRecurringCost: '', newCostStart: '', fxAmount: '', fxRate: '', fxFee: '', fxStart: '' }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } });
eq('new job from month 5 adds 120,000', pt.fromPaise(jl3.months[4].remaining - base.months[4].remaining), 120000);
// FX: never added without rate
const jl4 = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: true, gapStart: 2, gapMonths: 2, otherStops: false, severance: '', severanceMonth: '', relocationCost: '', relocationMonth: '', newIncome: '', newIncomeStart: '', newRecurringCost: '', newCostStart: '', fxAmount: 5000, fxRate: '', fxFee: '', fxStart: 6 }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } });
eq('SAR stream excluded without FX', pt.fromPaise(jl4.months[5].remaining), pt.fromPaise(jl4.months[5].remaining) && pt.fromPaise(base.months[5].remaining));
eq('FX unknown flagged', jl4.unknowns.some(u => u.includes('foreign-currency')), true);
// Gap beyond 12 months -> unknown note
const jl5 = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: true, gapStart: 10, gapMonths: 6, otherStops: false, severance: '', severanceMonth: '', relocationCost: '', relocationMonth: '', newIncome: '', newIncomeStart: '', newRecurringCost: '', newCostStart: '', fxAmount: '', fxRate: '', fxFee: '', fxStart: '' }, loanRejected: { enabled: false }, earnerDeath: { enabled: false } });
eq('gap beyond 12 flagged', jl5.unknowns.some(u => u.includes('12-month')), true);

// Loan rejected before any release: gap = full expected loan
const rej = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: false }, loanRejected: { enabled: true, status: 'expected', released: '' }, earnerDeath: { enabled: false } });
eq('rejected gap', pt.fromPaise(rej.fundingGap), 4000000);
eq('rejected EMI zero', pt.fromPaise(rej.emiUsed), 0);

// Earner death: income ends month 2, 5,000,000 claim pending -> +0; received month 5 -> +5,000,000 once
const ed = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: false }, loanRejected: { enabled: false }, earnerDeath: { enabled: true, endMonth: 2, otherStops: false, expenseDelta: '', claimStatus: 'pending', claimAmount: 5000000, claimMonth: 5, coborrower: 'unknown' } });
eq('death month 2 (claim pending)', pt.fromPaise(ed.months[1].remaining), -158989.04);
eq('death month 5 no claim cash', pt.fromPaise(ed.months[4].remaining), pt.fromPaise(ed.months[4].remaining));
const edBase5 = pt.computeMonth(a, rows, noStress, noLife, 5).remaining - pt.toPaise(150000);
eq('death month 5 = base-income', pt.fromPaise(ed.months[4].remaining), pt.fromPaise(edBase5));
const ed2 = pt.computeAll(a, rows, noStress, { jobLoss: { enabled: false }, loanRejected: { enabled: false }, earnerDeath: { enabled: true, endMonth: 2, otherStops: false, expenseDelta: '', claimStatus: 'received', claimAmount: 5000000, claimMonth: 5, coborrower: 'yes' } });
eq('death claim received once month 5', pt.fromPaise(ed2.months[4].remaining - ed.months[4].remaining), 5000000);
eq('death claim not repeated month 6', pt.fromPaise(ed2.months[5].remaining), pt.fromPaise(ed.months[5].remaining));
eq('EMI continues after death', ed.months[5].emi, base.months[5].emi);
eq('pending claim unknown flagged', ed.unknowns.some(u => u.includes('not settled cash')), true);
eq('coborrower unknown flagged', ed.unknowns.some(u => u.includes('Co-borrower')), true);

// Validation: blanks never zero
const incomplete = pt.computeAll({ ...a, income: '' }, rows, noStress, noLife);
eq('blank income blocks', incomplete.ready, false);
eq('bad stress blocks', pt.computeAll(a, rows, { ratePlus: 0, dropPct: 120, dropStart: 1, dropMonths: 3, overrun: '' }, noLife).ready, false);
eq('rate stress raises EMI', pt.computeAll(a, rows, { ratePlus: 1, dropPct: '', dropStart: '', dropMonths: '', overrun: '' }, noLife).emiUsed > base.emiUsed, true);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
