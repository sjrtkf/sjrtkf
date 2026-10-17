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
    const headings=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"]')].filter(visible).map(e=>e.textContent.replace(/\s/g,''));
    noticeKey=headings.find(text=>['예매안내','취소/환불안내'].includes(text))||null;
    if(noticeKey)break;
    container=container.parentElement;
  }
  status.notice={present:notices.length>0,enabled:notices.length===1&&!notices[0].disabled&&notices[0].getAttribute('aria-disabled')!=='true',key:noticeKey};
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
  let observer,timer,clockTimer,http,done=false;
  const stop=()=>{done=true;clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();http?.stop();if(['armed','http-running'].includes(status.phase))status.phase='stopped';};
  const visible=e=>{const r=e.getBoundingClientRect();const css=getComputedStyle(e);return r.width>0&&r.height>0&&css.visibility!=='hidden'&&css.display!=='none';};
  const tick=(source='activation')=>{
    if(done||status.phase==='http-running')return;clearTimeout(timer);
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!==startPath){status.phase='navigated';stop();return;}
    if(performance.now()-started>timeoutMs){status.phase='timeout';stop();return;}
    const root=document.querySelector('main');
    const prepared=!!root&&/예매준비가완료됐어요|예매는오픈시간부터가능해요/.test(root.textContent.replace(/\s/g,''));
    const buttons=root?[...root.querySelectorAll('button')].filter(b=>visible(b)&&b.textContent.trim()!=='확인하고 예매하기'&&/(?:예매하기$|^남은시간\s*\d{1,2}:\d{2}$)/.test(b.textContent.trim())):[];
    const notice=[...document.querySelectorAll('button')].some(b=>visible(b)&&String(b.textContent||'').trim()==='확인하고 예매하기');
    const blocked=notice||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
    const button=prepared&&buttons.length===1?buttons[0]:null;
    if(button&&!blocked&&(button.disabled||button.getAttribute('aria-disabled')==='true'))status.observedDisabled=true;
    if(httpRetry&&status.clock.outcome==='not-configured'){timer=setTimeout(tick,250);return;}
    const firstAt=status.clock.deadlineMono-(httpRetry?1000:0);
    if(status.clock.outcome==='armed'&&performance.now()<firstAt){timer=setTimeout(tick,Math.min(250,firstAt-performance.now()));return;}
    if(httpRetry&&button&&!blocked&&Number.isFinite(firstAt)&&performance.now()<=status.clock.deadlineMono+1000){
      const control=window.__ticketSiteCode,epoch=control?.epoch,connection=control?.connection;
      const assertActive=()=>{if(done||location.pathname!==startPath||window.__ticketSiteCode!==control||control?.epoch!==epoch||control?.connection!==connection||control?.stopped||Date.now()>control?.leaseUntil)throw Error('SITE_CODE_STOPPED');};
      http=createEntryHttp({startMono:firstAt,endMono:status.clock.deadlineMono+1000,intervalMs:30,assertActive,onStatus:value=>{status.http=value;}});
      status.http=http.status;status.phase='http-running';status.trigger='server-clock';status.clickedAt=Date.now();status.clock.outcome='http-running';
      clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();
      try{const pending=siteInvoke(button,'entry');if(pending&&typeof pending.then==='function')pending.finally(()=>http.dispose()).catch(()=>{});}catch(error){http.stop();http.dispose();throw error;}return;
    }
    if(httpRetry&&performance.now()>status.clock.deadlineMono+1000){status.phase='blocked';status.reason='예약 진입 구간을 놓쳤습니다. 새 요청 없이 중지합니다.';stop();return;}
    if(button&&!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&button.textContent.trim()==='예매하기'&&(status.observedDisabled||allowInitiallyEnabled)){
      // Both triggers acquire this latch synchronously, before dispatching.
      // A delivered DOM click is not evidence of an accepted server request.
      status.phase='clicked';status.trigger=source==='server-clock'?'server-clock':'activation';status.clickedAt=Date.now();status.clickedMono=performance.now();if(status.trigger==='server-clock')status.clock.outcome='clicked';status.reason='사이트의 활성화된 진입 함수를 한 번 실행했습니다.';stop();siteInvoke(button);return;
    }
    status.reason=!prepared||buttons.length!==1?'확인된 준비 화면과 예매 버튼을 기다립니다.':blocked?'안내/인증/처리가 끝나기를 기다립니다.':!status.observedDisabled?'처음부터 활성화된 버튼에는 중복 클릭하지 않고 사이트의 자동 진행을 기다립니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
    timer=setTimeout(tick,250);
  };
  observer=new MutationObserver(tick);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  const setClock=config=>{
    if(done||status.clock.firedAtMono!=null||config?.runId!==runId||config.documentId!==status.documentId||String(config?.goodsCode)!==String(goodsCode))return false;
    const {deadlineMono,validUntilMono,uncertaintyMs,openAt}=config;
    if(config.source!=='ticket-server'||![deadlineMono,validUntilMono,uncertaintyMs,openAt].every(Number.isFinite)||uncertaintyMs<0||uncertaintyMs>501||validUntilMono<deadlineMono+(httpRetry?1000:0))return false;
    clearTimeout(clockTimer);status.clock={outcome:'armed',deadlineMono,validUntilMono,uncertaintyMs,openAt};
    const fire=()=>{
      if(done)return;
      const now=performance.now();
      if(now>validUntilMono){status.clock.outcome='stale';return;}
      const firstAt=deadlineMono-(httpRetry?1000:0);
      if(now<firstAt){clockTimer=setTimeout(fire,Math.ceil(firstAt-now));return;}
      status.clock.firedAtMono=now;status.clock.delayMs=now-firstAt;
      status.clock.outcome='not-ready';tick('server-clock');
    };
    fire();return true;
  };
  window.__bearsGate={status,stop,setClock,requestObserved(){if(done||http?.claimed)return;status.phase='request-observed';status.reason='사이트의 진입 요청을 관찰했습니다.';stop();}};tick();return status;
}
function setGateClock(config){return window.__bearsGate?.setClock?.(config)||false;}
function noteGateRequest({runId}={}){const gate=window.__bearsGate;if(gate?.status.runId!==runId)return null;gate.requestObserved?.();return gate.status;}
module.exports={pageInfo,gameCards,armEntry,prepareEntry,gateStatus,armGate,setGateClock,noteGateRequest};
