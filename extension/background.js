'use strict';
importScripts('network-parsers.js','network-observer.js','http-navigation.js','code-actions.js');
const ENDPOINT='http://127.0.0.1:43187';
const capabilities=['entry.pageInfo','entry.bookingNotice','captcha.ocr','captcha.manual','extension.reload'];
const PAGE_ACTIONS=new Set(['entry.pageInfo','entry.gameCards','entry.prepareEntry','entry.gateStatus','entry.armGate','entry.setGateClock','entry.noteGateRequest','live.waitForChange','live.liveRead','live.liveAction','flow.scene','flow.clickKnown','flow.enterCode','flow.deselect','flow.dismissConflict','flow.dismissEmptySelection','pricePage.priceState','pricePage.adultPriceStep','pricePage.proceedBooking','pricePage.bookingProgress','observation.bookingObservation','directApi.bookingIdentity','publicGame.resolveGame','captcha.captchaSnapshot','captcha.captchaSubmit','captcha.captchaStatus','captcha.captchaCancel','captcha.captchaRefresh','manualCaptcha.manualCaptchaPrepare','manualCaptcha.manualCaptchaSubmit','manualCaptcha.manualCaptchaCancel','page.stopWatchers','page.pageClock','page.gateSnapshot','page.gateState','page.showAll','page.showAllGames']);
let token=null,connected=false,polling=false,pulseBusy=false,lastError='',revision=0,reconnectTimer=null,connectionEpoch=0,eventChain=Promise.resolve();const tracked=new Map(),epochs=new Map(),deliveredDocuments=new Map();
const captchaRoutes=new Map();
const codeDocuments=new Map(),codeInstance=String(Date.now())+':'+Math.random();
async function invokeCode(tabId,documentId,action,arg,expiresAt=Date.now()+5000){
  const meta={connection:codeInstance+':'+connectionEpoch,epoch:epochs.get(tabId)||0,expiresAt};
  const key=tabId+'|'+documentId,prior=codeDocuments.get(key);
  codeDocuments.set(key,{tabId,documentId,connection:meta.connection});
  if(!['lease','stop'].includes(action)&&prior?.connection!==meta.connection){
    const installed=await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',func:BaseballCodeDispatch,args:['lease',null,meta]});
    if(!installed?.some(r=>r.documentId===documentId&&r.result?.ok===true&&r.result.value?.ready===true))throw Error('사이트 코드 연결을 확인하지 못했습니다.');
  }
  // Chrome rejects an undefined top-level args item before the page executes.
  // Use null on the transport; the runtime restores omitted-argument semantics.
  const results=await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',func:BaseballCodeDispatch,args:[action,arg??null,meta]});
  const result=results?.find(r=>r.documentId===documentId);
  if(!result||result.error||result.result===undefined)throw Error('사이트 코드 실행 결과를 확인하지 못했습니다. 같은 동작을 반복하지 않습니다.');
  if(result.result.ok!==true)throw Error(result.result.code||'SITE_ACTION_RESULT_INVALID');
  return result.result.value;
}
PAGE_ACTIONS.add('seatDetails.readDetails');
PAGE_ACTIONS.add('httpBooking.httpBookingAction');PAGE_ACTIONS.add('httpBooking.httpBookingNavigate');
const manualCaptchaRoutes=new Map();
const isDemo=url=>url===chrome.runtime.getURL('demo.html');
function allowedUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&((u.origin==='https://nol.yanolja.com'&&(u.pathname==='/ticket'||u.pathname.startsWith('/ticket/')))||(u.origin==='https://tickets.interpark.com'&&/^\/(?:gates\/ticket\/\d{8}\/?$|goods\/\d+\/?$|onestop(?:\/|$)|waiting(?:\/|$))/.test(u.pathname))||(u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname)));}catch{return false;}}
function safeUrl(value){const u=new URL(value),step=u.searchParams.get('step');u.search='';u.hash='';if(u.pathname==='/onestop/seat'&&['seat','price'].includes(step))u.searchParams.set('step',step);return u.href;}
async function send(path,data,auth=true){const response=await fetch(ENDPOINT+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth&&token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(path==='/poll'?24000:8000)});if(!response.ok){const error=new Error(response.status===401||response.status===403?'프로그램 연결 코드로 다시 연결해 주세요.':'프로그램과 연결하지 못했습니다.');error.status=response.status;throw error;}return response.json();}
globalThis.emitHelperEvent=event=>{
  if(['metadata','grades'].includes(event.type)&&Number.isInteger(event.tabId)&&typeof event.documentId==='string')void sendPage(event.tabId,{type:'baseball-seat-update'},{documentId:event.documentId}).catch(()=>{});
  const epoch=connectionEpoch;
  eventChain=eventChain.then(async()=>{
    if(!connected||!token||epoch!==connectionEpoch)return;
    if(event.type!=='tabs'&&Number.isInteger(event.tabId)&&(!deliveredDocuments.has(event.tabId)||event.documentId&&deliveredDocuments.get(event.tabId)!==event.documentId)){
      const tab=await chrome.tabs.get(event.tabId).catch(()=>null);if(!tab||!allowedUrl(tab.url)&&!isDemo(tab.url))return;
      const row=await describe(tab);if(event.documentId&&row.documentId!==event.documentId)return;
      if(!connected||epoch!==connectionEpoch)return;tracked.set(row.id,row);const rows=[...tracked.values()];await send('/event',{type:'tabs',tabs:rows});if(epoch!==connectionEpoch)return;for(const r of rows)deliveredDocuments.set(r.id,r.documentId);
    }
    if(epoch!==connectionEpoch||!connected)return;
    await send('/event',event);
    if(event.type==='tabs'){deliveredDocuments.clear();for(const row of event.tabs)deliveredDocuments.set(row.id,row.documentId);}
  }).catch(()=>{});return eventChain;
};
globalThis.BaseballNetwork=createBaseballNetworkObserver({chrome,emit:emitHelperEvent,parsers:BaseballParsers,allowTabUrl:allowedUrl});
async function demoFrame(tabId){
  const reply=await chrome.runtime.sendMessage({type:'baseball-ping',demoTabId:tabId}).catch(()=>null);
  return reply?.ready&&typeof reply.documentId==='string'&&/^demo:[a-f0-9-]{36}$/.test(reply.documentId)?{url:chrome.runtime.getURL('demo.html'),documentId:reply.documentId}:null;
}
async function describe(tab){const frame=await (isDemo(tab.url)?demoFrame(tab.id):chrome.webNavigation.getFrame({tabId:tab.id,frameId:0})).catch(()=>null);return {id:tab.id,title:tab.title||'예매 페이지',url:safeUrl(frame?.url&&(allowedUrl(frame.url)||isDemo(frame.url))?frame.url:tab.url),openerTabId:tab.openerTabId??null,windowId:tab.windowId,active:tab.active,documentId:frame?.documentId||null};}
async function refreshTabs(){const seq=++revision;const tabs=await chrome.tabs.query({});const rows=await Promise.all(tabs.filter(t=>allowedUrl(t.url)||isDemo(t.url)).map(describe));if(seq!==revision)return [...tracked.values()];tracked.clear();for(const row of rows)tracked.set(row.id,row);await emitHelperEvent({type:'tabs',tabs:rows});return rows;}
function sendPage(tabId,message,options){return isDemo(tracked.get(tabId)?.url)?chrome.runtime.sendMessage({...message,demoTabId:tabId,demoDocumentId:options?.documentId}):chrome.tabs.sendMessage(tabId,message,options);}
async function ensureContent(tabId,documentId){
  let ping;try{ping=await sendPage(tabId,{type:'baseball-ping'},{documentId});}catch{if(isDemo(tracked.get(tabId)?.url))throw Error('연습 화면 로딩을 기다린 뒤 다시 선택해 주세요.');await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},files:['actions.js','content.js']});}
  if(ping?.error)throw Error(ping.error);
  const lease=await sendPage(tabId,{type:'baseball-lease'},{documentId});if(lease?.error)throw Error(lease.error);
}
async function stopPages(){await Promise.allSettled([...codeDocuments.values()].map(r=>invokeCode(r.tabId,r.documentId,'stop')));codeDocuments.clear();await Promise.allSettled([...tracked.keys()].map(tabId=>sendPage(tabId,{type:'baseball-stop'})).concat([...captchaRoutes.values(),...manualCaptchaRoutes.values()].map(route=>sendPage(route.tabId,{type:'baseball-stop'},{documentId:route.frameDocumentId}))));captchaRoutes.clear();manualCaptchaRoutes.clear();await BaseballNetwork.detachAll();}
function captchaFrameUrl(value){try{const u=new URL(value);return (u.origin==='https://tickets.interpark.com'&&/^\/onestop(?:\/|$)/.test(u.pathname))||(u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname));}catch{return false;}}
async function dispatchCaptcha(command,topFrame,assert){
  const {action,tabId,arg,expiresAt}=command;
  let frames=chrome.webNavigation.getAllFrames?await chrome.webNavigation.getAllFrames({tabId}):[{...topFrame,frameId:0}];assert();
  frames=(frames||[]).filter(f=>f.documentId&&captchaFrameUrl(f.url));
  const invoke=async(frame,pageAction,pageArg)=>{await ensureContent(tabId,frame.documentId);assert();const value=await invokeCode(tabId,frame.documentId,pageAction,pageArg,expiresAt);assert();return value;};
  if(action==='captcha.captchaCancel'){
    await Promise.allSettled(frames.map(frame=>invoke(frame,action,arg)));for(const [key,route] of captchaRoutes)if(route.tabId===tabId)captchaRoutes.delete(key);return {cancelled:true};
  }
  if(action==='captcha.captchaSnapshot'){
    const results=await Promise.all(frames.map(async frame=>({frame,value:await invoke(frame,action,arg)})));assert();
    const present=results.filter(row=>row.value?.present);
    if(present.length>1)return {present:true,supported:false,status:'unsupported',message:'여러 프레임에 보안문자가 표시되어 자동 입력을 중지했습니다.'};
    const row=present[0];if(!row)return {present:false,supported:frames.length>0,status:frames.length?'absent':'unsupported',message:frames.length?'보안문자 창이 보이지 않습니다.':'NOL 예매창을 선택해 주세요.'};
    if(row.value.challengeId){const key=tabId+'|'+row.value.challengeId;captchaRoutes.set(key,{tabId,topDocumentId:topFrame.documentId,frameDocumentId:row.frame.documentId});while(captchaRoutes.size>100)captchaRoutes.delete(captchaRoutes.keys().next().value);}
    return row.value;
  }
  const route=captchaRoutes.get(tabId+'|'+arg?.challengeId),frame=route&&frames.find(f=>f.documentId===route.frameDocumentId);
  if(!route||!frame||route.topDocumentId!==topFrame.documentId)return {present:false,supported:false,submitted:false,status:'changed',message:'예매창 또는 보안문자 프레임이 바뀌었습니다. 다시 읽어 주세요.'};
  return invoke(frame,action,arg);
}
async function dispatchManualCaptcha(command,topFrame,assert){
  const {action,tabId,arg,expiresAt}=command;
  let frames=chrome.webNavigation.getAllFrames?await chrome.webNavigation.getAllFrames({tabId}):[{...topFrame,frameId:0}];assert();
  frames=(frames||[]).filter(frame=>frame.documentId&&captchaFrameUrl(frame.url));
  const keyFor=id=>tabId+'|'+id;
  const clearRoutes=()=>{for(const [key,route] of manualCaptchaRoutes)if(route.tabId===tabId)manualCaptchaRoutes.delete(key);};
  const changed=()=>({present:false,supported:false,submitted:false,cancelled:false,status:'changed',message:'예매창 또는 보안문자 이미지가 바뀌었습니다. 이미지를 다시 확인해 주세요.'});
  const ambiguous=()=>({present:true,supported:false,submitted:false,cancelled:false,status:'unsupported',message:'여러 프레임에 인증 화면이 있어 직접 입력 대상을 정할 수 없습니다.'});
  const invoke=async(frame,pageAction,pageArg)=>{await ensureContent(tabId,frame.documentId);assert();const value=await invokeCode(tabId,frame.documentId,pageAction,pageArg,expiresAt);assert();return value;};
  const inspect=async()=>{const results=await Promise.all(frames.map(async frame=>({frame,value:await invoke(frame,'manualCaptcha.manualCaptchaPrepare',{focus:false})})));assert();return results.filter(row=>row.value?.present);};
  if(action==='manualCaptcha.manualCaptchaCancel'){
    const requested=typeof arg?.challengeId==='string'?manualCaptchaRoutes.get(keyFor(arg.challengeId)):null;
    const routes=arg?.challengeId?[requested].filter(Boolean):[...manualCaptchaRoutes.values()].filter(route=>route.tabId===tabId);
    if(arg?.challengeId&&!requested)return changed();
    let cancelled=false;
    for(const route of routes){
      const frame=frames.find(value=>value.documentId===route.frameDocumentId);
      if(route.topDocumentId!==topFrame.documentId||!frame){manualCaptchaRoutes.delete(keyFor(route.challengeId));continue;}
      // Cancellation is bound to the prepared challenge as well as the native
      // frame document, so an old UI cannot cancel a newly replaced challenge.
      const current=await invoke(frame,'manualCaptcha.manualCaptchaPrepare',{focus:false});
      if(current?.challengeId!==route.challengeId){manualCaptchaRoutes.delete(keyFor(route.challengeId));continue;}
      await invoke(frame,action,{challengeId:route.challengeId});cancelled=true;manualCaptchaRoutes.delete(keyFor(route.challengeId));
    }
    return cancelled||!arg?.challengeId?{cancelled:true}:changed();
  }
  if(action==='manualCaptcha.manualCaptchaPrepare'){
    clearRoutes();
    const present=await inspect();
    if(present.length>1)return ambiguous();
    const row=present[0];
    if(!row)return {present:false,supported:frames.length>0,status:frames.length?'absent':'unsupported',message:frames.length?'보안문자 창이 보이지 않습니다.':'NOL 예매창을 선택해 주세요.'};
    if(!row.value.supported||typeof row.value.challengeId!=='string')return row.value;
    let value=row.value;
    if(arg?.focus===true){value=await invoke(row.frame,action,{focus:true});if(value?.challengeId!==row.value.challengeId)return changed();}
    manualCaptchaRoutes.set(keyFor(value.challengeId),{tabId,challengeId:value.challengeId,topDocumentId:topFrame.documentId,frameDocumentId:row.frame.documentId});
    while(manualCaptchaRoutes.size>100)manualCaptchaRoutes.delete(manualCaptchaRoutes.keys().next().value);
    return value;
  }
  const route=manualCaptchaRoutes.get(keyFor(arg?.challengeId)),frame=route&&frames.find(value=>value.documentId===route.frameDocumentId);
  if(!route||!frame||route.topDocumentId!==topFrame.documentId)return changed();
  // Recheck every allowed frame without focusing or changing input. A newly
  // appeared second challenge must never receive a guessed target submission.
  const present=await inspect();
  if(present.length>1){clearRoutes();return ambiguous();}
  if(present.length!==1||present[0].frame.documentId!==route.frameDocumentId||present[0].value.challengeId!==route.challengeId){manualCaptchaRoutes.delete(keyFor(route.challengeId));return changed();}
  const value=await invoke(frame,action,arg);
  if(value?.submitted)manualCaptchaRoutes.delete(keyFor(route.challengeId));
  return value;
}
async function disconnected(error){connected=false;connectionEpoch++;deliveredDocuments.clear();lastError=error?.message||'프로그램을 실행해 주세요.';await stopPages();if(error?.status===401||error?.status===403){token=null;await chrome.storage.local.remove('bridgeToken');await chrome.storage.session.remove('bridgeToken');}await chrome.action.setBadgeText({text:'!'});}
async function dispatch(command){
  const {action,tabId,arg,documentId,expiresAt}=command;const connection=connectionEpoch;
  if(action==='page.stopWatchers'||action==='captcha.captchaCancel'||action==='manualCaptcha.manualCaptchaCancel')epochs.set(tabId,(epochs.get(tabId)||0)+1);const epoch=epochs.get(tabId)||0;
  const assert=()=>{if(!connected||connection!==connectionEpoch||epoch!==(epochs.get(tabId)||0))throw Error('중지되었거나 연결이 바뀐 동작입니다.');if(action!=='page.stopWatchers'&&(!Number.isFinite(expiresAt)||Date.now()>expiresAt))throw Error('만료된 보조 동작을 취소했습니다.');};
  assert();
  if(action==='extension.reload'){await stopPages();assert();return {reload:true};}
  if(action==='tabs.list')return refreshTabs();
  if(action==='tabs.open'||action==='tabs.demo'){
    const url=action==='tabs.demo'?chrome.runtime.getURL('demo.html'):arg?.url;if(!allowedUrl(url)&&!isDemo(url))throw Error('NOL 예매 주소만 열 수 있습니다.');
    assert();const tab=await chrome.tabs.create({url,active:true});await refreshTabs();
    // Chrome may return a newly created Tab before its URL/frame has committed.
    // Prefer the refreshed row, then the URL we already validated for this request.
    return tracked.get(tab.id)||describe({...tab,url});
  }
  const tab=await chrome.tabs.get(tabId);assert();if(!allowedUrl(tab.url)&&!isDemo(tab.url))throw Error('지원하는 NOL 예매 탭이 아닙니다.');
  const frame=await (isDemo(tab.url)?demoFrame(tabId):chrome.webNavigation.getFrame({tabId,frameId:0}));assert();if(!frame?.documentId)throw Error('Chrome 화면을 준비하는 중입니다.');if(documentId&&documentId!==frame.documentId)throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');
  if(action==='tabs.focus'){await chrome.windows.update(tab.windowId,{focused:true});assert();await chrome.tabs.update(tabId,{active:true});return true;}
  if(action==='tabs.zoom'){const current=await chrome.tabs.getZoom(tabId);assert();if(arg?.delta!=null&&![-0.1,0,0.1].includes(arg.delta))throw Error('잘못된 배율입니다.');const factor=arg?.factor??(arg.delta===0?1:current+arg.delta);if(!Number.isFinite(factor)||factor<.7||factor>1.8)throw Error('잘못된 배율입니다.');await chrome.tabs.setZoom(tabId,factor);return true;}
  if(action==='network.attach')return isDemo(tab.url)?{healthy:true,sequence:0,pending:[],results:[]}:BaseballNetwork.attach(tabId);
  if(action==='network.detach')return BaseballNetwork.detach(tabId);
  if(action==='network.snapshot')return isDemo(tab.url)?{healthy:true,sequence:0,pending:[],results:[]}:BaseballNetwork.snapshot(tabId);
  if(!PAGE_ACTIONS.has(action))throw Error('허용되지 않은 보조 동작입니다.');
  if(action.startsWith('captcha.'))return dispatchCaptcha(command,frame,assert);
  if(action.startsWith('manualCaptcha.'))return dispatchManualCaptcha(command,frame,assert);
  // Legacy Book windows are exposed solely for standalone text-CAPTCHA tests.
  // Existing entry/seat actions do not run against an unverified legacy layout.
  if(new URL(tab.url).origin==='https://ticket.interpark.com'&&action!=='page.stopWatchers')throw Error('구형 예매창에서는 보안문자 단독 테스트만 지원합니다.');
  if(action==='page.stopWatchers')await BaseballNetwork.setBackground(tabId,false);
  if(action==='page.stopWatchers')await Promise.allSettled([...captchaRoutes.values()].filter(route=>route.tabId===tabId).map(route=>sendPage(tabId,{type:'baseball-action',action:'captcha.captchaCancel',expiresAt},{documentId:route.frameDocumentId})));
  if(action==='page.stopWatchers'){await Promise.allSettled([...manualCaptchaRoutes.values()].filter(route=>route.tabId===tabId).map(route=>sendPage(tabId,{type:'baseball-stop'},{documentId:route.frameDocumentId})));for(const [key,route] of manualCaptchaRoutes)if(route.tabId===tabId)manualCaptchaRoutes.delete(key);}
  await ensureContent(tabId,frame.documentId);assert();
  if(action==='page.stopWatchers'){
    await Promise.allSettled([...codeDocuments.values()].filter(r=>r.tabId===tabId).map(r=>invokeCode(tabId,r.documentId,'stop')));
  }else if(!isDemo(tab.url)&&BaseballCodeActions.has(action)){return invokeCode(tabId,frame.documentId,action,arg,expiresAt);}
  if(action==='httpBooking.httpBookingNavigate'){
    const results=await chrome.scripting.executeScript({target:{tabId,documentIds:[frame.documentId]},world:'MAIN',func:BaseballHttpNavigate,args:[{...arg,expiresAt}]});
    const result=results?.find(r=>r.documentId===frame.documentId);if(!result||result.error||!result.result)throw Error('HTTP 화면 전환 실행을 확인하지 못했습니다.');return result.result;
  }
  const result=await sendPage(tabId,{type:'baseball-action',action,arg,expiresAt},{documentId:frame.documentId});if(result?.error)throw Error(result.error);return result?.value;
}
async function poll(){if(polling||!token)return;polling=true;const sessionToken=token,epoch=connectionEpoch;const sameSession=()=>token===sessionToken&&epoch===connectionEpoch;try{connected=true;lastError='';await refreshTabs();await chrome.action.setBadgeText({text:''});while(token&&sameSession()){const result=await send('/poll',{});if(!sameSession())break;connected=true;for(const command of result.commands||[])void dispatch(command).then(async value=>{if(!sameSession())return;await send('/result',{id:command.id,value});if(command.action==='extension.reload'&&value?.reload&&sameSession())chrome.runtime.reload();},error=>sameSession()?send('/result',{id:command.id,error:String(error?.message||error).slice(0,700)}):null).catch(()=>{});}}catch(error){if(sameSession())await disconnected(error);}finally{polling=false;if(token){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>void poll(),1500);}}}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  const popup=!sender.tab&&sender.url===chrome.runtime.getURL('popup.html');
  if(popup&&message?.type==='baseball-status'){respond({connected,error:lastError});return;}
  if(popup&&message?.type==='baseball-pair'){
    (async()=>{await credentialsReady;if(token&&connected)throw Error('이미 연결되어 있습니다. 프로그램에서 연결 상태를 확인하세요.');const result=await send('/pair',{code:String(message.code||''),version:chrome.runtime.getManifest().version,capabilities},false);connectionEpoch++;token=result.token;await chrome.storage.local.set({bridgeToken:token});void poll();return {connected:true};})().then(respond,error=>respond({error:error.message}));return true;
  }
  if(message?.type==='baseball-document'&&isDemo(sender.url)&&Number.isInteger(message.demoTabId)&&(!sender.tab||sender.tab.id===message.demoTabId)){
    (async()=>{const rows=await refreshTabs(),row=rows.find(t=>t.id===message.demoTabId&&isDemo(t.url));if(!connected||!row?.documentId||row.documentId!==message.documentId)return;await sendPage(row.id,{type:'baseball-lease'},{documentId:row.documentId});await emitHelperEvent({type:'document',tabId:row.id,documentId:row.documentId});})().catch(()=>{});return;
  }
  if(message?.type==='baseball-document'&&sender.tab&&sender.frameId===0&&(allowedUrl(sender.url)||isDemo(sender.url))&&typeof sender.documentId==='string'){
    (async()=>{await refreshTabs();if(!connected)return;await chrome.tabs.sendMessage(sender.tab.id,{type:'baseball-lease'},{documentId:sender.documentId});await emitHelperEvent({type:'document',tabId:sender.tab.id,documentId:sender.documentId});})().catch(()=>{});
  }
});
chrome.tabs.onUpdated.addListener((_id,info)=>{if(info.url||info.status==='complete'||info.title)void refreshTabs().catch(()=>{});});
chrome.tabs.onCreated.addListener(()=>void refreshTabs().catch(()=>{}));
chrome.tabs.onRemoved.addListener(tabId=>{tracked.delete(tabId);for(const [key,r] of codeDocuments)if(r.tabId===tabId)codeDocuments.delete(key);void BaseballNetwork.detach(tabId).catch(()=>{});void refreshTabs().catch(()=>{});});
chrome.webNavigation.onDOMContentLoaded.addListener(details=>{if(details.frameId===0&&isDemo(details.url))void refreshTabs().then(rows=>{const row=rows.find(t=>t.id===details.tabId);if(row?.documentId)return emitHelperEvent({type:'document',tabId:row.id,documentId:row.documentId});}).catch(()=>{});});
chrome.alarms.create('baseball-reconnect',{periodInMinutes:.5});chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='baseball-reconnect')void poll();});
async function pulse(){if(!connected||pulseBusy)return;pulseBusy=true;const epoch=connectionEpoch;try{await send('/heartbeat',{version:chrome.runtime.getManifest().version,capabilities});if(!connected||epoch!==connectionEpoch)return;for(const r of codeDocuments.values())void invokeCode(r.tabId,r.documentId,'lease').catch(()=>{codeDocuments.delete(r.tabId+'|'+r.documentId);});for(const [tabId,tab] of tracked)void sendPage(tabId,{type:'baseball-lease'},{documentId:tab.documentId||undefined}).catch(()=>{});for(const route of manualCaptchaRoutes.values())if(tracked.get(route.tabId)?.documentId===route.topDocumentId)void sendPage(route.tabId,{type:'baseball-lease'},{documentId:route.frameDocumentId}).catch(()=>{});}catch(error){await disconnected(error);}finally{pulseBusy=false;}}
setInterval(()=>void pulse(),1000);
const credentialsReady=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const saved=await chrome.storage.local.get('bridgeToken'),legacy=await chrome.storage.session.get('bridgeToken');
  token=saved.bridgeToken||legacy.bridgeToken||null;
  if(token){await chrome.storage.local.set({bridgeToken:token});await chrome.storage.session.remove('bridgeToken');}
})().catch(()=>{lastError='자동 연결 정보 저장소를 확인하지 못했습니다.';});
credentialsReady.then(()=>{if(token)void poll();});
