'use strict';
const {app, BrowserWindow, ipcMain, net, powerSaveBlocker, screen, shell, clipboard, Menu, Tray, nativeImage} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {performance}=require('node:perf_hooks');
const liveAdapter = require('./live-adapter');
const {normalizePreferences,rankGroups,gradePlan}=require('./preferences');
const {parseOpening,clockSample,bestClock,serverClockSample,clockForGate,SERVER_TIME_URL}=require('./timing');
const {RunControl,pause}=require('./run-control');
const {SeatRetry}=require('./seat-retry');
const selection=require('./selection');
const {BrowserBridge}=require('./browser-bridge');
const {ChromeTarget}=require('./chrome-target');
const {OcrClient}=require('./ocr-client');
const {CaptchaService}=require('./captcha-service');
const {ManualCaptcha}=require('./manual-captcha');
const entry=require('./entry');
const desktopSettings=require('./desktop-settings');
const {createVenueStore}=require('./venue-profiles');
const {safeLastRun}=require('./run-diagnostics');
const {phaseForStatus,observerDiagnosis,diagnosisForRun,buildPreflight,seatExtensionCompatible}=require('./run-inspection');

const metadata=require('./metadata');
const flow=require('./flow');
const HOME = desktopSettings.POSTSEASON;
const SHELL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const smoke=process.argv.includes('--panel-smoke');
const isEntryPage=value=>{try{const u=new URL(value);return !u.username&&!u.password&&u.origin==='https://nol.yanolja.com'&&/^\/ticket(?:\/|$)/.test(u.pathname);}catch{return false;}};
const validHome=value=>{try{const u=new URL(String(value));return !u.username&&!u.password&&(isEntryPage(value)||(u.origin==='https://tickets.interpark.com'&&(/^(?:\/gates\/ticket\/\d{8}|\/goods\/\d+)(?:\/|$)/.test(u.pathname))));}catch{return false;}};
// Desktop settings only. Chrome retains its own login/profile and open tabs.
const dataRoot = app.isPackaged ? path.join(path.dirname(process.execPath), 'settings') : path.join(app.getAppPath(), 'work', smoke ? `panel-smoke-${process.pid}` : 'desktop-settings');
app.setPath('userData', dataRoot);
const migrated=app.isPackaged&&!smoke?desktopSettings.migrateSettings({destination:dataRoot,sources:['BaseballTicketHelper-v0.9.4-win32-x64','BaseballTicketHelper-v0.9.3-win32-x64','BaseballTicketHelper-v0.9.2-win32-x64','BaseballTicketHelper-v0.9.1-win32-x64','BaseballTicketHelper-v0.9-win32-x64','BaseballTicketHelper-v0.8-win32-x64','BaseballTicketHelper-v0.7-win32-x64','BaseballTicketHelper-v0.6-win32-x64','BaseballTicketHelper-v0.5-win32-x64'].map(name=>path.join(path.dirname(path.dirname(process.execPath)),name,'settings'))}):[];
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
try{const info=fs.statSync(lastRunPath);if(info.size<=100000)lastRun=safeLastRun(JSON.parse(fs.readFileSync(lastRunPath,'utf8')));}catch{}
if(lastRun&&!lastRun.diagnosis)lastRun.diagnosis=diagnosisForRun(lastRun,lastRun.message);
// The renderer deduplicates completion notices by ID. Continue from the restored
// run so the first new result after restarting cannot look like the old one.
if(lastRun)runs.serial=lastRun.id;
let desktop=desktopSettings.cleanSettings();
try{desktop=desktopSettings.cleanSettings(JSON.parse(fs.readFileSync(settingsPath,'utf8')));pageUrl=desktop.pageUrl;}catch{}
const extensionPath=app.isPackaged?path.join(path.dirname(process.execPath),'chrome-extension'):path.join(app.getAppPath(),'extension');
try{preferences=normalizePreferences(JSON.parse(fs.readFileSync(preferencesPath,'utf8')));}catch{}
const venueStore=createVenueStore({filePath:path.join(dataRoot,'venue-profiles.json'),initialPreferences:preferences});
preferences=venueStore.getPreferences();
const targets = new Map(), seatRefs = new Map();
const metaStores=new Map(),gradeStores=new Map(),scopeVersions=new Map();
let nextSeat = 0;
function state(message) {
  if (closing || !win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  manualCaptcha.invalidateIfStale();
  win.webContents.send('helper:state', {appVersion:require('../package.json').version,message, target: active, revision,preferences,clockInfo,running:!!runner,runStatus:runner?.status,
    entry:runner?.entry,retry:runner?.retry?.snapshot(),venueProfiles:venueStore.getState(),lastRun,diagnosticWarning,preflight:preflightResult,runDiagnostics:runner?{metrics:runner.metrics.snapshot(),diagnosis:runner.diagnosis||null}:null,browserStatus,captchaStatus,manualCaptcha:manualCaptcha.status,pageUrl,desktop:desktopState(),windows: [...targets.values()].filter(w => !w.isDestroyed()).map(w => ({id:w.id, title:w.getTitle() || '예매 페이지', url:w.getURL()}))});
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
  return {assertCurrent,snapshot:()=>invoke('captcha.captchaSnapshot'),submit:arg=>invoke('captcha.captchaSubmit',arg),status:arg=>invoke('captcha.captchaStatus',arg)};
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
function invalidate(message) { revision++; seatRefs.clear(); preflightResult=null; state(message); }
function entryTransitionAllowed(run,wc){return run?.kind==='auto'&&!run.seatScope&&!liveAdapter.supportedUrl(wc.getURL())&&!wc.isDemo();}
function observeTarget(run,wc){
  const task=ensureNetwork(wc);run.observerTask=task;
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
  active=row.id;observeTarget(run,wc);return true;
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
  const run=runner;if(!run||run.signal.aborted||run.kind!=='auto'||run.targetId!==wc.id||run.observerTask)return;
  const match=wc.getURL().match(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/(\d{8})(?:[?#]|$)/);
  if(!match||run.goodsCode&&run.goodsCode!==match[1]||run.entry.trigger||run.entry.requestCount)return;
  try{pinGateDocument(run,wc);}catch{return;}
  run.goodsCode=match[1];
  void runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)}).then(status=>rememberGate(run,status)).catch(()=>{});
}
function onBrowserEvent(event){
  const wc=targets.get(event.tabId);if(!wc)return;
  if(event.documentId&&wc.documentId&&event.documentId!==wc.documentId)return;
  if(event.type==='metadata')for(const row of event.rows||[])metaStores.get(wc.id)?.set(row.id,row);
  else if(event.type==='grades')for(const row of event.rows||[])gradeStores.get(wc.id)?.set(row.code,row.name);
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
    const key=wc.id+':'+e.seq;
    if(e.kind==='request'){
      if(run.targetId!==wc.id)return;
      run.entryRequests.add(key);run.entry.requestCount++;
      void js(wc,entry.noteGateRequest,{runId:run.id}).then(status=>rememberGate(run,status)).catch(()=>{});
    }else if(run.entryRequests.has(key)){
      if(e.kind==='finished')run.entry.receivedCount++;
      if(e.kind==='failed')run.entry.failedCount++;
      if(Number.isFinite(e.durationMs))run.entry.lastRequestDurationMs=e.durationMs;
    }
    state();
  }else if(['error','metadata-error','observer-error'].includes(event.type))state(event.message||'Chrome 좌석 정보 연결을 확인해 주세요.');
}
function seedDemo(id){const store=metaStores.get(id);if(store)for(const s of metadata.parseMetadata(require('./demo-data')))store.set(s.id,s);}
async function scan(){
  const wc=current();seatRefs.clear();const version=++revision,scope=scopeVersions.get(wc.id);
  if(!liveAdapter.supportedUrl(wc.getURL())&&!wc.isDemo())return {seats:[],revision,supported:false,message:'Chrome에서 구역 또는 좌석 화면을 연 뒤 확인해 주세요.'};
  await ensureNetwork(wc);
  const data=await measured(wc,'seat-read',()=>wc.readSeats());
  if(version!==revision||wc.id!==active||scope!==scopeVersions.get(wc.id))throw Error('화면이 변경되었습니다. 다시 확인해 주세요.');
  const rows=metadata.enrich(data.rows,metaStores.get(wc.id),gradeStores.get(wc.id));
  const seats=rows.map(row=>{const key=String(++nextSeat);seatRefs.set(key,{row,wcId:wc.id,revision,url:wc.getURL(),created:Date.now()});return {...row,key};});
  const missingDetails=rows.some(row=>row.kind==='seat')&&!rows.some(row=>row.kind==='seat'&&row.row!=null&&row.grade);
  return {seats,revision,supported:true,message:missingDetails?'좌석 상세 정보가 아직 없습니다. 연결 전에 좌석 화면을 열었다면 Chrome에서 구역을 다시 선택해 주세요.':data.message};
}
async function seatAction(payload) {
  const ref = seatRefs.get(payload?.key);
  if (!ref || ref.revision !== revision || ref.wcId !== active || current().getURL() !== ref.url || Date.now()-ref.created>30000) throw new Error('좌석 목록이 만료되었습니다. 다시 확인해 주세요.');
  await current().seatAction(ref.row,payload.action);
  if (payload.action === 'click') { seatRefs.clear(); revision++; }
  await current().focus();
  return {message: payload.action === 'click' ? '좌석에 클릭을 전달했습니다. 사이트의 선택 결과를 확인해 주세요.' : '좌석 위치로 이동했습니다.'};
}
function measured(wc,action,task){const run=runs.current;return run?.windowIds.has(wc.id)?run.metrics.measure(action,task):task();}
const js=(wc,fn,arg)=>{assertAvailable(wc);const name=typeof fn==='string'?fn:fn?.name;const action=name==='scene'?'screen-read':name==='liveRead'?'seat-read':name==='clickKnown'?'screen-action':name==='stopWatchers'?'cleanup':'page-command';return measured(wc,action,()=>wc.invoke(fn,arg));};
function savePreferences(input){
  preflightResult=null;
  const normalized=normalizePreferences(input);
  venueStore.saveActive(normalized);preferences=normalized;
  fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(preferencesPath,JSON.stringify(preferences,null,2));return preferences;
}
function setRunStatus(run,text){if(runs.current!==run)return;if(run.status!==text){run.status=text;const phase=phaseForStatus(text);run.metrics.stage(phase.code,phase.label);run.timeline.push({stage:text,code:phase.code,elapsedMs:run.metrics.snapshot().elapsedMs});if(run.timeline.length>200)run.timeline.splice(0,run.timeline.length-200);state(text);}}
function beginRun(wc,input,kind){
  if(runner)throw Error('진행 중인 작업을 중지하고 정리가 끝날 때까지 기다려 주세요.');
  if(captchaStatus.busy||manualCaptcha.pending)throw Error('보안문자 테스트를 마치거나 중지한 뒤 시작해 주세요.');
  captchaService?.resetAuto();
  const p=normalizePreferences(input||preferences);preferences=p;
  const run=runs.begin(wc.id,p,kind);runner=run;powerId=powerSaveBlocker.start('prevent-display-sleep');
  run.entry={strategy:'site',offsetMs:0,trigger:null,clockOutcome:'not-configured',requestCount:0,receivedCount:0,failedCount:0,seatPageObserved:false};run.entryRequests=new Set();
  run.entryDocuments=new Map([...targets.values()].map(target=>[target.id,{documentId:target.documentId||null}]));run.entryActionsStarted=false;
  run.triedJobs=new Set();run.excludedIds=new Set();run.excludedGroups=new Set();run.retry=new SeatRetry();state('준비 중');return run;
}
function finishRun(run,message){
  if(runs.current!==run)return;
  const metrics=run.metrics.snapshot();
  lastRun={id:run.id,durationMs:metrics.elapsedMs,stages:run.timeline.slice(-80),message,stopReason:run.stopReason||null,failureDetail:run.failureDetail||null,entry:{...run.entry},retry:run.retry?.snapshot(),metrics,diagnosis:diagnosisForRun(run,message)};
  try{fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(lastRunPath,JSON.stringify(safeLastRun(lastRun),null,2));diagnosticWarning='';}
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
async function readEntryPage(run,wc,fn,arg){
  // Only reads may recover when Chrome reports that navigation won the race.
  // Entry/notice/seat mutations must keep their normal no-replay failure path.
  if(![entry.gateStatus,'gateState','pageClock'].includes(fn))throw Error('진입 화면 관찰에 허용되지 않은 동작입니다.');
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
    if(error?.message!=='페이지가 바뀌어 이전 화면의 동작을 취소했습니다.'||run.kind!=='auto'||run.seatScope)throw error;
    // The command reply can precede the tab/document event. Wait only on this
    // explicit race, without reissuing the read or any booking request.
    const deadline=performance.now()+1500;
    while(true){
      if(moved()){setRunStatus(run,'예매창 화면 전환 확인 · 새 화면 관찰 계속');return ENTRY_READ_MOVED;}
      if(performance.now()>=deadline)throw error;
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
  const offsetMs=run.entry.offsetMs||0;
  if(estimate.validForMs<run.openAt+offsetMs-estimate.serverNowMs||run.clockAppliedAnchor===clockInfo.anchorMonoMs)return;
  const sample=clockInfo,before=performance.now(),scope=scopeVersions.get(wc.id),url=wc.getURL();
  const page=await readEntryPage(run,wc,'pageClock');const after=performance.now();
  if(page===ENTRY_READ_MOVED)return;
  if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)return;
  if(scopeVersions.get(wc.id)!==scope||wc.getURL()!==url)throw Error('시각을 연결하는 동안 준비 화면이 변경되었습니다. 다시 시작해 주세요.');
  const pageMono=page?.pageMono;
  const roundTrip=after-before,atPage=clockForGate(sample,{monoNow:(before+after)/2});
  if(!atPage||!Number.isFinite(pageMono)||typeof page.documentId!=='string'||roundTrip>250||atPage.uncertaintyMs+roundTrip/2>501)return;
  const installed=await runJs(run,wc,entry.setGateClock,{runId:run.id,goodsCode:run.goodsCode,documentId:page.documentId,source:'ticket-server',openAt:run.openAt,deadlineMono:pageMono+run.openAt-atPage.serverNowMs+offsetMs,validUntilMono:pageMono+atPage.validForMs-roundTrip/2,uncertaintyMs:atPage.uncertaintyMs+roundTrip/2});
  if(installed){run.clockAppliedAnchor=sample.anchorMonoMs;run.entry.clockOutcome='armed';run.entry.clockReason='공식 오픈 시각 예약 · 비활성이면 기존 감지를 유지합니다.';}
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
  return {games:rows.map(g=>({...g,openAt:parseOpening(g.schedule)})),pageInfo,compatibilityWarning,message:message+(compatibilityWarning?' '+compatibilityWarning:'')};
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
    dismissConflict:async()=>{assertScope();return js(wc,flow.dismissConflict);}
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
async function selectCandidates(wc,run,groups){
  const result=await selection.chooseCandidates({groups,adapter:selectionAdapter(wc,run),signal:run.signal,preferences:run.preferences,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups,onStatus:text=>setRunStatus(run,text)});
  run.retry.attempted+=result.attempted||0;return result;
}
async function recommend(){const result=await scan();const groups=rankGroups(result.seats,preferences);return {...result,groups,message:groups.length?`선호 조건에 맞는 ${groups.length}개 조합 · ${preferences.quantity}매`:'현재 표시된 좌석 중 조건을 검증할 수 있는 조합이 없습니다.'};}
function launch(run,task){
  const stopWatchers=()=>Promise.allSettled([...run.windowIds].map(id=>{const wc=targets.get(id);return wc&&!wc.isDestroyed()&&wc.missingSince==null?js(wc,'stopWatchers'):null;}));
  run.task=(async()=>{try{const result=await task();if(result?.completed===true)run.outcome='price-confirmed';await stopWatchers();finishRun(run,result?.message||'작업이 끝났습니다.');return result;}catch(error){run.failureDetail=error.message;await stopWatchers();finishRun(run,run.stopReason||(run.signal.aborted?'중지했습니다. ':'')+error.message);throw error;}})();
  run.task.catch(()=>{});return run.task;
}
async function startRun(payload){
  const extensionVersion=bridge.getState().extensionVersion;
  if(!payload?.inspectionOnly&&extensionVersion!==undefined&&!seatExtensionCompatible(extensionVersion))throw Error('좌석 진행 개선에는 v0.9.4 이상 Chrome 확장이 필요합니다. 새 배포 폴더의 chrome-extension을 등록하고 다시 연결해 주세요.');
  if(bridge.getState().bookingNoticeSupported===false)throw Error('예매 안내를 처리하려면 v0.9 폴더의 chrome-extension을 등록하고 새 코드로 다시 연결해 주세요.');
  const requestedPreferences=normalizePreferences(payload?.preferences||preferences);
  if(!requestedPreferences.manualCaptchaAssist&&requestedPreferences.autoCaptcha!==false&&!payload?.inspectionOnly&&bridge.getState().captchaSupported===false)throw Error('보안문자 자동 인식에는 v0.9 Chrome 확장이 필요합니다. 새 확장을 연결해 주세요.');
  const wc=current(),isGate=/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+(?:[/?#]|$)/.test(wc.getURL()),isSeat=liveAdapter.supportedUrl(wc.getURL())||wc.isDemo();
  if(!isEntryPage(wc.getURL())&&!isGate&&!isSeat)throw Error('경기 목록 또는 해당 경기의 예매 준비·좌석 화면에서 시작해 주세요.');
  const offsetMs=payload?.entryOffsetMs??0;
  if(!Number.isInteger(offsetMs)||offsetMs < -250||offsetMs > 250)throw Error('진입 시각 보정은 -250~250ms 범위의 정수로 입력해 주세요.');
  const run=beginRun(wc,payload?.preferences,'auto');
  run.inspectionOnly=payload?.inspectionOnly===true;run.entry.offsetMs=offsetMs;
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
      run.openAt=Date.now();
    }
    else{
      const all=await runJs(run,wc,entry.gameCards);const game=all.find(g=>g.key===payload?.key);if(!game)throw Error('대상 경기를 먼저 선택해 주세요.');
      run.game=game;run.openAt=payload.openAt==null?(parseOpening(game.schedule)??Date.now()):Number(payload.openAt);
      if(!Number.isFinite(run.openAt)||run.openAt>Date.now()+15*86400000)throw Error('15일 이내의 오픈 시각을 입력해 주세요.');
      const officialOpenAt=parseOpening(game.schedule);run.clockEligible=run.entry.strategy==='clock'&&officialOpenAt!=null&&run.openAt===officialOpenAt;
      run.entryActionsStarted=true;
      const prepared=await runJs(run,wc,entry.prepareEntry,{key:game.key,runId:run.id});
      if(prepared?.phase!=='clicked'||prepared.runId!==run.id)throw Error('준비 화면 진입 클릭의 처리 결과를 확인하지 못했습니다. 중복 실행하지 않고 중지합니다.');
      run.entry.preparationConfirmed=true;
      setRunStatus(run,'예매 준비 화면 진입 · 사이트 개방 대기');
    }
    if(run.entry.strategy==='clock'&&!run.clockEligible){run.entry.clockOutcome='fallback';run.entry.clockReason='이 경기의 공식 오픈 시각을 확인하지 못했거나 입력값이 다릅니다. 활성화 감지만 사용합니다.';}
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
          context.seats={visible:rows.filter(r=>r.kind==='seat').length,detailed:rows.filter(r=>r.kind==='seat'&&Number.isInteger(r.row)&&Number.isInteger(r.number)&&r.grade).length,groups:rankGroups(rows,input).length,alphaRows:rows.some(r=>r.rowKind==='alpha')};
        }
      }
    }catch{context.readFailed=true;context.networkHealthy??=false;}
  }
  if(wc&&(active!==id||targets.get(id)!==wc||wc.documentId!==documentId||wc.getURL()!==url||scopeVersions.get(id)!==scope||wc.missingSince!=null))throw Error('점검 중 대상 화면이 바뀌었습니다. 현재 탭에서 다시 점검해 주세요.');
  preflightResult={...buildPreflight(context),checkedAt:Date.now()};state();return {...preflightResult,preflight:preflightResult};
}
async function nextGrade(run,wc,info,message){
  if(!info.buttons.some(b=>b.label==='좌석도 전체보기'&&b.enabled)){
    // A map without a known navigation control may update itself. Keep rejected
    // combinations excluded until its observed seats actually change.
    run.mapWaitOnly=true;
    await run.retry.next({signal:run.signal,reason:message+' 현재 지도 갱신 대기',onStatus:text=>setRunStatus(run,text),wait:pause});runs.assert(run);
    return;
  }
  run.mapWaitOnly=false;
  await runJs(run,wc,flow.clickKnown,'좌석도 전체보기');run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=Date.now();setRunStatus(run,message+' · 다음 조건/구역 확인');
}
async function restartSearch(run){
  await run.retry.next({signal:run.signal,reason:'설정한 조건을 모두 확인했습니다',onStatus:text=>setRunStatus(run,text),wait:pause});runs.assert(run);
  // A new round reopens the site's own grade map before considering the old
  // failures again; merely looping over the same candidate array is forbidden.
  run.triedJobs.clear();run.excludedIds.clear();run.excludedGroups.clear();
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
  if(!run.preferences.autoNotice){setRunStatus(run,'예매 안내 직접 확인 대기 · 확인하고 예매하기');return false;}
  const documentId=wc.documentId,key=notice.key||null,attempt=run.noticeAttempt;
  if(attempt&&attempt.id===wc.id&&attempt.documentId===documentId&&attempt.key===key){
    if(Date.now()-attempt.started>10000)throw Error('예매 안내 확인 후 화면 변화를 확인하지 못했습니다. 같은 버튼을 다시 누르지 않고 중지합니다.');
    setRunStatus(run,'예매 안내 확인 완료 · 사이트 화면 전환 확인 중');return false;
  }
  if(!notice.enabled){setRunStatus(run,'예매 안내 버튼을 확인하는 중 · 비활성 또는 여러 버튼은 누르지 않습니다.');return false;}
  const started=Date.now(),version=scopeVersions.get(wc.id),url=wc.getURL();
  run.noticeAttempt={id:wc.id,documentId,key,started};
  const result=await runJs(run,wc,flow.clickKnown,'확인하고 예매하기');
  if(result?.present===false){run.noticeAttempt=null;return true;}
  if(result?.disabled){run.noticeAttempt=null;return false;}
  if(result===true||result?.clicked){
    run.noticeAttempt.key=result?.key||key;
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
  if(run.seatScope?.id===wc.id&&run.seatScope.version===transition.version){run.seatScope={id:wc.id,version:scopeVersions.get(wc.id)};run.currentJob=null;run.gradeOpenedAt=null;run.awaitingGradesAt=null;}
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
    if(/^https:\/\/tickets\.interpark\.com\/waiting(?:[/?#]|$)/.test(url))setRunStatus(run,'대기열 진입 · 기존 순서를 유지하며 대기');
    else if(url.startsWith('https://accounts.yanolja.com/'))setRunStatus(run,'로그인 대기 · 사이트에서 직접 로그인해 주세요.');
    else if(/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+/.test(url)){
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
      if((!status||status.phase==='stopped'||status.runId!==run.id)&&!run.entry.trigger&&!run.entry.requestCount)status=await runJs(run,wc,entry.armGate,{goodsCode:run.goodsCode,runId:run.id,timeoutMs:Math.max(60000,(run.openAt||Date.now())-Date.now()+30*60000)});
      else if(status?.phase==='timeout'||status?.phase==='blocked')throw Error('예매 준비 화면의 활성화를 확인하지 못했습니다.');
      rememberGate(run,status);
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      await scheduleGateClock(run,wc,status);
      if(run.targetId!==wc.id||wc.missingSince!=null||wc.getURL()!==url)continue;
      if(run.entry.trigger||run.entry.requestCount){run.entryDispatchedAt??=Date.now();if(Date.now()-run.entryDispatchedAt>10000)throw Error('진입 클릭/요청 이후 화면 이동을 확인하지 못했습니다. 중복 실행하지 않고 중지합니다.');}
      if(gate.enabled&&status?.observedDisabled===false){run.awaitingAutoAt??=Date.now();if(Date.now()-run.awaitingAutoAt>10000)throw Error('이미 열린 준비 화면에서 사이트의 자동 진입을 확인하지 못했습니다. 예매 화면을 직접 확인해 주세요.');}
      setRunStatus(run,gate.enabled?'예매 버튼 활성화 확인 · 진입 중':'예매 준비 완료 · 사이트가 버튼을 열 때까지 대기');
    }
    else if(isEntryPage(url)){
      if(Date.now()-run.started>30000&&Date.now()>(run.openAt||0)+30000)throw Error('예매 준비 화면으로 이동하지 못했습니다. 로그인과 팝업을 확인해 주세요.');
    }
    else if(liveAdapter.supportedUrl(url)||wc.isDemo()){
      if(run.entry)run.entry.seatPageObserved=true;
      if(run.inspectionOnly)return {message:'진입 확인 완료 · 좌석을 선택하지 않고 중지했습니다.'};
      const info=await runJs(run,wc,flow.scene),button=label=>info.buttons.some(b=>b.label===label&&b.enabled);
      if(info.completed)return {completed:true,message:'좌석 선택 승인 · 가격/할인 화면 도착을 확인했습니다. 결제는 직접 진행해 주세요.'};
      // Pin the booking context on first seat-page entry, including the time
      // spent waiting for CAPTCHA or navigating grade lists.
      const scope=scopeVersions.get(wc.id);
      if(run.seatScope==null){run.seatScope={id:wc.id,version:scope};}
      else if(run.seatScope.id!==wc.id||run.seatScope.version!==scope)throw Error('경기 또는 회차가 변경되어 자동 진행을 중지했습니다.');
      const notice=noticeState(info);
      if(notice.present){
        if(info.selected.length)throw Error('기존에 선택한 좌석이 있어 예매 안내를 자동으로 넘기지 않습니다. 사이트에서 확인해 주세요.');
        if(await acknowledgeNotice(run,wc,notice))continue;await pause(100,run.signal);continue;
      }
      noticeAbsent(run);
      if(!info.captcha&&manualCaptcha.status.present)manualCaptcha.clear('보안문자 화면이 닫혔습니다. 사이트의 다음 단계를 확인합니다.');
      if(info.captcha){
        if(run.preferences.manualCaptchaAssist){
          if(!manualCaptcha.pending&&!run.manualAssistUnavailable){
            try{await prepareManualCaptcha(wc,run,{background:true});runs.assert(run);}
            catch(error){runs.assert(run);run.manualAssistUnavailable=true;manualCaptcha.clear(error.message);}
          }
          setRunStatus(run,manualCaptcha.status.message||'보안문자 직접 입력 대기');
        }
        else if(!run.preferences.autoCaptcha||run.captchaDisabled)setRunStatus(run,'보안문자 직접 입력 대기');
        else{
          try{
            if(run.captchaHeld){
              const held=await runJs(run,wc,'captcha.captchaStatus',{challengeId:run.captchaHeld.challengeId});
              if(held?.status==='changed'){run.captchaHeld=null;continue;}
              setRunStatus(run,run.captchaHeld.message);
            }else{
              setRunStatus(run,'보안문자 자동 인식 · 입력·확인 진행');
              const result=await processCaptcha(wc,'auto',run);runs.assert(run);setRunStatus(run,result.message);
              if(['verified','changed'].includes(result.status))continue;
              if(['manual','uncertain'].includes(result.status)){
                if(result.challengeId)run.captchaHeld=result;else run.captchaDisabled=true;
              }
            }
          }catch(error){
            runs.assert(run);captchaAdapter(wc,run).assertCurrent();
            run.captchaDisabled=true;setRunStatus(run,'자동 인식 중단 · 직접 입력해 주세요. '+error.message);
          }
        }
      }
      else if(info.dialog)throw Error('사이트 안내를 확인해 주세요. '+info.dialog.text);
      else if(info.selected.length)throw Error('기존에 선택한 좌석이 있습니다. 확인/해제한 뒤 다시 시작해 주세요.');
      else if(run.awaitingGradesAt&&info.hasSeats){if(Date.now()-run.awaitingGradesAt>8000)throw Error('구역 목록으로 돌아가는 화면 전환을 확인하지 못했습니다.');setRunStatus(run,'구역 목록 화면 도착을 기다리는 중');}
      else if(button('직접 좌석 선택하기')){
        if(run.directMapAttempt){
          if(Date.now()-run.directMapAttempt>12000)throw Error('직접 좌석 선택 후 지도 전환을 확인하지 못했습니다. 같은 버튼을 다시 누르지 않고 중지합니다.');
          setRunStatus(run,'직접 좌석 지도 화면 전환 대기');
        }else{
          run.directMapAttempt=Date.now();await runJs(run,wc,flow.clickKnown,'직접 좌석 선택하기');run.gradeOpenedAt=Date.now();setRunStatus(run,'직접 좌석 선택 화면 진입');continue;
        }
      }
      else if(info.grades.length&&!run.currentJob&&!info.hasSeats){
        run.awaitingGradesAt=null;
        const plan=gradePlan(info.grades,run.preferences);const job=plan.find(j=>!run.triedJobs.has(JSON.stringify([j.tierIndex,j.name])));
        if(!job)await restartSearch(run);
        else{
          const data=await runJs(run,wc,liveAdapter.liveRead);const row=data.rows.find(r=>r.name===job.name);
          if(row){runs.assert(run);await measured(wc,'grade-open',()=>wc.seatAction(row,'click'));runs.assert(run);run.currentJob=job;run.directMapAttempt=null;run.gradeOpenedAt=Date.now();run.triedJobs.add(JSON.stringify([job.tierIndex,job.name]));setRunStatus(run,`${run.retry.cycle}차 · ${job.tierIndex+1}순위 · ${job.name} 확인`);continue;}
          else{run.triedJobs.add(JSON.stringify([job.tierIndex,job.name]));}
        }
      }
      else if(info.hasSeats){
        run.directMapAttempt=null;
        run.gradeOpenedAt??=Date.now();
        const result=await candidatesFor(wc,run.preferences,{tierIndex:run.currentJob?.tierIndex,excludedIds:run.excludedIds,excludedGroups:run.excludedGroups});runs.assert(run);
        const {rows}=result;let {groups}=result;
        const changed=run.retry.observe(run.currentJob?.name||'current-map',rows);
        if(changed&&run.mapWaitOnly){run.excludedIds.clear();run.excludedGroups.clear();groups=rankGroups(rows,run.preferences,{tierIndex:run.currentJob?.tierIndex});}
        if(groups.length){
          setRunStatus(run,`${run.retry.cycle}차 · ${groups.length}개 후보 준비 · 순서대로 선택 확인`);
          const selected=await selectCandidates(wc,run,groups);
          // An accepted completion remains success even if cancellation arrived
          // while its final server response was still in flight.
          if(selected.completed)return selected;
          runs.assert(run);if(!selected.exhausted)return selected;
          if(selected.limited){setRunStatus(run,'20개 후보 확인 · 최신 지도에서 남은 후보를 이어서 확인');continue;}
          await nextGrade(run,wc,await runJs(run,wc,flow.scene),'현재 후보들이 선점되어 제외했습니다.');
        }
        else{
          const elapsed=Date.now()-run.gradeOpenedAt;
          const incomplete=rows.some(r=>r.kind==='seat'&&(r.row==null||!r.grade));
          if((!incomplete&&elapsed>1500)||(incomplete&&elapsed>8000))await nextGrade(run,wc,info,incomplete?'좌석 상세 정보 일부를 확인하지 못했습니다.':'현재 지도에 조건을 만족하는 좌석이 없습니다.');
          else setRunStatus(run,`좌석 정보 로딩 · 보이는 후보 ${rows.length}개 · 조건에 맞는 조합 0개${incomplete?' · 열·구역 상세 정보 확인 중':''}`);
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
  if(runner&&!['state','stop','focus','code','manualCaptchaPrepare','manualCaptchaSubmit','manualCaptchaFocus','captchaStop','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('진행 중에는 창·설정·좌석을 변경할 수 없습니다. 중지 후 정리가 끝나면 다시 시도해 주세요.');
  if(captchaStatus.busy&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('보안문자 처리 중에는 다른 입력·예매 동작을 실행할 수 없습니다. 완료 또는 중지 후 다시 시도해 주세요.');
  if(manualCaptcha.pending&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('직접 입력한 보안문자를 처리하고 있습니다. 결과를 기다려 주세요.');
  if(manualCodePending&&!['state','stop','captchaStop','focus','restoreWindow','alwaysOnTop','pairingInfo'].includes(action))throw Error('직접 입력한 보안문자를 처리하고 있습니다. 결과를 기다려 주세요.');
  switch(action) {
    case 'state': state(); return {};
    case 'preflight': return inspectRun(payload);
    case 'restoreWindow': revealPanel(true);rememberWindow();return {desktop:desktopState(),message:'도우미 창을 기본 모니터 왼쪽으로 옮겼습니다.'};
    case 'alwaysOnTop': {desktop.alwaysOnTop=payload===true;win?.setAlwaysOnTop(desktop.alwaysOnTop);persistDesktop();updateWindowMenu();state();return {desktop:desktopState(),message:desktop.alwaysOnTop?'도우미를 항상 위에 표시합니다.':'다른 창을 도우미 위에 올릴 수 있습니다.'};}
    case 'pairingInfo': return {...bridge.getState(),...(bridgeError?{pairCode:null,message:bridgeError}:{}),extensionPath};
    case 'refreshPairing': {if(bridgeError)throw Error(bridgeError);const info=bridge.refreshPairing();browserStatus={...bridge.getState()};state();return {...info,extensionPath};}
    case 'copyPairCode': {if(bridgeError)throw Error(bridgeError);const info=bridge.getState();if(!info.pairCode||Date.now()>info.expiresAt)throw Error('연결 코드가 없거나 만료되었습니다. 새 연결 코드를 먼저 만드세요.');clipboard.writeText(info.pairCode);return {message:'연결 코드를 복사했습니다. Chrome 확장 팝업에 붙여 넣으세요.'};}
    case 'openExtensionFolder': {const error=await shell.openPath(extensionPath);if(error)throw Error(error);return {message:'Chrome에 등록할 확장 폴더를 열었습니다.'};}
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
    case 'scan': return scan();
    case 'seat': return seatAction(payload);
    case 'preferences': savePreferences(payload);state('현재 구장의 선호 조건을 저장했습니다.');return {preferences,venueProfiles:venueStore.getState()};
    case 'venueSelect': {
      preflightResult=null;
      preferences=venueStore.select(payload?.id,payload?.preferences);
      state('이전 구장 조건을 저장하고 선택한 구장 설정을 불러왔습니다.');return {preferences,venueProfiles:venueStore.getState(),message:'선택한 구장 설정을 불러왔습니다.'};
    }
    case 'venueCreate': {
      preflightResult=null;
      preferences=venueStore.create(payload?.name,payload?.preferences);
      state('현재 조건으로 새 구장 설정을 저장했습니다.');return {preferences,venueProfiles:venueStore.getState(),message:'현재 조건으로 새 구장 설정을 저장했습니다.'};
    }
    case 'games': return games();
    case 'clock': return syncClock();
    case 'start': return startRun(payload);
    case 'stop': await stopRun('자동 진행을 중지했습니다.');await stopCaptcha();return {};
    case 'manualCaptchaPrepare':
    case 'manualCaptchaFocus': {
      const wc=runner?targetFor(runner):current();
      if(runner){runner.captchaDisabled=true;runner.preferences.manualCaptchaAssist=true;runner.manualAssistUnavailable=false;}
      if(action==='manualCaptchaFocus')await wc.focus();
      return prepareManualCaptcha(wc,runner);
    }
    case 'manualCaptchaSubmit': {
      if(runner){runner.captchaDisabled=true;runner.preferences.manualCaptchaAssist=true;}
      const result=await manualCaptcha.submit(payload);
      return {...result,manualCaptcha:manualCaptcha.status};
    }
    case 'captchaRead': manualCaptcha.clear();return processCaptcha(current(),'read');
    case 'captchaSubmit': return processCaptcha(current(),'submit');
    case 'captchaStop': if(runner)await stopRun('보안문자 처리와 자동 진행을 중지했습니다.');return stopCaptcha();
    case 'code': {
      // An explicit manual submission takes precedence for this run, including
      // the time spent awaiting Chrome's reply.
      if(runner)runner.captchaDisabled=true;manualCodePending=true;
      try{await js(runner?targetFor(runner):current(),flow.enterCode,String(payload||'').trim().toUpperCase());return {message:'보안문자를 입력했습니다. 인증 결과를 확인합니다.'};}
      finally{manualCodePending=false;}
    }
    case 'recommend': if(payload?.preferences)preferences=normalizePreferences(payload.preferences);return recommend();
    case 'choose': {const wc=current();if(!liveAdapter.supportedUrl(wc.getURL())&&!wc.isDemo())throw Error('좌석 화면에서 실행해 주세요.');const run=beginRun(wc,payload?.preferences,'manual');return launch(run,async()=>{await ensureNetwork(wc);runs.assert(run);const {groups}=await candidatesFor(wc,run.preferences);runs.assert(run);if(!groups.length)throw Error('현재 지도에 조건에 맞는 조합이 없습니다. 상세 정보가 없다면 Chrome에서 구역을 다시 선택해 주세요.');return selectCandidates(wc,run,groups);});}
    case 'complete': {const wc=current();if(!liveAdapter.supportedUrl(wc.getURL())&&!wc.isDemo())throw Error('좌석 화면에서 실행해 주세요.');const run=beginRun(wc,payload?.preferences,'manual');return launch(run,async()=>{
      await ensureNetwork(wc);runs.assert(run);
      const adapter=selectionAdapter(wc,run),info=await adapter.snapshot();runs.assert(run);
      const seats=metadata.enrich(info.selected.map(id=>({id,available:true})),metaStores.get(wc.id),gradeStores.get(wc.id));
      if(!rankGroups(seats,run.preferences).some(g=>g.seats.length===info.selected.length&&g.seats.every(s=>info.selected.includes(s.id))))throw Error('선택된 좌석이 현재 매수·연석·구역·열 조건을 만족하는지 확인하지 못했습니다.');
      return selection.completeSelection({adapter,signal:run.signal,preferences:run.preferences,onStatus:text=>setRunStatus(run,text)});
    });}
    default: throw new Error('지원하지 않는 동작입니다.');
  }
}
app.whenReady().then(async()=>{
  if(!smoke&&!app.requestSingleInstanceLock()){app.quit();return;}
  app.on('second-instance',()=>revealPanel());app.on('activate',()=>revealPanel());
  const bounds=desktopSettings.visibleBounds(desktop.windowBounds,screen.getAllDisplays(),screen.getPrimaryDisplay());
  win=new BrowserWindow({...bounds,minWidth:Math.min(360,bounds.width),minHeight:Math.min(500,bounds.height),show:!smoke,alwaysOnTop:desktop.alwaysOnTop,autoHideMenuBar:true,backgroundColor:'#101827',title:'야구 티켓팅 도우미',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('move',rememberWindow);win.on('resize',rememberWindow);
  screen.on('display-removed',()=>revealPanel());screen.on('display-metrics-changed',()=>{if(!win.isMinimized())revealPanel();});
  if(!smoke){try{createTray();}catch(error){console.warn('Tray unavailable:',error.message);}updateWindowMenu();}
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  bridge=new BrowserBridge(smoke?{port:0}:{});
  bridge.on('tabs',trackTabs);bridge.on('document',onDocument);bridge.on('event',onBrowserEvent);
  bridge.on('connected',()=>{browserStatus={...bridge.getState()};state('Chrome이 연결되었습니다. 예매할 탭을 선택해 주세요.');});
  bridge.on('disconnected',()=>{browserStatus={...bridge.getState()};captchaService?.cancel();void stopRun('Chrome 연결이 끊겨 중지했습니다.');trackTabs([]);state();});
  try{await bridge.start();bridgeReady=true;browserStatus={...bridge.getState()};}catch(error){bridgeError=desktopSettings.bridgeFailure(error);browserStatus={connected:false,message:bridgeError};}
  ipcMain.handle('helper:run',async(event,action,payload)=>{
    if(closing||!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame?.url!==SHELL)return {error:'허용되지 않은 요청입니다.'};
    try{return await command(action,payload);}catch(error){return {error:error.message};}
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
  if(smoke)await require('./panel-smoke')({app,win,bridge,command,state,targets});
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
