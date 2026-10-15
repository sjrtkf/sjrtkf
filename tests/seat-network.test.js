'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {classifyRequest, classifyResponse, attach} = require('../src/seat-network');
const request = (id = 'A', operationName = 'PreselectSeat') => ({url: 'https://tickets.interpark.com/onestop/gql', method: 'POST', postData: JSON.stringify({operationName, query: `mutation ${operationName}($command: PreselectSeatCommand!) { preselectSeat(command: $command) }`, variables: {command: {seatInfoId: id, sessionId: 'must-not-be-stored'}}})});
test('observes only exact official seat mutation endpoints and names', () => {
  assert.deepEqual(classifyRequest(request()), {kind: 'select', field: 'preselectSeat', seatIds: ['seat_block_A']});
  assert.equal(classifyRequest({...request(), url: 'https://attacker.invalid/onestop/gql'}), null);
  assert.equal(classifyRequest({...request(), method: 'GET'}), null);
  assert.equal(classifyRequest(request('A', 'GetRemainSeats')), null);
  assert.equal(classifyRequest({...request(), url: 'https://tickets.interpark.com/onestop/gql/extra'}), null);
});
test('HTTP 200 GraphQL errors are rejections, malformed responses are uncertain', () => {
  const r = classifyRequest(request());
  assert.equal(classifyResponse(r, 200, '{"data":{"preselectSeat":true}}').status, 'ok');
  assert.deepEqual(classifyResponse(r, 200, '{"errors":[{"extensions":{"backendErrorCode":"P41150"}}]}'), {status: 'conflict', seatIds: ['seat_block_A']});
  for (const body of ['{}', 'null', '[]', 'not json', '{"errors":[{"message":"unknown"}]}', '{"data":{"preselectSeat":false}}', '{"data":{"preselectSeat":null}}', '{"data":{"preselectSeat":true},"errors":"invalid"}']) assert.equal(classifyResponse(r, 200, body).status, 'uncertain');
  assert.equal(classifyResponse(r, 503, '{"data":{"preselectSeat":true}}').status, 'uncertain');
});
test('completion rejection identifies only explicit failed seats', () => {
  const r = {kind: 'complete', seatIds: ['seat_block_A', 'seat_block_B']};
  assert.deepEqual(classifyResponse(r, 409, JSON.stringify({data: {backendErrorCode: 'P40054', data: {unselectableSeatInfoIds: ['B']}}})), {status: 'conflict', seatIds: ['seat_block_B']});
  assert.deepEqual(classifyResponse(r, 409, JSON.stringify({data: {backendErrorCode: 'P40054'}})), {status: 'conflict', seatIds: []});
});
test('passive observer keeps response-body decoding pending and stores no sensitive bodies', async () => {
  const wc = new EventEmitter(); wc.debugger = new EventEmitter(); wc.debugger.isAttached = () => true;
  let respond; wc.debugger.sendCommand = () => new Promise(resolve => {respond = resolve;});
  const observer = attach(wc), event = (name, p) => wc.debugger.emit('message', {}, name, p);
  event('Network.requestWillBeSent', {requestId: 'r', request: request()});
  event('Network.responseReceived', {requestId: 'r', response: {status: 200}});
  event('Network.loadingFinished', {requestId: 'r', encodedDataLength: 50});
  assert.equal(observer.snapshot().pending.length, 1);
  respond({body: '{"data":{"preselectSeat":true}}'});
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = observer.snapshot();
  assert.equal(snapshot.pending.length, 0); assert.equal(snapshot.results[0].status, 'ok');
  assert.equal(JSON.stringify(snapshot).includes('must-not-be-stored'), false);
  event('Network.requestWillBeSent', {requestId: 'r2', request: request('B')});
  event('Network.loadingFailed', {requestId: 'r2'});
  assert.equal(observer.snapshot().results[1].status, 'uncertain');
  wc.debugger.emit('detach'); assert.equal(observer.snapshot().healthy, false);
  observer.dispose(); assert.equal(wc.debugger.listenerCount('message'), 0);
});
test('destroyed webContents cleanup uses captured debugger and discards in-flight decoding', async () => {
  const wc = new EventEmitter(), debuggerClient = new EventEmitter();
  let destroyed = false, respond;
  Object.defineProperty(wc, 'debugger', {get() {if (destroyed) throw Error('Object has been destroyed'); return debuggerClient;}});
  debuggerClient.isAttached = () => true;
  debuggerClient.sendCommand = () => new Promise(resolve => {respond = resolve;});
  const observer = attach(wc), event = (name, p) => debuggerClient.emit('message', {}, name, p);
  event('Network.requestWillBeSent', {requestId: 'r', request: request()});
  event('Network.responseReceived', {requestId: 'r', response: {status: 200}});
  event('Network.loadingFinished', {requestId: 'r', encodedDataLength: 50});
  destroyed = true;
  assert.doesNotThrow(() => wc.emit('destroyed'));
  assert.equal(debuggerClient.listenerCount('message'), 0);
  respond({body: '{"data":{"preselectSeat":true}}'});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observer.snapshot(), {sequence: 1, healthy: false, pending: [], results: []});
  assert.doesNotThrow(observer.dispose);
});
test('null or primitive request bodies never throw from the passive event handler', () => {
  for (const postData of ['null', '[]', '1', '"invalid"']) {
    assert.equal(classifyRequest({...request(), postData}), null);
    assert.deepEqual(classifyRequest({...request(), url: 'https://tickets.interpark.com/onestop/api/seats/select', postData}), {kind: 'complete', seatIds: []});
  }
  assert.deepEqual(classifyRequest({...request(), url: 'https://tickets.interpark.com/onestop/api/seats/select', postData: '{"seats":{}}'}), {kind: 'complete', seatIds: []});
});
