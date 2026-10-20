'use strict';
const {openingPlan,readPostseasonOpening}=require('./opening-schedule');
const {app, BrowserWindow, ipcMain, net, powerSaveBlocker, screen, shell, clipboard, Menu, Tray, nativeImage, safeStorage} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {performance}=require('node:perf_hooks');
const liveAdapter = require('./live-adapter');
const {normalizePreferences,rankGroups,assessGradePlan,labelKey}=require('./preferences');
const {parseOpening,clockSample,bestClock,serverClockSample,clockForGate,SERVER_TIME_URL}=require('./timing');
const {RunControl,pause}=require('./run-control');
const {SeatRetry}=require('./seat-retry');
const seatSearch=require('./seat-search');
const selection=require('./selection');
const {BrowserBridge}=require('./browser-bridge');
const {ChromeTarget}=require('./chrome-target');
const {OcrClient}=require('./ocr-client');
const {CaptchaService}=require('./captcha-service');
const {ManualCaptcha}=require('./manual-captcha');
const entry=require('./entry');
const desktopSettings=require('./desktop-settings');
const {safeLastRun}=require('./run-diagnostics');
const {createRunLog}=require('./run-log');
const {createPairingStore}=require('./pairing-store');
const {installExtension}=require('./extension-install');
const {siteCodeMessage}=require('./site-code');
const {resolveGradeNames}=require('./grade-names');
const {phaseForStatus,observerDiagnosis,diagnosisForRun,buildPreflight,seatExtensionCompatible}=require('./run-inspection');

