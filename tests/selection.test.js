'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {chooseCandidates, completeSelection} = require('../src/selection');
const seat = (id, number) => ({id, block: '118', row: 1, number});
const groups = [{seats: [seat('A', 1), seat('B', 2)]}, {seats: [seat('C', 3), seat('D', 4)]}];
const preferences = {quantity: 2, excludeObstructed: true, autoComplete: true};
function fixture({selectDelay = 15, completeDelay = 15, conflictSeat, conflictComplete = false, uncertainSeat, unknownModal = false, neverComplete = false, noPreselect = false} = {}) {
  const info = {selected: [], selectedGrades: [], selectedNames: [], completed: false, busy: false, dialog: null, buttons: [{label: '선택 완료', enabled: true}], network: {healthy: true, sequence: 0, pending: [], results: []}};
  const all = groups.flatMap(g => g.seats), calls = [], timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const update = () => { info.selectedGrades = info.selected.map(() => '레드석'); info.selectedNames = info.selected.map(id => {const s = all.find(s => s.id === id); return `118블럭 1열 ${s.number}번`;}); };
  const request = (kind, ids, fn, delay) => {
    const seq = ++info.network.sequence; info.network.pending.push({seq, kind, seatIds: ids});
    later(() => {info.network.pending = info.network.pending.filter(r => r.seq !== seq); const status = fn(); info.network.results.push({seq, kind, seatIds: status === 'conflict' ? ids : ids, status}); update();}, delay);
  };
  const adapter = {
    snapshot: async () => structuredClone(info),
    select: async s => {
      calls.push('select:' + s.id); info.selected.push(s.id); update();
      if (!noPreselect) request('select', [s.id], () => {
        if (s.id === uncertainSeat) return 'uncertain';
        if (unknownModal) { info.dialog = {kind: 'unknown', text: '로그인이 만료되었습니다.'}; return 'uncertain'; }
        if (s.id === conflictSeat) {info.selected = info.selected.filter(id => id !== s.id); info.dialog = {kind: 'conflict', dismissible: true}; return 'conflict';}
        return 'ok';
      }, selectDelay);
    },
    deselect: async id => {calls.push('deselect:' + id); request('deselect', [id], () => {info.selected = info.selected.filter(s => s !== id); return 'ok';}, 2);},
    complete: async () => {
      calls.push('complete'); assert.equal(info.network.pending.length, 0, 'optimistic CSS must not race pending preselection');
      if (neverComplete) return;
      request('complete', [], () => { if (conflictComplete) {conflictComplete = false; info.dialog = {kind: 'conflict', dismissible: true}; return 'conflict';} info.completed = true; return 'ok'; }, completeDelay);
    },
    dismissConflict: async () => {calls.push('dismiss'); info.dialog = null;}
  };
  return {adapter, info, calls, dispose: () => timers.forEach(clearTimeout)};
}
const options = f => ({groups, adapter: f.adapter, preferences, timeoutMs: 180, pollMs: 2, observationGraceMs: 8});
test('delayed optimistic CSS waits for all acknowledgements before completion and confirms next stage', async () => {
  const f = fixture({selectDelay: 30, completeDelay: 30});
  try {const result = await chooseCandidates(options(f)); assert.equal(result.completed, true); assert.deepEqual(f.calls, ['select:A', 'select:B', 'complete']);} finally {f.dispose();}
});
test('explicit seat conflict dismisses, rolls back partial selection and tries next candidate', async () => {
  const f = fixture({conflictSeat: 'B'}), excludedIds = new Set(), excludedGroups = new Set();
  try {
    const result = await chooseCandidates({...options(f), excludedIds, excludedGroups});
    assert.equal(result.completed, true); assert.equal(result.attempted, 2); assert.equal(excludedIds.has('B'), true);
    assert.deepEqual(f.calls, ['select:A', 'select:B', 'dismiss', 'deselect:A', 'select:C', 'select:D', 'complete']);
  } finally {f.dispose();}
});
test('completion conflict without exact rejected seat excludes only that combination', async () => {
  const f = fixture({conflictComplete: true}), excludedIds = new Set(), excludedGroups = new Set();
  try {const result = await chooseCandidates({...options(f), excludedIds, excludedGroups}); assert.equal(result.completed, true); assert.equal(excludedIds.size, 0); assert.equal(excludedGroups.size, 1); assert.equal(f.calls.filter(c => c === 'complete').length, 2);} finally {f.dispose();}
});
test('unknown response fails without trying the next group', async () => {
  const f = fixture({uncertainSeat: 'A'});
  try {await assert.rejects(chooseCandidates(options(f)), /자동 재시도하지 않습니다/); assert.equal(f.calls.includes('select:C'), false); assert.equal(f.calls.includes('complete'), false);} finally {f.dispose();}
});
test('unknown modal is never dismissed or used as fallback signal', async () => {
  const f = fixture({unknownModal: true});
  try {await assert.rejects(chooseCandidates(options(f))); assert.equal(f.calls.includes('dismiss'), false); assert.equal(f.calls.includes('select:C'), false);} finally {f.dispose();}
});
test('completion timeout sends no duplicate completion and preserves selected seats for inspection', async () => {
  const f = fixture({neverComplete: true});
  try {await assert.rejects(chooseCandidates(options(f)), /다음 화면 진입을 확인하지 못했습니다/); assert.equal(f.calls.filter(c => c === 'complete').length, 1); assert.deepEqual(f.info.selected, ['A', 'B']);} finally {f.dispose();}
});
test('cancellation drains delayed selection then releases its actual selection, never next candidate', async () => {
  const f = fixture({selectDelay: 45}), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {await assert.rejects(chooseCandidates({...options(f), signal: controller.signal}), /중지했습니다/); assert.deepEqual(f.info.selected, []); assert.deepEqual(f.calls, ['select:A', 'deselect:A']);} finally {clearTimeout(timer); f.dispose();}
});
test('cancellation during a ready snapshot prevents dispatching the next seat mutation', async () => {
  const f=fixture(),controller=new AbortController(),snapshot=f.adapter.snapshot;let reads=0;
  f.adapter.snapshot=async()=>{const info=await snapshot();if(++reads===2)controller.abort();return info;};
  try {await assert.rejects(chooseCandidates({...options(f),signal:controller.signal}),/중지/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.info.selected,[]);} finally {f.dispose();}
});
test('no per-seat request remains provisional until actual next-stage confirmation', async () => {
  const f = fixture({noPreselect: true});
  try {
    const result = await chooseCandidates({...options(f), preferences: {...preferences, autoComplete: false}});
    assert.equal(result.serverConfirmed, false); assert.equal(result.completed, false);
    const done = await completeSelection({adapter: f.adapter, timeoutMs: 100, pollMs: 2}); assert.equal(done.completed, true);
  } finally {f.dispose();}
});
test('observer loss prevents any seat mutation', async () => {
  const f = fixture(); f.info.network.healthy = false;
  try {await assert.rejects(chooseCandidates(options(f)), /관찰이 끊겼습니다/); assert.deepEqual(f.calls, []);} finally {f.dispose();}
});
test('manual completion validates current quantity rather than trusting previous settings', async () => {
  const f = fixture({noPreselect: true});
  try {
    await f.adapter.select(groups[0].seats[0]);
    await assert.rejects(completeSelection({adapter: f.adapter, preferences}), /좌석 수/);
    assert.equal(f.calls.includes('complete'), false);
  } finally {f.dispose();}
});
test('a pending request that rejects during manual completion readiness prevents completion', async () => {
  const f = fixture({uncertainSeat: 'A'});
  try {
    await f.adapter.select(groups[0].seats[0]);
    await assert.rejects(completeSelection({adapter: f.adapter, timeoutMs: 100, pollMs: 2}), /자동 재시도하지 않습니다/);
    assert.equal(f.calls.includes('complete'), false);
  } finally {f.dispose();}
});
test('cancellation during accepted completion reports the late next-stage instead of undoing it', async () => {
  const f = fixture({completeDelay: 30}), controller = new AbortController();
  const original = f.adapter.complete; f.adapter.complete = async () => {await original(); controller.abort();};
  try {const result = await chooseCandidates({...options(f), signal: controller.signal}); assert.equal(result.completed, true); assert.equal(f.calls.some(c => c.startsWith('deselect')), false);} finally {f.dispose();}
});
test('manual completion cancellation keeps waiting for its in-flight completion result', async () => {
  const f = fixture({noPreselect: true, completeDelay: 50}), controller = new AbortController();
  await f.adapter.select(groups[0].seats[0]); await f.adapter.select(groups[0].seats[1]);
  const original = f.adapter.complete; f.adapter.complete = async () => {await original(); controller.abort();};
  try {
    const start = Date.now(), result = await completeSelection({adapter: f.adapter, preferences, signal: controller.signal, timeoutMs: 150, pollMs: 2});
    assert.equal(result.completed, true); assert.ok(Date.now() - start >= 40);
    assert.equal(f.calls.some(c => c.startsWith('deselect')), false);
  } finally {f.dispose();}
});
test('cancelled completion that remains pending times out without releasing uncertain seats', async () => {
  const f = fixture({completeDelay: 500}), controller = new AbortController();
  const original = f.adapter.complete; f.adapter.complete = async () => {await original(); controller.abort();};
  try {
    await assert.rejects(chooseCandidates({...options(f), timeoutMs: 100, signal: controller.signal}), /다음 화면 진입을 확인하지 못했습니다/);
    assert.deepEqual(f.info.selected, ['A', 'B']); assert.equal(f.calls.some(c => c.startsWith('deselect')), false);
  } finally {f.dispose();}
});
test('cancellation cleanup waits for visible busy state even after network drains', async () => {
  const f = fixture({selectDelay: 15}), controller = new AbortController();
  const originalSelect = f.adapter.select, originalDeselect = f.adapter.deselect;
  let timer;
  f.adapter.select = async s => {await originalSelect(s); f.info.busy = true; timer = setTimeout(() => {f.info.busy = false;}, 55); controller.abort();};
  f.adapter.deselect = async id => {assert.equal(f.info.busy, false); await originalDeselect(id);};
  try {await assert.rejects(chooseCandidates({...options(f), signal: controller.signal}), /중지했습니다/); assert.deepEqual(f.info.selected, []);} finally {clearTimeout(timer); f.dispose();}
});
test('status displays zero-based condition tier as a one-based priority', async () => {
  const f = fixture(), status = [];
  try {await chooseCandidates({...options(f), groups: [{...groups[0], tierIndex: 0}], onStatus: s => status.push(s)}); assert.match(status[0], /^1순위/);} finally {f.dispose();}
});
test('cancel after completion click waits through delayed site validation before request is sent', async () => {
  const f = fixture({completeDelay: 25}), controller = new AbortController();
  const original = f.adapter.complete;
  let sendTimer;
  f.adapter.complete = async () => {
    // The live site's handler awaits a session check before calling selectSeat.
    sendTimer = setTimeout(() => {void original();}, 220);
    controller.abort();
  };
  try {
    const result = await chooseCandidates({...options(f), timeoutMs: 400, signal: controller.signal});
    assert.equal(result.completed, true);
    assert.equal(f.calls.filter(c => c === 'complete').length, 1);
    assert.equal(f.calls.some(c => c.startsWith('deselect')), false);
    assert.deepEqual(f.info.selected, ['A', 'B']);
  } finally {clearTimeout(sendTimer); f.dispose();}
});
test('cancel after completion click with no observed request times out with selection preserved', async () => {
  const f = fixture({neverComplete: true}), controller = new AbortController();
  const original = f.adapter.complete;
  f.adapter.complete = async () => {await original(); controller.abort();};
  try {
    await assert.rejects(chooseCandidates({...options(f), timeoutMs: 210, signal: controller.signal}), /다음 화면 진입을 확인하지 못했습니다/);
    assert.equal(f.calls.filter(c => c === 'complete').length, 1);
    assert.equal(f.calls.some(c => c.startsWith('deselect')), false);
    assert.deepEqual(f.info.selected, ['A', 'B']);
  } finally {f.dispose();}
});

