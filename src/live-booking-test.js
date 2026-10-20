'use strict';
// Explicit development integration runner. It uses only the application's
// registered ChromeTarget actions and the same start/stop commands as the panel.
// No browser debugging connection, profile read, arbitrary script or payment action.
const fs=require('node:fs'),path=require('node:path');
const entry=require('./entry'),directApi=require('./direct-seat-api'),flow=require('./flow'),pricePage=require('./price-page');

const IDENTITY_KEYS=['goodsCode','placeCode','playSeq','playDate','playTime'];
const safeText=(value,max=160)=>String(value||'').replace(/https?:\/\/\S+/gi,'[주소]').replace(/(?:cookie|authorization|token|session|signature|password)\s*[:=]\s*\S+/gi,'[보호된 값]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
function routeOf(value){
  try{
    const u=new URL(value);if(u.username||u.password)return null;
    if(u.origin==='https://nol.yanolja.com'&&/^\/ticket\/genre\/sports\/[a-z0-9-]+\/?$/.test(u.pathname))return {stage:'listing',url:u.origin+u.pathname};
    if(u.origin!=='https://tickets.interpark.com')return null;
    if(/^\/gates\/ticket\/\d{8}\/?$/.test(u.pathname))return {stage:'gate',url:u.origin+u.pathname};
    if(u.pathname==='/onestop/seat')return {stage:u.searchParams.get('step')==='price'?'price':'seat',url:u.origin+u.pathname};
    if(['/onestop/payment','/onestop/preorder'].includes(u.pathname))return {stage:u.pathname.endsWith('/payment')?'payment':'preorder',url:u.origin+u.pathname};
  }catch{}
  return null;
}
function identityOf(value){
  if(!value||typeof value!=='object')return null;
  const result={};
  for(const key of IDENTITY_KEYS){
    let item=value[key];
    if(key==='playTime'&&typeof item==='string'){
      const time=item.trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i);
      if(!time)return null;
      let hour=Number(time[1]);if(time[3]){if(hour<1||hour>12)return null;hour=hour%12+(time[3].toUpperCase()==='PM'?12:0);}else if(hour>23)return null;
      item=String(hour).padStart(2,'0')+':'+time[2];
    }
    const pattern=key==='playTime'?/^(?:[01]\d|2[0-3]):[0-5]\d$/:key==='playSeq'?/^\d{3,8}$/:/^\d{8}$/;
    if(typeof item!=='string'||!pattern.test(item))return null;result[key]=item;
  }
  const d=result.playDate,stamp=Date.parse(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${result.playTime}:00+09:00`);
  if(!Number.isFinite(stamp)||new Date(stamp+9*3600000).toISOString().slice(0,10).replaceAll('-','')!==d)return null;
  return result;
}
function cliOptions(args){
  const inspect=args.filter(v=>v==='--live-booking-inspect'),run=args.filter(v=>v.startsWith('--live-booking-test='));
  if(!inspect.length&&!run.length)return null;
  if(inspect.length+run.length!==1)throw Error('LIVE_TEST_FLAGS_INVALID');
  return inspect.length?{mode:'inspect'}:{mode:'run',configPath:run[0].slice('--live-booking-test='.length)};
}
function validateConfig(value,now=Date.now()){
  if(!value||typeof value!=='object'||Array.isArray(value)||!/^[-a-zA-Z0-9_]{8,64}$/.test(value.testId||''))throw Error('LIVE_TEST_CONFIG_INVALID');
  if(!Number.isSafeInteger(value.tabId)||value.tabId<1)throw Error('LIVE_TEST_CONFIG_INVALID');
  const expected=identityOf(value.expected);if(!expected)throw Error('LIVE_TEST_IDENTITY_REQUIRED');
  const saleOpenAt=value.saleOpenAt,expiresAt=value.expiresAt;
  if(!Number.isSafeInteger(saleOpenAt)||saleOpenAt>now||saleOpenAt<now-180*86400000)throw Error('LIVE_TEST_SALE_NOT_OPEN');
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+15*60000)throw Error('LIVE_TEST_CONFIG_EXPIRED');
  const d=expected.playDate,eventAt=Date.parse(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${expected.playTime}:00+09:00`);
  if(eventAt<=now)throw Error('LIVE_TEST_EVENT_PAST');
  const maxRunMs=value.maxRunMs??90000;
  if(!Number.isSafeInteger(maxRunMs)||maxRunMs<1000||maxRunMs>120000)throw Error('LIVE_TEST_CONFIG_INVALID');
  return {testId:value.testId,tabId:value.tabId,expected,saleOpenAt,expiresAt,maxRunMs};
}
function readConfig(configPath,configRoot){
  if(typeof configPath!=='string'||!path.isAbsolute(configPath)||/^\\\\/.test(configPath)||path.extname(configPath).toLowerCase()!=='.json')throw Error('LIVE_TEST_CONFIG_PATH_INVALID');
  const resolved=fs.realpathSync(configPath);
  if(configRoot){const relative=path.relative(fs.realpathSync(configRoot),resolved);if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('LIVE_TEST_CONFIG_PATH_INVALID');}
  const stat=fs.statSync(resolved);if(!stat.isFile()||stat.size>32768)throw Error('LIVE_TEST_CONFIG_INVALID');
  return JSON.parse(fs.readFileSync(resolved,'utf8'));
}
const ERROR_CODES=new Set(['LIVE_TEST_FLAGS_INVALID','LIVE_TEST_CONFIG_INVALID','LIVE_TEST_IDENTITY_REQUIRED','LIVE_TEST_SALE_NOT_OPEN','LIVE_TEST_CONFIG_EXPIRED','LIVE_TEST_EVENT_PAST','LIVE_TEST_CONFIG_PATH_INVALID','LIVE_TEST_ALREADY_ATTEMPTED','LIVE_TEST_NOT_CONNECTED','LIVE_TEST_VERSION_MISMATCH','LIVE_TEST_ACTIVE_RUN','LIVE_TEST_TARGET_CHANGED','LIVE_TEST_SEAT_PAGE_REQUIRED','LIVE_TEST_IDENTITY_MISMATCH','LIVE_TEST_PAGE_NOT_READY','LIVE_TEST_EXISTING_SELECTION','LIVE_TEST_RUN_NOT_STARTED','LIVE_TEST_TIMEOUT','LIVE_TEST_PAYMENT_NOT_CONFIRMED','HTTP_OUTCOME_UNKNOWN','HTTP_EXISTING_SELECTION','HTTP_EXISTING_PRICE_SELECTION','HTTP_PREVIOUS_RESULT_PENDING','HTTP_PREVIOUS_RESULT_UNKNOWN']);
const errorCode=error=>ERROR_CODES.has(error?.message)?error.message:'LIVE_TEST_FAILED';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function inspectTargets({targets,bridge,activeTargetId}){
  const status=bridge.getState(),tabs=[];
  const connected=status.connected===true;
  if(connected)for(const target of [...targets.values()].filter(t=>!t.isDestroyed()&&routeOf(t.getURL())).slice(0,12)){
    const route=routeOf(target.getURL()),documentId=target.documentId,url=target.getURL();
    const tab={id:target.id,...route,title:safeText(target.getTitle()),selected:target.id===activeTargetId};
    try{
      if(route.stage==='listing'){
        const cards=await target.invoke(entry.gameCards);
        tab.games=(Array.isArray(cards)?cards:[]).slice(0,50).map(card=>({key:safeText(card.key,600),label:safeText(card.label,240),schedule:safeText(card.schedule,240),buttonText:safeText(card.buttonText,80)}));
      }else if(['seat','price'].includes(route.stage)){
        tab.identity=identityOf(await target.invoke(directApi.bookingIdentity));
        const scene=await target.invoke(flow.scene);
        tab.scene={selectedCount:Array.isArray(scene.selected)?scene.selected.length:null,captcha:scene.captcha===true,busy:scene.busy===true,dialog:!!scene.dialog,notice:scene.notice?.present===true,pricePage:scene.completed===true,hasSeats:scene.hasSeats===true,grades:(scene.grades||[]).slice(0,60).map(g=>({name:safeText(g.name),count:/^\d[\d,]*$/.test(String(g.count||''))?String(g.count):null}))};
      }
      if(target.isDestroyed()||target.documentId!==documentId||target.getURL()!==url)throw Error('LIVE_TEST_TARGET_CHANGED');
    }catch(error){delete tab.games;delete tab.identity;delete tab.scene;tab.error=errorCode(error);}
    tabs.push(tab);
  }
  return {connected,extensionVersion:/^\d+\.\d+\.\d+$/.test(status.extensionVersion||'')?status.extensionVersion:null,tabs};
}
async function startLiveBookingTest({mode,configPath,configRoot,bridge,targets,command,runs,dataRoot,state=()=>{},getPreferences=()=>({}),getActiveTargetId=()=>null,version=require('../package.json').version,connectionWaitMs=20000,now=Date.now}){
  if(!['inspect','run'].includes(mode))throw Error('LIVE_TEST_FLAGS_INVALID');
  const until=Date.now()+Math.max(0,Math.min(60000,connectionWaitMs));
  // A restored pairing initially reports the previous extension version.
  // Let its first heartbeat or update/reconnect settle before inspecting tabs.
  while((!bridge.getState().connected||targets.size===0||bridge.getState().extensionVersion!==version)&&Date.now()<until)await sleep(100);
  const base={version,mode,paymentAttempted:false};
  fs.mkdirSync(dataRoot,{recursive:true});
  if(mode==='inspect'){
    const result={...base,phase:'inspected',...await inspectTargets({targets,bridge,activeTargetId:getActiveTargetId()}),updatedAt:new Date(now()).toISOString()};
    const file=path.join(dataRoot,'live-booking-inspection.json');fs.writeFileSync(file,JSON.stringify(result,null,2));return {file,result};
  }
  const config=validateConfig(readConfig(configPath,configRoot),now()),directory=path.join(dataRoot,'live-booking-tests');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,config.testId+'.json');
  // Exclusive creation consumes a test ID even if a later preflight fails. A
  // process restart must never repeat an uncertain or already confirmed hold.
  let handle;try{handle=fs.openSync(file,'wx');fs.closeSync(handle);}catch(error){if(error.code==='EEXIST')throw Error('LIVE_TEST_ALREADY_ATTEMPTED');throw error;}
  const write=value=>{const result={...base,testId:config.testId,tabId:config.tabId,expected:config.expected,quantity:1,...value,updatedAt:new Date(now()).toISOString()};fs.writeFileSync(file,JSON.stringify(result,null,2));return result;};
  let ownedRun=null,timer=null;
  write({phase:'preflight'});
  try{
    if(!bridge.getState().connected)throw Error('LIVE_TEST_NOT_CONNECTED');
    if(bridge.getState().extensionVersion!==version)throw Error('LIVE_TEST_VERSION_MISMATCH');
    if(runs.current)throw Error('LIVE_TEST_ACTIVE_RUN');
    const target=targets.get(config.tabId);if(!target||target.isDestroyed()||routeOf(target.getURL())?.stage!=='seat')throw Error('LIVE_TEST_SEAT_PAGE_REQUIRED');
    const documentId=target.documentId,url=target.getURL();
    const checkScope=()=>{if(target.isDestroyed()||targets.get(config.tabId)!==target||target.documentId!==documentId||target.getURL()!==url)throw Error('LIVE_TEST_TARGET_CHANGED');if(now()>=config.expiresAt)throw Error('LIVE_TEST_CONFIG_EXPIRED');};
    const actual=identityOf(await target.invoke(directApi.bookingIdentity));checkScope();
    if(!actual||IDENTITY_KEYS.some(key=>actual[key]!==config.expected[key]))throw Error('LIVE_TEST_IDENTITY_MISMATCH');
    const scene=await target.invoke(flow.scene);checkScope();
    if(!Array.isArray(scene.selected)||scene.selected.length||scene.completed)throw Error('LIVE_TEST_EXISTING_SELECTION');
    if(scene.busy||scene.captcha||scene.dialog||scene.notice?.present)throw Error('LIVE_TEST_PAGE_NOT_READY');
    validateConfig(config,now());
    await command('target',config.tabId);checkScope();
    if(runs.current)throw Error('LIVE_TEST_ACTIVE_RUN');
    const preferences={...getPreferences(),quantity:1,excludeRestricted:true,autoComplete:true,autoNotice:true,stopAfterCaptcha:false,selectionMethod:'api'};
    write({phase:'starting'});state('명시한 경기의 일반 좌석 1매 실사이트 검증 · 결제 화면에서 정지');
    await command('start',{preferences,entryStrategy:'site',entryOffsetMs:0,validationExpectedBooking:config.expected});
    ownedRun=runs.current;
    if(!ownedRun?.task||ownedRun.targetId!==config.tabId)throw Error('LIVE_TEST_RUN_NOT_STARTED');
    write({phase:'running'});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LIVE_TEST_TIMEOUT')),Math.min(config.maxRunMs,config.expiresAt-now()));});
    const result=await Promise.race([ownedRun.task,timeout]);clearTimeout(timer);timer=null;
    const finalTarget=targets.get(ownedRun.targetId),route=routeOf(finalTarget?.getURL());
    if(result?.completed!==true||result.bookingAdvanced!==true||!['payment','preorder'].includes(route?.stage))throw Error('LIVE_TEST_PAYMENT_NOT_CONFIRMED');
    const progress=await finalTarget.invoke(pricePage.bookingProgress);
    if(progress?.ready!==true||routeOf(finalTarget.getURL())?.stage!==route.stage)throw Error('LIVE_TEST_PAYMENT_NOT_CONFIRMED');
    return {file,result:write({phase:route.stage==='payment'?'payment-confirmed':'preorder-confirmed',completed:true,finalStage:route.stage,standardPriceSelected:result.standardPriceSelected===true,httpRequestCount:Number.isSafeInteger(result.httpRequestCount)?result.httpRequestCount:null})};
  }catch(error){
    // Stop only the run owned by this invocation. No restart, alternate game,
    // seat release guess, checkout interaction or payment is sent here.
    if(ownedRun&&runs.current===ownedRun)await command('stop').catch(()=>{});
    return {file,result:write({phase:'stopped',completed:false,error:errorCode(error)})};
  }finally{if(timer)clearTimeout(timer);}
}
module.exports={startLiveBookingTest,cliOptions,validateConfig,inspectTargets,routeOf,identityOf};
