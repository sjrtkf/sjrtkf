'use strict';
// Read only public, visible event guidance. Never return cookies, storage,
// signed links, the complete page body, or an inferred opening time.
function pageInfo() {
  const text=String(document.body?.innerText||'').replace(/\s+/g,' ');
  const cardCount=document.querySelectorAll('button.grid-area_cta').length;
  const title=String(document.querySelector('h1')?.textContent||document.title||'').trim().slice(0,200);
  const maxMatch=text.match(/매수\s*제한\s*[:：]?\s*회원\s*별\s*(\d{1,2})\s*매/);
  const maxTickets=maxMatch&&Number(maxMatch[1])>0?Number(maxMatch[1]):null;
  const mobileOnly=/모바일\s*티켓\s*(?:만\s*사용|으로만\s*운영)/.test(text);
  const cardOnly=/신용\s*카드\s*결제만\s*가능/.test(text);
  const notes=[];
  if(maxTickets)notes.push(`현재 페이지 안내: 회원별 ${maxTickets}매 제한`);
  if(mobileOnly)notes.push('모바일티켓 안내가 있습니다. 일부 상품의 현장수령 예외는 공식 안내를 확인하세요.');
  if(cardOnly)notes.push('현재 페이지 안내: 신용카드 결제만 가능');
  if(/시야방해석이\s*아닌\s*경우에도/.test(text))notes.push('시야방해석으로 지정되지 않은 자리도 실제 시야가 가릴 수 있습니다.');
  const seatImages=[],seen=new Set();
  for(const img of document.querySelectorAll('img[alt]')) {
    const label=String(img.alt||'').trim();
    if(!/(?:좌석|座席|(?:^|[_\s])PS(?:[_.\s]|$))/i.test(label))continue;
    try {
      const u=new URL(img.currentSrc||img.src);
      if(u.origin!=='https://ent-ticketimage.interparkcdn.net'||u.username||u.password||u.search||u.hash||!/^\/display\/articles\/[a-f0-9]{32}\.(?:jpg|png|webp)$/i.test(u.pathname)||seen.has(u.href))continue;
      seen.add(u.href);seatImages.push({label:label.slice(0,120),url:u.href});
      if(seatImages.length>=8)break;
    }catch{}
  }
  return {title,url:location.origin+location.pathname,checkedAt:Date.now(),empty:cardCount===0&&text.includes('예매 가능한 상품이 없어요'),cardCount,maxTickets,mobileOnly,cardOnly,notes,seatImages};
}
function gameCards() {
  const unique=new Map();
  for(const button of document.querySelectorAll('button.grid-area_cta')){
    const card=button.parentElement,info=card.querySelector('.grid-area_info')?.textContent.trim(),teams=[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt).join(' vs ');
    if(!info||!teams)continue;
    const key=info+' | '+teams;
    const schedule=card.querySelector('.grid-area_schedule')?.innerText?.replace(/\s+/g,' ').trim()||'';
    const item={key,label:info+' · '+teams,schedule,buttonText:button.textContent.trim()};
    if(!unique.has(key)||schedule)unique.set(key,item);
  }
  return [...unique.values()];
}
function armEntry({key,openAt,offsetMs=0,timeoutMs=60000}) {
  window.__bearsEntry?.stop();
  const started=performance.now(),deadline=started+Math.max(0,openAt-(Date.now()+offsetMs));
  const status={phase:'armed',openAt,key,clickedAt:null,delayMs:null};
  let timer,observer,done=false;
  const stop=()=>{done=true;clearTimeout(timer);observer?.disconnect();if(status.phase==='armed')status.phase='stopped';};
  const find=()=>[...document.querySelectorAll('button.grid-area_cta')].filter(button=>{
    const card=button.parentElement,info=card.querySelector('.grid-area_info')?.textContent.trim(),teams=[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt).join(' vs ');
    return info+' | '+teams===key;
  }).filter(button=>{const rect=button.getBoundingClientRect();return rect.width>0&&rect.height>0;});
  if(!find().length)throw new Error('대상 경기를 찾을 수 없습니다. 경기 전체 목록을 다시 읽어 주세요.');
  const tick=()=>{
    if(done)return;
    clearTimeout(timer);
    const now=performance.now(),remaining=deadline-now;
    if(remaining>0){timer=setTimeout(tick,Math.min(remaining,1000));return;}
    if(now-deadline>timeoutMs){status.phase='timeout';stop();return;}
    const matches=find();
    const button=matches.find(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&b.textContent.trim()==='예매하기');
    if(button){status.phase='clicked';status.clickedAt=Date.now()+offsetMs;status.delayMs=Math.max(0,now-deadline);stop();siteInvoke(button);return;}
    timer=setTimeout(tick,20);
  };
  observer=new MutationObserver(tick);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','aria-disabled'],characterData:true});
  window.__bearsEntry={status,stop};tick();return status;
}
// Observe the selected listing card, then call its current site handler once.
// Keep this function self-contained: it also runs in the site's MAIN world.
function armListing({key,runId=null,clockRequired=false,timeoutMs=15*86400000}={}) {
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
}
function setListingClock(config){return window.__bearsEntry?.setClock?.(config)||false;}
function listingState(){return window.__bearsEntry?.status||null;}
function stopListing({runId=null,key}={}){
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
}
// Enter only the selected card's normal preparation flow. Opening time is
// enforced by the site's gate; this does not unlock or resend anything.
function prepareEntry({key,runId=null}) {
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
}
function gateStatus({goodsCode}={}) {
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
  const blocked=status.notice.present||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
  status.enabled=!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&status.buttonText==='예매하기';
  status.reason=blocked?'안내/인증/처리가 끝나기를 기다립니다.':status.enabled?'사이트가 예매 버튼을 활성화했습니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
  return status;
}
function armGate({goodsCode,runId=null,timeoutMs=15*86400000,httpRetry=false,allowInitiallyEnabled=false}={}) {
  // Kept self-contained for execution in the isolated browser world.
  const match=location.origin==='https://tickets.interpark.com'&&location.pathname.match(/^\/gates\/ticket\/(\d{8})$/);
  if(!match||!goodsCode||String(goodsCode)!==match[1])throw new Error('대상 경기의 준비 화면을 확인하지 못했습니다.');
  const prior=window.__bearsGate;
  if(prior?.status?.goodsCode===String(goodsCode)&&prior.status.runId===runId&&['armed','clicked','request-observed','http-running'].includes(prior.status.phase))return prior.status;
  prior?.stop();
  const startPath=location.pathname,started=performance.now();
  const status={phase:'armed',documentId:String(performance.timeOrigin)+':'+started,goodsCode:String(goodsCode),runId,clickedAt:null,trigger:null,observedDisabled:false,clock:{outcome:'not-configured'},reason:'사이트의 예매 버튼 활성화를 기다립니다.'};
  let observer,timer,clockTimer,http,done=false,inFlight=false,retryAt=0,attempts=0;
  const stop=()=>{done=true;clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();http?.stop();if(['armed','http-running'].includes(status.phase))status.phase='stopped';};
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
    const now=performance.now(),firstAt=status.clock.deadlineMono;
    const configured=Number.isFinite(firstAt),clockValid=configured&&now<=status.clock.validUntilMono;
    if(configured&&!clockValid)status.clock.outcome='stale';
    if(httpRetry&&!clockValid){status.reason='유효한 서버 시각 설정을 기다립니다.';timer=setTimeout(tick,250);return;}
    if(clockValid&&now<firstAt){timer=setTimeout(tick,Math.min(250,firstAt-now));return;}
    if(button&&!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&button.textContent.trim()==='예매하기'&&(status.observedDisabled||allowInitiallyEnabled)){
      // Both triggers acquire this latch synchronously, before dispatching.
      // A delivered DOM click is not evidence of an accepted server request.
      status.enabledObservedMono??=performance.now();status.phase='clicked';status.trigger=source==='server-clock'?'server-clock':'activation';status.clickedAt=Date.now();status.clickedMono=performance.now();status.invokeDelayMs=status.clickedMono-status.enabledObservedMono;status.attempts=++attempts;
      if(status.trigger==='server-clock')status.clock.outcome='clicked';status.reason='활성화 확인 · 사이트 진입 함수 실행';
      clearTimeout(timer);clearTimeout(clockTimer);inFlight=true;
      if(!http){stop();siteInvoke(button);return;}
      // If the site's guard returned without issuing any request, retry the
      // current handler after its cooldown. The HTTP guard stays installed so
      // delayed/automatic paths cannot create another network operation.
      Promise.resolve().then(()=>siteInvoke(button)).then(()=>{
        inFlight=false;if(done||http.claimed)return;
        if(attempts>=3){status.phase='blocked';status.reason='사이트 함수 실행 후 진입 요청이 발생하지 않았습니다.';stop();return;}
        retryAt=performance.now()+1000;status.phase='armed';status.reason='진입 요청 미발생 · 사이트 잠금 해제 후 재확인';timer=setTimeout(tick,1000);
      }).catch(()=>{inFlight=false;if(done)return;status.phase='blocked';status.reason='사이트 진입 함수 실행 결과를 확인하지 못했습니다.';stop();});return;
    }
    status.reason=!prepared||buttons.length!==1?'확인된 준비 화면과 예매 버튼을 기다립니다.':blocked?'안내/인증/처리가 끝나기를 기다립니다.':!status.observedDisabled?'처음부터 활성화된 버튼에는 중복 클릭하지 않고 사이트의 자동 진행을 기다립니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
    timer=setTimeout(tick,250);
  };
  observer=new MutationObserver(tick);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  const setClock=config=>{
    if(done||status.clock.firedAtMono!=null&&status.clock.outcome!=='stale'||config?.runId!==runId||config.documentId!==status.documentId||String(config?.goodsCode)!==String(goodsCode))return false;
    const {deadlineMono,validUntilMono,uncertaintyMs,openAt}=config;
    if(config.source!=='ticket-server'||![deadlineMono,validUntilMono,uncertaintyMs,openAt].every(Number.isFinite)||uncertaintyMs<0||uncertaintyMs>501||validUntilMono<deadlineMono)return false;
    clearTimeout(clockTimer);const clock={outcome:'armed',deadlineMono,validUntilMono,uncertaintyMs,openAt};status.clock=clock;
    const fire=()=>{
      if(done||status.clock!==clock)return;
      const now=performance.now();
      if(now>validUntilMono){status.clock.outcome='stale';return;}
      const firstAt=deadlineMono;
      if(now<firstAt){clockTimer=setTimeout(fire,Math.ceil(firstAt-now));return;}
      status.clock.firedAtMono=now;status.clock.delayMs=now-firstAt;
      status.clock.outcome='not-ready';tick('server-clock');
    };
    fire();return true;
  };
  if(typeof createEntryHttp==='function'){
    const control=window.__ticketSiteCode,epoch=control?.epoch;
    http=createEntryHttp({assertActive:()=>{if(done||location.pathname!==startPath||control&&(window.__ticketSiteCode!==control||control.epoch!==epoch||control.stopped||Date.now()>control.leaseUntil))throw Error('SITE_CODE_STOPPED');},onStatus:value=>{
      status.http=value;if(value.requestCount){status.phase='http-running';clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();}
      if(Number.isFinite(value.startedMono)&&Number.isFinite(status.clickedMono))status.requestDelayMs=Math.max(0,value.startedMono-status.clickedMono);
    }});
  }
  window.__bearsGate={status,stop,setClock,requestObserved(){if(done||http?.claimed)return;status.phase='request-observed';status.reason='사이트의 진입 요청을 관찰했습니다.';stop();}};tick();return status;
}
function setGateClock(config){return window.__bearsGate?.setClock?.(config)||false;}
function noteGateRequest({runId}={}){const gate=window.__bearsGate;if(gate?.status.runId!==runId)return null;gate.requestObserved?.();return gate.status;}
module.exports={pageInfo,gameCards,armEntry,armListing,setListingClock,listingState,stopListing,prepareEntry,gateStatus,armGate,setGateClock,noteGateRequest};
