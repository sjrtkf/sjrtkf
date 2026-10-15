'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ManualCaptcha}=require('../src/manual-captcha');

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function snapshot(overrides={}){return {present:true,supported:true,status:'ready',challengeId:'document-1:image-1',imageDataUrl:'data:image/png;base64,QUJD',existingText:'',adapter:'onestop',submitEnabled:false,...overrides};}
function setup({prepareResult,submitResult}={}){
  const states=[],calls={prepare:[],submit:[],recognize:0};let current=true;
  const controller=new ManualCaptcha({onState:value=>states.push({...value}),ocr:{recognize(){throw Error('OCR must never be called');}}});
  const adapter={targetId:'tab-42:frame-7',assertCurrent(){if(!current)throw Error('Target path changed');},
    prepare(arg){calls.prepare.push(arg);return prepareResult===undefined?snapshot():prepareResult;},
    submit(arg){calls.submit.push(arg);return submitResult===undefined?{submitted:true,status:'submitted',challengeId:arg.challengeId}:submitResult;},
    recognize(){calls.recognize++;throw Error('Recognition is not allowed');}};
  return {controller,adapter,states,calls,changePath(){current=false;}};
}

test('manual controller prepares and publishes the image without any recognition',async()=>{
  const f=setup();const result=await f.controller.prepare(f.adapter,{focus:true});
  assert.equal(result.challengeId,'document-1:image-1');assert.equal(f.controller.status.imageDataUrl,'data:image/png;base64,QUJD');
  assert.equal(f.controller.status.targetId,f.adapter.targetId);assert.equal(f.controller.status.busy,false);
  assert.deepEqual(f.calls.prepare,[{focus:true}]);assert.equal(f.calls.recognize,0);assert.equal(f.calls.submit.length,0);
  assert.equal(f.states[0].busy,true);assert.equal(f.states.at(-1).busy,false);
});

test('explicit human lowercase input becomes uppercase without filling missing characters',async()=>{
  const f=setup();const s=await f.controller.prepare(f.adapter);
  const result=await f.controller.submit({challengeId:s.challengeId,text:' abcdex '});
  assert.equal(result.submitted,true);assert.deepEqual(f.calls.submit,[{challengeId:s.challengeId,text:'ABCDEX'}]);assert.equal(f.calls.recognize,0);
});

test('missing, short, long, numeric and non-English input is rejected before page submission',async()=>{
  for(const text of [undefined,null,123456,'ABCDE','ABCDEFG','ABC12D','ABC DE','가나다라마바','ＡＢＣＤＥＦ','abcdeſ','abcdﬀ']){
    const f=setup();const s=await f.controller.prepare(f.adapter);
    await assert.rejects(f.controller.submit({challengeId:s.challengeId,text}),/영문 6자리/);
    assert.equal(f.calls.submit.length,0,String(text));assert.equal(f.controller.pending,false);
  }
});

test('challenge mismatch and missing context cannot deliver entered text',async()=>{
  const f=setup();const s=await f.controller.prepare(f.adapter);
  await assert.rejects(f.controller.submit({challengeId:s.challengeId+'-old',text:'ABCDEF'}),/바뀌었거나/);
  f.controller.clear();await assert.rejects(f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),/바뀌었거나/);
  assert.equal(f.calls.submit.length,0);
});

test('a challenge that already submitted cannot be submitted a second time',async()=>{
  const f=setup();const s=await f.controller.prepare(f.adapter);await f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'});
  await assert.rejects(f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),/이미 확인/);
  assert.equal(f.calls.submit.length,1);assert.equal(f.controller.status.busy,false);
});

test('target navigation before submission blocks the page adapter',async()=>{
  const f=setup();const s=await f.controller.prepare(f.adapter);f.changePath();
  await assert.rejects(f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),/Target path changed/);
  assert.equal(f.calls.submit.length,0);assert.equal(f.controller.pending,false);assert.equal(f.controller.context,null);assert.equal(f.controller.status.imageDataUrl,undefined);assert.equal(f.controller.status.supported,false);
});

test('navigation during a submission never publishes a success for the old target',async()=>{
  const pending=deferred(),f=setup({submitResult:pending.promise}),s=await f.controller.prepare(f.adapter);
  const submitted=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),rejected=assert.rejects(submitted,/Target path changed/);
  f.changePath();pending.resolve({submitted:true,status:'submitted'});await rejected;
  assert.equal(f.controller.context,null);assert.equal(f.controller.status.supported,false);assert.equal(f.controller.status.submitted,undefined);assert.equal(f.controller.status.busy,false);
});

