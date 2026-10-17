'use strict';
// Real Chromium DOM/timers/fetch, with all HTTPS traffic intercepted locally.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const report={passed:false,scope:'Local HTTPS fixtures only; no real booking requests',checks:[]};
app.setPath('userData',path.resolve('work/entry-http-smoke-'+process.pid));
let win,calls=0,delay=0;
const url='https://tickets.interpark.com/gates/ticket/26014421';
app.whenReady().then(async()=>{
  const partition=session.fromPartition('entry-http-fixture-'+process.pid);
  await partition.protocol.handle('https',async req=>{
    if(req.url===url)return new Response('<!doctype html><main><h1>예매는 오픈 시간부터 가능해요</h1><button id="entry" disabled>남은시간 00:01</button></main>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if(req.url==='https://ent-waiting-api.interpark.com/waiting/api/secure-url'){
      calls++;const n=calls;if(delay)await new Promise(r=>setTimeout(r,delay));
      return new Response(JSON.stringify(n<3&&!delay?{error:'P40057'}:{redirectUrl:'https://tickets.interpark.com/waiting?key=fixture'}),{status:n<3&&!delay?403:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    throw Error('Unexpected fixture request');
  });
  win=new BrowserWindow({show:false,webPreferences:{session:partition,backgroundThrottling:false,contextIsolation:true}});
  const evaluate=s=>win.webContents.executeJavaScript(s);
  const code=fs.readFileSync(path.resolve('extension/code-actions.js'),'utf8');
  async function fresh(){
    calls=0;await win.loadURL(url);await evaluate(code+';void 0;');
    await evaluate(`window.testClicks=0;window.testFunctions=0;window.testDestination=null;window.testError=null;
      document.addEventListener('click',()=>window.testClicks++);
      document.getElementById('entry').__reactProps$fixture={onClick:async()=>{window.testFunctions++;try{const r=await fetch('https://ent-waiting-api.interpark.com/waiting/api/secure-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:'fixture',secureData:'fixture'})});const data=await r.json();window.testDestination=data.redirectUrl;}catch(e){window.testError=String(e.message);}}};
      window.testMeta={connection:'fixture',epoch:1,expiresAt:Date.now()+5000};`);
    const lease=await evaluate(`BaseballCodeDispatch('lease',null,testMeta)`);assert.equal(lease.ok,true);
    const armed=await evaluate(`BaseballCodeDispatch('entry.armGate',{goodsCode:'26014421',runId:1,httpRetry:true},testMeta)`);assert.equal(armed.value.phase,'armed');
    const clock=await evaluate(`BaseballCodeDispatch('entry.setGateClock',{goodsCode:'26014421',runId:1,documentId:window.__bearsGate.status.documentId,source:'ticket-server',deadlineMono:performance.now()+1150,validUntilMono:performance.now()+5000,uncertaintyMs:10,openAt:Date.now()+1150},testMeta)`);assert.equal(clock.value,true);
  }
  const snapshot=()=>evaluate(`({clicks:testClicks,functions:testFunctions,destination:testDestination,error:testError,disabled:document.getElementById('entry').disabled,status:window.__bearsGate.status})`);
  await fresh();win.minimize();await new Promise(r=>setTimeout(r,600));let state=await snapshot();
  assert.equal(calls,3);assert.equal(state.clicks,0);assert.equal(state.functions,1);assert.equal(state.disabled,true);assert.equal(state.status.http.outcome,'redirect-ready');assert.ok(state.destination.includes('/waiting'));
  report.checks.push({name:'minimized conditional POST retries, no DOM clicks, one site invocation',calls,...state,status:state.status.http});
  await fresh();await evaluate(`BaseballCodeDispatch('stop',null,{...testMeta,epoch:2})`);await new Promise(r=>setTimeout(r,350));state=await snapshot();assert.equal(calls,0);assert.equal(state.destination,null);report.checks.push({name:'stop before deadline sends zero requests',calls});
  delay=200;await fresh();await new Promise(r=>setTimeout(r,220));assert.equal(calls,1);await evaluate(`BaseballCodeDispatch('stop',null,{...testMeta,epoch:2})`);await new Promise(r=>setTimeout(r,300));state=await snapshot();assert.equal(calls,1);assert.equal(state.destination,null);report.checks.push({name:'stop during response prevents navigation and retry',calls});
  report.passed=true;
}).catch(e=>{report.error=e.stack;process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.resolve('work/entry-http-smoke-v0.9.19.json'),JSON.stringify(report,null,2));win?.destroy();app.exit(report.passed?0:1);
});
