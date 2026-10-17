'use strict';

// Serialized into the extension. Read only the booking fields, never the whole
// bootstrap: its siblings include account identifiers and authentication data.
function bookingObservation(){
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
}

function inspectionState(run,info,now=Date.now()){
  if(!run.preferences.stopAfterCaptcha)return null;
  if(info.captcha){run.inspectionCaptchaSeen=true;run.inspectionReadyAt=null;return null;}
  if(info.busy||info.dialog||info.notice?.present||(!info.hasSeats&&!info.grades?.length)){run.inspectionReadyAt=null;return {waiting:true};}
  run.inspectionReadyAt??=now;
  if(!run.inspectionCaptchaSeen&&now-run.inspectionReadyAt<2500)return {waiting:true};
  return {ready:true,message:run.inspectionCaptchaSeen?'보안문자 확인 후 정지 · 좌석 정보 기록 완료':'좌석 정보 기록 후 정지 · 보안문자는 표시되지 않았거나 이미 처리된 상태입니다.'};
}
module.exports={bookingObservation,inspectionState};