test('concurrent submission permits exactly one adapter call',async()=>{
  const pending=deferred(),f=setup({submitResult:pending.promise}),s=await f.controller.prepare(f.adapter);
  const first=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'});
  await assert.rejects(f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),/처리하고 있습니다/);
  assert.equal(f.calls.submit.length,1);pending.resolve({submitted:true,status:'submitted'});await first;assert.equal(f.controller.pending,false);
});

test('submission waits for an actual background preparation promise, without a timed retry',async()=>{
  const ready=deferred(),f=setup({prepareResult:ready.promise}),s=snapshot();
  const preparing=f.controller.prepare(f.adapter,{focus:false,background:true});
  const submitted=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'});
  await Promise.resolve();assert.equal(f.calls.submit.length,0);assert.equal(f.controller.pending,false);
  ready.resolve(s);await preparing;assert.equal((await submitted).submitted,true);assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.submit.length,1);
});

test('two submissions waiting for background preparation still deliver only once',async()=>{
  const ready=deferred(),sending=deferred(),f=setup({prepareResult:ready.promise,submitResult:sending.promise}),s=snapshot();
  const preparing=f.controller.prepare(f.adapter,{focus:false,background:true});
  const first=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'});
  const second=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),rejected=assert.rejects(second,/처리하고 있습니다/);
  ready.resolve(s);await preparing;await rejected;assert.equal(f.calls.submit.length,1);
  sending.resolve({submitted:true,status:'submitted'});await first;
});

test('clear during awaited preparation prevents stale image resurrection',async()=>{
  const ready=deferred(),f=setup({prepareResult:ready.promise});
  const preparing=f.controller.prepare(f.adapter,{background:true}),rejected=assert.rejects(preparing,/취소되었습니다/);
  f.controller.clear('사용자가 준비를 중지했습니다.');const afterClear=f.states.length;
  ready.resolve(snapshot());await rejected;
  assert.equal(f.controller.context,null);assert.equal(f.controller.status.present,false);assert.equal(f.controller.status.imageDataUrl,undefined);
  assert.ok(f.states.slice(afterClear).every(s=>!s.imageDataUrl&&!s.supported));assert.equal(f.controller.status.busy,false);
});

test('background preparation keeps the input panel enabled throughout refresh',async()=>{
  const f=setup();await f.controller.prepare(f.adapter);
  const ready=deferred();f.adapter.prepare=()=>ready.promise;const start=f.states.length;
  const preparing=f.controller.prepare(f.adapter,{focus:false,background:true});
  assert.equal(f.controller.status.busy,false);assert.equal(f.controller.pending,false);assert.equal(f.controller.status.imageDataUrl,'data:image/png;base64,QUJD');
  ready.resolve(snapshot({existingText:'AB'}));await preparing;
  assert.ok(f.states.slice(start).every(state=>state.busy===false));assert.equal(f.controller.status.existingText,'AB');
});

test('clearing while page submission is pending cannot restore the old image or success',async()=>{
  const sending=deferred(),f=setup({submitResult:sending.promise}),s=await f.controller.prepare(f.adapter);
  const submitted=f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'}),rejected=assert.rejects(submitted,/대상 화면이 바뀌었습니다/);
  f.controller.clear();sending.resolve({submitted:true,status:'submitted'});await rejected;
  assert.equal(f.controller.context,null);assert.equal(f.controller.status.imageDataUrl,undefined);assert.equal(f.controller.status.submitted,undefined);assert.equal(f.controller.status.busy,false);
});

test('changed, absent, unsupported or cancelled page results invalidate the displayed image',async()=>{
  for(const status of ['changed','absent','unsupported','cancelled']){
    const f=setup({submitResult:{submitted:false,status}}),s=await f.controller.prepare(f.adapter);
    assert.equal((await f.controller.submit({challengeId:s.challengeId,text:'ABCDEF'})).submitted,false);
    assert.equal(f.controller.context,null,status);assert.equal(f.controller.status.imageDataUrl,null,status);assert.equal(f.controller.status.supported,false,status);assert.equal(f.controller.status.busy,false,status);
  }
});

test('stale context invalidation clears the previous target without page interaction',async()=>{
  const f=setup();await f.controller.prepare(f.adapter);f.changePath();f.controller.invalidateIfStale();
  assert.equal(f.controller.context,null);assert.equal(f.controller.status.present,false);assert.equal(f.controller.status.imageDataUrl,undefined);assert.equal(f.calls.submit.length,0);
});
