'use strict';

class SelectionError extends Error {
  constructor(message, code = 'uncertain', seatIds = []) { super(message); this.code = code; this.seatIds = seatIds; }
}
const keyFor = group => JSON.stringify(group.seats.map(s => s.id).sort());
const checkAbort = signal => { if (signal?.aborted) throw new SelectionError('자동 선택을 중지했습니다.', 'cancelled'); };
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new SelectionError('자동 선택을 중지했습니다.', 'cancelled')); return; }
  const abort = () => { clearTimeout(timer); reject(new SelectionError('자동 선택을 중지했습니다.', 'cancelled')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, {once: true});
});
function inspect(info, floor = 0) {
  if (info.network?.healthy === false) throw new SelectionError('좌석 서버 응답 관찰이 끊겼습니다. 사이트에서 선택 결과를 확인해 주세요.');
  const events = (info.network?.results || []).filter(r => r.seq > floor);
  if (events.some(r => r.status === 'uncertain')) throw new SelectionError('좌석 처리 응답을 확인할 수 없어 중지했습니다. 자동 재시도하지 않습니다.');
  if (info.dialog?.kind === 'unknown') throw new SelectionError('확인되지 않은 안내가 열렸습니다. 사이트의 안내를 직접 확인해 주세요.');
  if (info.dialog?.kind === 'empty-selection') throw new SelectionError('사이트가 선택 좌석 없음으로 응답했습니다.', 'empty-selection');
  const conflicts = events.filter(r => r.status === 'conflict');
  if (conflicts.length || info.dialog?.kind === 'conflict') throw new SelectionError('다른 예매자가 먼저 선택한 좌석입니다.', 'conflict', [...new Set(conflicts.flatMap(r => r.seatIds || []))]);
  return events;
}
function pending(info) { return (info.network?.pending || []).length > 0; }
async function ready(adapter, {signal, timeoutMs, pollMs}) {
  const until = Date.now() + timeoutMs;
  let floor;
  while (Date.now() < until) {
    checkAbort(signal);
    const info = await adapter.snapshot();
    if (floor == null) floor = pending(info) ? Math.min(...info.network.pending.map(r => r.seq)) - 1 : info.network?.sequence || 0;
    inspect(info, floor);
    if (!pending(info) && !info.busy) return info;
    await pause(pollMs, signal);
  }
  throw new SelectionError('이전 좌석 요청이 아직 처리 중입니다. 응답을 확인할 수 없어 중지했습니다.');
}
async function waitSeat(adapter, id, selected, floor, options) {
  const {signal, timeoutMs, pollMs, observationGraceMs} = options;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    checkAbort(signal);
    const info = await adapter.snapshot(), events = inspect(info, floor);
    if (info.completed) throw new SelectionError('좌석 선택 도중 다음 화면으로 이동했습니다. 사이트에서 결과를 확인해 주세요.');
    const matching = events.filter(r => r.kind === (selected ? 'select' : 'deselect') && r.status === 'ok' && (!r.seatIds?.length || r.seatIds.includes(id)));
    if (!pending(info) && !info.busy && (info.selected || []).includes(id) === selected && (matching.length || Date.now() - started >= observationGraceMs)) {
      // Some external-seat flows have no preselect call. A DOM update in that
      // case is provisional; only a later observed next-stage proves completion.
      return {info, serverConfirmed: matching.length > 0};
    }
    await pause(pollMs, signal);
  }
  throw new SelectionError('좌석 선택 결과를 제한 시간 안에 확인하지 못했습니다.');
}
function verifyGroup(info, group, p) {
  if (info.selected.length !== p.quantity || !group.seats.every(s => info.selected.includes(s.id))) throw new SelectionError('요청한 좌석 수와 사이트 선택 결과가 다릅니다.');
  if (p.excludeObstructed && (info.selectedGrades?.length !== p.quantity || info.selectedGrades.some(s => /시야\s*방해/.test(s)))) throw new SelectionError('시야방해석 제외 조건을 확인하지 못했습니다.');
  const expected = group.seats.map(s => {
    // A letter row has a numeric sorting ordinal, but the site's confirmation
    // must match its real label. Do not trust an inconsistent external label.
    let rowLabel=String(s.row);
    if(s.rowKind==='alpha'){
      if(typeof s.rowLabel!=='string'||!/^[A-Z]$/.test(s.rowLabel)||s.rowLabel.charCodeAt(0)-64!==s.row)throw new SelectionError('좌석의 문자 열 표기와 순서 정보가 일치하지 않습니다.');
      rowLabel=s.rowLabel;
    }else if((s.rowKind!=null&&s.rowKind!=='numeric')||(s.rowLabel!=null&&s.rowLabel!==rowLabel))throw new SelectionError('좌석의 열 표기와 순서 정보가 일치하지 않습니다.');
    return {rowLabel,number:String(s.number),block:String(s.block),displayRow:s.displayRow,floor:s.floor};
  });
  const remaining=[...(info.selectedNames||[])];
  const clean=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
  const matched=expected.every(seat=>{
    const index=remaining.findIndex(actual=>{
      const text=clean(actual),m=text.match(/^(.*?)(\d+|[A-Z])열(\d+)번$/);
      if(!m||m[2]!==seat.rowLabel||Number(m[3])!==Number(seat.number))return false;
      // The site formats floor + raw rowNo + seatNo. Prefer those observed
      // fields, then explicit block/area aliases. Never substring-match numbers.
      if(seat.displayRow&&text===clean(`${seat.floor||''}${seat.displayRow}${seat.number}번`))return true;
      const prefix=m[1].replace(/(?:블럭|블록|구역)$/,'');
      return prefix===clean(seat.block);
    });
    if(index<0)return false;remaining.splice(index,1);return true;
  });
  if (info.selectedNames?.length !== p.quantity || !matched) throw new SelectionError('사이트의 좌석 열·번호가 예상과 다릅니다. 선택은 유지했으니 현재 좌석을 확인해 주세요.', 'verification-mismatch');
}
async function completeSelection({adapter, signal, preferences, timeoutMs = 10000, pollMs = 40, onStatus = () => {}}) {
  const initial = await ready(adapter, {signal, timeoutMs, pollMs});
  if (initial.completed) return {completed: true, message: '좌석 선택 완료 · 가격/할인 화면으로 이동했습니다.'};
  if (initial.dialog) inspect(initial, initial.network?.sequence || 0);
  if (preferences) {
    if (initial.selected?.length !== preferences.quantity) throw new SelectionError('요청한 좌석 수와 사이트 선택 결과가 다릅니다.');
    if (preferences.excludeObstructed && (initial.selectedGrades?.length !== preferences.quantity || initial.selectedGrades.some(s => /시야\s*방해/.test(s)))) throw new SelectionError('시야방해석 제외 조건을 확인하지 못했습니다.');
    if (initial.selectedNames?.length !== preferences.quantity) throw new SelectionError('선택한 좌석의 열·번호 표시를 확인하지 못했습니다.');
  }
  if (!initial.buttons?.some(b => b.label === '선택 완료' && b.enabled)) throw new SelectionError('선택 완료 버튼이 아직 활성화되지 않았습니다.');
  const floor = initial.network?.sequence || 0;
  checkAbort(signal);
  await adapter.complete();
  onStatus('선택 완료 응답과 가격/할인 화면 진입을 확인하는 중');
  const started = Date.now();
  let cancelled = false;
  while (Date.now() - started < timeoutMs) {
    cancelled ||= !!signal?.aborted;
    const info = await adapter.snapshot();
    inspect(info, floor);
    if (info.completed && !pending(info)) return {completed: true, message: cancelled ? '중지 전에 보낸 선택 완료 요청이 처리되어 가격/할인 화면으로 이동했습니다.' : '좌석 선택 완료 · 가격/할인 화면 이동을 확인했습니다.'};
    // Once dispatched, an abort cannot retract the site's completion request.
    // Its handler may await session validation before sending any request, so
    // absence of an observed request is not evidence that rollback is safe.
    // Keep the run locked until its observed outcome or this bounded timeout.
    try { await pause(pollMs, cancelled ? undefined : signal); } catch (error) { if (error.code !== 'cancelled') throw error; cancelled = true; }
  }
  throw new SelectionError('선택 완료 이후 다음 화면 진입을 확인하지 못했습니다. 다시 누르지 않고 중지했습니다.', 'completion-uncertain');
}
async function rollback(adapter, owned, options) {
  const {timeoutMs, pollMs, observationGraceMs} = options;
  const until = Date.now() + timeoutMs;
  let info;
  // Cancellation does not cancel an already sent site request. Drain it first,
  // then read the actual current selection before sending any deselection.
  do {
    info = await adapter.snapshot();
    if (info.completed) return true;
    if (info.network?.healthy === false) return false;
    if (!pending(info) && !info.busy) break;
    await pause(pollMs);
  } while (Date.now() < until);
  if (pending(info) || info.busy || (info.selected||[]).some(id=>!owned.has(id))) return false;
  if (info.dialog) {
    if (!['conflict','empty-selection'].includes(info.dialog.kind) || !info.dialog.dismissible) return false;
    const kind=info.dialog.kind;
    await (kind==='conflict'?adapter.dismissConflict():adapter.dismissEmptySelection());
    // A click can resolve before the modal animation and React finally-handler.
    do {
      await pause(pollMs);
      info=await adapter.snapshot();
      if(info.completed)return true;
      if(info.network?.healthy===false||info.dialog&&info.dialog.kind!==kind)return false;
      if(!info.dialog&&!pending(info)&&!info.busy)break;
    } while(Date.now()<until);
  }
  // Let the site's promise finally-handler update its local pending/selection.
  await pause(pollMs);
  info = await adapter.snapshot();
  if (info.dialog || pending(info) || info.busy) return false;
  for (const id of [...owned].reverse()) {
    info = await adapter.snapshot();
    if (info.completed || (info.selected || []).some(s => !owned.has(s))) return false;
    if (!info.selected.includes(id)) continue;
    const floor = info.network?.sequence || 0;
    await adapter.deselect(id);
    try { await waitSeat(adapter, id, false, floor, {timeoutMs, pollMs, observationGraceMs}); } catch { return false; }
  }
  info = await adapter.snapshot();
  return !pending(info) && !info.busy && !info.dialog && !(info.selected || []).some(id => owned.has(id));
}
async function chooseCandidates({groups, adapter, signal, preferences, onStatus = () => {}, excludedIds = new Set(), excludedGroups = new Set(), timeoutMs = 8000, pollMs = 40, observationGraceMs = 160, maxAttempts = 20}) {
  const options = {signal, timeoutMs, pollMs, observationGraceMs};
  const initial = await ready(adapter, options);
  if (initial.completed) return {completed: true, message: '이미 가격/할인 화면으로 이동했습니다.', attempted: 0};
  if (initial.selected?.length) throw new SelectionError('기존에 선택한 좌석을 먼저 확인하거나 해제해 주세요.');
  let attempted = 0;
  for (const group of groups) {
    checkAbort(signal);
    const key = keyFor(group);
    if (excludedGroups.has(key) || group.seats.some(s => excludedIds.has(s.id))) continue;
    if (attempted >= maxAttempts) return {completed: false, exhausted: true, limited: true, attempted, message: '이번 후보 묶음을 확인했습니다. 최신 좌석 목록에서 남은 후보를 이어서 확인합니다.'};
    attempted++;
    const owned = new Set();
    let completing = false, confirmed = true;
    try {
      onStatus(`${Number.isInteger(group.tierIndex) ? (group.tierIndex + 1) + '순위 · ' : ''}후보 ${attempted} 선택 결과 확인 중`);
      for (const seat of group.seats) {
        checkAbort(signal);
        const before = await ready(adapter, options);
        // Stop may arrive while a slow browser snapshot is in flight. Never
        // dispatch a fresh selection after that asynchronous boundary.
        checkAbort(signal);
        if (before.selected.some(id => !owned.has(id))) throw new SelectionError('다른 좌석 선택이 감지되어 자동 진행을 멈췄습니다.');
        const floor = before.network?.sequence || 0;
        owned.add(seat.id); // A dispatched action may be acknowledged late.
        await adapter.select(seat);
        const result = await waitSeat(adapter, seat.id, true, floor, options);
        confirmed &&= result.serverConfirmed;
      }
      const selected = await adapter.snapshot();
      verifyGroup(selected, group, preferences);
      checkAbort(signal);
      if (!preferences.autoComplete) return {completed: false, selected: true, serverConfirmed: confirmed, attempted, message: `${preferences.quantity}매 선택 표시를 확인했습니다.${confirmed ? ' 개별 선택 서버 응답도 확인했습니다.' : ' 최종 좌석 확보는 선택 완료 단계에서 확인해야 합니다.'}`};
      completing = true;
      return {...await completeSelection({adapter, signal, preferences, timeoutMs, pollMs, onStatus}), attempted, selectedIds:[...owned]};
    } catch (error) {
      // A confirmed next-stage must never be undone by a late cancellation.
      let after; try { after = await adapter.snapshot(); } catch {}
      if (after?.completed) return {completed: true, attempted, selectedIds:[...owned], message: '좌석 선택 완료 · 가격/할인 화면 이동을 확인했습니다.'};
      if(error.code==='verification-mismatch')throw error;
      if (completing && !['conflict', 'empty-selection', 'cancelled'].includes(error.code)) {
        error.message += ' 선택 목록을 유지했으니 사이트에서 결과를 확인해 주세요.';
        throw error;
      }
      let cleared = false;
      try { cleared = await rollback(adapter, owned, options); } catch {}
      if (!cleared) { error.message += ' 일부 좌석 해제를 확인하지 못했습니다. 사이트 선택 목록을 확인해 주세요.'; throw error; }
      const latest = await adapter.snapshot();
      if (latest.completed) return {completed: true, attempted, message: '중지 전에 보낸 선택 완료 요청이 처리되어 가격/할인 화면으로 이동했습니다.'};
      if (!['conflict','empty-selection'].includes(error.code)) throw error;
      checkAbort(signal);
      excludedGroups.add(key);
      // Only exclude a particular seat when a parsed server rejection identifies
      // it; a group failure does not imply that all its seats are unavailable.
      for (const id of error.seatIds || []) if (group.seats.some(s => s.id === id)) excludedIds.add(id);
      onStatus('좌석 선택 거절 확인 · 부분 선택을 해제하고 다음 후보로 이동합니다.');
    }
  }
  return {completed: false, exhausted: true, attempted, message: '준비한 후보를 모두 확인했습니다. 다음 구역 또는 최신 좌석 정보를 확인합니다.'};
}
module.exports = {chooseCandidates, completeSelection, SelectionError, keyFor, verifyGroup, rollback};
