'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {RunMetrics}=require('../src/run-metrics');

test('metrics use monotonic elapsed time when the wall clock changes',()=>{
  let now=100;const metrics=new RunMetrics({now:()=>now}),originalDateNow=Date.now;
  try{
    metrics.stage('prepare','준비');Date.now=()=>-999999;now=125;
    metrics.stage('page','화면 확인');Date.now=()=>999999999999;now=150;
    assert.deepEqual(metrics.snapshot(),{elapsedMs:50,phases:[{code:'prepare',label:'준비',durationMs:25},{code:'page',label:'화면 확인',durationMs:25}],operations:[],pendingCount:0});
  }finally{Date.now=originalDateNow;}
});
test('concurrent measurements preserve results and sum duration without claiming exclusive wall time',async()=>{
  let now=0,releaseA,releaseB;const metrics=new RunMetrics({now:()=>now});
  const a=metrics.measure('page_inspect',()=>new Promise(resolve=>releaseA=resolve));
  now=10;const b=metrics.measure('page_inspect',()=>new Promise(resolve=>releaseB=resolve));
  assert.equal(metrics.snapshot().pendingCount,2);
  now=30;releaseA('A');assert.equal(await a,'A');assert.equal(metrics.snapshot().pendingCount,1);
  now=40;releaseB('B');assert.equal(await b,'B');
  assert.deepEqual(metrics.snapshot().operations,[{action:'page_inspect',count:2,failed:0,totalMs:60,maxMs:30,lastMs:30}]);
  assert.equal(metrics.snapshot().elapsedMs,40);assert.equal(metrics.snapshot().pendingCount,0);
});
test('failed and synchronously throwing operations are accounted for and rethrow the original error',async()=>{
  let now=0;const metrics=new RunMetrics({now:()=>now}),failure=new Error('private error must not be recorded');
  await assert.rejects(metrics.measure('browser_read',async()=>{now=12;throw failure;}),error=>error===failure);
  await assert.rejects(metrics.measure('browser_read',()=>{now=15;throw failure;}),error=>error===failure);
  assert.deepEqual(metrics.snapshot().operations,[{action:'browser_read',count:2,failed:2,totalMs:15,maxMs:12,lastMs:3}]);
  assert.equal(metrics.snapshot().pendingCount,0);assert.equal(JSON.stringify(metrics.snapshot()).includes('private'),false);
});
test('phase history and operation buckets stay bounded and strip sensitive dynamic values',async()=>{
  let now=0;const metrics=new RunMetrics({now:()=>now});
  for(let i=0;i<110;i++){metrics.stage('phase_'+i,'관찰');now++;}
  for(let i=0;i<50;i++)await metrics.measure('operation_'+i,()=>{now++;return {token:'private'};});
  await metrics.measure('https://private.invalid/token=secret',()=>{});
  await metrics.measure('session_private',()=>{});
  metrics.stage('token_private','주소 https://private.invalid/ token=private');
  const snapshot=metrics.snapshot();
  assert.equal(snapshot.phases.length,100);assert.equal(snapshot.operations.length,20);
  assert.equal(snapshot.operations.find(item=>item.action==='other').count,33);
  assert.equal(snapshot.phases.at(-1).code,'unknown');assert.equal(JSON.stringify(snapshot).includes('private'),false);
  snapshot.operations[0].count=999;snapshot.phases[0].label='changed';
  assert.notEqual(metrics.snapshot().operations[0].count,999);assert.notEqual(metrics.snapshot().phases[0].label,'changed');
});
test('repeated identical stages do not reset elapsed time and a faulty clock cannot break measured work',async()=>{
  let now=10,broken=false;const metrics=new RunMetrics({now:()=>{if(broken)throw Error('clock');return now;}});
  metrics.stage('prepare','준비');now=15;metrics.stage('prepare','준비');now=12;
  assert.equal(metrics.snapshot().phases.length,1);assert.equal(metrics.snapshot().elapsedMs,2);
  now=20;assert.equal(metrics.snapshot().elapsedMs,10);now=18;
  assert.equal(metrics.snapshot().elapsedMs,10);broken=true;
  assert.equal(await metrics.measure('browser_read',()=>42),42);
  assert.equal(metrics.snapshot().operations[0].lastMs,0);assert.equal(metrics.snapshot().pendingCount,0);
});
