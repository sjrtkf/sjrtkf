'use strict';

// Standalone Electron integration: real DOM, MutationObserver and timers,
// with every network request confined to one in-memory fixture document.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const entry=require('../src/entry');
const FIXTURE_URL='https://tickets.interpark.com/gates/ticket/26005452';
const RESULT=path.join(__dirname,'../work/gate-clock-smoke-result.json');
const fixture='<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Local gate clock fixture</title><main><h1>예매 준비가 완료됐어요</h1><button id="book" disabled style="width:180px;height:48px">예매하기</button></main></html>';
const report={passed:false,scope:'Local in-browser fixture only; not a live-site latency comparison.',checks:[],blockedRequests:0};
let win;
app.setPath('userData',path.join(__dirname,'../work/gate-clock-smoke-profile-'+process.pid));
const evaluate=code=>win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code}]);
const snapshotCode='({clicks:window.__testClicks,status:window.__bearsGate.status,disabled:document.querySelector("#book").disabled})';
const configCode=delay=>`({runId:window.__testRunId,goodsCode:'26005452',documentId:window.__bearsGate.status.documentId,source:'ticket-server',openAt:Date.now()+${delay},deadlineMono:performance.now()+${delay},validUntilMono:performance.now()+5000,uncertaintyMs:10})`;
async function fresh(runId){
  await win.loadURL(FIXTURE_URL);
  const initial=await evaluate(`(()=>{window.__testClicks=0;window.__testRunId=${runId};document.querySelector('#book').addEventListener('click',()=>window.__testClicks++);const status=(${entry.armGate.toString()})({goodsCode:'26005452',runId:${runId}});return {hidden:document.hidden,status};})()`);
  assert.equal(initial.hidden,false,'Clock path requires a visible document; backgroundThrottling:false must preserve that state.');
  assert.equal(initial.status.phase,'armed');assert.equal(initial.status.observedDisabled,true);assert.ok(initial.status.documentId);
}
async function settled(ms){return evaluate(`new Promise(resolve=>setTimeout(()=>resolve(${snapshotCode}),${ms}))`);}
function record(name,state){report.checks.push({name,clicks:state.clicks,phase:state.status.phase,trigger:state.status.trigger,clockOutcome:state.status.clock.outcome,clockFired:state.status.clock.firedAtMono!=null,disabled:state.disabled});}

app.whenReady().then(async()=>{
  const isolated=session.fromPartition('gate-clock-smoke-'+process.pid,{cache:false});
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
    const allow=details.url===FIXTURE_URL&&details.resourceType==='mainFrame';
    if(!allow)report.blockedRequests++;
    callback({cancel:!allow});
  });
  await isolated.protocol.handle('https',request=>request.url===FIXTURE_URL?new Response(fixture,{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response('Blocked local fixture request',{status:403}));
  win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));

  await fresh(1);
  // In one task the site enables its button, then an already-due clock fires.
  // The real MutationObserver microtask runs afterwards and must not duplicate.
  assert.equal(await evaluate(`(()=>{document.querySelector('#book').disabled=false;return (${entry.setGateClock.toString()})(${configCode(-1)});})()`),true);
  let result=await settled(100);
  assert.equal(result.clicks,1);assert.equal(result.status.phase,'clicked');assert.equal(result.status.trigger,'server-clock');assert.equal(result.status.clock.outcome,'clicked');record('이미 도달한 시각 예약이 활성화 직후 한 번 실행',result);

  await fresh(2);
  assert.equal(await evaluate(`(()=>{const installed=(${entry.setGateClock.toString()})(${configCode(150)});document.querySelector('#book').disabled=false;return installed;})()`),true);
  result=await settled(300);
  assert.equal(result.clicks,1);assert.equal(result.status.phase,'clicked');assert.equal(result.status.trigger,'activation');assert.equal(result.status.clock.firedAtMono,undefined);record('활성화 감지가 먼저 실행하면 예약 타이머 취소',result);

  await fresh(3);
  assert.equal(await evaluate(`(${entry.setGateClock.toString()})(${configCode(-1)})`),true);
  result=await evaluate(snapshotCode);
  assert.equal(result.clicks,0);assert.equal(result.disabled,true);assert.equal(result.status.phase,'armed');assert.equal(result.status.clock.outcome,'not-ready');assert.ok(Number.isFinite(result.status.clock.firedAtMono));
  await evaluate(`document.querySelector('#book').disabled=false`);
  result=await settled(100);
  assert.equal(result.clicks,1);assert.equal(result.status.trigger,'activation');assert.equal(result.status.clock.outcome,'not-ready');record('시각 도달에도 비활성 버튼은 유지하고 이후 정상 활성화에 실행',result);

  await fresh(4);
  assert.equal(await evaluate(`(()=>{const installed=(${entry.setGateClock.toString()})(${configCode(100)});window.__bearsGate.stop();document.querySelector('#book').disabled=false;return installed;})()`),true);
  result=await settled(250);
  assert.equal(result.clicks,0);assert.equal(result.status.phase,'stopped');assert.equal(result.status.trigger,null);assert.equal(result.status.clock.firedAtMono,undefined);record('중지 후 예약과 활성화 감지가 모두 클릭하지 않음',result);

  report.passed=true;
}).catch(error=>{report.error=error.stack||error.message;}).finally(()=>{
  fs.mkdirSync(path.dirname(RESULT),{recursive:true});fs.writeFileSync(RESULT,JSON.stringify(report,null,2));
  if(win&&!win.isDestroyed())win.destroy();
  console.log(JSON.stringify(report));app.exit(report.passed?0:1);
});
