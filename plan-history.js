'use strict';
/*
 * Concept 4 - "What changed since last time?"  (DRAFT MODULE - NOT WIRED, NOT LIVE)
 * ============================================================================
 * This file is a standalone module. It is intentionally NOT referenced by
 * index.html and does nothing until the app calls MHLPlanHistory.init().
 * Do not describe it as live until the wiring below lands.
 *
 * INTEGRATION CONTRACT (what the wiring must provide):
 *   MHLPlanHistory.init({
 *     getPlan:      () => plan,            // the app's in-memory validated plan object
 *     planStorageKey: 'mhl-visitor-plan-v1', // the app's own localStorage key (read-only use here)
 *     onConflict:   (info) => {...},        // called when a second tab edited a stale copy;
 *                                         // the app must ask the user which changes to keep.
 *                                         // Never last-write-wins.
 *     onNotify:     (text) => {...}         // route to the app's notice area
 *   })
 *
 * ASSUMED GLOBAL HOOKS (from current main, commit 51784abb857):
 *   - window.plan holds the working plan; validate() rebuilds a safe copy on load.
 *   - save() persists to localStorage under 'mhl-visitor-plan-v1'.
 *   The wiring should call MHLPlanHistory.captureSnapshot(origin) AFTER every
 *   successful save() (origins: 'edit' | 'import' | 'scenario'), and call
 *   MHLPlanHistory.checkBaseRevision() BEFORE saving from a tab that has been
 *   open a while. This module never writes the plan key itself.
 *
 * STORAGE: snapshots live under a SEPARATE key 'mhl-plan-history-v1' (max 20).
 * Browser storage can be cleared and is not a secure audit trail - the UI copy
 * must say so. A storage-quota failure reports NOT saved (never a false success).
 *
 * DEPENDENCY: stable record IDs from the milestone/validation work (Batches 5-6)
 * are assumed for per-record matching; until they exist, changes are matched by
 * JSON path, which is why this must not merge before those IDs are stable.
 */
