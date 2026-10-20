'use strict';
// All target HTTPS traffic is intercepted locally. No real booking is sent.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const contractFixture=require('./fixtures/gate-entry-contract.cjs');
const report={passed:false,scope:'Local HTTPS fixtures only; no real booking requests',checks:[]};
app.setPath('userData',path.resolve('work/entry-http-smoke-'+process.pid));
const watchdog=setTimeout(()=>app.exit(1),35000);
let win,calls=0,delay=0,reject=false,rejectFirst=0,rateLimit=false,earlyAuto=false;
const url='https://tickets.interpark.com/gates/ticket/26014421';
app.whenReady().then(async()=>{
 const partition=session.fromPartition('entry-http-fixture-'+process.pid);
 await partition.protocol.handle('https',async req=>{
  if(req.url===url)return new Response('<!doctype html><main><h1>예매는 오픈 시간부터 가능해요</h1><button id="entry" disabled>남은시간 00:01</button></main>'+(earlyAuto?'<script>window.mountTask=fetch("https://ent-waiting-api.interpark.com/waiting/api/secure-url",{method:"POST",body:JSON.stringify({signature:"fixture",secureData:"fixture"})}).then(r=>r.json()).then(v=>window.mountDestination=v.redirectUrl).catch(e=>window.mountError=e.message);</script>':''),{headers:{'content-type':'text/html; charset=utf-8'}});
  if(req.url.startsWith('https://tickets.interpark.com/waiting?'))return new Response('<main>Fixture queue reached</main>',{headers:{'content-type':'text/html'}});
  if(req.url==='https://ent-waiting-api.interpark.com/waiting/api/secure-url'){
   calls++;const rejected=reject||calls<=rejectFirst;if(delay)await new Promise(r=>setTimeout(r,delay));
   return new Response(JSON.stringify(rateLimit?{error:'RATE_LIMITED'}:rejected?{error:'P40057'}:{redirectUrl:'https://tickets.interpark.com/waiting?key=fixture'}),{status:rateLimit?429:rejected?403:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
  }
  throw Error('Unexpected fixture request');
 });
 win=new BrowserWindow({show:false,webPreferences:{session:partition,backgroundThrottling:false,contextIsolation:true}});
 const evaluate=s=>win.webContents.executeJavaScript(s),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const code=fs.readFileSync(path.resolve('extension/code-actions.js'),'utf8');
 async function fresh(noRequestFirst=false,early=false){
  calls=0;earlyAuto=early;let guard;
  if(early){
   if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
   await win.webContents.debugger.sendCommand('Page.enable');
   guard=await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:fs.readFileSync(path.resolve('extension/entry-early.js'),'utf8')+';BaseballEarlyEntry({goodsCode:"26014421",runId:1});'});
  }
  await win.loadURL(url);
  if(early){
   await pause(80);assert.equal(calls,0,'site mount request must wait before desktop arming');
   assert.equal(await evaluate('!!window.__ticketEarlyEntry?.http.claimed'),true);
   await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:guard.identifier});
  }
  await evaluate(code+';void 0;');
  await evaluate('window.testClicks=0;window.testFunctions=0;window.testDestination=null;window.testError=null;'+
   'document.addEventListener("click",()=>testClicks++);'+
   'window.sendEntry=async()=>{try{const r=await fetch("https://ent-waiting-api.interpark.com/waiting/api/secure-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signature:"fixture",secureData:"fixture"})});return(await r.json()).redirectUrl;}catch(e){testError=e.message;throw e;}};'+
   'window.gateFixture=('+contractFixture.toString()+')({onCall:()=>testFunctions++,get busy(){return '+(noRequestFirst===true?1:Number(noRequestFirst)||0)+'>=testFunctions;},request:sendEntry,onRedirect:path=>testDestination=path});'+
   'window.testRoot={tag:3};window.testOwner={type:gateFixture.owner,memoizedProps:{global:false},memoizedState:{memoizedState:[gateFixture.callback,[]]},return:testRoot};window.testHost={tag:5,stateNode:document.getElementById("entry"),return:testOwner};testRoot.stateNode={current:testRoot};testRoot.child=testOwner;testOwner.child=testHost;document.getElementById("entry").__reactFiber$fixture=testHost;'+
   'document.getElementById("entry").__reactProps$fixture={onClick:()=>{throw Error("The disabled UI handler must not be invoked");}};'+
   'window.testMeta={connection:"fixture",epoch:1,expiresAt:Date.now()+5000};');
  const armed=await evaluate('BaseballCodeDispatch("entry.armGate",{goodsCode:"26014421",runId:1,httpRetry:true},testMeta)');assert.equal(armed.value.phase,'armed');
  const clock=await evaluate('BaseballCodeDispatch("entry.setGateClock",{goodsCode:"26014421",runId:1,documentId:window.__bearsGate.status.documentId,source:"ticket-server",deadlineMono:performance.now()+2150,validUntilMono:performance.now()+5000,uncertaintyMs:10,openAt:Date.now()+2150},testMeta)');assert.equal(clock.value,true);
 }
 const activate=()=>evaluate('document.getElementById("entry").disabled=false;document.getElementById("entry").textContent="예매하기";void 0;');
 const snapshot=()=>evaluate('({clicks:testClicks,functions:testFunctions,destination:testDestination,error:testError,status:window.__bearsGate.status})');
 const until=async(check,label)=>{const end=Date.now()+5000;while(!await check()){if(Date.now()>end)throw Error(label+': '+JSON.stringify(await snapshot()));await pause(40);}};
 await fresh();win.minimize();await pause(80);assert.equal(calls,0,'nothing is sent before the configured deadline');await until(()=>calls===1,'scheduled disabled entry');let state=await snapshot();assert.equal(state.clicks,0);assert.equal(state.functions,1);assert.ok(state.destination.includes('/waiting'));assert.equal(await evaluate('document.getElementById("entry").disabled'),true);assert.ok(state.status.http.startedMono>=state.status.clock.deadlineMono-2000);report.checks.push({name:'scheduled original callback sends once while countdown UI remains disabled in minimized window',calls,requestDelayFromWindowStartMs:state.status.http.startedMono-(state.status.clock.deadlineMono-2000)});
 await fresh();await evaluate('void sendEntry().then(path=>testDestination=path).catch(()=>{});');await pause(70);assert.equal(calls,0);state=await snapshot();assert.equal(state.status.http.outcome,'scheduled');await until(()=>calls===1,'site auto request released at deadline');state=await snapshot();assert.equal(state.functions,0);assert.ok(state.status.http.startedMono>=state.status.clock.deadlineMono-2000);assert.equal(state.status.trigger,'server-clock');report.checks.push({name:'a site-generated early request waits for the configured deadline and suppresses a second callback',calls,functions:state.functions});
 await fresh();await evaluate('void sendEntry().then(path=>testDestination=path).catch(()=>{});');await pause(30);await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');await pause(220);state=await snapshot();assert.equal(calls,0);assert.equal(state.destination,null);report.checks.push({name:'stopping a site request waiting for the deadline sends no POST',calls});
 await fresh(true);await until(async()=>(await snapshot()).status.phase==='blocked','request-free entry stop');state=await snapshot();assert.equal(calls,0);assert.equal(state.functions,1);assert.equal(state.clicks,0);report.checks.push({name:'original in-flight guard is preserved and no request-free callback is repeated',calls,functions:state.functions});
 await fresh(10);await activate();await until(async()=>(await snapshot()).status.phase==='blocked','guarded activated entry');await pause(1100);state=await snapshot();assert.equal(calls,0);assert.equal(state.functions,1);report.checks.push({name:'later UI activation does not retry a rejected scheduled invocation',calls,functions:state.functions});
 delay=400;await fresh();await activate();await pause(220);assert.ok(calls>=2);await evaluate('void sendEntry().catch(()=>{});void sendEntry().catch(()=>{});');await until(async()=>(await snapshot()).destination!==null,'slow success');const settledCalls=calls;await pause(450);assert.equal(calls,settledCalls);state=await snapshot();assert.equal(state.functions,1);assert.equal(state.status.http.outcome,'redirect-ready');report.checks.push({name:'slow responses allow fixed-slot retries; duplicate callers share one scheduler and success stops dispatch',calls});
 delay=0;rejectFirst=3;await fresh();await until(async()=>(await snapshot()).destination!==null,'not-open then success');state=await snapshot();assert.ok(calls>=4);assert.equal(state.status.http.outcome,'redirect-ready');assert.equal(state.functions,1);report.checks.push({name:'not-open responses retry until a valid redirect',calls});rejectFirst=0;
 rateLimit=true;await fresh();await until(async()=>(await snapshot()).status.http?.outcome==='blocked','rate limit stop');const limitedCalls=calls;await pause(200);assert.equal(calls,limitedCalls);state=await snapshot();assert.equal(state.destination,null);report.checks.push({name:'rate limit stops pending requests and all future dispatch',calls});rateLimit=false;
 await fresh();await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');await activate();await pause(250);assert.equal(calls,0);report.checks.push({name:'stop before activation sends no request',calls});
 delay=400;await fresh();await activate();await pause(220);assert.ok(calls>=1);await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');const stoppedCalls=calls;await pause(500);state=await snapshot();assert.equal(calls,stoppedCalls);assert.equal(state.destination,null);report.checks.push({name:'late response after stop cannot navigate',calls});
 delay=0;await fresh();await evaluate('gateFixture=Object.assign(gateFixture,{});window.testNavigate=true;');await evaluate('void sendEntry().then(path=>location.assign(path)).catch(()=>{});');await until(()=>win.webContents.getURL().includes('/waiting?'),'actual navigation');assert.ok((await evaluate('document.body.textContent')).includes('Fixture queue reached'));report.checks.push({name:'successful response reaches the next waiting page through real browser navigation',calls});
 await fresh(false,true);await pause(70);assert.equal(calls,0);await until(()=>calls>0,'held mount request');await until(async()=>!!await evaluate('window.mountDestination'),'mount response delivered');state=await snapshot();assert.equal(state.functions,0);assert.ok(state.status.http.startedMono>=state.status.clock.deadlineMono-2000);assert.ok(state.status.http.startedMono<=state.status.clock.deadlineMono+2000);report.checks.push({name:'document-start guard holds the site mount request before desktop arming, then releases it inside the fixed opening window',calls,functions:state.functions});
 await fresh(false,true);await evaluate('BaseballCodeDispatch("stop",null,{...testMeta,epoch:2})');await pause(250);assert.equal(calls,0);assert.equal(await evaluate('window.mountDestination||null'),null);report.checks.push({name:'stop cancels a document-start mount request without navigation',calls});
 report.window={beforeMs:2000,afterMs:2000,intervalMs:30};
 report.passed=true;
}).catch(e=>{report.error=e.stack;}).finally(()=>{
 clearTimeout(watchdog);fs.writeFileSync(path.resolve('work/entry-http-smoke-v'+require('../package.json').version+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win?.destroy();app.exit(report.passed?0:1);
});
