'use strict';

// Passive observation only. Metadata owns attaching/enabling the CDP debugger.
// Never retain request/response bodies, cookies, session IDs or signatures.
const ORIGIN = 'https://tickets.interpark.com';
const CONFLICT_CODES = new Set(['P40054', 'P41150', 'P41149', 'P40021']);
const OPERATIONS = {
  PreselectSeat: ['select', 'preselectSeat'],
  BulkPreselectSeats: ['select', 'bulkPreselectSeats'],
  DeselectSeat: ['deselect', 'deselectSeat'],
  BulkDeselectSeats: ['deselect', 'bulkDeselectSeats']
};
const seatIds = values => [...new Set((Array.isArray(values) ? values : []).filter(v => typeof v === 'string' && v.length <= 200).map(v => v.startsWith('seat_block_') ? v : 'seat_block_' + v))];
function classifyRequest(request) {
  let url, body;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== ORIGIN || request.method !== 'POST') return null;
  const gql = url.pathname === '/onestop/gql';
  const complete = ['/onestop/api/seats/select', '/onestop/api/seats/select-external'].includes(url.pathname);
  if (!gql && !complete) return null;
  try { body = JSON.parse(request.postData); } catch { return complete ? {kind: 'complete', seatIds: []} : null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return complete ? {kind: 'complete', seatIds: []} : null;
  if (complete) return {kind: 'complete', seatIds: seatIds(Array.isArray(body.seats) ? body.seats.map(s => s?.seatInfoId) : [])};
  const name = body.operationName || /\bmutation\s+(\w+)/.exec(body.query || '')?.[1];
  const operation = OPERATIONS[name];
  if (!operation || !new RegExp('\\bmutation\\s+' + name + '\\b').test(body.query || '')) return null;
  const command = body.variables?.command;
  return {kind: operation[0], field: operation[1], seatIds: seatIds(command?.seatInfoIds || [command?.seatInfoId])};
}
function classifyResponse(record, statusCode, text) {
  let body;
  try { body = JSON.parse(text); } catch { return {status: 'uncertain', seatIds: []}; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body.errors != null && !Array.isArray(body.errors))) return {status: 'uncertain', seatIds: []};
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errors.map(e => e?.extensions?.backendErrorCode);
  codes.push(body?.backendErrorCode, body?.data?.backendErrorCode, body?.properties?.backendErrorCode);
  const conflict = codes.some(c => CONFLICT_CODES.has(c));
  const rejectedIds = seatIds(body?.data?.unselectableSeatInfoIds || body?.data?.data?.unselectableSeatInfoIds || body?.unselectableSeatInfoIds);
  if (conflict) return {status: 'conflict', seatIds: rejectedIds.length ? rejectedIds : record.kind === 'select' && record.seatIds.length === 1 ? record.seatIds : []};
  if (statusCode < 200 || statusCode >= 300 || errors.length || codes.some(Boolean) || body?.success === false || body?.data?.success === false) return {status: 'uncertain', seatIds: []};
  if (record.field && (!body?.data || !Object.hasOwn(body.data, record.field) || body.data[record.field] == null || body.data[record.field] === false)) return {status: 'uncertain', seatIds: []};
  // Completion HTTP success is never proof of entering the next booking stage.
  return {status: 'ok', seatIds: record.seatIds};
}
function attach(wc) {
  const debuggerClient=wc.debugger;
  let sequence = 0, healthy = !!debuggerClient.isAttached(), disposed = false;
  const pending = new Map(), results = [];
  const finish = (id, result) => {
    const record = pending.get(id); if (!record) return;
    pending.delete(id);
    results.push({...record, ...result});
    if (results.length > 256) results.splice(0, results.length - 256);
  };
  const handler = async (_event, method, p) => {
    if (disposed) return;
    if (method === 'Network.requestWillBeSent') {
      const info = classifyRequest(p.request);
      if (info) pending.set(p.requestId, {...info, seq: ++sequence, statusCode: 0});
    } else if (method === 'Network.responseReceived' && pending.has(p.requestId)) {
      pending.get(p.requestId).statusCode = p.response.status;
    } else if (method === 'Network.loadingFailed') {
      finish(p.requestId, {status: 'uncertain', seatIds: []});
    } else if (method === 'Network.loadingFinished' && pending.has(p.requestId)) {
      const record = pending.get(p.requestId);
      try {
        if (p.encodedDataLength > 1000000) throw Error('Response limit');
        const response = await debuggerClient.sendCommand('Network.getResponseBody', {requestId: p.requestId});
        if (disposed) return;
        const text = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
        if (text.length > 1000000) throw Error('Response limit');
        finish(p.requestId, classifyResponse(record, record.statusCode, text));
      } catch { finish(p.requestId, {status: 'uncertain', seatIds: []}); }
    }
  };
  const detach = () => { healthy = false; for (const id of pending.keys()) finish(id, {status: 'uncertain', seatIds: []}); };
  const dispose = () => { disposed = true; healthy = false; pending.clear(); results.length = 0; debuggerClient.removeListener('message', handler); debuggerClient.removeListener('detach', detach); };
  debuggerClient.on('message', handler);
  debuggerClient.on('detach', detach);
  wc.once('destroyed', dispose);
  return {
    snapshot: () => ({sequence, healthy, pending: [...pending.values()].map(({seq, kind, seatIds}) => ({seq, kind, seatIds: [...seatIds]})), results: results.map(({seq, kind, status, seatIds}) => ({seq, kind, status, seatIds: [...seatIds]}))}),
    dispose
  };
}
module.exports = {attach, classifyRequest, classifyResponse};
