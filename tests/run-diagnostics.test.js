'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {safeLastRun}=require('../src/run-diagnostics');
test('persisted run diagnostics retain first cause and counters while discarding transport and arbitrary properties',()=>{
  const result=safeLastRun({id:1,durationMs:42,message:'성공',stopReason:'관찰 끊김',failureDetail:'epoch 오류',stages:[{stage:'대기',elapsedMs:0,body:'private'}],entry:{strategy:'site',requestCount:1,seatPageObserved:true,signedEntry:'private',body:'private',headers:{Cookie:'private'}},retry:{cycle:2,attempted:21,lastReason:'조건 순환'},url:'https://private.invalid/?token=private',body:'private'});
  assert.equal(result.stopReason,'관찰 끊김');assert.equal(result.entry.requestCount,1);assert.equal(result.retry.attempted,21);assert.equal(JSON.stringify(result).includes('private'),false);assert.deepEqual(Object.keys(result.stages[0]),['stage','elapsedMs']);
});
test('persisted diagnostic messages redact addresses, credential markers and long identifiers',()=>{
  const result=safeLastRun({id:2,durationMs:1,message:'실패 https://tickets.interpark.com/path?token=hidden',failureDetail:'token=hidden Authorization: Bearer hidden',stages:[{stage:'A'.repeat(64),elapsedMs:1}],entry:{clockReason:'sessionId=hidden'}});
  assert.equal(JSON.stringify(result).includes('hidden'),false);assert.equal(JSON.stringify(result).includes('https://'),false);assert.equal(JSON.stringify(result).includes('A'.repeat(64)),false);
});
test('invalid or oversized diagnostic histories cannot restore unbounded state',()=>{
  assert.equal(safeLastRun({id:0,durationMs:0}),null);assert.equal(safeLastRun({id:1,durationMs:-1}),null);
  const result=safeLastRun({id:1,durationMs:0,stages:Array.from({length:100},(_,i)=>({stage:'대기'.repeat(300),elapsedMs:i}))});assert.equal(result.stages.length,80);assert.ok(result.stages.every(s=>s.stage.length<=250));
});
test('new metrics and diagnosis preserve a strict summary and redact credentials',()=>{
  const result=safeLastRun({id:3,durationMs:50,metrics:{elapsedMs:50,pendingCount:1,phases:[{code:'page',label:'주소 https://private.invalid/',durationMs:40,token:'private'}],operations:[{action:'browser_read',count:2,failed:1,totalMs:65,maxMs:40,lastMs:25,response:'private'}],body:'private'},diagnosis:{code:'page_unknown',title:'화면 확인',detail:'token=private',nextAction:'세션 https://private.invalid/',level:'warning',headers:'private'},stages:[{stage:'관찰',elapsedMs:10,code:'page',durationMs:5}]});
  assert.deepEqual(result.metrics.operations,[{action:'browser_read',count:2,failed:1,totalMs:65,maxMs:40,lastMs:25}]);
  assert.equal(result.metrics.pendingCount,1);assert.equal(result.diagnosis.level,'warning');
  assert.deepEqual(result.stages[0],{stage:'관찰',elapsedMs:10,code:'page',durationMs:5});
  assert.equal(JSON.stringify(result).includes('private'),false);
});
test('metric restore bounds arrays and rejects invalid counters and arbitrary diagnosis objects',()=>{
  const operation={action:'read',count:1,failed:0,totalMs:1,maxMs:1,lastMs:1};
  const result=safeLastRun({id:4,durationMs:0,metrics:{elapsedMs:0,pendingCount:-1,phases:Array.from({length:150},()=>({code:'page',label:'x'.repeat(600),durationMs:1})),operations:[{...operation,failed:2},{...operation,count:Infinity},{...operation,totalMs:-1},...Array.from({length:30},(_,i)=>({...operation,action:'read_'+i}))]},diagnosis:{code:'token_private',title:'안내',detail:{token:'private'},nextAction:['private'],level:'<script>'}});
  assert.equal(result.metrics.phases.length,100);assert.ok(result.metrics.phases.every(phase=>phase.label.length<=250));
  assert.equal(result.metrics.operations.length,17);assert.equal(result.metrics.pendingCount,0);
  assert.deepEqual(result.diagnosis,{code:'unknown',title:'안내',detail:'',nextAction:'',level:'info'});
  assert.equal(safeLastRun({id:5,durationMs:0,metrics:{elapsedMs:NaN},diagnosis:{title:{text:'unsafe'}}}).metrics,undefined);
  assert.equal(safeLastRun({id:5,durationMs:0,metrics:{elapsedMs:NaN},diagnosis:{title:{text:'unsafe'}}}).diagnosis,undefined);
});
test('legacy persisted records remain readable without invented metric or diagnosis fields',()=>{
  const result=safeLastRun({id:6,durationMs:10,message:'완료',stages:[{stage:'대기',elapsedMs:0}]});
  assert.deepEqual(result.stages,[{stage:'대기',elapsedMs:0}]);assert.equal('metrics' in result,false);assert.equal('diagnosis' in result,false);
});
