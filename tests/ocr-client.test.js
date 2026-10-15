'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { OcrClient, validateImageDataUrl, MAX_IMAGE_BYTES } = require('../src/ocr-client');

const image = 'data:image/png;base64,' + Buffer.from('worker-validates-png').toString('base64');
const result = { text: 'ABCDEF', valid: true, confidence: 0.9, characters: [], warnings: [] };

function fakeProcess({ ready = true, handler } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.requests = [];
  child.kill = () => { child.killed = true; };
  child.send = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.stdin.on('data', data => {
    const request = JSON.parse(data.toString());
    child.requests.push(request);
    handler?.(request, child);
  });
  if (ready) queueMicrotask(() => child.send({ type: 'ready', protocol: 1, initialization_ms: 12 }));
  return child;
}

test('OCR rejects remote URLs, unsupported formats, malformed base64 and large data before spawn', async () => {
  let spawned = false;
  const client = new OcrClient({ spawn: () => { spawned = true; } });
  for (const bad of [null, '', 'https://test/image.png', 'data:image/gif;base64,YQ==', 'data:image/png;base64,!!!', 'data:image/png;base64,YQ', 'data:image/png;base64,YR==', image + '\n', 'data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')]) {
    await assert.rejects(client.recognize(bad), { code: 'OCR_IMAGE_INVALID' });
  }
  assert.equal(spawned, false);
  assert.equal(validateImageDataUrl(image), image);
  client.close();
});

test('warmup shares one hidden process and recognition preserves core result', async () => {
  let count = 0;
  let options;
  const child = fakeProcess({ handler: (request, process) => process.send({ type: 'result', id: request.id, result }) });
  const client = new OcrClient({ executable: 'custom-worker.exe', args: ['--test'], spawn: (executable, args, passed) => {
    count += 1;
    assert.equal(executable, 'custom-worker.exe');
    assert.deepEqual(args, ['--test']);
    options = passed;
    return child;
  } });
  const [first, second] = await Promise.all([client.warmup(), client.warmup()]);
  assert.equal(first, second);
  assert.equal(count, 1);
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, false);
  assert.equal(client.status, 'ready');
  assert.equal(client.initializationMs, 12);
  assert.deepEqual(await client.recognize(image), result);
  client.close();
  assert.equal(child.killed, true);
  assert.equal(client.status, 'stopped');
});

test('aborted request ignores stale result and cannot overwrite the next request', async () => {
  const child = fakeProcess();
  const client = new OcrClient({ spawn: () => child });
  await client.warmup();
  const controller = new AbortController();
  const first = client.recognize(image, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  const oldId = child.requests[0].id;
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  const second = client.recognize(image);
  await Promise.resolve();
  const newId = child.requests[1].id;
  assert.notEqual(oldId, newId);
  child.send({ type: 'result', id: oldId, result: { ...result, text: 'WRONGX' } });
  child.send({ type: 'result', id: newId, result });
  assert.deepEqual(await second, result);
  client.close();
});

test('already aborted input never starts worker and cancellation during warmup sends no image', async () => {
  let count = 0;
  const child = fakeProcess({ ready: false });
  const client = new OcrClient({ spawn: () => { count += 1; return child; } });
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(client.recognize(image, { signal: preAborted.signal }), { name: 'AbortError' });
  assert.equal(count, 0);
  const controller = new AbortController();
  const request = client.recognize(image, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  child.send({ type: 'ready', protocol: 1, initialization_ms: 1 });
  assert.equal(child.requests.length, 0);
  client.close();
});

test('timed out process is killed and a new process can recover safely', async () => {
  const children = [];
  const client = new OcrClient({ timeoutMs: 15, spawn: () => {
    const child = fakeProcess({ handler: children.length ? (request, process) => process.send({ type: 'result', id: request.id, result }) : undefined });
    children.push(child);
    return child;
  } });
  await assert.rejects(client.recognize(image), { code: 'OCR_TIMEOUT' });
  assert.equal(children[0].killed, true);
  assert.deepEqual(await client.recognize(image), result);
  assert.equal(children.length, 2);
  children[0].send({ type: 'fatal' });
  assert.equal(client.status, 'ready');
  client.close();
});

test('startup timeout and invalid protocol stop worker without retaining image data', async () => {
  const waiting = fakeProcess({ ready: false });
  const first = new OcrClient({ startupTimeoutMs: 10, spawn: () => waiting });
  await assert.rejects(first.warmup(), { code: 'OCR_START_TIMEOUT' });
  assert.equal(waiting.killed, true);
  first.close();
  const bad = fakeProcess({ ready: false });
  const second = new OcrClient({ spawn: () => bad });
  const startup = second.warmup();
  bad.stdout.write('not protocol\n');
  await assert.rejects(startup, { code: 'OCR_PROTOCOL_ERROR' });
  assert.equal(bad.killed, true);
  second.close();
});

test('close rejects active calls, rejects reuse, and is safe more than once', async () => {
  const child = fakeProcess();
  const client = new OcrClient({ spawn: () => child });
  await client.warmup();
  const request = client.recognize(image);
  await Promise.resolve();
  client.close();
  await assert.rejects(request, { code: 'OCR_CLOSED' });
  await assert.rejects(client.warmup(), { code: 'OCR_CLOSED' });
  client.close();
});

test('request queue cap and malformed model results are rejected', async () => {
  const child = fakeProcess();
  const client = new OcrClient({ maxPending: 1, spawn: () => child });
  const first = client.recognize(image);
  await client.warmup();
  await Promise.resolve();
  await assert.rejects(client.recognize(image), { code: 'OCR_BUSY' });
  child.send({ type: 'result', id: child.requests[0].id, result: {} });
  await assert.rejects(first, { code: 'OCR_PROTOCOL_ERROR' });
  client.close();
});

test('worker image and model errors remain distinguishable without exposing worker details', async () => {
  const codes = ['IMAGE_DECODE_FAILED', 'MODEL_INFERENCE_FAILED', 'UNEXPECTED'];
  const child = fakeProcess({ handler: (request, process) => process.send({ type: 'error', id: request.id, code: codes.shift(), message: 'PRIVATE_WORKER_DATA' }) });
  const client = new OcrClient({ spawn: () => child });
  try {
    await assert.rejects(client.recognize(image), { code: 'IMAGE_DECODE_FAILED', message: /이미지 파일을 열지 못했습니다/ });
    await assert.rejects(client.recognize(image), { code: 'MODEL_INFERENCE_FAILED', message: /인식 모델 실행에 실패/ });
    await assert.rejects(client.recognize(image), error => error.code === 'OCR_FAILED' && !error.message.includes('PRIVATE_WORKER_DATA'));
    assert.equal(client.ready, true);
  } finally { client.close(); }
});
