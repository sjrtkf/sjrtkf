'use strict';
function scene(){
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
}
function dismissConflict(){
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
}
function dismissEmptySelection(){
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
}
function clickKnown(label){
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
}
function enterCode(code){
  if(!/^[A-Z]{6}$/.test(code))throw new Error('보안문자 6자리를 입력해 주세요.');
  const image=document.querySelector('img[alt="캡챠 이미지"]');
  if(!image||!image.getBoundingClientRect().width)throw new Error('보안문자 입력 화면이 아닙니다.');
  let container=image.parentElement;
  while(container&&container!==document.body&&!container.querySelector('input'))container=container.parentElement;
  const inputs=container?[...container.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0):[];
  if(inputs.length!==1)throw new Error('보안문자 입력칸을 확인할 수 없습니다.');
  const input=inputs[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,code);siteInvoke(input,'change',code);
  return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{observer.disconnect();reject(Error('입력완료 버튼이 활성화되지 않았습니다.'));},1500);const check=()=>{const btn=[...container.querySelectorAll('button')].find(e=>e.textContent.trim()==='입력완료'&&!e.disabled);if(btn){clearTimeout(timeout);observer.disconnect();siteInvoke(btn);resolve(true);}};const observer=new MutationObserver(check);observer.observe(container,{subtree:true,childList:true,attributes:true});check();});
}
function waitSelected({id,selected=true,timeout=2500}){
  return new Promise((resolve,reject)=>{const check=()=>{const el=document.getElementById(id);if(el&&el.getAttribute('class').includes('SeatMap_selected')===selected){clearTimeout(timer);observer.disconnect();resolve(true);}};const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});const timer=setTimeout(()=>{observer.disconnect();reject(Error('사이트에서 좌석 선택을 확인하지 못했습니다.'));},timeout);check();});
}
function deselect(){throw Error('실제 좌석 해제는 HTTP 복구 경로에서만 실행합니다.');}
module.exports={scene,clickKnown,enterCode,waitSelected,deselect,dismissConflict,dismissEmptySelection};
