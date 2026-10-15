'use strict';
globalThis.BaseballActions=Object.freeze({
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
  button.click();return status;
},
"entry.gateStatus":function gateStatus({goodsCode}={}) {
  const match=location.origin==='https://tickets.interpark.com'&&location.pathname.match(/^\/gates\/ticket\/(\d{8})$/);
  const status={supported:!!match,goodsCode:match?match[1]:null,prepared:false,enabled:false,buttonText:null};
  if(!match||goodsCode&&String(goodsCode)!==match[1])return {...status,reason:'대상 경기의 준비 화면이 아닙니다.'};
  const root=document.querySelector('main');
  status.prepared=!!root&&root.textContent.replace(/\s/g,'').includes('예매준비가완료됐어요');
  const visible=e=>{const r=e.getBoundingClientRect();const css=getComputedStyle(e);return r.width>0&&r.height>0&&css.visibility!=='hidden'&&css.display!=='none';};
  const notices=[...document.querySelectorAll('button')].filter(b=>visible(b)&&String(b.textContent||'').trim()==='확인하고 예매하기');
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
},
"entry.armGate":function armGate({goodsCode,runId=null,timeoutMs=15*86400000}={}) {
  // Kept self-contained for execution in the isolated browser world.
  const match=location.origin==='https://tickets.interpark.com'&&location.pathname.match(/^\/gates\/ticket\/(\d{8})$/);
  if(!match||!goodsCode||String(goodsCode)!==match[1])throw new Error('대상 경기의 준비 화면을 확인하지 못했습니다.');
  const prior=window.__bearsGate;
  if(prior?.status?.goodsCode===String(goodsCode)&&prior.status.runId===runId&&['armed','clicked','request-observed'].includes(prior.status.phase))return prior.status;
  prior?.stop();
  const startPath=location.pathname,started=performance.now();
  const status={phase:'armed',documentId:String(performance.timeOrigin)+':'+started,goodsCode:String(goodsCode),runId,clickedAt:null,trigger:null,observedDisabled:false,clock:{outcome:'not-configured'},reason:'사이트의 예매 버튼 활성화를 기다립니다.'};
  let observer,timer,clockTimer,done=false;
  const stop=()=>{done=true;clearTimeout(timer);clearTimeout(clockTimer);observer?.disconnect();if(status.phase==='armed')status.phase='stopped';};
  const visible=e=>{const r=e.getBoundingClientRect();const css=getComputedStyle(e);return r.width>0&&r.height>0&&css.visibility!=='hidden'&&css.display!=='none';};
  const tick=(source='activation')=>{
    if(done)return;clearTimeout(timer);
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!==startPath){status.phase='navigated';stop();return;}
    if(performance.now()-started>timeoutMs){status.phase='timeout';stop();return;}
    const root=document.querySelector('main');
    const prepared=!!root&&root.textContent.replace(/\s/g,'').includes('예매준비가완료됐어요');
    const buttons=root?[...root.querySelectorAll('button')].filter(b=>visible(b)&&b.textContent.trim()!=='확인하고 예매하기'&&/(?:예매하기$|^남은시간\s*\d{1,2}:\d{2}$)/.test(b.textContent.trim())):[];
    const notice=[...document.querySelectorAll('button')].some(b=>visible(b)&&String(b.textContent||'').trim()==='확인하고 예매하기');
    const blocked=notice||[...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"]')].some(visible);
    const button=prepared&&buttons.length===1?buttons[0]:null;
    if(button&&!blocked&&(button.disabled||button.getAttribute('aria-disabled')==='true'))status.observedDisabled=true;
    if(button&&!blocked&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&button.textContent.trim()==='예매하기'&&status.observedDisabled){
      // Both triggers acquire this latch synchronously, before dispatching.
      // A delivered DOM click is not evidence of an accepted server request.
      status.phase='clicked';status.trigger=source==='server-clock'?'server-clock':'activation';status.clickedAt=Date.now();status.clickedMono=performance.now();if(status.trigger==='server-clock')status.clock.outcome='clicked';status.reason='사이트가 활성화한 예매 버튼에 클릭을 한 번 전달했습니다.';stop();button.click();return;
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
      if(now<deadlineMono){clockTimer=setTimeout(fire,Math.ceil(deadlineMono-now));return;}
      status.clock.firedAtMono=now;status.clock.delayMs=now-deadlineMono;
      if(document.hidden){status.clock.outcome='not-ready';status.reason='시각 도달 · 준비 화면이 숨겨져 정상 활성화 감지를 유지합니다.';return;}
      status.clock.outcome='not-ready';tick('server-clock');
    };
    fire();return true;
  };
  window.__bearsGate={status,stop,setClock,requestObserved(){if(done)return;status.phase='request-observed';status.reason='사이트의 진입 요청을 관찰했습니다.';stop();}};tick();return status;
},
"entry.setGateClock":function setGateClock(config){return window.__bearsGate?.setClock?.(config)||false;},
"entry.noteGateRequest":function noteGateRequest({runId}={}){const gate=window.__bearsGate;if(gate?.status.runId!==runId)return null;gate.requestObserved?.();return gate.status;},
"live.liveRead":function liveRead() {
  const visible = el => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&s.visibility==='visible'&&s.display!=='none';};
  if(document.querySelector('img[alt="캡챠 이미지"]')) return {rows:[],message:'보안문자를 먼저 입력해 주세요.'};
  const circles=[...document.querySelectorAll('circle.js-seat[id]')];
  if(circles.length){
    const candidates=circles.filter(el=>!el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected')&&visible(el));
    const rows=candidates.map((el,i)=>({kind:'seat',id:el.id,label:`${el.parentElement.id.split(':').pop()}블럭 · 후보 ${i+1}`,available:true,group:el.parentElement.id,fill:el.getAttribute('fill'),cx:el.getAttribute('cx'),cy:el.getAttribute('cy')}));
    return {rows,message:`현재 보이는 지도에서 ${candidates.length}개 후보 · 열·번호·시야방해 정보가 연결된 좌석만 자동 추천`};
  }
  const rows=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].map(el=>{
    const name=el.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim();
    const count=el.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim();
    return {kind:'grade',id:name,label:`${name} · ${count}석`,available:!!name&&Number(count?.replaceAll(',',''))>0,name,count};
  }).filter(r=>r.available);
  return {rows,message:rows.length?'사이트에 표시된 구역별 잔여석 · 구역을 연 뒤 직접 좌석 선택으로 진입하세요.':'구역 또는 직접 좌석 선택 화면을 열어 주세요. 화면 구조가 변경된 경우 연동 확인이 필요합니다.'};
},
"live.liveAction":function liveAction({row,action}) {
  if(!['focus','click'].includes(action)) throw new Error('지원하지 않는 동작입니다.');
  let el;
  if(row.kind==='grade') {
    const matches=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(e=>e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim()===row.name);
    if(matches.length!==1) throw new Error('구역 목록이 변경되었습니다. 다시 확인해 주세요.');
    el=matches[0];
    if(el.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim()!==row.count) throw new Error('잔여석 수가 변경되었습니다. 다시 확인해 주세요.');
    el.scrollIntoView({block:'center'});el.focus();if(action==='click')el.click();return true;
  }
  el=document.getElementById(row.id);
  if(el?.matches('circle.js-seat[id]')&&el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected'))throw new Error('SEAT_UNAVAILABLE: 사이트에서 해당 좌석이 선택 불가 상태로 바뀌었습니다.');
  if(!el||!el.matches('circle.js-seat[id]')||el.parentElement.id!==row.group||el.getAttribute('fill')!==row.fill||el.getAttribute('cx')!==row.cx||el.getAttribute('cy')!==row.cy||el.getAttribute('class').includes('SeatMap_disabled')||el.getAttribute('class').includes('SeatMap_selected')) throw new Error('좌석 상태가 변경되었습니다. 다시 확인해 주세요.');
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  if(r.width<=0||r.height<=0||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)throw new Error('지도가 이동했습니다. 현재 화면의 좌석을 다시 확인해 주세요.');
  const hit=document.elementFromPoint(x,y);
  if(hit!==el&&hit!==el.previousElementSibling)throw new Error('좌석 위에 다른 화면이 열려 있습니다. 닫은 뒤 다시 시도해 주세요.');
  if(action==='focus') {el.animate([{strokeWidth:'1',stroke:'#ff2670'},{strokeWidth:'5',stroke:'#ff2670'},{strokeWidth:'1',stroke:'#ff2670'}],{duration:1200,iterations:2});return true;}
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,buttons:1,isPrimary:true}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,buttons:0,isPrimary:true}));
  return true;
},
"flow.scene":function scene(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const buttons=[...document.querySelectorAll('button')].filter(shown).map(e=>({label:e.textContent.trim()||e.getAttribute('aria-label')||'',enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'}));
  const selected=[...document.querySelectorAll('circle.js-seat[id][class*="SeatMap_selected"]')].map(e=>e.id);
  const grades=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].map(e=>({name:e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent.trim(),count:Number(e.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent.replaceAll(',',''))})).filter(s=>s.name);
  const modals=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  let dialog=null;
  if(modals.length){
    const modal=modals[modals.length-1],text=(modal.querySelector('#dialogMessage')||modal).textContent.replace(/\s+/g,' ').trim().slice(0,700);
    const confirm=[...modal.querySelectorAll('button')].filter(e=>shown(e)&&!e.disabled&&e.textContent.trim()==='확인');
    const conflict=/(?:이미\s*(?:선택|선점|판매|예매)(?:된|한|되어|되었습니다|되었습니다)|다른\s*(?:고객|사용자|사람)(?:님)?(?:이|가|에 의해)\s*(?:먼저\s*)?(?:선택|선점))/.test(text)&&/좌석/.test(text)&&!/(?:결제|취소하시|동의)/.test(text);
    dialog={kind:modals.length===1&&conflict?'conflict':'unknown',text,dismissible:confirm.length===1&&modal.querySelectorAll('button').length===1};
  }
  const u=new URL(location.href);
  const completed=(u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price')||(['file:','chrome-extension:'].includes(u.protocol)&&u.pathname.endsWith('/demo.html')&&document.body.dataset.completed==='true');
  const busy=[...document.querySelectorAll('[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]')].some(shown);
  const notices=[...document.querySelectorAll('button')].filter(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기');
  let noticeKey=null,container=notices.length===1?notices[0].parentElement:null;
  while(container&&container!==document.body){
    const headings=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"]')].filter(shown).map(e=>e.textContent.replace(/\s/g,''));
    noticeKey=headings.find(text=>['예매안내','취소/환불안내'].includes(text))||null;
    if(noticeKey)break;
    container=container.parentElement;
  }
  return {completed,busy,dialog,notice:{present:notices.length>0,enabled:notices.length===1&&!notices[0].disabled&&notices[0].getAttribute('aria-disabled')!=='true',key:noticeKey},captcha:[...document.querySelectorAll('img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img')].some(shown),buttons,selected,grades,hasSeats:!!document.querySelector('circle.js-seat[id]'),selectedGrades:[...document.querySelectorAll('[class*="InfoSelected_contentSeatGrade__"]')].map(e=>e.textContent.trim()),selectedNames:[...document.querySelectorAll('[class*="InfoSelected_contentSeatName__"]')].map(e=>e.textContent.trim())};
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
      key=[...container.querySelectorAll('h1,h2,h3,[role="heading"],[class*="title"],[class*="Title"]')].filter(shown).map(e=>e.textContent.replace(/\s/g,'')).find(text=>['예매안내','취소/환불안내'].includes(text))||null;
      if(key)break;
      container=container.parentElement;
    }
    if(!container||container===document.body)throw Error('예매·취소/환불 안내 제목을 확인하지 못했습니다. 직접 확인해 주세요.');
    const text=container.textContent.replace(/\s+/g,' ').trim();
    const protectedText=/(?:로그인|세션|인증).{0,20}(?:만료|실패)|본인\s*인증|보안\s*문자|약관|개인정보.{0,15}동의|결제.{0,15}(?:확인|진행)|구매.{0,15}확정/.test(text);
    const inputs=[...container.querySelectorAll('input,select,textarea,[role="checkbox"]')].some(shown);
    const otherModal=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].some(e=>shown(e)&&e!==container&&!e.contains(button));
    if(protectedText||inputs||otherModal)throw Error('인증·동의 또는 다른 안내가 함께 표시되어 자동으로 확인하지 않습니다.');
    const clickedKeys=window.__bearsBookingNotice?.clickedKeys||[];
    if(clickedKeys.includes(key))return {present:true,clicked:false,pending:true,key};
    // Latch each recognized notice before invoking site code. DOM replacement
    // cannot repeat it, while a different notice in this document can continue.
    window.__bearsBookingNotice={clicked:true,clickedAt:Date.now(),clickedKeys:[...clickedKeys,key]};
    button.click();return {present:true,clicked:true,key};
  }
  const matches=[...document.querySelectorAll('button')].filter(e=>(e.textContent.trim()||e.getAttribute('aria-label'))===label&&e.getBoundingClientRect().width>0&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(matches.length!==1)throw new Error('다음 단계 버튼을 찾을 수 없습니다.');
  matches[0].click();return true;
},
"flow.enterCode":function enterCode(code){
  if(!/^[A-Z]{6}$/.test(code))throw new Error('보안문자 6자리를 입력해 주세요.');
  const image=document.querySelector('img[alt="캡챠 이미지"]');
  if(!image||!image.getBoundingClientRect().width)throw new Error('보안문자 입력 화면이 아닙니다.');
  let container=image.parentElement;
  while(container&&container!==document.body&&!container.querySelector('input'))container=container.parentElement;
  const inputs=container?[...container.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0):[];
  if(inputs.length!==1)throw new Error('보안문자 입력칸을 확인할 수 없습니다.');
  const input=inputs[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,code);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{observer.disconnect();reject(Error('입력완료 버튼이 활성화되지 않았습니다.'));},1500);const check=()=>{const btn=[...container.querySelectorAll('button')].find(e=>e.textContent.trim()==='입력완료'&&!e.disabled);if(btn){clearTimeout(timeout);observer.disconnect();btn.click();resolve(true);}};const observer=new MutationObserver(check);observer.observe(container,{subtree:true,childList:true,attributes:true});check();});
},
"flow.deselect":function deselect(id){const el=document.getElementById(id);if(!el?.matches('circle.js-seat[id][class*="SeatMap_selected"]'))return false;const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:0,isPrimary:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));return true;},
"flow.dismissConflict":function dismissConflict(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const modals=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  if(modals.length!==1)throw Error('좌석 선점 실패 안내를 확인할 수 없습니다.');
  const modal=modals[0],text=(modal.querySelector('#dialogMessage')||modal).textContent.replace(/\s+/g,' ').trim();
  if(!/(?:이미\s*(?:선택|선점|판매|예매)(?:된|한|되어|되었습니다|되었습니다)|다른\s*(?:고객|사용자|사람)(?:님)?(?:이|가|에 의해)\s*(?:먼저\s*)?(?:선택|선점))/.test(text)||!/좌석/.test(text)||/(?:결제|취소하시|동의)/.test(text))throw Error('알 수 없는 안내는 자동으로 닫지 않습니다.');
  const buttons=[...modal.querySelectorAll('button')];
  if(buttons.length!==1||buttons[0].textContent.trim()!=='확인'||buttons[0].disabled||!shown(buttons[0]))throw Error('선점 실패 확인 버튼을 찾을 수 없습니다.');
  buttons[0].click();return true;
},
"captcha.captchaSnapshot":function captchaSnapshot(){
  if(!window.__bearsCaptchaPage){
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
      if(input.disabled||input.readOnly)return {result:fail('unsupported','보안문자 입력칸이 비활성 상태입니다.')};
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
      let data;try{data=readImage(found.image);}catch{return fail('unsupported','브라우저에서 이 보안문자 이미지를 읽을 수 없습니다. 직접 입력해 주세요.');}
      let current=state.current;
      if(!current||current.image!==found.image||current.input!==found.input||current.data!==data){
        state.cancelPending?.();
        current=state.current={...found,data,id:state.documentKey+':'+(++state.sequence),submitted:false,locked:false,manualTouched:false};
        const remember=e=>{if(e.isTrusted&&state.current===current){current.manualTouched=true;state.cancelPending?.();}};
        current.input.addEventListener('input',remember);current.input.addEventListener('change',remember);
      }else Object.assign(current,found);
      const existingText=String(found.input.value||'');
      let status=current.submitted?(found.error?'incorrect':'submitted'):(current.manualTouched||existingText?'manual':'ready');
      if(expected&&expected!==current.id)status='changed';
      return {present:true,supported:true,status,challengeId:current.id,existingText,adapter:found.adapter,submitEnabled:enabled(found.button),message:found.error||(status==='manual'?'직접 입력한 문자가 있어 자동으로 덮어쓰지 않습니다.':status==='changed'?'보안문자 이미지가 바뀌었습니다.':status==='submitted'?'입력완료를 눌렀으며 사이트 응답을 확인 중입니다.':'보안문자 이미지를 확인했습니다.'),...(includeImage?{imageDataUrl:data}:{}),imageWidth:found.image.naturalWidth,imageHeight:found.image.naturalHeight};
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
          finish({submitted:true,status:'submitted',challengeId:current.id,message:'보안문자를 입력하고 입력완료를 눌렀습니다.'});
          found.button.click();
        };
        observer=new MutationObserver(check);observer.observe(current.container,{subtree:true,childList:true,attributes:true});
        timer=setTimeout(()=>finish({submitted:false,status:'unsupported',message:'입력완료 버튼이 활성화되지 않았습니다. 직접 확인해 주세요.'}),1500);
        try{
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
          if(!setter)return finish({submitted:false,status:'unsupported',message:'보안문자 입력칸에 값을 전달하지 못했습니다.'});
          setter.call(current.input,arg.text);
          current.input.dispatchEvent(new Event('input',{bubbles:true}));
          current.input.dispatchEvent(new Event('change',{bubbles:true}));
          check();
        }catch{return finish({submitted:false,status:'unsupported',message:'보안문자 입력 중 오류가 발생했습니다. 실제 화면을 확인해 주세요.'});}
      });
    };
    window.__bearsCaptchaPage={snapshot:()=>inspect({includeImage:true}),status:arg=>inspect({expected:arg?.challengeId}),submit,cancel:()=>{state.cancelPending?.();return {cancelled:true};}};
  }
  return window.__bearsCaptchaPage.snapshot();
},
"captcha.captchaSubmit":function captchaSubmit(arg){return window.__bearsCaptchaPage?.submit(arg)||{submitted:false,status:'changed',message:'페이지가 바뀌었습니다. 보안문자 이미지를 다시 확인해 주세요.'};},
"captcha.captchaStatus":function captchaStatus(arg){return window.__bearsCaptchaPage?.status(arg)||{present:false,supported:false,status:'changed',message:'페이지가 바뀌어 이전 보안문자의 결과를 확인할 수 없습니다.'};},
"captcha.captchaCancel":function captchaCancel(){return window.__bearsCaptchaPage?.cancel()||{cancelled:true};},
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
        current.input.dispatchEvent(new Event('input',{bubbles:true}));
        current.input.dispatchEvent(new Event('change',{bubbles:true}));
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
        found.button.click();
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
"page.stopWatchers":function stopWatchers(){window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();return true;},
"page.pageClock":function pageClock(){return {pageMono:performance.now(),documentId:window.__bearsGate?.status.documentId};},
"page.gateSnapshot":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAll":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);b.click();});},
"page.gateState":function gateSnapshot(){return window.__bearsGate?.status||null;},
"page.showAllGames":function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);b.click();});},
});
