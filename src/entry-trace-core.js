'use strict';

// Passive timing only: no Fetch interception, response body reads, or replay.
const HOSTS = new Set([
  'nol.yanolja.com', 'tickets.interpark.com', 'ticket.interpark.com',
  'api-ticketfront.interpark.com', 'ent-waiting-api.interpark.com',
  'ent-bridge.interpark.com', 'ent-web-assets.interparkcdn.net',
  'fe-display-api.yanolja.com', 'smart-discovery-api.yanolja.com',
  'platform-site.yanolja.com'
]);
const TYPES = new Set(['Fetch', 'XHR', 'Document', 'Script']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const KINDS = new Set(['booking-click', 'gate-ready', 'gate-enabled', 'seat-page', 'notice-click', 'page-ready']);
// Unknown path components are replaced even when short: signed tokens need not
// look like hashes. Keep only a fixed vocabulary of observed public routes.
const SEGMENTS = new Set([
  'api', 'v1', 'v2', 'v3', 'gates', 'ticket', 'tickets', 'genre', 'sports', 'bears',
  'waiting', 'secure-url', 'getServerTime', 'reserve-gate', 'goods-info',
  'member-info', 'partner-gateway', 'pre-sale', 'cert-check', 'cert-info', 'cert',
  'lottery', 'weverse', 'hyundai-card', 'products', 'goods', 'places',
  'assets', '_next', 'static', 'chunks', 'pages', 'app', 'graphql', 'gateway',
  'onestop', 'seat', 'price', 'schedule',
  'auth-complete', 'nol-bridge', 'nol-redirect', 'certRedirect', 'partner',
  'Book', 'BookMain.asp', 'BookSeat.asp', 'BookSeatDetail.asp', 'BookPrice.asp',
  'BookSession.asp', 'BookCaptcha.asp', 'BookInfo.asp', 'Play', 'Gate',
  'Sports', 'Global', 'Error', 'error', 'result', 'service-worker.js'
]);
const LIMITS = Object.freeze({requests: 600, marks: 200, pendingPerWindow: 600, diagnostics: 40});
const round = value => Math.round(value * 10) / 10;

function sanitizeUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) return null;
    const pieces = url.pathname.split('/').slice(0, 20).map(piece => {
      if (!piece || SEGMENTS.has(piece)) return piece;
      if (/\.(?:js|mjs)$/i.test(piece)) return ':script.js';
      if (/\.asp$/i.test(piece)) return ':page.asp';
      return ':segment';
    });
    return {host: url.hostname, route: pieces.join('/') || '/'};
  } catch { return null; }
}

function safeInitiator(initiator) {
  const frames = initiator?.stack?.callFrames;
  const source = Array.isArray(frames) ? frames.find(frame => sanitizeUrl(frame?.url)) : initiator;
  const url = sanitizeUrl(source?.url);
  if (!url) return undefined;
  const result = {...url};
  if (Number.isSafeInteger(source.lineNumber) && source.lineNumber >= 0) result.line = source.lineNumber;
  return result;
}

