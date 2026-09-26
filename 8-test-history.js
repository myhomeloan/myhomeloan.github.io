const H = require('./plan-history.js');
let fails = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok){ fails++; console.log('FAIL', n, 'got', JSON.stringify(g), 'want', JSON.stringify(w)); } else console.log('ok  ', n, JSON.stringify(g)); };

const planA = { meta: { version: 1 }, loan: { rate: 9, outstanding: 4000000 }, stages: [{ id: 'foundation', plannedStart: '2027-02-01', status: 'planned' }, { id: 'framing', plannedStart: '2027-03-10', status: 'planned' }], notes: 'first draft' };
const planB = JSON.parse(JSON.stringify(planA));
planB.stages[0].plannedStart = '2027-03-01'; // foundation moved
planB.notes = 'second draft';                 // routine text edit

const changes = H.diffPlans(planA, planB);
eq('foundation date change found', changes.some(c => c.path === 'stages[0].plannedStart' && c.before === '2027-02-01' && c.after === '2027-03-01'), true);
eq('date change is material', changes.find(c => c.path === 'stages[0].plannedStart').status, 'material');
eq('framing untouched (not auto-shifted)', changes.some(c => c.path.startsWith('stages[1]')), false);
eq('notes change is minor', changes.find(c => c.path === 'notes').status, 'minor');

// Settled -> planned is a correction, never silent
const planC = JSON.parse(JSON.stringify(planA)); planC.stages[0].status = 'released';
const planD = JSON.parse(JSON.stringify(planC)); planD.stages[0].status = 'requested';
eq('settled->planned flagged correction', H.diffPlans(planC, planD).find(c => c.path === 'stages[0].status').status, 'correction');
eq('planned->released is material, not correction', H.diffPlans(planD, planC).find(c => c.path === 'stages[0].status').status, 'material');

// Money changes are material and exact
const planE = JSON.parse(JSON.stringify(planA)); planE.loan.outstanding = 4300000;
eq('money change material', H.diffPlans(planA, planE).find(c => c.path === 'loan.outstanding').status, 'material');

// updatedAt volatility ignored
const planF = JSON.parse(JSON.stringify(planA)); planF.updatedAt = '2026-09-26T20:00:00Z';
eq('updatedAt not a change', H.diffPlans(planA, planF).length, 0);

// Hash stability + repeat-import dedupe helper
eq('hash deterministic', H.planHash(planA), H.planHash(JSON.parse(JSON.stringify(planA))));
eq('hash differs on change', H.planHash(planA) !== H.planHash(planB), true);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
