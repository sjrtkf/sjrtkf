'use strict';
// All HTTP(S) is served by this isolated session. No real ticket request is sent.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const output=path.join(root,'work',`listing-entry-smoke-v${version}.json`);
const origin='https://nol.yanolja.com',listingUrl=origin+'/ticket/genre/sports/listing-fixture';
const key='10월 19일 | 홈 vs 원정';
const report={passed:false,version,scope:'Isolated local HTTPS fixtures only; no real booking or live-site requests',checks:[],latencySamples:[],unexpectedRequests:[],windowStates:[],windowEvents:[],limitations:[
  'Hidden/minimized Electron Chromium verifies renderer observers and MAIN-world dispatch; it does not measure a live Chrome extension bridge or a production server.',
  'Activation timings are local fixture measurements, not a promise of production ticket-entry latency.',
  'Stopping prevents future watcher invocations; an already invoked site handler may retain its own asynchronous side effects.'
]};
fs.mkdirSync(path.dirname(output),{recursive:true});
app.setPath('userData',path.join(root,'work','listing-entry-smoke-profile-'+process.pid));
let win,finished=false,preparationRequests=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function finish(error){
  if(finished)return;finished=true;clearTimeout(watchdog);
  if(error)report.error=error.stack||String(error);
  const samples=report.latencySamples.filter(s=>!s.clockRequired).map(s=>s.activationToInvocationMs).sort((a,b)=>a-b);
  report.latency={scope:'Activation-to-invocation, excluding deliberate clock-gated waits',samples:samples.length,medianMs:samples.length?(samples[Math.floor((samples.length-1)/2)]+samples[Math.floor(samples.length/2)])/2:null,p95Ms:samples.length?samples[Math.ceil(samples.length*.95)-1]:null,maxMs:samples.length?samples.at(-1):null};
  report.window=win?{visible:win.isVisible(),minimized:win.isMinimized()}:null;
  report.preparationRequests=preparationRequests;
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));win?.destroy();app.exit(report.passed?0:1);
}
const watchdog=setTimeout(()=>finish(Error('Listing-entry smoke exceeded 30 seconds')),30000);
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Local listing fixture</title><body>
<section id="target-card"><div class="grid-area_info">10월 19일</div><div class="grid-area_match"><img alt="홈"><img alt="원정"></div><button class="grid-area_cta" id="target" disabled>오픈 예정</button></section>
<section id="other-card"><div class="grid-area_info">10월 20일</div><div class="grid-area_match"><img alt="홈"><img alt="다른팀"></div><button class="grid-area_cta" id="other" disabled>오픈 예정</button></section>
<script>
window.fixture={calls:[],events:0,unhandled:[],activatedAt:null,mode:'normal'};
window.addEventListener('unhandledrejection',e=>{fixture.unhandled.push(String(e.reason));e.preventDefault();});
HTMLElement.prototype.click=function(){fixture.events++;throw Error('Fixture forbids DOM click');};
const nativeDispatch=EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent=function(event){if(/^(click|pointer|mouse|input|change|key)/.test(event.type)){fixture.events++;throw Error('Fixture forbids DOM input events');}return nativeDispatch.call(this,event);};
document.addEventListener('click',()=>fixture.events++);
window.bindFixtureButton=button=>{button.__reactProps$fixture={onClick:async()=>{
  fixture.calls.push({id:button.id,at:performance.now(),activatedAt:fixture.activatedAt});
  if(fixture.mode==='reject'){await new Promise(r=>setTimeout(r,35));throw Error('Intentional asynchronous fixture failure');}
  if(fixture.mode==='delayed-navigation'){
    const response=await fetch('/fixture/preparation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result=await response.json();location.href=result.destination;
  }
}};};
window.activateFixtureButton=(id='target')=>{const button=document.getElementById(id);fixture.activatedAt=performance.now();button.disabled=false;button.setAttribute('aria-disabled','false');button.textContent='예매하기';};
window.replaceFixtureButton=()=>{const old=document.getElementById('target'),button=document.createElement('button');button.id='target';button.className='grid-area_cta';button.textContent='예매하기';bindFixtureButton(button);fixture.activatedAt=performance.now();old.replaceWith(button);};
bindFixtureButton(document.getElementById('target'));bindFixtureButton(document.getElementById('other'));
</script></body></html>`;

app.whenReady().then(async()=>{
  const partition=session.fromPartition('listing-entry-fixture-'+process.pid);
  const intercept=async request=>{
    const url=new URL(request.url);
    if(request.url===listingUrl&&request.method==='GET')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(url.origin===origin&&url.pathname==='/fixture/preparation'&&request.method==='POST'){
      preparationRequests++;await pause(450);
      return new Response(JSON.stringify({destination:'https://tickets.interpark.com/gates/ticket/26009123'}),{headers:{'Content-Type':'application/json'}});
    }
    if(request.url==='https://tickets.interpark.com/gates/ticket/26009123'&&request.method==='GET')return new Response('<!doctype html><main id="destination">격리된 준비 화면</main>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(url.pathname==='/favicon.ico')return new Response(null,{status:204});
    report.unexpectedRequests.push({method:request.method,url:request.url});
    return new Response('Local fixture rejected this request',{status:403});
  };
  await partition.protocol.handle('https',intercept);
  await partition.protocol.handle('http',intercept);
  partition.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win=new BrowserWindow({show:false,webPreferences:{session:partition,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  const windowState=label=>report.windowStates.push({label,at:Date.now(),visible:win.isVisible(),minimized:win.isMinimized()});
  for(const event of ['show','hide','minimize','restore','focus','blur'])win.on(event,()=>report.windowEvents.push({event,at:Date.now(),visible:win.isVisible(),minimized:win.isMinimized()}));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const code=fs.readFileSync(path.join(root,'extension','code-actions.js'),'utf8');
  assert.ok(code.includes('"entry.armListing"')&&code.includes('"entry.setListingClock"'),'Run the extension build after adding listing actions');
  const evaluate=source=>win.webContents.executeJavaScript(source);
  let epoch=1,runId='',clockRequired=false;
  const command=async(action,arg)=>{
    const meta={connection:'listing-smoke',epoch,expiresAt:Date.now()+5000};
    const result=await evaluate(`BaseballCodeDispatch(${JSON.stringify(action)},${JSON.stringify(arg)??'null'},${JSON.stringify(meta)})`);
    assert.equal(result.ok,true,`${action}: ${result.code||'dispatch failed'}`);return result.value;
  };
  const snapshot=()=>evaluate('({calls:fixture.calls,events:fixture.events,unhandled:fixture.unhandled,status:window.__bearsEntry?.status,controlError:window.__ticketSiteCode?.error})');
  async function until(predicate,label,timeoutMs=2500){
    const end=Date.now()+timeoutMs;
    while(!await predicate()){assert.ok(Date.now()<end,'Timed out: '+label);await pause(15);}
  }
  async function fresh(name,options={}){
    epoch=1;runId=name;clockRequired=!!options.clockRequired;await win.loadURL(listingUrl);await evaluate(code+';void 0;');windowState(name+':before-minimize');
    if(!win.isMinimized())win.minimize();if(win.isVisible())win.hide();
    await until(()=>win.isMinimized()&&!win.isVisible(),'fixture is hidden and minimized before arming');windowState(name+':ready');
    if(options.mode)await evaluate(`fixture.mode=${JSON.stringify(options.mode)};void 0;`);
    const state=await command('entry.armListing',{key,runId,clockRequired:!!options.clockRequired,timeoutMs:5000});
    assert.equal(state.phase,'armed');assert.equal(state.key,key);assert.equal(state.runId,runId);assert.equal(typeof state.documentId,'string');
    return state;
  }
  async function calls(count){await until(async()=>((await snapshot()).calls.length===count),'site function count '+count);return snapshot();}
  function verify(state,count=1){assert.equal(state.calls.length,count);assert.equal(state.events,0,'No DOM input event may be emitted');assert.deepEqual(state.unhandled,[],'Handler rejections must be handled');}
  function record(name,state,extra={}){
    windowState(name+':verified');
    assert.equal(win.isVisible(),false,'Fixture must remain hidden throughout the scenario');assert.equal(win.isMinimized(),true,'Fixture must remain minimized throughout the scenario');
    verify(state);const invocation=state.calls[0];
    if(Number.isFinite(invocation.activatedAt))report.latencySamples.push({name,clockRequired,activationToInvocationMs:invocation.at-invocation.activatedAt,reportedInvokeDelayMs:state.status.invokeDelayMs??null,trigger:state.status.trigger});
    report.checks.push({name,calls:state.calls.length,phase:state.status.phase,domInputEvents:state.events,...extra});
  }
  async function clock({afterMs=180,validForMs=2000,...overrides}={}){
    const now=await evaluate('performance.now()'),state=await snapshot();
    return command('entry.setListingClock',{key,runId,documentId:state.status.documentId,source:'ticket-server',deadlineMono:now+afterMs,validUntilMono:now+validForMs,uncertaintyMs:10,openAt:Date.now()+afterMs,...overrides});
  }

  await fresh('natural-activation');await pause(280);verify(await snapshot(),0);
  await evaluate('activateFixtureButton();void 0;');let state=await calls(1);
  await command('entry.armListing',{key,runId});
  await evaluate('for(let i=0;i<12;i++)document.body.setAttribute("data-fixture",String(i));void 0;');await pause(300);
  state=await snapshot();assert.equal(state.calls[0].id,'target');assert.equal(state.status.phase,'clicked');record('Natural disabled-to-enabled activation runs once in a hidden minimized window',state);

  await fresh('button-replacement');await evaluate('replaceFixtureButton();void 0;');state=await calls(1);await pause(280);state=await snapshot();record('Replacing the selected button uses the current handler once',state);

  await fresh('different-game');await evaluate('activateFixtureButton("other");void 0;');await pause(280);verify(await snapshot(),0);
  await evaluate('activateFixtureButton();void 0;');state=await calls(1);assert.equal(state.calls[0].id,'target');record('Another enabled game never triggers the selected watcher',state);

  await fresh('stopped-run');epoch++;await command('stop');await evaluate('activateFixtureButton();void 0;');await pause(280);state=await snapshot();verify(state,0);assert.equal(state.status.phase,'stopped');
  await evaluate('document.getElementById("target").disabled=true;document.getElementById("target").textContent="오픈 예정";void 0;');
  runId='restarted-run';epoch++;await command('entry.armListing',{key,runId});await evaluate('activateFixtureButton();void 0;');state=await calls(1);assert.equal(state.status.runId,runId);record('Stop suppresses late activation and an explicit new run restarts',state);

  await fresh('async-handler-rejection',{mode:'reject'});await evaluate('activateFixtureButton();void 0;');await until(async()=>((await snapshot()).status.phase==='blocked'),'asynchronous handler failure becomes blocked');await pause(280);
  state=await snapshot();assert.equal(state.controlError,'SITE_FUNCTION_FAILED');record('An asynchronous site-handler failure is caught and never retried',state);

  await fresh('required-clock',{clockRequired:true});await evaluate('activateFixtureButton();void 0;');await pause(100);verify(await snapshot(),0);
  assert.equal(await clock({runId:'old-run'}),false);assert.equal(await clock({documentId:'old-document'}),false);
  assert.equal(await clock({afterMs:250}),true);await pause(80);verify(await snapshot(),0);state=await calls(1);record('A required matching clock and its deadline both gate an active button',state);

  await fresh('expired-clock',{clockRequired:true});assert.equal(await clock({afterMs:40,validForMs:70}),true);await pause(130);await evaluate('activateFixtureButton();void 0;');await pause(100);state=await snapshot();verify(state,0);
  assert.equal(await clock({afterMs:40}),true);state=await calls(1);record('An expired clock blocks activation until a fresh clock is provided',state);

  await fresh('delayed-navigation',{mode:'delayed-navigation'});await evaluate('activateFixtureButton();void 0;');state=await calls(1);await pause(180);state=await snapshot();assert.equal(win.webContents.getURL(),listingUrl);record('A slow preparation response does not cause another invocation',state);
  await until(()=>win.webContents.getURL()==='https://tickets.interpark.com/gates/ticket/26009123'&&!win.webContents.isLoading(),'delayed fixture navigation');
  assert.equal(preparationRequests,1);assert.equal(await evaluate('!!document.getElementById("destination")'),true);
  report.checks.push({name:'The delayed handler reaches the intercepted preparation page',preparationRequests,liveRequests:0});
  assert.deepEqual(report.unexpectedRequests,[]);assert.equal(win.isVisible(),false);assert.equal(win.isMinimized(),true);report.passed=true;
}).then(()=>finish(),finish);
