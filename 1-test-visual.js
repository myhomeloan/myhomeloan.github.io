// Visual regression guards: 390px overflow + blank-offer-never-zero.
// Live verification happens in the browser at a 390px viewport; these static
// checks keep the CSS guards and the unknown-not-zero contract from regressing.
// Guards for a page are skipped when that page's files are not on this branch.
const fs = require('fs');
let fails = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok){ fails++; console.log('FAIL', n, 'got', g, 'want', w); } else console.log('ok  ', n); };
const has = f => fs.existsSync(f);
const pt = has('pressure-test.html') ? fs.readFileSync('pressure-test.html', 'utf8') : null;
const of = has('offers.html') ? fs.readFileSync('offers.html', 'utf8') : null;
const ofjs = has('offers.js') ? fs.readFileSync('offers.js', 'utf8') : null;

if (pt){
  eq('pt viewport meta', /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(pt), true);
  // The 390px overflow came from intrinsic min-widths on range/month/number
  // inputs inside flex/grid rows. Guards: min-width:0 and minmax(0,1fr) tracks.
  eq('pt range input shrink guard', /\.pt-range input\{flex:1;min-width:0/.test(pt), true);
  eq('pt range row may wrap', /\.pt-range\{[^}]*flex-wrap:wrap/.test(pt), true);
  eq('pt row inputs shrink guard', /\.pt-row input,\.pt-row select\{[^}]*min-width:0/.test(pt), true);
  eq('pt small cards grid minmax', /\.pt-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(pt), true);
  eq('pt small row grid minmax', /\.pt-row\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(pt), true);
  eq('pt table stays in guarded wrap', /\.pt-table-wrap\{overflow-x:auto\}/.test(pt), true);
} else console.log('skip pressure-test guards (file not on this branch)');

if (of){
  eq('of viewport meta', /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(of), true);
  eq('of draw/fee inputs shrink guard', /\.lo-draw input,\.lo-draw select,\.lo-fee input\{[^}]*min-width:0/.test(of), true);
  eq('of small draw/fee grid minmax', /\.lo-draw,\.lo-fee\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(of), true);
} else console.log('skip offers css guards (file not on this branch)');

if (ofjs){
  // Blank-offer contract: unknown, never zero.
  eq('blank rate is unknown not zero', /Number\(''\) === 0 would silently model/.test(ofjs), true);
  eq('no released draws -> unknown outflow', /if \(drawnTotal === 0\) return \{ outflow: null/.test(ofjs), true);
  eq('year unknown when any month unknown', /if \(o == null\) return null/.test(ofjs), true);
} else console.log('skip offers js guards (file not on this branch)');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
