'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createTrace, sanitizeUrl, LIMITS} = require('../src/entry-trace-core');

function mockContents(id = 7) {
  const wc = new EventEmitter(), debuggerApi = new EventEmitter();
  let destroyed = false, attached = false;
  Object.assign(debuggerApi, {
    commands: [], attaches: 0,
    isAttached: () => attached,
    attach() { this.attaches++; attached = true; },
    detach() { attached = false; this.emit('detach', {}, 'closed'); },
    async sendCommand(command) { this.commands.push(command); }
  });
  Object.assign(wc, {id, debugger: debuggerApi, isDestroyed: () => destroyed,
    destroy() { destroyed = true; this.emit('destroyed'); }});
  return wc;
}
const request = (id = 'req1', overrides = {}) => ({
  requestId: id, type: 'Fetch', timestamp: 10, wallTime: 1000.01,
  request: {method: 'POST', url: 'https://ent-waiting-api.interpark.com/waiting/api/secure-url', postData: 'PRIVATE_BODY', headers: {Authorization: 'PRIVATE_AUTH'}},
  ...overrides
});
const emit = (wc, method, params) => wc.debugger.emit('message', {}, method, params);

test('path/query/signature/userinfo are sanitized before persistence', () => {
  assert.deepEqual(sanitizeUrl('https://tickets.interpark.com/gates/ticket/26005452?signature=PRIVATE_QUERY#PRIVATE_FRAGMENT'), {host: 'tickets.interpark.com', route: '/gates/ticket/:segment'});
  assert.equal(sanitizeUrl('https://tickets.interpark.com.evil.test/gates'), null);
  assert.equal(sanitizeUrl('https://user:password@tickets.interpark.com/gates'), null);
  assert.equal(sanitizeUrl('http://tickets.interpark.com/gates'), null);
  assert.equal(sanitizeUrl('https://accounts.yanolja.com/login'), null);
  assert.deepEqual(sanitizeUrl('https://tickets.interpark.com/shortSecret/eyToken.Token.Signature/a.js?x=secret'), {host: 'tickets.interpark.com', route: '/:segment/:segment/:script.js'});
});

test('default is idle, start resets, stop preserves and ignores subsequent activity', async () => {
  let clock = 1000000;
  const trace = createTrace({now: () => clock}), wc = mockContents(); await trace.attach(wc);
  emit(wc, 'Network.requestWillBeSent', request());
  assert.equal(trace.snapshot().requests.length, 0);
  assert.equal(trace.mark({kind: 'booking-click', windowId: 7}), false);
  trace.start(); emit(wc, 'Network.requestWillBeSent', request());
  trace.mark({kind: 'booking-click', windowId: 7, at: 1000005});
  clock = 1000100; trace.stop();
  assert.equal(trace.snapshot().requests[0].outcome, 'recording-stopped');
  emit(wc, 'Network.loadingFinished', {requestId: 'req1', timestamp: 11});
  emit(wc, 'Network.requestWillBeSent', request('req2'));
  assert.equal(trace.snapshot().requests.length, 1);
  assert.equal(trace.snapshot().marks[0].atMs, 5);
  trace.start(); assert.equal(trace.snapshot().requests.length, 0);
  assert.equal(trace.snapshot().marks.length, 0);
  assert.equal(trace.snapshot().startedAt, clock);
});

test('CDP wallTime and monotonic duration; bodies, headers, errors and initiator functions never persist', async () => {
  const trace = createTrace({now: () => 1000000}), wc = mockContents(); await trace.attach(wc); trace.start();
  emit(wc, 'Network.requestWillBeSent', request('private_request_id', {
    initiator: {stack: {callFrames: [{url: 'https://tickets.interpark.com/gates/assets/PRIVATE_SCRIPT.js?token=PRIVATE_TOKEN', lineNumber: 8, functionName: 'PRIVATE_FUNCTION'}]}}
  }));
  emit(wc, 'Network.responseReceived', {requestId: 'private_request_id', response: {status: 200, headers: {'set-cookie': 'PRIVATE_COOKIE'}, url: 'PRIVATE_RESPONSE_URL', fromDiskCache: true}});
  emit(wc, 'Network.loadingFinished', {requestId: 'private_request_id', timestamp: 10.125});
  const row = trace.snapshot().requests[0];
  assert.equal(row.startMs, 10); assert.equal(row.durationMs, 125); assert.equal(row.status, 200);
  assert.equal(row.outcome, 'finished'); assert.equal(row.fromCache, true);
  assert.deepEqual(row.initiator, {host: 'tickets.interpark.com', route: '/gates/assets/:script.js', line: 8});
  assert.equal(/PRIVATE_|private_request_id/.test(JSON.stringify(trace.snapshot())), false);
  assert.deepEqual(wc.debugger.commands, ['Network.enable']);
});

