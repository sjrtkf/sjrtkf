'use strict';

const { spawn: spawnProcess } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_ENCODED_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const MAX_STDOUT_BYTES = 64 * 1024;
const WORKER_ERRORS = Object.freeze({
  IMAGE_DATA_INVALID: '보안문자 이미지 데이터가 없거나 전달 형식이 올바르지 않습니다.',
  IMAGE_BASE64_INVALID: '보안문자 이미지 데이터가 손상되었습니다. 새 이미지를 불러온 뒤 다시 시도해 주세요.',
  IMAGE_TOO_LARGE: '보안문자 이미지가 허용 크기(2 MiB)를 초과했습니다.',
  IMAGE_TYPE_UNSUPPORTED: '실제 이미지가 지원하는 PNG·JPEG·WebP 형식이 아닙니다.',
  IMAGE_SIZE_INVALID: '보안문자 이미지의 가로·세로 크기가 허용 범위를 벗어났습니다.',
  IMAGE_ANIMATED: '움직이는 보안문자 이미지는 지원하지 않습니다.',
  IMAGE_DECODE_FAILED: '보안문자 이미지 파일을 열지 못했습니다. 새 이미지를 불러온 뒤 다시 시도해 주세요.',
  MODEL_INFERENCE_FAILED: '이미지는 읽었지만 인식 모델 실행에 실패했습니다. 도우미를 다시 실행해 주세요.',
});

function makeError(message, code, name) {
  const error = new Error(message);
  error.code = code;
  if (name) error.name = name;
  return error;
}

function validateImageDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_ENCODED_BYTES + 64) {
    throw makeError('보안문자 이미지가 없거나 너무 큽니다.', 'OCR_IMAGE_INVALID');
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[0] !== value || !match[2] || match[2].length % 4 !== 0) {
    throw makeError('PNG, JPEG, WebP base64 이미지가 필요합니다.', 'OCR_IMAGE_INVALID');
  }
  const decoded = Buffer.from(match[2], 'base64');
  if (!decoded.length || decoded.length > MAX_IMAGE_BYTES || decoded.toString('base64') !== match[2]) {
    throw makeError('이미지 데이터가 올바르지 않거나 2 MiB를 초과했습니다.', 'OCR_IMAGE_INVALID');
  }
  return value;
}

