'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=require('./probe-core');
const {createRunRegistry,createNavigationAttribution}=require('./probe-run');
const smoke=process.argv.includes('--probe-smoke');
app.setPath('userData',path.join(__dirname,'../work',`probe-runtime-${process.pid}`));
app.commandLine.appendSwitch('disable-http-cache');
const HOME='https://nol.yanolja.com/ticket/genre/sports/bears';
const SHELL=pathToFileURL(path.join(__dirname,'probe.html')).href;
let panel,site,ses,busy=false,endpoint=core.ENDPOINT,closing=false;
const runs=createRunRegistry();let attemptSequence=0;
let results=[];const windows=new Set();const pending=new Set();
function state(message){if(panel&&!panel.isDestroyed())panel.webContents.send('probe:state',{message,results});}
function record(row){results.push(row);state('요청 결과를 기록했습니다. HTTP 성공만으로 좌석 페이지 진입을 확정할 수 없습니다.');}
function track(wc,run=runs.create(wc.id)){
  wc.debugger.attach('1.3');
  const observed=new Map(),directIds=new Set();
  const navigation=createNavigationAttribution();
  wc.debugger.sendCommand('Network.enable').catch(()=>state('요청 관찰을 시작하지 못했습니다.'));
  wc.debugger.sendCommand('Fetch.enable',{patterns:[{urlPattern:endpoint,requestStage:'Request'}]}).catch(()=>state('직접 전송 연결을 시작하지 못했습니다.'));
  wc.debugger.on('message',async(_event,method,p)=>{
    try{
      if(method==='Fetch.requestPaused'){
        if(busy||!core.matches(p.request,endpoint)||!runs.consume(run))return await wc.debugger.sendCommand('Fetch.continueRequest',{requestId:p.requestId});
        // Consume the arm before awaiting; the original request never goes to the network.
        busy=true;directIds.add(p.networkId);pending.add(p.requestId);
        if(observed.has(p.networkId))observed.get(p.networkId).mode='직접 전송';
        state('직접 전송 1건 진행 중 · 자동 재시도 없음');
        try{
          const result=await core.transmit(ses.fetch.bind(ses),p.request);
          await wc.debugger.sendCommand('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:result.responseCode,responseHeaders:result.responseHeaders,body:result.body});
        }catch{
          try{await wc.debugger.sendCommand('Fetch.failRequest',{requestId:p.requestId,errorReason:'Aborted'});}catch{}
        }finally{pending.delete(p.requestId);busy=false;}
      }
      if(method==='Network.requestWillBeSent'&&core.matches(p.request,endpoint)){
        const localStart=performance.now();
        observed.set(p.requestId,{start:p.timestamp,attemptId:`${run.runId}-${++attemptSequence}`,mode:directIds.has(p.requestId)?'직접 전송':'일반 버튼'});
        navigation.begin(p.requestId,localStart,wc.getURL());
      }
      if(method==='Network.responseReceived'&&observed.has(p.requestId))observed.get(p.requestId).status=p.response.status;
      if((method==='Network.loadingFinished'||method==='Network.loadingFailed')&&observed.has(p.requestId)){
        const r=observed.get(p.requestId);observed.delete(p.requestId);
        const row={runId:run.runId,attemptId:r.attemptId,windowId:wc.id,rootWindowId:run.rootWindowId,mode:directIds.has(p.requestId)?'직접 전송':r.mode,status:r.status,elapsedMs:Math.round((p.timestamp-r.start)*10000)/10,outcome:method==='Network.loadingFinished'?'응답 수신':'통신 실패 · 재시도 없음'};
        navigation.response(p.requestId,row);record(row);directIds.delete(p.requestId);
      }
    }catch{state('요청 관찰 연결에 문제가 발생했습니다. 직접 전송을 다시 예약하지 마세요.');}
  });
  wc.on('did-start-navigation',(_event,url,inPlace,isMainFrame)=>{if(isMainFrame)navigation.starting(url,{inPlace});});
  const arrived=(_event,url,isMainFrame=true)=>{if(isMainFrame&&navigation.arrived(url))state('같은 시도의 좌석 페이지 URL 도착을 기록했습니다. 화면 표시/보안문자 완료 시간은 별도입니다.');};
  wc.on('did-navigate',arrived);wc.on('did-navigate-in-page',arrived);
  wc.on('will-navigate',(e,url)=>{if(!smoke&&!url.startsWith('https://'))e.preventDefault();});
  wc.setWindowOpenHandler(({url})=>({action:url.startsWith('https://')||url==='about:blank'?'allow':'deny',overrideBrowserWindowOptions:{webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true}}}));
  wc.on('did-create-window',child=>{windows.add(child);track(child.webContents,run);child.on('closed',()=>windows.delete(child));});
  wc.on('destroyed',()=>{observed.clear();directIds.clear();navigation.clear();if(wc.id===run.rootWindowId)runs.close(run);});
}
async function newSite(url=HOME){
  const next=new BrowserWindow({width:1160,height:900,title:'NOL 예매 비교 실험 · 로그인',webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  windows.add(next);track(next.webContents,runs.create(next.webContents.id));site=next;
  next.on('closed',()=>windows.delete(next));
  await next.loadURL(url);
  return next;
}
app.whenReady().then(async()=>{
  ses=session.fromPartition(`probe-${process.pid}`,{cache:false});
  ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  if(smoke){await require('./probe-smoke').run({app,BrowserWindow,ses,track,setEndpoint:v=>endpoint=v,arm:()=>runs.arm(),observe:()=>runs.observe(),getResults:()=>results});return;}
  panel=new BrowserWindow({width:520,height:850,title:'예매 진입 비교 실험 v2',webPreferences:{preload:path.join(__dirname,'probe-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  ipcMain.handle('probe:command',async(e,action)=>{
    if(e.sender!==panel.webContents||e.senderFrame.url!==SHELL)throw Error('INVALID_SENDER');
    if(busy)throw Error('BUSY');
    if(action==='arm'){if(!site||site.isDestroyed())throw Error('NO_MEASUREMENT_WINDOW');const run=runs.arm();state(`${run.runId} · 최신 측정 창과 그 예매 팝업의 다음 정상 진입 요청 1건만 직접 전송합니다.`);}
    else if(action==='observe'){runs.observe();state('일반 버튼 관찰 모드입니다. 직접 전송 예약을 취소했습니다.');}
    else if(action==='home'){runs.observe();await newSite();state('새 측정 창을 열었습니다. 이전 직접 전송 예약은 취소했으며 로그인 세션은 공유합니다.');}
  });
  panel.on('close',()=>{closing=true;runs.observe();for(const w of windows)if(!w.isDestroyed())w.close();});
  await panel.loadURL(SHELL);state('일반 버튼 관찰 모드 · 별도 창에서 로그인해 주세요.');
  newSite().catch(()=>state('사이트 로딩 실패 · 새 측정 창 열기로 다시 시도하세요.'));
}).catch(()=>{console.error('Probe initialization failed');app.exit(1);});
app.on('window-all-closed',()=>app.quit());