const metadata=require('./metadata');
const flow=require('./flow');
const directApi=require('./direct-seat-api'),publicGame=require('./public-game');
const seatDetails=require('./seat-details');
const pricePage=require('./price-page');
const httpBooking=require('./http-booking');
const {bookingObservation,inspectionState}=require('./booking-observation');
const HOME = desktopSettings.POSTSEASON;
const METADATA_RECHECK_MS=1000;
const SHELL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const smoke=process.argv.includes('--panel-smoke');
const isEntryPage=value=>{try{const u=new URL(value);return !u.username&&!u.password&&u.origin==='https://nol.yanolja.com'&&/^\/ticket(?:\/|$)/.test(u.pathname);}catch{return false;}};
const validHome=value=>{try{const u=new URL(String(value));return !u.username&&!u.password&&(isEntryPage(value)||(u.origin==='https://tickets.interpark.com'&&(/^(?:\/gates\/ticket\/\d{8}|\/goods\/\d+)(?:\/|$)/.test(u.pathname))));}catch{return false;}};
// Desktop settings only. Chrome retains its own login/profile and open tabs.
const stableRoot=app.isPackaged&&!smoke?path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'BaseballTicketHelper'):null;
const dataRoot = stableRoot ? path.join(stableRoot,'settings') : path.join(app.getAppPath(), 'work', smoke ? `panel-smoke-${process.pid}` : 'desktop-settings');
fs.mkdirSync(dataRoot,{recursive:true});
app.setPath('userData', dataRoot);
const migrated=app.isPackaged&&!smoke?desktopSettings.migrateSettings({destination:dataRoot,sources:[path.join(path.dirname(process.execPath),'settings'),...['BaseballTicketHelper-v0.9.17-win32-x64','BaseballTicketHelper-v0.9.16-win32-x64','BaseballTicketHelper-v0.9.15-win32-x64','BaseballTicketHelper-v0.9.14-win32-x64','BaseballTicketHelper-v0.9.13-win32-x64','BaseballTicketHelper-v0.9.12-win32-x64','BaseballTicketHelper-v0.9.11-win32-x64','BaseballTicketHelper-v0.9.10-win32-x64','BaseballTicketHelper-v0.9.9-win32-x64','BaseballTicketHelper-v0.9.8-win32-x64','BaseballTicketHelper-v0.9.7-win32-x64','BaseballTicketHelper-v0.9.6-win32-x64','BaseballTicketHelper-v0.9.5-win32-x64','BaseballTicketHelper-v0.9.4-win32-x64','BaseballTicketHelper-v0.9.3-win32-x64','BaseballTicketHelper-v0.9.2-win32-x64','BaseballTicketHelper-v0.9.1-win32-x64','BaseballTicketHelper-v0.9-win32-x64','BaseballTicketHelper-v0.8-win32-x64','BaseballTicketHelper-v0.7-win32-x64','BaseballTicketHelper-v0.6-win32-x64','BaseballTicketHelper-v0.5-win32-x64'].map(name=>path.join(path.dirname(path.dirname(process.execPath)),name,'settings'))]}):[];
let win, active, closing=false, revision=0, bridge, tray, bridgeReady=false, bridgeError='',saveWindowTimer;
let pageUrl=HOME, browserStatus={connected:false,message:'Chrome 확장 연결 전'};
let preferences=normalizePreferences(),clockInfo=null,runner=null,powerId=null;
let captchaService=null,captchaTask=null,captchaTarget=null,manualCodePending=false;
let captchaStatus={available:true,ready:false,busy:false,mode:null,message:'보안문자 모델 준비 전',text:'',confidence:null,previewDataUrl:null};
const manualCaptcha=new ManualCaptcha({onState:()=>state()});
const runs=new RunControl();let lastRun=null;
const preferencesPath=path.join(dataRoot,'preferences.json');
const settingsPath=path.join(dataRoot,'settings.json');
const lastRunPath=path.join(dataRoot,'last-run.json');
let diagnosticWarning='',preflightResult=null;
const runLog=createRunLog({directory:path.join(dataRoot,'logs'),version:require('../package.json').version,io:fs,onError:message=>{diagnosticWarning=message;}});
try{const info=fs.statSync(lastRunPath);if(info.size<=100000)lastRun=safeLastRun(JSON.parse(fs.readFileSync(lastRunPath,'utf8')));}catch{}
if(lastRun&&!lastRun.diagnosis)lastRun.diagnosis=diagnosisForRun(lastRun,lastRun.message);
// The renderer deduplicates completion notices by ID. Continue from the restored
// run so the first new result after restarting cannot look like the old one.
if(lastRun)runs.serial=lastRun.id;
let desktop=desktopSettings.cleanSettings();
try{desktop=desktopSettings.cleanSettings(JSON.parse(fs.readFileSync(settingsPath,'utf8')));pageUrl=desktop.pageUrl;}catch{}
const extensionSource=app.isPackaged?path.join(path.dirname(process.execPath),'chrome-extension'):path.join(app.getAppPath(),'extension');
const extensionPath=stableRoot?path.join(stableRoot,'chrome-extension'):extensionSource;
let extensionReloadRequested=false;
async function updateExtension(){
  if(stableRoot)installExtension({source:extensionSource,destination:extensionPath});
  if(bridge.getState().connected&&bridge.getState().extensionReloadSupported){
    extensionReloadRequested=true;try{await bridge.request({action:'extension.reload'});}catch(error){extensionReloadRequested=false;throw error;}
    return {message:'확장 업데이트 적용 · 자동 재연결을 기다립니다. 예매 탭은 새로고침해 주세요.'};
  }
  return {message:'고정 확장 폴더를 준비했습니다. 최초 한 번 이 폴더를 Chrome에 등록하고 연결하세요.'};
}
try{preferences=normalizePreferences(JSON.parse(fs.readFileSync(preferencesPath,'utf8')));}catch{}
const targets = new Map();
const metaStores=new Map(),gradeStores=new Map(),scopeVersions=new Map();
function state(message) {
  if (closing || !win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  manualCaptcha.invalidateIfStale();
  win.webContents.send('helper:state', {appVersion:require('../package.json').version,message, target: active, revision,preferences,clockInfo,running:!!runner,runStatus:runner?.status,
    entry:runner?.entry,retry:runner?.retry?.snapshot(),lastRun,diagnosticWarning,preflight:preflightResult,runDiagnostics:runner?{metrics:runner.metrics.snapshot(),diagnosis:runner.diagnosis||null}:null,browserStatus,captchaStatus,manualCaptcha:manualCaptcha.status,pageUrl,desktop:desktopState(),windows: [...targets.values()].filter(w => !w.isDestroyed()).map(w => ({id:w.id, title:w.getTitle() || '예매 페이지', url:w.getURL()}))});
}
function manualAdapter(wc,run){
  const {assertCurrent}=captchaAdapter(wc,run);
  const invoke=async(action,arg)=>{assertCurrent();const result=await js(wc,'manualCaptcha.'+action,arg);assertCurrent();return result;};
  return {targetId:wc.id,assertCurrent,prepare:arg=>invoke('manualCaptchaPrepare',arg),submit:arg=>invoke('manualCaptchaSubmit',arg)};
}
async function prepareManualCaptcha(wc,run,{focus=true,background=false}={}){
  if(bridge.getState().manualCaptchaSupported===false)throw Error('직접 입력 보조에는 v0.9.3 Chrome 확장이 필요합니다. 새 배포 폴더의 chrome-extension을 등록하고 다시 연결해 주세요.');
  if(captchaStatus.busy)throw Error('현재 보안문자 작업을 중지한 뒤 직접 입력을 준비해 주세요.');
  const result=await manualCaptcha.prepare(manualAdapter(wc,run),{focus,background});
  return {...result,manualCaptcha:manualCaptcha.status};
}
function getCaptchaService(){
  if(!captchaService)captchaService=new CaptchaService({ocr:new OcrClient(),onState:value=>{captchaStatus=value;state();}});
  return captchaService;
}
function captchaAdapter(wc,run){
  const documentId=wc.documentId,url=wc.getURL(),version=scopeVersions.get(wc.id);
  const assertCurrent=()=>{
    if(run)runs.assert(run);
    if(wc.isDestroyed()||targets.get(wc.id)!==wc||wc.missingSince!=null||wc.documentId!==documentId||wc.getURL()!==url||scopeVersions.get(wc.id)!==version||(run?run.targetId:active)!==wc.id)throw Error('보안문자 처리 중 대상 창이나 문서가 바뀌었습니다. 현재 화면을 확인해 주세요.');
  };
  const invoke=async(action,arg)=>{assertCurrent();const result=await js(wc,action,arg);assertCurrent();return result;};
  return {assertCurrent,snapshot:()=>invoke('captcha.captchaSnapshot'),submit:arg=>invoke('captcha.captchaSubmit',arg),status:arg=>invoke('captcha.captchaStatus',arg),refresh:arg=>invoke('captcha.captchaRefresh',arg)};
}
async function processCaptcha(wc,mode,run){
  if(bridge.getState().captchaSupported===false)throw Error('보안문자를 연결하려면 v0.9 폴더의 chrome-extension을 등록하고 새 코드로 연결해 주세요.');
  const service=getCaptchaService(),adapter=captchaAdapter(wc,run);
  captchaTarget=wc;
  const task=service.execute({mode,scope:`${wc.id}:${wc.documentId}:${scopeVersions.get(wc.id)}`,adapter,signal:run?.signal});
  captchaTask=task;
  try{return {...await task,captchaStatus:{...captchaStatus}};}finally{if(captchaTask===task){captchaTask=null;captchaTarget=null;}}
}
async function stopCaptcha(){
  const wc=captchaTarget,task=captchaTask;captchaService?.cancel();
  if(wc&&!wc.isDestroyed()&&wc.missingSince==null)await js(wc,'captcha.captchaCancel').catch(()=>{});
  await task?.catch(()=>{});
  return {message:'보안문자 처리를 중지했습니다. 이미 전달한 확인은 취소되지 않습니다.',captchaStatus:{...captchaStatus}};
}
function desktopState(){return {alwaysOnTop:desktop.alwaysOnTop,settingsMigrated:migrated.length>0,bridgeReady};}
function persistDesktop(){
  desktop=desktopSettings.cleanSettings({...desktop,pageUrl});
  fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(settingsPath,JSON.stringify(desktop,null,2));
}
function revealPanel(reset=false){return desktopSettings.revealWindow(win,screen,{reset});}
function rememberWindow(){
  clearTimeout(saveWindowTimer);
  if(!win||win.isDestroyed()||win.isMinimized()||win.isMaximized()||smoke)return;
  desktop.windowBounds=win.getBounds();
  saveWindowTimer=setTimeout(()=>{try{persistDesktop();}catch(error){state('창 설정을 저장하지 못했습니다. '+error.message);}},250);
}
function windowMenu(){return [
  {label:'도우미 창 열기',click:()=>revealPanel()},
  {label:'창 위치를 왼쪽으로 복구',click:()=>revealPanel(true)},
  {label:'항상 위에 표시',type:'checkbox',checked:desktop.alwaysOnTop,click:item=>void command('alwaysOnTop',item.checked).catch(error=>state(error.message))},
  {type:'separator'},
  {label:'도우미 종료',click:()=>win?.close()}
];}
function updateWindowMenu(){
  if(smoke)return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'창',submenu:windowMenu()}]));
  tray?.setContextMenu(Menu.buildFromTemplate(windowMenu()));
}
function createTray(){
  // Draw a small baseball icon locally; no downloaded assets or external dependencies.
  const size=32,bitmap=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,d=(x-15.5)**2+(y-15.5)**2;
    const seam=(Math.abs(x-(10+Math.abs(y-15.5)/3))<1.2||Math.abs(x-(21-Math.abs(y-15.5)/3))<1.2)&&y>6&&y<26;
    const color=d<180?(seam?[78,93,224,255]:[246,242,235,255]):[91,60,29,255];
    bitmap.set(color,i);
  }
  tray=new Tray(nativeImage.createFromBitmap(bitmap,{width:size,height:size}));
  tray.setToolTip('야구 티켓팅 도우미 · 클릭하면 창 열기');
  tray.on('click',()=>revealPanel());tray.on('double-click',()=>revealPanel());
}
function assertAvailable(wc){if(wc.missingSince!=null)throw Error('예매창이 화면을 전환하는 중입니다. 새로운 동작을 보내지 않고 기다립니다.');}
function current() { const wc = targets.get(active); if (!wc || wc.isDestroyed()) throw new Error('예매 창을 먼저 열어 주세요.'); assertAvailable(wc);return wc; }
function invalidate(message) { revision++; preflightResult=null; state(message); }
function entryTransitionAllowed(run,wc){return run?.kind==='auto'&&!run.seatScope&&!liveAdapter.supportedUrl(wc.getURL())&&!wc.isDemo();}
function observeTarget(run,wc,listingParent=null){
  const previous=run.observerTask;
  const connect=async()=>{
    // A newly adopted popup must not race an armed observer in its parent.
    // Confirm the MAIN-world watcher stopped before arming the new gate.
    if(listingParent?.missingSince!=null)throw Error('이전 경기 목록의 감시 중지를 확인하지 못했습니다. 현재 예매창을 확인해 주세요.');
    if(listingParent&&!listingParent.isDestroyed()&&scopeVersions.get(listingParent.id)===run.listingDocument.version){
      const result=await js(listingParent,entry.stopListing,{key:run.game.key,runId:run.id});
      if(result?.stopped!==true)throw Error('이전 경기 목록의 감시 중지를 확인하지 못했습니다. 새 진입을 중지합니다.');
    }
    runs.assert(run);if(run.targetId===wc.id)return ensureNetwork(wc);
  };
  // A returning or nested popup must remain behind the outstanding parent
  // stop acknowledgement, even if its own tab event arrives first.
  const task=previous?previous.then(connect):connect();run.observerTask=task;
  void task.catch(error=>{if(runs.current===run&&!run.signal.aborted)void stopRun(error.message);});
  void task.finally(()=>{if(run.observerTask===task)run.observerTask=null;}).catch(()=>{});
}
function adoptEntryPopup(run,wc,row){
  if(!run||run.kind!=='auto'||run.signal.aborted||run.seatScope||run.entry.seatPageObserved||!run.entryActionsStarted||run.targetId===row.id||!Number.isInteger(row.openerTabId)||row.openerTabId!==run.targetId)return false;
  const parent=targets.get(row.openerTabId);if(parent&&(liveAdapter.supportedUrl(parent.getURL())||parent.isDemo()))return false;
  const initial=run.entryDocuments.get(row.id);
  // Named popups can predate this run. Only a real document replacement after
  // entry preparation began may adopt one; focus/title/URL changes alone cannot.
  if(initial&&(!run.entryActionsStarted||!initial.documentId||!row.documentId||row.documentId===initial.documentId))return false;
  if(!runs.adopt(row.openerTabId,row.id))return false;
  active=row.id;observeTarget(run,wc,run.listingDocument?.windowId===parent?.id?parent:null);return true;
}
function trackTabs(rows){
  const present=new Set(rows.map(t=>t.id));
  for(const [id,wc] of targets)if(!present.has(id)){
    if(runner?.targetId===id&&!runner.signal.aborted&&entryTransitionAllowed(runner,wc)){
      wc.missingSince??=Date.now();setRunStatus(runner,'예매창 화면 전환 대기 · 추가 요청 없음');continue;
    }
    wc.destroy?.();targets.delete(id);metaStores.delete(id);gradeStores.delete(id);scopeVersions.delete(id);
    if(runner?.targetId===id)void stopRun('실행하던 Chrome 탭이 닫혀 중지했습니다.');
    if(active===id)active=undefined;
  }
  for(const row of rows){
    let wc=targets.get(row.id);
    if(wc){
      const previous=wc.documentId,returning=wc.missingSince!=null;wc.update(row);delete wc.missingSince;
      if(row.documentId&&previous&&row.documentId!==previous){
        scopeVersions.set(wc.id,(scopeVersions.get(wc.id)||0)+1);metaStores.get(wc.id)?.clear();gradeStores.get(wc.id)?.clear();
        invalidate('Chrome 페이지가 바뀌어 좌석 목록을 초기화했습니다.');
      }
      const adopted=adoptEntryPopup(runner,wc,row);
      if(returning&&!adopted&&runner?.targetId===wc.id&&!runner.signal.aborted&&!runner.seatScope)observeTarget(runner,wc);
      continue;
    }
    wc=new ChromeTarget(bridge,row);targets.set(row.id,wc);metaStores.set(row.id,new Map());gradeStores.set(row.id,new Map());scopeVersions.set(row.id,0);
    adoptEntryPopup(runner,wc,row);
    if(wc.isDemo())seedDemo(wc.id);
    if(active==null&&!runner)active=wc.id;
  }
  state();
}
async function ensureNetwork(wc){
  assertAvailable(wc);
  if(wc.isDemo()){seedDemo(wc.id);return;}
  await measured(wc,'observer-connect',()=>bridge.request({action:'network.attach',tabId:wc.id}));
}
async function networkSnapshot(wc){
  assertAvailable(wc);
  if(wc.isDemo())return {healthy:true,sequence:0,pending:[],results:[]};
  return await measured(wc,'response-status',()=>bridge.request({action:'network.snapshot',tabId:wc.id}));
}
function onDocument(event){
  const wc=targets.get(event.tabId);if(!wc||wc.missingSince!=null)return;
  if(event.documentId&&wc.lastReadyDocument===event.documentId)return;
  if(event.documentId&&wc.documentId&&wc.documentId!==event.documentId){
    scopeVersions.set(wc.id,(scopeVersions.get(wc.id)||0)+1);metaStores.get(wc.id)?.clear();gradeStores.get(wc.id)?.clear();
    invalidate('Chrome 문서가 바뀌어 좌석 목록을 초기화했습니다.');
  }
  if(event.documentId)wc.documentId=event.documentId;
  wc.lastReadyDocument=event.documentId;
  if(wc.isDemo())seedDemo(wc.id);
  const run=runner;if(!run||run.signal.aborted||run.kind!=='auto'||run.targetId!==wc.id||run.observerTask||(run.entry.strategy==='clock'&&!run.clockEligible))return;
  const match=wc.getURL().match(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/(\d{8})(?:[?#]|$)/);
  if(!match||run.goodsCode&&run.goodsCode!==match[1]||run.entry.trigger||run.entry.requestCount)return;
  try{pinGateDocument(run,wc);}catch{return;}
  run.goodsCode=match[1];
  void runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,allowInitiallyEnabled:true,httpRetry:run.entry.strategy==='clock'&&run.clockEligible,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)}).then(status=>rememberGate(run,status)).catch(()=>{});
}
function onBrowserEvent(event){
  const wc=targets.get(event.tabId);if(!wc)return;
  if(event.documentId&&wc.documentId&&event.documentId!==wc.documentId)return;
  if(event.type==='native-dialog'){
    if(runner?.targetId===wc.id)void stopRun('브라우저 기본 경고·확인창이 열려 중지했습니다. Chrome에서 해당 안내를 확인한 뒤 다시 시작해 주세요.');
    return;
  }
  if(event.type==='network'&&runner?.targetId===wc.id){
    runner.loggedNetwork??=new Map();const last=runner.loggedNetwork.get(wc.documentId)||0;
    for(const result of event.snapshot?.results||[])if(result.seq>last)runLog.event('seat-response',{kind:result.kind,result:result.status,count:result.seatIds?.length||0});
    runner.loggedNetwork.set(wc.documentId,Math.max(last,...(event.snapshot?.results||[]).map(r=>r.seq)));
  }
  if(event.type==='metadata'){
    let changed=false;const store=metaStores.get(wc.id);
    for(const row of event.rows||[]){const previous=store?.get(row.id);if(!previous||Object.keys({...previous,...row}).some(key=>JSON.stringify(previous[key])!==JSON.stringify(row[key])))changed=true;store?.set(row.id,row);}
    if(changed&&runner?.targetId===wc.id)releaseMetadataCooldown(runner,'seat-metadata');
  }
  else if(event.type==='grades'){
    try{applyGradeDetails(wc,resolveGradeNames(event.rows||[]),runner?.targetId===wc.id?runner:null);}
    catch(error){runLog.event('grade-error',{message:error.message});state(error.message);}
  }
  else if(event.type==='metadata-reset'){
    metaStores.get(wc.id)?.clear();gradeStores.get(wc.id)?.clear();
    if(event.reason==='context'){scopeVersions.set(wc.id,(scopeVersions.get(wc.id)||0)+1);invalidate('경기 또는 회차가 변경되어 좌석 목록을 초기화했습니다.');}
  }else if(event.type==='entry'){
    const e=event.event,run=runner;if(!e||!run||!run.windowIds.has(wc.id))return;
    if(e.kind==='observer-lost'){
      run.entry.observerLost=true;
      if(run.targetId===wc.id&&!(wc.missingSince!=null&&entryTransitionAllowed(run,wc))){
        run.diagnosis??=observerDiagnosis(e.reason);run.entry.observerLostReason=run.diagnosis.code;
        void stopRun('Chrome의 예매 응답 관찰 연결이 끊겨 중지했습니다.');
      }
      state();
      return;
    }
    if(run.kind!=='auto')return;
    if(e.queueKind){
      if(run.targetId!==wc.id)return;
      run.queueObservations??=new Map();
      if(e.kind==='request')run.queueObservations.set(wc.id+':'+e.seq,true);
      else if(run.queueObservations.delete(wc.id+':'+e.seq)){
        const outcome=e.kind==='failed'?'unconfirmed':e.outcome||'unconfirmed';
        if(e.seq>=(run.entry.queueSeq||0)){run.entry.queueSeq=e.seq;run.entry.queueState=outcome;run.entry.queueRank=Number.isSafeInteger(e.rank)?e.rank:null;}
        runLog.event('queue-response',{kind:run.entry.startPage,stage:e.queueKind,result:outcome,message:e.code,status:e.status,elapsedMs:run.metrics.snapshot().elapsedMs,durationMs:e.durationMs,timing:e.timing,rank:e.rank});
      }
      return;
    }
    const key=wc.id+':'+e.seq;
    if(e.kind==='request'){
      if(run.targetId!==wc.id)return;
      run.entryRequests.add(key);run.entry.requestCount++;
      runLog.event('entry-request',{kind:run.entry.startPage,count:run.entry.requestCount,elapsedMs:run.metrics.snapshot().elapsedMs});
      void js(wc,entry.noteGateRequest,{runId:run.id}).then(status=>rememberGate(run,status)).catch(()=>{});
    }else if(run.entryRequests.has(key)){
      if(e.kind==='finished')run.entry.receivedCount++;
      if(e.kind==='failed')run.entry.failedCount++;
      if(Number.isFinite(e.durationMs))run.entry.lastRequestDurationMs=e.durationMs;
      if(e.outcome){run.entry.httpOutcome=e.outcome;run.entry.httpCode=e.code;runLog.event('entry-response',{result:e.outcome,message:e.code,status:e.status,durationMs:e.durationMs,timing:e.timing});}
    }
    state();
  }else if(['error','metadata-error','observer-error'].includes(event.type)){runLog.event('browser-error',{kind:event.type,message:event.message});state(event.message||'Chrome 좌석 정보 연결을 확인해 주세요.');}
}
function seedDemo(id){const store=metaStores.get(id);if(store)for(const s of metadata.parseMetadata(require('./demo-data')))store.set(s.id,s);}
function measured(wc,action,task){const run=runs.current;return run?.windowIds.has(wc.id)?run.metrics.measure(action,task):task();}
const js=(wc,fn,arg)=>{assertAvailable(wc);const name=typeof fn==='string'?fn:fn?.name;const action=name==='scene'?'screen-read':name==='liveRead'?'seat-read':name==='clickKnown'?'screen-action':name==='stopWatchers'?'cleanup':name==='readDetails'?'seat-details':'page-command';return Promise.resolve(measured(wc,action,()=>wc.invoke(fn,arg))).then(result=>{if(runs.current?.windowIds.has(wc.id)&&['prepareEntry','armGate','liveAction','clickKnown','dismissConflict','dismissEmptySelection','captchaSubmit','captchaRefresh'].includes(name))runLog.event('code-action',{action:name,result:result?.status||result?.phase||'returned'});return result;}).catch(error=>{error.message=siteCodeMessage(error.message);if(runs.current?.windowIds.has(wc.id))runLog.event('command-error',{action:name,message:error.message});throw error;});};
function savePreferences(input){
  preflightResult=null;
  const normalized=normalizePreferences(input);
  preferences=normalized;
  fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(preferencesPath,JSON.stringify(preferences,null,2));return preferences;
}
function setRunStatus(run,text){if(runs.current!==run)return;if(run.status!==text){run.status=text;const phase=phaseForStatus(text);run.metrics.stage(phase.code,phase.label);const elapsedMs=run.metrics.snapshot().elapsedMs;run.timeline.push({stage:text,code:phase.code,elapsedMs});runLog.event('stage',{stage:phase.code,message:text,elapsedMs});if(run.timeline.length>200)run.timeline.splice(0,run.timeline.length-200);state(text);}}
function beginRun(wc,input,kind){
  if(runner)throw Error('진행 중인 작업을 중지하고 정리가 끝날 때까지 기다려 주세요.');
  if(captchaStatus.busy||manualCaptcha.pending)throw Error('보안문자 테스트를 마치거나 중지한 뒤 시작해 주세요.');
  captchaService?.resetAuto();
  const p=normalizePreferences(input||preferences);preferences=p;
  const run=runs.begin(wc.id,p,kind);runner=run;powerId=powerSaveBlocker.start('prevent-display-sleep');
  diagnosticWarning='';runLog.start(run.id);runLog.event('configuration',{kind,preferences:p});
  run.entry={strategy:'site',offsetMs:0,trigger:null,clockOutcome:'not-configured',requestCount:0,receivedCount:0,failedCount:0,seatPageObserved:false};run.entryRequests=new Set();
  run.entryDocuments=new Map([...targets.values()].map(target=>[target.id,{documentId:target.documentId||null}]));run.entryActionsStarted=false;
  run.triedJobs=new Set();run.excludedIds=new Set();run.excludedGroups=new Set();run.retry=new SeatRetry();seatSearch.resetSearch(run);state('준비 중');return run;
}
function finishRun(run,message){
  if(runs.current!==run)return;
  const metrics=run.metrics.snapshot();
  lastRun={id:run.id,durationMs:metrics.elapsedMs,stages:run.timeline.slice(-80),message,stopReason:run.stopReason||null,failureDetail:run.failureDetail||null,entry:{...run.entry},retry:run.retry?.snapshot(),metrics,diagnosis:diagnosisForRun(run,message)};
  runLog.finish(lastRun);
  try{fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(lastRunPath,JSON.stringify(safeLastRun(lastRun),null,2));if(!runLog.failed)diagnosticWarning='';}
  catch{diagnosticWarning='최근 실행 기록을 파일에 저장하지 못했습니다. 실행 결과는 위에 표시된 내용을 확인해 주세요.';}
  runs.finish(run);runner=null;
  if(powerId!=null&&powerSaveBlocker.isStarted(powerId))powerSaveBlocker.stop(powerId);powerId=null;state(message+(diagnosticWarning?' '+diagnosticWarning:''));
}
async function stopRun(message='자동 진행을 중지했습니다.'){
  captchaService?.cancel();
  manualCaptcha.clear('진행을 중지했습니다. 보안문자 이미지를 다시 확인해 주세요.');
  const run=runs.current;if(!run){if(message)state(message);return;}
  if(!run.stopReason){run.stopReason=message;setRunStatus(run,'중지 사유 · '+message);}
  runs.cancel();
  state(run.status);
  await Promise.allSettled([...run.windowIds].map(id=>{const wc=targets.get(id);return wc&&!wc.isDestroyed()&&wc.missingSince==null?js(wc,'stopWatchers'):null;}));
  await run.task?.catch(()=>{});
  if(runs.current===run)finishRun(run,run.stopReason||message);else state(lastRun?.id===run.id?lastRun.message:message);
}
function targetFor(run){runs.assert(run);const wc=targets.get(run.targetId);if(!wc||wc.isDestroyed())throw Error('실행 대상 창이 닫혔습니다.');assertAvailable(wc);return wc;}
async function runJs(run,wc,fn,arg){runs.assert(run);if(wc.id!==run.targetId)throw Error('실행 대상 창이 변경되었습니다.');const value=await js(wc,fn,arg);runs.assert(run);return value;}
const ENTRY_READ_MOVED=Symbol('entry-read-moved');
function entryReadFailure(message,original,tabId){
  if(['Could not establish connection. Receiving end does not exist.',
    'The message port closed before a response was received.',
    'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
    '사이트 코드 실행 결과를 확인하지 못했습니다. 같은 동작을 반복하지 않습니다.'].includes(message))return 'connection';
  const missing=message.match(/^No document with id ([A-Fa-f0-9-]+) in tab with id (\d+)\.?$/);
  return message==='페이지가 바뀌어 이전 화면의 동작을 취소했습니다.'||message==='지원하는 NOL 예매 탭이 아닙니다.'||
    missing&&missing[1]===original.documentId&&Number(missing[2])===tabId?'navigation':null;
}
async function readEntryPage(run,wc,fn,arg){
  // Only reads may recover when Chrome reports that navigation won the race.
  // Entry/notice/seat mutations must keep their normal no-replay failure path.
  if(![entry.gateStatus,entry.listingState,'gateState','pageClock',directApi.bookingIdentity,flow.scene].includes(fn))throw Error('진입 화면 관찰에 허용되지 않은 동작입니다.');
  const original={documentId:wc.documentId,url:wc.getURL(),version:scopeVersions.get(wc.id)};
  const moved=()=>{
    if(run.kind!=='auto'||run.seatScope)return false;
    if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==original.url)return true;
    if(wc.documentId!==original.documentId||scopeVersions.get(wc.id)!==original.version){
      // A confirmed notice may replace this document once. The normal loop
      // validates its exact URL and scope increment before accepting it.
      if(run.noticeTransition?.id===wc.id)return true;
      throw Error('감시 중이던 준비 화면이 다시 로드되었습니다. 중복 진입을 피하려면 화면 확인 후 새로 시작해 주세요.');
    }
    return false;
  };
  try{const value=await runJs(run,wc,fn,arg);return moved()?ENTRY_READ_MOVED:value;}
  catch(error){
    runs.assert(run);
    const message=String(error?.message||'');
    let failure=entryReadFailure(message,original,wc.id);
    if(!failure||run.kind!=='auto'||run.seatScope)throw error;
    // Chrome can disconnect the old content script before it reports the new
    // document. Keep this run alive through that bounded navigation interval;
    // reconnecting alone is never evidence to retry a booking mutation.
    const deadline=performance.now()+(failure==='connection'?15000:1500);
    let retryAt=performance.now()+250,retries=0;
    runLog.event('entry-transition',{action:typeof fn==='string'?fn:fn.name,result:'waiting',message});
    setRunStatus(run,'예매창 연결 전환 대기 · 새 화면 확인 후 자동으로 계속합니다.');
    while(true){
      if(moved()){runLog.event('entry-transition',{action:typeof fn==='string'?fn:fn.name,result:'observed',message});setRunStatus(run,'예매창 화면 전환 확인 · 새 화면 관찰 계속');return ENTRY_READ_MOVED;}
      if(performance.now()>=deadline)throw error;
      // Re-read only an unchanged document after a connection-level failure.
      // This lets ensureContent reconnect its receiver while the selected run,
      // tab, URL and scope remain pinned. Navigation failures are only observed.
      if(failure==='connection'&&retries<3&&performance.now()>=retryAt){
        retries++;
        try{
          const value=await runJs(run,wc,fn,arg);
          if(moved())return ENTRY_READ_MOVED;
          runLog.event('entry-transition',{action:typeof fn==='string'?fn:fn.name,result:'reconnected',count:retries});
          setRunStatus(run,'예매창 연결 복구 · 같은 실행으로 계속합니다.');return value;
        }catch(retryError){
          runs.assert(run);failure=entryReadFailure(String(retryError?.message||''),original,wc.id);
          if(!failure)throw retryError;
          retryAt=performance.now()+250*2**retries;
        }
      }
      await pause(25,run.signal);runs.assert(run);
    }
  }
}
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
  const sample={attempts:status.attempts,invokeDelayMs:status.invokeDelayMs,requestDelayMs:status.requestDelayMs,timerDelayMs:status.clock?.delayMs};
  const key=JSON.stringify(sample);
  if(key!==run.lastGateTiming&&Object.values(sample).some(Number.isFinite)){run.lastGateTiming=key;runLog.event('entry-trigger',{count:sample.attempts,...sample});}
}
function pinGateDocument(run,wc){
  const doc={windowId:wc.id,version:scopeVersions.get(wc.id)};
  if(run.gateDocument&&(run.gateDocument.windowId!==doc.windowId||run.gateDocument.version!==doc.version))throw Error('감시 중이던 준비 화면이 다시 로드되었습니다. 중복 진입을 피하려면 화면 확인 후 새로 시작해 주세요.');
  run.gateDocument=doc;
}
function pinListingDocument(run,wc){
  const doc={windowId:wc.id,version:scopeVersions.get(wc.id),url:wc.getURL()};
  if(run.listingDocument&&(run.listingDocument.windowId!==doc.windowId||run.listingDocument.version!==doc.version||run.listingDocument.url!==doc.url))throw Error('감시 중이던 경기 목록 화면이 변경되었습니다. 현재 경기를 확인한 뒤 다시 시작해 주세요.');
  run.listingDocument=doc;
}
function rememberListing(run,status){
  if(runs.current!==run||!status||status.runId!==run.id||status.key!==run.game?.key)return;
  run.entry.listingPhase=status.phase;
  if(status.phase==='clicked'){
    run.entry.preparationConfirmed=true;
    run.listingDispatchedAt??=Date.now();
  }
  if(status.clock?.outcome&&status.clock.outcome!=='not-configured')run.entry.clockOutcome=status.clock.outcome;
  if(Number.isFinite(status.invokeDelayMs))run.entry.listingInvokeDelayMs=status.invokeDelayMs;
  if(Number.isFinite(status.clock?.uncertaintyMs))run.entry.clockUncertaintyMs=status.clock.uncertaintyMs;
  const sample={invokeDelayMs:status.invokeDelayMs,timerDelayMs:status.clock?.delayMs};
  const key=JSON.stringify(sample);
  if(key!==run.lastListingTiming&&Object.values(sample).some(Number.isFinite)){run.lastListingTiming=key;runLog.event('listing-trigger',{kind:'listing',...sample});}
}
async function startListingWatch(run,wc){
  const original={documentId:wc.documentId,url:wc.getURL(),version:scopeVersions.get(wc.id)};
  try{
    const status=await runJs(run,wc,entry.armListing,{key:run.game.key,runId:run.id,clockRequired:run.entry.strategy==='clock'&&run.clockEligible,timeoutMs:Math.max(60000,run.openAt-Date.now()+30*60000)});
    if(status?.runId!==run.id||status.key!==run.game.key)throw Error('경기 목록 감시 상태를 확인하지 못했습니다. 중복 실행하지 않고 중지합니다.');
    rememberListing(run,status);
    if(['blocked','timeout','stopped'].includes(status.phase))throw Error(status.reason||'경기 목록의 활성화 감시가 중단됐습니다.');
  }catch(error){
    await observeListingTransition(run,wc,original,error);
  }
}
async function observeListingTransition(run,wc,original,error){
  runs.assert(run);
  const message=String(error?.message||'');
  const missing=message.match(/^No document with id ([A-Fa-f0-9-]+) in tab with id (\d+)\.?$/);
  if(message!=='페이지가 바뀌어 이전 화면의 동작을 취소했습니다.'&&!(missing&&missing[1]===original.documentId&&Number(missing[2])===wc.id))throw error;
  // Arming or installing a clock can invoke immediately. A navigation-lost
  // reply must never lead to repeating either command in another document.
  const deadline=performance.now()+1500;
  while(true){
    if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==original.url){run.entry.listingPhase='transition-unconfirmed';return;}
    if(wc.documentId!==original.documentId||scopeVersions.get(wc.id)!==original.version)throw error;
    if(performance.now()>=deadline)throw error;
    await pause(25,run.signal);runs.assert(run);
  }
}
async function scheduleGateClock(run,wc,status,{listing=false}={}){
  if(run.entry.strategy!=='clock'||!run.clockEligible||run.entry.trigger||run.entry.requestCount||status?.phase!=='armed'||status.clock?.firedAtMono!=null&&status.clock.outcome!=='stale')return;
  const monoNow=performance.now(),estimate=clockForGate(clockInfo,{monoNow});
  const plannedServerNow=estimate?.serverNowMs??Date.now()+(clockInfo?.offsetMs||0);
  // Refresh before opening in the background; never block the activation observer on a clock fetch.
  if(run.openAt-plannedServerNow<=45000&&run.openAt-plannedServerNow>=-60000&&!run.clockTask&&(run.lastClockRefresh==null||monoNow-run.lastClockRefresh>=30000)){
    run.lastClockRefresh=monoNow;
    run.clockTask=syncClock().catch(()=>{if(runs.current===run){run.entry.clockReason='서버 시각 조회 실패 · 예약 진입을 보류합니다. 활성화 감지 방식으로 다시 시작할 수 있습니다.';state();}}).finally(()=>{run.clockTask=null;});
  }
  if(!estimate&&run.openAt+(run.entry.offsetMs||0)+60000<plannedServerNow&&!run.clockTask)throw Error('유효한 서버 시각을 확인하지 못했습니다. 활성화 감지 방식으로 다시 시작해 주세요.');
  if(!estimate){run.entry.clockReason=run.clockTask?'최근 서버 시각 조회 중 · 예약 진입 보류':'유효한 시각 표본이 없어 예약 진입을 보류합니다.';if(!run.clockTask)run.entry.clockOutcome='waiting-sync';return;}
  const offsetMs=run.entry.offsetMs||0;
  if(estimate.validForMs<run.openAt+offsetMs-estimate.serverNowMs||run.clockAppliedAnchor===clockInfo.anchorMonoMs&&run.clockAppliedDocument===status.documentId)return;
  const sample=clockInfo,before=performance.now(),scope=scopeVersions.get(wc.id),url=wc.getURL();
  const page=await readEntryPage(run,wc,'pageClock',listing?{entryStage:'listing'}:undefined);const after=performance.now();
  if(page===ENTRY_READ_MOVED)return;
  if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)return;
  if(scopeVersions.get(wc.id)!==scope||wc.getURL()!==url)throw Error('시각을 연결하는 동안 준비 화면이 변경되었습니다. 다시 시작해 주세요.');
  const pageMono=page?.pageMono;
  const roundTrip=after-before,atPage=clockForGate(sample,{monoNow:(before+after)/2});
  if(!atPage||!Number.isFinite(pageMono)||typeof page.documentId!=='string'||roundTrip>250||atPage.uncertaintyMs+roundTrip/2>501)return;
  if(status.documentId&&page.documentId!==status.documentId)throw Error('시각을 연결하는 동안 진입 감시가 변경되었습니다. 다시 시작해 주세요.');
  let installed;
  const original={documentId:wc.documentId,url,version:scope};
  try{installed=await runJs(run,wc,listing?entry.setListingClock:entry.setGateClock,{runId:run.id,...(listing?{key:run.game.key}:{goodsCode:run.goodsCode}),documentId:page.documentId,source:'ticket-server',openAt:run.openAt,deadlineMono:pageMono+run.openAt-atPage.serverNowMs+offsetMs,validUntilMono:pageMono+atPage.validForMs-roundTrip/2,uncertaintyMs:atPage.uncertaintyMs+roundTrip/2});}
  catch(error){if(!listing)throw error;await observeListingTransition(run,wc,original,error);return;}
  if(installed){run.clockAppliedAnchor=sample.anchorMonoMs;run.clockAppliedDocument=page.documentId;run.entry.clockOutcome='armed';run.entry.clockReason='예약 시각과 사이트 활성화를 확인해 진입합니다.';}
}
async function games(){
  const wc=current();if(!isEntryPage(wc.getURL()))throw new Error('Chrome에서 NOL 경기 목록 페이지를 먼저 열어 주세요.');
  await js(wc,'showAllGames');
  const compatibility=bridge.getState();
  let compatibilityWarning=compatibility.extensionUpdateRequired?compatibility.message:'';
  const pageInfoTask=compatibilityWarning?Promise.resolve(null):js(wc,entry.pageInfo).catch(error=>{
    // Only a positively identified unsupported command may fall back. Connection,
    // document, timeout and parsing failures must remain visible to the caller.
    if(error?.message!=='허용되지 않은 보조 동작입니다.'&&error?.message!=='허용되지 않은 Chrome 동작입니다.')throw error;
    compatibilityWarning='Chrome 확장의 안내 읽기 기능이 이전 버전입니다. v0.9 폴더의 chrome-extension을 등록하고 새 코드로 연결해 주세요.';return null;
  });
  const [rows,pageInfo]=await Promise.all([js(wc,entry.gameCards),pageInfoTask]);
  const message=rows.length?'경기 목록을 읽었습니다. 경기별로 판매 시작 시각의 확인 여부를 표시합니다.':pageInfo?.empty?'현재 페이지에 등록된 예매 경기가 없습니다. 공개된 안내는 아래에서 확인할 수 있습니다.':pageInfo?.cardCount?'경기는 표시되지만 도우미가 경기 정보를 읽지 못했습니다. Chrome에서 직접 확인해 주세요.':'경기 목록을 확인하지 못했습니다. 페이지 로딩과 화면을 확인한 뒤 다시 불러와 주세요.';
  let publicSchedules=[],scheduleError='';
  if(rows.length&&!compatibilityWarning){try{const response=await js(wc,publicGame.resolveGame,{keys:rows.map(g=>g.key),includeSchedule:true});if(!Array.isArray(response))throw Error('경기 시각 응답 형식이 다릅니다.');publicSchedules=response;}catch(error){scheduleError='공식 API 조회 실패 · '+error.message;}}
  return {games:rows.map(g=>{
    const official=publicSchedules.find(row=>row.key===g.key),cardOpenAt=parseOpening(g.schedule),apiOpenAt=official?.openAt;
    const conflict=apiOpenAt!=null&&cardOpenAt!=null&&apiOpenAt!==cardOpenAt;
    return {...g,openAt:conflict?null:apiOpenAt??cardOpenAt,endAt:official?.endAt??null,openingSource:conflict?null:apiOpenAt!=null?'공식 경기 API':cardOpenAt!=null?'경기 카드 공지':null,openingReason:conflict?'카드 공지와 공식 API의 시작 시각이 다릅니다.':apiOpenAt==null&&cardOpenAt==null?(scheduleError||official?.openingReason||'공식 일반 예매 시작 시각을 확인하지 못했습니다.'):null};
  }),pageInfo,compatibilityWarning,message:message+(compatibilityWarning?' '+compatibilityWarning:'')};
}
function selectionAdapter(wc,run){
  const initialUrl=wc.getURL(),scope=scopeVersions.get(wc.id);
  const assertScope=()=>{
    if(runs.current!==run||wc.isDestroyed()||run.targetId!==wc.id)throw Error('실행 대상이 변경되었습니다.');
    const url=wc.getURL();let next=false;try{const u=new URL(url);next=u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price';}catch{}
    if(!next&&(scope!==scopeVersions.get(wc.id)||url!==initialUrl))throw Error('경기 또는 회차가 변경되어 중지했습니다.');
  };
  return {
    snapshot:async()=>{assertScope();const scene=await js(wc,flow.scene);const network=await networkSnapshot(wc);assertScope();return {...scene,network};},
    select:async row=>{assertScope();try{await measured(wc,'seat-select',()=>wc.seatAction(row,'click'));}catch(error){if(error.message.includes('SEAT_UNAVAILABLE:'))throw new selection.SelectionError('선택 전에 사이트에서 좌석이 선택 불가로 변경되었습니다.','conflict',[row.id]);throw error;}},
    deselect:async id=>{assertScope();return js(wc,flow.deselect,id);},
    complete:async()=>{assertScope();return js(wc,flow.clickKnown,'선택 완료');},
    dismissConflict:async()=>{assertScope();return js(wc,flow.dismissConflict);},
    dismissEmptySelection:async()=>{assertScope();return js(wc,flow.dismissEmptySelection);}
  };
}
async function candidatesFor(wc,p,options={}){
  const url=wc.getURL(),scope=scopeVersions.get(wc.id);
  const data=await measured(wc,'seat-read',()=>wc.readSeats());
  if(wc.isDestroyed()||wc.getURL()!==url||scopeVersions.get(wc.id)!==scope)throw Error('후보를 읽는 동안 경기 또는 회차가 변경되었습니다.');
  const rows=metadata.enrich(data.rows,metaStores.get(wc.id),gradeStores.get(wc.id));
  const groups=await measured(wc,'candidate-rank',()=>rankGroups(rows,p,options));
  return {data,rows,groups};
}
function rankRunSeats(run,wc,rows,{remember=true}={}){
  const scattered=run.preferences.requireTogether===false;
  if(scattered&&remember)seatSearch.rememberMap(run,rows);
  const pool=scattered?metadata.enrich(seatSearch.pooledSeats(run),metaStores.get(wc.id),gradeStores.get(wc.id)):rows;
  const tier=run.currentJob?.tierIndex;
  return rankGroups(pool.filter(seat=>!run.priceExcludedGrades?.has(String(seat.gradeCode))),run.preferences,{...(scattered?{maxTierIndex:tier}:{tierIndex:tier}),excludedIds:run.excludedIds,excludedGroups:run.excludedGroups});
}
async function refreshChangedSeats(wc,run,ids,seats){
  const scope=scopeVersions.get(wc.id),documentId=wc.documentId;
  const changed=new Set(ids),blocks=[...new Set(seats.filter(seat=>changed.has(seat.id)).map(seat=>seat.blockKey).filter(Boolean))];
  if(!blocks.length)throw Error('변경된 좌석의 블록을 확인하지 못했습니다. 최신 지도를 다시 열어 주세요.');
  run.metadataRefreshCounts??=new Map();
  for(const id of changed){const count=(run.metadataRefreshCounts.get(id)||0)+1;run.metadataRefreshCounts.set(id,count);if(count>1)run.excludedIds.add(id);}
  for(let index=0;index<blocks.length;index+=2){
    const keys=blocks.slice(index,index+2);
    const details=await runJs(run,wc,seatDetails.readDetails,{expected:run.expectedBooking,blockKeys:keys,includeGrades:true,expiresAt:Date.now()+20000});
    if(wc.documentId!==documentId||scopeVersions.get(wc.id)!==scope)throw Error('좌석 변경 정보를 읽는 동안 경기 또는 문서가 바뀌었습니다.');
    const store=metaStores.get(wc.id),fresh=metadata.parseMetadata(details.blocks),freshIds=new Set(fresh.map(row=>row.id));
    for(const [id,row] of store)if(keys.includes(row.blockKey)){store.delete(id);if(!freshIds.has(id))run.excludedIds.add(id);}
    for(const row of fresh)store.set(row.id,row);
    for(const id of changed)if(!freshIds.has(id)&&seats.some(seat=>seat.id===id&&keys.includes(seat.blockKey)))run.excludedIds.add(id);
    applyGradeDetails(wc,details,run);
  }
  seatSearch.forgetSeats(run,run.excludedIds);
  runLog.event('seat-metadata-changed',{count:ids.length,message:'선점 전 좌석 상세 변경 확인 · 최신 정보로 조건 재평가'});
}
function applyGradeDetails(wc,data,run){
  const store=gradeStores.get(wc.id);if(!store)return;
  const previousGrades=new Map(store);
  const conflicts=[...(data.gradeConflicts||[])];
  for(const grade of data.grades||[]){
    if(store.has(grade.code)&&store.get(grade.code)===null)continue;
    const previous=store.get(grade.code);
    if(previous&&labelKey(previous)!==labelKey(grade.name))conflicts.push({code:grade.code,names:[previous,grade.name]});
    else store.set(grade.code,grade.name);
  }
  // A conflicting global mapping stays unresolved for this document/round.
  // A later single-row response must not silently restore an arbitrary alias.
  for(const conflict of conflicts)store.set(conflict.code,null);
  if(run){
    run.gradeConflicts??=new Map();
    for(const grade of data.grades||[])if(store.get(grade.code)!=null)run.gradeConflicts.delete(grade.code);
    for(const conflict of conflicts)run.gradeConflicts.set(conflict.code,conflict);
    if(conflicts.length||data.duplicateCount)runLog.event('grade-names',{gradeCount:data.grades?.length||0,duplicateCount:data.duplicateCount||0,gradeConflicts:conflicts,conflictCount:conflicts.length});
    if(store.size!==previousGrades.size||[...store].some(([code,name])=>!previousGrades.has(code)||previousGrades.get(code)!==name))releaseMetadataCooldown(run,'grade-names');
  }
}
function releaseMetadataCooldown(run,reason){
  if(!run||run.signal.aborted||!run.metadataCooldown?.size)return;
  let changed=0;
  for(const [key,until] of run.metadataCooldown){
    if(until!==0)changed++;
    // Keep the entry so reopening this job resets its bounded detail-read cache.
    run.metadataCooldown.set(key,0);run.triedJobs.delete(key);
  }
  if(changed)runLog.event('metadata-retry',{reason,count:changed,message:'좌석 상세 정보 변경 확인 · 해당 구역 즉시 재확인'});
}
function hasSeatDetails(row){return !!row.grade&&(Number.isInteger(row.row)&&Number.isInteger(row.number)||metadata.isWheelchairSingleton(row));}
async function recoverSeatDetails(run,wc,rows){
  if(wc.isDemo())return false;
  const missing=rows.filter(r=>r.kind==='seat'&&!hasSeatDetails(r));
  if(!missing.length)return false;
  run.detailsReadBlocks??=new Set();
  // A cached row can still be incomplete. Refresh each visible block once per
  // visit; its presence in the cache is not proof that row/number/grade exists.
  const blockKeys=[...new Set(missing.map(r=>r.group).filter(g=>typeof g==='string'&&g.startsWith('seat_block_')).map(g=>g.slice(11)))].filter(k=>!run.detailsReadBlocks.has(k)).slice(0,2);
  const includeGrades=!run.detailsReadGrades;
  if(!blockKeys.length&&!includeGrades)return false;
  const scope=scopeVersions.get(wc.id),documentId=wc.documentId;
  const identity=directApi.assertIdentity(run.expectedBooking,await runJs(run,wc,directApi.bookingIdentity));
  const expected=Object.fromEntries(['goodsCode','placeCode','playSeq'].map(k=>[k,identity[k]]));
  blockKeys.forEach(k=>run.detailsReadBlocks.add(k));
  setRunStatus(run,'누락된 좌석 열·번호·등급 정보 조회 · 좌석 선택 요청 없음');
  const data=await runJs(run,wc,seatDetails.readDetails,{expected,blockKeys,includeGrades,expiresAt:Date.now()+20000});
  if(wc.documentId!==documentId||scopeVersions.get(wc.id)!==scope)throw Error('좌석 상세 조회 중 경기 또는 문서가 바뀌었습니다.');
  for(const row of metadata.parseMetadata(data.blocks))metaStores.get(wc.id).set(row.id,row);
  applyGradeDetails(wc,data,run);
  runLog.event('seat-details',{blockCount:data.blocks.length,gradeCount:data.grades.length,conflictCount:data.gradeConflicts?.length||0,durationMs:data.timings?.totalMs});
  for(const [kind,durationMs] of Object.entries(data.timings||{}))runLog.event('seat-detail-timing',{kind,durationMs});
  if(includeGrades)run.detailsReadGrades=true;
  run.gradeOpenedAt=Date.now();return true;
}
async function selectCandidates(wc,run,groups){
  if(!wc.isDemo()){
    let attempted=0,priceUnavailable=false;
    for(const group of groups){
      runs.assert(run);const key=JSON.stringify(group.seats.map(v=>v.id).sort());if(run.excludedGroups.has(key)||group.seats.some(v=>run.excludedIds.has(v.id)||run.priceExcludedGrades?.has(String(v.gradeCode))))continue;
      if(attempted>=20)return {completed:false,exhausted:true,limited:true,attempted,priceUnavailable};
      attempted++;run.retry.attempted++;
      const breakdown=group.tierCounts?.map((count,index)=>count?`${index+1}순위 ${count}매`:null).filter(Boolean).join(' · ');
      runLog.event('seat-candidate-attempt',{kind:group.fallback?'fallback':'priority',message:breakdown||group.tierName||'기본 조건',cycle:run.retry.cycle,count:run.retry.attempted,selectedCount:group.seats.length,blockCount:new Set(group.seats.map(seat=>seat.blockKey||seat.block)).size});
      const result=await runHttpBooking(wc,run,{seats:group.seats});
      if(result.priceUnavailable){
        run.priceExcludedGrades??=new Set();for(const grade of result.unavailableGrades)run.priceExcludedGrades.add(grade);
        priceUnavailable=true;setRunStatus(run,result.message);continue;
      }
      if(result.changedIds){await refreshChangedSeats(wc,run,result.changedIds,group.seats);return {completed:false,retrySeats:true,attempted};}
      if(result.conflict){run.excludedGroups.add(key);for(const id of result.unavailableIds||[])run.excludedIds.add(id);seatSearch.forgetSeats(run,result.unavailableIds||[]);continue;}
      return {...result,attempted};
    }
    return {completed:false,exhausted:true,attempted,priceUnavailable};
  }
  const result=await selection.chooseCandidates({groups,adapter:selectionAdapter(wc,run),signal:run.signal,preferences:run.preferences,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups,onStatus:text=>setRunStatus(run,text)});
  run.retry.attempted+=result.attempted||0;if(result.selectedIds)run.priceOwnedIds=result.selectedIds;return result.completed?finishPriceSelection(wc,run,result):result;
}
async function runHttpBooking(wc,run,{seats,resumePrice=false,resumeSelected=false}={}){
  const identity=directApi.assertIdentity(run.expectedBooking,await runJs(run,wc,directApi.bookingIdentity));
  const expected=Object.fromEntries(['goodsCode','placeCode','playSeq'].map(k=>[k,identity[k]]));
  const runId=String(run.id)+':'+Date.now()+':'+(run.httpAttempt=(run.httpAttempt||0)+1);
  const expiresAt=Date.now()+120000;
  const capability=await runJs(run,wc,httpBooking.httpBookingNavigate,{runId,expected,checkOnly:true,expiresAt:Date.now()+10000});
  if(capability?.supported!==true)throw Error('사이트의 HTTP 진행·화면 동기화 지원을 확인하지 못했습니다. 좌석 요청 전에 중지했습니다.');
  let status=await runJs(run,wc,httpBooking.httpBookingAction,{action:'begin',runId,expected,seats,quantity:run.preferences.quantity,resumePrice,resumeSelected,stopAfterSeats:!run.preferences.autoComplete&&!resumeSelected&&!resumePrice,expiresAt});
  const labels={metadata:'좌석 코드·열·번호 HTTP 대조',prices:'좌석 등급별 일반 가격 HTTP 조회',status:'후보 구역의 최신 좌석 상태 HTTP 확인',preselect:'좌석 HTTP 선점',confirm:'선택 완료 HTTP 요청',validate:'일반 가격 수량 계산 · 가격 검증 HTTP 요청',release:'선점 충돌 · 확보한 좌석 HTTP 해제',ready:'가격 검증 승인 · 다음 화면 이동 준비'};
  let priceAssessmentLogged=false;
  while(Date.now()<expiresAt){
    runs.assert(run);
    if(!status||!['metadata','prices','status','preselect','confirm','validate','release','ready','selected','released','rejected'].includes(status.stage)||!['pending','conflict','uncertain','blocked'].includes(status.status)||!Number.isInteger(status.requestCount))throw Error('HTTP 진행 상태 응답 형식을 확인하지 못했습니다. 추가 요청 없이 중지합니다.');
    if(status.priceAssessment&&!priceAssessmentLogged){runLog.event('price-selection',{priceAssessment:status.priceAssessment});priceAssessmentLogged=true;}
    runLog.event('http-booking',{stage:status.stage,result:status.status,message:[status.code,status.apiCode].filter(Boolean).join(' '),status:status.httpStatus,count:status.requestCount,selectedCount:status.heldCount});
    if(status.status==='conflict'){setRunStatus(run,'충돌 좌석 HTTP 해제 확인 · 다음 후보');return {completed:false,conflict:true,unavailableIds:status.unavailableIds};}
    if(status.status==='blocked'&&status.code==='HTTP_METADATA_CHANGED'&&status.heldCount===0&&Array.isArray(status.changedIds)&&status.changedIds.length&&status.changedIds.every(id=>seats?.some(seat=>seat.id===id)))return {completed:false,changedIds:status.changedIds};
    if(!resumePrice&&!resumeSelected&&status.status==='blocked'&&status.code==='STANDARD_PRICE_UNAVAILABLE'&&status.heldCount===0){
      const assessed=Array.isArray(status.priceAssessment?.groups)?status.priceAssessment.groups:[];
      const counts=new Map();for(const seat of seats||[]){const grade=String(seat.gradeCode);counts.set(grade,(counts.get(grade)||0)+1);}
      const completeAssessment=assessed.length===counts.size&&new Set(assessed.map(group=>group?.seatGrade)).size===counts.size
        &&assessed.every(group=>group&&counts.get(group.seatGrade)===group.seatCount&&Array.isArray(group.options)&&group.options.length
          &&(group.selectedIndex===null||Number.isSafeInteger(group.selectedIndex)&&group.selectedIndex>=0&&group.options.some(option=>option?.index===group.selectedIndex&&option.eligible===true)));
      const failed=assessed.filter(group=>group?.selectedIndex===null);
      const qualificationReasons=['PRICE_REQUIRES_CERTIFICATION','PRICE_REQUIRES_QUALIFICATION','PRICE_DISCOUNT_UNSUPPORTED'];
      // Only a complete, understood price list can exclude a grade. Unknown
      // formats, amounts or rules and quantity-only failures still stop below.
      if(completeAssessment&&failed.length&&failed.every(group=>group.options.every(option=>option?.eligible===false&&Array.isArray(option.reasons)
          &&option.reasons.some(reason=>qualificationReasons.includes(reason))
          &&option.reasons.every(reason=>qualificationReasons.includes(reason)||reason==='PRICE_QUANTITY_LIMIT')))){
        const unavailableGrades=[...new Set(failed.map(group=>group.seatGrade))];
        const message='자격·할인 조건 가격만 있는 구역을 제외하고 다음 후보를 확인합니다.';
        runLog.event('seat-price-unavailable',{reason:'qualification-only-prices',message,priceAssessment:status.priceAssessment,gradeCount:unavailableGrades.length});
        return {completed:false,priceUnavailable:true,unavailableGrades,message};
      }
    }
    if(['uncertain','blocked'].includes(status.status)){
      const explanation=({STANDARD_PRICE_UNAVAILABLE:'현재 좌석 등급에서 자동 적용할 수 있는 일반 가격이 없습니다.',PRICE_GRADE_AMBIGUOUS:'좌석 등급과 가격 등급의 연결을 확정하지 못했습니다.',PRICE_RESPONSE_UNSUPPORTED:'사이트의 가격 목록 형식을 확인하지 못했습니다.',ADULT_PRICE_AMBIGUOUS:'일반 가격을 확인하지 못했습니다. 확장 업데이트 적용 후 다시 확인해 주세요.',PRICE_REQUIRES_CERTIFICATION:'추가 인증이 필요한 가격이어서 자동 제출하지 않았습니다.',PRICE_RULE_UNSUPPORTED:'현재 가격의 이용 조건을 자동으로 확인할 수 없습니다.',PRICE_QUANTITY_LIMIT:'선택한 가격의 매수 조건을 충족하지 않습니다.',HTTP_CONTEXT_CHANGED:'처리 중 경기·세션 또는 선택 내용이 바뀌었습니다.',HTTP_OUTCOME_UNKNOWN:'서버의 처리 결과를 확정하지 못해 중복 요청 없이 멈췄습니다.',HTTP_CONFIRMATION_UNKNOWN:'선택 완료 응답 형식을 확인하지 못했습니다.',HTTP_SESSION_EXPIRED:'예매 세션 또는 좌석 유지 시간이 만료됐습니다.',HTTP_PAGE_BLOCKED:'사이트 안내 또는 로딩이 있어 요청을 중지했습니다.'})[status.code]||'HTTP 진행 조건 또는 응답을 확인하지 못했습니다.';
      throw Error(explanation+' ['+status.code+'] 자동 로그를 확인해 주세요. 기존 선택은 임의로 재요청하지 않았습니다.');
    }
    setRunStatus(run,labels[status.stage]||'HTTP 진행 상태 확인');
    if(['ready','selected'].includes(status.stage))break;
    status=await runJs(run,wc,httpBooking.httpBookingAction,{action:'step',runId});
  }
  if(status.stage==='selected'){await runJs(run,wc,httpBooking.httpBookingNavigate,{runId,expected,syncOnly:true,expiresAt:Date.now()+10000});return {completed:false,selectedIds:seats.map(v=>v.id),message:run.preferences.quantity+'매 좌석 HTTP 선점과 화면 반영을 확인했습니다. 선택 완료·가격 요청은 보내지 않았습니다.'};}
  if(status.stage!=='ready')throw Error('HTTP 처리 제한 시간이 지났습니다. 기존 요청을 재전송하지 않았습니다.');
  runs.assert(run);
  // Navigation can replace the document before its acknowledgement returns.
  // Observe the destination even on a lost acknowledgement; never replay it.
  let navigationError;
  try{await runJs(run,wc,httpBooking.httpBookingNavigate,{runId,expected,expiresAt:Date.now()+10000});}catch(error){navigationError=error;}
  const until=Date.now()+15000;
  while(Date.now()<until){
    const progress=await js(wc,pricePage.bookingProgress).catch(()=>null);
    if(progress?.ready)return {completed:true,bookingAdvanced:true,standardPriceSelected:true,httpRequestCount:status.requestCount,message:run.preferences.quantity+'매 좌석·일반 가격 HTTP 승인 및 다음 화면 도착을 확인했습니다. 결제는 진행하지 않았습니다.'};
    runs.assert(run);if(progress?.blocked)throw Error('HTTP 승인 후 사이트 안내가 표시되었습니다. '+progress.message);
    if(navigationError&&wc.getURL().includes('/onestop/seat')&&/HTTP_/.test(navigationError.message))throw navigationError;
    await pause(100,run.signal);
  }
  throw Error('HTTP 승인은 확인했지만 다음 화면 도착을 확인하지 못했습니다. 화면 이동이나 요청을 반복하지 않았습니다.');
}
async function recoverPriceSelection(wc,run,dialog){
  if(dialog)await runJs(run,wc,dialog.kind==='conflict'?flow.dismissConflict:flow.dismissEmptySelection);
  const until=Date.now()+10000;
  setRunStatus(run,'좌석 거절 안내 확인 · 좌석 화면으로 돌아가 최신 후보 재탐색');
  while(Date.now()<until){
    runs.assert(run);
    directApi.assertIdentity(run.expectedBooking,await runJs(run,wc,directApi.bookingIdentity));
    const scene=await runJs(run,wc,flow.scene);
    if(scene.dialog){
      if(!dialog||scene.dialog.kind!==dialog.kind)throw Error('좌석 복구 중 추가 안내를 확인해 주세요. '+scene.dialog.text);
      await pause(100,run.signal);continue;
    }
    const state=await runJs(run,wc,pricePage.returnToSeats);
    if(state.returned){
      const adapter=selectionAdapter(wc,run);
      const cleared=await selection.rollback(adapter,new Set(run.priceOwnedIds||[]),{timeoutMs:8000,pollMs:40,observationGraceMs:160});
      runs.assert(run);
      if(!cleared)throw Error('좌석 복구 후 기존 선택을 확인하지 못했습니다. 현재 선택을 확인해 주세요.');
      if(run.priceOwnedIds?.length)run.excludedGroups.add(JSON.stringify([...run.priceOwnedIds].sort()));
      run.priceOwnedIds=[];run.gradeOpenedAt=Date.now();
      return {completed:false,retrySeats:true,message:'거절된 좌석을 정리하고 다음 후보를 확인합니다.'};
    }
    await pause(100,run.signal);
  }
  throw Error('좌석 거절 안내 후 좌석 화면으로 돌아가지 못했습니다. 이전 버튼을 중복 실행하지 않았습니다.');
}
async function finishPriceSelection(wc,run,result={completed:true}){
  if(wc.isDemo()||run.signal.aborted)return result;
  if(!run.preferences.autoComplete)return {...result,message:'이미 가격 화면에 도착해 있습니다. 좌석 선택까지만 실행하는 설정이므로 추가 요청 없이 멈췄습니다.'};
  return runHttpBooking(wc,run,{resumePrice:true});
}
// Retained for historical fixture coverage; production HTTP runs never invoke
// these legacy DOM price controls or use them as a fallback.
async function legacyFinishPriceSelection(wc,run,result={completed:true}){
  const until=Date.now()+10000;
  setRunStatus(run,'선택 좌석 및 가격 수량 확인 · 예매가/성인 선택');
  while(Date.now()<until){
    runs.assert(run);
    directApi.assertIdentity(run.expectedBooking,await runJs(run,wc,directApi.bookingIdentity));
    const scene=await runJs(run,wc,flow.scene);
    const notice=noticeState(scene);
    if(notice.present){await acknowledgeNotice(run,wc,notice);await pause(100,run.signal);continue;}
    noticeAbsent(run);
    if(['empty-selection','conflict'].includes(scene.dialog?.kind)&&scene.dialog.dismissible)return recoverPriceSelection(wc,run,scene.dialog);
    if(scene.dialog)throw Error('가격 선택 중 사이트 안내가 표시되었습니다. '+scene.dialog.text);
    const state=await runJs(run,wc,pricePage.priceState);
    if(state.rejected)return recoverPriceSelection(wc,run);
    if(state.ready){
      if(state.quantity!==run.preferences.quantity)throw Error('가격 화면의 좌석 수가 요청한 수량과 다릅니다.');
      if(scene.busy){await pause(100,run.signal);continue;}
      const step=await runJs(run,wc,pricePage.adultPriceStep,{quantity:run.preferences.quantity});
      if(step.status==='manual')return {...result,completed:true,adultPriceSelected:false,message:step.message};
      if(step.status==='complete')return finishBookingButton(wc,run,{...result,adultPriceSelected:true});
    }
    await pause(100,run.signal);
  }
  throw Error('좌석 또는 성인 가격 수량의 화면 반영을 확인하지 못했습니다. 현재 선택을 유지합니다.');
}
async function finishBookingButton(wc,run,result){
  const until=Date.now()+15000;let dispatched=false;
  setRunStatus(run,run.preferences.quantity+'매 예매하기 · 다음 화면 응답 확인');
  while(Date.now()<until){
    runs.assert(run);
    if(!dispatched){
      directApi.assertIdentity(run.expectedBooking,await runJs(run,wc,directApi.bookingIdentity));
      const sent=await runJs(run,wc,pricePage.proceedBooking,{quantity:run.preferences.quantity});
      dispatched=sent.dispatched===true;
    }
    const progress=await runJs(run,wc,pricePage.bookingProgress);
    if(progress.blocked){
      const scene=await runJs(run,wc,flow.scene);
      if(['empty-selection','conflict'].includes(scene.dialog?.kind)&&scene.dialog.dismissible)return recoverPriceSelection(wc,run,scene.dialog);
      throw Error('예매하기 후 사이트 안내가 표시되었습니다. '+progress.message);
    }
    if(progress.ready)return {...result,completed:true,bookingAdvanced:true,message:run.preferences.quantity+'매 예매하기 후 다음 화면 도착을 확인했습니다. 결제는 진행하지 않았습니다.'};
    await pause(100,run.signal);
  }
  throw Error('예매하기 후 다음 화면 도착을 확인하지 못했습니다. 중복 요청하지 않았으니 Chrome의 현재 화면을 확인해 주세요.');
}
function launch(run,task){
  const stopWatchers=()=>Promise.allSettled([...run.windowIds].map(id=>{const wc=targets.get(id);return wc&&!wc.isDestroyed()&&wc.missingSince==null?js(wc,'stopWatchers'):null;}));
  run.task=(async()=>{try{const result=await task();if(result?.completed===true)run.outcome=result.bookingAdvanced?'booking-advanced':'price-confirmed';await stopWatchers();finishRun(run,result?.message||'작업이 끝났습니다.');return result;}catch(error){run.failureDetail=error.message;await stopWatchers();finishRun(run,run.stopReason||(run.signal.aborted?'중지했습니다. ':'')+error.message);throw error;}})();
  run.task.catch(()=>{});return run.task;
}
async function startRun(payload){
  const extensionVersion=bridge.getState().extensionVersion;
  if(extensionVersion!==undefined&&!seatExtensionCompatible(extensionVersion))throw Error('좌석 등급별 일반 가격 선택에는 v0.9.27 이상 Chrome 확장이 필요합니다. 확장 업데이트 적용 후 다시 연결해 주세요.');
  if(bridge.getState().bookingNoticeSupported===false)throw Error('예매 안내를 처리하려면 v0.9 폴더의 chrome-extension을 등록하고 새 코드로 다시 연결해 주세요.');
  const requestedPreferences=normalizePreferences(payload?.preferences||preferences);
  if(extensionVersion!==undefined&&!/^0\.9\.(?:[7-9]|[1-9]\d+)$/.test(String(extensionVersion)))throw Error('경기 식별 검증에는 v0.9.7 Chrome 확장이 필요합니다.');
  if(requestedPreferences.stopAfterCaptcha&&extensionVersion!==undefined){
    const v=String(extensionVersion).split('.').map(Number);
    if(v.length!==3||v.some(n=>!Number.isInteger(n))||!(v[0]>0||v[0]===0&&(v[1]>9||v[1]===9&&v[2]>=6)))throw Error('보안문자 후 기록 모드에는 v0.9.6 이상 Chrome 확장이 필요합니다.');
  }
  if(!requestedPreferences.manualCaptchaAssist&&requestedPreferences.autoCaptcha!==false&&!payload?.inspectionOnly&&bridge.getState().captchaSupported===false)throw Error('보안문자 자동 인식에는 v0.9 Chrome 확장이 필요합니다. 새 확장을 연결해 주세요.');
  const wc=current(),isGate=/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+(?:[/?#]|$)/.test(wc.getURL()),isSeat=liveAdapter.supportedUrl(wc.getURL())||wc.isDemo();
  if(!isEntryPage(wc.getURL())&&!isGate&&!isSeat)throw Error('경기 목록 또는 해당 경기의 예매 준비·좌석 화면에서 시작해 주세요.');
  const offsetMs=payload?.entryOffsetMs??0;
  if(!Number.isInteger(offsetMs)||offsetMs < -250||offsetMs > 250)throw Error('진입 시각 보정은 -250~250ms 범위의 정수로 입력해 주세요.');
  const run=beginRun(wc,payload?.preferences,'auto');
  run.inspectionOnly=payload?.inspectionOnly===true;run.entry.offsetMs=offsetMs;
  run.entry.startPage=isSeat?'seat':isGate?'gate':'listing';
  runLog.event('entry-origin',{kind:run.entry.startPage});
  run.entry.strategy=payload?.entryStrategy==='clock'?'clock':'site';
  if(run.entry.strategy==='clock'){run.entry.clockOutcome='waiting-sync';run.entry.clockReason='공식 오픈 시각과 최근 서버 시각을 확인합니다.';}
  launch(run,async()=>{
    await ensureNetwork(wc);runs.assert(run);
    if(isSeat){
      run.openAt=Date.now();run.entry.strategy='current-seat';run.entry.seatPageObserved=true;
      setRunStatus(run,'현재 좌석 화면에서 시작 · 새 진입 요청 없음');
    }
    else if(isGate){
      run.entryActionsStarted=true;const gateUrl=wc.getURL(),gate=await readEntryPage(run,wc,entry.gateStatus,{});
      if(gate!==ENTRY_READ_MOVED&&run.targetId===wc.id&&wc.missingSince==null&&wc.getURL()===gateUrl){if(!gate.supported)throw Error('예매 준비 화면을 확인하지 못했습니다.');run.goodsCode=gate.goodsCode;}
      let official=null;
      if(payload.openAt==null){try{official=await readPostseasonOpening(run.goodsCode,(url,options)=>net.fetch(url,options));}catch(error){runLog.event('opening-time',{message:error.message});}}
      runs.assert(run);
      Object.assign(run,openingPlan({requested:payload.openAt,official:official?.openAt,strategy:run.entry.strategy}));
      if(official?.placeCode)run.expectedBooking={goodsCode:run.goodsCode,placeCode:official.placeCode};
      runLog.event('opening-time',{message:'준비 화면 예약 '+new Date(run.openAt).toISOString(),kind:payload.openAt!=null?'사용자 지정':'공식 경기 API'});
    }
    else{
      pinListingDocument(run,wc);
      const all=await runJs(run,wc,entry.gameCards);const game=all.find(g=>g.key===payload?.key);if(!game)throw Error('대상 경기를 먼저 선택해 주세요.');
      const official=await runJs(run,wc,publicGame.resolveGame,{key:game.key,includeSchedule:true});
      pinListingDocument(run,wc);
      run.expectedBooking=Object.fromEntries(['goodsCode','placeCode','playDate','playTime'].filter(k=>official[k]!=null).map(k=>[k,official[k]]));run.goodsCode=run.expectedBooking.goodsCode;
      const officialOpenAt=official.openAt??parseOpening(game.schedule);
      run.game=game;run.openAt=payload.openAt==null?(officialOpenAt??Date.now()):Number(payload.openAt);
      runLog.event("opening-time",{message:officialOpenAt==null?"공식 시각 미확인":"공식 시작 "+new Date(officialOpenAt).toISOString(),kind:official.openingSource||"card"});
      if(!Number.isFinite(run.openAt)||run.openAt>Date.now()+15*86400000)throw Error('15일 이내의 오픈 시각을 입력해 주세요.');
      run.clockEligible=run.entry.strategy==='clock'&&Number.isFinite(run.openAt)&&(officialOpenAt!=null||payload.openAt!=null);
      run.entryActionsStarted=true;
      await startListingWatch(run,wc);
      setRunStatus(run,'선택한 경기의 예매 버튼 활성화 대기');
    }
    if(run.entry.strategy==='clock'&&!run.clockEligible){run.entry.clockOutcome='fallback';run.entry.clockReason='예약할 시각이 지정되지 않아 사이트 활성화 감지를 사용합니다.';}
    return await autoLoop(run);
  });
  return {message:isSeat?'현재 좌석 화면에서 진행을 시작했습니다. 이미 선택한 좌석이 있으면 확인을 위해 중지합니다.':'예매 준비를 시작했습니다. 중지하면 진행 중인 선택 정리까지 확인합니다.'};
}
async function inspectRun(payload={}){
  const input=normalizePreferences(payload.preferences||preferences),status=bridge.getState(),wc=targets.get(active);
  const context={connected:status.connected===true,extensionUpdateRequired:status.extensionUpdateRequired===true,extensionVersion:status.extensionVersion,target:!!wc&&!wc.isDestroyed(),preferences:input,inspectionOnly:payload.inspectionOnly===true};
  const id=wc?.id,documentId=wc?.documentId,url=wc?.getURL(),scope=scopeVersions.get(id);
  context.pageStage=wc&&(liveAdapter.supportedUrl(url)||wc.isDemo())?'seat':isEntryPage(url)?'listing':/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+(?:[/?#]|$)/.test(url||'')?'gate':'unsupported';
  if(context.connected&&context.target&&!context.extensionUpdateRequired&&context.pageStage!=='unsupported'){
    try{
      await ensureNetwork(wc);context.networkHealthy=(await networkSnapshot(wc)).healthy===true;
      if(context.pageStage==='seat'){
        context.scene=await js(wc,flow.scene);
        if(context.scene.hasSeats){
          const data=await wc.readSeats(),rows=metadata.enrich(data.rows,metaStores.get(id),gradeStores.get(id));
          context.seats={visible:rows.filter(r=>r.kind==='seat').length,detailed:rows.filter(r=>r.kind==='seat'&&hasSeatDetails(r)).length,groups:rankGroups(rows,input).length,alphaRows:rows.some(r=>r.rowKind==='alpha'),singletonCount:rows.filter(metadata.isWheelchairSingleton).length,explicitRowBounds:input.tiers.some(t=>t.minRow!=null||t.maxRow!=null)};
        }
        if(!wc.isDemo()&&!context.scene.captcha&&!context.scene.busy&&!context.scene.dialog&&!context.scene.completed&&!context.scene.selected?.length&&!noticeState(context.scene).present){
          try{const expected=directApi.assertIdentity(null,await js(wc,directApi.bookingIdentity));context.httpCapability=await js(wc,httpBooking.httpBookingNavigate,{runId:'preflight-'+Date.now(),expected,checkOnly:true,expiresAt:Date.now()+10000});}
          catch(error){context.httpCapability={supported:false,code:error.message};}
        }
      }
    }catch{context.readFailed=true;context.networkHealthy??=false;}
  }
  if(wc&&(active!==id||targets.get(id)!==wc||wc.documentId!==documentId||wc.getURL()!==url||scopeVersions.get(id)!==scope||wc.missingSince!=null))throw Error('점검 중 대상 화면이 바뀌었습니다. 현재 탭에서 다시 점검해 주세요.');
  preflightResult={...buildPreflight(context),checkedAt:Date.now()};state();return {...preflightResult,preflight:preflightResult};
}
async function saveObservation(wc,run){
  if(!liveAdapter.supportedUrl(wc.getURL()))throw Error('실제 좌석 선택 화면에서 정보를 기록해 주세요.');
  const version=scopeVersions.get(wc.id),documentId=wc.documentId;
  const observation=run?await runJs(run,wc,bookingObservation):await js(wc,bookingObservation);
  if(wc.isDestroyed()||wc.documentId!==documentId||scopeVersions.get(wc.id)!==version)throw Error('기록 중 경기 또는 문서가 변경되었습니다.');
  if(observation?.schemaVersion!==1)throw Error('좌석 기록에는 최신 확장이 필요합니다.');
  observation.metadata=[...(metaStores.get(wc.id)?.values()||[])].map(row=>Object.fromEntries(['id','block','blockKey','gradeCode','grade','row','rowLabel','rowKind','displayRow','number','rowIdx','colIdx','segment','aisle','neighbors','exposable','grouped','hasMetadata','rawRowLabel','rawSeatNumber','domAvailable','singletonGroup','labelFormat','groupSize','seatGroupId'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
  const directory=path.join(dataRoot,'observations');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'booking-'+Date.now()+'.json');
  fs.writeFileSync(file,JSON.stringify(observation,null,2));
  return {message:'현재 좌석 정보 기록: '+file,file};
}
async function nextGrade(run,wc,info,message){
  if(info.grades?.length){run.inspectCurrentMap=false;run.mapWaitOnly=false;run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=null;setRunStatus(run,message+' · 표시된 등급 목록에서 다음 조건 확인');return;}
  if(!info.buttons.some(b=>b.label==='좌석도 전체보기'&&b.enabled)){
    // A map without a known navigation control may update itself. Keep rejected
    // combinations excluded until its observed seats actually change.
    run.mapWaitOnly=true;
    setRunStatus(run,message+' · 좌석 데이터 변경 대기');
    if(Number.isInteger(run.seatRevision))await runJs(run,wc,liveAdapter.waitForChange,{revision:run.seatRevision,timeoutMs:3500});
    else await run.retry.next({signal:run.signal,reason:message+' 현재 지도 갱신 대기',onStatus:text=>setRunStatus(run,text),wait:pause});
    runs.assert(run);
    return;
  }
  run.mapWaitOnly=false;
  await runJs(run,wc,flow.clickKnown,'좌석도 전체보기');run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=Date.now();setRunStatus(run,message+' · 다음 조건/구역 확인');
}
async function restartSearch(run,reason='설정한 구역 확인 완료 · 좌석 데이터 변경 시 재개'){
  const wc=targets.get(run.targetId);
  const wait=async ms=>{
    if(wc&&!wc.isDemo()){
      const data=await runJs(run,wc,liveAdapter.liveRead);
      if(Number.isInteger(data.revision)){await runJs(run,wc,liveAdapter.waitForChange,{revision:data.revision,timeoutMs:ms});return;}
    }
    await pause(ms,run.signal);
  };
  await run.retry.next({signal:run.signal,reason,minimumMs:3000,onStatus:text=>setRunStatus(run,text),wait});runs.assert(run);
  // A new round reopens the site's own grade map before considering the old
  // failures again; merely looping over the same candidate array is forbidden.
  run.triedJobs.clear();run.excludedIds.clear();run.excludedGroups.clear();run.inspectCurrentMap=false;run.currentMapChecked=false;
  seatSearch.resetSearch(run);run.metadataRefreshCounts?.clear();
}
function noticeState(info){
  if(info.notice)return info.notice;
  const buttons=(info.buttons||[]).filter(b=>b.label==='확인하고 예매하기');
  return {present:buttons.length>0,enabled:buttons.length===1&&buttons[0].enabled};
}
function noticeAbsent(run){
  if(!run.noticeSeen)return;
  run.noticeSeen=false;run.noticeAttempt=null;run.awaitingAutoAt=null;
  if(run.entryDispatchedAt!=null)run.entryDispatchedAt=Date.now();
}
async function acknowledgeNotice(run,wc,notice){
  run.noticeSeen=true;
  const evidence={pageStage:liveAdapter.supportedUrl(wc.getURL())?'seat':'gate',result:!run.preferences.autoNotice?'manual':notice.enabled?'ready':'disabled',message:notice.key||'제목 미확인'};
  const evidenceKey=JSON.stringify([notice.signature||notice.key,evidence]);
  if(run.lastNoticeEvidence!==evidenceKey){run.lastNoticeEvidence=evidenceKey;runLog.event('booking-notice',evidence);}
  if(!run.preferences.autoNotice){setRunStatus(run,'예매 안내 직접 확인 대기 · 확인하고 예매하기');return false;}
  const documentId=wc.documentId,key=notice.signature||notice.key||null,attempt=run.noticeAttempt;
  if(attempt&&attempt.id===wc.id&&attempt.documentId===documentId&&attempt.key===key){
    if(Date.now()-attempt.started>10000)throw Error('예매 안내 확인 후 화면 변화를 확인하지 못했습니다. 같은 버튼을 다시 누르지 않고 중지합니다.');
    setRunStatus(run,'예매 안내 확인 완료 · 사이트 화면 전환 확인 중');return false;
  }
  if(!notice.enabled){setRunStatus(run,'예매 안내 버튼을 확인하는 중 · 비활성 또는 여러 버튼은 누르지 않습니다.');return false;}
  const started=Date.now(),version=scopeVersions.get(wc.id),url=wc.getURL();
  run.noticeAttempt={id:wc.id,documentId,key,started};
  const result=await runJs(run,wc,flow.clickKnown,'확인하고 예매하기');
  runLog.event('booking-notice-result',{result:result===true||result?.clicked?'invoked':result?.pending?'pending':result?.disabled?'disabled':result?.present===false?'absent':'unconfirmed'});
  if(result?.present===false){run.noticeAttempt=null;return true;}
  if(result?.disabled){run.noticeAttempt=null;return false;}
  if(result===true||result?.clicked){
    run.noticeAttempt.key=result?.signature||result?.key||key;
    run.noticeTransition={id:wc.id,documentId,key:result?.key||key,version,url,started};
    setRunStatus(run,'예매 안내 확인 · 다음 화면을 바로 확인합니다.');return true;
  }
  if(result?.pending){setRunStatus(run,'이미 전달한 예매 안내 확인의 결과를 기다립니다.');return false;}
  throw Error('예매 안내 확인 결과를 확인하지 못했습니다. 중복 클릭하지 않고 중지합니다.');
}
function followNoticeDocument(run,wc){
  const transition=run.noticeTransition;if(!transition)return;
  if(Date.now()-transition.started>10000){run.noticeTransition=null;return;}
  if(transition.id!==wc.id||!transition.documentId||!wc.documentId||transition.documentId===wc.documentId)return;
  // Only the one document transition caused by this confirmed notice click can
  // refresh a pinned scope. A context-only reset or a different URL still stops.
  if(transition.url!==wc.getURL()||scopeVersions.get(wc.id)!==transition.version+1)return;
  if(run.gateDocument?.windowId===wc.id&&run.gateDocument.version===transition.version)run.gateDocument={windowId:wc.id,version:scopeVersions.get(wc.id)};
  if(run.seatScope?.id===wc.id&&run.seatScope.version===transition.version){run.seatScope={id:wc.id,version:scopeVersions.get(wc.id)};run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=null;run.gradePlanObserved=false;run.inspectCurrentMap=false;run.currentMapChecked=false;run.detailsReadBlocks=new Set();run.detailsReadGrades=false;run.gradeConflicts=new Map();run.triedJobs.clear();}
  seatSearch.resetSearch(run);run.metadataRefreshCounts?.clear();
  run.noticeTransition=null;noticeAbsent(run);setRunStatus(run,'예매 안내 확인 후 새 화면을 확인했습니다.');
}
async function autoLoop(run){
  while(true){
    runs.assert(run);
    const pendingTarget=targets.get(run.targetId);
    if(pendingTarget?.missingSince!=null){
      if(Date.now()-pendingTarget.missingSince>15000)throw Error('예매창의 화면 전환을 15초 안에 확인하지 못했습니다. 탭이 닫혔거나 다른 주소로 이동했는지 확인해 주세요.');
      setRunStatus(run,'예매창 화면 전환 대기 · 추가 요청 없음');await pause(100,run.signal);continue;
    }
    if(run.observerTask){await run.observerTask;runs.assert(run);continue;}
    const wc=targetFor(run),url=wc.getURL();
    followNoticeDocument(run,wc);
    // A slow login/queue must not consume the grace period of a later
    // transitional route. Unsupported routes are observed only, never acted on.
    const knownRoute=/^https:\/\/tickets\.interpark\.com\/(?:waiting(?:[/?#]|$)|gates\/ticket\/\d+)/.test(url)||url.startsWith('https://accounts.yanolja.com/')||isEntryPage(url)||liveAdapter.supportedUrl(url)||wc.isDemo()||url==='about:blank';
    if(knownRoute)run.unsupportedSince=null;
    if(/^https:\/\/tickets\.interpark\.com\/(?:onestop\/|waiting\/)?error(?:[/?#]|$)/.test(url))throw Error('사이트가 예매 오류 화면으로 이동했습니다. 진입 요청을 반복하지 않았습니다.');
    if(/^https:\/\/tickets\.interpark\.com\/waiting(?:[/?#]|$)/.test(url)){
      const q=run.entry.queueState;
      setRunStatus(run,q==='rank-confirmed'?'대기열 순번 확인 · '+run.entry.queueRank:q==='registered'?'대기열 접수 확인 · 순번 응답 대기':q==='existing-queue'?'기존 대기열 선택 안내 · 사이트에서 확인해 주세요':q==='blocked'?'대기열 요청 제한 · 새 진입 요청 없이 대기':q==='unconfirmed'?'대기열 응답 미확인 · 사이트의 후속 응답 대기':'대기열 페이지 도착 · 실제 접수와 순번 확인 중');
    }
    else if(url.startsWith('https://accounts.yanolja.com/'))setRunStatus(run,'로그인 대기 · 사이트에서 직접 로그인해 주세요.');
    else if(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+/.test(url)){
      if(!run.entry.gatePageObserved){run.entry.gatePageObserved=true;runLog.event('entry-route',{kind:'gate',elapsedMs:run.metrics.snapshot().elapsedMs});}
      pinGateDocument(run,wc);
      const gate=await readEntryPage(run,wc,entry.gateStatus,{goodsCode:run.goodsCode});
      if(gate===ENTRY_READ_MOVED)continue;
      // The site's popup may be adopted while this read is awaiting Chrome.
      // Continue observing that new target; do not send the old tab a follow-up.
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      if(!gate.supported)throw Error('예매 준비 화면의 경기 또는 구조가 변경되었습니다.');
      if(run.goodsCode&&gate.goodsCode!==run.goodsCode)throw Error('다른 경기의 예매 준비 화면으로 이동했습니다.');
      run.goodsCode=gate.goodsCode;
      const notice=noticeState(gate);
      if(notice.present){if(await acknowledgeNotice(run,wc,notice))continue;await pause(100,run.signal);continue;}
      noticeAbsent(run);
      let status=await readEntryPage(run,wc,'gateState');
      if(status===ENTRY_READ_MOVED)continue;
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      if((!status||status.phase==='stopped'||status.runId!==run.id)&&!run.entry.trigger&&!run.entry.requestCount)status=await runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,allowInitiallyEnabled:true,httpRetry:run.entry.strategy==='clock'&&run.clockEligible,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)});
      else if(status?.phase==='timeout'||status?.phase==='blocked')throw Error(status.reason||'예매 준비 화면의 활성화를 확인하지 못했습니다.');
      rememberGate(run,status);
      if(status?.http){
        const h=status.http;run.entry.httpOutcome=h.outcome;run.entry.httpCode=h.code;
        const key=h.requestCount+':'+h.outcome+':'+h.code;
        if(run.lastEntryHttp!==key){run.lastEntryHttp=key;runLog.event('entry-http',{result:h.outcome,message:h.code,count:h.requestCount,status:h.httpStatus});}
        if(['blocked','unknown','expired','not-open'].includes(h.outcome))throw Error(({blocked:'서버가 진입 요청을 거절했습니다.',unknown:'서버의 진입 처리 결과를 확정하지 못했습니다.',expired:'설정한 진입 재시도 구간이 끝났습니다.','not-open':'미개방 코드가 반환되었습니다. 진입 API의 재시도 조건은 아직 검증되지 않았습니다.'})[h.outcome]+' ['+h.code+'] 추가 요청 없이 중지했습니다.');
      }
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      await scheduleGateClock(run,wc,status);
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      if(run.entry.trigger||run.entry.requestCount){run.entryDispatchedAt??=Date.now();if(Date.now()-run.entryDispatchedAt>45000)throw Error('진입 요청 이후 화면 이동을 확인하지 못했습니다. 중복 실행하지 않고 중지합니다.');}
      if(gate.enabled&&status?.observedDisabled===false&&!status?.http&&status?.clock?.outcome!=='armed'){run.awaitingAutoAt??=Date.now();if(Date.now()-run.awaitingAutoAt>10000)throw Error('이미 열린 준비 화면에서 사이트의 자동 진입을 확인하지 못했습니다. 예매 화면을 직접 확인해 주세요.');}
      setRunStatus(run,gate.enabled?'예매 버튼 활성화 확인 · 진입 중':'예매 준비 완료 · 사이트가 버튼을 열 때까지 대기');
    }
    else if(isEntryPage(url)){
      if(!run.game||!run.listingDocument)throw Error('처음 선택한 경기 목록이 아닌 화면으로 돌아왔습니다. 현재 경기를 확인하고 다시 시작해 주세요.');
      pinListingDocument(run,wc);
      const status=await readEntryPage(run,wc,entry.listingState);
      if(status===ENTRY_READ_MOVED)continue;
      if(!status||status.runId!==run.id||status.key!==run.game.key)throw Error('선택한 경기의 목록 감시가 사라졌습니다. 중복 실행하지 않고 중지합니다.');
      rememberListing(run,status);
      if(['blocked','timeout','stopped','navigated'].includes(status.phase))throw Error(status.reason||'경기 목록 감시가 중단됐습니다. 현재 화면을 확인해 주세요.');
      await scheduleGateClock(run,wc,status,{listing:true});
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      if(status.phase==='clicked'){
        if(Date.now()-run.listingDispatchedAt>45000)throw Error('목록의 진입 함수 실행 후 화면 전환을 확인하지 못했습니다. 로그인과 팝업을 확인해 주세요. 중복 실행하지 않았습니다.');
        setRunStatus(run,'목록의 예매 버튼 활성화 확인 · 사이트 화면 전환 대기');
      }else setRunStatus(run,run.entry.strategy==='clock'&&run.clockEligible?'경기 목록에서 예약 시각과 예매 버튼 활성화 대기':'경기 목록에서 선택한 예매 버튼 활성화 대기');
    }
    else if(liveAdapter.supportedUrl(url)||wc.isDemo()){
      if(run.entry)run.entry.seatPageObserved=true;
      const initialSeat=run.seatScope==null,seatDocument={id:wc.id,url,documentId:wc.documentId,version:scopeVersions.get(wc.id)};
      const assertSeatDocument=()=>{
        if(wc.id!==run.targetId||wc.getURL()!==seatDocument.url||wc.documentId!==seatDocument.documentId||scopeVersions.get(wc.id)!==seatDocument.version||run.seatScope&&(run.seatScope.id!==wc.id||run.seatScope.version!==seatDocument.version))throw Error('경기 또는 회차가 변경되어 자동 진행을 중지했습니다.');
      };
      assertSeatDocument();
      // The route may be reported before the new content receiver is ready.
      // Recover only these initial reads, before any notice/seat action. Once
      // the seat scope is pinned, no read failure can reopen mutation flow.
      if(!wc.isDemo()){
        const identity=await (initialSeat?readEntryPage(run,wc,directApi.bookingIdentity):runJs(run,wc,directApi.bookingIdentity));
        if(identity===ENTRY_READ_MOVED)continue;
        assertSeatDocument();run.expectedBooking=directApi.assertIdentity(run.expectedBooking||(run.goodsCode?{goodsCode:run.goodsCode}:null),identity);
      }
      if(run.inspectionOnly)return {message:'진입 확인 완료 · 좌석을 선택하지 않고 중지했습니다.'};
      const info=await (initialSeat?readEntryPage(run,wc,flow.scene):runJs(run,wc,flow.scene));
      if(info===ENTRY_READ_MOVED)continue;
      assertSeatDocument();
      // Pin before any completion or notice branch as well as seat selection.
      run.seatScope??={id:wc.id,version:seatDocument.version};
      const button=label=>info.buttons.some(b=>b.label===label&&b.enabled);
      if(info.hasSeats||info.grades?.length)run.mapLoadingAt=null;
      if(!info.busy)run.busySince=null;
      if(!info.captcha&&(info.completed||new URL(url).searchParams.get('step')==='price')){const result=await finishPriceSelection(wc,run);if(result.retrySeats)continue;return result;}
      const notice=noticeState(info);
      if(notice.present){
        if(info.selected.length)throw Error('기존에 선택한 좌석이 있어 예매 안내를 자동으로 넘기지 않습니다. 사이트에서 확인해 주세요.');
        if(await acknowledgeNotice(run,wc,notice))continue;await pause(100,run.signal);continue;
      }
      noticeAbsent(run);
      if(!info.captcha&&manualCaptcha.status.present)manualCaptcha.clear('보안문자 화면이 닫혔습니다. 사이트의 다음 단계를 확인합니다.');
      const inspection=inspectionState(run,info);
      if(inspection?.ready){const recorded=await saveObservation(wc,run);return {message:inspection.message+' · '+recorded.file};}
      if(inspection?.waiting){if(info.dialog)throw Error('정보 확인 중 사이트 안내가 표시되었습니다. '+info.dialog.text);setRunStatus(run,'보안문자 및 좌석 화면 준비 확인 · 좌석 선택 없이 기록 대기');await pause(100,run.signal);continue;}
      if(info.captcha){
        if(run.captchaDisabled)throw Error('보안문자 자동 처리가 중단된 상태입니다. 원인을 확인한 뒤 다시 시작해 주세요.');
        setRunStatus(run,'보안문자 자동 인식 · 입력·확인 진행');
        const result=await processCaptcha(wc,'auto',run);runs.assert(run);setRunStatus(run,result.message);
        if(['verified','changed'].includes(result.status))continue;
        if(['manual','uncertain'].includes(result.status))throw Error('보안문자 자동 처리 중단 · '+result.message);

      }
      else if(['empty-selection','conflict'].includes(info.dialog?.kind)&&info.dialog.dismissible&&!info.selected.length){
        const recovered=await selection.rollback(selectionAdapter(wc,run),new Set(),{timeoutMs:8000,pollMs:40,observationGraceMs:160});runs.assert(run);
        if(!recovered)throw Error('좌석 안내 확인 후 화면 복구를 확인하지 못했습니다.');
        setRunStatus(run,'좌석 안내 확인 완료 · 최신 후보를 다시 읽습니다.');continue;
      }
      else if(info.dialog)throw Error('사이트 안내를 확인해 주세요. '+info.dialog.text);
      else if(info.busy){run.busySince??=Date.now();if(Date.now()-run.busySince>15000)throw Error('사이트 로딩이 15초 이상 계속되어 중지했습니다. 현재 화면을 확인해 주세요.');setRunStatus(run,'사이트 로딩 완료 대기 · 좌석·구역 동작 보류');}
      else if(info.selected.length)throw Error('기존에 선택한 좌석이 있습니다. 확인/해제한 뒤 다시 시작해 주세요.');
      else if(run.awaitingGradesAt&&info.hasSeats&&!info.grades.length){if(Date.now()-run.awaitingGradesAt>8000)throw Error('구역 목록으로 돌아가는 화면 전환을 확인하지 못했습니다.');setRunStatus(run,'구역 목록 화면 도착을 기다리는 중');}
      else if(button('직접 좌석 선택하기')){
        if(run.directMapAttempt){
          if(Date.now()-run.directMapAttempt>12000)throw Error('직접 좌석 선택 후 지도 전환을 확인하지 못했습니다. 같은 버튼을 다시 누르지 않고 중지합니다.');
          setRunStatus(run,'직접 좌석 지도 화면 전환 대기');
        }else{
          run.directMapAttempt=Date.now();await runJs(run,wc,flow.clickKnown,'직접 좌석 선택하기');run.gradeOpenedAt=Date.now();setRunStatus(run,'직접 좌석 선택 화면 진입');continue;
        }
      }
      else if(info.grades.length&&!run.currentJob&&!run.inspectCurrentMap){
        run.awaitingGradesAt=null;
        run.gradePlanObserved=true;
        const allowedAreas=[...run.preferences.areas,...run.preferences.tiers.flatMap(t=>t.areas)];
        if(!wc.isDemo()&&!run.detailsReadGrades&&!gradeStores.get(wc.id)?.size&&allowedAreas.some(a=>!info.grades.some(g=>labelKey(g.name)===labelKey(a)))){
          const details=await runJs(run,wc,seatDetails.readDetails,{expected:run.expectedBooking,blockKeys:[],includeGrades:true,expiresAt:Date.now()+20000});
          applyGradeDetails(wc,details,run);run.detailsReadGrades=true;
        }
        const grades=info.grades.map(g=>({...g,code:[...(gradeStores.get(wc.id)||[])].find(([,name])=>name===g.name)?.[0]}));
        const configured=run.preferences.tiers.length?run.preferences.tiers:run.preferences.areas.length?[{areas:run.preferences.areas}]:[];
        if(configured.length&&configured.every(t=>t.areas.length&&!t.areas.some(a=>grades.some(g=>[g.name,g.code].some(v=>v!=null&&labelKey(v)===labelKey(a)))))){
          if(!run.preferences.fallbackAnywhere)throw Error('설정한 허용 구역 이름·코드가 현재 경기 목록에 없습니다. 현재 경기에서 이름·코드를 읽고 조건을 수정해 주세요.');
          if(!run.loggedUnmatchedAreas){run.loggedUnmatchedAreas=true;runLog.event('seat-priority-unmatched',{message:'설정한 구역이 현재 경기 목록에 없어 전체 구역 대안으로 진행합니다.'});}
        }
        const assessment=assessGradePlan(grades,run.preferences),plan=assessment.plan;
        const job=seatSearch.nextJob(plan,run,Date.now());
        const evidence={reason:assessment.reason,gradeCount:grades.length,planCount:plan.length,grades:assessment.grades};
        const evidenceKey=JSON.stringify(evidence);
        if(run.lastGradeEvidence!==evidenceKey){run.lastGradeEvidence=evidenceKey;runLog.event('seat-search-plan',{...evidence,cycle:run.retry.cycle});}
        if(!job){
          // The sidebar's remaining count can lag the currently visible map.
          // If it offers no eligible grade, inspect that map once this round
          // using all normal seat filters and server confirmation requirements.
          if(!plan.length&&info.hasSeats&&!run.currentMapChecked){run.currentMapChecked=true;run.inspectCurrentMap=true;setRunStatus(run,'구역 잔여석 표시와 별도로 현재 지도 후보를 확인합니다.');continue;}
          const cooldowns=plan.map(j=>run.metadataCooldown?.get(JSON.stringify([j.tierIndex,j.name]))).filter(until=>until>Date.now());
          if(cooldowns.length===plan.length&&cooldowns.length){
            const until=Math.min(...cooldowns),remaining=Math.max(1,until-Date.now());
            setRunStatus(run,`좌석 상세 정보 재확인 · ${(remaining/1000).toFixed(1)}초 이내 · 정보 변경 시 즉시 재개`);
            const data=await runJs(run,wc,liveAdapter.liveRead);
            // A metadata event can arrive during the read. Recompute eligibility
            // before waiting so that an already-expired job resumes immediately.
            if(!plan.some(j=>(run.metadataCooldown?.get(JSON.stringify([j.tierIndex,j.name]))??Infinity)<=Date.now())){
              const timeoutMs=Math.max(1,Math.min(METADATA_RECHECK_MS,until-Date.now()));
              if(Number.isInteger(data.revision))await runJs(run,wc,liveAdapter.waitForChange,{revision:data.revision,timeoutMs});
              else await pause(timeoutMs,run.signal);
            }
            runs.assert(run);continue;
          }
          else await restartSearch(run,({'inventory-empty':'허용 구역의 표시 잔여석이 0석입니다 · 잔여석 변경 대기','inventory-insufficient':'허용 구역의 표시 잔여석이 요청 매수보다 적습니다 · 잔여석 변경 대기','conditions-excluded':'표시된 구역이 설정 조건에서 제외되었습니다 · 구역 변경 대기'})[assessment.reason]);
        }
        else{
          const data=await runJs(run,wc,liveAdapter.liveRead);const row=data.rows.find(r=>r.name===job.name);
          if(row){
            const cooldownKey=JSON.stringify([job.tierIndex,job.name]);
            if(run.metadataCooldown?.has(cooldownKey)){run.metadataCooldown.delete(cooldownKey);run.triedJobs.delete(cooldownKey);run.detailsReadBlocks?.clear();run.detailsReadGrades=false;}
            runs.assert(run);const opened=await measured(wc,'grade-open',()=>wc.seatAction(row,'click'));runs.assert(run);if(opened?.retry){setRunStatus(run,'구역 목록 갱신 확인 중');await pause(100,run.signal);continue;}run.currentJob=job;run.inspectCurrentMap=false;run.directMapAttempt=null;run.gradeOpenedAt=Date.now();run.triedJobs.add(JSON.stringify([job.tierIndex,job.name]));run.jobVisits.set(seatSearch.jobKey(job),Date.now());
            runLog.event('seat-search-scope',{kind:job.fallback?'fallback':'priority',message:job.name,cycle:run.retry.cycle,count:job.tierIndex});
            setRunStatus(run,`${run.retry.cycle}차 · ${job.fallback?'전체 구역 대안':job.tierName||((job.tierIndex+1)+'순위')} · ${job.name} 확인`);continue;}
          else{const key=JSON.stringify([job.tierIndex,job.name]);run.metadataCooldown?.delete(key);runLog.event('grade-row-missing',{message:job.name,cycle:run.retry.cycle});run.triedJobs.add(key);run.jobVisits.set(key,Date.now());}
        }
      }
      else if(info.hasSeats){
        run.directMapAttempt=null;
        run.gradeOpenedAt??=Date.now();
        const result=await candidatesFor(wc,run.preferences,{tierIndex:run.currentJob?.tierIndex,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups});runs.assert(run);
        const {rows}=result;let groups=rankRunSeats(run,wc,rows);run.seatRevision=result.data.revision;
        // A map opened before this run may show only a lower-priority area.
        // Read the grade overview before accepting a lower tier or fallback;
        // a matching top-tier candidate can still be selected immediately.
        if(!run.currentJob&&!run.gradePlanObserved&&groups[0]?.tierIndex>0){
          if(!info.buttons.some(b=>b.label==='좌석도 전체보기'&&b.enabled))throw Error('앞선 우선순위를 확인할 구역 목록을 찾지 못했습니다. 구역 목록을 연 뒤 시작해 주세요.');
          await runJs(run,wc,flow.clickKnown,'좌석도 전체보기');
          run.awaitingGradesAt=Date.now();run.gradeOpenedAt=null;run.inspectCurrentMap=false;
          setRunStatus(run,'먼저 설정한 우선순위를 확인하기 위해 구역 목록으로 이동합니다.');continue;
        }
        const seats=rows.filter(r=>r.kind==='seat');
        const readAssessment=metadata.assessSeatRead(rows);
        const evidence={rowCount:seats.length,availableCount:seats.filter(r=>r.available).length,detailedCount:seats.filter(hasSeatDetails).length,pooledCount:run.preferences.requireTogether===false?seatSearch.pooledSeats(run).length:seats.length,missingGradeCount:seats.filter(r=>!r.grade).length,missingRowCount:seats.filter(r=>!Number.isInteger(r.row)&&!metadata.isWheelchairSingleton(r)).length,missingNumberCount:seats.filter(r=>!Number.isInteger(r.number)&&!metadata.isWheelchairSingleton(r)).length,candidateCount:groups.length,message:run.currentJob?.name||'현재 지도',reason:groups.length?'candidates-ready':seats.length?'no-matching-combination':'no-visible-seats',...readAssessment};
        const evidenceKey=JSON.stringify(evidence);
        if(run.lastSeatEvidence!==evidenceKey){run.lastSeatEvidence=evidenceKey;runLog.event('seat-candidates',{...evidence,cycle:run.retry.cycle});}
        if(!groups.length&&await recoverSeatDetails(run,wc,rows))continue;
        const unresolved=rows.filter(r=>r.kind==='seat'&&!r.grade&&run.gradeConflicts?.has(r.gradeCode));
        if(unresolved.length&&!groups.length){
          const conflicts=[...new Set(unresolved.map(r=>r.gradeCode))].map(code=>run.gradeConflicts.get(code));
          runLog.event('grade-unresolved',{gradeConflicts:conflicts,count:unresolved.length});
          if(run.currentJob&&(info.grades?.length||info.buttons?.some(b=>b.label==='좌석도 전체보기'&&b.enabled))){await nextGrade(run,wc,info,'이 구역은 등급 이름이 여러 개여서 제외하고 다음 구역을 확인합니다.');continue;}
          throw Error('좌석 구역 이름을 확정하지 못했습니다. 같은 코드에 서로 다른 이름이 있고 좌석별 이름도 없어 조건을 검증할 수 없습니다. 충돌한 코드·이름은 자동 로그에 저장했습니다.');
        }
        const changed=run.retry.observe(run.currentJob?.name||'current-map',rows);
        if(changed&&run.mapWaitOnly){run.excludedIds.clear();run.excludedGroups.clear();run.priceExcludedGrades?.clear();groups=rankRunSeats(run,wc,rows);}
        // Before seeing the overview, another area may still offer tier 0.
        // Exhaust only the top tier here, then use nextGrade to inspect it.
        if(!run.currentJob&&!run.gradePlanObserved)groups=groups.filter(group=>group.tierIndex===0);
        if(groups.length){
          setRunStatus(run,`${run.retry.cycle}차 · ${groups.length}개 후보 준비 · 순서대로 선택 확인`);
          const selected=await selectCandidates(wc,run,groups);
          // An accepted completion remains success even if cancellation arrived
          // while its final server response was still in flight.
          if(selected.completed)return selected;
          if(selected.retrySeats)continue;
          runs.assert(run);if(!selected.exhausted)return selected;
          if(selected.limited){setRunStatus(run,'20개 후보 확인 · 최신 지도에서 남은 후보를 이어서 확인');continue;}
          if(rankRunSeats(run,wc,rows,{remember:false}).length){setRunStatus(run,'실패한 조합을 제외하고 남은 후보를 이어서 확인');continue;}
          await nextGrade(run,wc,await runJs(run,wc,flow.scene),selected.priceUnavailable?'자격·할인 조건 가격만 있는 구역을 제외하고 다음 구역을 확인합니다.':'현재 후보들이 선점되어 제외했습니다.');
        }
        else{
          const elapsed=Date.now()-run.gradeOpenedAt;
          const incomplete=rows.some(r=>r.kind==='seat'&&!hasSeatDetails(r));
          if(elapsed>=250){
            if(incomplete&&run.currentJob){run.metadataCooldown??=new Map();run.metadataCooldown.set(JSON.stringify([run.currentJob.tierIndex,run.currentJob.name]),Date.now()+METADATA_RECHECK_MS);runLog.event('metadata-unresolved',{message:run.currentJob.name+' · 상세 조회 후에도 미확인 · 1초 재조회 간격, 정보 변경 시 즉시 재개',count:rows.length});}
            const reason=incomplete?(readAssessment.unsupportedRowCount||readAssessment.unsupportedNumberCount?'좌석 열·번호 표기를 해석하지 못했습니다.':'조회 완료 후에도 좌석 상세 정보가 부족합니다.'):
              readAssessment.nonExposableCount||readAssessment.groupedCount?'좌석 상세 정보의 노출·묶음 조건 때문에 자동 선택할 수 없습니다.':'현재 지도에 조건을 만족하는 좌석이 없습니다.';
            await nextGrade(run,wc,info,reason);
          }
          else setRunStatus(run,incomplete?`좌석 상세 정보 확인 중 · 보이는 후보 ${rows.length}개 · 열·구역 정보 대기`:`조건에 맞는 조합 없음 · 보이는 후보 ${rows.length}개 · 지도 갱신 재확인 대기`);
        }
      }
      else{run.mapLoadingAt??=Date.now();if(Date.now()-run.mapLoadingAt>12000)throw Error('좌석 화면 로딩을 확인하지 못했습니다. 화면을 확인해 주세요.');}
    }
    else if(url==='about:blank'){}
    else{
      run.unsupportedSince??=Date.now();
      if(Date.now()-run.unsupportedSince>15000)throw Error('지원하는 예매 진행 화면이 아닙니다. 현재 화면을 확인해 주세요.');
      setRunStatus(run,'예매 화면 전환 대기 · 추가 요청 없음');
    }
    await pause(100,run.signal);
  }
}

async function command(action, payload) {
  if(runner&&!['state','stop','focus','code','manualCaptchaPrepare','manualCaptchaSubmit','manualCaptchaFocus','captchaStop','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('진행 중에는 창·설정·좌석을 변경할 수 없습니다. 중지 후 정리가 끝나면 다시 시도해 주세요.');
  if(captchaStatus.busy&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('보안문자 처리 중에는 다른 입력·예매 동작을 실행할 수 없습니다. 완료 또는 중지 후 다시 시도해 주세요.');
  if(manualCaptcha.pending&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('직접 입력한 보안문자를 처리하고 있습니다. 결과를 기다려 주세요.');
  if(manualCodePending&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('직접 입력한 보안문자를 처리하고 있습니다. 결과를 기다려 주세요.');
  switch(action) {
    case 'state': state(); return {};
    case 'openLogs': {fs.mkdirSync(runLog.directory,{recursive:true});const error=await shell.openPath(runLog.directory);if(error)throw Error('로그 폴더를 열지 못했습니다. '+error);return {message:'실행별 자동 로그 폴더를 열었습니다.'};}
    case 'preflight': return inspectRun(payload);
    case 'restoreWindow': revealPanel(true);rememberWindow();return {desktop:desktopState(),message:'도우미 창을 기본 모니터 왼쪽으로 옮겼습니다.'};
    case 'alwaysOnTop': {desktop.alwaysOnTop=payload===true;win?.setAlwaysOnTop(desktop.alwaysOnTop);persistDesktop();updateWindowMenu();state();return {desktop:desktopState(),message:desktop.alwaysOnTop?'도우미를 항상 위에 표시합니다.':'다른 창을 도우미 위에 올릴 수 있습니다.'};}
    case 'pairingInfo': return {...bridge.getState(),...(bridgeError?{pairCode:null,message:bridgeError}:{}),extensionPath};
    case 'refreshPairing': {if(bridgeError)throw Error(bridgeError);extensionReloadRequested=false;const info=bridge.refreshPairing();browserStatus={...bridge.getState()};state();return {...info,extensionPath};}
    case 'copyPairCode': {if(bridgeError)throw Error(bridgeError);const info=bridge.getState();if(!info.pairCode||Date.now()>info.expiresAt)throw Error('연결 코드가 없거나 만료되었습니다. 새 연결 코드를 먼저 만드세요.');clipboard.writeText(info.pairCode);return {message:'연결 코드를 복사했습니다. Chrome 확장 팝업에 붙여 넣으세요.'};}
    case 'updateExtension': return updateExtension();
    case 'openExtensionFolder': {if(stableRoot)installExtension({source:extensionSource,destination:extensionPath});const error=await shell.openPath(extensionPath);if(error)throw Error(error);return {message:'Chrome에 등록할 확장 폴더를 열었습니다.'};}
    case 'openSeatingGuide': {
      let url;try{url=new URL(payload?.url);}catch{throw Error('공식 좌석 안내 주소를 확인하지 못했습니다.');}
      if(url.origin!=='https://ent-ticketimage.interparkcdn.net'||!/^\/display\/articles\/[a-f0-9]{32}\.(?:jpg|png|webp)$/i.test(url.pathname)||url.username||url.password||url.search||url.hash)throw Error('허용된 공식 좌석 안내 이미지만 열 수 있습니다.');
      await shell.openExternal(url.href);return {message:'공식 좌석 안내 이미지를 열었습니다.'};
    }
    case 'postseason':
    case 'home': {
      const url=desktopSettings.entryUrl(action==='postseason'?HOME:payload?.url||pageUrl);if(!url)throw Error('NOL 티켓 또는 인터파크 상품/예매 준비 페이지 주소를 입력해 주세요.');
      pageUrl=url;persistDesktop();
      const tab=await bridge.request({action:'tabs.open',arg:{url}});trackTabs(bridge.listTabs());if(tab?.id&&targets.has(tab.id))active=tab.id;invalidate('Chrome에서 예매 페이지를 열었습니다.');return {};
    }
    case 'demo': {const tab=await bridge.request({action:'tabs.demo'});trackTabs(bridge.listTabs());if(tab?.id&&targets.has(tab.id))active=tab.id;invalidate('Chrome 연습 화면을 열었습니다. 실제 예매와 무관한 가상 좌석입니다.');return {};}
    case 'target': {
      const wc=targets.get(Number(payload));if(!wc)throw Error('닫힌 Chrome 탭입니다.');
      if(active!==wc.id&&targets.has(active))await bridge.request({action:'network.detach',tabId:active}).catch(()=>{});
      active=wc.id;
      // A standalone CAPTCHA test needs DOM access only, including legacy
      // concert frames. Seat/entry observation attaches when a run starts.
      captchaService?.publish({text:'',confidence:null,previewDataUrl:null,message:'대상 탭을 바꿨습니다. 현재 보안문자를 새로 읽어 주세요.'});
      invalidate('예매를 도울 Chrome 탭을 변경했습니다.');return {};
    }
    case 'focus': await current().focus();return {message:'Chrome 예매 탭으로 이동했습니다.'};
    case 'zoom': {const delta=Number(payload);if(![-.1,0,.1].includes(delta))throw Error('잘못된 배율');await current().zoom(delta);return {};}
    case 'recordObservation': return saveObservation(current());
    case 'preferences': savePreferences(payload);state('선호 조건을 저장했습니다.');return {preferences};
    case 'gateOpening': {
      const wc=current(),url=wc.getURL(),doc=wc.documentId,u=new URL(url),match=u.origin==='https://tickets.interpark.com'&&u.pathname.match(/^\/gates\/ticket\/(\d{8})\/?$/);
      if(!match)throw Error('예매 준비 화면을 먼저 선택해 주세요.');
      const result=await readPostseasonOpening(match[1],(u,o)=>net.fetch(u,o));
      if(wc.documentId!==doc||wc.getURL()!==url||current()!==wc)throw Error('조회 중 준비 화면이 변경되었습니다.');
      return {opening:result?{...result,openingSource:'공식 포스트시즌 API'}:{openingReason:'현재 공식 포스트시즌 목록에 시작 시각이 없습니다. 직접 입력해 주세요.'}};
    }
    case 'games': return games();
    case 'clock': return syncClock();
    case 'start': return startRun(payload);
    case 'stop': await stopRun('자동 진행을 중지했습니다.');await stopCaptcha();return {};
    case 'manualCaptchaPrepare':
    case 'manualCaptchaFocus': {
      const wc=runner?targetFor(runner):current();
      if(runner)throw Error('자동 진행에서는 보안문자를 자동 입력합니다. 직접 입력 보조로 전환할 수 없습니다.');
      if(action==='manualCaptchaFocus')await wc.focus();
      return prepareManualCaptcha(wc,runner);
    }
    case 'manualCaptchaSubmit': {
      if(runner)throw Error('자동 진행에서는 보안문자를 자동 입력합니다. 직접 입력 보조로 전환할 수 없습니다.');
      const result=await manualCaptcha.submit(payload);
      return {...result,manualCaptcha:manualCaptcha.status};
    }
    case 'captchaRead': manualCaptcha.clear();return processCaptcha(current(),'read');
    case 'captchaSubmit': return processCaptcha(current(),'submit');
    case 'captchaStop': if(runner)await stopRun('보안문자 처리와 자동 진행을 중지했습니다.');return stopCaptcha();
    case 'code': {
      // Legacy standalone input is unavailable while automatic booking owns the page.
      if(runner)throw Error('자동 진행에서는 보안문자를 자동 입력합니다. 직접 입력 보조로 전환할 수 없습니다.');manualCodePending=true;
      try{await js(runner?targetFor(runner):current(),flow.enterCode,String(payload||'').trim().toUpperCase());return {message:'보안문자를 입력했습니다. 인증 결과를 확인합니다.'};}
      finally{manualCodePending=false;}
    }
    default: throw new Error('지원하지 않는 동작입니다.');
  }
}
app.whenReady().then(async()=>{
  if(!smoke&&!app.requestSingleInstanceLock()){app.quit();return;}
  app.on('second-instance',()=>revealPanel());app.on('activate',()=>revealPanel());
  const bounds=desktopSettings.visibleBounds(desktop.windowBounds,screen.getAllDisplays(),screen.getPrimaryDisplay());
  win=new BrowserWindow({...bounds,minWidth:Math.min(360,bounds.width),minHeight:Math.min(500,bounds.height),show:!smoke,alwaysOnTop:desktop.alwaysOnTop,autoHideMenuBar:true,backgroundColor:'#101827',title:'야구 티켓팅 도우미',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.on('move',rememberWindow);win.on('resize',rememberWindow);
  screen.on('display-removed',()=>revealPanel());screen.on('display-metrics-changed',()=>{if(!win.isMinimized())revealPanel();});
  if(!smoke){try{createTray();}catch(error){console.warn('Tray unavailable:',error.message);}updateWindowMenu();}
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  bridge=new BrowserBridge(smoke?{port:0}:{pairingStore:createPairingStore({file:path.join(dataRoot,'chrome-pairing.bin'),safeStorage,onError:message=>{diagnosticWarning=message;}})});
  bridge.on('tabs',trackTabs);bridge.on('document',onDocument);bridge.on('event',onBrowserEvent);
  bridge.on('connected',()=>{browserStatus={...bridge.getState()};state('Chrome이 연결되었습니다. 예매할 탭을 선택해 주세요.');if(!smoke&&!runner&&!extensionReloadRequested&&browserStatus.extensionReloadSupported&&browserStatus.extensionVersion!==require('../package.json').version)void updateExtension().then(result=>state(result.message)).catch(error=>{runLog.diagnostic('command-error',{action:'updateExtension',message:error.message});state(error.message);});});
  bridge.on('disconnected',()=>{browserStatus={...bridge.getState()};captchaService?.cancel();void stopRun('Chrome 연결이 끊겨 중지했습니다.');trackTabs([]);state();});
  try{await bridge.start();if(stableRoot)installExtension({source:extensionSource,destination:extensionPath});bridgeReady=true;browserStatus={...bridge.getState()};}catch(error){bridgeError=desktopSettings.bridgeFailure(error);browserStatus={connected:false,message:bridgeError};}
  ipcMain.handle('helper:run',async(event,action,payload)=>{
    if(closing||!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame?.url!==SHELL)return {error:'허용되지 않은 요청입니다.'};
    try{return await command(action,payload);}catch(error){if(!runs.current)runLog.diagnostic('command-error',{action,message:error.message});return {error:error.message};}
  });
  let closeReady=false,closePending=false;
  win.on('close',event=>{
    if(closeReady)return;event.preventDefault();if(closePending)return;closePending=true;
    clearTimeout(saveWindowTimer);try{if(!smoke)persistDesktop();}catch{}
    void stopRun('설정 프로그램을 종료했습니다. Chrome 탭은 그대로 유지됩니다.').finally(async()=>{await stopCaptcha();await captchaService?.close();await bridge.close();closing=true;closeReady=true;if(!win.isDestroyed())win.close();});
  });
  win.on('closed',()=>{tray?.destroy();tray=null;app.quit();});
  await win.loadURL(SHELL);state();
  // Model startup happens before booking and never delays entry preparation.
  if(!smoke)void getCaptchaService().warmup();
  if(!smoke&&process.argv.includes('--live-football-test'))require('./live-football-test')({bridge,targets,command,runs,dataRoot,state});
  if(smoke)await require('./panel-smoke')({app,win,bridge,command,state,targets});
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
