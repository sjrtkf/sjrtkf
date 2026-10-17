'use strict';
// Observed 2026-09-10 on tickets.interpark.com/onestop/seat.
// The current DOM is the authority for availability; events target seat IDs.
function liveRead() {
  if(typeof window!=='undefined'&&typeof MutationObserver==='function'&&document.body&&!window.__ticketSeatChanges){
    const state={revision:0,listeners:new Set()};
    state.observer=new MutationObserver(()=>{state.revision++;for(const fn of [...state.listeners])fn();});
    state.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','disabled','aria-disabled','aria-busy','style']});
    state.stop=()=>{state.observer.disconnect();for(const fn of [...state.listeners])fn(true);delete window.__ticketSeatChanges;};
    window.__ticketSeatChanges=state;
  }
  const visible = el => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none';};
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
}
function liveAction({row,action}) {
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
}
const readScript=()=>`(${liveRead.toString()})()`;
const clickScript=(row,action)=>`(${liveAction.toString()})(${JSON.stringify({row,action})})`;
function supportedUrl(value){try{const u=new URL(value);return u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat';}catch{return false;}}
function waitForChange({revision,timeoutMs=3500}={}){
  const state=window.__ticketSeatChanges;
  if(!state||state.revision!==revision)return Promise.resolve({changed:true});
  const delay=Math.min(4000,Math.max(1,Number(timeoutMs)||3500));
  return new Promise(resolve=>{let timer;const done=stopped=>{clearTimeout(timer);state.listeners.delete(done);resolve({changed:state.revision!==revision,stopped:stopped===true,revision:state.revision});};state.listeners.add(done);timer=setTimeout(done,delay);if(state.revision!==revision)done();});
}
module.exports={liveRead,liveAction,waitForChange,readScript,clickScript,supportedUrl};
