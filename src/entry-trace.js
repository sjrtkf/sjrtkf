'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createTrace}=require('./entry-trace-core');
const HOME='https://nol.yanolja.com/ticket/genre/sports/bears',SHELL=pathToFileURL(path.join(__dirname,'entry-trace.html')).href;
app.setPath('userData',path.join(__dirname,'../work',`entry-trace-runtime-${process.pid}`));
let panel,ses,closing=false;const windows=new Set(),tracked=new Set();
const trace=createTrace({onUpdate:()=>{}});
function state(message){if(panel&&!panel.isDestroyed())panel.webContents.send('entry-trace:state',{message,summary:trace.snapshot()});}
function track(win){const wc=win.webContents,id=wc.id;windows.add(win);tracked.add(id);trace.attach(wc);win.on('closed',()=>{windows.delete(win);tracked.delete(id);});
 wc.setWindowOpenHandler(({url})=>({action:url==='about:blank'||url.startsWith('https://')?'allow':'deny',overrideBrowserWindowOptions:{width:1160,height:900,webPreferences:{session:ses,preload:path.join(__dirname,'entry-trace-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}}}));
 wc.on('did-create-window',child=>track(child));
 wc.on('will-navigate',(event,url)=>{if(!url.startsWith('https://'))event.preventDefault();});
}
async function openSite(){const w=new BrowserWindow({width:1160,height:900,webPreferences:{session:ses,preload:path.join(__dirname,'entry-trace-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});track(w);await w.loadURL(HOME);}
ipcMain.on('entry-trace:mark',(event,data)=>{if(!tracked.has(event.sender.id))return;try{const u=new URL(event.senderFrame.url);if(!['https://nol.yanolja.com','https://tickets.interpark.com'].includes(u.origin))return;trace.mark({kind:data?.kind,at:data?.at,windowId:event.sender.id});}catch{}});
app.whenReady().then(async()=>{
 ses=session.fromPartition(`entry-trace-${process.pid}`,{cache:true});ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 panel=new BrowserWindow({width:570,height:850,webPreferences:{preload:path.join(__dirname,'entry-trace-ui-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());
 ipcMain.handle('entry-trace:command',async(e,action)=>{
  if(e.sender!==panel.webContents||e.senderFrame.url!==SHELL)throw Error('INVALID_SENDER');
  if(action==='start'){trace.start();state('측정 중 · 사이트에서 정상 예매 버튼을 한 번 누르세요.');}
  else if(action==='stop'){trace.stop();const file=path.join(__dirname,'../work',`entry-trace-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(trace.snapshot(),null,2));state('측정 중지 · 인증정보를 제외한 시간 기록을 work 폴더에 저장했습니다.');}
  else if(action==='home'){await openSite();state('새 두산 페이지를 열었습니다.');}
 });
 panel.on('close',()=>{closing=true;trace.stop();for(const w of windows)if(!w.isDestroyed())w.close();});
 await panel.loadURL(SHELL);state('로그인 대기 · 기록 꺼짐');await openSite();
}).catch(e=>{console.error(e.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