function findWorkerExecutable() {
  const relative = path.join('ocr-worker', 'CaptchaWorker-v0.1.exe');
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, relative),
    path.resolve(__dirname, '..', 'outputs', 'CaptchaWorker-v0.1', 'CaptchaWorker-v0.1.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

class OcrClient {
  constructor(options = {}) {
    this.executable = options.executable || findWorkerExecutable();
    this.args = options.args || [];
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 20000;
    this.maxPending = options.maxPending ?? 8;
    this._spawn = options.spawn || spawnProcess;
    this._child = null;
    this._status = 'stopped';
    this._startup = null;
    this._pending = new Map();
    this._counter = 0;
    this._closed = false;
    this._readyInfo = null;
  }

  get status() { return this._status; }
  get ready() { return this._status === 'ready'; }
  get initializationMs() { return this._readyInfo?.initialization_ms ?? null; }

  warmup() {
    if (this._closed) return Promise.reject(makeError('인식기가 종료되었습니다.', 'OCR_CLOSED'));
    if (this.ready) return Promise.resolve(this._readyInfo);
    if (this._startup) return this._startup.promise;
    this._status = 'starting';
    let resolveStart;
    let rejectStart;
    const promise = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    const startup = { promise, resolve: resolveStart, reject: rejectStart, timer: null };
    this._startup = startup;
    let child;
    try {
      child = this._spawn(this.executable, this.args, {
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
      });
    } catch {
      this._fail(makeError('보안문자 인식기를 실행할 수 없습니다.', 'OCR_START_FAILED'));
      return promise;
    }
    this._child = child;
    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this._child !== child) return;
      buffered += chunk;
      if (Buffer.byteLength(buffered, 'utf8') > MAX_STDOUT_BYTES) {
        this._fail(makeError('인식기 응답 크기가 올바르지 않습니다.', 'OCR_PROTOCOL_ERROR'));
        return;
      }
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        try { this._message(JSON.parse(line)); }
        catch { this._fail(makeError('인식기 응답 형식이 올바르지 않습니다.', 'OCR_PROTOCOL_ERROR')); return; }
      }
    });
    // Drain diagnostics without retaining or logging possibly sensitive content.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {
      if (this._child === child) this._fail(makeError('인식기 연결이 끊겼습니다.', 'OCR_PROCESS_EXIT'));
    });
    child.once('error', () => {
      if (this._child === child) this._fail(makeError('보안문자 인식기를 실행할 수 없습니다.', 'OCR_START_FAILED'));
    });
    child.once('exit', () => {
      if (this._child === child) this._fail(makeError('보안문자 인식기가 종료되었습니다.', 'OCR_PROCESS_EXIT'));
    });
    startup.timer = setTimeout(() => {
      if (this._startup === startup) this._fail(makeError('보안문자 모델 준비 시간이 초과되었습니다.', 'OCR_START_TIMEOUT'));
    }, this.startupTimeoutMs);
    return promise;
  }

  _message(message) {
    if (!message || typeof message !== 'object') throw new Error('protocol');
    if (message.type === 'ready') {
      if (message.protocol !== 1 || !this._startup) throw new Error('protocol');
      const startup = this._startup;
      this._startup = null;
      clearTimeout(startup.timer);
      this._status = 'ready';
      this._readyInfo = message;
      startup.resolve(message);
      return;
    }
    if (message.type === 'fatal') {
      this._fail(makeError('보안문자 인식기를 사용할 수 없습니다. 모델 폴더를 확인해 주세요.', 'OCR_WORKER_FAILED'));
      return;
    }
    if (!['result', 'error', 'cancelled'].includes(message.type) || typeof message.id !== 'string') throw new Error('protocol');
    const pending = this._pending.get(message.id);
    if (!pending) return; // Late/canceled or old-process response cannot resolve another request.
    if (message.type === 'cancelled') return;
    this._pending.delete(message.id);
    pending.cleanup();
    if (message.type === 'error') {
      const known = Object.hasOwn(WORKER_ERRORS, message.code);
      pending.reject(makeError(known ? WORKER_ERRORS[message.code] : '보안문자 인식 중 오류가 발생했습니다. 도우미를 다시 실행해 주세요.', known ? message.code : 'OCR_FAILED'));
    }
    else if (!message.result || typeof message.result.text !== 'string' || typeof message.result.valid !== 'boolean') {
      pending.reject(makeError('인식 결과 형식이 올바르지 않습니다.', 'OCR_PROTOCOL_ERROR'));
    } else pending.resolve(message.result);
  }

  async recognize(dataUrl, { signal } = {}) {
    validateImageDataUrl(dataUrl);
    if (signal?.aborted) throw makeError('보안문자 인식이 취소되었습니다.', 'ABORT_ERR', 'AbortError');
    const startup = this.warmup();
    if (signal) {
      await new Promise((resolve, reject) => {
        const abort = () => reject(makeError('보안문자 인식이 취소되었습니다.', 'ABORT_ERR', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        startup.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
      });
    } else await startup;
    if (signal?.aborted) throw makeError('보안문자 인식이 취소되었습니다.', 'ABORT_ERR', 'AbortError');
    if (!this.ready || !this._child) throw makeError('인식기가 준비되지 않았습니다.', 'OCR_NOT_READY');
    if (this._pending.size >= this.maxPending) throw makeError('진행 중인 인식 요청이 너무 많습니다.', 'OCR_BUSY');
    const id = `ocr_${++this._counter}`;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this._pending.delete(id)) return;
        cleanup();
        reject(makeError('보안문자 인식이 취소되었습니다.', 'ABORT_ERR', 'AbortError'));
      };
      const timer = setTimeout(() => {
        if (this._pending.has(id)) this._fail(makeError('보안문자 인식 시간이 초과되었습니다.', 'OCR_TIMEOUT'));
      }, this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      this._pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { this._child.stdin.write(JSON.stringify({ id, op: 'recognize', image: dataUrl }) + '\n'); }
      catch { this._fail(makeError('인식기에 이미지를 전달하지 못했습니다.', 'OCR_PROCESS_EXIT')); }
    });
  }

  _fail(error, status = 'error') {
    const child = this._child;
    this._child = null;
    this._readyInfo = null;
    this._status = status;
    if (this._startup) {
      const startup = this._startup;
      this._startup = null;
      clearTimeout(startup.timer);
      startup.reject(error);
    }
    for (const pending of this._pending.values()) { pending.cleanup(); pending.reject(error); }
    this._pending.clear();
    if (child) { try { child.stdin.end(); child.kill(); } catch {} }
  }

  close() {
    this._closed = true;
    this._fail(makeError('보안문자 인식기가 종료되었습니다.', 'OCR_CLOSED'), 'stopped');
  }
}

module.exports = { OcrClient, findWorkerExecutable, validateImageDataUrl, MAX_IMAGE_BYTES };
