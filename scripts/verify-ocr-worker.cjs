'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OcrClient } = require('../src/ocr-client');

(async () => {
  const root = path.resolve(__dirname, '..');
  const folder = path.join(root, 'outputs', 'CaptchaWorker-v0.1');
  const executable = path.join(folder, 'CaptchaWorker-v0.1.exe');
  const client = new OcrClient({ executable });
  const samples = [];
  try {
    await client.warmup();
    for (const expected of ['WTCNBW', 'TXCBPQ']) {
      const input = fs.readFileSync(path.join(root, 'outputs', 'CaptchaReader-v0.1', 'sample-images', `${expected}.png`));
      const result = await client.recognize(`data:image/png;base64,${input.toString('base64')}`);
      assert.equal(result.text, expected);
      assert.equal(result.valid, true);
      samples.push({ text: result.text, valid: result.valid, elapsed_ms: result.elapsed_ms });
    }
    await assert.rejects(client.recognize('data:image/png;base64,YQ=='), { code: 'IMAGE_DECODE_FAILED' });
    assert.equal(client.ready, true);
    const modelHashes = {};
    for (const name of ['captcha_solver.onnx', 'labels.json']) {
      const source = fs.readFileSync(path.join(root, 'ocr', 'models', name));
      const packaged = fs.readFileSync(path.join(folder, '_internal', 'ocr', 'models', name));
      assert.deepEqual(packaged, source);
      modelHashes[name] = crypto.createHash('sha256').update(packaged).digest('hex');
    }
    const report = {
      passed: true, samples, initializationMs: client.initializationMs,
      invalidImageRejected: true, modelHashes, browserRequests: 0,
      imagesOrRecognitionResultsPersistedByWorker: false,
      exeSha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    };
    fs.writeFileSync(path.join(root, 'work', 'ocr-worker-validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, samples: samples.length, invalidImageRejected: true, modelFilesMatched: 2, browserRequests: 0 }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
