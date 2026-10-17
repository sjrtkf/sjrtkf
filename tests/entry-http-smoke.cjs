'use strict';
// All target HTTPS traffic is intercepted locally. No real booking is sent.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const report={passed:false,scope:'Local HTTPS fixtures only; no real booking requests',checks:[]};
app.setPath('userData',path.resolve('work/entry-http-smoke-'+process.pid));
const watchdog=setTimeout(()=>app.exit(1),25000);
let win,calls=0,delay=0,reject=false;
const url='https://tickets.interpark.com/gates/ticket/26014421';
app.whenReady().then(async()=>{
 const partition=session.fromPartition('entry-http-fixture-'+process.pid);
 await partition.protocol.handle('https',async req=>{
  if(req.url===url)return new Response('<!doctype html><main><h1>예매는 오픈 시간부터 가능해요</h1><button id="entry" disabled>남은시간 00:01</button></main>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(req.url==='https://ent-waiting-api.interpark.com/waiting/api/secure-url'){
   calls++;if(delay)await new Promise(r=>setTimeout(r,delay));
   return new Response(JSON.stringify(reject?{error:'P40057'}:{redirectUrl:'https://tickets.interpark.com/waiting?key=fixture'}),{status:reject?403:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
  }
  throw Error('Unexpected fixture request');
 });
 win=new BrowserWindow({show:false,webPreferences:{session:partition,backgroundThrottling:false,contextIsolation:true}});
 const evaluate=s=>win.webContents.executeJavaScript(s),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const code=fs.readFileSync(path.resolve('extension/code-actions.js'),'utf8');
 async function fresh(noRequestFirst=false){
  calls=0;await win.loadURL(url);await evaluate(code+';void 0;');
  await evaluate('window.testClicks=0;window.testFunctions=0;window.testDestination=null;window.testError=null;'+
   'document.addEventListener("click",()=>testClicks++);'+
   'window.sendEntry=async()=>{try{const r=await fetch("https://ent-waiting-api.interpark.com/waiting/api/secure-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signature:"fixture",secureData:"fixture"})});testDestination=(await r.json()).redirectUrl;}catch(e){testError=e.message;}};'+
   'document.getElementById("entry").__reactProps$fixture={onClick:async()=>{testFunctions++;if('+(noRequestFirst===true?1:Number(noRequestFirst)||0)+'>=testFunctions)return;await sendEntry();}};'+
   'window.testMeta={connection:"fixture",epoch:1,expiresAt:Date.now()+5000};');
  const armed=await evaluate('BaseballCodeDispatch("entry.armGate",{goodsCode:"26014421",runId:1,httpRetry:true},testMeta)');assert.equal(armed.value.phase,'armed');
  const clock=await evaluate('BaseballCodeDispatch("entry.setGateClock",{goodsCode:"26014421",runId:1,documentId:window.__bearsGate.status.documentId,source:"ticket-server",deadlineMono:performance.now()+150,validUntilMono:performance.now()+5000,uncertaintyMs:10,openAt:Date.now()+150},testMeta)');assert.equal(clock.value,true);
 }
 const activate=()=>evaluate('document.getElementById("entry").disabled=false;document.getElementById("entry").textContent="예매하기";void 0;');
 const snapshot=()=>evaluate('({clicks:testClicks,functions:testFunctions,destination:testDestination,error:testError,status:window.__bearsGate.status})');
 await fresh();win.minimize();await pause(220);assert.equal(calls,0,'clock alone must not bypass disabled button');await activate();await pause(120);let state=await snapshot();assert.equal(calls,1);assert.equal(state.clicks,0);assert.equal(state.functions,1);assert.ok(state.destination.includes('/waiting'));report.checks.push({name:'late natural activation in minimized window sends once without DOM input',calls});
 await fresh(true);await activate();await pause(350);assert.equal(calls,0);await pause(1000);state=await snapshot();assert.equal(calls,1);assert.equal(state.functions,2);assert.equal(state.clicks,0);report.checks.push({name:'site guard returns without request; cooldown recovers with one POST',calls,functions:state.functions});
 await fresh(10);await activate();await pause(2400);state=await snapshot();assert.equal(calls,0);assert.equal(state.functions,3);assert.equal(state.status.phase,'blocked');report.checks.push({name:'repeated request-free returns stop after three function calls',calls,functions:state.functions});
 delay=400;await fresh();await activate();await pause(220);assert.equal(calls,1);await evaluate('void sendEntry();void sendEntry();');await pause(500);assert.equal(calls,1);report.checks.push({name:'slow response and duplicate callers share one network operation',calls});
 delay=0;reject=true;await fresh();await activate();await pause(1400);state=await snapshot();assert.equal(calls,1);assert.equal(state.status.http.outcome,'not-open');assert.equal(state.destination,null);report.checks.push({name:'unverified opening rejection is never replayed',calls});reject=false;
 await fresh();await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');await activate();await pause(250);assert.equal(calls,0);report.checks.push({name:'stop before activation sends no request',calls});
 delay=400;await fresh();await activate();await pause(220);assert.equal(calls,1);await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');await pause(500);state=await snapshot();assert.equal(calls,1);assert.equal(state.destination,null);report.checks.push({name:'late response after stop cannot navigate',calls});
 report.passed=true;
}).catch(e=>{report.error=e.stack;}).finally(()=>{
 clearTimeout(watchdog);fs.writeFileSync(path.resolve('work/entry-http-smoke-v0.9.20.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win?.destroy();app.exit(report.passed?0:1);
});
