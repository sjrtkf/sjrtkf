'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
function setup(){
  const sourcePath=path.resolve(__dirname,'../src/main.js'),load=createRequire(sourcePath),source=fs.readFileSync(sourcePath,'utf8').split('app.whenReady().then')[0];
  const mono={now:1000},epoch=Date.parse('2026-09-18T01:59:00Z'),calls=[],clock={wall:epoch};let release;
  class TestDate extends Date{static now(){return clock.wall;}}
  const wc={id:1,isDestroyed:()=>false,getURL:()=> 'https://tickets.interpark.com/gates/ticket/26005452',executeJavaScriptInIsolatedWorld:async(_world,scripts)=>{
    const code=scripts[0].code;calls.push(code);
    if(code.startsWith('(()=>({pageMono:performance.now()')){if(wc.defer)await new Promise(r=>release=r);mono.now+=20;return {pageMono:900,documentId:'fixture-doc'};}
    if(code.startsWith('(function setGateClock'))return true;
    throw Error('Unexpected browser call');
  }};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}}};
  const context={require:n=>n==='electron'?electron:n==='node:perf_hooks'?{performance:{now:()=>mono.now}}:n==='node:fs'?{...fs,readFileSync(){throw Error('none');}}:load(n),__dirname:path.dirname(sourcePath),process:{argv:[],pid:0},URL,Date:TestDate,console,setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.audit={scheduleGateClock,pinGateDocument,bumpDocument:()=>scopeVersions.set(1,(scopeVersions.get(1)||0)+1),setClock:v=>clockInfo=v,begin:()=>{targets.set(1,globalThis.fixtureWc);active=1;return beginRun(globalThis.fixtureWc,{},"auto");},cancel:()=>runs.cancel()};',context);context.fixtureWc=wc;
  const run=context.audit.begin();Object.assign(run,{goodsCode:'26005452',openAt:epoch+10000,clockEligible:true,lastClockRefresh:1000});run.entry.strategy='clock';
  const sample={source:'ticket-server',anchorMonoMs:1000,serverEpochAtAnchorMs:epoch,rttMs:10,uncertaintyMs:6};context.audit.setClock(sample);
  return {api:context.audit,wc,run,calls,mono,clock,epoch,sample,release:()=>release(),schedule:()=>context.audit.scheduleGateClock(run,wc,{phase:'armed',clock:{outcome:'not-configured'}})};
}
test('메인과 페이지의 다른 monotonic 기준점을 왕복 측정으로 연결하고 한 표본을 한 번 설치한다',async()=>{
  const f=setup();await f.schedule();assert.equal(f.calls.length,2);
  const script=f.calls[1],arg=JSON.parse(script.slice(script.lastIndexOf(')(')+2,-1));
  assert.equal(arg.deadlineMono,10890);assert.equal(arg.validUntilMono,60880);assert.equal(arg.uncertaintyMs,16);assert.equal(arg.source,'ticket-server');
  await f.schedule();assert.equal(f.calls.length,2);assert.equal(f.run.entry.clockOutcome,'armed');
});
test('PC 벽시계 점프는 이미 보정한 페이지 실행 마감시각을 바꾸지 않는다',async()=>{
  const f=setup();f.clock.wall+=86400000;await f.schedule();const code=f.calls[1],arg=JSON.parse(code.slice(code.lastIndexOf(')(')+2,-1));assert.equal(arg.deadlineMono,10890);
});
test('페이지 시각 조회 도중 중지하면 예약 실행을 설치하지 않는다',async()=>{
  const f=setup();f.wc.defer=true;const pending=f.schedule();await Promise.resolve();f.api.cancel();f.release();await assert.rejects(pending,/중지/);assert.equal(f.calls.length,1);
});
test('같은 URL의 준비 문서가 교체되면 이전 보정값으로 예약하지 않는다',async()=>{
  const f=setup();f.wc.defer=true;const pending=f.schedule();await Promise.resolve();f.api.bumpDocument();f.release();await assert.rejects(pending,/화면이 변경/);assert.equal(f.calls.length,1);
});
test('같은 실행에서 준비 문서를 다시 로드하면 감시를 새로 설치하지 않는다',()=>{
  const f=setup();f.api.pinGateDocument(f.run,f.wc);f.api.pinGateDocument(f.run,f.wc);f.api.bumpDocument();assert.throws(()=>f.api.pinGateDocument(f.run,f.wc),/다시 로드/);
});
test('대체 시각 또는 만료 표본은 페이지 실행을 설치하지 않고 활성화 감지를 유지한다',async()=>{
  for(const sample of [null,{source:'http-date-fallback'},{source:'ticket-server',anchorMonoMs:0,serverEpochAtAnchorMs:Date.parse('2026-09-18'),rttMs:10,uncertaintyMs:6}]){
    const f=setup();if(sample?.anchorMonoMs===0){f.mono.now=61001;f.run.lastClockRefresh=f.mono.now;}f.api.setClock(sample);await f.schedule();assert.equal(f.calls.length,0);assert.equal(f.run.entry.clockOutcome,'fallback');
  }
});
test('다른 모드·공식 시각 미확인·이미 클릭·타이머 발동 뒤에는 예약을 추가하지 않는다',async()=>{
  const a=setup();a.run.clockEligible=false;await a.schedule();assert.equal(a.calls.length,0);
  const b=setup();b.run.entry.strategy='site';await b.schedule();assert.equal(b.calls.length,0);
  const c=setup();c.run.entry.requestCount=1;await c.schedule();assert.equal(c.calls.length,0);
  for(const status of [{phase:'clicked'},{phase:'armed',clock:{firedAtMono:999}}]){const f=setup();await f.api.scheduleGateClock(f.run,f.wc,status);assert.equal(f.calls.length,0);}
});
