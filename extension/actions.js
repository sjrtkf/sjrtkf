'use strict';
globalThis.BaseballActions=(()=>{
const siteInvoke=function invokeSiteFunction(element,kind='activate',value){
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
const readBookingContext=function readBookingContext(){
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat')throw Error('WRONG_PAGE');
  let context,initial;
  try{
    context=JSON.parse(sessionStorage.getItem('interpark/context')||'{}');
    initial=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent||'{}').props?.pageProps?.initData;
  }catch{throw Error('CONTEXT_UNREADABLE');}
  const identity=value=>({goodsCode:String(value?.goods?.goodsCode||''),placeCode:String(value?.goods?.placeCode||''),playSeq:String(value?.playSeq?.playSeq||''),playDate:String(value?.playSeq?.playDate||''),playTime:String(value?.playSeq?.playTime||'')});
  const normalizedTime=value=>{
    const m=String(value||'').replace(/\s/g,'').match(/^(\d{1,2}):(\d{2})(AM|PM)?$/i);
    if(!m)return null;let hour=Number(m[1]);const minute=Number(m[2]),half=m[3]?.toUpperCase();
    if(minute>59||hour>(half?12:23)||half&&hour<1)return null;
    if(half)hour=hour%12+(half==='PM'?12:0);
    return hour*60+minute;
  };
  const current=identity(context),keys=['goodsCode','placeCode','playSeq'];
  if(!keys.every(k=>/^\d{3,8}$/.test(current[k]))||typeof context.sessionId!=='string'||!context.sessionId)throw Error('CONTEXT_REQUIRED');
  if(initial!=null){
    const original=identity(initial);
    if(!keys.every(k=>original[k]===current[k])||original.playDate&&original.playDate!==current.playDate||original.playTime&&(normalizedTime(original.playTime)==null||normalizedTime(original.playTime)!==normalizedTime(current.playTime)))throw Error('BOOTSTRAP_CONTEXT_MISMATCH');
  }else{
    // Client navigation can render a complete booking page with pageProps:{}.
    // Require current session identity plus the visible event header and date/time.
    const clean=value=>String(value||'').replace(/\s+/g,'');
    const name=clean(context.goods?.goodsName),date=current.playDate,time=clean(current.playTime);
    if(!name||!/^\d{8}$/.test(date)||normalizedTime(time)==null)throw Error('BOOKING_HEADER_REQUIRED');
    const dateLabel=date.slice(0,4)+'.'+date.slice(4,6)+'.'+date.slice(6,8);
    const matches=[...document.querySelectorAll('h3')].filter(h=>{
      const r=h.getBoundingClientRect(),style=getComputedStyle(h);
      return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&clean(h.textContent)===name;
    });
    if(!matches.length||!matches.every(h=>{const text=clean(h.parentElement?.textContent);const dateAt=text.indexOf(dateLabel);if(dateAt<0)return false;
      const times=[...text.slice(dateAt+dateLabel.length).matchAll(/(?:^|[^\d])(\d{1,2}:\d{2}(?:AM|PM)?)(?![\dA-Za-z])/gi)];
      return times.length===1&&normalizedTime(times[0][1])===normalizedTime(time);}))throw Error('BOOKING_HEADER_MISMATCH');
  }
  return {context,identity:current};
};
const resolveGradeNames=function resolveGradeNames(rows){
  if(!Array.isArray(rows)||rows.length>10000)throw Error('좌석 등급 목록 형식을 확인하지 못했습니다.');
  const groups=new Map();let duplicateCount=0;
  for(const row of rows){
    if(row===null)continue;
    const code=row?.seatGrade??row?.code,raw=row?.seatGradeName??row?.name;
    if(!['string','number'].includes(typeof code)||!String(code).trim()||String(code).length>100||typeof raw!=='string'||!raw.trim()||raw.length>300)throw Error('좌석 등급 코드·이름 형식을 확인하지 못했습니다.');
    const name=raw.normalize('NFKC').replace(/\s+/g,' ').trim(),key=name.replace(/\s+/g,'').toLowerCase(),id=String(code).trim();
    if(!groups.has(id))groups.set(id,new Map());
    const names=groups.get(id);if(names.has(key))duplicateCount++;else names.set(key,name);
  }
  const grades=[],gradeConflicts=[];
  for(const [code,names] of groups){
    if(names.size===1)grades.push({code,name:[...names.values()][0]});
    else gradeConflicts.push({code,names:[...names.values()]});
  }
  return {grades,gradeConflicts,duplicateCount};
};
const parseSeatLabels=function parseSeatLabels(rowNo,seatNo){
  const raw=typeof rowNo==='string'||typeof rowNo==='number'?String(rowNo):'';
  const qualified=raw.match(/^([A-Z]\d{1,2})구역\s+(\d+|[A-Z])열$/),text=qualified?qualified[2]:raw;
  const numeric=text.match(/^(\d+)(?:열)?$/),alpha=text.match(/^([A-Z])(?:열)?$/);
  let row=null,rowLabel=null,rowKind=null;
  if(numeric&&Number.isSafeInteger(Number(numeric[1]))){row=Number(numeric[1]);rowLabel=String(row);rowKind='numeric';}
  else if(alpha){row=alpha[1].charCodeAt(0)-64;rowLabel=alpha[1];rowKind='alpha';}
  const rawNumber=typeof seatNo==='string'||typeof seatNo==='number'?String(seatNo):'',numberMatch=rawNumber.match(/^(\d+)(?:번)?$/);
  const number=numberMatch&&Number.isSafeInteger(Number(numberMatch[1]))?Number(numberMatch[1]):null;
  return {row,rowLabel,rowKind,number};
};
const planAdultPrices=function planAdultPrices(payload,seats){
  const groups=Array.isArray(payload)?payload:payload?.prices;
  if(!Array.isArray(groups)||!groups.length||groups.length>500||payload?.toping?.code)throw Error('PRICE_RESPONSE_UNSUPPORTED');
  const counts=new Map();for(const seat of seats)counts.set(String(seat.seatGrade),(counts.get(String(seat.seatGrade))||0)+1);
  const plan=[];
  for(const [grade,count] of counts){
    const matches=groups.filter(g=>String(g?.seatGrade)===grade);
    if(matches.length!==1||!Array.isArray(matches[0].priceList))throw Error('PRICE_GRADE_AMBIGUOUS');
    const group=matches[0],clean=v=>String(v??'').normalize('NFKC').replace(/[\s/·\[\]]/g,'');
    const adult=group.priceList.filter(p=>p&&String(p.seatGrade)===grade&&['PG002','PG004','PG007'].includes(p.pgCode)&&clean(String(p.priceGradeName||'')+String(p.discountName||''))==='예매가성인');
    if(adult.length!==1)throw Error('ADULT_PRICE_AMBIGUOUS');
    const p=adult[0];
    if(typeof p.priceGrade!=='string'||!p.priceGrade||p.isMembership||p.isHPointCertify||p.isRandomCertifyOnce||p.randomCertifySeq&&String(p.randomCertifySeq)!=='0'||p.kindOfDiscount&&String(p.kindOfDiscount)!=='0'||p.dblDiscountOrNot||p.kindOfSettle||p.issueCode||p.cardKind)throw Error('PRICE_REQUIRES_CERTIFICATION');
    if(p.priceSettingType){
      const type=p.priceSettingType,n=Number(p.priceSettingCount);
      if(!['L8003','L8004','L8005','L8006'].includes(type)||!Number.isInteger(n)||n<1)throw Error('PRICE_RULE_UNSUPPORTED');
      if(type==='L8003'&&count%n||type==='L8004'&&count<n||type==='L8005'&&count>n||type==='L8006'&&count!==n)throw Error('PRICE_QUANTITY_LIMIT');
    }
    const amount=Number(p.discountSalesPrice),original=Number(p.salesPrice);
    if(p.discountSalesPrice==null||p.salesPrice==null||!Number.isFinite(amount)||amount<0||amount!==original||Number(p.discountValue||0)!==0)throw Error('ADULT_PRICE_UNSUPPORTED');
    if(!Number.isInteger(Number(p.priceMaxCount))||Number(p.priceMaxCount)<count||!Number.isInteger(Number(group.ticketMaxCount))||Number(group.ticketMaxCount)<count||p.remainCount!=null&&Number(p.remainCount)<count)throw Error('PRICE_QUANTITY_LIMIT');
    plan.push({selectedSeatCount:count,pgPrice:{...p,priceMaxCount:Math.min(Number(p.priceMaxCount),Number(group.ticketMaxCount))}});
  }
  return plan;
};
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
return Object.freeze({
"entry.pageInfo":function pageInfo() {
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
},
"entry.gameCards":function gameCards() {
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
},
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
  const blocked=status.notice.present||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
  status.enabled=!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&status.buttonText==='예매하기';
  status.reason=blocked?'안내/인증/처리가 끝나기를 기다립니다.':status.enabled?'사이트가 예매 버튼을 활성화했습니다.':'사이트의 예매 버튼 활성화를 기다립니다.';
  return status;
},
"entry.armGate":function armGate({goodsCode,runId=null,timeoutMs=15*86400000,httpRetry=false,allowInitiallyEnabled=false}={}) {
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
    if(httpRetry&&status.clock.outcome==='not-configured'){timer=setTimeout(tick,250);return;}
    const firstAt=status.clock.deadlineMono;
    if(status.clock.outcome==='armed'&&performance.now()<firstAt){timer=setTimeout(tick,Math.min(250,firstAt-performance.now()));return;}
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
    if(done||status.clock.firedAtMono!=null||config?.runId!==runId||config.documentId!==status.documentId||String(config?.goodsCode)!==String(goodsCode))return false;
    const {deadlineMono,validUntilMono,uncertaintyMs,openAt}=config;
    if(config.source!=='ticket-server'||![deadlineMono,validUntilMono,uncertaintyMs,openAt].every(Number.isFinite)||uncertaintyMs<0||uncertaintyMs>501||validUntilMono<deadlineMono)return false;
    clearTimeout(clockTimer);status.clock={outcome:'armed',deadlineMono,validUntilMono,uncertaintyMs,openAt};
    const fire=()=>{
      if(done)return;
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
},
"entry.setGateClock":function setGateClock(config){return window.__bearsGate?.setClock?.(config)||false;},
"entry.noteGateRequest":function noteGateRequest({runId}={}){const gate=window.__bearsGate;if(gate?.status.runId!==runId)return null;gate.requestObserved?.();return gate.status;},
"live.liveRead":function liveRead() {
  const visible = el => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none';};
  if(typeof window!=='undefined'&&typeof MutationObserver==='function'&&document.body&&!window.__ticketSeatChanges){
    // A countdown, animation, or identical React render is not new inventory.
    // Compare only visible seats, grade inventory and blockers/navigation that
    // can actually change the next step. Do not wake on every body mutation.
    const signature=()=>JSON.stringify([
      [...document.querySelectorAll('circle.js-seat[id]')].map(e=>[e.id,e.parentElement?.id,/SeatMap_disabled/.test(e.getAttribute('class')||''),/SeatMap_selected/.test(e.getAttribute('class')||''),e.getAttribute('fill'),e.getAttribute('cx'),e.getAttribute('cy'),visible(e)]),
      [...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].map(e=>[e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim(),e.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim(),!!e.disabled,e.getAttribute('aria-disabled'),visible(e)]),
      [...document.querySelectorAll('img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"],[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]')].map(e=>visible(e)),
      [...document.querySelectorAll('button')].filter(e=>['확인하고 예매하기','직접 좌석 선택하기','좌석도 전체보기','선택 완료'].includes(e.textContent.trim())).map(e=>[e.textContent.trim(),!!e.disabled,e.getAttribute('aria-disabled'),visible(e)])
    ]);
    const tracked='circle[id],button,img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"],[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]';
    const touches=node=>{const e=node?.nodeType===1?node:node?.parentElement;return !!(e?.closest?.(tracked)||e?.querySelector?.(tracked));};
    const state={revision:0,listeners:new Set(),signature:signature()};
    state.observer=new MutationObserver(records=>{
      if(records?.length&&!records.some(r=>touches(r.target)||[...(r.addedNodes||[]),...(r.removedNodes||[])].some(touches)))return;
      const next=signature();if(next===state.signature)return;state.signature=next;state.revision++;for(const fn of [...state.listeners])fn();
    });
    state.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','disabled','aria-disabled','aria-busy','style','hidden','aria-hidden','id','fill','cx','cy']});
    state.stop=()=>{state.observer.disconnect();for(const fn of [...state.listeners])fn(true);delete window.__ticketSeatChanges;};
    window.__ticketSeatChanges=state;
  }
  if(document.querySelector('img[alt="캡챠 이미지"]')) return {rows:[],message:'보안문자를 먼저 입력해 주세요.'};
  const circles=[...document.querySelectorAll('circle.js-seat[id]')];
  const rows=[];
  if(circles.length){
    const candidates=circles.filter(el=>!el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected')&&visible(el));
    rows.push(...candidates.map((el,i)=>({kind:'seat',id:el.id,label:`${el.parentElement.id.split(':').pop()}블럭 · 후보 ${i+1}`,available:true,group:el.parentElement.id,fill:el.getAttribute('fill'),cx:el.getAttribute('cx'),cy:el.getAttribute('cy')})));
  }
  rows.push(...[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(visible).map(el=>{
    const name=el.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim();
    const count=el.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim();
    return {kind:'grade',id:name,label:`${name} · ${count}석`,available:!!name&&(count==null||count===''||!Number.isFinite(Number(count.replaceAll(',','')))||Number(count.replaceAll(',',''))>0),name,count};
  }).filter(r=>r.name));
  return {revision:typeof window!=='undefined'?window.__ticketSeatChanges?.revision??null:null,rows,message:`현재 지도 후보 ${rows.filter(r=>r.kind==='seat').length}개 · 표시된 구역 ${rows.filter(r=>r.kind==='grade').length}개`};
},
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
"live.waitForChange":function waitForChange({revision,timeoutMs=3500}={}){
  const state=window.__ticketSeatChanges;
  if(!state||state.revision!==revision)return Promise.resolve({changed:true});
  const delay=Math.min(5000,Math.max(1,Number(timeoutMs)||3500));
  return new Promise(resolve=>{let timer;const done=stopped=>{clearTimeout(timer);state.listeners.delete(done);resolve({changed:state.revision!==revision,stopped:stopped===true,revision:state.revision});};state.listeners.add(done);timer=setTimeout(done,delay);if(state.revision!==revision)done();});
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
"observation.bookingObservation":function bookingObservation(){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>['string','number','boolean'].includes(typeof value?.[k])||value?.[k]===null).map(k=>[k,typeof value[k]==='string'?value[k].slice(0,500):value[k]]));
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  let initial={};try{initial=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent||'{}').props?.pageProps?.initData||{};}catch{}
  const goods=pick(initial.goods,['goodsCode','goodsName','placeCode','placeName','firstActivePlaySeq','reserved','reservedSeat','isInterlocking','miniMapYN','seatRenderType','rateName','checkCaptcha','ticketMaxCount']);
  const play=pick(initial.playSeq,['goodsCode','placeCode','playSeq','playDate','playTime','isSeatRemain','isRemainSeatVisible','bookWait','bookWaitStatus','cancelableDate','cancelableEndDate','bookingEndDate']);
  const grades=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(shown).map(e=>({name:e.querySelector('[class*="contentGradeName__"]')?.textContent?.trim()||'',count:Number(e.querySelector('[class*="contentRemainCount__"]')?.textContent?.replaceAll(',',''))}));
  const buttons=[...document.querySelectorAll('button')].filter(shown).map(e=>({label:(e.getAttribute('aria-label')||e.textContent.trim()).slice(0,500),className:String(e.className).slice(0,400),enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'}));
  const seats=[...document.querySelectorAll('circle.js-seat[id]')].slice(0,50000).map(e=>({id:e.id,blockKey:(e.parentElement.id||'').replace(/^seat_block_/,''),cx:e.getAttribute('cx'),cy:e.getAttribute('cy'),available:!e.getAttribute('class')?.includes('SeatMap_disabled'),selected:!!e.getAttribute('class')?.includes('SeatMap_selected'),visible:shown(e)}));
  const images=[...document.querySelectorAll('img')].map(e=>e.currentSrc||e.src).filter(url=>{try{const u=new URL(url);return u.origin==='https://ent-ticketimage.interparkcdn.net'&&/^\/(svg|display)\//.test(u.pathname)&&!u.search&&!u.hash;}catch{return false;}});
  return {schemaVersion:1,observedAt:new Date().toISOString(),page:location.origin+location.pathname,goods,play,initialGrades:(initial.playSeq?.seats||[]).slice(0,500).map(s=>pick(s,['seatGrade','seatGradeName','remainCount','seatExternalType'])),grades,buttons,seats,images:[...new Set(images)],note:'initialGrades는 초기 HTML 스냅샷, grades와 seats는 관찰 시점 DOM. 재고 보장 없음. 가격·회원정보·세션·보안문자는 기록하지 않음.'};
},
"directApi.bookingIdentity":function bookingIdentity(){
  try{return readBookingContext().identity;}
  catch(error){throw Error('현재 예매 세션과 화면의 경기 정보를 대조하지 못했습니다. '+error.message);}
},
"publicGame.resolveGame":async function resolveGame({key,keys,includeSchedule=false}){
  const match=location.pathname.match(/^\/ticket\/genre\/sports\/([a-z0-9-]+)$/);
  if(location.origin!=='https://nol.yanolja.com'||!match)throw Error('구단 또는 포스트시즌 경기 목록에서 시작해 주세요.');
  const batch=Array.isArray(keys),requested=batch?keys:[key];
  if(!requested.length||requested.length>100||new Set(requested).size!==requested.length||requested.some(k=>typeof k!=='string'||k.length>2000))throw Error('대상 경기 목록을 확인하지 못했습니다.');
  const elements=[...document.querySelectorAll('button.grid-area_cta')].map(b=>b.parentElement);
  const cards=requested.map(wanted=>{
    const found=elements.filter(card=>card.querySelector('.grid-area_info')?.textContent.trim()+' | '+[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt).join(' vs ')===wanted);
    if(found.length!==1)throw Error('대상 경기 카드가 한 개로 확인되지 않습니다.');
    const card=found[0],info=card.querySelector('.grid-area_info').textContent.trim(),date=info.match(/(\d{1,2})월\s*(\d{1,2})일/),time=info.match(/(\d{1,2}:\d{2})/),teams=[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt);
    if(!date||!time||![1,2].includes(teams.length)||teams.some(name=>!name.trim()))throw Error('경기 날짜·시각·주최 정보를 확인하지 못했습니다.');
    return {key:wanted,info,date,time,teams};
  });
  const base='/ticket/genre/sports/api/bff';
  const read=async url=>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('공개 경기 정보 조회에 실패했습니다.');return r.json();};
  const org=await read(base+'/sports/display/organizations/'+match[1]);
  const links=(org.widgets||[]).filter(w=>w.widgetType==='GOODS_RESERVATION').flatMap(w=>w.contents||[]).filter(c=>c.contentType==='GOODS_RESERVATION'&&c.link?.type==='API_URL').map(c=>c.link.url);
  if(links.length!==1||!/^\/sports\/goods\?/.test(links[0])||/[#\r\n]/.test(links[0]))throw Error('공식 경기 조회 경로를 확인하지 못했습니다.');
  const data=await read(base+links[0]),goods=[...(data.content||[])];
  // Follow only the public response's explicit pagination, with a bounded count.
  if(data.totalPages>1){
    if(!Number.isInteger(data.totalPages)||data.totalPages>10||data.pageNumber!==0)throw Error('공개 경기 목록 범위를 확인하지 못했습니다.');
    for(let page=1;page<data.totalPages;page++){const url=new URL(base+links[0],location.origin);url.searchParams.set('page',String(page));const next=await read(url.pathname+url.search);if(next.pageNumber!==page||!Array.isArray(next.content))throw Error('공개 경기 목록 페이지가 일치하지 않습니다.');goods.push(...next.content);}
  }
  const saleTime=value=>{
    const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;
    const [,y,mo,d,h,mi,se]=m.map(Number),utc=Date.UTC(y,mo-1,d,h,mi,se);
    if(new Date(utc).toISOString().slice(0,19)!==value)return null;
    return utc-9*3600000;
  };
  const results=cards.map(({key,info,date,time,teams})=>{
    const matches=goods.filter(g=>{const d=String(g.sport?.playDate||'').split('-'),organizations=[g.sport?.homeOrganization?.name,g.sport?.awayOrganization?.name].filter(name=>typeof name==='string'&&name.trim());return Number(d[1])===Number(date[1])&&Number(d[2])===Number(date[2])&&g.sport?.playTime===time[1]&&organizations.length===teams.length&&organizations.every((name,i)=>name===teams[i])&&typeof g.placeName==='string'&&info.includes(g.placeName);});
    if(matches.length!==1){if(batch)return {key,openAt:null,openingSource:null,openingReason:'공식 경기 응답과 카드가 유일하게 일치하지 않습니다.'};throw Error('공개 응답과 경기 카드가 일치하지 않아 진입을 중지했습니다.');}
    const g=matches[0];if(!/^\d{8}$/.test(g.goodsCode)||!/^\d{8}$/.test(g.placeCode))throw Error('상품·구장 코드 형식이 변경되었습니다.');
    const identity={goodsCode:g.goodsCode,placeCode:g.placeCode,playDate:g.sport.playDate.replaceAll('-',''),playTime:g.sport.playTime};
    if(!batch&&!includeSchedule)return identity;
    const openAt=saleTime(g.bookingOpenTime),endAt=saleTime(g.bookingEndTime);
    return {key,...identity,openAt,endAt,openingSource:openAt==null?null:'공식 경기 API',openingReason:openAt==null?'공식 응답에 유효한 일반 예매 시작 시각이 없습니다.':null};
  });
  return batch?results:results[0];
},
"seatDetails.readDetails":async function readDetails({expected,blockKeys=[],includeGrades=false,expiresAt}){
  const started=Date.now(),timings={metadataMs:0,gradesMs:0,totalMs:0};
  const keys=['goodsCode','placeCode','playSeq'];
  if(!expected||!keys.every(k=>typeof expected[k]==='string'&&/^\d{3,8}$/.test(expected[k]))||
    !Array.isArray(blockKeys)||blockKeys.length>2||new Set(blockKeys).size!==blockKeys.length||
    !Number.isFinite(expiresAt)||Date.now()>expiresAt)throw Error('상세 정보 요청 범위를 확인하지 못했습니다.');
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const readContext=()=>readBookingContext().context;
  const c=readContext();
  const matches=x=>x?.goods?.goodsCode===expected.goodsCode&&x?.goods?.placeCode===expected.placeCode&&x?.playSeq?.playSeq===expected.playSeq;
  let recovery=null;
  const validRecovery=(state,current)=>state&&window.__ticketHttpBooking===state&&state.stage==='rejected'&&state.status==='blocked'&&state.code==='HTTP_METADATA_CHANGED'
    &&state.mutationStarted===false&&Array.isArray(state.held)&&!state.held.length&&!state.pending&&!state.cancelled
    &&state.identity===[expected.goodsCode,expected.placeCode,expected.playSeq].join(':')&&state.context?.sessionId===current.sessionId
    &&Number.isFinite(state.expiresAt)&&Date.now()<=state.expiresAt
    &&state.expected===JSON.stringify([current.goods,current.playSeq,current.sessionId,current.channelType,current.bizCode,current.seats||[],current.prices||[]]);
  const check=()=>{
    const current=readContext();
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||new URL(location.href).searchParams.get('step')==='price'||
      !matches(current)||!c.sessionId||current.sessionId!==c.sessionId||Date.now()>expiresAt)throw Error('상세 정보를 읽는 동안 예매 화면 또는 세션이 바뀌었습니다.');
    if(recovery&&!validRecovery(recovery,current))throw Error('좌석 상세 변경을 재확인하는 동안 실행 상태가 바뀌었습니다.');
    if(c.goods.isInterlocking!==false||c.goods.reserved!==true)throw Error('확인된 일반 지정석만 상세 조회할 수 있습니다.');
    if([...document.querySelectorAll('img[alt="캡챠 이미지"],[role="alertdialog"],[role="dialog"][aria-modal="true"]')].some(shown)||
      [...document.querySelectorAll('button')].some(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기')||
      document.querySelector('circle.js-seat[class*="SeatMap_selected"]'))throw Error('안내·인증 또는 기존 선택을 먼저 확인해 주세요.');
    const expiry=Number(sessionStorage.getItem('interpark/preReserveExpireTime'));
    if(expiry>0&&Date.now()>=expiry)throw Error('좌석 선택 시간이 만료되었습니다.');
  };
  check();
  const observed=new Set([...document.querySelectorAll('circle.js-seat[id]')].map(e=>e.parentElement.id).filter(id=>id.startsWith('seat_block_')).map(id=>id.slice(11)));
  if(blockKeys.some(k=>typeof k!=='string'||k.length>100))throw Error('현재 지도에 없는 구역은 조회하지 않습니다.');
  if(blockKeys.some(k=>!observed.has(k))){
    // A cross-map candidate may have changed after its original map closed.
    // Only this document's rejected, mutation-free HTTP attempt authorizes
    // rereading its changed blocks; arbitrary off-map queries remain blocked.
    recovery=window.__ticketHttpBooking;
    const changed=new Set(Array.isArray(recovery?.changedIds)?recovery.changedIds:[]),seats=Array.isArray(recovery?.seats)?recovery.seats:[];
    const allowed=new Set(seats.filter(seat=>changed.has(seat.id)).map(seat=>seat.blockKey));
    if(!validRecovery(recovery,c)||blockKeys.some(k=>!observed.has(k)&&!allowed.has(k)))throw Error('현재 지도에 없는 구역은 조회하지 않습니다.');
  }
  const baseHeaders={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest','X-Onestop-Channel':c.channelType||'NOL','X-Onestop-Session':c.sessionId};
  const request=async(url,options)=>{
    check();const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),...options});
    if(!response.ok)throw Error('좌석 상세 정보 응답을 확인하지 못했습니다.');
    const text=await response.text();if(text.length>12000000)throw Error('좌석 상세 정보 응답이 너무 큽니다.');
    const data=JSON.parse(text);check();return data;
  };
  let blocks=[],grades=[],gradeConflicts=[],duplicateCount=0;
  const blockTask=(async()=>{if(blockKeys.length){
    const began=Date.now();
    const params=new URLSearchParams({...expected,bizCode:c.bizCode||'WEBBR'});for(const key of blockKeys)params.append('blockKeys',key);
    const data=await request('/onestop/api/seatMeta?'+params,{method:'GET',headers:baseHeaders});
    const raw=Array.isArray(data)?data:data?.data;
    if(!Array.isArray(raw)||raw.length!==blockKeys.length||new Set(raw.map(b=>b.blockKey)).size!==blockKeys.length)throw Error('좌석 상세 정보의 구역 목록이 다릅니다.');
    blocks=raw.map(b=>{
      if(!blockKeys.includes(b.blockKey)||!Array.isArray(b.seats)||b.seats.length>20000)throw Error('좌석 상세 정보 형식이 다릅니다.');
      return {blockKey:b.blockKey,seats:b.seats.map(s=>{
        if(typeof s.seatInfoId!=='string'||!s.seatInfoId.startsWith(expected.goodsCode+':'+expected.placeCode+':'))throw Error('다른 상품의 좌석 상세 정보입니다.');
        return Object.fromEntries(['seatInfoId','rowIdx','colIdx','rowNo','floor','seatNo','seatGrade','seatGradeName','isExposable','seatGroupId'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
      })};
    });
    timings.metadataMs=Date.now()-began;
  }})();
  const gradeTask=(async()=>{if(includeGrades){
    const began=Date.now();
    const headers={...baseHeaders,'X-Ticket-BFF-Language':({ko:'KO',en:'EN',ja:'JA',zh:'ZH'})[c.lang||'ko']||'KO'};
    if(c.goods.preOpt)headers.Authorization='Bearer '+c.goods.preOpt;
    const data=await request('/onestop/gql',{method:'POST',headers,body:JSON.stringify({operationName:'HelperSeatGradeNames',query:'query HelperSeatGradeNames($input: GetRemainSeatSortInput) { getSeatGradePrices(input: $input) { seatGrade seatGradeName } }',variables:{input:{sort:'SEAT_GRADE_ASC',playSeq:expected.playSeq}}})});
    if(data?.errors?.length||!Array.isArray(data?.data?.getSeatGradePrices))throw Error('좌석 등급 이름을 확인하지 못했습니다.');
    // Match the site's seat label resolver: GetSeatGradePrices is shared by
    // map views and sports group views. GetRemainSeats is enabled only for
    // sports-group products, so it cannot serve as a universal name lookup.
    // Grade-price rows have no booking identity fields. The session/round and
    // current document are pinned before and after this uncached query.
    // Price rows may repeat a grade. Harmless spacing variants are one label;
    // genuinely different labels stay unresolved instead of aborting all grades
    // or silently assigning the last label to every seat with that code.
    ({grades,gradeConflicts,duplicateCount}=resolveGradeNames(data.data.getSeatGradePrices));
    timings.gradesMs=Date.now()-began;
  }})();
  // Independent read-only requests, bounded to two. Join both before returning
  // even after one fails, so no late result leaks into a subsequent run.
  const results=await Promise.allSettled([blockTask,gradeTask]);
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  check();timings.totalMs=Date.now()-started;return {blocks,grades,gradeConflicts,duplicateCount,timings};
},
"pricePage.priceState":function priceState(){
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
},
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
"pricePage.bookingProgress":function bookingProgress(){
  const u=new URL(location.href),route=u.origin==='https://tickets.interpark.com'&&['/onestop/payment','/onestop/preorder'].includes(u.pathname);
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const dialogs=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  if(dialogs.length)return {ready:false,blocked:true,message:dialogs.map(e=>(e.querySelector('#dialogMessage')||e).textContent.trim()).join(' ').slice(0,500)};
  const busy=[...document.querySelectorAll('[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"],img[alt="캡챠 이미지"]')].some(shown);
  const content=[...document.querySelectorAll('h1,h2,h3,button,label')].filter(shown).some(e=>/결제|주문자|예매자|티켓\s*수령|배송/.test(e.textContent));
  const ready=route&&!busy&&content;
  if(ready&&window.__ticketBookingDispatch)window.__ticketBookingDispatch.completed=true;
  return {ready,route,busy};
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
"httpBooking.httpBookingAction":async function httpBookingAction(arg={}){
  const KEY='baseball/http-booking',CONTEXT='interpark/context';
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const context=()=>readBookingContext().context;
  const identity=c=>['goodsCode','placeCode'].map(k=>c.goods?.[k]).concat(c.playSeq?.playSeq).join(':');
  const fingerprint=c=>JSON.stringify([c.goods,c.playSeq,c.sessionId,c.channelType,c.bizCode,c.seats||[],c.prices||[]]);
  const receipt=s=>sessionStorage.setItem(KEY,JSON.stringify({runId:s.runId,identity:s.identity,sessionId:s.context.sessionId,contextSignature:s.expected,stage:s.stage,held:s.held.map(v=>v.seatInfoId),seatsSignature:JSON.stringify(s.held),pricesSignature:JSON.stringify(s.prices||[]),confirmed:s.confirmed===true,validated:s.validated===true,route:s.route||null,cancelled:s.cancelled===true,mutationStarted:s.mutationStarted,at:Date.now()}));
  const summary=s=>({stage:s.stage,status:s.status||'pending',code:s.code||null,httpStatus:s.httpStatus||null,apiCode:s.apiCode||null,heldCount:s.held.length,confirmed:s.confirmed===true,validated:s.validated===true,requestCount:s.requestCount,route:s.route||null,...(s.changedIds?{changedIds:s.changedIds}:{}),...(s.unavailableIds?{unavailableIds:s.unavailableIds}:{})});
  let s=window.__ticketHttpBooking;
  if(arg.action==='begin'){
    if(typeof arg.runId!=='string'||arg.runId.length>120||!Number.isFinite(arg.expiresAt)||Date.now()>arg.expiresAt)throw Error('HTTP_COMMAND_EXPIRED');
    if(s?.runId===arg.runId)return summary(s);
    let old;try{old=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{throw Error('HTTP_RECEIPT_UNREADABLE');}
    const c=context();
    const resumeSelected=arg.resumeSelected===true;
    const selectedReceipt=resumeSelected&&old?.stage==='selected'&&old.sessionId===c.sessionId&&old.seatsSignature===JSON.stringify(c.seats);
    // Only an explicit persisted proof that no mutation started permits a
    // cancelled read-only attempt to restart. Older/unknown receipts stay locked.
    const cancelledReadOnly=old?.cancelled===true&&old.mutationStarted===false&&Array.isArray(old.held)&&old.held.length===0&&old.confirmed===false&&old.validated===false&&['metadata','prices','status','preselect'].includes(old.stage);
    if(s?.pending||!selectedReceipt&&(s?.held?.length&&s.context.sessionId===c.sessionId||old&&old.sessionId===c.sessionId&&!cancelledReadOnly&&!['released','rejected'].includes(old.stage)))throw Error('HTTP_PREVIOUS_RESULT_PENDING');
    if(!arg.expected||identity(c)!==[arg.expected.goodsCode,arg.expected.placeCode,arg.expected.playSeq].join(':'))throw Error('HTTP_IDENTITY_CHANGED');
    if(c.goods?.isInterlocking!==false||c.goods?.reserved!==true||c.goods?.reservedSeat===false||c.nonReservedSeatGrade||c.channelType&&c.channelType!=='NOL'||c.partnerInfo&&Object.keys(c.partnerInfo).length||c.goods?.nonReservedGoodsCode)throw Error('HTTP_SEAT_SYSTEM_UNSUPPORTED');
    if((c.prices||[]).some(p=>p.selectedSeatCount>0))throw Error('HTTP_EXISTING_PRICE_SELECTION');
    const resume=arg.resumePrice===true;
    const seats=resume?(c.seats||[]).map(v=>({id:'seat_block_'+v.seatInfoId,blockKey:v.blockKey,gradeCode:v.seatGrade})):arg.seats;
    if(!Array.isArray(seats)||seats.length!==arg.quantity||seats.length<1||seats.length>4||new Set(seats.map(v=>v.id)).size!==seats.length)throw Error('HTTP_SEAT_COUNT_INVALID');
    if(Number.isFinite(Number(c.goods.ticketMaxCount))&&seats.length>Number(c.goods.ticketMaxCount))throw Error('HTTP_TICKET_LIMIT');
    if(!resume&&!resumeSelected&&(c.seats?.length||document.querySelector('circle.js-seat[class*="SeatMap_selected"]')))throw Error('HTTP_EXISTING_SELECTION');
    if(resume&&new URL(location.href).searchParams.get('step')!=='price')throw Error('HTTP_PRICE_PAGE_REQUIRED');
    for(const v of seats)if(typeof v.id!=='string'||!v.id.startsWith('seat_block_'+c.goods.goodsCode+':'+c.goods.placeCode+':')||typeof v.blockKey!=='string'||!/^\d+$/.test(String(v.gradeCode)))throw Error('HTTP_SEAT_CODE_INVALID');
    if(resumeSelected&&(!Array.isArray(c.seats)||c.seats.length!==seats.length||c.seats.some(v=>!seats.some(w=>w.id==='seat_block_'+v.seatInfoId&&String(w.gradeCode)===String(v.seatGrade)))))throw Error('HTTP_EXISTING_SELECTION_MISMATCH');
    s={runId:arg.runId,identity:identity(c),context:c,expected:fingerprint(c),expiresAt:arg.expiresAt,seats,blocks:[...new Set(seats.map(v=>v.blockKey))],metadataOrder:{},records:[],held:resume||resumeSelected?[...c.seats]:[],resume,resumeSelected,stopAfterSeats:arg.stopAfterSeats===true,confirmed:resume,stage:resume?'prices':'metadata',requestCount:0,cancelled:false,mutationStarted:resume||resumeSelected};
    window.__ticketHttpBooking=s;receipt(s);return summary(s);
  }
  if(!s||s.runId!==arg.runId)throw Error('HTTP_RUN_MISMATCH');
  if(arg.action==='status')return summary(s);
  if(arg.action==='cancel'){s.cancelled=true;if(!s.pending&&s.mutationStarted===false&&!s.held.length){s.stage='rejected';s.status='blocked';s.code='HTTP_CANCELLED';}receipt(s);return summary(s);}
  if(arg.action!=='step')throw Error('HTTP_ACTION_UNSUPPORTED');
  if(s.pending)return summary(s);
  if(s.status||['ready','selected'].includes(s.stage))return summary(s);
  const check=(cleanup=false)=>{
    const c=context();
    if(identity(c)!==s.identity||fingerprint(c)!==s.expected)throw Error('HTTP_CONTEXT_CHANGED');
    if(!cleanup&&(s.cancelled||Date.now()>s.expiresAt))throw Error('HTTP_CANCELLED');
    const sessionExpiry=Number(sessionStorage.getItem('interpark/bsRef'));
    const seatExpiry=Number(sessionStorage.getItem(s.confirmed?'interpark/reserveExpireTime':'interpark/preReserveExpireTime'));
    if(sessionExpiry>0&&Date.now()>=sessionExpiry||seatExpiry>0&&Date.now()>=seatExpiry)throw Error('HTTP_SESSION_EXPIRED');
    if(!cleanup){
      if([...document.querySelectorAll('img[alt="캡챠 이미지"],[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"]')].some(shown)||[...document.querySelectorAll('button')].some(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기'))throw Error('HTTP_PAGE_BLOCKED');
      if(c.goods?.checkCaptcha===true&&!sessionStorage.getItem('interpark/captchaVerify'))throw Error('HTTP_CAPTCHA_REQUIRED');
    }
    return c;
  };
  const saveSeats=()=>{const c=check(true);c.seats=[...s.held];sessionStorage.setItem(CONTEXT,JSON.stringify(c));s.expected=fingerprint(c);if(fingerprint(context())!==s.expected)throw Error('HTTP_STORAGE_WRITE_FAILED');};
  const gql=(operation,field,type,command)=>({operationName:operation,query:`mutation ${operation}($command: ${type}!) { ${field}(command: $command) }`,variables:{command}});
  const request=async(url,body,{field,cleanup=false,mutation=false}={})=>{
    const c=check(cleanup),headers={'Content-Type':'application/json','X-Onestop-Channel':c.channelType||'NOL','X-Onestop-Session':c.sessionId,'X-Ticket-BFF-Language':({ko:'KO',en:'EN',ja:'JA',zh:'ZH'})[c.lang||'ko']||'KO','X-OneStop-Trace-ID':crypto.randomUUID().replaceAll('-','').slice(0,16)};
    if(url==='/onestop/gql'&&c.goods.preOpt)headers.Authorization='Bearer '+c.goods.preOpt;else headers['X-Requested-With']='XMLHttpRequest';
    s.requestCount++;s.inFlightMutation=mutation;if(mutation)s.mutationStarted=true;s.httpStatus=null;s.apiCode=null;receipt(s);
    let response,data;
    try{response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7500)});const text=await response.text();if(text.length>12000000)throw Error();data=JSON.parse(text);}catch{throw Error(mutation?'HTTP_OUTCOME_UNKNOWN':'HTTP_READ_FAILED');}
    s.httpStatus=response.status;
    const codes=[...(data?.errors||[]).map(e=>e?.extensions?.backendErrorCode),data?.backendErrorCode,data?.data?.backendErrorCode,data?.data?.data?.backendErrorCode,data?.properties?.backendErrorCode].filter(Boolean);
    s.apiCode=codes.filter(v=>typeof v==='string'&&/^[A-Z]\d{4,8}$/.test(v)).slice(0,3).join(',')||null;
    // A rejection is recoverable only when every reported error is a known
    // seat conflict. Mixed errors, HTTP failures and unknown shapes stop.
    const known=new Set(['P40054','P41150','P41149','P40021']);
    if(response.status<500&&!cleanup&&mutation&&codes.length&&codes.every(v=>known.has(v))&&(!data.errors||data.errors.every(e=>known.has(e?.extensions?.backendErrorCode))))return {conflict:true};
    if(!response.ok||codes.length||data?.errors?.length||data?.success===false||field&&data?.data?.[field]!==true)throw Error(mutation?'HTTP_OUTCOME_UNKNOWN':'HTTP_RESPONSE_REJECTED');
    return {data};
  };
  s.pending=true;
  try{
    check(s.stage==='release');
    if(s.stage==='metadata'){
      const blocks=s.blocks.splice(0,2),c=s.context,params=new URLSearchParams({goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'WEBBR'});blocks.forEach(k=>params.append('blockKeys',k));
      const {data}=await request('/onestop/api/seatMeta?'+params);check();const list=Array.isArray(data)?data:data?.data;
      if(!Array.isArray(list)||list.length!==blocks.length||new Set(list.map(b=>b.blockKey)).size!==blocks.length)throw Error('HTTP_METADATA_MISMATCH');
      for(const blockKey of blocks){const block=list.find(v=>v.blockKey===blockKey);if(!Array.isArray(block?.seats)||!block.seats.length||block.seats.some(v=>typeof v?.seatInfoId!=='string')||new Set(block.seats.map(v=>v.seatInfoId)).size!==block.seats.length)throw Error('HTTP_METADATA_MISMATCH');s.metadataOrder[blockKey]=block.seats.map(v=>v.seatInfoId);}
      for(const wanted of s.seats.filter(v=>blocks.includes(v.blockKey))){
        const block=list.find(v=>v.blockKey===wanted.blockKey),found=block?.seats?.filter(v=>v.seatInfoId===wanted.id.slice(11));
        if(found?.length!==1){s.changedIds=[wanted.id];throw Error('HTTP_METADATA_CHANGED');}const v=found[0];
        // The observed wheelchair map uses block / Wn-1 labels and a group
        // containing exactly one seat. Recheck the complete returned metadata;
        // neither a cached flag nor the group ID suffix alone authorizes it.
        const blockLabel=wanted.blockKey.split(':').pop();
        const singleton=s.seats.length===1&&wanted.singletonGroup===true&&wanted.labelFormat==='wheelchair-block'&&wanted.groupSize===1&&wanted.grouped===true&&wanted.exposable===true
          &&typeof v.seatGradeName==='string'&&/휠체어|장애인/.test(v.seatGradeName)&&/^\d+$/.test(blockLabel)&&wanted.block===blockLabel
          &&wanted.rawRowLabel===v.rowNo&&v.rowNo===blockLabel+'블록'&&wanted.rawSeatNumber===v.seatNo&&typeof v.seatNo==='string'&&v.seatNo.length<=80&&/^W[1-9]\d*-1$/.test(v.seatNo)
          &&wanted.row===null&&wanted.number===null&&wanted.seatGroupId===v.seatGroupId&&v.seatGroupId===v.seatInfoId+'::1::1'
          &&Number.isSafeInteger(v.rowIdx)&&v.rowIdx>=0&&Number.isSafeInteger(v.colIdx)&&v.colIdx>=0
          &&list.flatMap(b=>Array.isArray(b?.seats)?b.seats:[]).filter(member=>member?.seatGroupId===v.seatGroupId).length===1;
        const labels=parseSeatLabels(v.rowNo,v.seatNo),sameLabels=Number.isSafeInteger(labels.row)&&Number.isSafeInteger(labels.number)&&labels.row===wanted.row&&labels.rowLabel===wanted.rowLabel&&labels.rowKind===wanted.rowKind&&labels.number===wanted.number;
        // A per-seat name overrides a shared grade-code label. Preserve the
        // established missing-name fallback, but re-rank a changed explicit
        // name so restricted/obstructed and area filters run on fresh metadata.
        const gradeKey=value=>typeof value==='string'?value.normalize('NFKC').replace(/\s+/g,'').toLowerCase():null;
        const nameChanged=v.seatGradeName!=null&&v.seatGradeName!==''&&(!gradeKey(v.seatGradeName)||gradeKey(v.seatGradeName)!==gradeKey(wanted.grade));
        if(String(v.seatGrade)!==String(wanted.gradeCode)||v.isExposable!==true||v.rowIdx!==wanted.rowIdx||v.colIdx!==wanted.colIdx
          ||nameChanged||(v.seatGroupId!=null?!singleton:wanted.singletonGroup===true||!sameLabels)){s.changedIds=[wanted.id];throw Error('HTTP_METADATA_CHANGED');}
        const fields=['seatInfoId','seatGrade','seatGradeName','salesPrice','floor','rowNo','seatNo','posLeft','posTop','isExposable','rowIdx','colIdx','seatGroupId'];
        s.records.push({...Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])),blockKey:wanted.blockKey,seatGrade:String(v.seatGrade),seatGradeName:v.seatGradeName||wanted.grade,isSelectable:true});
      }
      if(!s.blocks.length)s.stage=s.resumeSelected?'prices':s.stopAfterSeats?'status':'prices';
    }else if(s.stage==='prices'){
      const c=s.context,params=new URLSearchParams({placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'',entMemberCode:c.entMemberCode||'',seatType:c.goods.kindOfGoods==='01007'&&c.goods.isSportsGroup?'SPORTS':'DEFAULT',seatGrade:s.seats.map(v=>v.gradeCode).join(',')});
      const {data}=await request('/onestop/api/prices/'+c.goods.goodsCode+'?'+params);check();s.prices=planAdultPrices(data,s.resume?s.held:s.records);s.stage=s.resume?'validate':s.resumeSelected?'confirm':'status';
    }else if(s.stage==='status'){
      // The native client indexes MSB-first hex status bits by the complete,
      // unfiltered seatMeta order. This also validates seats outside the viewport.
      const remaining=s.records.filter(v=>!s.held.some(h=>h.seatInfoId===v.seatInfoId)),blocks=[...new Set(remaining.map(v=>v.blockKey))],c=s.context;
      const params=new URLSearchParams({goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'WEBBR'});blocks.forEach(k=>params.append('blockKeys',k));
      const {data}=await request('/onestop/api/seatStatus?'+params);check();
      if(!Array.isArray(data?.data)||data.data.length!==blocks.length)throw Error('HTTP_SEAT_STATUS_INVALID');
      const unavailable=[];
      for(let i=0;i<blocks.length;i++){
        const blockKey=blocks[i],ids=s.metadataOrder[blockKey],hex=data.data[i];
        if(!Array.isArray(ids)||typeof hex!=='string'||!/^[0-9a-f]+$/i.test(hex)||hex.length!==Math.ceil(ids.length/4))throw Error('HTTP_SEAT_STATUS_INVALID');
        const bits=[...hex].map(v=>parseInt(v,16).toString(2).padStart(4,'0')).join('');
        for(const v of remaining.filter(v=>v.blockKey===blockKey)){const index=ids.indexOf(v.seatInfoId);if(index<0)throw Error('HTTP_SEAT_STATUS_INVALID');if(bits[index]!=='1')unavailable.push('seat_block_'+v.seatInfoId);}
      }
      if(unavailable.length){s.unavailableIds=unavailable;s.code='HTTP_SEAT_CHANGED';s.stage='release';}
      else{s.statusCheckedAt=Date.now();s.stage='preselect';}
    }else if(s.stage==='preselect'){
      const v=s.records[s.held.length],el=document.getElementById('seat_block_'+v.seatInfoId);
      if(!Number.isFinite(s.statusCheckedAt)||Date.now()-s.statusCheckedAt>20000)s.stage='status';
      else if(el&&(!el.matches('circle.js-seat[id]')||el.parentElement?.id!=='seat_block_'+v.blockKey||/SeatMap_(?:disabled|selected)/.test(el.getAttribute('class')||''))){s.stage='release';s.code='HTTP_SEAT_CHANGED';s.unavailableIds=['seat_block_'+v.seatInfoId];}
      else{
        const grouped=v.seatGroupId!=null,field=grouped?'bulkPreselectSeats':'preselectSeat';
        const r=await request('/onestop/gql',gql(grouped?'BulkPreselectSeats':'PreselectSeat',field,grouped?'BulkPreselectSeatsCommand':'PreselectSeatCommand',{playSeq:s.context.playSeq.playSeq,blockKey:v.blockKey,seatGrade:v.seatGrade,...(grouped?{seatInfoIds:[v.seatInfoId]}:{seatInfoId:v.seatInfoId})}),{field,mutation:true});
        if(r.conflict){s.stage='release';s.code='HTTP_SEAT_CONFLICT';}
        else{s.held.push(v);check(true);saveSeats();if(s.held.length===1)sessionStorage.setItem('interpark/preReserveExpireTime',String(Date.now()+420000));check();if(s.held.length===s.records.length)s.stage=s.stopAfterSeats?'selected':'confirm';}
      }
    }else if(s.stage==='confirm'){
      const c=s.context,r=await request('/onestop/api/seats/select',{goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,seatType:c.goods.kindOfGoods==='01007'&&c.goods.isSportsGroup?'SPORTS':'DEFAULT',sessionId:c.sessionId,seats:s.held.map(v=>({seatGrade:v.seatGrade,seatInfoId:v.seatInfoId})),autoAssign:false},{mutation:true});
      if(r.conflict){s.stage='release';s.code='HTTP_CONFIRM_CONFLICT';}
      else{if(!Array.isArray(r.data?.unselectableSeatInfoIds)||r.data.unselectableSeatInfoIds.length)throw Error('HTTP_CONFIRMATION_UNKNOWN');s.confirmed=true;check(true);sessionStorage.setItem('interpark/reserveExpireTime',String(Date.now()+420000));check();s.stage='validate';}
    }else if(s.stage==='validate'){
      const c=s.context;await request('/onestop/gql',{operationName:'ValidatePricingSelection',query:'query ValidatePricingSelection($playSeq: String!, $upperBizCode: String, $selectedPrices: [PricingSelectionItemInput!]!) { validatePricingSelection(playSeq: $playSeq, upperBizCode: $upperBizCode, selectedPrices: $selectedPrices) }',variables:{playSeq:c.playSeq.playSeq,upperBizCode:c.goods.upperBizCode,selectedPrices:s.prices.map(v=>({seatGrade:v.pgPrice.seatGrade,priceGrade:v.pgPrice.priceGrade,selectCnt:v.selectedSeatCount}))}},{field:'validatePricingSelection'});
      check();s.validated=true;const current=context();current.prices=s.prices;sessionStorage.setItem(CONTEXT,JSON.stringify(current));s.expected=fingerprint(current);if(fingerprint(context())!==s.expected)throw Error('HTTP_STORAGE_WRITE_FAILED');
      const discount=s.prices.some(v=>Number(v.pgPrice.discountSeq||0)>0&&!['PG003'].includes(v.pgPrice.pgCode)&&v.pgPrice.kindOfDiscount!=='34020'&&!(v.pgPrice.pgCode==='PG001'&&v.pgPrice.kindOfDiscount==='34004'));
      s.route=['26003282','26003294'].includes(c.goods.goodsCode)||c.goods.isPreOrder&&!discount?'/preorder':'/payment';s.stage='ready';
    }else if(s.stage==='release'){
      if(s.held.length){const v=s.held.at(-1),grouped=v.seatGroupId!=null,field=grouped?'bulkDeselectSeats':'deselectSeat';await request('/onestop/gql',gql(grouped?'BulkDeselectSeats':'DeselectSeat',field,grouped?'BulkDeselectSeatsCommand':'DeselectSeatCommand',grouped?{seatInfoIds:[v.seatInfoId]}:{seatInfoId:v.seatInfoId}),{field,cleanup:true,mutation:true});check(true);s.held.pop();saveSeats();}
      if(!s.held.length){sessionStorage.removeItem('interpark/preReserveExpireTime');s.stage='released';s.status='conflict';}
    }else throw Error('HTTP_STAGE_INVALID');
    receipt(s);
  }catch(error){s.status=s.inFlightMutation||s.held.length?'uncertain':'blocked';s.code=/^[A-Z_]+$/.test(error.message)?error.message:'HTTP_UNEXPECTED_ERROR';if(s.status==='blocked')s.stage='rejected';receipt(s);}
  finally{s.pending=false;s.inFlightMutation=false;}
  return summary(s);
},
"page.stopWatchers":function stopWatchers(){if(window.__ticketDirectApi)window.__ticketDirectApi.cancelled=true;if(window.__ticketHttpBooking){window.__ticketHttpBooking.cancelled=true;try{const r=JSON.parse(sessionStorage.getItem("baseball/http-booking")||"null");if(r){r.cancelled=true;sessionStorage.setItem("baseball/http-booking",JSON.stringify(r));}}catch{}}window.__ticketSeatChanges?.stop();window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();return true;},
"page.pageClock":function pageClock({entryStage='gate'}={}){return {pageMono:performance.now(),documentId:(entryStage==='listing'?window.__bearsEntry:window.__bearsGate)?.status.documentId};},
"page.gateSnapshot":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAll":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);siteInvoke(b);});},
"page.gateState":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAllGames":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);siteInvoke(b);});},
});})();