test('attach is idempotent and destroyed webContents cannot trigger further getters or capture', async () => {
  const trace = createTrace({now: () => 1000000}), wc = mockContents();
  const result = await Promise.all([trace.attach(wc), trace.attach(wc)]);
  assert.deepEqual(result, [true, true]); assert.equal(wc.debugger.attaches, 1);
  trace.start(); emit(wc, 'Network.requestWillBeSent', request());
  const debuggerApi = wc.debugger; wc.destroy();
  Object.defineProperty(wc, 'id', {get() { throw Error('destroyed'); }});
  Object.defineProperty(wc, 'debugger', {get() { throw Error('destroyed'); }});
  debuggerApi.emit('message', {}, 'Network.loadingFinished', {requestId: 'req1', timestamp: 11});
  assert.equal(trace.snapshot().requests[0].outcome, 'window-destroyed');
  assert.equal(trace.snapshot().attachedWindows.length, 0);
  assert.equal(debuggerApi.listenerCount('message'), 0);
  assert.equal(await trace.attach(wc), false); // Closed context, no destroyed getters or reattachment.
  const dead = mockContents(); dead.destroy(); assert.equal(await trace.attach(dead), false);
});

test('bounded records, finite allowed marks and safe update failures', async () => {
  const trace = createTrace({now: () => 1000000, onUpdate: () => {throw Error('UI failure');}}), wc = mockContents();
  await trace.attach(wc); trace.start();
  for (let i = 0; i < LIMITS.requests + 5; i++) {
    emit(wc, 'Network.requestWillBeSent', request(String(i)));
    emit(wc, 'Network.loadingFinished', {requestId: String(i), timestamp: 11});
  }
  for (let i = 0; i < LIMITS.marks + 3; i++) trace.mark({kind: 'gate-ready', windowId: 7});
  assert.equal(trace.mark({kind: 'PRIVATE_TOKEN', windowId: 7}), false);
  assert.equal(trace.mark({kind: 'gate-ready', windowId: 'secret'}), false);
  assert.equal(trace.mark({kind: 'gate-ready', windowId: 7, at: NaN}), false);
  assert.equal(trace.snapshot().requests.length, LIMITS.requests);
  assert.equal(trace.snapshot().marks.length, LIMITS.marks);
  assert.deepEqual(trace.snapshot().counts, {requests: LIMITS.requests + 5, marks: LIMITS.marks + 3, droppedRequests: 5, droppedMarks: 3});
});

test('redirect and failed outcomes do not retain URL/error text; snapshots cannot mutate internal state', async () => {
  const trace = createTrace({now: () => 1000000}), wc = mockContents(); await trace.attach(wc); trace.start();
  emit(wc, 'Network.requestWillBeSent', request());
  emit(wc, 'Network.requestWillBeSent', request('req1', {timestamp: 10.05, wallTime: 1000.06, redirectResponse: {status: 302, url: 'PRIVATE_REDIRECT'}}));
  emit(wc, 'Network.loadingFailed', {requestId: 'req1', timestamp: 10.08, errorText: 'PRIVATE_ERROR'});
  const snap = trace.snapshot(); assert.equal(snap.requests[0].outcome, 'redirect');
  assert.equal(snap.requests[0].durationMs, 50); assert.equal(snap.requests[0].status, 302);
  assert.equal(snap.requests[1].outcome, 'failed'); assert.equal(snap.requests[1].durationMs, 30);
  snap.requests[0].route = 'PRIVATE_MUTATION'; snap.counts.requests = 0;
  assert.equal(/PRIVATE_/.test(JSON.stringify(trace.snapshot())), false);
  assert.equal(trace.snapshot().counts.requests, 2);
});

test('existing debugger and enable failure report fixed diagnostics only', async () => {
  const trace = createTrace(), busy = mockContents(); busy.debugger.attach();
  assert.equal(await trace.attach(busy), false);
  assert.equal(trace.snapshot().diagnostics[0].code, 'debugger-in-use');
  assert.equal(busy.debugger.isAttached(), true);
  const broken = mockContents(8); broken.debugger.sendCommand = async () => {throw Error('PRIVATE_FAILURE');};
  assert.equal(await trace.attach(broken), false);
  assert.equal(trace.snapshot().diagnostics.at(-1).code, 'attach-failed');
  assert.equal(JSON.stringify(trace.snapshot()).includes('PRIVATE_FAILURE'), false);
  assert.equal(broken.debugger.isAttached(), false);
});