function createTrace({now = () => Date.now(), onUpdate = () => {}} = {}) {
  let recording = false, startedAt = null, stoppedAt = null, sequence = 0;
  let requests = [], marks = [], diagnostics = [];
  let counts = {requests: 0, marks: 0, droppedRequests: 0, droppedMarks: 0};
  const contexts = new Set(), byContents = new WeakMap();

  function snapshot() {
    return {
      recording, startedAt, stoppedAt,
      requests: requests.map(row => ({...row, ...(row.initiator ? {initiator: {...row.initiator}} : {})})),
      marks: marks.map(row => ({...row})), diagnostics: diagnostics.map(row => ({...row})),
      counts: {...counts}, attachedWindows: [...contexts].filter(ctx => ctx.ready).map(ctx => ctx.windowId)
    };
  }
  function update() { try { onUpdate(snapshot()); } catch { /* UI failures must not affect the page. */ } }
  function diagnostic(code, windowId) {
    diagnostics.push({code, windowId, atMs: startedAt === null ? 0 : round(now() - startedAt)});
    if (diagnostics.length > LIMITS.diagnostics) diagnostics.shift();
    update();
  }
  function finish(ctx, requestId, timestamp, outcome) {
    const pending = ctx.pending.get(requestId);
    if (!pending) return;
    ctx.pending.delete(requestId);
    pending.row.outcome = outcome;
    if (Number.isFinite(timestamp) && timestamp >= pending.timestamp) pending.row.durationMs = round((timestamp - pending.timestamp) * 1000);
  }
  function start() {
    recording = true; startedAt = now(); stoppedAt = null; sequence = 0;
    requests = []; marks = []; diagnostics = [];
    counts = {requests: 0, marks: 0, droppedRequests: 0, droppedMarks: 0};
    for (const ctx of contexts) ctx.pending.clear();
    update(); return snapshot();
  }
  function stop() {
    if (recording) {
      recording = false; stoppedAt = now();
      for (const ctx of contexts) {
        for (const pending of ctx.pending.values()) pending.row.outcome = 'recording-stopped';
        ctx.pending.clear();
      }
      update();
    }
    return snapshot();
  }
  function mark({kind, windowId, at} = {}) {
    if (!recording || !KINDS.has(kind) || !Number.isSafeInteger(windowId) || windowId < 0) return false;
    const epoch = at === undefined ? now() : at;
    if (!Number.isFinite(epoch) || epoch < startedAt) return false;
    marks.push({kind, windowId, atMs: round(epoch - startedAt)}); counts.marks++;
    if (marks.length > LIMITS.marks) { marks.shift(); counts.droppedMarks++; }
    update(); return true;
  }
  async function attach(wc) {
    if (!wc || (typeof wc !== 'object' && typeof wc !== 'function')) return false;
    const existing = byContents.get(wc);
    if (existing) return existing.closed ? false : existing.promise;
    let debuggerApi, windowId;
    try {
      if (wc.isDestroyed()) return false;
      windowId = wc.id; debuggerApi = wc.debugger;
      if (!Number.isSafeInteger(windowId) || !debuggerApi) return false;
    } catch { return false; }
    const ctx = {windowId, pending: new Map(), ready: false, closed: false, owned: false};
    contexts.add(ctx); byContents.set(wc, ctx);
    const onMessage = (_event, method, p = {}) => {
      if (!recording || ctx.closed) return;
      try {
        if (method === 'Network.requestWillBeSent') {
          if (ctx.pending.has(p.requestId)) {
            const previous = ctx.pending.get(p.requestId).row;
            if (Number.isInteger(p.redirectResponse?.status)) previous.status = p.redirectResponse.status;
            finish(ctx, p.requestId, p.timestamp, 'redirect');
          }
          const location = sanitizeUrl(p.request?.url);
          if (!location || !TYPES.has(p.type) || !METHODS.has(p.request?.method) || !Number.isFinite(p.timestamp) || !Number.isFinite(p.wallTime) || p.wallTime * 1000 < startedAt) return;
          counts.requests++;
          if (ctx.pending.size >= LIMITS.pendingPerWindow) { counts.droppedRequests++; update(); return; }
          const row = {
            id: ++sequence, windowId, ...location, method: p.request.method, type: p.type,
            startMs: round(p.wallTime * 1000 - startedAt), fromCache: false, outcome: 'pending'
          };
          const initiator = safeInitiator(p.initiator);
          if (initiator) row.initiator = initiator;
          requests.push(row);
          if (requests.length > LIMITS.requests) { requests.shift(); counts.droppedRequests++; }
          ctx.pending.set(p.requestId, {row, timestamp: p.timestamp}); update();
        } else if (method === 'Network.responseReceived') {
          const pending = ctx.pending.get(p.requestId);
          if (pending) {
            if (Number.isInteger(p.response?.status)) pending.row.status = p.response.status;
            pending.row.fromCache = pending.row.fromCache || Boolean(p.response?.fromDiskCache || p.response?.fromPrefetchCache);
            pending.row.fromServiceWorker = Boolean(p.response?.fromServiceWorker); update();
          }
        } else if (method === 'Network.requestServedFromCache') {
          const pending = ctx.pending.get(p.requestId);
          if (pending) { pending.row.fromCache = true; update(); }
        } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          if (ctx.pending.has(p.requestId)) {
            finish(ctx, p.requestId, p.timestamp, method === 'Network.loadingFinished' ? 'finished' : 'failed'); update();
          }
        }
      } catch { diagnostic('event-processing-failed', windowId); }
    };
    const close = (code, detach = false) => {
      if (ctx.closed) return;
      ctx.closed = true; ctx.ready = false;
      for (const pending of ctx.pending.values()) pending.row.outcome = code;
      ctx.pending.clear(); contexts.delete(ctx);
      debuggerApi.removeListener('message', onMessage);
      debuggerApi.removeListener('detach', onDetach);
      if (detach && ctx.owned) { try { debuggerApi.detach(); } catch {} }
      diagnostic(code, windowId);
    };
    const onDetach = () => close('debugger-detached');
    wc.once('destroyed', () => close('window-destroyed'));
    ctx.promise = (async () => {
      try {
        if (debuggerApi.isAttached()) { close('debugger-in-use'); return false; }
        debuggerApi.attach('1.3'); ctx.owned = true;
        debuggerApi.on('message', onMessage); debuggerApi.on('detach', onDetach);
        await debuggerApi.sendCommand('Network.enable');
        if (ctx.closed) return false;
        ctx.ready = true; update(); return true;
      } catch { close('attach-failed', true); return false; }
    })();
    return ctx.promise;
  }
  return {start, stop, mark, attach, snapshot};
}

module.exports = {createTrace, sanitizeUrl, LIMITS};
