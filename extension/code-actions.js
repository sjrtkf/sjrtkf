'use strict';
globalThis.BaseballCodeActions=new Set(["entry.prepareEntry","entry.prepareScheduledGate","entry.armListing","entry.setListingClock","entry.listingState","entry.stopListing","entry.gateStatus","entry.armGate","entry.setGateClock","entry.noteGateRequest","live.liveAction","flow.scene","flow.clickKnown","flow.enterCode","flow.deselect","flow.dismissConflict","flow.dismissEmptySelection","pricePage.adultPriceStep","pricePage.proceedBooking","pricePage.returnToSeats","captcha.captchaSnapshot","captcha.captchaSubmit","captcha.captchaStatus","captcha.captchaCancel","captcha.captchaRefresh","manualCaptcha.manualCaptchaPrepare","manualCaptcha.manualCaptchaSubmit","manualCaptcha.manualCaptchaCancel","page.pageClock","page.gateSnapshot","page.gateState","page.showAll","page.showAllGames","page.stopWatchers"]);
globalThis.BaseballCodeDispatch=async function(action,arg,meta){
const resolveGateEntry=function resolveGateEntry(button){
  if(location.origin!=='https://tickets.interpark.com'||!/^\/gates\/ticket\/\d{8}\/?$/.test(location.pathname)||!button||button.isConnected===false)throw Error('SITE_ENTRY_CONTROL_CHANGED');
  const fingerprint=fn=>{
    if(typeof fn!=='function')return '';
    const source=Function.prototype.toString.call(fn);let hash=2166136261;
    for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
    return source.length+':'+(hash>>>0).toString(16);
  };
  const keys=Object.keys(button).filter(key=>key.startsWith('__reactFiber$'));
  if(keys.length!==1)throw Error(keys.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNAVAILABLE');
  let root=button[keys[0]],steps=0;
  while(root?.return&&++steps<=100)root=root.return;
  if(!root||steps>100||root.tag!==3||!root.stateNode?.current)throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
  // A DOM node's fiber pointer may refer to the alternate tree. Search only
  // the committed root, so an old render can never supply the callback.
  const pending=[root.stateNode.current],seen=new Set(),matches=[];
  while(pending.length){
    const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
    seen.add(fiber);if(seen.size>10000)throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
    if(fiber.stateNode===button)matches.push(fiber);
    if(fiber.sibling)pending.push(fiber.sibling);
    if(fiber.child)pending.push(fiber.child);
  }
  if(matches.length!==1)throw Error(matches.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_CONTROL_CHANGED');
  const owners=[];steps=0;
  for(let fiber=matches[0].return;fiber&&++steps<=100;fiber=fiber.return){
    if(fingerprint(fiber.type)==='1128:15e3cb9e')owners.push(fiber);
  }
  if(owners.length!==1)throw Error(owners.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNSUPPORTED');
  const owner=owners[0];
  if(owner.memoizedProps?.global!==false)throw Error('SITE_ENTRY_FUNCTION_UNSUPPORTED');
  const callbacks=[];steps=0;const hooks=new Set();
  for(let hook=owner.memoizedState;hook;hook=hook.next){
    if(hooks.has(hook)||++steps>200)throw Error('SITE_ENTRY_FUNCTION_AMBIGUOUS');
    hooks.add(hook);
    const state=hook.memoizedState;
    if(Array.isArray(state)&&state.length===2&&Array.isArray(state[1])&&fingerprint(state[0])==='807:8d8ae4e')callbacks.push(state[0]);
  }
  if(callbacks.length!==1)throw Error(callbacks.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNAVAILABLE');
  return {invoke:callbacks[0],contract:'ticket-gate-2026-10-20'};
};
const invokeSiteFunction=function invokeSiteFunction(element,kind='activate',value){
  if(kind==='scheduled-entry'){
    if(typeof resolveGateEntry!=='function')throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
    return resolveGateEntry(element).invoke();
  }
  const gateEntry=kind==='entry'&&location.origin==='https://tickets.interpark.com'&&/^\/gates\/ticket\/\d{8}\/?$/.test(location.pathname)&&/^(?:예매하기|남은시간\s*\d{1,2}:\d{2})$/.test(element?.textContent?.trim()||'');
  if(!element||element.isConnected===false||(!gateEntry&&(element.disabled||element.getAttribute?.('aria-disabled')==='true')))throw Error('SITE_CONTROL_CHANGED');
  if(!['activate','change'].includes(kind)&&!gateEntry)throw Error('SITE_FUNCTION_UNSUPPORTED');
  const keys=Object.keys(element).filter(k=>k.startsWith('__reactProps$'));
  if(keys.length>1)throw Error('SITE_FUNCTION_AMBIGUOUS');
  const props=keys.length?element[keys[0]]:null;
  const legacy=location.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(location.pathname);
  const demo=['file:','chrome-extension:'].includes(location.protocol)&&location.pathname.endsWith('/demo.html');
  let fn=props?.[kind==='change'?'onChange':'onClick'];
  if(!fn&&(legacy||demo))fn=element[kind==='change'?'onchange':'onclick'];
  if(kind==='change'){
    if(typeof value!=='string'||!/^[A-Z]{6}$/.test(value)||element.readOnly)throw Error('SITE_INPUT_INVALID');
    if(typeof fn!=='function'&&!legacy)throw Error('SITE_INPUT_FUNCTION_UNAVAILABLE');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(!setter)throw Error('SITE_INPUT_UNAVAILABLE');
    setter.call(element,value);
    if(!fn)return; // Legacy validation reads the native input value directly.
  }else if(typeof fn!=='function')throw Error('SITE_FUNCTION_UNAVAILABLE');
  // A plain argument for a component function, not a DOM/SyntheticEvent. This
  // supports handlers that call preventDefault without emitting an input event.
  const argument={target:element,currentTarget:element,preventDefault(){},stopPropagation(){}};
  return fn.call(element,argument);
};
const runtime=function codeRuntime(action,arg,meta,invokeSiteFunction,makeActions){
  const u=new URL(location.href);
  const allowed=u.origin==='https://nol.yanolja.com'&&/^\/ticket(?:\/|$)/.test(u.pathname)||u.origin==='https://tickets.interpark.com'&&/^\/(?:gates\/ticket\/\d{8}\/?$|goods\/\d+\/?$|onestop(?:\/|$)|waiting(?:\/|$))/.test(u.pathname)||u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
  if(!allowed||!meta||typeof meta.connection!=='string'||!Number.isInteger(meta.epoch))throw Error('SITE_CODE_SCOPE_INVALID');
  const cancel=action==='stop'||action==='page.stopWatchers';
  if(!cancel&&(!Number.isFinite(meta.expiresAt)||Date.now()>meta.expiresAt))throw Error('SITE_CODE_EXPIRED');
  const stop=()=>{window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();};
  let control=window.__ticketSiteCode;
  if(!control||control.connection!==meta.connection){
    if(control&&action!=='lease'&&!cancel)throw Error('SITE_CODE_CONNECTION_CHANGED');
    stop();if(control?.timer)clearInterval(control.timer);
    control=window.__ticketSiteCode={connection:meta.connection,epoch:meta.epoch,leaseUntil:0,stopped:true,error:null,calls:0};
    control.timer=setInterval(()=>{if(!control.stopped&&Date.now()>control.leaseUntil){control.stopped=true;stop();}},250);
  }
  if(meta.epoch<control.epoch)throw Error('SITE_CODE_STOPPED');
  if(meta.epoch>control.epoch){stop();control.epoch=meta.epoch;control.error=null;control.stopped=true;}
  if(cancel){control.stopped=true;control.leaseUntil=0;control.error=null;stop();return {stopped:true};}
  if(action==='lease'){control.leaseUntil=Math.min(meta.expiresAt,Date.now()+5000);return {ready:true};}
  if(control.error)throw Error(control.error);
  // A fresh extension command grants a short lease; autonomous callbacks only
  // use this stored deadline and cannot renew it themselves.
  control.leaseUntil=Math.min(meta.expiresAt,Date.now()+5000);
  control.stopped=false;
  const assert=()=>{if(window.__ticketSiteCode!==control||control.connection!==meta.connection||control.epoch!==meta.epoch||control.stopped||Date.now()>control.leaseUntil)throw Error('SITE_CODE_STOPPED');};
  const fail=error=>{if(window.__ticketSiteCode!==control||control.connection!==meta.connection||control.epoch!==meta.epoch)return;control.error=/^SITE_[A-Z_]+$/.test(error?.message||'')?error.message:'SITE_FUNCTION_FAILED';control.stopped=true;stop();};
  const siteInvoke=(element,kind,value)=>{
    assert();control.calls++;
    try{const result=invokeSiteFunction(element,kind,value);if(result&&typeof result.then==='function')result.catch(fail);return result;}
    catch(error){fail(error);throw error;}
  };
  const actions=makeActions(siteInvoke);
  if(!Object.hasOwn(actions,action))throw Error('SITE_CODE_ACTION_UNSUPPORTED');
  assert();return actions[action](arg??undefined);
};
const classifyEntryResponse=function classifyEntryResponse(status,body){
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  let data;try{data=typeof body==='string'?JSON.parse(body):body;}catch{return {outcome:'unknown',code:'INVALID_RESPONSE'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unknown',code:'INVALID_RESPONSE'};
  const code=typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:null;
  if(status>=200&&status<300&&!data.error){
    try{const u=new URL(data.redirectUrl);if(u.origin==='https://tickets.interpark.com'&&!u.username&&!u.password&&!u.hash&&!/\/(?:error|fail)(?:\/|$)/i.test(u.pathname)&&!u.searchParams.has('errorCode')&&!u.searchParams.has('error')&&/^\/(?:waiting(?:\/|$)|onestop(?:\/|$))/.test(u.pathname))return {outcome:'redirect-ready',code:'VALID_REDIRECT'};}catch{}
    return {outcome:'unknown',code:'INVALID_REDIRECT'};
  }
  if(status>=400&&status<500&&![401,429].includes(status)&&code==='P40057'&&!data.redirectUrl)return {outcome:'not-open',code};
  return {outcome:status>=400&&status<500?'blocked':'unknown',code:code||'UNCLASSIFIED_RESPONSE'};
};
const createEntryHttp=function createEntryHttp({assertActive,onStatus=()=>{},beforeSend=null,getWindow=null}){
  const original=window.fetch,controllers=new Set(),timers=new Set();
  let stopped=false,claimed=false,task=null,body=null,cancel=null;
  const status={outcome:'waiting',requestCount:0,code:null,httpStatus:null};
  const report=patch=>{Object.assign(status,patch);onStatus({...status});};
  const active=()=>{if(stopped)throw Error('SITE_CODE_STOPPED');assertActive();};
  const restore=()=>{if(window.fetch===wrapped)window.fetch=original;};
  const cleanup=()=>{for(const id of timers)clearTimeout(id);timers.clear();for(const c of controllers)c.abort();controllers.clear();};
  const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},Math.max(0,ms));timers.add(id);return id;};
  const wrapped=function(input,init){
    let u;try{u=new URL(typeof input==='string'?input:input?.url,location.href);}catch{return original.call(this,input,init);}
    if(u.origin!=='https://ent-waiting-api.interpark.com'||u.pathname!=='/waiting/api/secure-url')return original.call(this,input,init);
    try{
      active();
      if(init?.method!=='POST'||typeof init.body!=='string'||init.body.length>65536||input instanceof Request)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      let payload;try{payload=JSON.parse(init.body);}catch{throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');}
      if(typeof payload.signature!=='string'||!payload.signature||typeof payload.secureData!=='string'||!payload.secureData)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      if(claimed&&init.body!==body)throw Error('SITE_ENTRY_REQUEST_CONFLICT');
    }catch(e){return Promise.reject(e);}
    if(!claimed){
      claimed=true;body=init.body;
      const frozen={...init,headers:new Headers(init.headers),redirect:'error'};
      task=new Promise((resolve,reject)=>{
        let settled=false,inFlight=0,closed=false,win=null;
        const finish=(error,response,patch)=>{
          if(settled)return;settled=true;cleanup();frozen.signal?.removeEventListener('abort',cancel);
          if(patch)report({...patch,finishedMono:performance.now()});
          if(error)reject(error);else resolve(response);
        };
        cancel=()=>finish(Error('SITE_CODE_STOPPED'),null,{outcome:'stopped',code:'CANCELLED'});
        const expire=()=>finish(Error('SITE_ENTRY_WINDOW_EXPIRED'),null,{outcome:'expired',code:'RETRY_WINDOW_EXPIRED'});
        const fire=async()=>{
          if(settled)return;
          try{active();}catch(e){finish(e,null,{outcome:'stopped',code:'CANCELLED'});return;}
          if(win&&performance.now()>win.endMono){closed=true;if(!inFlight)expire();return;}
          const controller=new AbortController();controllers.add(controller);inFlight++;
          const timeout=later(()=>controller.abort(),8000),now=performance.now();
          report({outcome:'pending',requestCount:status.requestCount+1,startedMono:status.startedMono??now,lastAttemptMono:now});
          try{
            const response=await original.call(window,input,{...frozen,signal:controller.signal});
            const text=await response.clone().text();if(settled)return;active();
            let result=classifyEntryResponse(response.status,text);
            if(response.headers?.get('retry-after')!=null)result={outcome:'blocked',code:'RETRY_AFTER'};
            if(result.outcome==='redirect-ready'){controllers.delete(controller);finish(null,response,{...result,httpStatus:response.status});return;}
            const transient=result.outcome==='not-open'||response.status>=500&&response.status<=599&&result.code!=='RETRY_AFTER'&&!/blacklist/i.test(result.code||'');
            if(!win||!transient){finish(Error('SITE_ENTRY_RESPONSE_REJECTED'),null,{...result,httpStatus:response.status});return;}
            report({outcome:'pending',lastErrorCode:result.code,httpStatus:response.status});
          }catch(error){if(!settled)finish(error,null,{outcome:'unknown',code:'NETWORK_OUTCOME_UNKNOWN'});}
          finally{clearTimeout(timeout);timers.delete(timeout);controllers.delete(controller);inFlight--;if(!settled&&closed&&!inFlight)expire();}
        };
        const tick=()=>{
          if(settled)return;
          const now=performance.now();
          if(now>win.endMono){closed=true;if(!inFlight)expire();return;}
          if(now<win.startMono){later(tick,win.startMono-now);return;}
          void fire();
          if(settled)return;
          const next=win.startMono+(Math.floor((now-win.startMono)/30)+1)*30;
          later(tick,(next<=win.endMono?next:win.endMono+1)-performance.now());
        };
        Promise.resolve().then(async()=>{
          active();if(frozen.signal?.aborted)throw Error('SITE_CODE_STOPPED');
          frozen.signal?.addEventListener('abort',cancel,{once:true});
          if(beforeSend){report({outcome:'scheduled',preparedMono:performance.now()});await beforeSend();}
          if(settled)return;active();
          if(getWindow){
            win=getWindow();
            if(!win||![win.startMono,win.endMono].every(Number.isFinite)||win.endMono<win.startMono||win.endMono-win.startMono>4000)throw Error('SITE_ENTRY_WINDOW_INVALID');
            later(expire,win.endMono+8000-performance.now());tick();
          }else void fire();
        }).catch(error=>{if(!settled)finish(error,null,{outcome:'unknown',code:'REQUEST_NOT_SENT'});});
      });
    }
    return task.then(response=>{active();return response.clone();});
  };
  window.fetch=wrapped;
  return {status,dispose:restore,stop(){stopped=true;cancel?.();cleanup();restore();},get claimed(){return claimed;}};
};
const makeActions=siteInvoke=>{
const priceState=function priceState(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const u=new URL(location.href);
  const route=u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price';
  if(!route)return {route:false,ready:false,groups:[],quantity:0};
  const blocked=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"],img[alt="캡챠 이미지"]')].some(shown);
  const groups=[...document.querySelectorAll('[class*="PriceGroup_group__"]')].filter(shown).map(group=>{
    const text=selector=>group.querySelector(selector)?.textContent.trim()||'';
    const max=text('[class*="PriceGroup_countMax__"]').match(/^\/\s*(\d+)$/);
    const items=[...group.querySelectorAll('li[class*="PriceItem_typeItem__"]')].filter(shown).map(item=>({
      name:item.querySelector('[class*="PriceItem_name__"]')?.textContent.replace(/\s+/g,' ').trim()||'',
      count:Number(item.querySelector('input[role="spinbutton"]')?.value??NaN)
    }));
    return {grade:text('[class*="PriceGroup_title__"]'),seat:text('[class*="PriceGroup_seatInfo__"]'),max:max?Number(max[1]):0,items};
  });
  const quantity=groups.reduce((n,g)=>n+g.max,0);
  return {route,rejected:!!window.__ticketPriceRecovery,ready:!blocked&&groups.length>0&&quantity>0&&quantity<=4&&groups.every(g=>g.max>0&&g.seat&&g.items.length&&g.items.every(i=>Number.isInteger(i.count)&&i.count>=0)),groups,quantity};
};
return {
"entry.armListing":function armListing({key,runId=null,clockRequired=false,timeoutMs=15*86400000}={}) {
  if(typeof key!=='string'||!key.trim())throw Error('대상 경기 정보가 없습니다. 경기 목록을 다시 읽어 주세요.');
  if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw Error('경기 목록 대기 시간이 올바르지 않습니다.');
  const previous=window.__bearsEntry;
  // A failed/stopped run also retains its latch. Only a new run may retry it.
  if(previous?.status?.key===key&&previous.status.runId===runId)return previous.status;
  previous?.stop();
  const started=performance.now(),sequence=(previous?.sequence||0)+1;
  const currentUrl=()=>String(location.origin)+String(location.pathname)+String(location.search||'')+String(location.hash||'');
  const startUrl=currentUrl(),control=window.__ticketSiteCode,epoch=control?.epoch;
  const status={phase:'armed',key,runId,documentId:String(performance.timeOrigin)+':'+started+':listing:'+sequence,clock:{outcome:'not-configured'},trigger:null,enabledObservedMono:null,clickedMono:null,clickedAt:null,invokeDelayMs:null,reason:'선택한 경기의 예매 버튼 활성화를 기다립니다.'};
  let observer,timer,clockTimer,done=false,cancelled=false;
  const cleanup=()=>{clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();};
  const finish=(phase,reason)=>{status.phase=phase;status.reason=reason;done=true;cleanup();};
  const stop=()=>{cancelled=true;done=true;cleanup();if(status.phase==='armed'){status.phase='stopped';status.reason='경기 목록 대기를 중지했습니다.';}};
  const visible=element=>{
    const rect=element.getBoundingClientRect(),css=getComputedStyle(element);
    return element.isConnected!==false&&rect.width>0&&rect.height>0&&css.display!=='none'&&css.visibility!=='hidden'&&css.visibility!=='collapse';
  };
  const find=()=>[...document.querySelectorAll('button.grid-area_cta')].filter(button=>{
    const card=button.parentElement,info=card?.querySelector('.grid-area_info')?.textContent?.trim();
    const teams=[...(card?.querySelectorAll('.grid-area_match img[alt]')||[])].map(image=>image.alt).join(' vs ');
    return !!info&&!!teams&&info+' | '+teams===key&&visible(button);
  });
  const wait=()=>{timer=setTimeout(()=>tick(),Math.max(1,Math.min(250,started+timeoutMs-performance.now())));};
  const failed=()=>{
    // The shared dispatcher stops observers before propagating site errors.
    // Preserve that failure report while ignoring an explicit stop/new run.
    const runtimeFailure=control&&window.__ticketSiteCode===control&&control.epoch===epoch&&control.error;
    if(cancelled&&!runtimeFailure||window.__bearsEntry?.status!==status||status.phase!=='clicked')return;
    finish(currentUrl()!==startUrl?'navigated':'blocked',currentUrl()!==startUrl?'화면이 이동하여 이전 경기 목록 실행을 종료했습니다.':'사이트 진입 함수 실행 결과를 확인하지 못했습니다. 경기 화면을 확인한 뒤 새로 시작해 주세요.');
  };
  const tick=(source='activation')=>{
    if(done)return;
    clearTimeout(timer);
    const now=performance.now();
    if(currentUrl()!==startUrl){finish('navigated','화면이 이동하여 경기 목록 대기를 종료했습니다.');return;}
    if(now-started>=timeoutMs){finish('timeout','선택한 경기의 활성화 대기 시간이 지났습니다.');return;}
    // Authentication/notice dialogs may temporarily hide the listing itself.
    // Wait for their normal completion before deciding that a card was lost.
    const modal=[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
    const notice=[...document.querySelectorAll('button')].some(button=>visible(button)&&String(button.textContent||'').trim()==='확인하고 예매하기');
    if(modal||notice){status.reason='안내/인증/처리가 끝나기를 기다립니다.';wait();return;}
    const matches=find();
    if(matches.length!==1){finish('blocked',matches.length?'대상 경기의 보이는 예매 버튼이 여러 개입니다. 경기 목록을 다시 확인해 주세요.':'대상 경기의 보이는 예매 버튼을 찾을 수 없습니다. 경기 목록을 다시 확인해 주세요.');return;}
    const button=matches[0];
    const enabled=!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&String(button.textContent||'').trim()==='예매하기';
    if(enabled)status.enabledObservedMono??=now;
    else status.enabledObservedMono=null;
    const configured=Number.isFinite(status.clock.deadlineMono),clockValid=configured&&now<=status.clock.validUntilMono;
    if(configured&&!clockValid)status.clock.outcome='stale';
    if(clockRequired&&!clockValid){status.reason='유효한 서버 시각 설정을 기다립니다.';wait();return;}
    if(clockValid&&now<status.clock.deadlineMono){status.reason='서버 시각의 예매 시작 시점을 기다립니다.';wait();return;}
    if(clockValid&&status.clock.firedAtMono==null){status.clock.firedAtMono=now;status.clock.delayMs=now-status.clock.deadlineMono;status.clock.outcome='not-ready';}
    if(!enabled){status.reason='선택한 경기의 예매 버튼 활성화를 기다립니다.';wait();return;}
    // Acquire the latch before invoking a site function, which can itself
    // synchronously mutate the DOM, navigate, throw, or return a rejection.
    status.phase='clicked';status.trigger=source==='server-clock'?'server-clock':'activation';
    status.clickedMono=performance.now();status.clickedAt=Date.now();status.invokeDelayMs=Math.max(0,status.clickedMono-status.enabledObservedMono);
    if(clockValid)status.clock.outcome='clicked';
    status.reason='활성화 확인 · 선택한 경기의 사이트 진입 함수 실행';done=true;cleanup();
    try{Promise.resolve(siteInvoke(button)).catch(failed);}catch{failed();}
  };
  const setClock=config=>{
    if(done||config?.runId!==runId||config?.documentId!==status.documentId||config?.key!==key)return false;
    const {deadlineMono,validUntilMono,uncertaintyMs,openAt}=config;
    if(config.source!=='ticket-server'||![deadlineMono,validUntilMono,uncertaintyMs,openAt].every(Number.isFinite)||uncertaintyMs<0||uncertaintyMs>501||validUntilMono<deadlineMono)return false;
    clearTimeout(clockTimer);const clock={outcome:'armed',deadlineMono,validUntilMono,uncertaintyMs,openAt};status.clock=clock;
    const fire=()=>{
      if(done||status.clock!==clock)return;
      const now=performance.now();
      if(now>validUntilMono){status.clock.outcome='stale';tick();return;}
      if(now<deadlineMono){clockTimer=setTimeout(fire,Math.ceil(deadlineMono-now));return;}
      status.clock.firedAtMono=now;status.clock.delayMs=now-deadlineMono;status.clock.outcome='not-ready';tick('server-clock');
    };
    fire();return true;
  };
  observer=new MutationObserver(()=>tick());observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  window.__bearsEntry={status,stop,setClock,sequence};tick();return status;
},
"entry.setListingClock":function setListingClock(config){return window.__bearsEntry?.setClock?.(config)||false;},
"entry.listingState":function listingState(){return window.__bearsEntry?.status||null;},
"entry.stopListing":function stopListing({runId=null,key}={}){
  if(typeof key!=='string'||!key.trim())return {stopped:false};
  const listing=window.__bearsEntry;
  if(!listing){
    // A stop may arrive before its arm command. Retain the same-run latch
    // so a delayed install cannot reintroduce a watcher after popup adoption.
    const status={phase:'stopped',key,runId,documentId:String(performance.timeOrigin)+':'+performance.now()+':listing:1',clock:{outcome:'not-configured'},trigger:null,enabledObservedMono:null,clickedMono:null,clickedAt:null,invokeDelayMs:null,reason:'경기 목록 대기를 중지했습니다.'};
    window.__bearsEntry={status,stop(){},sequence:1};return {stopped:true};
  }
  if(listing.status?.runId!==runId||listing.status?.key!==key||typeof listing.stop!=='function')return {stopped:false};
  listing.stop();return {stopped:true};
},
"entry.prepareEntry":function prepareEntry({key,runId=null}) {
  const previous=window.__bearsEntry;
  if(previous?.status?.key===key&&previous.status.runId===runId&&previous.status.phase==='clicked')return previous.status;
  previous?.stop();
  const matches=[...document.querySelectorAll('button.grid-area_cta')].filter(button=>{
    const card=button.parentElement,info=card.querySelector('.grid-area_info')?.textContent.trim(),teams=[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt).join(' vs ');
    const rect=button.getBoundingClientRect();return info+' | '+teams===key&&rect.width>0&&rect.height>0;
  });
  if(matches.length!==1)throw new Error('대상 경기의 예매 버튼을 하나로 확인하지 못했습니다. 목록을 다시 읽어 주세요.');
  const button=matches[0];
  if(button.disabled||button.getAttribute('aria-disabled')==='true'||button.textContent.trim()!=='예매하기')throw new Error('대상 경기의 준비 화면 진입 버튼이 활성화되지 않았습니다.');
  const status={phase:'clicked',key,runId,clickedAt:Date.now(),delayMs:null,preparation:true};
  window.__bearsEntry={status,stop(){}};
  siteInvoke(button);return status;
},
"entry.prepareScheduledGate":function prepareScheduledGate({key,goodsCode,placeCode}={}){
  if(location.origin!=='https://nol.yanolja.com'||!/^\/ticket\/genre\/sports(?:\/|$)/.test(location.pathname)||typeof key!=='string'||!key.trim()||!/^\d{8}$/.test(String(goodsCode))||!/^\d{8}$/.test(String(placeCode)))throw Error('SITE_ENTRY_CONTROL_CHANGED');
  const matches=[...document.querySelectorAll('button.grid-area_cta')].filter(button=>{
    const card=button.parentElement,info=card?.querySelector('.grid-area_info')?.textContent?.trim(),teams=[...(card?.querySelectorAll('.grid-area_match img[alt]')||[])].map(image=>image.alt).join(' vs '),rect=button.getBoundingClientRect();
    return button.isConnected!==false&&rect.width>0&&rect.height>0&&!!info&&!!teams&&info+' | '+teams===key;
  });
  if(matches.length!==1)throw Error(matches.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_CONTROL_CHANGED');
  window.__bearsEntry?.stop();
  // Exact current public sports entry route (sports/344997). The normal SSO
  // bridge supplies authentication; no token or signed request is extracted.
  const gate=new URL('https://tickets.interpark.com/gates/partner');
  gate.searchParams.set('bc','61776');gate.searchParams.set('gc',String(goodsCode));gate.searchParams.set('pc',String(placeCode));gate.searchParams.set('cc','Gates');
  const rcd=new URLSearchParams(location.search||'').get('rcd');if(rcd)gate.searchParams.set('rcd',rcd);
  const bridge=new URL('https://sso.yanolja.com/sso/v1/bridge/token');
  bridge.searchParams.set('source','YANOLJA');bridge.searchParams.set('serviceDomainCode','NOL_TICKET');bridge.searchParams.set('redirectUrl',gate.href);
  location.assign(bridge.href);
  return {dispatched:true,goodsCode:String(goodsCode)};
},
"entry.gateStatus":function gateStatus({goodsCode}={}) {
  const match=location.origin==='https://tickets.interpark.com'&&location.pathname.match(/^\/gates\/ticket\/(\d{8})$/);
  const status={supported:!!match,goodsCode:match?match[1]:null,prepared:false,enabled:false,buttonText:null};
  if(!match||goodsCode&&String(goodsCode)!==match[1])return {...status,reason:'대상 경기의 준비 화면이 아닙니다.'};
  const root=document.querySelector('main');
  status.prepared=!!root&&/예매준비가완료됐어요|예매는오픈시간부터가능해요/.test(root.textContent.replace(/\s/g,''));
  const visible=e=>{const r=e.getBoundingClientRect();const css=getComputedStyle(e);return r.width>0&&r.height>0&&css.visibility!=='hidden'&&css.display!=='none';};
  const notices=[...document.querySelectorAll('button')].filter(b=>visible(b)&&String(b.textContent||'').trim()==='확인하고 예매하기');
  if(!notices.length)delete window.__bearsBookingNotice;
  let noticeKey=null,container=notices.length===1?notices[0].parentElement:null;
  while(container&&container!==document.body){
    const headings=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"],span,p,strong,b,div')].filter(visible).map(e=>e.textContent.replace(/\s/g,''));
    noticeKey=headings.find(text=>['예매안내','취소/환불안내'].includes(text))||null;
    if(noticeKey)break;
    container=container.parentElement;
  }
  let signature=null;
  if(noticeKey){let hash=2166136261;for(const character of container.textContent.replace(/\s/g,''))hash=Math.imul(hash^character.codePointAt(0),16777619);signature=noticeKey+':'+(hash>>>0).toString(16);}
  status.notice={present:notices.length>0,enabled:notices.length===1&&!notices[0].disabled&&notices[0].getAttribute('aria-disabled')!=='true',key:noticeKey,signature};
  const buttons=root?[...root.querySelectorAll('button')].filter(b=>visible(b)&&b.textContent.trim()!=='확인하고 예매하기'&&/(?:예매하기$|^남은시간\s*\d{1,2}:\d{2}$)/.test(b.textContent.trim())):[];
  if(!status.prepared||buttons.length!==1)return {...status,reason:'준비 완료 안내와 유일한 예매 버튼을 기다립니다.'};
  const button=buttons[0];status.buttonText=button.textContent.trim();
  if(typeof resolveGateEntry==='function'){
    try{status.entryReady=true;status.entryContract=resolveGateEntry(button).contract;}
    catch(error){status.entryReady=false;status.entryCode=/^SITE_[A-Z_]+$/.test(error?.message||'')?error.message:'SITE_ENTRY_FUNCTION_UNAVAILABLE';}
  }
  const blocked=status.notice.present||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
  status.enabled=!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&status.buttonText==='예매하기';
  status.reason=blocked?'안내/인증/처리가 끝나기를 기다립니다.':status.enabled?'사이트가 예매 버튼을 활성화했습니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
  return status;
},
"entry.armGate":function armGate({goodsCode,runId=null,timeoutMs=15*86400000,httpRetry=false,allowInitiallyEnabled=false,preWindowMs=2000,postWindowMs=2000,intervalMs=30}={}) {
  // Kept self-contained for execution in the isolated browser world.
  const match=location.origin==='https://tickets.interpark.com'&&location.pathname.match(/^\/gates\/ticket\/(\d{8})$/);
  if(!match||!goodsCode||String(goodsCode)!==match[1])throw new Error('대상 경기의 준비 화면을 확인하지 못했습니다.');
  const prior=window.__bearsGate;
  if(prior?.status?.goodsCode===String(goodsCode)&&prior.status.runId===runId&&['armed','clicked','request-observed','http-running'].includes(prior.status.phase))return prior.status;
  prior?.stop();
  const startPath=location.pathname,started=performance.now();
  const status={phase:'armed',documentId:String(performance.timeOrigin)+':'+started,goodsCode:String(goodsCode),runId,clickedAt:null,trigger:null,observedDisabled:false,clock:{outcome:'not-configured'},reason:'사이트의 예매 버튼 활성화를 기다립니다.'};
  let observer,timer,clockTimer,http,pendingDispatch,done=false,inFlight=false,retryAt=0,attempts=0;
  const getWindow=()=>{
    const d=status.clock?.deadlineMono;
    if(!Number.isFinite(d))return {startMono:NaN,endMono:NaN};
    return {startMono:d-(httpRetry?preWindowMs:0),endMono:d+(httpRetry?postWindowMs:0),intervalMs};
  };
  const stop=()=>{done=true;clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();http?.stop();if(pendingDispatch){const pending=pendingDispatch;pendingDispatch=null;pending.reject(Error('SITE_CODE_STOPPED'));}if(['armed','http-running'].includes(status.phase))status.phase='stopped';};
  const releaseDispatch=()=>{
    if(!pendingDispatch||done)return;
    const now=performance.now(),clock=status.clock,{startMono,endMono}=getWindow();
    if(!Number.isFinite(clock.deadlineMono)||now<startMono||now>clock.validUntilMono)return;
    if(now>endMono){status.phase='timeout';stop();return;}
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!==startPath){stop();return;}
    const pending=pendingDispatch;pendingDispatch=null;
    status.trigger='server-clock';status.clock.outcome='clicked';pending.resolve();
  };
  const visible=e=>{const r=e.getBoundingClientRect();const css=getComputedStyle(e);return r.width>0&&r.height>0&&css.visibility!=='hidden'&&css.display!=='none';};
  const tick=(source='activation')=>{
    if(done||status.phase==='http-running')return;clearTimeout(timer);
    if(inFlight)return;
    if(performance.now()<retryAt){timer=setTimeout(tick,retryAt-performance.now());return;}
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!==startPath){status.phase='navigated';stop();return;}
    if(performance.now()-started>timeoutMs){status.phase='timeout';stop();return;}
    const root=document.querySelector('main');
    const prepared=!!root&&/예매준비가완료됐어요|예매는오픈시간부터가능해요/.test(root.textContent.replace(/\s/g,''));
    const buttons=root?[...root.querySelectorAll('button')].filter(b=>visible(b)&&b.textContent.trim()!=='확인하고 예매하기'&&/(?:예매하기$|^남은시간\s*\d{1,2}:\d{2}$)/.test(b.textContent.trim())):[];
    const notice=[...document.querySelectorAll('button')].some(b=>visible(b)&&String(b.textContent||'').trim()==='확인하고 예매하기');
    const blocked=notice||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
    const button=prepared&&buttons.length===1?buttons[0]:null;
    if(button&&!blocked&&(button.disabled||button.getAttribute('aria-disabled')==='true'))status.observedDisabled=true;
    if(httpRetry&&button&&!blocked){
      try{
        if(typeof resolveGateEntry!=='function')throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
        status.entryContract=resolveGateEntry(button).contract;status.entryReady=true;delete status.entryCode;
      }catch(error){status.entryReady=false;status.entryCode=/^SITE_[A-Z_]+$/.test(error?.message||'')?error.message:'SITE_ENTRY_FUNCTION_UNAVAILABLE';}
    }
    const now=performance.now(),deadlineMono=status.clock.deadlineMono,{startMono,endMono}=getWindow();
    const configured=Number.isFinite(deadlineMono),clockValid=configured&&now<=status.clock.validUntilMono;
    if(configured&&!clockValid)status.clock.outcome='stale';
    if(httpRetry&&configured&&now>endMono){status.phase='timeout';status.reason='설정한 진입 시도 구간이 지났습니다.';stop();return;}
    if(httpRetry&&!clockValid){status.reason='유효한 서버 시각 설정을 기다립니다.';timer=setTimeout(tick,250);return;}
    if(clockValid&&now<startMono){timer=setTimeout(tick,Math.min(250,startMono-now));return;}
    if(httpRetry&&http?.claimed){releaseDispatch();return;}
    if(httpRetry&&button&&!blocked){
      if(!status.entryReady){status.phase='blocked';status.reason='정시 진입 함수를 확인하지 못했습니다. ['+status.entryCode+']';stop();return;}
      status.phase='clicked';status.trigger='server-clock';status.clickedAt??=Date.now();status.clickedMono??=performance.now();
      status.invokeDelayMs=Math.max(0,status.clickedMono-startMono);status.attempts=++attempts;
      status.clock.outcome='clicked';status.reason='예약 구간 도달(±2초) · 30ms 간격으로 진입 API 호출 중';
      clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();inFlight=true;
      const retryOrFail=()=>{
        inFlight=false;if(done||http?.claimed)return;
        status.phase='blocked';status.reason='정시 진입 함수가 예약 구간 동안 API 요청을 만들지 못했습니다. 인증·상품 상태를 확인해 주세요.';stop();
      };
      try{
        Promise.resolve(siteInvoke(button,'scheduled-entry')).then(()=>{
          inFlight=false;if(done||http?.claimed)return;retryOrFail();
        }).catch(retryOrFail);
      }catch{retryOrFail();}
      return;
    }
    if(button&&!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&button.textContent.trim()==='예매하기'&&(status.observedDisabled||allowInitiallyEnabled)){
      status.enabledObservedMono??=performance.now();status.phase='clicked';status.trigger=source==='server-clock'?'server-clock':'activation';status.clickedAt=Date.now();status.clickedMono=performance.now();status.invokeDelayMs=status.clickedMono-status.enabledObservedMono;status.attempts=++attempts;
      if(status.trigger==='server-clock')status.clock.outcome='clicked';status.reason='활성화 확인 · 사이트 진입 함수 실행';
      clearTimeout(timer);clearTimeout(clockTimer);inFlight=true;
      if(!http){stop();siteInvoke(button);return;}
      Promise.resolve().then(()=>siteInvoke(button)).then(()=>{
        inFlight=false;if(done||http.claimed)return;
        if(attempts>=3){status.phase='blocked';status.reason='사이트 함수 실행 후 진입 요청이 발생하지 않았습니다.';stop();return;}
        retryAt=performance.now()+1000;status.phase='armed';status.reason='진입 요청 미발생 · 1초 후 재시도';timer=setTimeout(tick,1000);
      }).catch(()=>{inFlight=false;if(done)return;status.phase='blocked';status.reason='사이트 진입 함수 실행 결과를 확인하지 못했습니다.';stop();});return;
    }
    status.reason=!prepared||buttons.length!==1?'확인된 준비 화면과 예매 버튼을 기다립니다.':blocked?'안내/인증/처리가 끝나기를 기다립니다.':!status.observedDisabled?'처음부터 활성화된 버튼에는 중복 클릭하지 않고 사이트의 자동 진행을 기다립니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
    timer=setTimeout(tick,250);
  };
  observer=new MutationObserver(tick);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  const setClock=config=>{
    if(done||status.clock.firedAtMono!=null&&status.clock.outcome!=='stale'||config?.runId!==runId||config.documentId!==status.documentId||String(config?.goodsCode)!==String(goodsCode))return false;
    const {deadlineMono,validUntilMono,uncertaintyMs,openAt}=config;
    if(config.source!=='ticket-server'||![deadlineMono,validUntilMono,uncertaintyMs,openAt].every(Number.isFinite)||uncertaintyMs<0||uncertaintyMs>501||validUntilMono<deadlineMono+(httpRetry?postWindowMs:0))return false;
    clearTimeout(clockTimer);const clock={outcome:'armed',deadlineMono,validUntilMono,uncertaintyMs,openAt};status.clock=clock;
    const fire=()=>{
      if(done||status.clock!==clock)return;
      const now=performance.now();
      if(now>validUntilMono){status.clock.outcome='stale';return;}
      const firstAt=deadlineMono-(httpRetry?preWindowMs:0);
      if(now<firstAt){clockTimer=setTimeout(fire,Math.ceil(firstAt-now));return;}
      status.clock.firedAtMono=now;status.clock.delayMs=now-firstAt;
      status.clock.outcome='not-ready';tick('server-clock');
    };
    fire();return true;
  };
  if(typeof createEntryHttp==='function'){
    const control=window.__ticketSiteCode,epoch=control?.epoch;
    http=createEntryHttp({
      assertActive:()=>{if(done||location.pathname!==startPath||control&&(window.__ticketSiteCode!==control||control.epoch!==epoch||control.stopped||Date.now()>control.leaseUntil))throw Error('SITE_CODE_STOPPED');},
      beforeSend:httpRetry?()=>new Promise((resolve,reject)=>{pendingDispatch={resolve,reject};releaseDispatch();}):null,
      getWindow:httpRetry?getWindow:null,
      intervalMs,
      onStatus:value=>{
        status.http=value;if(value.requestCount){status.phase='http-running';clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();}
        if(Number.isFinite(value.startedMono)&&Number.isFinite(status.clickedMono))status.requestDelayMs=Math.max(0,value.startedMono-status.clickedMono);
        if(Number.isFinite(value.startedMono)&&Number.isFinite(status.clock.deadlineMono))status.requestDeadlineDelayMs=value.startedMono-status.clock.deadlineMono;
      }
    });
  }
  window.__bearsGate={status,stop,setClock,requestObserved(){if(done||http?.claimed)return;status.phase='request-observed';status.reason='사이트의 진입 요청을 관찰했습니다.';stop();}};tick();return status;
},
"entry.setGateClock":function setGateClock(config){return window.__bearsGate?.setClock?.(config)||false;},
"entry.noteGateRequest":function noteGateRequest({runId}={}){const gate=window.__bearsGate;if(gate?.status.runId!==runId)return null;gate.requestObserved?.();return gate.status;},
"live.liveAction":function liveAction({row,action}) {
  if(!['focus','click'].includes(action)) throw new Error('지원하지 않는 동작입니다.');
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  if([...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"],img[alt="캡챠 이미지"]')].some(shown))throw Error('사이트 안내·로딩·보안문자 처리 중입니다.');
  let el;
  if(row.kind==='grade') {
    const matches=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(e=>e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim()===row.name);
    if(matches.length!==1)return {retry:true,reason:'grade-changed'};
    el=matches[0];
    // Remaining counts are hints, not grade identity. The map verifies seats.
    if(el.disabled||el.getAttribute?.('aria-disabled')==='true')return {retry:true,reason:'grade-disabled'};
    if(action==='focus'){el.scrollIntoView({block:'center'});el.focus();}else siteInvoke(el);return true;
  }
  el=document.getElementById(row.id);
  if(el?.matches('circle.js-seat[id]')&&el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected'))throw new Error('SEAT_UNAVAILABLE: 사이트에서 해당 좌석이 선택 불가 상태로 바뀌었습니다.');
  if(!el||!el.matches('circle.js-seat[id]')||el.parentElement.id!==row.group||el.getAttribute('fill')!==row.fill||el.getAttribute('cx')!==row.cx||el.getAttribute('cy')!==row.cy||el.getAttribute('class').includes('SeatMap_disabled')||el.getAttribute('class').includes('SeatMap_selected')) throw new Error('좌석 상태가 변경되었습니다. 다시 확인해 주세요.');
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  if(!shown(el))throw new Error('현재 지도에 표시된 좌석이 아닙니다.');
  if(action==='focus') {el.animate([{strokeWidth:'1',stroke:'#ff2670'},{strokeWidth:'5',stroke:'#ff2670'},{strokeWidth:'1',stroke:'#ff2670'}],{duration:1200,iterations:2});return true;}
  throw Error('좌석 선택은 HTTP 경로에서만 실행합니다.');
},
"flow.scene":function scene(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const buttons=[...document.querySelectorAll('button')].filter(shown).map(e=>({label:e.textContent.trim()||e.getAttribute('aria-label')||'',enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'}));
  const selected=[...document.querySelectorAll('circle.js-seat[id][class*="SeatMap_selected"]')].map(e=>e.id);
  const grades=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(shown).map(e=>({name:e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent.trim(),count:(e.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent.trim()||null)})).filter(s=>s.name);
  const modals=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  let dialog=null;
  if(modals.length){
    const modal=modals[modals.length-1],text=(modal.querySelector('#dialogMessage')||modal).textContent.replace(/\s+/g,' ').trim().slice(0,700);
    const confirm=[...modal.querySelectorAll('button')].filter(e=>shown(e)&&!e.disabled&&e.textContent.trim()==='확인');
    const conflict=/(?:이미\s*(?:선택|선점|판매|예매)(?:된|한|되어|되었습니다|되었습니다)|다른\s*(?:고객|사용자|사람|예매자)(?:님)?(?:이|가|에 의해)\s*(?:(?:먼저|이미)\s*)?(?:선택|선점))/.test(text)&&/좌석/.test(text)&&!/(?:결제|취소하시|동의)/.test(text);
    const empty=/^구매하실\s*좌석을\s*선택(?:해\s*주세요|하세요)[.!]?(?:\s*확인)?$/.test(text);
    dialog={kind:modals.length===1?(empty?'empty-selection':conflict?'conflict':'unknown'):'unknown',text,dismissible:confirm.length===1&&modal.querySelectorAll('button').length===1};
  }
  const u=new URL(location.href);
  const priceRoute=u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price';
  const priceGroups=[...document.querySelectorAll('[class*="PriceGroup_group__"]')].filter(shown);
  const completed=!dialog&&((priceRoute&&priceGroups.length>0&&priceGroups.every(g=>g.querySelector('[class*="PriceGroup_seatInfo__"]')?.textContent.trim()&&/^\/\s*[1-4]$/.test(g.querySelector('[class*="PriceGroup_countMax__"]')?.textContent.trim()||'')&&g.querySelector('li[class*="PriceItem_typeItem__"]')))||(['file:','chrome-extension:'].includes(u.protocol)&&u.pathname.endsWith('/demo.html')&&document.body.dataset.completed==='true'));
  const busy=[...document.querySelectorAll('[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]')].some(shown);
  const notices=[...document.querySelectorAll('button')].filter(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기');
  if(!notices.length)delete window.__bearsBookingNotice;
  let noticeKey=null,container=notices.length===1?notices[0].parentElement:null;
  while(container&&container!==document.body){
    const headings=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"],span,p,strong,b,div')].filter(shown).map(e=>e.textContent.replace(/\s/g,''));
    noticeKey=headings.find(text=>['예매안내','취소/환불안내'].includes(text))||null;
    if(noticeKey)break;
    container=container.parentElement;
  }
  let signature=null;
  if(noticeKey){let hash=2166136261;for(const character of container.textContent.replace(/\s/g,''))hash=Math.imul(hash^character.codePointAt(0),16777619);signature=noticeKey+':'+(hash>>>0).toString(16);}
  return {completed:completed&&!busy&&![...document.querySelectorAll('img[alt="캡챠 이미지"]')].some(shown),busy,dialog,notice:{present:notices.length>0,enabled:notices.length===1&&!notices[0].disabled&&notices[0].getAttribute('aria-disabled')!=='true',key:noticeKey,signature},captcha:[...document.querySelectorAll('img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img')].some(shown),buttons,selected,grades,hasSeats:[...document.querySelectorAll('circle.js-seat[id]')].some(shown),selectedGrades:[...document.querySelectorAll('[class*="InfoSelected_contentSeatGrade__"]')].map(e=>e.textContent.trim()),selectedNames:[...document.querySelectorAll('[class*="InfoSelected_contentSeatName__"]')].map(e=>e.textContent.trim())};
},
"flow.clickKnown":function clickKnown(label){
  if(!['확인하고 예매하기','직접 좌석 선택하기','선택 완료','좌석도 전체보기'].includes(label))throw new Error('허용하지 않은 단계입니다.');
  if(label==='확인하고 예매하기'){
    // Recognized booking/cancellation guidance is distinct from authentication,
    // consent, payment, and generic confirmations. Revalidate at click time.
    const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const matches=[...document.querySelectorAll('button')].filter(e=>shown(e)&&e.textContent.trim()===label);
    if(!matches.length)return {present:false,clicked:false};
    if(matches.length!==1)throw Error('예매 안내 버튼을 하나로 확인하지 못했습니다. 직접 확인해 주세요.');
    const button=matches[0];
    if(button.disabled||button.getAttribute('aria-disabled')==='true')return {present:true,clicked:false,disabled:true};
    let container=button.parentElement,key=null;
    while(container&&container!==document.body){
      key=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"],span,p,strong,b,div')].filter(shown).map(e=>e.textContent.replace(/\s/g,'')).find(text=>['예매안내','취소/환불안내'].includes(text))||null;
      if(key)break;
      container=container.parentElement;
    }
    if(!container||container===document.body)throw Error('예매·취소/환불 안내 제목을 확인하지 못했습니다. 직접 확인해 주세요.');
    const text=container.textContent.replace(/\s+/g,' ').trim();
    const protectedText=/(?:로그인|세션|인증).{0,20}(?:만료|실패)|본인\s*인증|보안\s*문자|약관|개인정보.{0,15}동의|결제.{0,15}(?:확인|진행)|구매.{0,15}확정/.test(text);
    const inputs=[...container.querySelectorAll('input,select,textarea,[role="checkbox"]')].some(shown);
    // The responsive sports grade picker is a non-modal bottom sheet with
    // role=dialog. It remains visible behind the ordinary booking notice.
    const gradeSheet=e=>{
      if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||
        e.getAttribute?.('role')!=='dialog'||e.getAttribute('aria-modal')==='true'||
        !e.classList?.contains('nds-e-bottom-sheet__container')||
        !String(e.textContent||'').replace(/\s/g,'').startsWith('관람구역을선택해주세요'))return false;
      if([...e.querySelectorAll('input,select,textarea,[role="checkbox"],[role="alertdialog"],[aria-modal="true"]')].some(shown))return false;
      const choices=[...e.querySelectorAll('button')].filter(shown);
      return choices.length>0&&choices.every(b=>b.matches('button[class*="SportsSeatGradeList_contentItem__"]'));
    };
    const otherModal=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].some(e=>shown(e)&&e!==container&&!e.contains(button)&&!gradeSheet(e));
    if(protectedText||inputs||otherModal)throw Error('인증·동의 또는 다른 안내가 함께 표시되어 자동으로 확인하지 않습니다.');
    let hash=2166136261;for(const character of text.replace(/\s/g,''))hash=Math.imul(hash^character.codePointAt(0),16777619);
    const signature=key+':'+(hash>>>0).toString(16),previous=window.__bearsBookingNotice,clickedKeys=previous?.clickedKeys||[],clickedSignatures=previous?.clickedSignatures||[];
    if(clickedSignatures.includes(signature)||previous&&!previous.clickedSignatures&&clickedKeys.includes(key))return {present:true,clicked:false,pending:true,key,signature};
    // Consecutive notices can share a title (for example, seat-view guidance).
    // Latch their normalized contents, so DOM replacement/spacing cannot repeat
    // the same notice while a distinct, revalidated notice can continue.
    window.__bearsBookingNotice={clicked:true,clickedAt:Date.now(),clickedKeys:[...new Set([...clickedKeys,key])],clickedSignatures:[...clickedSignatures,signature]};
    siteInvoke(button);return {present:true,clicked:true,key,signature};
  }
  const matches=[...document.querySelectorAll('button')].filter(e=>(e.textContent.trim()||e.getAttribute('aria-label'))===label&&e.getBoundingClientRect().width>0&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(matches.length!==1)throw new Error('다음 단계 버튼을 찾을 수 없습니다.');
  siteInvoke(matches[0]);return true;
},
"flow.enterCode":function enterCode(code){
  if(!/^[A-Z]{6}$/.test(code))throw new Error('보안문자 6자리를 입력해 주세요.');
  const image=document.querySelector('img[alt="캡챠 이미지"]');
  if(!image||!image.getBoundingClientRect().width)throw new Error('보안문자 입력 화면이 아닙니다.');
  let container=image.parentElement;
  while(container&&container!==document.body&&!container.querySelector('input'))container=container.parentElement;
  const inputs=container?[...container.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0):[];
  if(inputs.length!==1)throw new Error('보안문자 입력칸을 확인할 수 없습니다.');
  const input=inputs[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,code);siteInvoke(input,'change',code);
  return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{observer.disconnect();reject(Error('입력완료 버튼이 활성화되지 않았습니다.'));},1500);const check=()=>{const btn=[...container.querySelectorAll('button')].find(e=>e.textContent.trim()==='입력완료'&&!e.disabled);if(btn){clearTimeout(timeout);observer.disconnect();siteInvoke(btn);resolve(true);}};const observer=new MutationObserver(check);observer.observe(container,{subtree:true,childList:true,attributes:true});check();});
},
"flow.deselect":function deselect(){throw Error('실제 좌석 해제는 HTTP 복구 경로에서만 실행합니다.');},
"flow.dismissConflict":function dismissConflict(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const modals=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  if(modals.length!==1)throw Error('좌석 선점 실패 안내를 확인할 수 없습니다.');
  const modal=modals[0],text=(modal.querySelector('#dialogMessage')||modal).textContent.replace(/\s+/g,' ').trim();
  if(!/(?:이미\s*(?:선택|선점|판매|예매)(?:된|한|되어|되었습니다|되었습니다)|다른\s*(?:고객|사용자|사람|예매자)(?:님)?(?:이|가|에 의해)\s*(?:(?:먼저|이미)\s*)?(?:선택|선점))/.test(text)||!/좌석/.test(text)||/(?:결제|취소하시|동의)/.test(text))throw Error('알 수 없는 안내는 자동으로 닫지 않습니다.');
  const buttons=[...modal.querySelectorAll('button')];
  if(buttons.length!==1||buttons[0].textContent.trim()!=='확인'||buttons[0].disabled||!shown(buttons[0]))throw Error('선점 실패 확인 버튼을 찾을 수 없습니다.');
  // Only a positive site rejection unlocks a previously dispatched price action.
  if(new URL(location.href).searchParams.get('step')==='price'){
    delete window.__ticketAdultPrice;delete window.__ticketBookingDispatch;
    window.__ticketPriceRecovery={kind:'conflict',at:Date.now()};
  }
  siteInvoke(buttons[0]);return true;
},
"flow.dismissEmptySelection":function dismissEmptySelection(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const modals=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  if(modals.length!==1)throw Error('좌석 미선택 안내를 하나로 확인하지 못했습니다.');
  const modal=modals[0],text=(modal.querySelector('#dialogMessage')||modal).textContent.replace(/\s+/g,' ').trim();
  const buttons=[...modal.querySelectorAll('button')];
  if(!/^구매하실\s*좌석을\s*선택(?:해\s*주세요|하세요)[.!]?(?:\s*확인)?$/.test(text)||buttons.length!==1||buttons[0].textContent.trim()!=='확인'||buttons[0].disabled||!shown(buttons[0]))throw Error('확인된 좌석 미선택 안내만 자동으로 닫을 수 있습니다.');
  // Only a positive site rejection unlocks a previously dispatched price action.
  if(new URL(location.href).searchParams.get('step')==='price'){
    delete window.__ticketAdultPrice;delete window.__ticketBookingDispatch;
    window.__ticketPriceRecovery={kind:'empty-selection',at:Date.now()};
  }
  siteInvoke(buttons[0]);return true;
},
"captcha.captchaSnapshot":function captchaSnapshot(){
  if(!window.__bearsCaptchaPage||window.__bearsCaptchaPage.version!==3){
    window.__bearsCaptchaPage?.cancel();
    const state={current:null,sequence:0,documentKey:crypto.randomUUID(),cancelPending:null};
    const shown=e=>{if(!e||!e.isConnected)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const enabled=e=>shown(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
    const fail=(status,message,extra={})=>({present:true,supported:false,status,message,...extra});
    const locate=()=>{
      const u=new URL(location.href),modern=u.origin==='https://tickets.interpark.com'&&/^\/onestop(?:\/|$)/.test(u.pathname),legacy=u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
      if(!modern&&!legacy)return {result:{present:false,supported:false,status:'unsupported',message:'보안문자 검사는 NOL 예매창에서만 지원합니다.'}};
      const selector=modern?'img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img':'#imgCaptcha';
      const images=[...new Set(document.querySelectorAll(selector))].filter(shown);
      if(!images.length){
        const other=[...document.querySelectorAll('[class*="ModalCaptchaSlider_layerWrap__"],.captchSliderLayer,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')].some(shown);
        return {result:other?fail('unsupported','문자 이미지 이외의 인증은 직접 진행해 주세요.'):{present:false,supported:true,status:'absent',message:'보안문자 창이 보이지 않습니다.'}};
      }
      if(images.length!==1)return {result:fail('unsupported','보안문자 이미지가 여러 개여서 자동 입력을 중지했습니다.')};
      const image=images[0];let container=image.parentElement,inputs=[],buttons=[];
      while(container&&container!==document.body){
        inputs=[...container.querySelectorAll(legacy?'input#txtCaptcha':'input')].filter(e=>shown(e)&&['text',''].includes(String(e.type||'').toLowerCase()));
        buttons=[...container.querySelectorAll(legacy?'.capchaBtns a,.capchaBtns button':'button')].filter(e=>shown(e)&&e.textContent.replace(/\s+/g,'').trim()==='입력완료');
        if(inputs.length===1&&buttons.length===1)break;
        container=container.parentElement;
      }
      if(!container||container===document.body||inputs.length!==1||buttons.length!==1)return {result:fail('unsupported','보안문자 입력칸과 입력완료 버튼을 하나로 확인하지 못했습니다. 입력칸이 접혀 있다면 직접 펼쳐 주세요.')};
      const input=inputs[0],button=buttons[0];
      if(input.readOnly)return {result:fail('unsupported','보안문자 입력칸이 읽기 전용입니다.')};
      if(input.disabled)return {result:fail('pending','보안문자 입력칸 활성화를 기다립니다.')};
      if(!image.complete||!image.naturalWidth||!image.naturalHeight)return {result:fail('pending','보안문자 이미지가 로딩 중입니다.')};
      if(image.naturalWidth>1600||image.naturalHeight>1000)return {result:fail('unsupported','보안문자 이미지 크기를 확인해 주세요.')};
      const error=[...container.querySelectorAll(legacy?'.alertNotice':'[class*="ModalCaptchaText_captchaError__"]')].filter(shown).map(e=>e.textContent.trim()).filter(Boolean).join(' ').slice(0,300);
      return {image,input,button,container,error,adapter:modern?'onestop':'legacy'};
    };
    const readImage=image=>{
      const src=image.currentSrc||image.src||'';
      if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(src)&&src.length<=2000000)return src;
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('canvas');context.drawImage(image,0,0);
      const value=canvas.toDataURL('image/png');if(value.length>2000000)throw Error('size');return value;
    };
    const inspect=({includeImage=false,expected}={})=>{
      const found=locate();if(found.result)return found.result;
      let data=null;try{data=readImage(found.image);}catch{}
      const imageSource=found.image.currentSrc||found.image.src||'';
      let current=state.current;
      if(!current||current.image!==found.image||current.input!==found.input||current.data!==data||current.imageSource!==imageSource){
        state.cancelPending?.();
        current=state.current={...found,data,imageSource,id:state.documentKey+':'+(++state.sequence),submitted:false,locked:false,manualTouched:false};
        const remember=e=>{if(e.isTrusted&&state.current===current){current.manualTouched=true;state.cancelPending?.();}};
        current.input.addEventListener('input',remember);current.input.addEventListener('change',remember);
      }else Object.assign(current,found);
      const existingText=String(found.input.value||'');
      let status=current.submitted?(found.error?'incorrect':'submitted'):(current.manualTouched||existingText?'manual':'ready');
      if(!data&&status==='ready')status='retry';
      if(expected&&expected!==current.id)status='changed';
      return {present:true,supported:true,status,challengeId:current.id,existingText,adapter:found.adapter,submitEnabled:enabled(found.button),message:found.error||(status==='retry'?'브라우저에서 이미지를 읽지 못해 새 이미지가 필요합니다.':status==='manual'?'직접 입력한 문자가 있어 자동으로 덮어쓰지 않습니다.':status==='changed'?'보안문자 이미지가 바뀌었습니다.':status==='submitted'?'입력완료를 눌렀으며 사이트 응답을 확인 중입니다.':'보안문자 이미지를 확인했습니다.'),...(includeImage?{imageDataUrl:data}:{}),imageWidth:found.image.naturalWidth,imageHeight:found.image.naturalHeight};
    };
    const submit=async arg=>{
      if(typeof arg?.challengeId!=='string'||!/^[A-Z]{6}$/.test(arg?.text||''))return {submitted:false,status:'unsupported',message:'보안문자 6자리와 현재 이미지 확인 정보가 필요합니다.'};
      const before=inspect({expected:arg.challengeId});
      if(!before.supported||before.status!=='ready')return {...before,submitted:false};
      const current=state.current;
      if(current.locked||current.submitted)return {submitted:false,status:'pending',message:'이미 처리 중인 보안문자입니다.'};
      current.locked=true;
      return new Promise(resolve=>{
        let done=false,observer,timer;
        const finish=result=>{if(done)return;done=true;clearTimeout(timer);observer?.disconnect();if(state.cancelPending===cancel)state.cancelPending=null;resolve(result);};
        const cancel=()=>finish({submitted:false,status:'cancelled',message:'보안문자 자동 입력을 중지했습니다.'});
        state.cancelPending=cancel;
        const check=()=>{
          if(done)return;
          const found=locate();
          if(found.result)return finish({...found.result,submitted:false});
          let data;try{data=readImage(found.image);}catch{return finish({submitted:false,status:'unsupported',message:'보안문자 이미지를 다시 확인할 수 없습니다.'});}
          if(state.current!==current||found.image!==current.image||found.input!==current.input||data!==current.data)return finish({submitted:false,status:'changed',message:'입력 중 이미지가 바뀌어 확인을 누르지 않았습니다.'});
          if(current.manualTouched||String(found.input.value)!==arg.text)return finish({submitted:false,status:'manual',message:'입력값이 바뀌어 자동 확인을 중지했습니다.'});
          if(!enabled(found.button))return;
          // Latch before the site's handler runs, including synchronous errors.
          current.submitted=true;
          try{siteInvoke(found.button);finish({submitted:true,status:'submitted',challengeId:current.id,message:'보안문자를 전달하고 사이트 확인 함수를 실행했습니다.'});}
          catch{finish({submitted:false,status:'uncertain',message:'사이트 확인 함수의 실행 결과를 확인하지 못했습니다. 재전송하지 않습니다.'});}
        };
        observer=new MutationObserver(check);observer.observe(current.container,{subtree:true,childList:true,attributes:true});
        timer=setTimeout(()=>finish({submitted:false,status:'retry',message:'입력완료 버튼이 활성화되지 않아 새 이미지가 필요합니다.'}),1500);
        try{
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
          if(!setter)return finish({submitted:false,status:'unsupported',message:'보안문자 입력칸에 값을 전달하지 못했습니다.'});
          setter.call(current.input,arg.text);
          siteInvoke(current.input,'change',arg.text);
          check();
        }catch{return finish({submitted:false,status:'unsupported',message:'보안문자 입력 중 오류가 발생했습니다. 실제 화면을 확인해 주세요.'});}
      });
    };
    const refresh=arg=>{
      if(typeof arg?.challengeId!=='string')return {refreshed:false,status:'changed'};
      const info=inspect({expected:arg?.challengeId}),current=state.current;
      if(info.status==='changed'||info.status==='absent')return {refreshed:false,status:info.status};
      if(!info.supported||!current||current.manualTouched||(!current.locked&&info.existingText))return {refreshed:false,status:'manual',message:'직접 입력 또는 다른 인증 상태를 확인해 주세요.'};
      if(current.refreshRequested)return {refreshed:true,status:'pending'};
      const buttons=[...current.container.querySelectorAll('button')].filter(e=>shown(e)&&(e.matches?.('[class*="ModalCaptchaText_buttonRefresh__"]')||/^(?:새로고침|보안문자 새로고침)$/.test(e.getAttribute('aria-label')||e.textContent.trim())));
      if(buttons.length!==1)return {refreshed:false,status:'manual',message:'캡챠 팝업의 새로고침 버튼을 확인하지 못했습니다.'};
      if(!enabled(buttons[0]))return {refreshed:false,status:'pending',message:'캡챠 새로고침 버튼 활성화 대기'};
      state.cancelPending?.();current.refreshRequested=true;siteInvoke(buttons[0]);return {refreshed:true,status:'pending'};
    };
    window.__bearsCaptchaPage={version:3,snapshot:()=>inspect({includeImage:true}),status:arg=>inspect({expected:arg?.challengeId}),submit,refresh,cancel:()=>{state.cancelPending?.();return {cancelled:true};}};
  }
  return window.__bearsCaptchaPage.snapshot();
},
"captcha.captchaSubmit":function captchaSubmit(arg){return window.__bearsCaptchaPage?.submit(arg)||{submitted:false,status:'changed',message:'페이지가 바뀌었습니다. 보안문자 이미지를 다시 확인해 주세요.'};},
"captcha.captchaStatus":function captchaStatus(arg){return window.__bearsCaptchaPage?.status(arg)||{present:false,supported:false,status:'changed',message:'페이지가 바뀌어 이전 보안문자의 결과를 확인할 수 없습니다.'};},
"captcha.captchaCancel":function captchaCancel(){return window.__bearsCaptchaPage?.cancel()||{cancelled:true};},
"captcha.captchaRefresh":function captchaRefresh(arg){return window.__bearsCaptchaPage?.refresh(arg)||{refreshed:false,status:'changed'};},
"manualCaptcha.manualCaptchaPrepare":function manualCaptchaPrepare(arg){
  if(!window.__ticketManualCaptchaPage){
    const state={current:null,sequence:0,documentKey:crypto.randomUUID(),generation:0};
    const shown=e=>{if(!e||!e.isConnected)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.display!=='none'&&s.opacity!=='0';};
    const enabled=e=>shown(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
    const fail=(status,message,extra={})=>({present:true,supported:false,status,message,...extra});
    const locate=()=>{
      const u=new URL(location.href),modern=u.origin==='https://tickets.interpark.com'&&/^\/onestop(?:\/|$)/.test(u.pathname),legacy=u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
      if(!modern&&!legacy)return {result:{present:false,supported:false,status:'unsupported',message:'직접 입력 도움은 NOL 예매창에서만 지원합니다.'}};
      if([...document.querySelectorAll('[class*="ModalCaptchaSlider_layerWrap__"],.captchSliderLayer,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')].some(shown))return {result:fail('unsupported','문자 이미지 이외의 인증은 해당 화면에서 직접 진행해 주세요.')};
      const images=[...new Set(document.querySelectorAll(modern?'img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img':'#imgCaptcha'))].filter(shown);
      if(!images.length)return {result:{present:false,supported:true,status:'absent',message:'보안문자 창이 보이지 않습니다.'}};
      if(images.length!==1)return {result:fail('unsupported','보안문자 이미지가 여러 개여서 입력 대상을 정할 수 없습니다.')};
      const image=images[0];let container=image.parentElement,inputs=[],buttons=[];
      while(container&&container!==document.body){
        inputs=[...container.querySelectorAll(legacy?'input#txtCaptcha':'input')].filter(e=>shown(e)&&['text',''].includes(String(e.type||'').toLowerCase()));
        buttons=[...container.querySelectorAll(legacy?'.capchaBtns a,.capchaBtns button':'button')].filter(e=>shown(e)&&e.textContent.replace(/\s+/g,'').trim()==='입력완료');
        if(inputs.length===1&&buttons.length===1)break;
        container=container.parentElement;
      }
      if(!container||container===document.body||inputs.length!==1||buttons.length!==1)return {result:fail('unsupported','이미지와 입력칸·입력완료 버튼 한 쌍을 확인하지 못했습니다.')};
      const input=inputs[0],button=buttons[0];
      if(input.disabled||input.readOnly)return {result:fail('unsupported','보안문자 입력칸을 사용할 수 없습니다.')};
      if(!image.complete||!image.naturalWidth||!image.naturalHeight)return {result:fail('pending','보안문자 이미지가 로딩 중입니다.')};
      if(image.naturalWidth>1600||image.naturalHeight>1000)return {result:fail('unsupported','보안문자 이미지 크기를 확인해 주세요.')};
      return {image,input,button,container,adapter:modern?'onestop':'legacy'};
    };
    const readImage=image=>{
      const src=image.currentSrc||image.src||'';
      if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(src)&&src.length<=2000000)return src;
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('canvas');context.drawImage(image,0,0);
      const value=canvas.toDataURL('image/png');if(value.length>2000000)throw Error('size');return value;
    };
    const sameDom=(a,b)=>a&&a.image===b.image&&a.input===b.input&&a.button===b.button&&a.container===b.container;
    const inspect=({includeImage=false,expected,renewCancelled=false}={})=>{
      const found=locate();if(found.result)return found.result;
      let data;try{data=readImage(found.image);}catch{return fail('unsupported','이미지를 표시할 수 없습니다. 예매 화면에서 직접 입력해 주세요.');}
      let current=state.current;
      if(!sameDom(current,found)||current.data!==data||(renewCancelled&&current.cancelled)){
        const keepTouched=current?.input===found.input&&current.data===data&&current.manualTouched;
        if(current){current.input.removeEventListener('input',current.remember);current.input.removeEventListener('change',current.remember);}
        current=state.current={...found,data,id:state.documentKey+':'+(++state.sequence),submitted:false,locked:false,cancelled:false,focusAttempted:false,manualTouched:!!keepTouched};
        current.remember=e=>{if(e.isTrusted&&state.current===current)current.manualTouched=true;};
        current.input.addEventListener('input',current.remember);current.input.addEventListener('change',current.remember);
      }
      const existingText=String(found.input.value||'');
      const status=expected&&expected!==current.id?'changed':current.cancelled?'cancelled':current.submitted?'submitted':current.locked?'pending':current.manualTouched||existingText?'manual':'ready';
      return {present:true,supported:true,status,challengeId:current.id,existingText,adapter:found.adapter,submitEnabled:enabled(found.button),message:status==='manual'?'예매창에 직접 입력한 내용은 덮어쓰지 않습니다.':status==='changed'?'이미지 또는 입력 화면이 바뀌었습니다. 다시 확인해 주세요.':status==='submitted'?'입력완료 버튼을 한 번 눌렀습니다. 실제 인증 결과는 예매창에서 확인해 주세요.':status==='cancelled'?'입력 전달을 취소했습니다.':'이미지를 보고 직접 입력해 주세요.',...(includeImage?{imageDataUrl:data}:{}),imageWidth:found.image.naturalWidth,imageHeight:found.image.naturalHeight};
    };
    const editable=e=>e&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(String(e.tagName||'').toUpperCase())||e.getAttribute?.('contenteditable')==='true');
    const prepare=options=>{
      const result=inspect({includeImage:true,renewCancelled:true});result.focused=false;
      const current=state.current;
      if(options?.focus===true&&result.supported&&result.present&&current&&!current.focusAttempted){
        // Even a skipped first attempt is remembered: background refreshes must
        // never steal focus after the user leaves another editable field.
        current.focusAttempted=true;
        const active=document.activeElement;
        if(result.status==='ready'&&(!editable(active)||active===current.input)){
          try{current.input.focus({preventScroll:true});result.focused=document.activeElement===current.input;}catch{}
        }
      }
      return result;
    };
    const submit=async options=>{
      if(typeof options?.challengeId!=='string'||typeof options?.text!=='string'||!/^[A-Z]{6}$/.test(options.text))return {submitted:false,status:'unsupported',message:'직접 작성한 영문 대문자 6자리와 현재 이미지 확인 정보가 필요합니다.'};
      const before=inspect({expected:options.challengeId});
      if(!before.supported||before.status!=='ready')return {...before,submitted:false};
      const current=state.current,generation=state.generation;
      current.locked=true;
      const stop=(status,message)=>({submitted:false,status,challengeId:current.id,message});
      try{
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if(!setter)return stop('unsupported','입력칸에 값을 전달할 수 없습니다. 예매창에서 직접 입력해 주세요.');
        setter.call(current.input,options.text);
        siteInvoke(current.input,'change',options.text);
        // One bounded event/microtask turn lets a controlled input update its
        // button. There is no timer, observer, polling, or delayed retry.
        await Promise.resolve();
        if(current.cancelled||state.generation!==generation)return stop('cancelled','입력 전달을 취소하여 확인 버튼을 누르지 않았습니다.');
        const found=locate();if(found.result)return {...found.result,submitted:false};
        let data;try{data=readImage(found.image);}catch{return stop('unsupported','이미지를 다시 확인할 수 없어 확인 버튼을 누르지 않았습니다.');}
        if(state.current!==current||!sameDom(current,found)||data!==current.data)return stop('changed','이미지 또는 입력 화면이 바뀌어 확인 버튼을 누르지 않았습니다.');
        if(current.manualTouched||String(found.input.value)!==options.text)return stop('manual','다른 입력이 감지되어 확인 버튼을 누르지 않았습니다.');
        if(!enabled(found.button))return stop('disabled','입력완료 버튼이 아직 비활성 상태입니다. 예매창에서 직접 확인해 주세요.');
        current.submitted=true;
        siteInvoke(found.button);
        return {submitted:true,status:'submitted',challengeId:current.id,message:'직접 작성한 문자를 전달하고 입력완료 버튼을 한 번 눌렀습니다. 실제 인증 결과는 예매창에서 확인해 주세요.'};
      }catch{return stop('unsupported','입력 전달 중 오류가 발생했습니다. 예매창의 내용을 확인해 주세요.');}
      finally{current.locked=false;}
    };
    const cancel=()=>{state.generation++;if(state.current)state.current.cancelled=true;return {cancelled:true};};
    window.__ticketManualCaptchaPage={prepare,submit,cancel};
  }
  return window.__ticketManualCaptchaPage.prepare(arg);
},
"manualCaptcha.manualCaptchaSubmit":function manualCaptchaSubmit(arg){return window.__ticketManualCaptchaPage?.submit(arg)||{submitted:false,status:'changed',message:'이미지를 먼저 확인해 주세요.'};},
"manualCaptcha.manualCaptchaCancel":function manualCaptchaCancel(){return window.__ticketManualCaptchaPage?.cancel()||{cancelled:true};},
"pricePage.adultPriceStep":function adultPriceStep({quantity}){
  const state=priceState();
  if(!state.ready||state.quantity!==quantity||state.rejected)throw Error('가격 화면의 선택 좌석 수를 확인하지 못했습니다.');
  const adult=name=>/^\[?예매가\]?[\/·]?성인$/.test(name.replace(/\s/g,''));
  // Inspect every group before making any change; discounts and mixed manual
  // selections must not be silently replaced.
  const plan=state.groups.map(g=>{
    const indexes=g.items.map((v,i)=>adult(v.name)?i:-1).filter(i=>i>=0);
    if(indexes.length!==1||g.items.some((v,i)=>i!==indexes[0]&&v.count>0))return null;
    const index=indexes[0];return g.items[index].count<=g.max?{index,count:g.items[index].count,max:g.max}:null;
  });
  if(plan.some(p=>!p))return {status:'manual',message:'좌석 선택과 가격 화면을 확인했습니다. 예매가/성인 항목을 하나로 확인하지 못해 가격은 직접 선택해 주세요.'};
  const signature=JSON.stringify(state.groups);
  const old=window.__ticketAdultPrice;
  const groupIndex=plan.findIndex(p=>p.count<p.max);
  if(groupIndex<0){delete window.__ticketAdultPrice;return {status:'complete',quantity,message:`좌석 ${quantity}매와 예매가/성인 ${quantity}매 선택을 확인했습니다. 주문·결제는 진행하지 않았습니다.`};}
  if(old?.signature===signature)return {status:'pending'};
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const group=[...document.querySelectorAll('[class*="PriceGroup_group__"]')].filter(shown)[groupIndex];
  const item=[...group.querySelectorAll('li[class*="PriceItem_typeItem__"]')].filter(shown)[plan[groupIndex].index];
  const buttons=[...item.querySelectorAll('button[class*="stepper__incrementButton"]')].filter(shown);
  if(buttons.length!==1)throw Error('성인 가격 수량 버튼을 하나로 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {status:'pending'};
  window.__ticketAdultPrice={signature};siteInvoke(buttons[0]);
  return {status:'pending'};
},
"pricePage.proceedBooking":function proceedBooking({quantity}){
  const state=priceState();
  if(!state.ready||state.quantity!==quantity)throw Error('예매하기 전에 좌석 수를 다시 확인하지 못했습니다.');
  const adult=name=>/^\[?예매가\]?[\/·]?성인$/.test(name.replace(/\s/g,''));
  if(state.groups.some(g=>g.items.filter(i=>adult(i.name)).length!==1||g.items.some(i=>i.count!==(adult(i.name)?g.max:0))))throw Error('예매가/성인 수량이 선택 좌석 수와 다릅니다.');
  if(state.rejected)throw Error('좌석 선택 거절 후 좌석 화면 복구가 필요합니다.');
  if(window.__ticketBookingDispatch?.completed)delete window.__ticketBookingDispatch;
  if(window.__ticketBookingDispatch)return {status:'pending',dispatched:false};
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const buttons=[...document.querySelectorAll('button')].filter(e=>shown(e)&&e.textContent.replace(/\s/g,'')===quantity+'매예매하기');
  if(buttons.length!==1)throw Error('가격 화면의 '+quantity+'매 예매하기 버튼을 하나로 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {status:'pending',dispatched:false};
  window.__ticketBookingDispatch={quantity,at:Date.now()};
  siteInvoke(buttons[0]);return {status:'pending',dispatched:true};
},
"pricePage.returnToSeats":function returnToSeats(){
  const recovery=window.__ticketPriceRecovery;
  if(!recovery)throw Error('확인된 좌석 거절 없이 이전 단계로 이동하지 않습니다.');
  const u=new URL(location.href),shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  if(u.origin!=='https://tickets.interpark.com'||u.pathname!=='/onestop/seat')throw Error('좌석 복구 중 다른 화면으로 이동했습니다.');
  if([...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]')].some(shown))return {pending:true};
  if(u.searchParams.get('step')!=='price'){
    if(![...document.querySelectorAll('circle.js-seat[id],button[class*="SportsSeatGradeList_contentItem__"]')].some(shown))return {pending:true};
    delete window.__ticketPriceRecovery;return {returned:true};
  }
  if(recovery.backSent)return {pending:true};
  // This exact price header's site handler returns to the seat phase.
  const buttons=[...document.querySelectorAll('button[class*="PriceContent_headerBack__"]')].filter(shown);
  if(buttons.length!==1)throw Error('좌석으로 돌아가는 가격 화면의 이전 버튼을 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {pending:true};
  recovery.backSent=true;siteInvoke(buttons[0]);return {pending:true};
},
"page.stopWatchers":function stopWatchers(){if(window.__ticketDirectApi)window.__ticketDirectApi.cancelled=true;if(window.__ticketHttpBooking){window.__ticketHttpBooking.cancelled=true;try{const r=JSON.parse(sessionStorage.getItem("baseball/http-booking")||"null");if(r){r.cancelled=true;sessionStorage.setItem("baseball/http-booking",JSON.stringify(r));}}catch{}}window.__ticketSeatChanges?.stop();window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();return true;},
"page.pageClock":function pageClock({entryStage='gate'}={}){return {pageMono:performance.now(),documentId:(entryStage==='listing'?window.__bearsEntry:window.__bearsGate)?.status.documentId};},
"page.gateSnapshot":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAll":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);siteInvoke(b);});},
"page.gateState":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAllGames":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);siteInvoke(b);});},
};};try{return {ok:true,value:(await runtime(action,arg,meta,invokeSiteFunction,makeActions))??null};}catch(error){return {ok:false,code:/^SITE_[A-Z_]+$/.test(error?.message||"")?error.message:"SITE_ACTION_FAILED"};}};