test('letter row confirmation compares the visible label while preserving its numeric ranking ordinal',async()=>{
  const f=fixture(),snapshot=f.adapter.snapshot;
  f.adapter.snapshot=async()=>{const info=await snapshot();info.selectedNames=info.selectedNames.map(name=>name.replace('1열','A열'));return info;};
  const alphaGroups=[{seats:groups[0].seats.map(s=>({...s,rowKind:'alpha',rowLabel:'A'}))}];
  try{const result=await chooseCandidates({...options(f),groups:alphaGroups});assert.equal(result.completed,true);assert.deepEqual(f.calls,['select:A','select:B','complete']);}
  finally{f.dispose();}
});
test('a mismatched site letter row never proceeds to completion',async()=>{
  const f=fixture(),snapshot=f.adapter.snapshot;
  f.adapter.snapshot=async()=>{const info=await snapshot();info.selectedNames=info.selectedNames.map(name=>name.replace('1열','B열'));return info;};
  const alphaGroups=[{seats:groups[0].seats.map(s=>({...s,rowKind:'alpha',rowLabel:'A'}))}];
  try{await assert.rejects(chooseCandidates({...options(f),groups:alphaGroups}),/열·번호가 예상과 다릅니다/);assert.equal(f.calls.includes('complete'),false);assert.deepEqual(f.info.selected,[]);}
  finally{f.dispose();}
});
test('untrusted row labels cannot override an inconsistent ordinal or row kind',async()=>{
  for(const fields of [{rowKind:'alpha',rowLabel:'B'},{rowKind:'alpha',rowLabel:'AA'},{rowKind:'alpha',rowLabel:'a'},{rowKind:'alpha',rowLabel:1},{rowKind:'numeric',rowLabel:'2'},{rowLabel:'A'},{rowKind:'unknown',rowLabel:'1'}]){
    const f=fixture({selectDelay:1}),invalidGroups=[{seats:groups[0].seats.map(s=>({...s,...fields}))}];
    try{await assert.rejects(chooseCandidates({...options(f),groups:invalidGroups}),/열 표기와 순서 정보가 일치하지 않습니다/);assert.equal(f.calls.includes('complete'),false);assert.deepEqual(f.info.selected,[]);}
    finally{f.dispose();}
  }
});
test('numeric row labels preserve the existing successful confirmation path',async()=>{
  const f=fixture(),numericGroups=[{seats:groups[0].seats.map(s=>({...s,rowKind:'numeric',rowLabel:'1'}))}];
  try{assert.equal((await chooseCandidates({...options(f),groups:numericGroups})).completed,true);assert.equal(f.calls.filter(call=>call==='complete').length,1);}
  finally{f.dispose();}
});
