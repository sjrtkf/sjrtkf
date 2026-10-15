'use strict';
const {app, BrowserWindow, WebContentsView, ipcMain, session, net, powerSaveBlocker} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {performance}=require('node:perf_hooks');
const {DEMO_PROFILE, isHttps, scanScript, actionScript} = require('./seat-core');
const liveAdapter = require('./live-adapter');
const {normalizePreferences,rankGroups,gradePlan}=require('./preferences');
const {parseOpening,clockSample,bestClock,serverClockSample,clockForGate,SERVER_TIME_URL}=require('./timing');
const {RunControl,pause}=require('./run-control');
const selection=require('./selection');
const seatNetwork=require('./seat-network');
const entry=require('./entry');
const entryNetwork=require('./entry-network');
const metadata=require('./metadata');
const flow=require('./flow');
const HOME = 'https://nol.yanolja.com/ticket/genre/sports/bears';
const DEMO = pathToFileURL(path.join(__dirname, 'demo.html')).href;
const SHELL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const smoke = process.argv.includes('--smoke-test');
const ENTRY_FIXTURE=pathToFileURL(path.join(__dirname,'../tests/entry-fixture.html')).href;
const isEntryPage=url=>url===HOME||(smoke&&url===ENTRY_FIXTURE);
// Keep this portable app's browser data beside the executable, outside the app source.
const dataRoot = app.isPackaged ? path.join(path.dirname(process.execPath), 'user-data') : path.join(app.getAppPath(), 'work', smoke ? `test-profile-${process.pid}` : 'profile');
app.setPath('userData', dataRoot);
let win, view, active, mainId, closing=false, revision = 0;
let preferences=normalizePreferences(),clockInfo=null,runner=null,powerId=null;
const runs=new RunControl();let lastRun=null;
const preferencesPath=path.join(dataRoot,'preferences.json');
try{preferences=normalizePreferences(JSON.parse(fs.readFileSync(preferencesPath,'utf8')));}catch{}
const targets = new Map(), seatRefs = new Map();
const metaStores=new Map(),gradeStores=new Map(),networkStores=new Map(),scopeVersions=new Map();
let nextSeat = 0;
function state(message) {
  if (closing || !win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  win.webContents.send('helper:state', {message, target: active, revision,preferences,clockInfo,running:!!runner,runStatus:runner?.status,
    entry:runner?.entry,lastRun,windows: [...targets.values()].filter(w => !w.isDestroyed()).map(w => ({id:w.id, title:w.getTitle() || '예매 페이지', url:w.getURL()}))});
}
function current() { const wc = targets.get(active); if (!wc || wc.isDestroyed()) throw new Error('예매 창을 먼저 열어 주세요.'); return wc; }
function invalidate(message) { revision++; seatRefs.clear(); state(message); }
function track(wc) {
  if(!wc||wc.isDestroyed())return;
  const wcId=wc.id;
  targets.set(wcId, wc);
  metaStores.set(wcId,new Map());gradeStores.set(wcId,new Map());
  scopeVersions.set(wcId,0);
  metadata.attachMetadata(wc,rows=>{const store=metaStores.get(wcId);if(store)for(const row of rows)store.set(row.id,row);},rows=>{const store=gradeStores.get(wcId);if(store)for(const row of rows)store.set(row.code,row.name);},text=>state(text),()=>{
    metaStores.get(wcId)?.clear();gradeStores.get(wcId)?.clear();scopeVersions.set(wcId,(scopeVersions.get(wcId)||0)+1);
  });
  networkStores.set(wcId,seatNetwork.attach(wc));
  entryNetwork.attach(wc,event=>{
    const run=runner;if(!run||run.kind!=='auto'||!run.windowIds.has(wcId)||!run.entry)return;
    if(event.kind==='observer-lost'){if(run.targetId===wcId){run.entry.observerLost=true;state();}return;}
    const key=wcId+':'+event.seq;
    if(event.kind==='request'){
      if(run.targetId!==wcId)return;
      run.entryRequests.add(key);run.entry.requestCount++;
      // Stop our pending triggers when the site itself has already requested entry.
      void js(wc,entry.noteGateRequest,{runId:run.id}).then(status=>rememberGate(run,status)).catch(()=>{});
    }else if(run.entryRequests.has(key)){
      if(event.kind==='finished')run.entry.receivedCount++;
      if(event.kind==='failed')run.entry.failedCount++;
      if(Number.isFinite(event.durationMs))run.entry.lastRequestDurationMs=event.durationMs;
    }
    state();
  });
  wc.setWindowOpenHandler(({url}) => ({action: isHttps(url) || url === 'about:blank' ? 'allow' : 'deny', overrideBrowserWindowOptions: {
    width:1100, height:850, autoHideMenuBar:true, webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false, partition:'persist:ticket'}
  }}));
  wc.on('did-create-window', child => { const childWc=child?.webContents;if(!childWc||childWc.isDestroyed())return;const childId=childWc.id;track(childWc);if(!runner||runs.adopt(wcId,childId))active=childId;invalidate('새 예매 창을 열었습니다.'); });
  wc.on('will-navigate', (e,url) => { if (!isHttps(url) && url !== DEMO) e.preventDefault(); });
  wc.on('will-redirect', (e,url) => { if (!isHttps(url)) e.preventDefault(); });
  wc.on('did-start-navigation', (_e,_url,_inPlace,isMainFrame) => { if (isMainFrame) invalidate('페이지 이동 중 · 좌석 목록을 초기화했습니다.'); });
  wc.on('dom-ready',()=>{
    const run=runner;if(!run||run.signal.aborted||run.kind!=='auto'||run.targetId!==wcId)return;
    const match=wc.getURL().match(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/(\d{8})(?:[?#]|$)/);
    if(!match||run.goodsCode&&run.goodsCode!==match[1]||run.entry.trigger||run.entry.requestCount)return;
    try{pinGateDocument(run,wc);}catch{return;}
    run.goodsCode=match[1];
    // Install the existing observer at page readiness, without waiting for the main polling loop.
    void runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)}).then(status=>rememberGate(run,status)).catch(()=>{});
  });
  wc.on('did-finish-load', () => {if(!wc.isDestroyed()){if(wc.getURL()===DEMO)seedDemo(wcId);state(wc.getURL() === DEMO ? '연습 모드 · 실제 예매와 무관한 가상 좌석입니다.' : '페이지 준비 완료 · 사이트에서 경기와 회차를 선택해 주세요.');}});
  wc.on('page-title-updated', () => state());
  wc.on('did-fail-load', (_e,code) => { if (code !== -3) state('페이지를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 열어 주세요.'); });
  wc.on('destroyed', () => { if(runner?.targetId===wcId)void stopRun('실행 대상 창이 닫혀 중지했습니다.');targets.delete(wcId);metaStores.delete(wcId);gradeStores.delete(wcId);networkStores.delete(wcId);scopeVersions.delete(wcId);if(active === wcId)active=targets.has(mainId)?mainId:[...targets.keys()][0];if(closing)return;invalidate('예매 창이 닫혔습니다.'); });
}
function seedDemo(id){const store=metaStores.get(id);if(store)for(const s of metadata.parseMetadata(require('./demo-data')))store.set(s.id,s);}
async function scan() {
  const wc = current();
  seatRefs.clear();
  const version = ++revision;
  const scopeVersion=scopeVersions.get(wc.id);
  if (liveAdapter.supportedUrl(wc.getURL())||wc.getURL()===DEMO) {
    const data=await wc.executeJavaScriptInIsolatedWorld(1001,[{code:liveAdapter.readScript()}]);
    if(version!==revision||wc.id!==active||scopeVersion!==scopeVersions.get(wc.id))throw new Error('화면이 변경되었습니다. 다시 확인해 주세요.');
    const rows=metadata.enrich(data.rows,metaStores.get(wc.id),gradeStores.get(wc.id));
    const seats=rows.map(row=>{const key=String(++nextSeat);seatRefs.set(key,{live:true,row,wcId:wc.id,revision,url:wc.getURL(),created:Date.now()});return {...row,key};});
    return {seats,revision,supported:true,message:data.message};
  }
  if (wc.getURL() !== DEMO) return {seats:[], revision, supported:false, message:'경기의 예매하기 → 보안문자 입력 → 구역 선택으로 진행한 뒤 좌석을 확인해 주세요.'};
  const frames = [wc.mainFrame];
  const seats = [];
  for (const frame of frames) {
    if (frame.url !== DEMO) continue;
    const rows = await wc.executeJavaScriptInIsolatedWorld(1001, [{code:scanScript(DEMO_PROFILE)}]);
    if (version !== revision || wc.id !== active) throw new Error('화면이 변경되었습니다. 다시 확인해 주세요.');
    for (const row of rows) if (row.available) {
      const key = String(++nextSeat);
      seatRefs.set(key, {frame, row, wcId:wc.id, revision, url:frame.url,created:Date.now()});
      seats.push({key, label:row.label, available:true});
    }
  }
  return {seats, revision, supported:true, message:`연습 화면의 선택 가능한 좌석 ${seats.length}개 · ${new Date().toLocaleTimeString('ko-KR')}`};
}
async function seatAction(payload) {
  const ref = seatRefs.get(payload?.key);
  if (!ref || ref.revision !== revision || ref.wcId !== active || current().getURL() !== ref.url || Date.now()-ref.created>30000) throw new Error('좌석 목록이 만료되었습니다. 다시 확인해 주세요.');
  await current().executeJavaScriptInIsolatedWorld(1001,[{code:ref.live?liveAdapter.clickScript(ref.row,payload.action):actionScript(DEMO_PROFILE, ref.row, payload.action)}]);
  if (payload.action === 'click') { seatRefs.clear(); revision++; }
  const wc = current();
  const owner = BrowserWindow.fromWebContents(wc);
  if (owner) owner.focus(); else { win.focus(); wc.focus(); }
  return {message: payload.action === 'click' ? '좌석에 클릭을 전달했습니다. 사이트의 선택 결과를 확인해 주세요.' : '좌석 위치로 이동했습니다.'};
}
const js=(wc,fn,arg)=>wc.executeJavaScriptInIsolatedWorld(1001,[{code:`(${fn.toString()})(${JSON.stringify(arg)??''})`}]);
function savePreferences(input){preferences=normalizePreferences(input);fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(preferencesPath,JSON.stringify(preferences,null,2));return preferences;}
function setRunStatus(run,text){if(runs.current!==run)return;if(run.status!==text){run.status=text;run.timeline.push({stage:text,elapsedMs:Date.now()-run.started});state(text);}}
function beginRun(wc,input,kind){
  if(runner)throw Error('진행 중인 작업을 중지하고 정리가 끝날 때까지 기다려 주세요.');
  const p=normalizePreferences(input||preferences);preferences=p;
  const run=runs.begin(wc.id,p,kind);runner=run;powerId=powerSaveBlocker.start('prevent-display-sleep');
  run.entry={strategy:'site',trigger:null,clockOutcome:'not-configured',requestCount:0,receivedCount:0,failedCount:0,seatPageObserved:false};run.entryRequests=new Set();
  run.triedJobs=new Set();run.excludedIds=new Set();run.excludedGroups=new Set();state('준비 중');return run;
}
function finishRun(run,message){
  if(runs.current!==run)return;
  lastRun={id:run.id,durationMs:Date.now()-run.started,stages:run.timeline.slice(-80),message,entry:{...run.entry}};
  runs.finish(run);runner=null;
  if(powerId!=null&&powerSaveBlocker.isStarted(powerId))powerSaveBlocker.stop(powerId);powerId=null;state(message);
}
async function stopRun(message='자동 진행을 중지했습니다.'){
  const run=runs.cancel();if(!run){if(message)state(message);return;}
  state(run.status);
  await Promise.allSettled([...run.windowIds].map(id=>{const wc=targets.get(id);return wc&&!wc.isDestroyed()?js(wc,()=>{window.__bearsEntry?.stop();window.__bearsGate?.stop();}):null;}));
  await run.task?.catch(()=>{});
  if(runs.current===run)finishRun(run,message);else state(lastRun?.id===run.id?lastRun.message:message);
}
function targetFor(run){runs.assert(run);const wc=targets.get(run.targetId);if(!wc||wc.isDestroyed())throw Error('실행 대상 창이 닫혔습니다.');return wc;}
async function runJs(run,wc,fn,arg){runs.assert(run);if(wc.id!==run.targetId)throw Error('실행 대상 창이 변경되었습니다.');const value=await js(wc,fn,arg);runs.assert(run);return value;}
async function syncClock(){
  const samples=[];
  for(let i=0;i<3;i++){const start=Date.now(),monoStart=performance.now();try{const response=await net.fetch(SERVER_TIME_URL+'&nc='+start,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(3000)});const body=await response.text(),end=Date.now(),monoEnd=performance.now();if(response.ok)samples.push(serverClockSample({body,start,end,monoStart,monoEnd,age:response.headers.get('age'),cache:response.headers.get('x-cache')}));}catch{}}
  if(!samples.some(Boolean))for(let i=0;i<2;i++){const start=Date.now();try{const response=await net.fetch(HOME,{method:'HEAD',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(3000)});const end=Date.now();if(response.ok)samples.push(clockSample({date:response.headers.get('date'),age:response.headers.get('age'),cache:response.headers.get('x-cache'),start,end}));}catch{}}
  clockInfo=bestClock(samples);state(clockInfo.source==='http-date-fallback'?'서버 시각 조회 불가 · 웹 응답 시각으로 추정합니다.':'예매 준비 화면이 사용하는 서버 시각을 조회했습니다.');return {clockInfo};
}
function rememberGate(run,status){
  if(runs.current!==run||!status||status.runId!==run.id)return;
  if(status.trigger)run.entry.trigger=status.trigger;
  if(status.clock?.outcome&&status.clock.outcome!=='not-configured')run.entry.clockOutcome=status.clock.outcome;
  if(Number.isFinite(status.clock?.uncertaintyMs))run.entry.clockUncertaintyMs=status.clock.uncertaintyMs;
}
function pinGateDocument(run,wc){
  const doc={windowId:wc.id,version:scopeVersions.get(wc.id)};
  if(run.gateDocument&&(run.gateDocument.windowId!==doc.windowId||run.gateDocument.version!==doc.version))throw Error('감시 중이던 준비 화면이 다시 로드되었습니다. 중복 진입을 피하려면 화면 확인 후 새로 시작해 주세요.');
  run.gateDocument=doc;
}
async function scheduleGateClock(run,wc,status){
  if(run.entry.strategy!=='clock'||!run.clockEligible||run.entry.trigger||run.entry.requestCount||status?.phase!=='armed'||status.clock?.firedAtMono!=null)return;
  const monoNow=performance.now(),estimate=clockForGate(clockInfo,{monoNow});
  const plannedServerNow=estimate?.serverNowMs??Date.now()+(clockInfo?.offsetMs||0);
  // Refresh before opening in the background; never block the activation observer on a clock fetch.
  if(run.openAt-plannedServerNow<=45000&&run.openAt-plannedServerNow>=-5000&&!run.clockTask&&(run.lastClockRefresh==null||monoNow-run.lastClockRefresh>=30000)){
    run.lastClockRefresh=monoNow;
    run.clockTask=syncClock().catch(()=>{if(runs.current===run){run.entry.clockReason='서버 시각 조회 실패 · 활성화 감지를 유지합니다.';state();}}).finally(()=>{run.clockTask=null;});
  }
  if(!estimate){run.entry.clockReason=run.clockTask?'최근 서버 시각 조회 중 · 활성화 감지를 유지합니다.':'시각 표본이 없거나 만료/대체/오차 초과 · 활성화 감지를 유지합니다.';if(!run.clockTask)run.entry.clockOutcome='fallback';return;}
  if(estimate.validForMs<run.openAt-estimate.serverNowMs||run.clockAppliedAnchor===clockInfo.anchorMonoMs)return;
  const sample=clockInfo,before=performance.now(),scope=scopeVersions.get(wc.id),url=wc.getURL();
  const page=await runJs(run,wc,()=>({pageMono:performance.now(),documentId:window.__bearsGate?.status.documentId}));const after=performance.now();
  if(scopeVersions.get(wc.id)!==scope||wc.getURL()!==url)throw Error('시각을 연결하는 동안 준비 화면이 변경되었습니다. 다시 시작해 주세요.');
  const pageMono=page?.pageMono;
  const roundTrip=after-before,atPage=clockForGate(sample,{monoNow:(before+after)/2});
  if(!atPage||!Number.isFinite(pageMono)||typeof page.documentId!=='string'||roundTrip>250||atPage.uncertaintyMs+roundTrip/2>501)return;
  const installed=await runJs(run,wc,entry.setGateClock,{runId:run.id,goodsCode:run.goodsCode,documentId:page.documentId,source:'ticket-server',openAt:run.openAt,deadlineMono:pageMono+run.openAt-atPage.serverNowMs,validUntilMono:pageMono+atPage.validForMs-roundTrip/2,uncertaintyMs:atPage.uncertaintyMs+roundTrip/2});
  if(installed){run.clockAppliedAnchor=sample.anchorMonoMs;run.entry.clockOutcome='armed';run.entry.clockReason='공식 오픈 시각 예약 · 비활성이면 기존 감지를 유지합니다.';}
}
async function games(){
  const wc=current();if(wc.getURL()!==HOME)throw new Error('먼저 두산 예매 페이지를 열어 주세요.');
  await js(wc,()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(b)b.click();});
  await pause(250);const rows=await js(wc,entry.gameCards);return {games:rows.map(g=>({...g,openAt:parseOpening(g.schedule)})),message:'경기별 공식 일반예매 오픈 표기를 읽었습니다.'};
}
function selectionAdapter(wc,run){
  const initialUrl=wc.getURL(),scope=scopeVersions.get(wc.id);
  const assertScope=()=>{
    if(runs.current!==run||wc.isDestroyed()||run.targetId!==wc.id)throw Error('실행 대상이 변경되었습니다.');
    const url=wc.getURL();let next=false;try{const u=new URL(url);next=u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price';}catch{}
    if(!next&&(scope!==scopeVersions.get(wc.id)||url!==initialUrl))throw Error('경기 또는 회차가 변경되어 중지했습니다.');
  };
  return {
    snapshot:async()=>{assertScope();const scene=await js(wc,flow.scene);assertScope();return {...scene,network:networkStores.get(wc.id).snapshot()};},
    select:async row=>{assertScope();try{await wc.executeJavaScriptInIsolatedWorld(1001,[{code:liveAdapter.clickScript(row,'click')}]);}catch(error){if(error.message.includes('SEAT_UNAVAILABLE:'))throw new selection.SelectionError('선택 전에 사이트에서 좌석이 선택 불가로 변경되었습니다.','conflict',[row.id]);throw error;}},
    deselect:async id=>{assertScope();return js(wc,flow.deselect,id);},
    complete:async()=>{assertScope();return js(wc,flow.clickKnown,'선택 완료');},
    dismissConflict:async()=>{assertScope();return js(wc,flow.dismissConflict);}
  };
}
async function candidatesFor(wc,p,options={}){
  const url=wc.getURL(),scope=scopeVersions.get(wc.id);
  const data=await wc.executeJavaScriptInIsolatedWorld(1001,[{code:liveAdapter.readScript()}]);
  if(wc.isDestroyed()||wc.getURL()!==url||scopeVersions.get(wc.id)!==scope)throw Error('후보를 읽는 동안 경기 또는 회차가 변경되었습니다.');
  const rows=metadata.enrich(data.rows,metaStores.get(wc.id),gradeStores.get(wc.id));
  return {data,rows,groups:rankGroups(rows,p,options)};
}
async function selectCandidates(wc,run,groups){
  return selection.chooseCandidates({groups,adapter:selectionAdapter(wc,run),signal:run.signal,preferences:run.preferences,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups,onStatus:text=>setRunStatus(run,text)});
}
async function recommend(){const result=await scan();const groups=rankGroups(result.seats,preferences);return {...result,groups,message:groups.length?`선호 조건에 맞는 ${groups.length}개 조합 · ${preferences.quantity}매`:'현재 표시된 좌석 중 조건을 검증할 수 있는 조합이 없습니다.'};}
function launch(run,task){
  const stopWatchers=()=>Promise.allSettled([...run.windowIds].map(id=>{const wc=targets.get(id);return wc&&!wc.isDestroyed()?js(wc,()=>{window.__bearsEntry?.stop();window.__bearsGate?.stop();}):null;}));
  run.task=(async()=>{try{const result=await task();await stopWatchers();finishRun(run,result?.message||'작업이 끝났습니다.');return result;}catch(error){await stopWatchers();finishRun(run,(run.signal.aborted?'중지했습니다. ':'')+error.message);throw error;}})();
  run.task.catch(()=>{});return run.task;
}
async function startRun(payload){
  const wc=current(),isGate=/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+(?:[/?#]|$)/.test(wc.getURL());
  if(!isEntryPage(wc.getURL())&&!isGate)throw Error('경기 목록 또는 해당 경기의 예매 준비 화면에서 시작해 주세요.');
  const run=beginRun(wc,payload?.preferences,'auto');
  run.entry.strategy=payload?.entryStrategy==='clock'?'clock':'site';
  if(run.entry.strategy==='clock'){run.entry.clockOutcome='waiting-sync';run.entry.clockReason='공식 오픈 시각과 최근 서버 시각을 확인합니다.';}
  launch(run,async()=>{
    if(isGate){const gate=await runJs(run,wc,entry.gateStatus,{});if(!gate.supported)throw Error('예매 준비 화면을 확인하지 못했습니다.');run.goodsCode=gate.goodsCode;run.openAt=Date.now();}
    else{
      const all=await runJs(run,wc,entry.gameCards);const game=all.find(g=>g.key===payload?.key);if(!game)throw Error('대상 경기를 먼저 선택해 주세요.');
      run.game=game;run.openAt=payload.openAt==null?(parseOpening(game.schedule)??Date.now()):Number(payload.openAt);
      if(!Number.isFinite(run.openAt)||run.openAt>Date.now()+15*86400000)throw Error('15일 이내의 오픈 시각을 입력해 주세요.');
      const officialOpenAt=parseOpening(game.schedule);run.clockEligible=run.entry.strategy==='clock'&&officialOpenAt!=null&&run.openAt===officialOpenAt;
      if(smoke)await runJs(run,wc,entry.armEntry,{key:game.key,openAt:run.openAt});
      else await runJs(run,wc,entry.prepareEntry,{key:game.key,runId:run.id});
      setRunStatus(run,'예매 준비 화면 진입 · 사이트 개방 대기');
    }
    if(run.entry.strategy==='clock'&&!run.clockEligible){run.entry.clockOutcome='fallback';run.entry.clockReason='이 경기의 공식 오픈 시각을 확인하지 못했거나 입력값이 다릅니다. 활성화 감지만 사용합니다.';}
    return await autoLoop(run);
  });
  return {message:'예매 준비를 시작했습니다. 중지하면 진행 중인 선택 정리까지 확인합니다.'};
}
async function nextGrade(run,wc,info,message){
  if(!info.buttons.some(b=>b.label==='좌석도 전체보기'&&b.enabled))throw Error(message+' 구역 목록으로 돌아가는 버튼을 확인하지 못했습니다.');
  await runJs(run,wc,flow.clickKnown,'좌석도 전체보기');run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=Date.now();setRunStatus(run,message+' · 다음 조건/구역 확인');
}
async function autoLoop(run){
  while(true){
    const wc=targetFor(run),url=wc.getURL();
    if(Date.now()>Math.max(run.openAt||run.started,run.started)+30*60000)throw Error('자동 진행 30분 제한에 도달했습니다. 사이트 화면을 확인해 주세요.');
    if(/^https:\/\/tickets\.interpark\.com\/waiting(?:[/?#]|$)/.test(url))setRunStatus(run,'대기열 진입 · 기존 순서를 유지하며 대기');
    else if(url.startsWith('https://accounts.yanolja.com/'))setRunStatus(run,'로그인 대기 · 사이트에서 직접 로그인해 주세요.');
    else if(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+/.test(url)){
      pinGateDocument(run,wc);
      const gate=await runJs(run,wc,entry.gateStatus,{goodsCode:run.goodsCode});
      if(!gate.supported)throw Error('예매 준비 화면의 경기 또는 구조가 변경되었습니다.');
      if(run.goodsCode&&gate.goodsCode!==run.goodsCode)throw Error('다른 경기의 예매 준비 화면으로 이동했습니다.');
      run.goodsCode=gate.goodsCode;
      let status=await runJs(run,wc,()=>window.__bearsGate?.status||null);
      if((!status||status.phase==='stopped'||status.runId!==run.id)&&!run.entry.trigger&&!run.entry.requestCount)status=await runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)});
      else if(status?.phase==='timeout'||status?.phase==='blocked')throw Error('예매 준비 화면의 활성화를 확인하지 못했습니다.');
      rememberGate(run,status);await scheduleGateClock(run,wc,status);
      if(run.entry.trigger||run.entry.requestCount){run.entryDispatchedAt??=Date.now();if(Date.now()-run.entryDispatchedAt>10000)throw Error('진입 클릭/요청 이후 화면 이동을 확인하지 못했습니다. 중복 실행하지 않고 중지합니다.');}
      if(gate.enabled&&status?.observedDisabled===false){run.awaitingAutoAt??=Date.now();if(Date.now()-run.awaitingAutoAt>10000)throw Error('이미 열린 준비 화면에서 사이트의 자동 진입을 확인하지 못했습니다. 예매 화면을 직접 확인해 주세요.');}
      setRunStatus(run,gate.enabled?'예매 버튼 활성화 확인 · 진입 중':'예매 준비 완료 · 사이트가 버튼을 열 때까지 대기');
    }
    else if(isEntryPage(url)){
      if(Date.now()-run.started>30000&&Date.now()>(run.openAt||0)+30000)throw Error('예매 준비 화면으로 이동하지 못했습니다. 로그인과 팝업을 확인해 주세요.');
    }
    else if(liveAdapter.supportedUrl(url)||(smoke&&url===DEMO)){
      if(run.entry)run.entry.seatPageObserved=true;
      const info=await runJs(run,wc,flow.scene),button=label=>info.buttons.some(b=>b.label===label&&b.enabled);
      if(info.completed)return {message:'좌석 선택 승인 · 가격/할인 화면 도착을 확인했습니다. 결제는 직접 진행해 주세요.'};
      // Pin the booking context on first seat-page entry, including the time
      // spent waiting for CAPTCHA or navigating grade lists.
      const scope=scopeVersions.get(wc.id);
      if(run.seatScope==null){run.seatScope={id:wc.id,version:scope};}
      else if(run.seatScope.id!==wc.id||run.seatScope.version!==scope)throw Error('경기 또는 회차가 변경되어 자동 진행을 중지했습니다.');
      if(button('확인하고 예매하기')&&run.preferences.autoNotice){await runJs(run,wc,flow.clickKnown,'확인하고 예매하기');setRunStatus(run,'예매 안내 확인');}
      else if(info.captcha)setRunStatus(run,'보안문자 직접 입력 대기');
      else if(info.dialog)throw Error('사이트 안내를 확인해 주세요. '+info.dialog.text);
      else if(info.selected.length)throw Error('기존에 선택한 좌석이 있습니다. 확인/해제한 뒤 다시 시작해 주세요.');
      else if(run.awaitingGradesAt&&info.hasSeats){if(Date.now()-run.awaitingGradesAt>8000)throw Error('구역 목록으로 돌아가는 화면 전환을 확인하지 못했습니다.');setRunStatus(run,'구역 목록 화면 도착을 기다리는 중');}
      else if(button('직접 좌석 선택하기')){await runJs(run,wc,flow.clickKnown,'직접 좌석 선택하기');run.gradeOpenedAt=Date.now();setRunStatus(run,'직접 좌석 선택 화면 진입');}
      else if(info.grades.length&&!run.currentJob&&!info.hasSeats){
        run.awaitingGradesAt=null;
        const plan=gradePlan(info.grades,run.preferences);const job=plan.find(j=>!run.triedJobs.has(JSON.stringify([j.tierIndex,j.name])));
        if(!job)return {message:'설정한 모든 우선순위에서 선택 가능한 후보를 찾지 못했습니다.'};
        const data=await runJs(run,wc,liveAdapter.liveRead);const row=data.rows.find(r=>r.name===job.name);
        if(row){runs.assert(run);await wc.executeJavaScriptInIsolatedWorld(1001,[{code:liveAdapter.clickScript(row,'click')}]);runs.assert(run);run.currentJob=job;run.gradeOpenedAt=Date.now();run.triedJobs.add(JSON.stringify([job.tierIndex,job.name]));setRunStatus(run,`${job.tierIndex+1}순위 · ${job.name} 확인`);}
        else{run.triedJobs.add(JSON.stringify([job.tierIndex,job.name]));}
      }
      else if(info.hasSeats){
        run.gradeOpenedAt??=Date.now();
        const {data,rows,groups}=await candidatesFor(wc,run.preferences,{tierIndex:run.currentJob?.tierIndex,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups});runs.assert(run);
        if(groups.length){setRunStatus(run,`${groups.length}개 후보 준비 · 순서대로 선택 확인`);const result=await selectCandidates(wc,run,groups);runs.assert(run);if(!result.exhausted||result.limited)return result;await nextGrade(run,wc,await runJs(run,wc,flow.scene),'현재 후보들이 선점되어 제외했습니다.');}
        else{
          const elapsed=Date.now()-run.gradeOpenedAt;
          const incomplete=rows.some(r=>r.kind==='seat'&&(r.row==null||!r.grade));
          if((!incomplete&&elapsed>1500)||(incomplete&&elapsed>8000))await nextGrade(run,wc,info,incomplete?'좌석 상세 정보 일부를 확인하지 못했습니다.':'현재 지도에 조건을 만족하는 좌석이 없습니다.');
          else setRunStatus(run,'좌석 정보 로딩 · 조건에 맞는 연석 확인');
        }
      }
      else{run.awaitingGradesAt??=Date.now();if(Date.now()-run.awaitingGradesAt>12000)throw Error('좌석 화면 로딩을 확인하지 못했습니다. 화면을 확인해 주세요.');}
    }
    else if(url==='about:blank'){}
    else if(Date.now()-run.started>15000)throw Error('지원하는 예매 진행 화면이 아닙니다. 현재 화면을 확인해 주세요.');
    await pause(100,run.signal);
  }
}

async function command(action, payload) {
  if(runner&&!['state','stop','focus','code'].includes(action))throw Error('진행 중에는 창·설정·좌석을 변경할 수 없습니다. 중지 후 정리가 끝나면 다시 시도해 주세요.');
  switch(action) {
    case 'state': state(); return {};
    case 'home': active = view.webContents.id; view.setVisible(true); await view.webContents.loadURL(HOME); return {};
    case 'demo': {active = view.webContents.id; view.setVisible(true); await view.webContents.loadURL(DEMO);seedDemo(active);return {};}
    case 'target': if (!targets.has(Number(payload))) throw new Error('닫힌 창입니다.'); active = Number(payload); invalidate('대상 창을 변경했습니다.'); return {};
    case 'focus': { const wc=current(); const owner=BrowserWindow.fromWebContents(wc); if(owner) owner.focus(); else win.focus(); wc.focus(); return {message:'예매 화면에서 보안코드를 직접 입력해 주세요.'}; }
    case 'zoom': { const wc=current(); const delta=Number(payload); if(![-0.1,0,0.1].includes(delta)) throw new Error('잘못된 배율'); wc.setZoomFactor(delta === 0 ? 1 : Math.max(.7,Math.min(1.8,wc.getZoomFactor()+delta))); return {}; }
    case 'scan': return scan();
    case 'seat': return seatAction(payload);
    case 'preferences': savePreferences(payload);state('선호 조건을 저장했습니다.');return {preferences};
    case 'games': return games();
    case 'clock': return syncClock();
    case 'start': return startRun(payload);
    case 'stop': await stopRun('자동 진행을 중지했습니다.');return {};
    case 'code': await js(runner?targetFor(runner):current(),flow.enterCode,String(payload||'').trim().toUpperCase());return {message:'보안문자를 입력했습니다. 인증 결과를 확인합니다.'};
    case 'recommend': if(payload?.preferences)preferences=normalizePreferences(payload.preferences);return recommend();
    case 'choose': {const wc=current();if(!liveAdapter.supportedUrl(wc.getURL())&&wc.getURL()!==DEMO)throw Error('좌석 화면에서 실행해 주세요.');const run=beginRun(wc,payload?.preferences,'manual');return launch(run,async()=>{const {groups}=await candidatesFor(wc,run.preferences);runs.assert(run);if(!groups.length)throw Error('현재 지도에 조건에 맞는 조합이 없습니다.');return selectCandidates(wc,run,groups);});}
    case 'complete': {const wc=current();if(!liveAdapter.supportedUrl(wc.getURL())&&wc.getURL()!==DEMO)throw Error('좌석 화면에서 실행해 주세요.');const run=beginRun(wc,payload?.preferences,'manual');return launch(run,async()=>{
      const adapter=selectionAdapter(wc,run),info=await adapter.snapshot();runs.assert(run);
      const seats=metadata.enrich(info.selected.map(id=>({id,available:true})),metaStores.get(wc.id),gradeStores.get(wc.id));
      if(!rankGroups(seats,run.preferences).some(g=>g.seats.length===info.selected.length&&g.seats.every(s=>info.selected.includes(s.id))))throw Error('선택된 좌석이 현재 매수·연석·구역·열 조건을 만족하는지 확인하지 못했습니다.');
      return selection.completeSelection({adapter,signal:run.signal,preferences:run.preferences,onStatus:text=>setRunStatus(run,text)});
    });}
    default: throw new Error('지원하지 않는 동작입니다.');
  }
}
app.whenReady().then(async () => {
  const browsing = session.fromPartition('persist:ticket');
  browsing.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  browsing.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({width:1400,height:940,minWidth:1080,minHeight:760,show:!smoke,autoHideMenuBar:true,backgroundColor:'#101827',title:'두산 예매 도우미',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', e=>e.preventDefault());
  view = new WebContentsView({webPreferences:{partition:'persist:ticket',nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.contentView.addChildView(view);
  view.setVisible(false);
  function layout() { const [w,h]=win.getContentSize(); view.setBounds({x:340,y:66,width:Math.max(1,w-340),height:Math.max(1,h-66)}); }
  layout(); win.on('resize',layout);
  mainId=view.webContents.id;track(view.webContents); active=mainId;
  ipcMain.handle('helper:run',async (event,action,payload)=>{
    if(closing||!win||win.isDestroyed()||event.sender !== win.webContents || event.senderFrame?.url !== SHELL) return {error:'허용되지 않은 요청입니다.'};
    try { return await command(action,payload); } catch(e) {return {error:e.message};}
  });
  let closeReady=false;
  win.on('close',e=>{if(closeReady)return;if(runner){e.preventDefault();void stopRun('종료 전 선택 정리를 확인했습니다.').finally(()=>{closing=true;closeReady=true;win.close();});return;}closing=true;});
  win.on('closed',()=>{const remaining=[...targets.values()];targets.clear();for(const wc of remaining)if(!wc.isDestroyed())wc.close();app.quit();});
  await win.loadURL(SHELL);
  if(smoke) {
    process.once('uncaughtException',error=>{console.error(error);app.exit(1);});
    const report=await require('./smoke')({app,win,view,command,js,targets});
    app.once('will-quit',()=>{
      report.checks.push('메인 창 종료 및 하위 화면 정리 오류 없음');
      fs.mkdirSync(path.join(app.getAppPath(),'work'),{recursive:true});
      fs.writeFileSync(path.join(app.getAppPath(),'work','smoke-result-v0.4.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report));
    });
    win.close();
  }
}).catch(e=>{console.error(e);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