const MHLPlanHistory = (function(){
  const HIST_KEY = 'mhl-plan-history-v1';
  const MAX_SNAPSHOTS = 20;
  let cfg = null;

  function init(config){ cfg = config; }
  function ready(){ return !!cfg; }

  /* ---------- pure diff (exported for tests) ---------- */
  const SKIP_KEYS = new Set(['updatedAt']); // volatile metadata is not a change story
  function isPlainObject(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function diffValues(before, after, path, out){
    if (SKIP_KEYS.has(path[path.length - 1])) return out;
    if (Object.is(before, after)) return out;
    if (Array.isArray(before) && Array.isArray(after)){
      const n = Math.max(before.length, after.length);
      for (let i = 0; i < n; i++){
        if (i >= before.length) out.push({ path: path.concat(i), before: undefined, after: after[i] });
        else if (i >= after.length) out.push({ path: path.concat(i), before: before[i], after: undefined });
        else diffValues(before[i], after[i], path.concat(i), out);
      }
      return out;
    }
    if (isPlainObject(before) && isPlainObject(after)){
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) diffValues(before[k], after[k], path.concat(k), out);
      return out;
    }
    out.push({ path, before, after });
    return out;
  }
  function pathString(p){ return p.map(x => typeof x === 'number' ? '[' + x + ']' : String(x)).join('.').replace(/\.\[/g, '['); }
  // Materiality: money, dates, statuses and amounts drive alerts; routine text edits
  // (notes/descriptions) stay in the full diff without a financial alert.
  function isMaterial(change){
    const s = pathString(change.path).toLowerCase();
    if (/notes|description|comment|label/.test(s)) return false;
    return true;
  }
  // Guard: an actual, settled event (released draw, paid bill) must not silently
  // become planned again through a history replay. Such a change is flagged as a
  // CORRECTION and the UI must require visible review.
  const SETTLED = /^(released|paid|received|actual)$/;
  function classify(change){
    const b = change.before, a = change.after;
    if (typeof b === 'string' && SETTLED.test(b) && typeof a === 'string' && !SETTLED.test(a)) return 'correction';
    return isMaterial(change) ? 'material' : 'minor';
  }
  function diffPlans(before, after){
    return diffValues(before || {}, after || {}, [], []).map(c => ({ path: pathString(c.path), before: c.before, after: c.after, status: classify(c) }));
  }
  function planHash(plan){
    // Small deterministic hash (FNV-1a) over stable stringification; integrity only, not security.
    const s = stableStringify(plan);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'h' + h.toString(16);
  }
  function stableStringify(v){
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (isPlainObject(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  /* ---------- snapshot store ---------- */
  function readStore(){
    try{ const raw = localStorage.getItem(HIST_KEY); const p = raw ? JSON.parse(raw) : null;
      return p && Array.isArray(p.snapshots) ? p : { schemaVersion: 1, headRevisionId: null, snapshots: [] };
    }catch{ return { schemaVersion: 1, headRevisionId: null, snapshots: [], corrupt: true }; }
  }
  function writeStore(store){
    try{ localStorage.setItem(HIST_KEY, JSON.stringify(store)); return true; }
    catch{ return false; } // quota or privacy mode: caller must report NOT saved
  }

  function captureSnapshot(origin, summary){
    if (!ready()) return { ok: false, error: 'not-wired' };
    const plan = cfg.getPlan();
    if (!plan || typeof plan !== 'object') return { ok: false, error: 'no-plan' };
    const store = readStore();
    const hash = planHash(plan);
    const head = store.snapshots.find(s => s.id === store.headRevisionId);
    if (head && head.planHash === hash) return { ok: true, skipped: 'unchanged', revisionId: head.id }; // repeated import of the same content creates no duplicate
    const changes = head ? diffPlans(head.plan, plan) : [];
    const id = 'rev-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    const snap = { id, parentId: head ? head.id : undefined, createdAt: new Date().toISOString(),
      origin: origin || 'edit', summary: summary || '', planHash: hash,
      materialChanges: changes.filter(c => c.status !== 'minor'), changeCount: changes.length, plan };
    store.snapshots.push(snap);
    while (store.snapshots.length > MAX_SNAPSHOTS) store.snapshots.shift();
    store.headRevisionId = id;
    if (!writeStore(store)) return { ok: false, error: 'storage-full' };
    return { ok: true, revisionId: id, changes: snap.materialChanges.length, corrections: snap.materialChanges.filter(c => c.status === 'correction').length };
  }

  function digest(){
    const store = readStore();
    if (store.corrupt) return { state: 'uncertain' };
    if (store.snapshots.length < 2) return { state: 'none' }; // "No changes to compare" + optional baseline capture
    const head = store.snapshots.find(s => s.id === store.headRevisionId);
    const prev = store.snapshots[store.snapshots.length - 2];
    if (!head || !prev) return { state: 'none' };
    const changes = diffPlans(prev.plan, head.plan).filter(c => c.status !== 'minor');
    return { state: 'ok', top: changes.slice(0, 3), total: changes.length,
      corrections: changes.filter(c => c.status === 'correction'), origin: head.origin, createdAt: head.createdAt };
  }

  function compare(revIdA, revIdB){
    const store = readStore();
    const a = store.snapshots.find(s => s.id === revIdA), b = store.snapshots.find(s => s.id === revIdB);
    if (!a || !b) return { ok: false, error: 'revision-missing' };
    return { ok: true, changes: diffPlans(a.plan, b.plan) };
  }

  // Restore is a PREVIEW: the caller shows it and, on explicit user confirm, puts
  // the returned plan through the app's normal validate()+save() path, then calls
  // captureSnapshot('edit','Restored from <revId>') so history moves FORWARD.
  // Nothing here overwrites anything silently.
  function restorePreview(revId){
    const store = readStore();
    const s = store.snapshots.find(x => x.id === revId);
    if (!s) return { ok: false, error: 'revision-missing' };
    if (!cfg || !cfg.getPlan) return { ok: false, error: 'not-wired' };
    return { ok: true, candidatePlan: JSON.parse(stableStringify(s.plan) === undefined ? '{}' : JSON.stringify(s.plan)),
      against: planHash(cfg.getPlan()), revisionId: revId };
  }

  // Two-tab safety: call BEFORE saving. If the plan key changed since this tab's
  // base, the app must ask which changes to keep (never last-write-wins).
  function checkBaseRevision(tabBaseHash){
    if (!ready()) return { ok: false, error: 'not-wired' };
    let currentRaw = null;
    try{ currentRaw = localStorage.getItem(cfg.planStorageKey); }catch{}
    if (!currentRaw) return { ok: true, state: 'no-stored-plan' };
    let currentHash = null;
    try{ currentHash = planHash(JSON.parse(currentRaw)); }catch{ return { ok: true, state: 'stored-plan-unreadable' }; }
    return { ok: true, state: currentHash === tabBaseHash ? 'clean' : 'conflict', currentHash };
  }

  const api = { HIST_KEY, MAX_SNAPSHOTS, init, ready, captureSnapshot, digest, compare, restorePreview, checkBaseRevision,
    diffPlans, planHash, stableStringify, classify, isMaterial, pathString, readStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return typeof window !== 'undefined' ? (window.MHLPlanHistory = api) : api;
})();
