'use strict';
// Every HTTP(S) request belongs to this isolated renderer fixture. No booking,
// CAPTCHA, seat hold, or live server request is performed.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const flow=require('../src/flow'),live=require('../src/live-adapter');
const {invokeSiteFunction}=require('../src/site-code'),{codeRuntime}=require('../src/code-runtime');
const {pageActions}=require('../src/chrome-target');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const output=path.join(root,'work',`notice-seat-smoke-v${version}.json`);
const fixtureUrl='https://tickets.interpark.com/onestop/seat';
const report={passed:false,version,scope:'Hidden isolated Chromium DOM with production notice dispatch and seat-change observers; all HTTP(S) intercepted locally',checks:[],unexpectedRequests:[],limitations:[
  'These are local renderer fixtures, not a live-site or Chrome-extension transport test.',
  'The fixture acknowledgement handler only records invocations and sends no booking request.',
  'Wake timings are local test observations and do not measure ticket-entry or server latency.'
]};
const seatViewBody='※ 시야방해석 안내\n경기장 구조로 인해 시야 방해가 있을 수 있으며, 이미지 내 별도 표시된 좌석은 시야방해석으로 관람하시기에 불편이 있을 수 있습니다.\n취소 기간 이후, 시야 방해로 인한 취소는 불가능하며 세부사항은 예매안내 유의사항을 참고하여 주시기 바랍니다.';
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Local notice and seat fixture</title><body>
<section id="notice" role="dialog" aria-modal="true"><span id="title">예매 안내</span><p id="guidance"></p><button id="acknowledge">확인하고 예매하기</button></section>
<script>
window.fixture={calls:[],events:0,waitResult:null};
HTMLElement.prototype.click=function(){fixture.events++;throw Error('DOM clicks are forbidden in this fixture');};
const dispatch=EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent=function(event){if(/^(click|pointer|mouse|input|change|key)/.test(event.type)){fixture.events++;throw Error('Input events are forbidden in this fixture');}return dispatch.call(this,event);};
document.addEventListener('click',()=>fixture.events++);
window.bindNotice=()=>{const button=document.getElementById('acknowledge');button.__reactProps$fixture={onClick:()=>{fixture.calls.push({at:performance.now(),body:document.getElementById('guidance').textContent});}};};
bindNotice();
</script></body></html>`;
fs.mkdirSync(path.dirname(output),{recursive:true});
app.setPath('userData',path.join(root,'work','notice-seat-smoke-profile-'+process.pid));
let win,finished=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function finish(error){
  if(finished)return;finished=true;clearTimeout(watchdog);
  if(error)report.error=error.stack||String(error);
  report.window=win?{visible:win.isVisible(),minimized:win.isMinimized()}:null;
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));win?.destroy();app.exit(report.passed?0:1);
}
const watchdog=setTimeout(()=>finish(Error('Notice/seat smoke exceeded 30 seconds')),30000);
app.whenReady().then(async()=>{
  const partition=session.fromPartition('notice-seat-fixture-'+process.pid);
  const intercept=request=>{
    const url=new URL(request.url);
    if(request.method==='GET'&&request.url===fixtureUrl)return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(url.pathname==='/favicon.ico')return new Response(null,{status:204});
    report.unexpectedRequests.push({method:request.method,url:request.url});
    return new Response('Local fixture rejected this request',{status:403});
  };
  await partition.protocol.handle('https',intercept);await partition.protocol.handle('http',intercept);
  partition.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win=new BrowserWindow({show:false,webPreferences:{session:partition,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await win.loadURL(fixtureUrl);win.minimize();
  const evaluate=source=>win.webContents.executeJavaScript(source);
  // This is the same dispatcher and registered component handler invocation as
  // the static extension bundle, without a concurrent extension-build step.
  await evaluate(`window.NoticeDispatch=(action,arg,meta)=>{
    const invoke=${invokeSiteFunction.toString()},runtime=${codeRuntime.toString()};
    return runtime(action,arg,meta,invoke,siteInvoke=>({'flow.scene':${flow.scene.toString()},'flow.clickKnown':${flow.clickKnown.toString()}}));
  };window.SeatFixtureActions={read:${live.liveRead.toString()},wait:${live.waitForChange.toString()},stop:${pageActions.stopWatchers.toString()}};void 0;`);
  const command=(action,arg)=>evaluate(`NoticeDispatch(${JSON.stringify(action)},${JSON.stringify(arg)??'null'},${JSON.stringify({connection:'notice-seat-smoke',epoch:1,expiresAt:Date.now()+5000})})`);
  const state=()=>evaluate('({calls:fixture.calls.length,events:fixture.events,waitResult:fixture.waitResult,revision:window.__ticketSeatChanges?.revision??null,listeners:window.__ticketSeatChanges?.listeners.size??null})');
  async function until(predicate,label,timeoutMs=2000){
    const deadline=Date.now()+timeoutMs;
    while(!await predicate()){assert.ok(Date.now()<deadline,'Timed out: '+label);await pause(10);}
  }
  await evaluate(`document.getElementById('guidance').textContent=${JSON.stringify(seatViewBody)};void 0;`);
  const initial=(await command('flow.scene')).notice;
  assert.equal(initial.present,true);assert.equal(initial.enabled,true);assert.equal(initial.key,'예매안내');assert.ok(initial.signature);
  const first=await command('flow.clickKnown','확인하고 예매하기');
  assert.equal(first.clicked,true);assert.equal(first.signature,initial.signature);assert.equal((await state()).calls,1);
  report.checks.push({name:'The attached seat-view guidance is recognized in real plain-title DOM and invokes its registered handler once',calls:1});

  const secondBody='N석 응원석 / 테이블석 / 데크존 / 원정석 예매 유의사항';
  await evaluate(`document.getElementById('guidance').textContent=${JSON.stringify(secondBody)};void 0;`);
  const next=(await command('flow.scene')).notice,second=await command('flow.clickKnown','확인하고 예매하기');
  assert.equal(next.key,initial.key);assert.notEqual(next.signature,initial.signature);assert.equal(second.signature,next.signature);assert.equal(second.clicked,true);assert.equal((await state()).calls,2);
  report.checks.push({name:'A distinct subsequent notice with the same title invokes its handler once',calls:2});

  await evaluate(`document.getElementById('guidance').textContent=${JSON.stringify(secondBody.replaceAll(' ','\n  '))};const prior=document.getElementById('acknowledge');prior.replaceWith(prior.cloneNode(true));bindNotice();void 0;`);
  assert.equal((await command('flow.scene')).notice.signature,second.signature);
  assert.equal((await command('flow.clickKnown','확인하고 예매하기')).pending,true);
  await evaluate(`document.getElementById('guidance').textContent=${JSON.stringify(seatViewBody)};void 0;`);
  assert.equal((await command('flow.clickKnown','확인하고 예매하기')).pending,true);assert.equal((await state()).calls,2);
  report.checks.push({name:'Whitespace changes, button replacement and returning to prior contents do not repeat either notice',calls:2});

  await evaluate(`document.getElementById('notice').remove();document.body.insertAdjacentHTML('beforeend','<p id="countdown">남은 시간 10:00</p><button class="SportsSeatGradeList_contentItem__fixture"><span class="SportsSeatGradeList_contentGradeName__fixture">일반석</span><span class="SportsSeatGradeList_contentRemainCount__fixture" id="remaining">0</span></button>');void 0;`);
  assert.equal((await command('flow.scene')).notice.present,false);
  const inventory=await evaluate('SeatFixtureActions.read()');
  assert.equal(inventory.rows.length,1);assert.equal(inventory.rows[0].kind,'grade');assert.equal(inventory.rows[0].available,false);assert.equal(inventory.rows[0].count,'0');
  report.checks.push({name:'A grade-only zero-count screen creates a valid inventory revision with no seat candidates',revision:inventory.revision});
  await evaluate(`fixture.waitResult=null;SeatFixtureActions.wait({revision:${inventory.revision},timeoutMs:5000}).then(result=>{fixture.waitResult={...result,resolvedAt:performance.now()};});void 0;`);
  assert.equal((await state()).listeners,1);
  await evaluate(`for(let i=0;i<20;i++)document.getElementById('countdown').textContent='남은 시간 09:'+String(59-i);void 0;`);
  await pause(150);let current=await state();assert.equal(current.waitResult,null);assert.equal(current.revision,inventory.revision);assert.equal(current.listeners,1);
  report.checks.push({name:'Unrelated countdown text mutations do not wake the inventory wait or increase its revision',revision:current.revision});

  await evaluate(`fixture.changedAt=performance.now();document.getElementById('remaining').textContent='2';void 0;`);
  await until(async()=>!!(await state()).waitResult,'grade inventory change wake');
  current=await state();assert.equal(current.waitResult.changed,true);assert.equal(current.waitResult.stopped,false);assert.equal(current.revision,inventory.revision+1);assert.equal(current.listeners,0);
  const gradeWakeMs=await evaluate('fixture.waitResult.resolvedAt-fixture.changedAt');
  assert.ok(gradeWakeMs<2000,'Inventory mutation must wake before the 5-second fallback');
  report.checks.push({name:'Changing the visible grade count wakes the pending inventory wait before its fallback timer',changed:true,wakeMs:gradeWakeMs});

  await evaluate(`fixture.waitResult=null;SeatFixtureActions.wait({revision:${current.revision},timeoutMs:5000}).then(result=>{fixture.waitResult={...result,resolvedAt:performance.now()};});void 0;`);
  assert.equal((await state()).listeners,1);
  await evaluate('fixture.stoppedAt=performance.now();SeatFixtureActions.stop();void 0;');
  await until(async()=>!!(await state()).waitResult,'stop releases pending inventory wait');
  current=await state();assert.equal(current.waitResult.stopped,true);assert.equal(current.waitResult.changed,false);assert.equal(current.revision,null);assert.equal(current.listeners,null);
  const stopWakeMs=await evaluate('fixture.waitResult.resolvedAt-fixture.stoppedAt');
  assert.ok(stopWakeMs<2000,'Stop must release the wait before its 5-second fallback');
  report.checks.push({name:'Stopping immediately releases the pending wait and disconnects the observer',stopped:true,wakeMs:stopWakeMs});
  assert.equal(current.events,0);report.domInputEvents=current.events;report.liveRequests=0;
  assert.deepEqual(report.unexpectedRequests,[]);assert.equal(win.isVisible(),false);report.passed=true;
}).then(()=>finish(),finish);
