'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {normalizePreferences}=require('./preferences');
const POSTSEASON='https://nol.yanolja.com/ticket/genre/sports/postseason';

function entryUrl(value){
  try{
    const u=new URL(String(value));
    if(u.username||u.password||!(u.origin==='https://nol.yanolja.com'&&/^\/ticket(?:\/|$)/.test(u.pathname)||u.origin==='https://tickets.interpark.com'&&/^(?:\/gates\/ticket\/\d{8}|\/goods\/\d+)(?:\/|$)/.test(u.pathname)))return null;
    // Store a navigation destination, never session parameters or signed URLs.
    u.search='';u.hash='';return u.href;
  }catch{return null;}
}
function windowBounds(value){
  if(!value||!['x','y','width','height'].every(k=>Number.isFinite(value[k])))return null;
  if(value.width<320||value.height<400||value.width>4096||value.height>8192)return null;
  return Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(value[k])]));
}
function cleanSettings(input={}){
  return {pageUrl:entryUrl(input.pageUrl)||POSTSEASON,favoriteTeam:'삼성 라이온즈',alwaysOnTop:input.alwaysOnTop!==false,...(windowBounds(input.windowBounds)?{windowBounds:windowBounds(input.windowBounds)}:{})};
}
function readJson(file,limit=256*1024){
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error('설정 파일 크기 또는 형식을 확인해 주세요.');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('설정 파일 형식이 올바르지 않습니다.');return value;
}
function migrateSettings({destination,sources}){
  const copied=[];
  for(const [name,clean] of [['preferences.json',normalizePreferences],['settings.json',cleanSettings]]){
    const target=path.join(destination,name);if(fs.existsSync(target))continue;
    for(const source of sources){
      try{
        const value=clean(readJson(path.join(source,name)));
        fs.mkdirSync(destination,{recursive:true});
        fs.writeFileSync(target,JSON.stringify(value,null,2),{flag:'wx'});copied.push(name);break;
      }catch(error){if(error.code==='EEXIST')break;}
    }
  }
  return copied;
}
function visibleBounds(saved,displays,primary,{reset=false}={}){
  const areas=displays.map(d=>d.workArea),fallback=primary.workArea;
  let bounds=!reset&&windowBounds(saved),area;
  if(bounds){
    // Keep the title bar reachable on a real display, including after unplugging one.
    area=areas.find(a=>Math.min(bounds.x+bounds.width,a.x+a.width)-Math.max(bounds.x,a.x)>=120&&bounds.y>=a.y&&bounds.y+32<=a.y+a.height);
  }
  if(!area){area=fallback;bounds={x:area.x,y:area.y,width:400,height:Math.min(960,area.height)};}
  const width=Math.min(Math.max(360,bounds.width),area.width),height=Math.min(Math.max(500,bounds.height),area.height);
  return {x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)),width,height};
}
function revealWindow(win,screen,{reset=false}={}){
  if(!win||win.isDestroyed())return false;
  if(win.isMinimized())win.restore();
  if(reset&&win.isMaximized())win.unmaximize();
  if(!win.isMaximized())win.setBounds(visibleBounds(win.getBounds(),screen.getAllDisplays(),screen.getPrimaryDisplay(),{reset}));
  win.show();win.focus();return true;
}
function bridgeFailure(error){
  return error?.code==='EADDRINUSE'
    ?'다른 도우미가 연결을 사용 중입니다. 이전 버전 도우미를 종료한 뒤 이 프로그램을 다시 실행해 주세요.'
    :'Chrome 연결 준비에 실패했습니다. 프로그램을 다시 실행해 주세요. '+String(error?.message||'').slice(0,180);
}
module.exports={POSTSEASON,entryUrl,cleanSettings,migrateSettings,visibleBounds,revealWindow,bridgeFailure};
